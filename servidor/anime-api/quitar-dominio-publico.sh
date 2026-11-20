#!/usr/bin/env bash
# Quita anime.homeflix.fun del Caddyfile: la anime-api deja de tener dominio público (solo la alcanza el servidor de
# HomeFlix por la red privada «anime-interna»). Con copia de seguridad y validación; si falla, restaura. Ejecutar como root.
set -euo pipefail

CF=/etc/caddy/Caddyfile
if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta este script como root"; exit 1; fi
if ! grep -q "^anime\.homeflix\.fun" "$CF"; then echo "No hay bloque de anime.homeflix.fun en $CF: nada que quitar."; exit 0; fi

BK="$CF.backup-$(date +%Y%m%d-%H%M%S)-antes-de-quitar-anime"
cp -a "$CF" "$BK"
echo "Backup: $BK"

TMP="$(mktemp)"
awk '
  /^# anime-api/ { skip=1; next }
  skip && /^anime\.homeflix\.fun[ ]*\{/ { inblock=1; next }
  inblock { if ($0 ~ /^\}/) { inblock=0; skip=0 } ; next }
  skip { skip=0 }
  /^anime\.homeflix\.fun[ ]*\{/ { inblock=1; next }
  { print }
' "$CF" > "$TMP"
cp "$TMP" "$CF"
rm -f "$TMP"

if caddy validate --config "$CF" --adapter caddyfile; then
  systemctl reload caddy
  echo "Listo: anime.homeflix.fun ya no existe en Caddy."
else
  echo "Validacion FALLO: restaurando backup"
  cp -a "$BK" "$CF"
  exit 1
fi
