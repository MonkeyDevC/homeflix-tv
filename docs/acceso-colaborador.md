# Acceso de un colaborador al VPS (solo actualizaciones de HomeFlix)

Un colaborador que publica versiones de HomeFlix (TV, celular, preparador y web) entra al VPS con el usuario **`deploycolab`**. No es un
«segundo deploy»: **no tiene consola**, ni `sudo` general, ni docker, ni acceso al código del servidor, a Caddy, al `.env` ni a los otros
proyectos del VPS (NexusPOS, NexusCard, Neto…). Su llave SSH solo sirve para correr un programa fijo, `homeflix-colab`, con estas órdenes:

| Orden (se manda con `ssh deploycolab@VPS <orden>`) | Qué hace |
|---|---|
| `estado` | Versión vigente, versiones subidas, web activa y si el contenedor `homeflix` está sano. |
| `ota-subir <v> [forzar]` | Sube la carpeta de una versión (`web-<v>.json`, `homeflix-<v>.wgt/.apk`, `preparador-<v>.zip`, `instalar-preparador.cmd`). No pisa la versión vigente sin `forzar`. |
| `ota-actual` | Pone `actual.json` (la versión que ven las apps). Solo si todo lo que nombra existe y su sha256 coincide. |
| `ota-revertir` | Vuelve al `actual.json` anterior. |
| `web-subir` | Sube `dist/web` a `~/homeflix-web/releases/<fecha>` y la activa de golpe (homeflix.fun). |
| `web-revertir` | Vuelve a la versión anterior de la web. |

Todo lo que se sube se revisa antes de tocar nada: solo archivos normales (nada de enlaces ni rutas con `..` ni archivos ocultos), nombres
permitidos, tamaño máximo (200 MB una versión, 150 MB la web) y un solo trabajo a la vez. Cada orden queda en el registro del VPS con hora e IP:
`journalctl -t homeflix-colab`.

> **Ojo con lo que sí puede:** publicar una versión significa que el código de la interfaz (`web-<v>.json`) y los programas (.wgt/.apk) llegan a las
> TV y celulares de los usuarios. Es la confianza que se le da a quien publica; por eso el servidor (código y contenedor) queda fuera de su alcance
> y siempre se puede volver atrás (`ota-revertir`, `web-revertir`).

## Para el colaborador (en su PC)

1. Genera su llave (una sola vez) y le manda al dueño **solo el archivo `.pub`**:
   ```
   ssh-keygen -t ed25519 -f %USERPROFILE%\.ssh\homeflix_colab -C "su-nombre"
   ```
2. Cuando el dueño le confirme que quedó activa, configura (PowerShell):
   ```
   setx HOMEFLIX_HOST deploycolab@187.77.20.217
   setx HOMEFLIX_KEY  "%USERPROFILE%\.ssh\homeflix_colab"
   ```
   (cierra y abre la terminal). Necesita además su propio `.env` con las claves de Telegram del proyecto para armar las versiones (el dueño se las pasa por otro medio).
3. Publicar una versión: `node tools/publicar-version.mjs 1.1.120 --notas "Qué cambió" --subir` (usa solamente `ota-subir` y `ota-actual`).
   Volver a subir la versión que ya es la vigente: agrega `--forzar`. Volver atrás: `ssh -i %HOMEFLIX_KEY% %HOMEFLIX_HOST% ota-revertir`.
4. Subir la web: `node tools/build-web.mjs` y luego `bash servidor/scripts/subir-web.sh` (`--rollback` vuelve a la anterior; `--dry-run` solo cuenta los archivos).
5. Ver cómo está todo: `ssh -i %HOMEFLIX_KEY% %HOMEFLIX_HOST% estado`.

## Para el dueño (en el VPS)

Todo con sudo, desde `~/homeflix-servidor/scripts/colab/` (se sube con `servidor/scripts/desplegar.sh` o a mano):

```
sudo bash crear-colaborador.sh --clave "ssh-ed25519 AAAA… nombre"     # crea el acceso o agrega la llave
sudo bash crear-colaborador.sh --reemplazar --clave "ssh-ed25519 …"   # deja SOLO esa llave
sudo bash crear-colaborador.sh --sin-llaves                           # cierra la entrada y la deja esperando una llave nueva
sudo bash crear-colaborador.sh --quitar [--borrar]                    # le quita todo el acceso (y borra el usuario con --borrar)
```

Qué instala: el usuario `deploycolab` (sin contraseña, sin grupos extra), `/usr/local/sbin/homeflix-colab` (dueño root), `/etc/sudoers.d/homeflix-colab`
(solo ese programa, solo como `deploy`) y `~deploycolab/.ssh/authorized_keys` (dueño root, con `restrict,command="…"`: sin consola, sftp, puertos ni agente).

Pruebas del programa (no tocan el VPS): `bash servidor/test/colab.sh` en Linux/WSL (con `jq`, `tar` GNU y `flock`).
