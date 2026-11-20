#!/usr/bin/env bash
# Crea (o actualiza) el acceso de un colaborador al VPS, SOLO para publicar actualizaciones de HomeFlix. Se corre EN el VPS, con sudo:
#
#   sudo bash crear-colaborador.sh [--clave "ssh-ed25519 AAAA… nombre"] [--clave-archivo ruta.pub]   crea/actualiza (se puede repetir; agrega la llave)
#   sudo bash crear-colaborador.sh --reemplazar --clave "…"    deja SOLO esa llave (quita las anteriores); --sin-llaves las quita todas y deja la cuenta cerrada a la espera
#   … --vence 202611151230Z   (con --clave) la llave deja de servir sola a esa hora UTC (para pruebas)
#   sudo bash crear-colaborador.sh --quitar                                                         le quita el acceso (cierra la cuenta, borra sus llaves y el sudo)
#   sudo bash crear-colaborador.sh --quitar --borrar                                                además borra el usuario y su carpeta
#
# Qué crea (todo es idempotente):
#   - el usuario «deploycolab»: sin contraseña (solo entra con llave), sin sudo general, sin docker, sin grupo «deploy».
#   - /usr/local/sbin/homeflix-colab (dueño root): lo único que su llave puede ejecutar; ver servidor/scripts/colab/homeflix-colab.
#   - /etc/sudoers.d/homeflix-colab: deja a deploycolab correr ESE programa, y solo ese, como el usuario «deploy».
#   - ~deploycolab/.ssh/authorized_keys (dueño root, para que él no lo cambie): «restrict,command=…» antes de cada llave: sin consola, sin sftp,
#     sin reenvío de puertos ni de agente.
# No toca Caddy, ni el contenedor, ni el .env, ni los demás proyectos del VPS.
set -euo pipefail

USUARIO=deploycolab
DUENO=deploy
PROG=/usr/local/sbin/homeflix-colab
SUDOERS=/etc/sudoers.d/homeflix-colab
AQUI="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Corre este script con sudo: sudo bash $0 $*"; exit 1; fi
id "$DUENO" >/dev/null 2>&1 || { echo "No existe el usuario $DUENO."; exit 1; }

QUITAR=0; BORRAR=0; REEMPLAZAR=0; VENCE=""; CLAVES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --quitar) QUITAR=1 ;;
    --borrar) BORRAR=1 ;;
    --reemplazar) REEMPLAZAR=1 ;;
    --vence) shift; VENCE="${1:?falta la fecha (AAAAMMDDHHMMZ, hora UTC)}" ;;
    --sin-llaves) REEMPLAZAR=1 ;;
    --clave) shift; CLAVES+=("${1:?falta la llave}") ;;
    --clave-archivo) shift; while IFS= read -r l; do [ -n "$l" ] && CLAVES+=("$l"); done < "${1:?falta el archivo}" ;;
    *) echo "Opción desconocida: $1"; exit 2 ;;
  esac
  shift
done

if [ "$QUITAR" = 1 ]; then
  if id "$USUARIO" >/dev/null 2>&1; then
    passwd -l "$USUARIO" >/dev/null 2>&1 || true
    usermod -s /usr/sbin/nologin "$USUARIO" || true
    rm -rf "/home/$USUARIO/.ssh"
    pkill -KILL -u "$USUARIO" 2>/dev/null || true
  fi
  rm -f "$SUDOERS"
  if [ "$BORRAR" = 1 ] && id "$USUARIO" >/dev/null 2>&1; then userdel -r "$USUARIO" 2>/dev/null || true; fi
  echo "Acceso de $USUARIO cerrado: sin llaves, sin sudo, sin shell."
  [ "$BORRAR" = 1 ] && echo "(el usuario y su carpeta se borraron)"
  exit 0
fi

