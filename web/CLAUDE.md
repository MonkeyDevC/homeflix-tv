# HomeFlix web (`web/`)

Versión web de HomeFlix, **primero para celular (iPhone)**, instalable desde Safari como app (PWA).
Tablet (≥768 px) y escritorio (≥1280 px, con el diseño de la TV) vienen en otra fase.

## Estado actual

- **Conectada al motor real de Telegram** (el mismo de la TV y el celular). `web/index.html` carga como scripts
  clásicos `../js/tg.bundle.js`, `config.js`, `telegram.js`, `library.js`, `sync.js`, `engine/*` y `playback.js`
  (globales `HFTelegram`, `HFLibrary`, `HFSync`, `HFPlayback`) antes de los módulos de la web.
- `web/js/data/` es un **adaptador**: las pantallas siguen usando la forma de datos de la web, pero por dentro todo
  sale del motor, con las **mismas claves** de título y de video que la TV y el celular:
  - `data/library.js` → arma la biblioteca con `HFLibrary.build` y la traduce (`t.video` = el video «de identidad»
    que usa el motor para el progreso). Perfiles, PIN, chats por perfil (`{id: título}`), progreso y Mi lista se
    guardan con el motor, así se sincronizan (`homeflix-sync.json` en Mensajes guardados, `js/sync.js`).
    Las preferencias (calidad, siguiente capítulo) son de cada dispositivo. `realEntry(key)` da la entrada real.
  - `data/playback.js` → con la cuenta real usa `HFPlayback` (video de verdad, partes, calidad automática, audio y
    subtítulos); necesita `#playerVideo`, `#playerSub`, `#playerSubTop` y `#playerSubPic` (los pone `ui/player.js`).
  - `data/art.js` → miniaturas de Telegram (`HFTelegram.image`); las portadas dibujadas son solo de la demostración.
  - `data/demo-items.js` → títulos inventados para la cuenta «demo» y el tablero (`?design=`).
- **Inicio de sesión real** (`ui/access.js`): QR (`HFTelegram.loginQr`), número y código (`sendCode` / `signInCode`)
  y contraseña de dos pasos (`signInPassword`). «Probar con datos de demostración» sigue disponible.
- Ajustes: los chats de la cuenta (`HFTelegram.dialogs`) con su interruptor por perfil; «Sincronizar ahora» los relee.
- Para que la web tenga la clave de Telegram, el servidor la inyecta desde `.env` (`TG_API_ID`, `TG_API_HASH`) en
  `js/config.js`; sin clave, los botones de entrar avisan. **Nunca** se sube `.env` ni se escribe la `api_hash`.
- Si cambias el motor (`js/*.js` fuera de `web/`), corre `node tools/test-library.mjs` y avisa en el PR: lo usan la
  TV y el celular. `node tools/test-web.mjs` prueba el adaptador contra el motor real (`tools/web-engine.mjs`).

## Cómo correrlo

```bash
node tools/serve.mjs            # http://localhost:5173/web/
# sin Node: python3 -m http.server 5173   (desde la raíz del repo)
node tools/test-web.mjs          # pruebas de la biblioteca
# sin Node, con el motor de Safari:
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tools/test-web.mjs
```

Cada vista se puede abrir sola con `?design=<vista>` (mismos nombres que la TV y el celular):
`login`, `login-qr`, `login-phone`, `login-code`, `login-password`, `profiles`, `profile-edit`, `pin`,
`home`, `movies`, `series`, `mylist`, `categories`, `search`, `detail-movie`, `detail-series`,
`sheet-quality`, `sheet-tracks`, `player`, `player-next`, `settings`, `account`, `guide`.
El modo tablero usa una cuenta en memoria (`design`) y no pisa la sesión guardada.

Probar en el simulador de iOS (con Xcode):
```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl boot "iPhone 18 Pro"; open -a Simulator
xcrun simctl openurl booted "http://127.0.0.1:5173/web/?design=home"
```
En un iPhone real: misma red, `http://<ip-de-tu-compu>:5173/web/`. El service worker (instalación y
uso sin conexión) solo se activa con HTTPS o en localhost; para probar «Agregar a inicio» completo usa un túnel HTTPS.

## Reglas

- Todo el código web va en `web/`. **No tocar** los archivos de la TV (`index.html`, `css/`, `js/` de la raíz).
- JS moderno (ES2020+, módulos), **sin framework, sin bundler, sin paquetes npm**.
- Las vistas son funciones que devuelven `{ html, mount?, cls, tab?, chrome? }`; `mount` puede devolver una función de limpieza.
- Un solo estado pequeño en `js/state.js` (cuenta, perfil, biblioteca, ruta).
- Textos en español, de tú, cortos, sin palabras técnicas. Íconos SVG en línea (`js/icons.js`), trazo 2, puntas redondeadas.
- Colores y medidas: variables de `:root` en `w.css` (paleta compartida: `--bg`, `--gold-1`, `--gold-2`…).
- Respetar `prefers-reduced-motion`; imágenes perezosas (`hydrate()`); solo `transform`/`opacity` en animaciones largas.
- Nunca subir secretos (`.env`, `*.local.*`) ni escribir la `api_hash` de Telegram.
- Al cambiar archivos del cascarón, subir `VERSION` en `sw.js`.

## Detalles de iOS que no hay que romper

- `viewport-fit=cover` + `env(safe-area-inset-*)` en barra superior, pestañas, hojas y reproductor.
- La app instalada **no tiene botón atrás**: toda vista empujada lleva su flecha y se puede volver deslizando desde el borde izquierdo (`gestures.js`, solo en modo instalado; en Safari ya existe el gesto del navegador).
- Campos de texto con letra ≥16 px (si no, Safari hace zoom).
- `<video playsinline>`. En iPhone solo el `<video>` puede ir a pantalla completa (`webkitEnterFullscreen`).
- **Safari no reproduce MKV.** Para la conexión real, las versiones tienen que ser MP4 (H.264/HEVC + AAC); hay que tenerlo en cuenta en el preparador.
- `navigator.vibrate` no existe en iOS; no usarlo.
- Alturas con `dvh`/`svh`, no `vh`.

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Cascarón, metas de iOS, manifiesto |
| `manifest.webmanifest`, `sw.js`, `icons/` | Instalación (PWA) |
| `w.css` | Variables, componentes y vistas (primero celular) |
| `js/app.js` | Arranque, guardas, transiciones, modo `?design=` |
| `js/router.js` | Rutas por hash: `#/inicio`, `#/peliculas`, `#/series`, `#/mi-lista`, `#/buscar?q=`, `#/titulo/<titleKey>`, `#/ver/<key>?t=`, `#/perfiles`, `#/ajustes`… |
| `js/ui/*.js` | Vistas: `access`, `browse`, `detail`, `player`, `settings`, `sheets`, `components` |
| `js/gestures.js` | Deslizar para volver, tirar para actualizar |
| `js/data/*.js` | Motor de demostración (se reemplaza por el real) |

## Siguiente

1. Que el dueño apruebe las vistas de celular (cuando exista el tablero `design/`, agregar la columna WEB con estos `?design=`).
2. Tablet y escritorio.
3. Cambiar `js/data/*` por el motor real cuando esté en el repo (y agregar la entrada con número al motor).
