# HomeFlix · contexto de trabajo (traspaso entre cuentas de Claude)

Última actualización: 2026-11-10 (cuenta «terminal», al retomar). Versión publicada: **1.1.41**.
Todo lo de abajo está en la carpeta del proyecto; **nada está en commit** desde `042ea12` (rama `android`): el usuario
no ha pedido commit.

## Cómo trabajar con el usuario

- **Responder siempre en español** (mensajes, resúmenes, botones).
- **El usuario no toca código ni corre comandos.** Yo dejo todo listo; él solo prueba en la TV, el celular y el
  preparador. Las instrucciones para él son «qué tocar», nunca comandos.
- **Toda actualización sale por el canal OTA**, no por cable:
  `node tools/publicar-version.mjs <x.y.z> --notas "…" --subir` (añadir `--programa` solo si cambió lo nativo: Java del
  APK o el arranque de la TV). Comprobar con `curl https://scalvache.shop/productos/HomeFlix/actualizaciones/v1`.
  La TV y el celular la toman solos (botón ↻ en la TV); el preparador instalado muestra «Versión nueva».
- Lo que va hacia afuera (SSH/desplegar al VPS, borrar mensajes del grupo) se confirma antes con el usuario.
- Claves: TG api_id/hash y TMDB solo en `.env` (nunca en el zip público ni en el chat).
- TMDB se usa **solo en el preparador** (uso interno), nunca en la TV ni el celular.

## Piezas

| Pieza | Dónde | Notas |
|---|---|---|
| TV (Tizen, .wgt) | `app.html`, `js/`, `js/ui/`, `js/arranque.js` | Interfaz bajada por OTA en IndexedDB, con vuelta atrás. |
| Celular (APK WebView) | `mobile/`, `android/` | `Actualizador.java` para OTA. |
| Servidor (VPS) | `servidor/` | https://scalvache.shop/productos/HomeFlix · sync, «Ver en la TV», canal de versiones. Desplegar con `servidor/scripts/desplegar.sh` (pedir permiso). |
| Preparador de videos | `tools/preparador/` | Renderiza calidades y publica en el grupo de Telegram «NETSUCKS». Instalado en `%LOCALAPPDATA%\HomeFlix\Preparador` (puerto 5180). El del proyecto se abre con la vista previa «preparador» de `.claude/launch.json` (puerto 5181). |

Formato de los comentarios en `docs/formato-comentarios.md`. Marcas que lee `js/library.js` al final del comentario:
`#Categoría`, `#infantil`, `#portada`/`#banner`, `#tmdb<id>`, `#miniaturas`, y las nuevas de idioma (abajo).

## Lo hecho en esta sesión (1.1.26 → 1.1.29)

1. **Audio y subtítulos muestran solo el idioma** («Español», «Inglés», «Español latino», «Español (forzados)»), nunca
   el nombre del archivo. La función es `HFLibrary.trackLabels` (`js/library.js`), compartida por TV, celular y
   preparador. Ignora marcas tipo «dual-lat» (son de todo el archivo, no de la pista).
2. **Corrector de idiomas sin volver a subir** (ficha del preparador → Idioma): detecta pistas sin idioma o cuyo nombre
   contradice su idioma y guarda la corrección en el comentario **de cada archivo** (cada calidad puede tener otras
   pistas): `#audio-x-eng` / `#subs-spa` (posición por pista, `x` = dejar la suya). La app la aplica por archivo
   (`vparts[].langs` en `js/playback.js`). Filtro «Idiomas por revisar» en el inicio del preparador.
