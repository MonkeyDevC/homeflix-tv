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

En un iPhone de la misma red: `http://<ip-de-tu-compu>:5173/web/`. El service worker solo se activa con HTTPS o en
localhost; para probar «Agregar a inicio» completo usa un túnel HTTPS.

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

## Siguiente

1. Computador: adaptar las pantallas de la TV al mouse (hover, scroll, ancho fluido) sin cambiar su diseño.
2. Publicar la web (sitio estático con HTTPS) con la clave inyectada al armarla, como `tools/build-wgt.mjs`.
