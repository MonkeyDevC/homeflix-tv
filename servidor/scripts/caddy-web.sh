#!/usr/bin/env bash
# Agrega homeflix.fun (la versión web de HomeFlix) al Caddy del VPS. Se corre UNA sola vez, EN el VPS, con sudo (pide la contraseña):
#   sudo bash ~/homeflix-servidor/scripts/caddy-web.sh
# Qué hace:
#   - respalda /etc/caddy/Caddyfile, agrega el bloque «homeflix.fun» (archivos estáticos de ~/homeflix-web/current) y el de «www.homeflix.fun»
#     (redirige al principal); valida y recarga Caddy. Si la validación falla, deja el Caddyfile como estaba.
#   - no toca los demás sitios (scalvache.shop, nexuspos…, cloud-dev.homeflix.fun, anime.homeflix.fun).
# Caddy pide solo el certificado HTTPS (hace falta que el DNS de homeflix.fun y www apunte a este VPS; ya apunta).
# Después, las actualizaciones de la web NO necesitan sudo: servidor/scripts/subir-web.sh deja los archivos en ~/homeflix-web/current.
set -euo pipefail
CF=/etc/caddy/Caddyfile
WEBDIR=/home/deploy/homeflix-web

if [ "$(id -u)" -ne 0 ]; then echo "Corre este script con sudo: sudo bash $0"; exit 1; fi

if grep -qE '^homeflix\.fun[ ,{]' "$CF"; then echo "homeflix.fun ya está en $CF; no se cambia nada."; exit 0; fi

# la carpeta de la web: del usuario deploy (así subir-web.sh no necesita sudo) y legible para Caddy.
# «current» es un enlace a la versión vigente (releases/<fecha>): subir-web.sh lo cambia de golpe y se puede volver atrás con --rollback.
mkdir -p "$WEBDIR/releases/inicial"
if [ ! -e "$WEBDIR/current" ]; then
  printf '<!doctype html><meta charset="utf-8"><title>HomeFlix</title><p>HomeFlix: la web se está preparando.</p>
' > "$WEBDIR/releases/inicial/index.html"
  ln -sfn releases/inicial "$WEBDIR/current"
fi
chown -R deploy:deploy "$WEBDIR"
chmod 755 "$WEBDIR" "$WEBDIR/releases" "$WEBDIR/releases/inicial"

BK="$CF.backup-$(date +%Y%m%d-%H%M%S)-antes-de-homeflix-web"
cp -a "$CF" "$BK"
echo "Respaldo: $BK"

cat >> "$CF" <<'EOF'

# HomeFlix web (versión para computador y celular): archivos estáticos subidos con servidor/scripts/subir-web.sh
www.homeflix.fun {
	redir https://homeflix.fun{uri} permanent
}
homeflix.fun {
	encode zstd gzip
	root * /home/deploy/homeflix-web/current
	# Se revalida siempre (ETag): al subir una versión nueva, la ven en la siguiente visita; las imágenes y el motor pesan poco la segunda vez.
	header Cache-Control "no-cache"
	# El service worker de la app instalada (/web/sw.js) nunca se guarda en caché del navegador.
	@sw path /web/sw.js
	header @sw Cache-Control "no-store"
	header X-Content-Type-Options "nosniff"
	file_server
}
EOF

if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
  echo "Listo: Caddy recargado con homeflix.fun."
  sleep 3
  curl -sI --max-time 20 https://homeflix.fun | head -3 || true
else
  cp -a "$BK" "$CF"
  echo "La configuración no pasó la validación: se dejó el Caddyfile como estaba."
  exit 1
fi