3. **Subtítulos aparte = el estándar** (pedido explícito del usuario): un `.srt` por idioma, publicado una vez por
   película y compartido por **todas** las calidades.
   - Comentario: `pelicula#Nombre (2015) #subs-spa` (forzados: `#subs-spa-f`). Nombre de archivo
     `Nombre (2015).spa.srt`, `.eng.srt`, `.spa.forzados.srt`, `.eng.2.srt`.
   - `prepare.mjs` → `extractSubs`: ya **no** mete subtítulos dentro de los videos; los saca del original y de los `.srt`
     elegidos, en una sola pasada por archivo, y marca como forzados los que el original no marca (2.ª pista del mismo
     idioma con <20 % de las líneas).
   - La pestaña 4 y la cola (`cola.js`) los publican en el grupo «Subtítulos»; lo que ya está en el grupo no se repite.
   - App: `kind: "sub"` en `js/telegram.js`, `subFiles` por título/capítulo en `js/library.js`; en `js/playback.js` los
     aparte mandan y una pista incrustada del mismo idioma se oculta; los forzados solo se activan solos si son del
     idioma del audio; al cambiar de calidad se conserva el idioma elegido.
   - Ficha del preparador → «Subtítulos aparte»: lista, «＋ Subir un .srt», «Marcar/Quitar forzados» (edita el
     comentario), aviso si una calidad no trae un idioma que otra sí.
   - Pasar lo ya publicado: inicio del preparador → filtro **«Subtítulos por separar»** →
     «**Pasar con lo de este PC**» (usa originales o carpetas «- HomeFlix»; busca en las carpetas de la cola y en las
     agregadas con «＋ Carpeta…», reconoce la película por duración ±3 s) o «**Bajar y pasar todas**» (baja la versión
     más liviana con todos los idiomas; la borra al terminar). En la ficha: «Pasar aparte».
   - Descargas grandes del preparador: si C: tiene <8 GB libres van a la unidad con más espacio
     (`X:\HomeFlix Preparador (temporal)\del-grupo`). **El disco C: del usuario suele estar casi lleno.**

## Lo hecho por la otra cuenta (1.1.30 → 1.1.36, 2026-11-09 tarde)

Reconstruido comparando los paquetes publicados (la otra cuenta no dejó notas): **la app de TV y celular no cambió**
(solo `js/config.js`); todo fue en el preparador y en los datos del grupo (idiomas, catálogo, subtítulos).

- `tools/preparador/subsync.js` (nuevo, `HFSubSync`): ajusta los tiempos de un .srt a otro ya bueno (el español
  publicado): velocidad 23,976/24/25 y corrimiento hasta ±3 min, afinado por tramos de 4 min. Botón **«Ajustar al
  español»** en la ficha (solo si el .srt sale «desfasado»); reemplaza el .srt en el grupo.
- **Revisión de cada .srt aparte** (`checkSrt` en `biblioteca.js`): lo baja (pesa poco) y avisa si no es un .srt
  válido, está casi vacío, se corta antes del 75 % de la película, dura más que la película (es de otra versión),
  tiene tiempos rotos, letras dañadas (tildes/ñ) o no coincide con el español. Filtro **«Subtítulos con fallas»**.
- **Panel ES/EN** en cada tarjeta y en la ficha (`langPanel`, `langRow`): audio y subtítulos en español e inglés, con
  su origen («venía en la película» o «agregado»). Filtro **«Español e inglés»** (les falta alguno); «Completas» ahora
  exige 4 calidades, español, inglés e imágenes.
- Ficha → subtítulos aparte: descargar el .srt al equipo (`xs-dl`), quitarlo del grupo con confirmación (`xs-del`,
  borra el mensaje), nombre estándar al subir (`xsName`), esperas con tope de 45 s (`withTimeout`).
- Siguen «Subtítulos por separar» / «Pasar con lo de este PC» / «Bajar y pasar todas» de la 1.1.29.

## Renderizado todo en la GPU (1.1.37, 2026-11-10)

