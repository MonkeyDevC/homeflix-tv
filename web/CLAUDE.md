# HomeFlix web (`web/`)

La versión web de HomeFlix **no tiene pantallas propias**: usa las mismas del resto de la app, para que el diseño
aprobado sea uno solo.

| Dónde se abre | Qué carga `web/index.html` |
|---|---|
| Celular y tablet (y el computador con `?movil=1`) | Las pantallas de `mobile/` (`m.js`, `m.css`, `icons.js`): **las mismas del APK de Android** |
| Computador (≥1024 px y mouse) | Redirige a la raíz: **las pantallas de la TV** (se manejan con mouse y teclado) |

La elección la hace `js/responsive-web.js` (también al redimensionar la ventana). El tema «Plaza Celeste» del celular vive en `mobile/themes.js` y `mobile/themes.css`.

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

## Lo que aporta solo la web
- `ios.js` (antes del motor): Safari de iPhone no tiene `MediaSource`, solo `ManagedMediaSource` (iOS 17.1+). Se le dice al motor que «MediaSource» es esa y el `video.src = blob:` se redirige a un `<source>` con `disableRemotePlayback` (como hace hls.js). iPad y PC ya traen MediaSource: no hace nada. En un iPhone sin ninguna de las dos deja `window.HF_NO_VIDEO` y `play()` (mobile/m.js) avisa. **No probado en un iPhone real.**
- `instalar.js`: aviso para instalarla. iPhone/iPad (Safari): «Compartir → Agregar a inicio»; Chrome de iPhone: «ábrela en Safari»; Android/PC: botón nativo (beforeinstallprompt). Se recuerda 30 días si lo cierran; no sale si ya está instalada.
- `../js/web-pc.js` (solo con `?web=1`, o sea la TV en un computador): capa de mouse y trackpad **nativa** sobre el motor de la TV (que nació para control remoto: un foco que salta con las flechas y la pantalla se desplaza sola). La rueda/trackpad desplazan la página a píxel (`pageState`) y, de lado o con Shift, la fila bajo el puntero (`setTrackOffset`), sin mover el foco; las listas verticales con pista propia (p. ej. los chats de Ajustes) se recorren solas. Cada carrusel que desborda lleva botones ‹ › al pasar el mouse. Hay barra de desplazamiento propia (arrastrable). Pasar el mouse resalta la tarjeta (con inclinación 3D) pero no desplaza nada: el motor se «silencia» (`quiet`) envolviendo `scrollTrack` / `scrollPage`. Re Pág, Av Pág, Inicio, Fin y Espacio recorren la página; el 4.º botón del mouse es «atrás». Las flechas del teclado siguen moviendo el foco como en la TV.
- **Ancho de la ventana (PC):** la interfaz de la TV es un lienzo de 1920×1080. En la TV se escala para caber entero; en la web (`?web=1`) y con una ventana más ancha que 16:9, `fitToWindow()` (js/ui/app.js) deja que la altura mande y ENSANCHA el lienzo con la variable `--W` (ancho de diseño en px) para no dejar franjas negras. Los anchos fijos de 1920 en `css/app.css` y `css/hf2.css` son `var(--W, 1920px)` (sin `--W`, o sea en la TV, valen 1920 como siempre). Si algo nuevo se pone a 1920px fijo, usar `var(--W, 1920px)`. En ventanas más angostas que 16:9 quedan franjas arriba y abajo.
- **Efectos completos en el computador:** la TV usa efectos livianos (su navegador es lento: el destacado cambia con un fundido). En la web de computador (`data-web="pc"`, `richFx()` en js/ui/library.js) hay GPU de sobra y el destacado vuelve a usar «Circle blur» (círculo que crece desde el selector + desenfoque, 700 ms), igual que el celular y el APK. La vista previa en video del destacado va sin sonido hasta que la persona toque la página (política de autoplay del navegador). El celular/tablet/iPhone ya usan `mobile/`, que trae esos efectos. **Tarjetas:** la que tiene el foco se inclina en 3D hacia donde apunta el mouse (hasta ±6° / ±4,5°), lleva un brillo que sigue al puntero y una sombra más profunda con halo dorado (`css/app.css`, bloque `html[data-web="pc"]`; la inclinación la calcula `js/web-pc.js` con las variables `--rx --ry --gx --gy`). Si se agrega otro efecto pesado, ponerlo detrás de `richFx()` para que la TV siga liviana.
- Tablet (≥ 700 px): reglas al final de `mobile/m.css` (destacado más bajo, rejillas con más columnas, botones sin estirar). Valen también para el APK en una tablet.

## Armar el sitio para subirlo

```bash
node tools/build-web.mjs   # → dist/web/ (clave de Telegram inyectada desde .env; se niega a armar si no hay clave)
```

La raíz (`index.html`) abre la TV con mouse; `/web/` abre el celular y la instalación como app. Hay que subirlo tal cual a un hosting con **HTTPS**
(Telegram no funciona sin él). Al subir una versión nueva, sube `VERSION` en `sw.js`. Hosting y dominio: por decidir.

## Siguiente

1. Probar en un iPhone real: instalar desde Safari, iniciar sesión, reproducir (el ajuste de `ios.js` es lo más arriesgado) y el giro/pantalla completa.
2. Probar en un computador con una cuenta real: biblioteca, reproducción, teclado y mouse.
3. Elegir hosting con HTTPS y publicar `dist/web/` (confirmar antes con el dueño: es subir algo hacia afuera).
4. Pulir la TV con mouse a pantallas muy anchas o muy bajas (hoy escala toda la pantalla por el ancho).
