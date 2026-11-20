#!/usr/bin/env bash
# Sube la web armada (dist/web, de «node tools/build-web.mjs») a homeflix.fun. Desde Git Bash, en la raíz del repo o en servidor/:
#
#   bash servidor/scripts/subir-web.sh [opciones]
#
#   --dry-run    revisa el VPS y dice cuántos archivos subiría; no cambia nada allá
#   --rollback   vuelve a la versión anterior de la web (el enlace «current»)
#
# Sube a ~/homeflix-web/releases/<fecha>/ y, al final, cambia el enlace ~/homeflix-web/current (lo que sirve Caddy) de golpe: nadie ve la web a medias.
# Antes de usarlo la primera vez, root tiene que haber corrido servidor/scripts/caddy-web.sh (agrega homeflix.fun a Caddy). No necesita sudo.
set -euo pipefail

HOST="${HOMEFLIX_HOST:-deploy@187.77.20.217}"
KEY="${HOMEFLIX_KEY:-$HOME/.ssh/nexuspos_vps}"
DIR="homeflix-web"
KEEP=5
URL="${HOMEFLIX_WEB_URL:-https://homeflix.fun}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
log() { printf '\n==> %s\n' "$*"; }

DRY=0; ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/../.."
SRC=dist/web

# Un colaborador (deploycolab@…) no tiene consola en el VPS: usa las órdenes de servidor/scripts/colab/homeflix-colab (web-subir, web-revertir).
case "$HOST" in
  deploycolab@*)
    if [ "$ROLLBACK" = 1 ]; then log "Volviendo a la versión anterior"; "${SSH[@]}" web-revertir; exit 0; fi
    [ -f "$SRC/index.html" ] || { echo "No hay $SRC: corre antes «node tools/build-web.mjs»." >&2; exit 1; }
    echo "  $(find "$SRC" -type f | wc -l) archivos, ~$(du -sm "$SRC" | cut -f1) MB"
    if [ "$DRY" = 1 ]; then echo "No se cambió nada."; exit 0; fi
    log "Subiendo como colaborador"
    tar -czf - -C "$SRC" . | "${SSH[@]}" web-subir
    log "Comprobando por fuera ($URL)"; sleep 1; curl -sI --max-time 25 "$URL" | head -3 || true
    exit 0 ;;
esac

log "Revisando el VPS (solo lectura)"
"${SSH[@]}" "test -L ~/$DIR/current && echo '  current -> '\$(readlink ~/$DIR/current) || { echo 'Falta ~/$DIR/current: root debe correr primero scripts/caddy-web.sh' >&2; exit 1; }"

if [ "$ROLLBACK" = 1 ]; then
  log "Volviendo a la versión anterior"
  "${SSH[@]}" "set -e; cd ~/$DIR
    cur=\$(readlink current | sed 's#.*/##')
    prev=\$(ls -1 releases | grep -v '^inicial\$' | sort | grep -B1 -x \"\$cur\" | head -n1)
    { [ -n \"\$prev\" ] && [ \"\$prev\" != \"\$cur\" ]; } || { echo 'No hay una versión anterior.'; exit 1; }
    ln -sfn releases/\$prev current.tmp && mv -T current.tmp current
    echo \"  current -> releases/\$prev\""
  curl -sI --max-time 20 "$URL" | head -1
  exit 0
fi

[ -f "$SRC/index.html" ] || { echo "No hay $SRC: corre antes «node tools/build-web.mjs»." >&2; exit 1; }
n=$(find "$SRC" -type f | wc -l)
mb=$(du -sm "$SRC" | cut -f1)
echo "  $n archivos, ~${mb} MB"
if [ "$DRY" = 1 ]; then echo "No se cambió nada."; exit 0; fi

STAMP="$(date +%Y%m%d-%H%M%S)"
log "Subiendo a ~/$DIR/releases/$STAMP"
tar -czf - -C "$SRC" . | "${SSH[@]}" "set -e; mkdir -p ~/$DIR/releases/$STAMP && tar -xzf - -C ~/$DIR/releases/$STAMP && find ~/$DIR/releases/$STAMP -type d -exec chmod 755 {} + && find ~/$DIR/releases/$STAMP -type f -exec chmod 644 {} +"

log "Activando"
"${SSH[@]}" "set -e; cd ~/$DIR
  ln -sfn releases/$STAMP current.tmp && mv -T current.tmp current
  echo '  current -> releases/$STAMP'
  ls -1 releases | grep -v '^inicial\$' | sort | head -n -$KEEP | xargs -r -I{} rm -rf releases/{}"

log "Comprobando por fuera ($URL)"
sleep 1
curl -sI --max-time 25 "$URL" | head -3 || true
echo; echo "Listo: $URL sirve la versión $STAMP. Para volver atrás: bash servidor/scripts/subir-web.sh --rollback"
