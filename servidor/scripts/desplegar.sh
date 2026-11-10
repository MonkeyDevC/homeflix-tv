#!/usr/bin/env bash
# Despliega servidor/ (HomeFlix, contenedor «homeflix») en el VPS. Desde Git Bash, dentro de servidor/:
#
#   bash scripts/desplegar.sh [opciones]
#
#   --dry-run      corre pruebas, revisa el VPS y lista lo que subiría; no cambia nada allá
#   --skip-tests   no corre las pruebas en local
#   --rollback     vuelve al último respaldo de código (la base no se toca)
#
# Mismo esquema que AlertaPiloto (~/neto-servidor). Solo toca ~/homeflix-servidor, ~/homeflix-backups y el
# contenedor «homeflix». Nunca el .env (salvo crearlo la primera vez con un ADMIN_TOKEN al azar), el volumen de
# datos, Caddy ni los demás contenedores. Cada despliegue deja en ~/homeflix-backups/release-<fecha>/:
#   codigo.tgz              el código que había antes (para --rollback)
#   antes-<fecha>.db        una copia consistente de la base (con scripts/respaldo.js)
set -euo pipefail

HOST="${HOMEFLIX_HOST:-deploy@187.77.20.217}"
KEY="${HOMEFLIX_KEY:-$HOME/.ssh/nexuspos_vps}"
REMOTE_DIR="homeflix-servidor"
BACKUP_DIR="homeflix-backups"
KEEP_BACKUPS=10
PATHS=(src scripts package.json package-lock.json Dockerfile docker-compose.yml .dockerignore .env.example Caddyfile.snippet)
URL_PUBLICA="${HOMEFLIX_URL:-https://scalvache.shop/productos/HomeFlix}"

DRY_RUN=0; SKIP_TESTS=0; ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
log() { printf '\n==> %s\n' "$*"; }

salud() {
  "${SSH[@]}" 'for i in $(seq 1 30); do
      [ "$(docker inspect -f "{{.State.Health.Status}}" homeflix 2>/dev/null)" = healthy ] && { echo "homeflix sano"; exit 0; }
      sleep 2
    done; docker logs homeflix --tail 30; exit 1'
}

