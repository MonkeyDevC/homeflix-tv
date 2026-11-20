# anime-api en el VPS

Contenedor de https://github.com/aryaniiil/anime-api para el canal «Anime» de HomeFlix.

- Vive en `~/anime-api` del VPS (el repo clonado + `Dockerfile`, `docker-compose.yml`, `.dockerignore` de esta carpeta).
- **Sin puerto publicado y sin dominio**: solo el contenedor `homeflix` la alcanza, por la red privada `anime-interna`
  (`ANIME_URL=http://anime-api:8000` en `servidor/docker-compose.yml`).
- El servidor de HomeFlix (`servidor/src/anime.js`) es la única puerta: valida la llave de la cuenta de cada app, pide
  el catálogo y los enlaces a la anime-api y devuelve direcciones de video **firmadas** (el reproductor no manda cabeceras).
- `quitar-dominio-publico.sh` (root) borra `anime.homeflix.fun` del Caddyfile, que se usó mientras se probaba la API
  detrás de una clave. El registro DNS `anime` ya no hace falta.

Orden para desplegar (en el VPS; la red y la anime-api van primero porque el compose de HomeFlix las espera):

1. `docker network create anime-interna`
2. `cd ~/anime-api && docker compose up -d --build` (con el `docker-compose.yml` de esta carpeta)
3. `bash servidor/scripts/desplegar.sh` (HomeFlix, con `ANIME_URL` y la red `anime-interna`)
4. como root: `bash quitar-dominio-publico.sh`

> **Temporal (2026-11-14):** `anime.homeflix.fun` se reabrió para pruebas (`poner-dominio-publico.sh`, root; el compose publica `127.0.0.1:4600`). Al terminar: `quitar-dominio-publico.sh` y quitar la sección `ports` del compose.
