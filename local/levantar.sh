#!/usr/bin/env bash
# Levanta HomeFlix en este computador con Docker: servidor (homeflix), motor (reco-api, reco-worker) y su base (reco-db).
#
#   bash local/levantar.sh            crea lo que falte y levanta (o actualiza) todo
#   bash local/levantar.sh --parar    lo detiene (los datos quedan en los volúmenes)
#   bash local/levantar.sh --estado   muestra cómo está cada contenedor
#
# La primera vez crea recomendador/.env y servidor/.env con secretos al azar (RECO_TOKEN compartido) y toma las claves
# que ya existen en este equipo: Telegram y el bot de ~/Documents/night_monkey_bot/.env, TMDB del .env de la raíz.
# Nunca imprime una clave.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f local/docker-compose.yml)

case "${1:-}" in
  --parar) "${COMPOSE[@]}" down; exit 0 ;;
  --estado) "${COMPOSE[@]}" ps; exit 0 ;;
esac

valor() { # valor ARCHIVO CLAVE → el valor, sin mostrarlo
  [ -f "$1" ] && grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2- || true
}

docker network inspect reco-interna >/dev/null 2>&1 || { docker network create reco-interna >/dev/null; echo "red reco-interna creada"; }

if [ ! -f recomendador/.env ]; then
  umask 077
  BOT_ENV="$HOME/Documents/night_monkey_bot/.env"
  token=$(openssl rand -hex 32)
  {
    printf 'RECO_DB_ADMIN_PASSWORD=%s\nRECO_DB_APP_PASSWORD=%s\nRECO_TOKEN=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" "$token"
    printf 'HOMEFLIX_INTERNO_URL=http://homeflix:3000\n'
    printf 'TG_API_ID=%s\nTG_API_HASH=%s\n' "$(valor "$BOT_ENV" API_ID)" "$(valor "$BOT_ENV" API_HASH)"
    printf 'BOT_TOKEN=%s\nBOT_USERNAME=%s\n' "$(valor "$BOT_ENV" BOT_TOKEN)" "$(valor "$BOT_ENV" BOT_USERNAME)"
    printf 'CATALOGO_CHATS=\nBUZON_CHAT=\nTRANSCRIBE_TIMEOUT=180\n'
    printf 'TMDB_API_KEY=%s\nTMDB_IDIOMA=es-MX\n' "$(valor .env TMDB_API_KEY)"
  } > recomendador/.env
  echo "recomendador/.env creado (los secretos no se muestran)"
fi

if [ ! -f servidor/.env ]; then
  umask 077
  printf 'ADMIN_TOKEN=%s\nRECO_TOKEN=%s\n' "$(openssl rand -hex 32)" "$(valor recomendador/.env RECO_TOKEN)" > servidor/.env
  echo "servidor/.env creado"
elif ! grep -q '^RECO_TOKEN=' servidor/.env; then
  printf 'RECO_TOKEN=%s\n' "$(valor recomendador/.env RECO_TOKEN)" >> servidor/.env
  echo "RECO_TOKEN agregado a servidor/.env"
fi

[ -n "$(valor recomendador/.env CATALOGO_CHATS)" ] || echo "⚠️  Falta CATALOGO_CHATS (id del grupo NETSUCKS) en recomendador/.env: el motor no leerá el catálogo."

"${COMPOSE[@]}" up -d --build 2>&1 | tail -n 12

echo "Esperando a que todo esté sano…"
for i in $(seq 1 60); do
  a=$(docker inspect -f '{{.State.Health.Status}}' reco-api 2>/dev/null || echo no)
  h=$(docker inspect -f '{{.State.Health.Status}}' homeflix 2>/dev/null || echo no)
  [ "$a" = healthy ] && [ "$h" = healthy ] && break
  sleep 2
done
"${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Status}}'
curl -fsS http://127.0.0.1:4500/productos/HomeFlix/ >/dev/null && echo "✅ HomeFlix en http://localhost:4500/productos/HomeFlix"
docker logs reco-worker --tail 30 2>&1 | grep -q 'no está iniciada' && echo "⚠️  El worker no tiene sesión de Telegram: ver local/README.md" || true
