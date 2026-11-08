# HomeFlix web (`web/`)

Versión web de HomeFlix, **primero para celular (iPhone)**, instalable desde Safari como app (PWA).
Tablet (≥768 px) y escritorio (≥1280 px, con el diseño de la TV) vienen en otra fase.

## Estado actual

- **Independiente, con datos de demostración.** El motor compartido que describe el plan
  (`js/telegram.js`, `js/library.js`, `js/playback.js`, `js/engine/*`, `mobile/`, `design/`) todavía
  **no está en este repo**. Mientras tanto, `web/js/data/` lo imita con los **mismos nombres de API**
  para poder cambiarlo después sin tocar la interfaz:
  - `data/library.js` → `HFLibrary` (parseCaption, composeCaption, build, filterKids, perfiles, PIN, progreso, Mi lista, nextEpisode, episodeAfter, formatos).
  - `data/playback.js` → `HFPlayback` (open, play, pause, toggle, seek, time, duration, close, tracks, setAudio, setSub, qualities, setQuality, `simulated`).
  - `data/art.js` → `HFTelegram.image(key)` (portadas SVG generadas; no hay imágenes con derechos).
  - `data/demo-items.js` → lo que devolvería `HFTelegram.scan()`: títulos inventados con comentarios en el formato real.
- El inicio de sesión (número, código, contraseña, QR) es solo diseño: cualquier dato entra a la demostración.

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
