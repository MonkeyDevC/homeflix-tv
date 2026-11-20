#!/usr/bin/env bash
# Despliega el motor de recomendaciones (reco-db, reco-api, reco-worker) en el VPS. Desde la raíz del repo:
#
#   bash recomendador/scripts/desplegar.sh [opciones]
#
#   --dry-run      corre pruebas, revisa el VPS (memoria, red) y lista lo que subiría; no cambia nada allá
#   --skip-tests   no corre las pruebas en local
#   --rollback     vuelve al último respaldo de código (la base no se toca)
#
# Mismo esquema que servidor/scripts/desplegar.sh. Solo toca ~/homeflix-recomendador, ~/homeflix-backups/reco-*,
# los contenedores reco-* y la red «reco-interna». Nunca el .env existente ni los volúmenes (base y sesiones).
# La primera vez crea recomendador/.env con contraseñas y RECO_TOKEN al azar, y copia el RECO_TOKEN al .env del
# servidor Node (~/homeflix-servidor/.env) si no lo tiene. Las claves de Telegram, el bot y TMDB se ponen a mano.
set -euo pipefail

HOST="${HOMEFLIX_HOST:-deploy@187.77.20.217}"
KEY="${HOMEFLIX_KEY:-$HOME/.ssh/nexuspos_vps}"
REMOTE_DIR="homeflix-recomendador"
BACKUP_DIR="homeflix-backups"
KEEP_BACKUPS=10
PATHS=(recomendador/reco recomendador/migraciones recomendador/db-init recomendador/scripts recomendador/pyproject.toml
       recomendador/Dockerfile recomendador/Dockerfile.dockerignore recomendador/docker-compose.yml
       recomendador/.env.example recomendador/README.md js/library.js)
MEMORIA_MIN_MB=900

DRY_RUN=0; SKIP_TESTS=0; ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/../.."
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
log() { printf '\n==> %s\n' "$*"; }

salud() {
  "${SSH[@]}" 'for i in $(seq 1 45); do
      [ "$(docker inspect -f "{{.State.Health.Status}}" reco-api 2>/dev/null)" = healthy ] && { echo "reco-api sano"; exit 0; }
      sleep 2
    done; docker logs reco-api --tail 40; exit 1'
}

