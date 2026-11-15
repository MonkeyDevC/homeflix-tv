# HomeFlix · Preparador de videos

Versión **1.1.110** (la misma que se publica en el canal de actualizaciones de HomeFlix).

Programa para Windows que prepara películas y series para subirlas a Telegram y que HomeFlix las lea: crea las versiones 4K, 1080p, 720p y 360p,
corta lo que pasa del límite de Telegram, saca portadas, subtítulos y miniaturas, completa los datos con TMDB, publica en el grupo (con un tema por
película), importa desde grupos antiguos y migra lo ya publicado. Se abre en el navegador y solo escucha en este PC (127.0.0.1).

> Esta rama es solo el preparador (historia aparte del resto de la app). La app de la TV, el celular y la web viven en `main` y sus ramas.

## Cómo usarlo

1. Instala [Node.js](https://nodejs.org) y [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) (o corre `tools/preparador/instalar-preparador.cmd`, que los instala con winget,
   baja la última versión del canal oficial y deja accesos directos).
2. Doble clic en **`Preparar videos.cmd`** (o `node tools/preparador/server.mjs`). Se abre solo en el navegador.
3. La primera vez pide la clave de Telegram de HomeFlix (`TG_API_ID` y `TG_API_HASH`) y, si quieres datos automáticos, una de TMDB (`TMDB_API_KEY`):
   se guardan en un `.env` en tu PC, que **nunca** va al repositorio.

## Qué hay aquí

- `tools/preparador/` — el servidor y la interfaz (`server.mjs`, `ui.html`, `prepare.mjs`, `publish.mjs`, `cola.js`, `importar.js`, `temas.js`, `cache.js`, `subsync.js`…).
- `js/` — el motor de Telegram y la lectura de la biblioteca que comparte con la app (`tg.bundle.js`, `telegram.js`, `library.js`, `config.js` con la clave vacía).
- `tools/apikey.mjs` — lee las claves del `.env`.
- `tools/test-*.mjs` — pruebas del preparador (`node tools/test-corte.mjs`, `test-temas`, `test-preparador-cache`, `test-importar*`).

## Cómo se actualiza esta rama

Desde el proyecto principal: `node tools/rama-preparador.mjs --subir`. Toma los archivos de la versión vigente y agrega un commit
«Preparador de videos <versión>». El preparador instalado se actualiza solo desde su aviso «Versión nueva»; esta rama es la copia del código.
