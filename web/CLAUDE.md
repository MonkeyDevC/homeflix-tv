# HomeFlix web (`web/`)

La versión web de HomeFlix **no tiene pantallas propias**: usa las mismas del resto de la app, para que el diseño
aprobado sea uno solo.

| Dónde se abre | Qué carga `web/index.html` |
|---|---|
| Celular y tablet (y el computador con `?movil=1`) | Las pantallas de `mobile/` (`m.js`, `m.css`, `icons.js`): **las mismas del APK de Android** |
| Computador (≥1024 px y mouse) | Redirige a la raíz: **las pantallas de la TV** (se manejan con mouse y teclado) |

Lo propio de la web es solo la **instalación como app** (PWA): `index.html` (metas de iPhone, `viewport-fit=cover`),
`manifest.webmanifest`, `sw.js` e `icons/`.

> Antes la web tenía pantallas propias (`web/js/`, `w.css`) con otro diseño. Se retiraron para no mantener dos
> diseños del celular: lo que se mejore en `mobile/` queda igual en el APK y en la web. Están en el historial de git.

## Cómo funciona

- **Motor compartido** (el mismo de la TV y el celular), cargado como scripts clásicos en `index.html`:
  `../js/tg.bundle.js`, `config.js`, `telegram.js` (`HFTelegram`), `library.js` (`HFLibrary`), `sync.js` (`HFSync`),
  `engine/*` y `playback.js` (`HFPlayback`).
- **Inicio de sesión real:** número y código, contraseña de dos pasos o QR desde otro dispositivo (`mobile/m.js`).
- **Biblioteca, Mi lista, progreso y perfiles:** los mismos que en la TV y el APK; se sincronizan por
  `homeflix-sync.json` en los Mensajes guardados de la cuenta (`js/sync.js`).
- **Reproductor:** video real (`HFPlayback`). En el navegador pide pantalla completa y giro a horizontal donde se
  pueda (`playerMode()` en `mobile/m.js`); en el APK eso lo hace la parte nativa (`window.HFAndroid`).
- **Clave de Telegram:** el servidor la inyecta desde `.env` (`TG_API_ID`, `TG_API_HASH`) en `js/config.js`.
  **Nunca** se sube `.env` ni se escribe la `api_hash`.

## Cómo correrlo

```bash
node tools/serve.mjs     # http://localhost:5173/web/   (celular: ?movil=1 en el computador)
node tools/test-library.mjs
```

**Ábrelo siempre con `localhost`** en el mismo equipo. Telegram necesita WebCrypto y el navegador solo lo da con
https o en `localhost` / `127.0.0.1`: por `http://<ip>:5173` sale «Telegram necesita una conexión segura»
(antes: «WebCrypto is not available»).

Desde **otro dispositivo** (iPhone, Android, otro computador de la misma red):

```bash
node tools/serve.mjs --https     # https://<ip-de-tu-compu>:5173/web/  (crea un certificado propio en .cert/)
```

El navegador avisa que el certificado no es de confianza: «Avanzado → continuar» (en iPhone: «Mostrar detalles →
visitar este sitio web»). Con https también funciona «Agregar a inicio» y el service worker.

## Cómo cambiar el diseño

1. Se diseña en el tablero (`design/`): cada vista del celular se abre con `mobile/?design=<vista>`.
2. El dueño aprueba en el tablero.
3. Se programa en `mobile/` (un solo lugar para el APK y la web).

Vistas: `login`, `login-code`, `login-password`, `login-qr`, `profiles`, `profile-edit`, `pin`, `home`, `movies`,
`series`, `mylist`, `categories`, `search`, `detail-movie`, `detail-series`, `sheet-quality`, `sheet-tracks`,
`player`, `player-next`, `settings`, `account`.

## Reglas

- La web no lleva pantallas propias: cualquier cambio de diseño va en `mobile/` (celular) o en la raíz (TV).
- Sin framework, sin bundler, sin paquetes npm. Textos en español, de tú, cortos.
- Si cambias el motor (`js/*.js`), corre `node tools/test-library.mjs`: lo usan la TV, el APK y la web.
- Al cambiar archivos que guarda el service worker, subir `VERSION` en `sw.js`.

## Detalles de iPhone que no hay que romper

- `viewport-fit=cover` y márgenes con `env(safe-area-inset-*)` (en `mobile/m.css`: `--safe-top`, `--safe-bottom`).
- Campos de texto con letra ≥16 px (si no, Safari hace zoom).
- `<video playsinline>`. En iPhone el navegador no deja poner la página entera a pantalla completa.
- **Safari no reproduce MKV:** las versiones tienen que ser MP4 (H.264/HEVC + AAC).
- `navigator.vibrate` no existe en iOS.

## Computador (pantallas de la TV con `?web=1`)

Todo lo propio del computador va marcado como versión web, para que la TV no cambie:

- `index.html` pone `data-web="pc"` en `<html>` si hay `?web=1`, y solo entonces carga `js/ui/web-pc.js`.
- **Llenar la ventana:** `fitToWindow()` (`js/ui/app.js`) mantiene la escala de la TV y estira el lienzo a la forma de
  la ventana (`--app-w` / `--app-h`, sin franjas negras). Reglas en `css/app.css` bajo `html[data-web="pc"]`.
- **Mouse** (`js/ui/web-pc.js`): pasar el mouse enfoca sin mover filas ni la página · rueda = ▲ ▼ entre filas ·
  rueda de lado o Shift + rueda desliza la fila · flechas ‹ › en cada fila avanzan una página · botón atrás del mouse = Esc.
- **Reproductor:** mover el mouse muestra los controles (y el cursor) · clic en el video pausa · botón de pantalla
  completa abajo a la derecha (o doble clic, o F; el ícono cambia al entrar o salir) · clic o arrastrar en la barra para saltar · ‹ de arriba sale · Espacio/K, J/L (±10 s), F, M.
- **Igual que el celular:** al abrir un video, fondo negro y el oso de HomeFlix en un anillo que gira (sin la portada
  ampliada). «Volver» de la ficha se puede tocar. **Sin «Editar»** (ficha y reproductor): editar queda solo en la TV.
  En el código: `WEB_PC` (`js/ui/core.js`).
- En la TV (sin `?web=1`) nada de esto se carga: el lienzo sigue en 1920×1080.

## Siguiente

1. Publicar la web (sitio estático con HTTPS) con la clave inyectada al armarla, como `tools/build-wgt.mjs`.