`prepare.mjs`: todas las calidades que se recodifican salen en **una sola pasada de ffmpeg** (`gpuAllArgs`): NVDEC lee
el original una vez, `split` reparte la imagen, cada calidad se escala con `scale_cuda` (lanczos) y se comprime con
NVENC a la vez. HDR→SDR: se achica en CUDA y solo el cuadro chico pasa a `libplacebo` (BT.2390, se ve mejor que el
hable de antes). El 4K que conserva HDR va en p010/Main 10 por CUDA. Salen archivos enteros y, si pasan del tope, se
cortan sin recodificar (`splitCopy`, cuadros clave cada 2 s). `canFullGpu(src)` prueba 1 s del archivo; si falla, se
usa el camino de siempre (una calidad tras otra). NVENC pasó de p6 a **p4** (+ multipass qres + AQ): misma calidad
(VMAF), ~30 % menos tiempo. `opts.gpuTotal=false` fuerza el camino viejo; `opts.limitBytesTest` solo para probar el corte.

Medido en la RTX 3050 del usuario (2 min de película): Iron Man 3 1080p → 720+360: 11,2 s → 6,2 s · Hoppers 4K 10 bits →
1080+720+360: 123,9 s → 19,8 s (6,3×) · HDR 4K → 1080+720: 31,7 s → 14,0 s. Con originales 1080p el límite es el
propio NVENC de la 3050 (~88 % de uso). Wallpaper Engine/Discord/Steam usan la GPU mientras renderiza.

**1.1.38 · Publicación (pestaña 4) → Portada y banner:** «Elegir…» abre las imágenes de TMDB de la película (`/api/buscar-imagenes`, mismo buscador que «Imágenes por revisar»; portada = con título primero, banner = sin texto primero); la foto es una zona para soltar una imagen propia (o tocarla para el explorador). Las dos guardan `portada.jpg`/`banner.jpg` en la carpeta de la película (`outDir` en `/api/imagen-url` e `/api/imagen-bytes`) para que la cola las encuentre. La franja «Viendo de la cola» se pega debajo del encabezado (`--hdrh`).

**1.1.41 · Reemplazar imagen con Telegram lento:** hoy cada llamada a Telegram tarda ~3,5 s (la ruta del usuario es lenta; el ping a Google es normal), así que subir+editar una foto toma 10–15 s. `ACT["img-replace"]` ahora muestra los segundos y un aviso a los 15 s, y a los 2 min comprueba con `getMessages` si la foto ya cambió (`editDate`) en vez de esperar sin fin.

**1.1.40 · Cola: portada y banner propios (2026-11-10):** al cargar varias películas por la cola, la primera dejaba su portada/banner a las demás (pasó con Jack Ryan en 6). Arreglo en 3 sitios: `ui.html` `loadSource` vacía `PUB.img` al cambiar de video; `server.mjs` `colaAgregar` no copia una imagen que ya viva en la carpeta de otra película de la cola; `biblioteca.js` marca «Repetida» (mismas medidas y peso) en «Imágenes por revisar». Solo cambia el preparador (el instalado lo toma con «Versión nueva»).

**1.1.39 · TV en vivo (IPTV), fase 1:** HomeFlix es solo el reproductor; cada cuenta pone el enlace M3U de su proveedor (no se incluyen listas). `js/iptv.js` (`HFIptv`: lee M3U con grupos, logos, `tvg-chno`, User-Agent de `#EXTVLCOPT`; caché 12 h en IndexedDB `hf-iptv`; `HFLive`: AVPlay en la TV vía `$WEBAPIS/webapis/webapis.js` en app.html, `<video>`+hls.js de CDN solo para probar en la PC). TV: `js/ui/live.js`, rutas `live` (grupos/canales) y `live-player` (▲▼/CH± cambian, números saltan, OK panel con ★ favorito, BACK lista); menú «TV en vivo» (oculto en Kids). Configuración en la cuenta (`HFLibrary.iptv/setIptv`, se sincroniza en `doc.iptv`); favoritos y último canal por perfil (`doc.p[pid].iptvfav`). Celular: solo Ajustes → TV en vivo para poner el enlace. Lista de prueba: `dev/iptv-prueba.m3u` (no se empaqueta). **Pendiente:** probar AVPlay en la TV real; fase 1b celular (necesita reproductor nativo ExoPlayer + `usesCleartextTraffic` + leer la lista desde Java por CORS → APK nueva); fase 2 guía EPG (XMLTV, `epg` ya se lee del `#EXTM3U`); fase 3 Xtream Codes.