# 1. el programa (dueño root)
bash -n "$AQUI/homeflix-colab" || { echo "homeflix-colab tiene un error de sintaxis; no se instala."; exit 1; }
for c in jq flock tar sha256sum logger; do command -v "$c" >/dev/null || { echo "Falta el comando «$c» en el VPS (apt install jq util-linux)."; exit 1; }; done
install -o root -g root -m 755 "$AQUI/homeflix-colab" "$PROG"
echo "Programa: $PROG"

# 2. el usuario
if ! id "$USUARIO" >/dev/null 2>&1; then
  useradd -m -s /bin/bash -c "HomeFlix colaborador (solo actualizaciones)" "$USUARIO"
  echo "Usuario creado: $USUARIO"
else
  usermod -s /bin/bash "$USUARIO"   # por si una vez se cerró: la llave forzada necesita una shell para correr el programa
  echo "Usuario ya existía: $USUARIO"
fi
passwd -l "$USUARIO" >/dev/null 2>&1 || true
# ningún grupo extra: sin sudo general, sin docker, sin «deploy»
for g in $(id -nG "$USUARIO"); do
  case "$g" in "$USUARIO") ;; *) gpasswd -d "$USUARIO" "$g" >/dev/null 2>&1 || true ;; esac
done

# 3. el sudo: solo el programa, solo como «deploy»
TMP="$(mktemp)"
printf '# HomeFlix: el colaborador solo puede correr el programa de actualizaciones, como «%s».\n%s ALL=(%s) NOPASSWD: %s\n' "$DUENO" "$USUARIO" "$DUENO" "$PROG" > "$TMP"
visudo -cf "$TMP" >/dev/null || { rm -f "$TMP"; echo "El archivo de sudo no pasó la validación; no se instala."; exit 1; }
install -o root -g root -m 440 "$TMP" "$SUDOERS"; rm -f "$TMP"
echo "Sudo: $SUDOERS"

# 4. las llaves (dueño root: el colaborador no las puede cambiar)
SSHDIR="/home/$USUARIO/.ssh"
mkdir -p "$SSHDIR"
chown root:root "$SSHDIR"; chmod 755 "$SSHDIR"
AK="$SSHDIR/authorized_keys"
touch "$AK"
[ "$REEMPLAZAR" = 1 ] && : > "$AK"
for k in "${CLAVES[@]:-}"; do
  [ -n "$k" ] || continue
  printf '%s\n' "$k" | grep -qE '^(ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/=]+( .*)?$' || { echo "Esa llave pública no tiene el formato esperado: $k"; exit 1; }
  printf '%s\n' "$k" > "$TMP.pub"; ssh-keygen -lf "$TMP.pub" >/dev/null 2>&1 || { rm -f "$TMP.pub"; echo "ssh-keygen no reconoce esa llave."; exit 1; }
  rm -f "$TMP.pub"
  opciones="restrict"
  [ -n "$VENCE" ] && opciones="$opciones,expiry-time=\"$VENCE\""   # la llave deja de servir sola a esa hora (útil para pruebas)
  linea="$opciones,command=\"$PROG\" $k"
  grep -qxF "$linea" "$AK" || printf '%s\n' "$linea" >> "$AK"
  echo "Llave agregada: $(printf '%s\n' "$k" | ssh-keygen -lf /dev/stdin 2>/dev/null || echo ok)"
done
chown root:root "$AK"; chmod 644 "$AK"
echo "Llaves autorizadas: $(grep -c . "$AK")"

# 5. prueba por dentro: el mismo camino que seguirá su llave (usuario → sudo → programa)
echo; echo "== Prueba (orden «estado», como lo haría deploycolab)"
sudo -u "$USUARIO" env SSH_ORIGINAL_COMMAND=estado "$PROG" 2>&1 | head -25 || { echo "La prueba falló."; exit 1; }
echo
echo "Listo. Para entrar: ssh -i <su llave privada> $USUARIO@$(hostname -I 2>/dev/null | awk '{print $1}') estado"
[ "$(grep -c . "$AK")" -gt 0 ] || echo "Todavía no hay llaves: pídele su llave pública (ssh-keygen -t ed25519) y corre este script con --clave \"…\"."
