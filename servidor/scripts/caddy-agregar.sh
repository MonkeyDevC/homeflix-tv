#!/usr/bin/env bash
# Agrega la ruta de HomeFlix al Caddy del VPS (se corre EN el VPS; pide la contraseña de sudo):
#   bash ~/homeflix-servidor/scripts/caddy-agregar.sh
# Respalda el Caddyfile, mete Caddyfile.snippet dentro del bloque «scalvache.shop {» antes de su «handle {» final,
# valida y recarga. Si la validación falla, deja el Caddyfile como estaba. Si la ruta ya está, no hace nada.
set -euo pipefail
CF=/etc/caddy/Caddyfile
SNIP="$(dirname "$0")/../Caddyfile.snippet"

if sudo grep -q '@homeflix' "$CF"; then echo "La ruta de HomeFlix ya está en Caddy. Nada que hacer."; exit 0; fi

BK="$CF.backup-$(date +%Y%m%d-%H%M%S)-antes-de-homeflix"
sudo cp "$CF" "$BK"
echo "Respaldo: $BK"

TMP="$(mktemp)"
# Dentro del bloque «scalvache.shop {», justo antes de la primera línea «	handle {» (la que manda todo a NexusCard).
sudo awk -v snip="$SNIP" '
  BEGIN { while ((getline l < snip) > 0) if (l !~ /^#/) s = s l "\n" }
  /^scalvache\.shop[[:space:]]*\{/ { dentro = 1 }
  dentro && !hecho && /^[[:space:]]*handle[[:space:]]*\{/ { printf "%s", s; hecho = 1 }
  /^\}/ { dentro = 0 }
  { print }
  END { if (!hecho) exit 3 }
' "$CF" > "$TMP" || { echo "No encontré el bloque scalvache.shop con su handle final: no se cambió nada."; rm -f "$TMP"; exit 1; }

sudo cp "$TMP" "$CF"
rm -f "$TMP"
if sudo caddy validate --config "$CF" >/dev/null 2>&1; then
  sudo systemctl reload caddy
  echo "Listo: Caddy recargado con la ruta /productos/HomeFlix."
  curl -s --max-time 15 https://scalvache.shop/productos/HomeFlix/ && echo
else
  sudo cp "$BK" "$CF"
  echo "La configuración no pasó la validación: se dejó el Caddyfile como estaba."
  exit 1
fi