**GPU en la nube (Hostinger), pendiente de decidir** de dónde salen los originales: la A100 y la B200 NO tienen NVENC (no
sirven); las útiles son RTX 4090 (2 NVENC, la más barata), RTX 5090 / L40S (3), RTX PRO 6000 (4). Para que valga la
pena, el servidor debe publicar directo en Telegram (hoy la subida pasa por el navegador) y bajar los originales por
link; subirlos desde la casa del usuario puede tardar más que renderizar aquí.

## Estado de «subtítulos aparte» (al 2026-11-09 13:10, antes de la otra cuenta — revisar el contador actual)

- **Pasadas (13):** Avengers 2, Incontrolable, Supergirl, Iron Man 1/2/3, Demon Slayer: Castillo del infinito,
  Five Nights at Freddy's 2, Coyote vs. Acme, Hoppers, Super Mario Galaxy, Zootopia 2, Scary Movie 6. En las 6 que
  traían forzados sin marcar (Coyote, Demon Slayer, FNAF 2, Scary Movie 6, Mario Galaxy, Zootopia 2) ya están como
  `#subs-spa-f`.
- **Pendientes (20), detenido a pedido del usuario:** Mortal Kombat II, TRON: Ares, Minions 3, Lindas y Letales,
  Carrera contra el Tiempo, Depredador: Cazador de Asesinos, El final de la Calle Oak, La astronauta, GOAT, El Corazón
  de la Bestia, Depredador: Tierras Salvajes, Intercambiados, Animales, Sólo por una Noche, La Noche del Demonio,
  La leyenda del Dragón Blanco, Outcome, Karate Kid: Leyendas, Spider-Man: No Way Home, Resident Evil: Noche Cero.
  Sus originales NO están en este PC (los tenía un compañero). Seguir solo cuando el usuario lo pida: «Bajar y pasar
  todas» (≈1–2 GB y 2–4 min por película) o, en el PC del compañero, «Pasar con lo de este PC».
- `dist/limpiar-temporales.ps1` quedó corriendo: tras 20 min sin actividad borra las carpetas temporales del preparador
  (`%LOCALAPPDATA%\Temp\homeflix-preparador\{del-grupo,subtitulos}`, `E:\HomeFlix Preparador (temporal)`) y deja
  `dist/limpiar-temporales.log`. Revisar el log; si quedó algo, borrarlo.

