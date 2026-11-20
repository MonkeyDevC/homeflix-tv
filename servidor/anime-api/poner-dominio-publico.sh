#!/usr/bin/env bash
# Vuelve a poner anime.homeflix.fun en el Caddyfile (para PROBAR la anime-api detrás de una clave). Ejecutar como root, EN el VPS:
#   su root -c 'bash /home/deploy/poner-dominio-publico.sh'
# Toma el bloque (con su clave) del respaldo que dejó quitar-dominio-publico.sh («…-antes-de-quitar-anime») y lo agrega al final del Caddyfile
# actual; no imprime la clave. Respalda, valida y recarga; si la validación falla, restaura. Necesita que el contenedor anime-api publique
# 127.0.0.1:4600 (docker-compose.yml de esta carpeta, sección «ports»). Para cerrar otra vez: quitar-dominio-publico.sh y quitar «ports».
set -euo pipefail

CF=/etc/caddy/Caddyfile
if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta este script como root"; exit 1; fi
if grep -q "^anime\.homeflix\.fun" "$CF"; then echo "anime.homeflix.fun ya está en $CF: nada que hacer."; exit 0; fi

SRC="$(ls -1t /etc/caddy/Caddyfile.backup-*-antes-de-quitar-anime 2>/dev/null | head -n1 || true)"
if [ -z "$SRC" ]; then echo "No encuentro el respaldo «antes-de-quitar-anime»: no se cambia nada."; exit 1; fi

TMP="$(mktemp)"
# desde el comentario «# anime-api» (si lo hay justo antes) o desde la línea del bloque, hasta la llave que lo cierra
awk '
  /^# anime-api/ { held=$0; next }
  /^anime\.homeflix\.fun[ ]*\{/ { if (held != "") print held; held=""; inblock=1 }
  inblock { print; if ($0 ~ /^\}/) { inblock=0 } ; next }
  { held="" }
' "$SRC" > "$TMP"
if ! grep -q "^anime\.homeflix\.fun" "$TMP"; then rm -f "$TMP"; echo "El respaldo no trae el bloque de anime.homeflix.fun: no se cambia nada."; exit 1; fi

BK="$CF.backup-$(date +%Y%m%d-%H%M%S)-antes-de-poner-anime"
cp -a "$CF" "$BK"
echo "Backup: $BK"
{ echo; cat "$TMP"; } >> "$CF"
rm -f "$TMP"

if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
  echo "Listo: anime.homeflix.fun volvió a Caddy (con su clave)."
else
  echo "Validacion FALLO: restaurando backup"
  cp -a "$BK" "$CF"
  exit 1
fi
