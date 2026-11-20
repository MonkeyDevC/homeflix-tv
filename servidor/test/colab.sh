#!/usr/bin/env bash
# Prueba el programa de acceso del colaborador (servidor/scripts/colab/homeflix-colab) en una carpeta temporal, sin root ni VPS.
# Necesita Linux (o WSL) con bash, jq, tar GNU y flock:   bash servidor/test/colab.sh
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
PROG="$AQUI/../scripts/colab/homeflix-colab"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HC_CASA="$T/casa" HC_ENTRADA="nadie-con-este-nombre"   # sin el paso de sudo: se prueba la parte que valida
mkdir -p "$HC_CASA/homeflix-servidor/versiones"
VERS="$HC_CASA/homeflix-servidor/versiones"
ok=0; mal=0
chequea() { # <nombre> <comando que debe salir bien>
  if eval "$2" >/dev/null 2>&1; then ok=$((ok + 1)); echo "  ok   $1"; else mal=$((mal + 1)); echo "  MAL  $1"; fi
}
rechaza() { # <nombre> <comando que debe FALLAR>
  if eval "$2" >/dev/null 2>&1; then mal=$((mal + 1)); echo "  MAL  $1 (se aceptó)"; else ok=$((ok + 1)); echo "  ok   $1 (rechazado)"; fi
}
run() { local o="$1"; shift; bash "$PROG" $o "$@"; }

# una versión de prueba como la arma tools/publicar-version.mjs
armar() { # <versión>
  local v="$1" d="$T/arm-$1"; rm -rf "$d"; mkdir -p "$d"
  printf '{"app":"homeflix-web","version":"%s","files":{}}' "$v" > "$d/web-$v.json"
  head -c 5000 /dev/urandom > "$d/homeflix-$v.wgt"; head -c 7000 /dev/urandom > "$d/homeflix-$v.apk"; head -c 3000 /dev/urandom > "$d/preparador-$v.zip"
  printf '@echo off\r\n' > "$d/instalar-preparador.cmd"
}
actual_de() { # <versión>  → JSON como el de publicar-version.mjs
  local v="$1" d="$T/arm-$1" j="$T/actual-$1.json"
  jq -n --arg v "$v" --arg w "web-$v.json" --arg g "homeflix-$v.wgt" \
    --arg sw "$(sha256sum "$d/web-$v.json" | cut -d' ' -f1)" --arg sg "$(sha256sum "$d/homeflix-$v.wgt" | cut -d' ' -f1)" \
    '{version:$v, fecha:"2026-01-01", notas:"prueba", web:{archivo:$w, sha256:$sw}, wgt:{archivo:$g, sha256:$sg}}' > "$j"
  echo "$j"
}

echo "== OTA: subir y activar una versión"
armar 9.9.1; armar 9.9.2
chequea "subir 9.9.1" "tar -czf - -C $T/arm-9.9.1 . | run ota-subir 9.9.1"
chequea "los archivos quedan en versiones/9.9.1" "test -f $VERS/9.9.1/web-9.9.1.json -a -f $VERS/9.9.1/homeflix-9.9.1.apk"
chequea "los archivos son legibles por todos (644)" "test \$(stat -c %a $VERS/9.9.1/homeflix-9.9.1.apk) = 644"
chequea "actual.json de 9.9.1" "run ota-actual < $(actual_de 9.9.1)"
chequea "la vigente es 9.9.1" "test \$(jq -r .version $VERS/actual.json) = 9.9.1"
rechaza "no pisa la versión vigente sin «forzar»" "tar -czf - -C $T/arm-9.9.1 . | run ota-subir 9.9.1"
chequea "con «forzar» sí" "tar -czf - -C $T/arm-9.9.1 . | run ota-subir 9.9.1 forzar"
chequea "subir 9.9.2" "tar -czf - -C $T/arm-9.9.2 . | run ota-subir 9.9.2"
chequea "activar 9.9.2" "run ota-actual < $(actual_de 9.9.2)"
chequea "revertir deja 9.9.1" "run ota-revertir && test \$(jq -r .version $VERS/actual.json) = 9.9.1"

echo "== OTA: lo que se debe rechazar"
rechaza "actual.json con una versión que no está subida" "jq '.version=\"9.9.9\"' $(actual_de 9.9.1) | run ota-actual"
rechaza "actual.json con un sha256 que no coincide" "jq '.wgt.sha256=\"00\"' $(actual_de 9.9.1) | run ota-actual"
rechaza "actual.json con un archivo que no existe" "jq '.apk={archivo:\"homeflix-9.9.1.apk\",sha256:\"00\"}' $(actual_de 9.9.1) | run ota-actual"
rechaza "actual.json con una ruta fuera de la carpeta" "jq '.web.archivo=\"../actual.json\"' $(actual_de 9.9.1) | run ota-actual"
rechaza "actual.json que no es JSON" "echo hola | run ota-actual"
armar 9.9.3
echo '<?php evil' > "$T/arm-9.9.3/shell.php"
rechaza "un archivo con nombre que no es de una versión" "tar -czf - -C $T/arm-9.9.3 . | run ota-subir 9.9.3"
rm "$T/arm-9.9.3/shell.php"; ln -s /etc/passwd "$T/arm-9.9.3/web-9.9.3.json.bak"
rechaza "un enlace simbólico dentro del tar" "tar -czf - -C $T/arm-9.9.3 . | run ota-subir 9.9.3"
rm "$T/arm-9.9.3/web-9.9.3.json.bak"
mkdir -p "$T/mal" && echo x > "$T/mal/x" && tar -czf "$T/ruta.tgz" -C "$T" --transform 's,^mal/,../../escape/,' mal/x 2>/dev/null
rechaza "rutas con «..» dentro del tar" "run ota-subir 9.9.3 < $T/ruta.tgz"
echo x > "$T/.oculto"; tar -czf "$T/oculto.tgz" -C "$T" .oculto
rechaza "un archivo oculto" "run ota-subir 9.9.3 < $T/oculto.tgz"
rechaza "versión mal escrita" "tar -czf - -C $T/arm-9.9.3 . | run ota-subir 9.9.3-x"
rechaza "versión con ruta" "tar -czf - -C $T/arm-9.9.3 . | run ota-subir ../1.2.3"
rechaza "algo que no es un .tar.gz" "echo basura | run ota-subir 9.9.3"

echo "== Web"
mkdir -p "$T/web/css" "$T/web/web/icons"; echo '<html>' > "$T/web/index.html"; echo 'a{}' > "$T/web/css/app.css"; echo x > "$T/web/web/icons/icon-192.png"
chequea "subir la web" "tar -czf - -C $T/web . | run web-subir"
chequea "current apunta a la web" "test -L $HC_CASA/homeflix-web/current -a -f $HC_CASA/homeflix-web/current/index.html"
sleep 1; echo '<html>2' > "$T/web/index.html"
chequea "subir otra versión de la web" "tar -czf - -C $T/web . | run web-subir"
chequea "revertir la web" "run web-revertir; grep -q '<html>\$' $HC_CASA/homeflix-web/current/index.html"
mkdir -p "$T/sinindex"; echo x > "$T/sinindex/x.txt"
rechaza "web sin index.html" "tar -czf - -C $T/sinindex . | run web-subir"

echo "== Órdenes"
chequea "estado" "run estado"
rechaza "una orden que no existe" "run rm -rf /"
rechaza "orden vacía con argumentos raros" "run ';id'"

echo; echo "Resultado: $ok bien, $mal mal."
[ "$mal" -eq 0 ]