**TV en vivo, rediseño (sin publicar aún; después de la 1.1.41):** TV (`js/ui/live.js` + CSS al final de `css/app.css`): recuadro de vista previa
arriba a la izquierda (AVPlay con `setDisplayRect`; el recuadro es un «agujero» en la página: `.lv-hole` con box-shadow), lo que dan ahora
debajo, a la derecha pestañas de categoría («Destacado» = todos) y lista con logo · miniatura · título · «quedan Xm» · barra · ⓘ. OK abre
pantalla completa SIN cortar la señal (`HFLive.play` con el mismo canal solo reubica: `HFLive.place`); BACK vuelve al recuadro. Opciones
(OK en pantalla completa): Reiniciar · Favorito · Canales. Guía XMLTV (`HFIptv.loadEpg/now`, `url-tvg` de la M3U, solo los canales de la lista y
programas de -1 h a +14 h, caché 3 h; .gz con DecompressionStream) alimenta «quedan Xm»; sin guía la fila dice «En vivo · grupo».
La TV acepta `{t:"live", key}` del celular (`castLiveStart`). Celular (`mobile/m.js` bloque «TV en vivo», `mobile/m.css`): pestaña «TV en vivo» en la barra,
reproductor arriba (video DETRÁS de la interfaz, `#lvMedia`), pestañas, lista, pantalla completa (`setPlayerMode`), ⓘ, favoritos, enviar a la TV.
Probado en el navegador (`?design=live` en el celular; en la TV, `HFLibrary.setIptv(...)` + `openLive()` desde la consola de app.html).
Lista y guía de prueba: `dev/iptv-prueba.m3u` + `node dev/generar-epg.mjs`.
**Lo nativo YA ESTÁ escrito y compila (aprobado por el usuario; sin probar en un celular real ni publicado):** `MainActivity.java` (ExoPlayer `PlayerView` detrás del WebView transparente, `httpText` con gunzip y filtro de guía, PiP), `build.gradle` (media3 1.4.1, cleartext también en release), manifest (`supportsPictureInPicture`). Reglas: `usesCleartextTraffic` en release ahora es true. Para publicar: `node tools/publicar-version.mjs 1.1.42 --notas "…" --programa --subir` (confirmar con el usuario). Contrato original: en el APK 1.1.41 la página vive en https y no deja leer la M3U ni reproducir
http/sin CORS. Contrato que ya usa el JS (`js/iptv.js` HFLive, `mobile/m.js`): `HFAndroid.httpText(cbId, url)` → `HFNative.done(cbId, {ok, text})` (con gunzip si
es .gz, User-Agent de VLC); `liveOpen(url, ua, ref, x, y, w, h)` (ExoPlayer DETRÁS del WebView transparente, px CSS), `liveRect(x,y,w,h)`, `liveStop()`,
`livePip()`; estados a la página con `HFNative.live("cargando"|"esperando"|"reproduciendo"|"error", detalle)`. Manifest: `usesCleartextTraffic` ya existe
(`${cleartext}`, revisar que sea true en release) + dependencia media3-exoplayer/hls. Sin eso el celular intenta `<video>`+hls.js (solo canales https con CORS).

## Pendiente / ideas

- **Probar en la TV y el celular reales** los subtítulos aparte (Avengers 2 en 1080p debe ofrecer Español e Inglés).
- Hoppers tiene «Inglés · 1» (1344 líneas) e «Inglés · 2» (2064, probablemente SDH): falta una etiqueta SDH
  (p. ej. marca `-sdh` o nombre `.eng.sdh.srt`) en `extractSubs`, `trackLabels` y el preparador.
- Series: el corrector de idiomas y los subtítulos aparte solo cubren películas (el formato ya admite
  `serie(T/E)#Nombre #subs-spa`, falta la interfaz).
- Traducción gratis de subtítulos: el usuario baja el `.srt` en español («⬇ .srt» en la pestaña 2), me lo pasa por el
  chat y le devuelvo `Nombre.eng.srt` con los mismos números y tiempos; luego lo publica con «＋ Subir un .srt».
- Pendiente de antes: el «generador» de contenido del preparador (tira de miniaturas para «Recortar» del celular).
- Diseño del preparador: lienzo https://claude.ai/artifact/7V1vQaA6FXieuZaf1XBk35 (se itera ahí y luego se pasa a
  `tools/preparador/ui.html`).

## Trucos y trampas conocidas

- El grupo NETSUCKS pasó de grupo básico (-5479575394) a supergrupo (-1004437120043); `migratedFrom()` lee los dos.
- Solo el autor de un mensaje puede editar su comentario (MESSAGE_AUTHOR_REQUIRED): para los de otra cuenta, `sendCopy`
  sin remitente y borrar el viejo (el progreso visto de ese video no pasa al nuevo).
- Telegram recorta nombres de archivo de más de ~50 letras: lo que la app lee del nombre va al final pero en nombres
  ≤48 letras (`tgName`/`tgShort` en `ui.html`).
- Los `.cmd` del preparador deben ir con CRLF (`publicar-version` los normaliza).
- Escribir scripts de edición en archivos `.cjs` (no `node -e` desde bash): las barras invertidas de las regex se
  pierden.
- Depurar el celular: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` y evaluar JS por CDP.
  Copiar .wgt/.apk a `Download/Homeflix` del celular por adb y reescanear MediaStore (ver historial).
- Instalar algo en el Windows real: dejar un `.cmd` en la carpeta del proyecto y que el usuario le dé doble clic (los
  comandos de Claude corren en un sandbox).