if [ "$ROLLBACK" = 1 ]; then
  log "Volviendo al último respaldo de código"
  "${SSH[@]}" "set -e
    last=\$(ls -1d ~/$BACKUP_DIR/release-*/ 2>/dev/null | sort | while read -r d; do [ -f \"\$d/codigo.tgz\" ] && echo \"\$d\"; done | tail -n 1)
    [ -n \"\$last\" ] || { echo 'No hay un respaldo de código para restaurar.'; exit 1; }
    echo \"Restaurando \$last\"
    cd ~/$REMOTE_DIR
    for p in ${PATHS[*]}; do rm -rf \"\$p\"; done
    tar -xzf \"\$last/codigo.tgz\" -C .
    docker compose up -d --build 2>&1 | tail -5"
  log "Salud"; salud
  echo "Listo. La base no se tocó: si hace falta volver también a ella, el respaldo está en esa misma carpeta (antes-*.db)."
  exit 0
fi

if [ "$SKIP_TESTS" = 0 ] && [ -d node_modules ]; then
  log "Pruebas"
  npm test --silent
fi

log "Revisando el VPS (solo lectura)"
"${SSH[@]}" "docker network inspect scalvache-interna >/dev/null && echo '  red scalvache-interna: lista'" \
  || { echo "El VPS no responde o falta la red scalvache-interna." >&2; exit 1; }
PRIMERA="$("${SSH[@]}" "test -f ~/$REMOTE_DIR/.env && echo no || echo si")"
[ "$PRIMERA" = si ] && echo "  Primera vez: se crea ~/$REMOTE_DIR con un .env nuevo (ADMIN_TOKEN al azar)." \
  || "${SSH[@]}" "grep -qE '^ADMIN_TOKEN=.{32,}' ~/$REMOTE_DIR/.env && echo '  ADMIN_TOKEN: puesto' || echo '  ADMIN_TOKEN: VACÍO (la consola no podrá entrar)'"

if [ "$DRY_RUN" = 1 ]; then
  log "Ensayo: archivos que se subirían"
  tar -czf - "${PATHS[@]}" | tar -tzf - | grep -v '/$' | sort
  echo; echo "No se cambió nada."; exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"

if [ "$PRIMERA" = si ]; then
  log "Preparando ~/$REMOTE_DIR"
  "${SSH[@]}" "set -e
    mkdir -p ~/$REMOTE_DIR/versiones ~/$BACKUP_DIR
    umask 077
    printf 'ADMIN_TOKEN=%s\n' \"\$(openssl rand -hex 32)\" > ~/$REMOTE_DIR/.env
    echo '  .env creado (el token no se muestra)'"
else
  log "Respaldando la base y el código actual (release-$STAMP)"
  "${SSH[@]}" "set -e
    cd ~/$REMOTE_DIR
    mkdir -p ~/$BACKUP_DIR/release-$STAMP
    if docker ps --format '{{.Names}}' | grep -qx homeflix; then
      docker compose exec -T homeflix node scripts/respaldo.js /data/antes-$STAMP.db
      docker cp homeflix:/data/antes-$STAMP.db ~/$BACKUP_DIR/release-$STAMP/antes-$STAMP.db
      docker compose exec -T homeflix rm -f /data/antes-$STAMP.db
    fi
    present=''; for p in ${PATHS[*]}; do [ -e \"\$p\" ] && present=\"\$present \$p\"; done
    [ -n \"\$present\" ] && tar -czf ~/$BACKUP_DIR/release-$STAMP/codigo.tgz \$present
    ls -la ~/$BACKUP_DIR/release-$STAMP"
fi

log "Subiendo el código"
tar -czf - "${PATHS[@]}" | "${SSH[@]}" "set -e
  rm -rf ~/$REMOTE_DIR.incoming && mkdir -p ~/$REMOTE_DIR.incoming
  tar -xzf - -C ~/$REMOTE_DIR.incoming
  cd ~/$REMOTE_DIR
  for p in ${PATHS[*]}; do rm -rf \"\$p\"; done
  cp -a ~/$REMOTE_DIR.incoming/. .
  rm -rf ~/$REMOTE_DIR.incoming
  # el canal de actualizaciones (docker-compose la monta en /versiones): si no existe, Docker la crearía como root
  # y tools/publicar-version.mjs no podría subir nada
  mkdir -p versiones
  ls -1d ~/$BACKUP_DIR/release-* 2>/dev/null | sort | head -n -$KEEP_BACKUPS | xargs -r rm -rf"

log "Construyendo y arrancando el contenedor homeflix"
"${SSH[@]}" "cd ~/$REMOTE_DIR && docker compose up -d --build 2>&1 | tail -6"

log "Salud"
if ! salud; then
  if [ "$PRIMERA" = si ]; then echo "El contenedor no quedó sano (primera vez: no hay versión anterior)." >&2; exit 1; fi
  echo "El contenedor no quedó sano. Volviendo al código anterior..." >&2
  bash "$0" --rollback
  exit 1
fi

log "Comprobando por dentro (loopback del VPS)"
"${SSH[@]}" "curl -s --max-time 10 http://127.0.0.1:4500/productos/HomeFlix/ && echo"

log "Comprobando por fuera ($URL_PUBLICA)"
cuerpo="$(curl -s --max-time 20 "$URL_PUBLICA/" || true)"
if printf '%s' "$cuerpo" | grep -q '"app":"homeflix"'; then
  echo "  $URL_PUBLICA responde: $cuerpo"
else
  echo "  Todavía no responde por fuera: falta la ruta en Caddy (ver Caddyfile.snippet):"
  echo "    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.backup-\$(date +%Y%m%d-%H%M%S)-antes-de-homeflix"
  echo "    (agregar Caddyfile.snippet dentro del bloque scalvache.shop, antes del handle final)"
  echo "    sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy"
fi
echo; echo "Desplegado: release $STAMP. Para volver atrás: bash scripts/desplegar.sh --rollback"