if [ "$ROLLBACK" = 1 ]; then
  log "Volviendo al último respaldo de código del motor"
  "${SSH[@]}" "set -e
    last=\$(ls -1d ~/$BACKUP_DIR/reco-release-*/ 2>/dev/null | sort | while read -r d; do [ -f \"\$d/codigo.tgz\" ] && echo \"\$d\"; done | tail -n 1)
    [ -n \"\$last\" ] || { echo 'No hay respaldo de código para restaurar.'; exit 1; }
    echo \"Restaurando \$last\"
    cd ~/$REMOTE_DIR
    for p in ${PATHS[*]}; do rm -rf \"\$p\"; done
    tar -xzf \"\$last/codigo.tgz\" -C .
    cd recomendador && docker compose up -d --build 2>&1 | tail -6"
  log "Salud"; salud
  echo "Listo. La base no se tocó; su respaldo está en esa carpeta (antes.sql.gz)."
  exit 0
fi

if [ "$SKIP_TESTS" = 0 ] && [ -x recomendador/.venv/bin/pytest ]; then
  log "Pruebas"
  (cd recomendador && .venv/bin/pytest -q -m "not integracion")
fi

log "Revisando el VPS (solo lectura)"
"${SSH[@]}" "set -e
  libre=\$(free -m | awk '/^Mem:/ {print \$7}')
  echo \"  memoria disponible: \${libre} MB (el motor usa hasta ~1100 MB: base 256 + api 384 + worker 448)\"
  [ \"\$libre\" -ge $MEMORIA_MIN_MB ] || echo '  ⚠️  poca memoria libre: revisar antes de seguir'
  docker network inspect reco-interna >/dev/null 2>&1 && echo '  red reco-interna: lista' || echo '  red reco-interna: se creará'
  docker ps --format '{{.Names}}' | grep -qx homeflix && echo '  servidor homeflix: corriendo' || echo '  ⚠️  el contenedor homeflix no corre'
  test -f ~/$REMOTE_DIR/recomendador/.env && echo '  .env del motor: existe' || echo '  primera vez: se crea .env con secretos al azar'
  docker volume inspect homeflix-recomendador_reco-sesiones >/dev/null 2>&1 && echo '  volumen de sesiones: existe' || echo '  volumen de sesiones: nuevo (habrá que iniciar sesión con --login)'" \
  || { echo "El VPS no responde." >&2; exit 1; }

if [ "$DRY_RUN" = 1 ]; then
  log "Ensayo: archivos que se subirían"
  tar --exclude='__pycache__' -czf - "${PATHS[@]}" | tar -tzf - | grep -v '/$' | sort
  echo; echo "No se cambió nada."; exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
log "Preparando y respaldando (reco-release-$STAMP)"
"${SSH[@]}" "set -e
  docker network inspect reco-interna >/dev/null 2>&1 || docker network create reco-interna >/dev/null
  mkdir -p ~/$REMOTE_DIR/recomendador ~/$BACKUP_DIR/reco-release-$STAMP
  cd ~/$REMOTE_DIR
  if [ ! -f recomendador/.env ]; then
    umask 077
    token=\$(openssl rand -hex 32)
    { printf 'RECO_DB_ADMIN_PASSWORD=%s\nRECO_DB_APP_PASSWORD=%s\nRECO_TOKEN=%s\n' \"\$(openssl rand -hex 24)\" \"\$(openssl rand -hex 24)\" \"\$token\"
      printf 'HOMEFLIX_INTERNO_URL=http://homeflix:3000\nTG_API_ID=\nTG_API_HASH=\nBOT_TOKEN=\nBOT_USERNAME=night_monkey_bot\nCATALOGO_CHATS=\nBUZON_CHAT=\nTMDB_API_KEY=\nTMDB_IDIOMA=es-MX\n'; } > recomendador/.env
    if [ -f ~/homeflix-servidor/.env ] && ! grep -q '^RECO_TOKEN=' ~/homeflix-servidor/.env; then
      printf 'RECO_TOKEN=%s\n' \"\$token\" >> ~/homeflix-servidor/.env
      echo '  RECO_TOKEN copiado al .env del servidor Node (hay que redesplegarlo para que lo use)'
    fi
    echo '  .env creado (los secretos no se muestran). Falta poner TG_API_ID/HASH, BOT_TOKEN, CATALOGO_CHATS y TMDB.'
  fi
  if docker ps --format '{{.Names}}' | grep -qx reco-db; then
    docker exec reco-db pg_dump -U reco_admin homeflix_reco | gzip > ~/$BACKUP_DIR/reco-release-$STAMP/antes.sql.gz
  fi
  present=''; for p in ${PATHS[*]}; do [ -e \"\$p\" ] && present=\"\$present \$p\"; done
  [ -n \"\$present\" ] && tar -czf ~/$BACKUP_DIR/reco-release-$STAMP/codigo.tgz \$present
  ls -la ~/$BACKUP_DIR/reco-release-$STAMP"

log "Subiendo el código"
tar --exclude='__pycache__' -czf - "${PATHS[@]}" | "${SSH[@]}" "set -e
  rm -rf ~/$REMOTE_DIR.incoming && mkdir -p ~/$REMOTE_DIR.incoming
  tar -xzf - -C ~/$REMOTE_DIR.incoming
  cd ~/$REMOTE_DIR
  for p in ${PATHS[*]}; do rm -rf \"\$p\"; done
  cp -a ~/$REMOTE_DIR.incoming/. .
  rm -rf ~/$REMOTE_DIR.incoming
  ls -1d ~/$BACKUP_DIR/reco-release-* 2>/dev/null | sort | head -n -$KEEP_BACKUPS | xargs -r rm -rf"

log "Construyendo y arrancando reco-db, reco-api y reco-worker"
"${SSH[@]}" "cd ~/$REMOTE_DIR/recomendador && docker compose up -d --build 2>&1 | tail -8"

log "Salud"
salud || { echo "reco-api no quedó sano. Para volver atrás: bash recomendador/scripts/desplegar.sh --rollback" >&2; exit 1; }
"${SSH[@]}" "docker logs reco-worker --tail 5 2>&1 | grep -q 'no está iniciada' && echo '
  ⚠️  Falta iniciar sesión con la cuenta Premium (una sola vez, interactivo):
     cd ~/$REMOTE_DIR/recomendador && docker compose run --rm -it reco-worker python -m reco.worker --login
     y luego: docker compose restart reco-worker' || true"
echo "Listo: motor desplegado (reco-release-$STAMP)."
