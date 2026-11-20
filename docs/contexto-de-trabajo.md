# HomeFlix · contexto de trabajo (traspaso entre cuentas de Claude)

Última actualización: 2026-11-14. Versión publicada: **1.1.96** (canal Anime, ver su sección; antes **1.1.72** (solo preparador: calidades marcadas solas si ninguna cabe (botones de la cola ya no se apagan); en la 1.1.71: aviso «Reiniciar/Recargar ahora» cuando la ventana quedó con la versión anterior tras actualizar; en la 1.1.70: botón «⚡ Probar velocidad de subida» en la cola, rescate de «publicando» huérfano, progreso de publicación compartido e imágenes repetidas; antes, en la 1.1.69: inicio de sesión con sesión dañada y una sola pestaña, cola sin duplicados y con un clic, formulario en blanco al encolar y aviso de película repetida).
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
- TMDB se usa **solo en el preparador y en el motor de recomendaciones del VPS** (`recomendador/`), nunca en la TV ni el celular.

## Piezas

| Pieza | Dónde | Notas |
|---|---|---|
| TV (Tizen, .wgt) | `app.html`, `js/`, `js/ui/`, `js/arranque.js` | Interfaz bajada por OTA en IndexedDB, con vuelta atrás. |
| Celular (APK WebView) | `mobile/`, `android/` | `Actualizador.java` para OTA. |
| Servidor (VPS) | `servidor/` | https://scalvache.shop/productos/HomeFlix · sync, «Ver en la TV», canal de versiones. Desplegar con `servidor/scripts/desplegar.sh` (pedir permiso). |
| Preparador de videos | `tools/preparador/` | Renderiza calidades y publica en el grupo de Telegram «NETSUCKS». Instalado en `%LOCALAPPDATA%\HomeFlix\Preparador` (puerto 5180). El del proyecto se abre con la vista previa «preparador» de `.claude/launch.json` (puerto 5181). |

| Motor de recomendaciones (VPS) | `recomendador/` | Python: «Para ti», «Similares» y búsqueda por voz con @night_monkey_bot. Ver sección abajo y `recomendador/README.md`. Desplegar con `recomendador/scripts/desplegar.sh` (pedir permiso). |
| Android TV / stick | el mismo APK (`android/`) | Publicado en la **1.1.67** (2026-11-12); la **1.1.68** solo quita el «(dev)» del nombre. Ver «Android TV» abajo y `docs/instalar-en-android-tv.md`. |

Formato de los comentarios en `docs/formato-comentarios.md`. Marcas que lee `js/library.js` al final del comentario:
`#Categoría`, `#infantil`, `#portada`/`#banner`, `#tmdb<id>`, `#miniaturas`, y las nuevas de idioma (abajo).

## Motor de recomendaciones + búsqueda por voz (2026-11-20, rama `feature/recomendador`; SIN desplegar ni publicar)

Plan aprobado: `~/.claude/plans/users-diegobolanos-projects-homeflix-ya-melodic-river.md`. Todo en `recomendador/` (README ahí).
- **Arquitectura:** contenedores `reco-db` (Postgres 16 + pgvector, propio del motor), `reco-api` (FastAPI) y `reco-worker` (una sola sesión de
  Telegram: catálogo + bot de voz + tareas). Sin puertos públicos; las apps entran por el servidor Node (`/api/v1/reco/*`, red
  `reco-interna`, cabecera `x-reco-token`). Ids: `user_id = <cuenta sha256>:<perfil>`, `movie_id = titleKey`.
- **Catálogo:** el worker lee NETSUCKS con Telethon y arma los títulos con **el mismo `js/library.js`** (`reco/catalogo/armar.mjs` corre en Node dentro
  de la imagen). Si cambia el formato de los comentarios, el motor lo entiende igual sin tocar Python.
- **Eventos:** vistas y Mi lista salen del `doc` de sync (ruta interna `/interno/v1/reco/docs` del servidor Node); las apps solo mandan
  `click` y `search`. Idempotente (clave única por evento).
- **Bot de voz:** el código de `~/Documents/night_monkey_bot` vive en `reco/voz/bot.py`. Para audios de cualquiera de la familia hace falta el grupo
  privado «buzón» (bot + cuenta Premium, `BUZON_CHAT`). Identidad: `tg_id` → cuenta con `/interno/v1/reco/cuenta-por-tg/<id>`.
- **Probado en local:** 28 pruebas (20 unitarias + 8 de integración con Postgres real), TMDB real (8/9 títulos de prueba, «It» como miniserie
  con el respaldo película↔serie), imagen Docker (828 MB) y carga 50 req/s: p95 118 ms, 0 errores. **No probado contra Telegram real** (lector y bot).
- **Servidor Node (`servidor/src/reco.js`):** rutas `/api/v1/reco/{recomendaciones, similares/<titleKey>, eventos, perfil, descubrir,
  feedback, buscar}` (llave Bearer, perfil validado contra el doc, caché 60 s, motor caído → lista vacía / 503) y las internas
  `/interno/v1/reco/docs` y `/interno/v1/reco/cuenta-por-tg/<id>` (con `x-reco-token`). Columna nueva `cuentas.doc_at` (migración sola).
  `RECO_URL`/`RECO_TOKEN` en el `.env`; red `reco-interna` en el compose. 7 pruebas nuevas en `test/reco.test.js` (todo `npm test` en verde,
  corrido en un contenedor Node 22: los `node_modules` de la carpeta son de Windows).
- **Apps:** `js/reco.js` (HFReco) cargado en TV, celular y web (`web/sw.js` → `hf-web-8`). Fila «Para ti» en Inicio (TV y celular, con la razón
  como subtítulo de la tarjeta, solo si hay ≥4), «Similares» en la ficha (TV: reemplaza a «Más películas» si hay ≥3; celular: antes de
  «También de…»), eventos `click`/`search` en cola. Huellas: `browseSigNow` y `catalogSig` incluyen `HFReco.huella()`. Atribución de TMDB en
  la ayuda de Ajustes (TV) y al pie de la cuenta (celular). Prueba: `node tools/test-reco.mjs`. Visto en los tableros de diseño
  (`app.html?design=browse-home`, `mobile/?design=home`) con recomendaciones de prueba.
- **Orden de despliegue:** primero el recomendador (crea la red `reco-interna` y el `RECO_TOKEN`), después el servidor Node (su compose
  necesita esa red), y al final la OTA.
- **2026-11-20: el VPS ya no existe.** Todo corre en Docker en el Mac del usuario: `local/docker-compose.yml` (incluye el compose del
  recomendador) + `bash local/levantar.sh` (ver `local/README.md`). Probado con Telegram real: NETSUCKS (`-1004437120043`) → 110 títulos,
  212 videos, TMDB 105/110; bot de voz listo (sesión de night_monkey copiada al volumen `homeflix-local_reco-sesiones`; NO correr más
  `~/Documents/night_monkey_bot/bot.py`). Prueba de punta a punta por `http://localhost:4500` OK (cuenta de prueba borrada).
  **Red de la casa (1.2.0, armada y publicada en `local/versiones` con `publicar-version.mjs --local`):** el servidor escucha en
  `http://192.168.1.12:4500` (toda la LAN); las apps traen esa dirección de fábrica (`js/config.js` `hfServidor()`), el celular la cambia en
  Ajustes → «Servidor de HomeFlix» (prueba + guarda + la deja en `homeflix-cuenta.json` con `servidorAt`; la TV la adopta al abrir). El APK
  permite contenido mixto pero `MainActivity.esRedDeCasa` corta todo http fuera de la red local. **Falta:** reinstalar una vez (APK desde
  el navegador del celular; TV por Apps2Samsung → requiere release v1.2.0 en GitHub = commit + tag + push, pedir permiso). Ver `local/README.md`.
- **(Ya no aplica: era para el VPS)** Falta (con permiso): desplegar (`bash recomendador/scripts/desplegar.sh --dry-run` primero; ver memoria libre del VPS), poner en el `.env` del
  VPS `TG_API_ID/HASH`, `BOT_TOKEN`, `CATALOGO_CHATS` (id de NETSUCKS), `TMDB_API_KEY`; `--login` con la cuenta Premium (APAGAR antes el bot del
  Mac: `AUTH_KEY_DUPLICATED`); crear el buzón; redesplegar el servidor Node; publicar por OTA las filas nuevas.
- **Trampas:** `tg_id` lo informa la app al sincronizar (no está verificado): si dos cuentas dicen ser del mismo Telegram, el bot usa la más
  antigua. La sesión de Telegram del worker no puede usarse en otro lado a la vez. El `.env` raíz del repo NO lo lee el motor (tiene el suyo).
  La matriz de similitud es densa (n²): bien hasta ~5000 títulos; más allá, pasar a vecinos en pgvector (épica 07).

## Catálogo de Telegram más rápido (2026-11-12, rama `feature/canal-anime`; SIN publicar al escribir esto)

Mismo criterio que el canal Anime, para las películas y series propias. Lo que más tardaba no era dibujar (HFLibrary.build: 13–22 ms en el PC con 600 películas) sino
leer Telegram (~3,5 s por petición en esta ruta) y los repintados a ciegas.
- **Lectura incremental** (`js/catalog.js`, `HFCatalog.scanChat`): se guarda por chat `hf.scan.<cuenta>` = {max (mensaje más nuevo), n (items), full (última lectura completa),
  mig (grupo migrado)}. La lectura normal pide solo lo NUEVO (`HFTelegram.scan(id, {since})`: cada filtro se detiene en la primera página que trae mensajes ya conocidos): 1–3
  peticiones en vez de recorrer todo el chat. **Completa** (única que ve comentarios editados o mensajes borrados): primera vez, ↻ si pasó >1 h, automática si pasó >6 h,
  chat migrado, o si lo guardado no cuadra con la caché (n). Ojo: un comentario editado en un mensaje viejo tarda hasta 6 h (1 h con ↻) en verse.
- **Los tres filtros a la vez** (videos, documentos, fotos; antes uno tras otro; si Telegram protesta, vuelve a uno por uno) y la comprobación de «grupo migrado» (getChat/getFullChat)
  corre **mientras** se leen los mensajes. Cuentas con ~3,5 s por petición, chat de 320 videos: antes 7 peticiones seguidas (~24 s), completa ahora ~4 rondas (~14 s), normal ~1 ronda (~3,5 s).
- **Repintado inteligente** (TV `browseRepaint` en `js/ui/library.js`, celular `repaintCatalog` en `mobile/m.js`): huella de lo que se ve (títulos, portadas, categorías, versiones,
  Continuar viendo, Mi lista); al terminar la lectura o llegar cambios de otro dispositivo solo se repinta si la huella cambió y el control/dedo lleva ≥3 s quieto. Antes se repintaba siempre
  y reiniciaba la fila donde se estaba. El aro «actualizando» del celular ya no repinta (`syncDot`).
- **Portadas**: `HFTelegram.imageLocal` (memoria/IndexedDB sin pedir nada a Telegram): las ya guardadas se pintan de golpe, solo las que faltan esperan en la cola de descargas (TV: de a 3;
  celular: de a 4 y ahora solo al acercarse a la pantalla). `imgGet` lee en «readonly» (antes «readwrite»: las lecturas se hacían una tras otra).
- **Adelantar mensajes** (`HFTelegram.warm`, `HFLibrary.videoKeys`): al abrir la ficha de una película/serie y al empezar un capítulo (el siguiente) se piden los mensajes de sus videos en UNA
  petición por chat; antes, al reproducir tras una lectura incremental, la fuente esperaba ~3,5 s por `getMessages`.
- Pruebas: `node tools/test-catalog.mjs` (Telegram falso: paralelo, incremental, cuándo repite completa, warm). **No probado con Telegram real**: verificar en el celular por USB (ver sección de depuración).

## Render del celular (2026-11-12, rama `feature/canal-anime`; SIN publicar al escribir esto)

Medido con una biblioteca sintética de 600 películas (vista de desarrollo `mobile/index.html?design=home-big&n=600`, expone `window.__hfm`): Inicio pintaba **5886 nodos / 1130 tarjetas / 238 KB** de HTML (67 ms de JS en el PC; en un celular modesto ×4–6) porque cada título salía en su categoría Y otra vez en «Todas las películas» (una fila de 600 tarjetas).
- **Filas con tope y «Ver todo»** (`row(..., {all})`, `ROW_CAP = 24`): cada fila enseña 24 y termina en una tarjeta que abre la lista completa (`ACT.category`; seudo-categorías «Todas las películas» / «Todas las series» en `V.category`). Ahora **1136 nodos / 180 tarjetas / 46 KB** (-81 %), render 8–15 ms.
- **`render()` no repinta lo que no cambió**: si el HTML de la pantalla es idéntico al anterior (solo cambió una hoja, un aviso, el cast…) solo se reemplaza lo de encima (el mismo nodo sigue en pie: filas con su desplazamiento, portadas pintadas, sin recalcular el diseño). Si cambia de verdad, se conserva el desplazamiento horizontal de cada fila (`rowScrolls`).
- **CSS**: `content-visibility: auto` en `.m-row` y en las tarjetas de las cuadrículas (lo de fuera de pantalla no se calcula ni se pinta).
- **Portadas**: las que ya están en memoria se pintan en el acto en `hydrate()` (antes cada repintado dejaba un parpadeo con el dibujo de respaldo).

## Pie guiado del preparador (2026-11-12, rama `feature/canal-anime`; SIN publicar al escribir esto)

Antes el pie tenía 3 botones (Siguiente, «＋ A la cola», «Crear versiones») en las pestañas 1 a 3: un compañero cargaba el video en la 1 y lo mandaba a la cola sin pasar por 2, 3 y 4 (datos inciertos). Ahora hay **un solo camino** (`ui.html`: `<footer class="actions">`, `updateTabs`, `updateStart`, `renderReview`):
- Pie = chip «Paso N de 4 · nombre» + mensaje + **← Atrás** + **un único botón principal, siempre a la derecha**: paso 1 «Siguiente: Motor →» (apagado sin video), paso 2 «Siguiente: Calidades →», paso 3 **«Crear versiones»** (sin cola) o **«＋ Agregar a la cola»** (con cola: es la misma acción, solo cambia el nombre; `/api/start` y `/api/cola/agregar` hacen lo mismo en el servidor), paso 4 «Publicar». En el paso 3, si ya se creó (o se mira una de la cola) el botón es «Ir a publicar →». «Cancelar» solo sale mientras algo se renderiza.
- El envío **solo existe en el paso 3** y se apaga sin nombre de película (mensaje «Falta el nombre… ponlo en el paso 1»).
- **«Revisa antes de enviar»** (tarjeta arriba del paso 3, `#review`): título/año, categoría, perfil infantil, ficha de TMDB, video original, calidades y destino (empieza ya / al final de la cola · se publica sola o la publicas tú). Lo dudoso (sin nombre, sin año, sin categoría, sin ficha, sin calidad) sale en ámbar/rojo con «Cambiar en el paso 1».
- Tras enviar, la película se vacía del formulario (vuelve al paso 1) y el aviso «quedó al final de la cola» se queda 20 s (`S.notice`; antes otro evento lo pisaba al instante). `updateStart` también corre en cada evento de la cola para que el botón cambie de nombre solo.
- Probado en el navegador con `/api/probe` y el envío simulados (`fetch` falseado): los 4 pasos, sin nombre, con cola (`COLA.pending` falseado), un solo envío con doble clic. **No probado con un video real ni con la cola real.**

## Caché del preparador (2026-11-12, rama `feature/canal-anime`; SIN publicar al escribir esto)

Antes, cada vez que se abría el preparador (Inicio) releía TODO el chat de Telegram (pantalla «Leyendo…» y portadas bajadas de nuevo). Ahora (`tools/preparador/cache.js`, cargado en `ui.html`, servido por `server.mjs` en `/cache.js`, incluido en el zip de `publicar-version.mjs`):
- **IndexedDB `hf-preparador-cache`** (`PrepCache`: `kv` + `thumbs`): el catálogo por chat (`cat:<meId>:<chatId>` = items, id máximo, cuántos, cuándo se leyó completo) y las portadas (llave con peso y medidas: si se cambia la imagen deja de valer sola; poda a 600).
- **Se ve al instante** lo de la última vez (`paintFromCache` en `start()`, antes de conectar con Telegram), con el aviso «Sincronizando con Telegram… · lo de la última vez».
- **`PrepCatalog.refresh`**: busca solo lo nuevo (tres filtros en paralelo, parando en el id ya conocido) y revisa lo conocido con `getMessages` en tandas de 100 (3 a la vez) para detectar comentarios editados, imágenes cambiadas y borrados; de paso recupera los objetos de mensaje (no se pueden guardar). Lectura completa: primera vez, cada 24 h, si lo guardado no cuadra, o con **↻** (`ACT.reread`). Si Telegram falla al revisar, se conserva lo guardado.
- **No repinta si no cambió nada** (`itemsSig`; además `runSrt` ya no repinta si no revisó ningún .srt). Las portadas que faltan esperan (`B.thumbWait`) a que lleguen los mensajes; las guardadas se pintan sin pedir nada.
- `choose()` solo vuelve a leer si no se sincronizó en los últimos 30 s.
- Pruebas: `node tools/test-preparador-cache.mjs` (Telegram falso) y en el navegador con un cliente falso inyectado en `HFB.debug()`: sin cambios → 0 portadas bajadas y mismo nodo del DOM; con un mensaje nuevo → aparece la tarjeta. **No probado con Telegram real**: al abrir el preparador por primera vez tras actualizar hace una lectura completa (normal); desde la segunda debe verse al instante.

## Canal «Anime» (2026-11-12, rama `feature/canal-anime`; DESPLEGADO en el VPS y PUBLICADO por OTA en la 1.1.73, sin commit)

Cada cuenta tiene un **chat fijo «Anime»** (id `anime`, arriba de la lista de chats de cada perfil; cada perfil lo activa o no, como cualquier chat) y un
**perfil «Anime»** que se crea solo (`HFLibrary.ensureAnimeProfile`, al abrir la pantalla de perfiles: una vez, si hay lugar y no se borró antes) con ese canal
activo. Su contenido sale de la **anime-api** (https://github.com/aryaniiil/anime-api, contenedor `anime-api` en el VPS) y está en las 3 apps (TV Samsung,
TV Android y celular) porque el código es compartido.

- **Seguridad**: la anime-api NO tiene puerto ni dominio público. Solo la alcanza el contenedor `homeflix` por la red privada `anime-interna`. La puerta es
  `servidor/src/anime.js`: `GET …/api/v1/anime/<lista>` y `…/reproducir` exigen la llave de la cuenta (la misma de la sincronización; solo cuentas que ya existen
  y no están bloqueadas); el video va por `…/anime/p/<firma>/<m3u8|seg|sub>?u=&r=`, direcciones **firmadas** con HMAC (el reproductor no puede mandar cabeceras)
  que solo valen para lo que el servidor firmó (nada de SSRF; destinos privados bloqueados) y vencen a las 6 h. El servidor pone el `Referer` que exige el CDN
  y reescribe las listas HLS (también `URI=` de claves/pistas). `servidor/test/anime.test.js` (11 pruebas con `app.test.js`).
- **Proveedores**: cada uno devuelve cosas distintas (mp4 directo, HLS, o una «lista» HLS **cifrada** que no sirve: `reanime`). `reproducir` valida cada fuente
  (HLS = empieza con `#EXTM3U`; mp4 = responde video) y pide a la vez `animegg, anikoto, anineko, mkissa` (gana el primero que sirva; ~6–45 s); si ninguno,
  prueba el resto. Recuerda el último proveedor que funcionó por anime. Un episodio de One Piece tardó 6 s con animegg (mp4 sin subtítulos aparte) y 18–45 s con
  los HLS (traen subtítulos .ass/.srt en inglés). No se intenta saltar protecciones de los sitios: solo se manda el `Referer` como hace la propia anime-api.
- **Idiomas (2026-11-12, tras publicar la 1.1.73; pendiente de desplegar y publicar la 1.1.74)**: la 1.1.73 NO mostraba subtítulos en español por dos fallos: (1) `anikoto` llama
  `label`/`srclang` al idioma y mi código solo leía `language`; (2) la carrera elegía `animegg` (mp4 en 4 s, SIN subtítulos aparte) antes que `anikoto`. Ahora `reproducir`
  puntúa las fuentes (3 = con español, 2 = otros subtítulos, 1 = video solo) y devuelve al instante la primera con subtítulos; si llega primero un mp4 espera hasta 45 s
  (`ESPERA_ESPANOL`). Muestra real (40 populares, cap. 1, `anikoto`): 33 con fuentes, **20 con subtítulos en español**, 13 solo inglés, 7 sin fuente; doblaje solo en inglés
  (ninguno en español). `servidor/src/anime-idiomas.js` lleva un índice que se llena solo (siembra: 8 págs. de populares + 2 de tendencia + lo que miran las apps; un anime cada
  ~20 s; `DATA_DIR/anime-idiomas.json`) y `GET …/anime/idiomas` da las listas `es`/`dub`/`en`; la app arma las filas «Con subtítulos en español», «Doblados al inglés» y «Japonés con
  subtítulos en inglés» y marca «Subt. ES» en las tarjetas. Al probar contra la anime-api privada: túnel `ssh -L 8800:<IP del contenedor en anime-interna>:8000` y `ANIME_URL=http://localhost:8800`.
  Idea pendiente (el usuario decidirá): traducir al español los capítulos que solo traen inglés (Claude o LibreTranslate), sin construir todavía.
- **Cliente**: `js/anime.js` (`HFAnime`: lista de inicio cacheada 30 min, lo «tocado» en `hf.anime.known` para Mi lista/Continuar viendo sin red, capítulos en
  `hf.anime.eps.<id>`, bloques de 50 capítulos como «temporadas» con `season.label`, etiqueta «Cap. n» en vez de T1:E1 → `epTag`/`seasonLabel` en TV,
  `epLabel` en celular). Los animes van en `library.anime` + `titles`/`byKey` (NO en Películas/Series ni en el perfil Kids). TV: menú «Anime» (solo si el perfil lo
  tiene; un perfil solo-Anime no ve Inicio/Películas/Series), búsqueda en el catálogo completo, ficha que carga los capítulos al abrir, «Ver en la TV» desde el celular
  (`HFAnime.resolve`). Celular: pestaña «Anime». Reproducción: `js/playback.js` modo `web` (hls.js de `js/vendor/hls.min.js`, o `<video src>` para mp4; subtítulos con
  el mismo `Subs.renderer`; audio «Japonés/Inglés (doblaje)» y calidad por niveles HLS en el panel de pistas). Imágenes: las «claves» `http…` pasan directo por
  `HFTelegram.image`.
- **Pruebas**: `node tools/test-anime.mjs`, `node tools/test-library.mjs` (incluye el perfil Anime), `cd servidor && node --test test/app.test.js test/anime.test.js`.
  En el navegador: servidor local (`PORT=4510 ANIME_URL=… node servidor/src/index.js`) y las vistas `?design=anime-home|anime-detail|anime-search|anime-player` de
  `app.html` y `?design=anime|anime-detail|anime-search` de `mobile/index.html` (reproducen de verdad). Probado: TV y celular reproducen One Piece cap. 1 con subtítulos.
- **Hecho el 2026-11-12**: red `anime-interna`, anime-api sin puerto y servidor desplegado (release 20261112-041037), 1.1.73 en el canal OTA. **Falta**: root debe correr `~/quitar-dominio-publico.sh` (quita anime.homeflix.fun de Caddy; hoy responde 401) y probar con una cuenta real. Orden usado (en `servidor/anime-api/README.md`: red `anime-interna` → anime-api sin puerto → `desplegar.sh` del servidor →
  root: `quitar-dominio-publico.sh`), publicar la versión por OTA (`publicar-version.mjs`, no hace falta `--programa`) y probar con una cuenta real en TV y celular.
  Pendiente de ideas: elegir proveedor a mano, español (los proveedores casi solo traen inglés), progreso de capítulos largos al reanudar tras caducar la firma (6 h).

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

**Android TV / stick (2026-11-11; publicado en la 1.1.67 el 2026-11-12; SIN probar en un stick real):** el usuario necesita
HomeFlix en el stick Android de su mamá (instalar sin desconectarlo). Se hizo **un solo APK** para celular y TV:
`MainActivity.detectTv()` (UI_MODE_TELEVISION, leanback, o sin pantalla táctil; o `--ez tv true`) abre `app.html` (la interfaz
de Samsung) en vez de `mobile/index.html`. Piezas: manifest (`LEANBACK_LAUNCHER`, `uses-feature` leanback/touchscreen no
obligatorios, `android:banner` = `res/drawable-xhdpi/banner.png` 640×360), `MainActivity` (ATRÁS → `HFTV.back()`,
`dispatchKeyEvent` traduce teclas multimedia/canales a los códigos de Tizen, `modoTV()/modelo()/keepOn()`),
**`js/androidtv.js`** (nuevo: `HF_TV`, `HFTV.back/key`, pantalla encendida con video; solo actúa si `HFAndroid.modoTV()`),
`tools/build-apk.mjs` (ahora mete `app.html`, `css/` e `images/intro/intro.mp4` al APK: 7 MB → 14 MB con ExoPlayer),
`js/sync.js` (se registra como `tipo "tv"`, nombre «TV Android <modelo>»: aparece en «Ver en la TV»), `js/intro.js` (intro en
video también con `HF_TV`), `js/ui/updatemodal.js` (versión que pide programa → botón «Instalar» = `HFUpdate.installNative`) y
`js/ui/access.js` (tip sin Apps2Samsung). OTA: el paquete web ya traía `app.html`/`css/`; `Actualizador` sirve cualquier ruta, no
cambió. `tools/nativo-minimo.json` NO se tocó (el celular no necesita reinstalar). Probado: compila, `aapt2 dump badging` muestra
`leanback-launchable-activity` + banner; en el navegador con un `HFAndroid` de mentira (`modoTV`) se comprobó tipo/nombre, ATRÁS
(pantalla inicial = salir; login = volver), teclas multimedia, `keepOn`, intro en video y el modal «Instalar». **Instalado el 2026-11-11** en el stick de la mamá (**Chromecast con Google TV «sabrina»**, Android 14, 192.168.0.9, nombre «Tv habitación adry», conectado a una Samsung; su control no
funcionaba y se manejó con la app Google TV del celular) por adb inalámbrico (`adb pair` + `adb connect` + `install -r` de la 1.1.68; permiso
`appops REQUEST_INSTALL_PACKAGES allow` para que «Instalar» del aviso funcione). Probado en el stick real por adb: arranca (intro, pantalla inicial a 960×540 con escala 0,5), OK abre el
inicio de sesión, ATRÁS vuelve y, en la pantalla inicial, sale de la app. Visto en el stick: (1) el formulario «api_id / api_hash» NO hace falta (la clave va en el APK, `credentials().from === "build"`);
sale si se pulsa ⚙ de la pantalla inicial o «Clave de API»: BACK y OK en «Iniciar sesión». (2) Tras >1 min en segundo plano (la app quedó abierta
mientras se usaban los ajustes del stick) «Iniciar sesión» dio «Worker connection expired» y «Reintentar» no lo arregló (`remake`/`reconnect`
de `js/telegram.js` no se recuperó); reiniciar la app (sin `force-stop` en caliente: el inicio del stick se pone encima) sí. **A vigilar**
en uso real. **Samsung 2019 (Tv Santiago UN43RU7100, Tizen 5.0 = Chromium 63), 2026-11-11:** el .wgt 1.1.68 se instaló con Apps2Samsung (modo
desarrollador con IP del celular) pero sale «No se cargó el motor de Telegram»: `js/tg.bundle.js` se compila para Chromium 69 (`engine/build.mjs`,
`TARGET = 'chrome69'`) y necesita BigInt; falta la versión `tg.legacy.js` para Tizen 5.0 (la cabecera de `engine/build.mjs` ya lo dice;
`babel-plugin-transform-bigint` y `jsbi` están en `engine/package.json`). No se hizo: el stick cubre esa TV. Ojo: la OTA de la TV no llega a esa
pantalla (↻ solo existe tras iniciar sesión), cada prueba sería reinstalar el .wgt. **Pendiente:** escanear el QR, biblioteca, reproducir una película en el stick,
4K/HEVC, TV en vivo (ExoPlayer) y el teclado en pantalla. Ojo: el APK publicado es el de compilación «debug» (paquete
`com.homeflix.app.dev`); su nombre en el inicio es «HomeFlix» desde la 1.1.68 (`appLabel` de `debug` en `android/app/build.gradle`). No hay enlace corto de descarga (la URL del .apk es larga): se podría
añadir una ruta `/tv` en `servidor/src/versiones.js` (desplegar pide permiso).

**Cola: avance de publicación compartido, imágenes de otra película y barra vacía (2026-11-11/12, sin publicar al escribir esto):** el usuario veía, en una segunda
pestaña del preparador, «Publicando…» con la barra vacía, nada marcado de lo ya subido y, al abrir una película de la cola, las portadas de OTRA. Causas: (1) el
avance (`C.pub`, `QV.keys`) vivía solo en la memoria de la página que sube; (2) `loadDir` solo ponía portada/banner de la carpeta «si todavía no hay» (`!PUB.img[k]`), así
que se quedaban las de la película anterior; (3) la barra solo contaba bytes de videos (0 % mientras salían imágenes y subtítulos). Ahora: el servidor guarda el avance de
cada película en memoria (`PUBS`, `POST /api/cola/progreso`, evento en vivo `cola-pub` sin historial, `colaVista().items[].pub` con `i,n,done,sent,total,speed,skip,keys`);
`cola.js` lo manda (`sendPub`: cambios de estado enseguida, bytes cada ~0,8 s) y lo recibe de otras pestañas; `rowText/rowPct` usan el avance local o `x.pub`; la barra
pesa 1 MB por imagen/subtítulo/álbum (`SMALL`); `ui.html` `applyQueueStates` mezcla `x.pub.keys` con la memoria local, `queuePub` repinta la vista, `viewQueue` vacía
la pestaña 4 antes de cargar y `loadDir` descarta las imágenes si la carpeta es otra o se está viendo una de la cola. Probado: dos películas (roja/azul) → cada una muestra
SU portada; una página que no publica ve «Publicando 3 de 4 · 5 MB de 8 MB · 4.2 MB/s», la barra y los archivos con su estado, y lo mantiene tras recargar.
Ojo con los videos en pestañas: solo UNA pestaña puede publicar (candado `hf-preparador-sesion`); las demás solo miran.

**Película «huérfana» en «publicando» (2026-11-11, sin publicar al escribir esto):** en el PC del usuario (1.1.68) Elio llevaba 26 min en «publicando» sin subir
nada (0 MB/s) y la siguiente (Deadpool) ya aparecía también «publicando». Causa: la página que la subía se cerró/recargó (p. ej. al actualizar el preparador) y el
servidor solo resetea «publicando» al reiniciarse; `cola.js` `kick()` solo tomaba «renderizado», así que quedaba así para siempre. Se devolvió a mano con
`POST /api/cola/estado {estado:"renderizado"}`. Arreglo: `kick()` devuelve a «renderizado» una «publicando» cuando ESTA página tiene la sesión de Telegram y no está
publicando (`C.busy`), así que la reanuda sola (lo que ya está en el grupo no se repite). Probado con una página con sesión simulada; sin sesión no toca nada.
Aprendizaje: no actualizar/reiniciar el preparador mientras publica (el reinicio también vuelve a empezar el render en curso).

**Preparador: formulario en blanco al encolar y aviso «ya está en el catálogo» (2026-11-11, sin publicar al escribir esto):** al mandar una película
a la cola (con cualquiera de los dos botones) `sendJob` llama a `resetForm()` (`ui.html`, la misma que usa `exitQueueView`): vacía las pestañas 1 a 4 (video,
nombre, ficha de TMDB, categorías, extras, imágenes y carpeta de la pestaña 4, plan de calidades) sin tocar lo ya encolado, porque el objeto de la cola
lleva `opts()` y el servidor copia las imágenes a su carpeta al agregar. «Crear versiones» ya no ata la película a esa pantalla (`S.mine` no se usa): su avance
se ve en «Cola». `S.formGen` descarta las respuestas de video/TMDB que llegan después de vaciar. Aviso: `checkYaEsta()` (al cargar un video y al llegar la
ficha de TMDB) compara con la cola (`COLA.all()`) y con el catálogo (`HFB.debug().titles`, por `#tmdb<id>` o nombre+año ±1, solo películas y con el catálogo
ya leído) y abre un diálogo «Cargarla de todos modos / No cargarla» (foco en «No cargarla»; «No cargarla» vacía el formulario). No avisa si el original
se carga desde la biblioteca (`PREP.loadSource` → `loadSource(path, true)`: es para agregar calidades a una que ya está) ni al ver una película de la cola.
Probado en el navegador con un catálogo simulado y tres películas de prueba.

**Cola del preparador: «se queda pegado» y películas procesadas dos veces (2026-11-11, sin publicar al escribir esto):** causa: `prepare()` hacía trabajo
síncrono antes de devolver (`extractSubs` con `spawnSync` leía el video entero para sacar los subtítulos; además `probe`, `hasNvenc`, `canFullGpu`) y
`colaSeguir()` lo llamaba dentro de la petición HTTP del clic: el servidor quedaba congelado, el clic no tenía respuesta, se volvía a pulsar y entraba
una segunda copia a la cola (se procesaba dos veces). Ahora: `prepare.mjs` → `extractSubsAsync` (con `spawn`, cancelable por `job.proc`; `extractSubs`
síncrono queda solo para `subsAparte`); `server.mjs` → `colaSeguir()` arranca el trabajo 150 ms después y con la bandera `arrancando` (la respuesta
sale antes y no pueden empezar dos a la vez), `colaAgregar` no acepta la misma película (`colaClave`: archivo+carpeta+calidades) mientras espera o
renderiza (devuelve la existente con `repetida:true`), y ya no hay «primero» (todo va al final; el orden se cambia en la cola). Página (`ui.html` `sendJob`,
`updateStart`; `cola.js` `COLA.pending()` y `P.queueChanged`): «Crear versiones» solo se enciende sin cola (esperando o renderizando), «＋ A la cola» agrega
al final, y durante el envío los dos se apagan («Enviando…» / «Agregando…») hasta que el servidor contesta. Probado con 3 películas de prueba: doble clic
simultáneo → 1 sola copia en 6-7 ms, orden 1-2-3, una sola renderizando a la vez, «Crear versiones» apagado con cola y se enciende al terminar.

**AUTH_KEY_DUPLICATED, segunda vuelta (2026-11-11, sin publicar al escribir esto):** el arreglo de la 1.1.66 no servía: `dupRecover` llamaba a
`HFTelegram.logout()`, que borra la sesión de la app (`hf-session`) y no la del preparador (`hf-preparador`, la crea `tgClient()` en `ui.html`), así
que tras recargar seguía la llave dañada y el compañero no podía entrar; además el QR (paso por defecto) y el `getMe()` del arranque no lo llamaban.
Ahora `wipeSession()` (`biblioteca.js`) hace `client.destroy()` + `deleteDatabase("hf-preparador")`, se llama desde QR, número/código y arranque, el aviso
de una sola vez pasó a `hf.dup2`, y `ui.html` `oneTab()` toma un candado Web Lock `hf-preparador-sesion`: una segunda pestaña del preparador ya no crea el
cliente (dos pestañas = misma llave en uso a la vez = AUTH_KEY_DUPLICATED) y dice que se use la otra. Probado en el navegador: segunda pestaña bloqueada,
`dupRecover` borra la base y recarga con sesión limpia y QR. A mano, si hace falta: icono a la izquierda de la dirección → Configuración del sitio → Borrar datos.

**1.1.66 · AUTH_KEY_DUPLICATED (2026-11-11):** Telegram invalida para siempre la llave de una sesión usada a la vez en dos sitios; a un compañero le salía al pedir el código en el preparador. `js/telegram.js`: `signedOut` incluye ese error y `loginError` lo traduce. `biblioteca.js` `dupRecover()`: en `send-code`/`check-code` borra la sesión (`HFTelegram.logout()`) y recarga una sola vez (`sessionStorage hf.dup`), con aviso en el login. A mano: Application → Storage → Clear site data en la pestaña del preparador.

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

## Velocidad de subida a Telegram (2026-11-12)
- Medido con un Chrome limpio y la cuenta de pruebas: **~5 MB/s** (4,6–5,6), igual a la capacidad de la línea (46 Mbps ≈ 5,6 MB/s). Un archivo de 1,4 GB sostuvo 5,64 MB/s sin decaer; pestaña oculta/minimizada tampoco frena. El motor (mtcute, partes de 512 KB, 8 conexiones × 3 peticiones) no es el cuello.
- Por eso el ~2,3 MB/s que ve el usuario viene de su navegador/equipo (extensiones, antivirus, tareas de fondo del preparador, otro programa subiendo) o de la hora. Para aislarlo: botón **«⚡ Probar velocidad de subida»** (panel de la cola; `speed()` en `cola.js`, `speedTest()` en `ui.html`): sube 2×60 MB al azar, no envía nada a ningún chat. Comparar con ~5 MB/s.
- Pendiente: según lo que dé en el navegador del usuario, decidir si se pausan los escaneos de fondo (idiomas, miniaturas) mientras se publica.

## Aviso de «ventana vieja» tras actualizar el preparador (1.1.71)
- Causa del reporte «el botón no me llegó» (1.1.70): al actualizar, los archivos nuevos quedan en disco y `/api/state.version` ya dice la nueva, pero la pestaña abierta (y el proceso) siguen con lo anterior hasta reiniciar.
- Ahora `/api/state` trae `corriendo` (versión con la que arrancó el proceso, `VERSION_ARRANQUE`) y la página (`staleCheck()` en `ui.html`, cada 15 s y al enfocar) muestra una franja «Reiniciar ahora» (si el proceso es viejo) o «Recargar ahora»; deshabilitada mientras haya trabajo en marcha. No recarga sola para no perder lo que se esté llenando. Solo ayuda desde la versión que ya la trae: la primera actualización a la 1.1.71 igual pide reiniciar a mano.

## Botones «＋ A la cola» / «Crear versiones» apagados con «Marca al menos una calidad» (publicado en la 1.1.72)
- Causa: la pestaña 3 podía quedar sin ninguna calidad marcada que el video permita. Venía de lo que la biblioteca marcaba solo «para esta película» (`PREP.openFicha`/`prefill`: calidades que faltan) y que además se guardaba como preferencia (`saveOpts`) → la siguiente película cargaba con todo desmarcado.
- Arreglo en `ui.html`: (1) esas dos rutas ya no guardan la selección; (2) `loadSource` (no desde la biblioteca) marca todas las calidades posibles del video si ninguna de las marcadas cabe. Probado con `localStorage` en blanco (`quals` todas en false): carga el video y quedan 3 calidades marcadas y los botones activos.

## Cola colgada en «Publicando 1 de N · 0 MB» (2026-11-12, sin publicar al escribir esto)

Scary Movie 4 se quedó en «publicando» sin subir nada (miniaturas en «Subiendo…» al 0 %) y las demás películas esperando detrás. El servidor y
los archivos estaban bien (`/api/versions`, `/api/thumbs` y `/api/media/<id>` respondían al instante): la que se quedaba colgada era una llamada a
Telegram desde la página (`sendMediaGroup`) que ni respondía ni fallaba, y `cola.js` no tenía ningún tiempo máximo. Arreglo en `tools/preparador/cola.js`:
`guard()` da tope de 90 s a cada llamada pequeña (leer hoja, enviar fotos/subtítulos/miniaturas, `existing()`); a los videos, un vigilante corta la
subida si pasan 120 s sin avanzar un byte; cada archivo se reintenta hasta 3 veces (si ya llegó al grupo, `landed` lo da por hecho) y, si sigue sin
responder, la película queda en «error» con el motivo (botón «Reintentar»). La subida manual de la pestaña 4 (`ui.html`) sigue sin ese tope.
Para que una página abierta tome el cambio hay que recargarla (Ctrl+Mayús+R); al recargar, la película «huérfana» vuelve a «renderizada» y se publica sola.

**Causa real del atasco de Scary Movie 4 (2026-11-12, arreglos en el repo, SIN publicar):** además del tope de tiempo de `cola.js`, había dos fallos al abrir el preparador:
1. `biblioteca.js · loadChats`: la lista se pinta de la caché con un chat «provisional» (`B.peer._cache`) y la condición `if (pick && !B.peer)` nunca fijaba el chat real →
   `PREP.setChat` no se llamaba → `T.peer` vacío → `cola.js · kick` no publicaba nada ni recuperaba la película «huérfana». Ahora es `!B.peer || B.peer._cache`.
2. `ui.html · oneTab`: si al recargar la página vieja aún tenía el candado, el «no» se guardaba para siempre. Ahora espera hasta 8 s y no recuerda el «no».
**Ojo:** el preparador del usuario corre desde `C:\Users\santy\AppData\Local\HomeFlix\Preparador` (cwd verificado) y lo que ven las herramientas de Claude en esa
carpeta NO coincide con lo que sirve ese servidor (versión 1.1.82): editar el repo no lo cambia. Solo llega por OTA (`publicar-version.mjs … --subir`).
Mientras tanto se destrabó a mano: en una pestaña con la sesión, `HFB.show("chats")` y elegir NETSUCKS.

**«Preparar lo que falta» bloqueado mientras la cola sube (2026-11-12, SIN publicar):** `biblioteca.js · ACT.prepare` y `ACT["go-tab"]` avisaban «Ya hay un trabajo en marcha» con `PREP.busy()` (= `T.busy || S.busy`),
y `T.busy` también se enciende cuando la COLA publica. Ahora usan `PREP.formBusy()` (`(T.busy && !T.queue) || S.busy`; `setPubBusy` marca `T.queue`) y en `ui.html · onEvent` los eventos de
una película ajena de la cola ya no ponen `S.busy` (tampoco al abrir la página con el servidor renderizando). Resultado buscado: una se sube, otra se renderiza y las demás esperan en la cola.

**Botón «Reemplazar en el grupo» sin efecto (2026-11-12, arreglo en el repo, SIN publicar):** `biblioteca.js · ACT["img-replace"]` salía en silencio si `B.msgs[x.id]` no estaba (la lista se pinta de la caché y los mensajes
no se hidratan: `msgsReady=false`). Ahora `ensureMsg(x)` pide el mensaje a Telegram por su clave «chat:mensaje» y avisa si no lo encuentra; «Publicar las N elegidas» también.
**Limpieza del grupo (2026-11-12, con permiso del usuario):** borradas las copias repetidas del grupo NETSUCKS nuevo (se queda la más reciente): TRON 186/187, Coyote 352/354, subtítulos 859/489/755/350/250/285/252
y 12 portadas/banners/verticales viejos; Hoppers solo-inglés 51–55 y, del grupo viejo, 7608–7611 y 7614. Los 4K viejos de Hoppers (7, 9, 11) se borran solos cuando terminen de subir las partes 2 y 3 nuevas
(un vigilante en la pestaña del navegador). Las copias del grupo viejo de otras películas (Spider-Man, Toy Story 5, Coyote 46…) NO se tocaron: son de la migración y la app las ignora.

**Portadas verticales en blanco en «Portadas y banners» (2026-11-13, arreglo en el repo, SIN publicar):** la lectura de fondo (`cache.js · hydrate`) fallaba con `FLOOD_WAIT_%d` de Telegram (sin segundos en el texto),
los mensajes no se hidrataban (`msgsReady=false`) y `biblioteca.js · pumpThumbs` daba la imagen por inexistente («none») sin pedir el mensaje: 77 de 148 miniaturas en blanco, «Así está hoy» vacío.
Ahora `getBatch` espera y reintenta ante FLOOD (hasta 4 veces) y `pumpThumbs` pide el mensaje al vuelo (`msgByKey`) y, si Telegram falla, reintenta más tarde en vez de marcar «none».
Prueba nueva en `tools/test-preparador-cache.mjs` (3b). Hoppers quedó completo (4K partes 1–3 nuevas con español, 7/9/11 viejos borrados) y la 1.1.85 ya corre en el PC del usuario.
**Seguimiento (1.1.86 → 1.1.87, SIN publicar):** con la 1.1.86 las miniaturas SÍ cargan (verificado en una pestaña recargada), pero tardan hasta que termina la lectura completa (~1,5 min) y «Así está hoy» no se repintaba al llegar la imagen.
`biblioteca.js`: el panel lleva `data-thumb` (se repinta solo) y, si la lectura de fondo sigue a los 15 s, las miniaturas piden su mensaje al vuelo (`B.forceMsg`). Tras actualizar el preparador hay que RECARGAR la pestaña (Ctrl+Mayús+R): la página abierta sigue con el código viejo.

## Portada cambiada en el mismo mensaje no llegaba a TV/celular (SIN publicar, candidato 1.1.88)

- Causa: las imágenes se guardan en el equipo por «chat:mensaje@ancho» y la lectura normal del catálogo solo pide lo NUEVO; al
  cambiar una portada/banner con «Reemplazar en el grupo» el mensaje conserva su número (queda «editado»), así que nada la
  invalidaba y la huella del catálogo tampoco veía el cambio (ni incluía `verticalKey`).
- Arreglo: `describe()` guarda `edit` (fecha de edición); las fotos editadas se anotan en `hf.imgedit` y esa fecha va en la llave
  de la caché (`imgKey`); la lectura incremental (`scan` con `photos`) pide de a 100 los mensajes de las fotos ya conocidas y
  devuelve las editadas (siempre al pulsar ↻, y cada 15 min en las automáticas: `chk` en `hf.scan.<cuenta>`); la huella de
  repintado (TV `browseSigNow`, celular `catalogSig`) incluye `verticalKey` y `HFTelegram.imageStamp`. Prueba: `tools/test-catalog.mjs` (7).
- Cómo llega: OTA (sin `--programa`). Después, ↻ en TV/celular.
- Mismo hotfix (1.1.88): «＋ Preparar una película nueva» (Inicio) ahora llama a `PREP.newMovie()` → `resetForm()` (o `exitQueueView()` si se
  estaba viendo una película de la cola): deja las pestañas 1 a 4 en blanco (archivo, nombre, año, temporada/capítulo, descripción, TMDB,
  pistas de audio/subtítulos, calidades guardadas, imágenes, archivos y avance). Si hay una publicación manual en curso (`formBusy`), no borra y avisa.

## «Portadas y banners» en una sola pantalla (SIN publicar, candidato 1.1.89)

- `biblioteca.css` (bloque final, solo con ventana ≥1101 px de ancho y ≥560 de alto) + `biblioteca.js` (`body.img-on`, `restoreImgScroll`):
  sin scroll general; la lista de imágenes (`.ilist`) y el panel de la derecha se desplazan por dentro; el ancho ya no se limita a 1440;
  miniaturas en tarjetas grandes (16:9 en horizontal/banners, póster 2:3 en la vista vertical, cada una en su forma real para ver las mal
  hechas); la vista previa vertical del panel es un póster 2:3 (antes un rectángulo 16:9). Al redibujar se conserva el scroll de la lista
  (misma sección/filtro) y del panel (misma imagen); la imagen elegida siempre queda a la vista. En pantallas bajas (<860 px) se compacta el encabezado.
- Verificado con datos de ejemplo en el preparador de desarrollo (1920×1000 y 1366×768); no con el grupo real.
- Inicio como panel (candidato 1.1.89, SIN publicar): `body.home-on` (mismo patrón que `img-on`): sin scroll general; arriba título + «Imágenes por revisar» + ↻;
  una fila de 8 fichas de resumen (la línea explicativa pasó a `title`); y un panel con cabecera (filtro activo, buscador y el interruptor
  Horizontal | Vertical, guardado en `hf.preparador.tarjetas`) y la cuadrícula `.pgrid` que es lo único que se desplaza (se conserva el scroll
  al redibujar mientras no cambie filtro/búsqueda/forma). Las tarjetas verticales usan `verticalKey` (o la horizontal recortada si no hay).
- Miniaturas en blanco en listas largas (candidato 1.1.89, SIN publicar): cada imagen pedía su mensaje a Telegram por separado y en orden de llegada, así que al
  bajar de prisa las de pantalla esperaban detrás de las ya pasadas (y con muchas peticiones salía FLOOD_WAIT). Ahora `msgByKey` agrupa
  las peticiones (UNA llamada por hasta 100 mensajes), `prioritizeThumbs` pone primero las que se ven y pide juntos los mensajes de las
  siguientes, y mientras llega la imagen hay un brillo suave (se apaga si no existe: `data-none`). Probado con un Telegram falso: 60 portadas = 6 llamadas.
- Filtro por categoría en Inicio (candidato 1.1.89, SIN publicar): fila de botones bajo la cabecera del panel (`B.cat`, `ACT.cat`, `catOf`/`catRank` en biblioteca.js).
  Usa `HFLibrary.primaryCategory(t, true)` (la misma única categoría de la TV: Marvel > Infantil > género; los alias «Accion», «CienciaFiccion»… ya
  salen unidos) y `HFLibrary.CATEGORIES` para el orden; «Sin categoría» al final. Los números cuentan sobre lo que deja pasar la ficha de resumen de
  arriba y se combinan (Y) con el buscador; si la elegida deja de existir, vuelve a «Todas».
- «Agregados recientemente» pasa de 5 a 10 títulos (candidato 1.1.89, SIN publicar): `js/ui/library.js` (TV Samsung y Android TV, fila «recent») y
  `mobile/m.js` (celular), con la nota «los últimos 10». Lleva `--programa`? NO: es solo web (la OTA basta).

## Grupos con temas (foros de Telegram) — candidato 1.1.89, SIN publicar, sin probar contra Telegram real

Idea del usuario: un grupo con temas donde cada película/serie vive en SU tema (versiones, portada, banner, vertical, galería, miniaturas, subtítulos), y
migrar lo del grupo actual copiando (reenviar sin autor, sin volver a subir) ordenado por tema. Las apps no cambian: la búsqueda de Telegram atraviesa
todos los temas (misma lectura `searchMessages` de siempre).

- `tools/preparador/temas.js` (global `PrepTopics`; servido en `/temas.js`, incluido en `publicar-version.mjs`):
  · `patch(client)`: envuelve `sendMedia`/`sendMediaGroup`/`sendCopy`; si el chat es foro (`chat.isForum`, recordado en `hf.preparador.foros`) y el
    comentario es de HomeFlix, agrega `threadId` = tema del título (se crea si no existe; varias subidas a la vez comparten la creación).
    Tema de película: «Nombre (2020)»; serie: «Nombre (serie)» (todos sus capítulos); foto sin año se une al tema de la película con año. Lo que no
    es de HomeFlix no se toca. Se aplica en `tgClient()` (ui.html), así que cubre cola, publicación manual, imágenes nuevas y todo lo demás.
  · `ensureTopic`/`topicFor`: `makeTopic(o)` en `sendJob` (ui.html) crea el tema justo al terminar el paso a paso (al mandar a la cola).
  · `plan(items)`: usa `HFLibrary.build` para quedarse con los videos VIGENTES (versión actual de cada calidad y todas sus partes) y, de fotos/subtítulos/hojas, el más
    nuevo de cada lugar; lo sin comentario va al tema «Sin clasificar»; lo viejo/repetido se lista como «no se copian».
  · `migrate(...)`: crea el tema, `client.forwardMessages({noAuthor:true, toThreadId})` en tandas de 40 por chat de origen, en el orden imágenes → videos → subtítulos →
    miniaturas; guarda el avance tras cada envío (se reanuda), espera ante FLOOD_WAIT y se puede detener. Devuelve el mapa «chat:viejo → chat:nuevo».
- Pantalla «Migrar a grupo con temas» (botón en Inicio; `viewTemas` en biblioteca.js, vista `temas`, estado `TM`): elegir el grupo con temas destino (los chats con
  `isForum`), ver el plan, marcar qué temas migrar (para probar con 1–2 primero), Empezar/Continuar/Detener, mapa descargable, comprobar y «Usar el grupo nuevo».
  El avance se guarda en `hf.preparador.migracion.<origen>.<destino>`.
- Prueba: `node tools/test-temas.mjs` (Telegram falso: temas, concurrencia, plan, reenvío, reanudar, FLOOD_WAIT).
- FALTA / riesgos: (1) probar de verdad en un grupo de prueba con temas (crear tema, reenviar a tema, permisos de administrador); (2) que la TV y el celular guarden el
  progreso/Mi lista/etiquetas al pasar al grupo nuevo (las claves son chat:mensaje y cambian): usar el mapa para `HFLibrary.aliasKeys` en una segunda fase;
  (3) agregar el grupo nuevo en Ajustes de cada dispositivo; (4) el grupo viejo no se toca.
- Respaldo en un grupo nuevo (candidato 1.1.89, SIN publicar, sin probar contra Telegram real): botón «Respaldar en grupo nuevo» a la izquierda de «Migrar…» en Inicio
  (`ACT["rb-go"]`, misma vista `temas` con `TM.mode = "respaldo"`). «Crear y respaldar» pide confirmación, crea un supergrupo privado CON TEMAS
  (`client.createSupergroup({title, forum:true})`) y copia con el mismo `PrepTopics.migrate` (un tema por película, sin volver a subir). También se puede elegir
  un respaldo anterior y pulsarlo de nuevo: solo copia lo NUEVO (el estado `hf.preparador.respaldo.<origen>.<destino>` recuerda lo copiado; `done` se vacía en cada corrida
  y lo ya enviado se salta). Recuerda el último respaldo por origen (`hf.preparador.respaldos`). Solo copia lo vigente (como la migración); lo borrado en el origen no se borra del respaldo.
  Prueba: `tools/test-temas.mjs` (4b: segunda corrida solo envía lo nuevo) y a mano con un Telegram falso en el 5181.
- «Migrar a grupo con temas» también crea el grupo (tarjeta «Crear y migrar», igual que el respaldo). PROBADO CONTRA TELEGRAM REAL (2026-11-13, dos grupos de prueba creados y BORRADOS con
  `deleteSupergroup`): se creó el grupo con temas, un tema por película («Iron Man 1 (2008)», «Depredador…»), cada mensaje quedó en su tema y en el orden del plan, sin cabecera de
  reenviado (sin autor), con su comentario; la búsqueda por filtros (video/foto/documento) encuentra todo a través de los temas (las apps no cambian); publicar con `sendMedia`
  cae en el tema (foto sin año se une a «Nombre (año)»; serie → «Nombre (serie)»); el respaldo copió 2 películas y una segunda corrida no repitió nada.
  Error real encontrado y corregido: `client.forwardMessages` pide objetos Message; con números hay que usar `client.forwardMessagesById` (temas.js ya lo usa; la prueba lo vigila).
- Rediseño de «Migrar / Respaldo» (candidato 1.1.89, SIN publicar): izquierda = tres tarjetas con aire (1 Grupo de destino con pestañas «Crear grupo nuevo» | «Usar grupo existente»;
  2 Resumen; 3 Ejecución con estado, barra de 8 px, contador y botones por jerarquía: «Más opciones ▾» [mapa .json, Empezar de cero en rojo con confirmación] · «Verificar en Telegram» · botón dorado
  único: Iniciar/Continuar/Pausar/«Activar y usar este grupo»). «Crear grupo» SOLO crea y deja elegido el grupo (`ACT["tm-crear"]`); la copia la inicia el paso 3. Derecha = buscador, píldoras
  Todos/Marcados/Sin marcar, Marcar/Quitar sobre lo que se ve, tarjetas con «Se copiará»/«Omitido»/«Ya migrado»/«Respaldado»; la lista se repinta sola al buscar y conserva su scroll.
  Estado nuevo en `TM`: tab, q, f, menu, pickOpen. Microcopy largo pasó a `title` (tooltips).
- Inicio, rediseño de cabecera/filtros/tarjetas (candidato 1.1.89, SIN publicar): (1) cabecera: nombre del chat + conteo + estado de lectura + ↻ a la izquierda; a la derecha «Herramientas ▾» (Imágenes por revisar con su cuenta,
  Migrar a grupo con temas, Respaldar en grupo nuevo, Elegir otro chat) y el botón dorado «＋ Preparar película» (salieron del pie, que ahora solo dice el estado). (2) una sola barra: píldoras de estado SOLO con
  resultados (los que están en 0 van en «Más ▾»; `TILES`, `counts`), «Categoría: … ▾» (menú con cuentas; sustituye la fila de 12 píldoras), buscador (atajos «/» y Ctrl+K) y selector ▭ ▯ ☰ (Horizontal, Vertical, Lista).
  (3) tarjetas: etiqueta semántica (`tagOf`: ámbar = falla real, gris = incompleta, ✓ = lista), pie de 2 líneas (título+año; calidades en verde/apagadas + idiomas compactos 🔊 ES EN 💬 ES EN con ámbar solo lo que falla),
  más aire (≈6 columnas horizontales / 8 verticales en 1080p). (4) Vista Lista: tabla ordenable por Título/Año/Categoría/Calidades/Estado (`tableHtml`, `ACT["th-sort"]`). Menús: `B.pop` ("tools"|"cat"|"more"), se cierran al tocar fuera/Esc.
- Pulido de Inicio (candidato 1.1.89, SIN publicar): tabla con Año/Calidades/Idiomas centrados bajo su título y estado en color (ámbar fuerte = falla, ámbar suave = incompleta, neutro «✓ Completa»); tarjetas con
  el título en una línea con «…» (nombre completo en el tooltip nativo `title`) que nunca pisa el año, y etiqueta superior uniforme (22 px, margen 8 px) sobre una franja degradada; menús
  desplegables que se acomodan a la pantalla (`fitPops`). Logo de la cabecera 54 px.
- Ficha de una película (candidato 1.1.89, SIN publicar): columnas equilibradas — izquierda: cabecera, «Calidades en el grupo» y «De dónde salen las calidades nuevas» (`sourceSection`) justo debajo;
  derecha: Idioma (arriba, con borde ámbar si hay error), «Comentario en el grupo», «Portada, banner, vertical y galería» y «Miniaturas para recortes». El error de pistas es una tarjeta `.alerta`
  (ícono ⚠, código TIMEOUT, ayuda y «Reintentar lectura»); la galería vacía es una zona punteada `.galempty` con «＋ Agregar escenas». En series, los capítulos quedan en la izquierda.
- Ficha, columna derecha en pestañas (candidato 1.1.89, SIN publicar): `fichaTabs` en biblioteca.js — «Idiomas y subtítulos» (por defecto), «Comentario» (caja grande + «Copiar») e «Imágenes» (portada, banner, vertical y galería; no en series).
  Un punto ámbar (`.fdot`) en la pestaña que pide atención (error de pistas, idiomas faltantes, subtítulos con fallas o por separar; imágenes con problemas; comentario vacío). Estado en `B.fTab`, se reinicia a «idioma» al abrir otra ficha.
  Miniaturas para recortes quedó en la columna izquierda.
- Ficha, pestaña «Idiomas y subtítulos» más densa (candidato 1.1.89, SIN publicar): con ≥1450 px, audio y subtítulos de los videos van lado a lado (tarjetas altas: nombre arriba y selector abajo); subtítulos aparte en renglones
  compactos (botón corto «Forzados»/«✓ Forzados», línea de revisión de una sola línea con el detalle en `title`, ⚠ si hay fallas); «Guardar idiomas» (`langSaveRow`, `.lfsave`) quedó al final de la pestaña y pegado abajo
  de la pantalla (sticky) mientras haya algo que guardar. «Comentario»: caja que ocupa el alto disponible (solo lectura + Copiar). «Imágenes»: cuadrícula de tarjetas (`.vlist.g3`).
- Ficha: pestaña Idiomas aún más compacta y columnas al mismo nivel (candidato 1.1.89, SIN publicar): se quitó el título «Idioma» de la pestaña (queda el estado y ↻ a la derecha, `.lstat`); audio en filas de una línea
  (nombre + selector a 140 px) con subtítulos de los videos a un lado (rejilla 1.9fr/1fr desde 1450 px); y `.s5 {align-items: stretch}` + `.stack > section:last-child {flex: 1}` hacen que la última tarjeta de la columna más corta se
  estire hasta el final de la otra (medido: 753 px ambas). `clear: both` en los bloques de la pestaña para que el estado flotante no los estreche.
- Ficha sin scroll general (candidato 1.1.89, SIN publicar): `body.fi-on` (clase puesta en `show()`/`render()`, con ≥1101×560) fija `#lib` a la altura entre cabecera y pie y quita el relleno doble de abajo; si algo no cupiera (pantalla baja),
  se desplaza SOLO `#lib` por dentro (a 1366×768 la pestaña Idiomas mide 740 px sobre 623 disponibles). El botón «Guardar idiomas» pegado queda a 8 px del borde de `#lib`.
- Publicar en grupos con temas desde los botones de la ficha (candidato 1.1.89, SIN publicar): «Solo publicación (4)» y «Calidades y publicación (3 y 4)» siguen publicando con el mismo cliente de Telegram, que
  (`PrepTopics.patch`) manda cada mensaje al tema de su película SOLO si el chat es un foro; en un chat sin temas todo queda como antes. Lo ya publicado no cambia de lugar: lo nuevo se agrega en el tema de la película y la
  edición de mensajes existentes (idiomas, «Reemplazar en el grupo») se hace en el propio mensaje, así que se queda en su tema. `findTopic` ahora también reutiliza un tema del mismo nombre sin año (antes lo duplicaba).
  La pestaña 4 («Dónde se publica») dice en vivo si el chat tiene temas y en cuál tema va esta película (`renderTopicNote`, `PrepTopics.find`/`refresh`).
- Tarjeta gráfica en la cabecera: `gpuInfo()` (prepare.mjs, nvidia-smi y respaldo por PowerShell, se lee una vez) llega en `/api/state` (`gpuInfo`); la insignia dice «RTX 3050 lista» y el tooltip, nombre completo, memoria y controlador.
- Paso 1 en dos fases (candidato 1.1.89, SIN publicar; ui.html): barra `#s1nav` «A · Archivo y pistas» / «B · Ficha y comentario» (`showSub1`, `S.sub1`). A = tarjeta ancha del video (ruta, fichas de datos, pistas de audio/subtítulos a un lado y «De otro archivo» al otro con un
  menú «＋ Agregar ▾» en vez de tres botones: `S.xmenu`, `renderExtras`). B = izquierda «¿Qué es?» + TMDB; derecha «Datos» y, debajo, «Comentario para Telegram» (antes abajo a la izquierda). «Siguiente» pasa de A a B y luego al paso 2;
  «Atrás» vuelve a A; los avisos «Cambiar en el paso 1» de «Revisa antes de enviar» abren B; al dejar el formulario en blanco (`resetForm`) se vuelve a A. Todos los ids de los campos se conservaron. Pendiente de verlo con un video real (aquí se simuló la lectura).
- CORRECCIÓN del paso 1 (candidato 1.1.89, SIN publicar): las fases A/B se QUITARON a pedido del usuario (el paso es casi automático por TMDB); ahora todo el paso 1 está en UNA pantalla sin scroll general (`.s1u`, `body.s1-on`): izquierda = «Video original»
  (ruta + fichas + pistas lado a lado + «De otro archivo» en una botonera horizontal) y «Comentario para Telegram» abajo, que se estira; derecha = «¿Qué es?» (Película/Capítulo en la misma línea) con la ficha de TMDB compacta (pósters 72×104, detalle en poco alto)
  y «Datos» (nombre+año, categoría+infantil en una fila, descripción que se estira). Si la pantalla es baja (<~830 px útiles) se desplaza solo `main` por dentro. Se revirtió el menú «＋ Agregar ▾» y `showSub1`.
- Estándar beUI en el preparador (candidato 1.1.89, SIN publicar; ui.html): (1) CASILLAS — todas las `input[type=checkbox]` (menos los interruptores `.swt`) siguen beui.dev/components/motion/checkbox: cuadro de 20 px, radio 6, borde 2 que se ilumina al pasar el cursor,
  relleno dorado, palomita que se dibuja (clip-path `hfCheckDraw`, 0,3 s; raya `hfDashDraw` para «parcial»/`indeterminate`), salida con desenfoque, rebote al presionar (0,92), aro de enfoque, 60 % si está desactivada, sin animación con `prefers-reduced-motion`.
  (2) TOOLTIPS — el «title» de todo el preparador se muestra en un globo propio (`#hftip`, `.hftip`) con el estilo del popover «Hover me» de beUI (esquinas de 16, fondo #1d1e21, brota con escala+desenfoque, pausa de 140 ms, margen de gracia, también con el teclado); el JS está al final del script
  principal (delegación de eventos: sirve para lo que se cree después) y convierte `title` en `data-tip` (y en `aria-label` si el elemento no tiene texto). `data-notip` lo excluye. La TV y el celular tienen su propio sistema y no se tocaron.
- Destacado con «Circle blur» en TV y celular + vista previa en el celular (candidato 1.1.89, SIN publicar; solo web, va por OTA sin --programa):
  · TV (`js/ui/library.js` `swapHero`/`revealHero`/`dropHeroGhost`, `css/app.css`): el destacado anterior queda quieto DEBAJO (hermano, `.ghost2`, absoluto con las medidas del nuevo) y el nuevo se revela encima con
    `clip-path: circle(0% → 150%)` + `blur(8px → 0)` en 700 ms (`cubic-bezier(.4,0,.2,1)`), con origen en el selector de destacados (variante «circle-blur» de beui.dev/components/motion/theme-toggle, hecha con `Element.animate`, NO con
    View Transitions, que no existen en las TV viejas). Si el motor no anima, el cambio es instantáneo. La vista previa de la TV (HeroPv, 3 s) ya existía.
  · Celular (`mobile/m.js` `heroSetup`/`heroReveal`/`heroGo`, `mobile/m.css`): los destacados pasan de carrusel con scroll a pila de tarjetas (`.m-heros` en rejilla, `.cur`/`.under`); cambia con el mismo círculo desde el punto tocado o el final del deslizamiento (≥42 px, horizontal).
    Tras 2,5 s en un destacado arranca una vista previa muda (`HeroPv`, mismo motor `Player` y la versión ≤720p, desde ~30 %, 45 s) con fundido sobre la imagen; se corta al cambiar de destacado, bajar la página, salir de Inicio (`leave`), reproducir (`play`) o esconder la app.
  · Probado con el modo tablero (`?design=home` en celular, `index.html?design=browse-home` en TV): el círculo corre y se limpia. NO probado en una TV Samsung/Android real (el desenfoque grande puede costar fps en TVs modestas) ni la vista previa de video del celular (requiere Telegram).

## Publicada la 1.1.89 (2026-11-13)
Salió por OTA con todo lo acumulado desde la 1.1.88 (destacados «Circle blur» en TV y celular con vista previa en video en el celular, «Agregados recientemente» 10, rediseño del preparador, grupos con temas, GPU visible). Sin `--programa` (nada nativo cambió). Pendiente: probar el destacado en la TV real y, después, la fase 2 de grupos con temas (progreso/Mi lista/etiquetas).

## Efecto del destacado en la TV y espera de la vista previa (2026-11-13, sin publicar → 1.1.90)
- Medido en la TV real (Samsung QN55Q65BAKXZL «TV 55», Tizen 6.5, Chromium 85) por sdb + CDP: «Circle blur» daba 15-23 cuadros/s (11 cuadros lentos por cambio, hasta 260 ms); círculo sin desenfoque igual de lento; círculo corto 7-8 lentos; **fundido de opacidad = 42-46 cuadros, 3-4 lentos (igual que sin efecto)**. La TV usa ahora `revealHero` con fundido de 450 ms; el celular conserva círculo + desenfoque.
- Espera de la vista previa: `HERO_PV_DELAY` 3000/2500 → 400 ms en TV y celular (en el celular además cuenta desde el cambio, no desde que termina la animación). Lo que más pesa es la carga del motor desde Telegram (~3,4 s hasta «playing», no depende de `startAt`).
- Depurar la TV: `sdb connect <IP de la TV>` (puerto 26101; la IP de la TV, no la del PC), `sdb -s <ip>:26101 shell "0 debug etDyBtbRRH.homeflix"` devuelve el puerto; `sdb forward tcp:9333 tcp:<puerto>` y CDP en http://127.0.0.1:9333/json. Teclas con `Input.dispatchKeyEvent`.

## Rendimiento del cambio de destacado en la TV (2026-11-13, sin publicar → 1.1.90)
Medido en «TV 55» (Q65B, Tizen 6.5) por sdb + CDP: 5 cambios seguidos de destacado, 3 repeticiones, cada 1,3 s («pausado») o cada 450 ms («rápido»).

| Versión | FPS (pausado / rápido) | Cuadros lentos >50 ms | Peor cuadro |
|---|---|---|---|
| **1.1.88 (estable anterior: imagen que se desliza 64 px + zoom, texto en cascada, anterior que se desvanece encima)** | 29 / 18 | 30 / 19 | 363 / 325 ms |
| 1.1.89 (círculo + desenfoque) | 23 / 11 | 51 / 29 | 318 / 257 ms |
| Fundido de opacidad solo | ~22 (rápido) | ~15 | ~380 ms |
| Exp.1 fundido 320 ms, Exp.2 micro-zoom, Exp.3 `decode()`, Exp.4 cortina negra | 15-22 (todos igual) | 15-22 | 330-350 ms |
| **Nueva: sin máscaras + contorno en caché + vecino precreado + fundido** | **48 / 37** | **8 / 14** | **147 / 191 ms** (60-85 ms en repeticiones ya calientes) |

Hallazgos: (1) el efecto casi no importaba: los experimentos 1-4 dan lo mismo porque el cuello de botella era otro; (2) las dos `mask-image` anidadas del destacado (.hf2-bb-art y .hf2-bb-media) costaban ~9 fps: se reemplazaron por degradados superpuestos del color del fondo (equivalentes matemáticamente, ver css/app.css); (3) `shapeHeroSwitch` medía offsetWidth y forzaba un layout de toda la página (~20 ms + segundo layout): ahora se cachea por (nº de puntos, dígitos); (4) con 5 ms de JS, los dos primeros cuadros tras insertar el destacado nuevo tardaban ~200 y ~150 ms (pintado/rasterizado de la capa de 1920×780): `heroPrebuild` arma el vecino 0,7 s después de cada cambio en una capa con opacidad 0,01 y `swapHero` solo intercambia papeles (si se pulsa más rápido de lo que tarda, se arma en el momento como antes); (5) `img.decode()` y quitar la imagen no cambian nada: la imagen no era el problema. El celular conserva círculo + desenfoque.
Trampa de medición: al inyectar código por CDP, un script que reasigna `window.swapHero` en el mismo `Runtime.evaluate` que declara `function swapHero` pisa la función nueva (el hoisting la declara antes); cargar el código en una llamada aparte.

**Decisión (2026-11-13): el modo liviano es solo para la TV Samsung.** `heroLite()` (= `!window.HF_TV`) activa en js/ui/library.js: fundido de opacidad, destacado vecino precreado y contorno del selector en caché; y en css/app.css las capas de degradado en lugar de las máscaras. En Android TV (el APK; js/androidtv.js pone `HF_TV` y la clase `hf-atv` en `<html>`) y en el celular se conserva «Circle blur» (círculo + desenfoque 700 ms) y las máscaras de siempre. Verificado simulando HF_TV en la Samsung: círculo `0% → 150%` con `blur(8px → 0)`, sin precreado y con las máscaras originales. Re-medido el modo liviano con cambios reales: ~42-45 FPS pausado y ~30 rápido, 8-12 cuadros lentos (la tabla anterior, 48 / 37, fue una tanda mejor). Pendiente: probar en vivo en el Android TV real (IP:puerto de la depuración inalámbrica).

**Medido en el Android TV real (2026-11-13):** stick «Tv habitación adry» (Chromecast con Google TV «sabrina», Android 14, 192.168.0.9; depuración inalámbrica: `adb pair` con el código de la pantalla «Emparejar con dispositivo» y `adb connect` al puerto de la pantalla principal de Depuración inalámbrica, que son puertos distintos; si el PC ya estaba emparejado hay que «Olvidar» el dispositivo en la TV y emparejar de nuevo). Se le instaló un APK de depuración armado del árbol de trabajo (`ANDROID_SERIAL=… node tools/build-apk.mjs --install`; el stick tenía la 1.1.68). 5 cambios de destacado, 3 repeticiones, pausado (1,3 s) / rápido (450 ms):
- Android TV con «Circle blur» (lo que quedó para Android TV): 35 / 19 FPS, 25 / 18 cuadros lentos, peor cuadro 300 / 583 ms.
- Mismo equipo en modo liviano (solo prueba): 47 / 35 FPS, 7 / 5 cuadros lentos, peor cuadro ~306 / 333 ms.

**Decisión final (2026-11-13, reemplaza la de «solo Samsung»): el modo liviano va en TODAS las TV** (Samsung y Android TV). Se quitaron `heroLite()`, la clase `hf-atv` y el bloque CSS de Android; el celular conserva «Circle blur». Medido en el Android TV con el código final (APK de prueba instalado en el stick): 47 FPS pausado / 34 rápido, 6 cuadros lentos, peor cuadro 300-340 ms (antes con el círculo: 35 / 19 FPS y 25 / 18 lentos). Trampa de medición: en la TV el foco puede estar en «hero» o en una fila y no en «hero-dots»; comprobar `currentArea().name` y llevarlo con `focusAreaByName("hero-dots", 0)` antes de medir (si no, ◀ ▶ no cambian de destacado y salen 60 FPS falsos).

## Publicada la 1.1.90 (2026-11-13)
Salió por OTA (sin --programa): modo liviano del destacado en todas las TV (fundido + vecino precreado + degradados en lugar de máscaras + contorno en caché), celular con círculo + desenfoque, espera de la vista previa 0,4 s. Pendiente: que el usuario la pruebe con ↻ en la Samsung y en el stick.

## Preparador · paso 2 reorganizado (2026-11-13, sin publicar)
Las dos tarjetas del paso 2 miden lo mismo (`.s2` con `align-items: stretch`); las opciones son más compactas; «Ajustes avanzados de codificación» pasó a ser un botón secundario con engranaje y chevron, anclado al borde inferior de la columna izquierda; el resumen de partes («Con estas opciones: 4K en 3 partes…») ya no es un texto pasivo: está oculto hasta que hay un video elegido en el paso 1 y entonces aparece como aviso con ícono al pie de la columna derecha (`#planBrief`, `renderPlanNote`). Verificado en el navegador con y sin el aviso y con los ajustes avanzados abiertos.

## Preparador · paso 3 reorganizado (2026-11-13, sin publicar)
- «Revisa antes de enviar» ahora es un resumen plegable de una línea (punto verde/ámbar/rojo, chips con película, categoría, perfil, ficha y versiones, y a dónde va); se abre solo si hay algo dudoso y luego respeta lo que elija el usuario. Dentro conserva las tarjetas con «Cambiar en el paso N».
- Tarjetas de calidad: número grande de partes (o «1 archivo»), peso por parte y total debajo, e insignias de color («Copia directa» dorada; «Igual que el original»/«Se verá bien» verde; «Aceptable» ámbar; «Calidad baja» roja).
- Los dos avisos del plan son un solo cuadro (`.callout`) con una fila por aviso, ícono y color (la clase de la fila informativa es `tip`, no `info`, que ya existe).
- «Proceso» compacto; mientras se procesa se enciende el borde y el título dice «· en curso» (clase `live` en `#progSec`, la pone `updateTabs`).
- Probado con datos de prueba inyectados en el navegador (sin Telegram). Falta verlo con un video real y con un proceso en marcha.

## Preparador · paso 4 reorganizado (2026-11-13, sin publicar)
- Arriba, una barra de destino de dos columnas: «Dónde se publica» (chat, Cambiar y nota de temas) y «Carpeta a publicar» (los mismos ids: tgDot, tgStatus, tgChange, topicNote, pubDir, pickPub, loadPub).
- Izquierda (430 px): «Portada y banner» con el texto de ayuda más corto, y «Galería de escenas» plegable con contador (`#galBox`, `#galCount`; se abre sola la primera vez que hay escenas).
- Derecha (`.rcol`, sticky con scroll interno): el simulador de la TV y, debajo, «Qué se va a publicar» (antes ocupaba todo el ancho al final). En pantallas de ≤1100 px vuelve a una columna sin sticky.
- Verificado con datos de prueba (1500×900): la columna derecha mide 638 px de 727 disponibles; la izquierda 368 px, 552 con la galería abierta.

**Preparador · paso 4: «Ver como» TV / Tablet / Celular (2026-11-13, sin publicar).** El simulador tiene un interruptor (`#pvsw`, se recuerda en `localStorage` «hf.preparador.pv») que cambia la vista previa: TV (como antes), Tablet o Celular. Celular y tablet muestran la tarjeta del destacado de la app móvil (mobile/m.css: banner 16:9 con degradado, título, año · duración · categoría, «Reproducir» / «Más info», puntos y una fila con la portada) dentro de un marco, a escala con `zoom` (celular 390 px, tablet 820 px; la app móvil no tiene diseño propio de tablet, solo se ensancha). Cuidado con los nombres de clase: `.tab` y `.dvf` ya existían en la página (por eso las clases nuevas son `.pvf`, `.pvi` y `.tb`).

## Corte del 4K por peso real (2026-11-13, sin publicar)
Con «Avatar: Fuego y ceniza» (4K de 13,7 GB, copia directa) el corte repetía: `copyInParts` cortaba por tiempo suponiendo un peso parejo por segundo, una parte salía de ~2,1-2,3 GiB (el tope real es 2000 MB = 1,95 GiB) y el programa descartaba todo y repetía (copia en una pasada → copia entera → 4 cortes de ~10 min cada uno; casi 1 h en total, y se canceló). Ahora, si una parte se pasa, `fixOversize` (prepare.mjs, exportada) vuelve a cortar SOLO esas partes: lee el peso real de cada paquete de video con ffprobe, reparte audio/subtítulos por segundo y corta en el cuadro clave más lejano que todavía quepa (presupuesto 98,5 % del tope). Lo usan `copyInParts` y `splitCopy` (el recorte por tiempo con márgenes queda como último recurso). Prueba: `node tools/test-corte.mjs` (video de 60 s con ruido en el medio; 11 comprobaciones). No probado todavía con el 4K real de Avatar.
Trampa al cancelar solo una calidad: detener únicamente el ffmpeg del corte (taskkill del PID) hace que el programa registre «rung-error» de esa calidad, borre sus temporales y cierre las demás; el botón Cancelar marca toda la película como cancelada.

## Versión web: traída de la rama «web» al árbol actual (2026-11-13, sin commit ni publicar)
- La rama `web` (también en origin/web, worktree en `../homeflix-web`) tiene 6 commits del 2026-11-08: la PWA base de Diego Bolaños (datos de demostración) y 5 de Santiago: motor real de Telegram, las mismas pantallas del celular y de la TV sin diseño propio, y `tools/serve.mjs --https`. Su CLAUDE.md (`web/CLAUDE.md`) dice qué falta: adaptar las pantallas de la TV al mouse en el computador y publicar la web con https y la clave inyectada. Sin avances desde el 8 de noviembre; el worktree tiene 18 archivos sin guardar de esa misma fecha (una versión anterior del motor de cuenta, que el árbol actual ya supera).
- Se copió `web/` (index, manifest, sw, iconos, CLAUDE.md) con `git archive web web` y se pasaron a mano los cambios compartidos: `app.html` (atributo `data-web="pc"` con `?web=1`) y `css/app.css`, `mobile/m.js` (`playerMode()`: pantalla completa en el navegador y mensaje de arranque con error), `js/telegram.js` y `js/ui/access.js` (aviso de «conexión segura»), `tools/serve.mjs` (con `--https`; en http escucha solo en 127.0.0.1), `.gitignore`, README. `web/index.html` y `web/sw.js` ahora cargan la misma lista de scripts que `mobile/index.html` (catalog, anime, remote, update, intro, hls, iptv).
- Comprobado en el navegador: `/web/?movil=1` llega a la pantalla de inicio de sesión de Telegram del celular (versión 1.1.90, plataforma «web»); `/web/` en una pantalla ancha redirige a `/?web=1` (la TV con mouse, sin la barra del control). No se probó iniciar sesión, reproducir ni instalar en iPhone.
- OJO: el `index.html` de la raíz ahora es un cargador (`js/arranque.js` → app.html); la rama web editaba el index.html de la TV. Por eso el atributo `data-web` va en `app.html`.

## Versión web: avance (2026-11-13, sin commit ni publicar)
Sobre lo traído de la rama `web` (ver arriba): `web/ios.js` (ManagedMediaSource para iPhone, sin probar en iPhone real), `web/instalar.js` (aviso de instalación), `js/web-pc.js` (mouse en la TV del computador: foco al pasar, rueda, botón atrás; verificado con eventos en el demo `?web=1&design=browse-home`), reglas de tablet al final de `mobile/m.css`, aviso en `play()` si el iPhone no puede reproducir y `tools/build-web.mjs` (arma `dist/web/` con la clave inyectada; 97 archivos, 7,2 MB, sin el hash en claro). Detalle y pendientes en `web/CLAUDE.md`.

**Corrección (2026-11-13): letras fantasma detrás del destacado.** El destacado vecino que se arma de antemano (`heroPrebuild`, js/ui/library.js) esperaba encima del actual con opacidad 0,01; en una pantalla buena se alcanzaban a leer sus letras detrás del título (se vio «…iza» de «Avatar: Fuego y ceniza» tras «IntensaMente 2»). Ahora espera con opacidad 0,004 (1/255) y con la clase `pre` (`.hf2-billboard.pre .hf2-bb-copy, .hf2-bb-switch { visibility: hidden }` en css/app.css): solo la imagen se pinta de antemano. Al intercambiarlo (`swapHero`) se quita la clase. Verificado en el navegador (demo); no medido otra vez en la TV real: la mejora de cuadros viene de pintar la imagen, no el texto.

**Corrección (2026-11-13): el texto del destacado anterior no se iba del todo.** El destacado nuevo no tiene fondo propio (el degradado de la pantalla se ve a través), así que mientras se revelaba encima del anterior (círculo con desenfoque en la web; fundido en la TV) el texto viejo se veía por donde el nuevo no tenía nada y, al quitar el fantasma (780 / 520 ms después), desaparecía de golpe. Ahora `revealHero` le pone la clase `revealing` mientras dura la animación: `.hf2-billboard.revealing` lleva el mismo degradado de `#scrBrowse` (rgb(19,21,24) → rgb(15,16,18) a los 780 px). Se quita al terminar la animación. Comprobado por estilos calculados en el navegador (demo); no pude capturar un fotograma intermedio con fiabilidad.
**Corrección (2026-11-13): parpadeo del texto viejo al final del cambio de destacado.** El fondo opaco `.revealing` se quitaba al terminar la animación (700 ms en la web, 450 ms en la TV), pero el destacado anterior (fantasma) se quitaba por temporizador (780 / 520 ms): durante ~80 ms el texto viejo se veía a través del nuevo, en cada cambio. Ahora `terminaRevelado()` (js/ui/library.js) quita primero el fantasma y después el fondo, y solo si ese destacado sigue siendo el actual. Medido cada 8 ms en 3 cambios seguidos: 0 cuadros con el fantasma presente y sin fondo.
**Web en computador: selector de destacados sin el contador (2026-11-13).** Con `data-web="pc"`, `css/app.css` oculta el «1 de 6» (`.hf2-bb-dots small`) y `shapeHeroSwitch` (js/ui/library.js) dibuja el contorno como una sola píldora (sin la pestaña de abajo; la clave de caché lleva `:s`). Queda centrada: el centro de flechas y puntos cae en el centro de la ventana (diferencia 0 px a 1920×911). La TV y el APK siguen con el contador.

**Menú superior: desfase al pasar el mouse rápido (2026-11-13).** El deslizamiento FLIP del menú (`menuLayout`, js/ui/core.js) medía las posiciones nuevas con el `transform` de la animación anterior todavía puesto; con cambios de foco seguidos (pasar el mouse por los íconos, o pulsar rápido en la TV) las medidas salían falsas, el siguiente deslizamiento arrancaba de un sitio equivocado y la píldora dorada se estiraba y se salía del menú. Ahora: (1) se calcula dónde se VE cada elemento (diseño anterior + transform en vuelo, `menuVisual`), (2) se cancelan las animaciones a medias para leer el diseño verdadero y (3) se desliza desde donde se veía. Además los íconos del menú escalan desde su borde izquierdo (`transform-origin: 0 50%` en css/app.css), como las píldoras, que es lo que la cuenta del FLIP supone (antes escalaban desde el centro y se corrían hasta ~60 px). Medido en el navegador pasando el mouse 3 vueltas por los 5 íconos a 45 ms: el peor desborde bajó de 65 px a la izquierda y 23 a la derecha a 4 px a la derecha; queda 10 px a la izquierda solo en la píldora tenue, que está invisible mientras el foco está en el menú. Afecta también a la TV (mismo código); no probado allí.

## Ficha primero en todas las versiones + reproductor nativo de computador (2026-11-13, sin publicar)
- **Regla de producto (TV, celular y web): al tocar una película o serie se abre primero su ficha**; el video solo arranca con un botón de reproducir (el «Reproducir» del destacado va directo, a propósito). Antes «Continuar viendo» y «Series que empezaste» reanudaban directo en la TV (`handleBrowseSelect`, js/ui/library.js) y en el celular las tarjetas anchas de «Continuar viendo» llevaban `data-play` en vez de `data-open` (`card()`, mobile/m.js). Ahora ambas abren la ficha, donde está «Continuar» / «Reanudar» / «Ver desde el principio». Comprobado en el navegador (demo): clic en la tarjeta de «Continuar viendo» → ficha de «Hoppers» (TV/web) y ficha con «Continuar» (celular).
- **Botón atrás del reproductor con clic** (compartido, `handlePointerSelect` en js/ui/app.js): `.hf2-pl-back` no era parte del foco del control, así que el mouse (o el Magic Remote) no lo podía pulsar.
- **Reproductor nativo para computador** (`js/web-pc.js`, solo con `?web=1`): clic en el video = pausa/reanuda; doble clic = pantalla completa; barra de progreso con clic y arrastre y la hora al pasar el mouse; control de volumen con ícono (silenciar) y deslizador, recordado en `localStorage` («hf.vol»); el overlay aparece al mover el mouse y el cursor se oculta con él; sin selección de texto. Teclado: Espacio/K pausa, ←/→ (J/L) ∓/± 10 s (Shift 30 s), ↑/↓ volumen, M silenciar, F pantalla completa, Esc sale. Con un panel abierto (audio, capítulos, siguiente capítulo) se deja el teclado de la TV. El control de volumen se añade envolviendo `renderPlayerChrome`; un `MutationObserver` no sirvió (se perdía al mostrarse el error del demo).
- Probado en el demo con un reloj falso (el demo no tiene sesión de Telegram y el reproductor real queda en error): Espacio, ←, →, Shift+→, ↑, ↓, M, clic en el video, clic en el botón, clic en la barra (25 % → 1800 s de 7200), deslizador de volumen y botón atrás. No probado con video real ni la pantalla completa.

- **Ficha, botones de navegación (web PC):** `detail.js` arma `.hf2-dt-nav` con «Inicio» (`.hf2-home`, solo visible con `data-web="pc"`) y «Volver» (`.hf2-back`); `handlePointerSelect` (app.js) los atiende por clic, y el logo `.hf2-brand` también lleva a Inicio. En la TV nada cambia (el control usa BACK). Probado por clic en el demo `?web=1&design=detail-movie`.
- **Reproductor, ✕ en los paneles (web PC):** `renderTracksPanel` y `renderEpisodesPanel` (player.js) añaden `.hf2-pl-close`, visible solo con `data-web="pc"`; `handlePointerSelect` lo atiende con `closePanel()` (= BACK). Probado el de audio/subtítulos por clic; el de capítulos (posición calculada) no se pudo probar porque el demo no trae serie.
- **Reproductor (web PC):** un clic fuera del panel abierto (audio/subtítulos o capítulos) también lo cierra (`handlePointerSelect`, solo con `data-web="pc"`); un clic dentro no.
- **Fondo de la ficha con el estilo del hero:** `.hf2-dt-art` pasa de 1400x1080 a 1340x900 (como el destacado), con `::after` de degradados (izquierda y abajo) y `.hf2-dt-shade` suave; sin máscaras. Está al final de css/app.css y afecta a la TV y a la web (el celular usa mobile/m.css y no cambia). Verificado en la web (película y serie); falta verlo en la TV real.
- **Recargar sin perder el sitio (web PC):** js/web-pc.js guarda en `sessionStorage["hf.ruta"]` la cuenta, el perfil, la pantalla (inicio/sección, ficha con temporada, búsqueda con texto, o video -> ficha del título) y, al arrancar, envuelve `openProfiles`: si hay marcador entra directo al perfil (sin PIN, es la misma pestaña) y abre lo mismo. Si falta algo, muestra los perfiles de siempre; al llegar a «¿Quién está viendo?» o cerrar sesión se borra. Probado en el demo (ficha, búsqueda, borrado); falta probarlo con la cuenta real. Celular/PWA (`web/` con mobile/m.js) y TV no lo tienen.
- **Ficha, vista previa y fondo:** `detailPvArm/detailPvStart` (detail.js) reutilizan el estado `HeroPv` del destacado: a los 0,4 s suena un fragmento a todo el ancho sobre la imagen; se corta al bajar a temporadas/capítulos/filas (`HFAreaHook`), al salir de la ficha (`onLeaveRoute`) o al reproducir, y si la ficha se repinta el video vuelve a su sitio. En la web PC la imagen de la ficha se funde con máscara (`mask-composite: intersect`) para que no quede línea en los bordes; en la TV siguen los degradados superpuestos. La vista previa NO se pudo probar con video real (solo con motor simulado); falta verla con la cuenta real y en la TV.
- **Recarga dentro del reproductor (web PC):** el marcador guarda también el capítulo y el segundo (`rec.t`, cada 5 s y al cerrar la pestaña) y al arrancar abre ficha -> reproductor en ese minuto. Si Chrome bloquea el arranque automático, el video queda en pausa hasta pulsar play o la barra espaciadora. Probado el regreso al reproductor en el demo; el minuto exacto falta verlo con video real.
- **Franja del video en la ficha:** el video de la vista previa mide 888 px y el degradado 900 (`.hf2-bb-vmedia.dt` en css/app.css), para que la última fila no asome al escalar el lienzo. Probado con un video amarillo de prueba. El destacado del inicio (`.hf2-bb-pv`, 780/780) no se tocó.
- **Reproducir solo tras recargar (web PC):** `rutaReanudar` (web-pc.js): si el navegador bloqueó el arranque con sonido (video en pausa con datos listos), lo arranca SIN sonido, avisa, y con el primer clic o tecla devuelve el volumen guardado; ese clic no pausa y Espacio/K solo activan el sonido. Probado con un video simulado (arranca silenciado y se activa al primer gesto); falta verlo con video real.
- **Barra del reproductor (web PC):** la bola salta al cursor desde el primer instante, y mientras se arrastra (y hasta que el video llega al punto soltado, máx. 3 s) `window.onPlayerTime` se envuelve para que el avance del video no la mueva (`arrastre`/`retenido` en web-pc.js). Al pasar o arrastrar sobre la barra sale una vista previa (256x144) con la escena de ese segundo, tomada de las hojas «miniaturas» que sube el preparador (`item.thumbs`, `HFTelegram.fileUrl`); si la película no tiene hojas, solo la hora. Probado con hojas de prueba dibujadas; falta con las de una película real.
- **Parpadeo de la bola de la barra (web PC):** el hover lo da una zona invisible (`.hf2-pl-bar::before`, 24 px arriba y abajo, 14 a los lados) y la bola no recibe el puntero (`pointer-events: none`), así su borde ya no decide el estado; si se agarra la bola por un lado conserva el desfase (`arrastre.off`) y no salta. Probado con el mouse en dos bordes: un solo estado durante 1 s.
- **Bola de la barra, agrandado a la mitad:** al pasar el mouse crece a ~34 px (32 px del aro de enfocada x 1,05) en vez de ~43 px (x 1,35). Regla en css/app.css (`scale(1.05)`).
- **Bola de la barra (corrección):** quedaba por encima de la línea porque el agrandado llevaba `translate(-50%, -50%)` sobre un margen negativo; ahora solo `scale(1.16)` (24 → ~28 px, ~20 % del agrandado original) y, en la web, el estado «enfocada» ya no pone el aro de 32 px. Medido: centro de la bola = centro de la línea.
- **Rueda en la ficha (web PC):** la rueda baja/sube como las flechas (un paso cada 380 ms): hacia abajo pasa de los botones a temporadas/capítulos/«También de…», la cabecera se recoge y se ve la fila completa; hacia arriba regresa a los botones. Antes la rueda no hacía nada en la ficha (solo vale `setDetailScrolled` cuando el foco baja). Al recoger la cabecera se corta la vista previa. Probado en el demo con rueda real.

## Identidad de dispositivos y «Ver en la TV» hacia el computador (base del backoffice)

- **Qué es cada equipo** (`js/sync.js` `device()` / `deviceInfo()`; el servidor lo guarda en `dispositivos`, `servidor/src/base.js`, sección «IDENTIDAD DEL DISPOSITIVO»):
  `tipo` = `tv` (Samsung Tizen o Android TV) · `android` (APK de celular) · `pc` (navegador de computador, interfaz de la TV con `?web=1`) · `web` (navegador/PWA de celular o tablet);
  `plataforma` = tizen · androidtv · android · ios · ipados · windows · macos · linux · chromeos; `interfaz` = tv · movil · pc; `canal` = tizen · androidtv · apk · pwa · navegador · escritorio (a futuro);
  más `navegador` («Chrome 131»), `app` (versión OTA), `modelo` (TV), `creado` (primera vez visto) y `vista`. Para un futuro instalable de escritorio: `tipo: pc`, `canal: escritorio`.
- **Cómo llega:** en el cuerpo del PUT de sincronización (`dispositivo`) y en la dirección del canal en vivo (`?i=<json>`), no en una cabecera nueva: un servidor sin actualizar la ignora en lugar de rechazar la petición por CORS. El servidor también acepta `x-homeflix-info`.
  Las apps viejas (solo id/tipo/nombre) siguen funcionando y no borran lo ya guardado. Una base existente gana las columnas sola al arrancar el servidor.
- **Consola:** `/interno/v1/cuentas` lista por cuenta cada dispositivo con toda su identidad; `/interno/v1/resumen` suma `porTipo`, `porPlataforma` y `porVersion`. Escuchar el canal también anota el equipo en la cuenta.
- **«Ver en la TV» → computador:** el celular lista `tv` y `pc` (`mobile/m.js`, ícono `I.pc`); la web de computador ya recibía los mensajes (`js/ui/cast.js`) y ahora, al abrir lo que manda el celular, usa `HFWebPc.reanudar()` (arranca sin sonido si Chrome bloquea el sonido y avisa; un clic lo devuelve). Las pantallas (`tv`, `pc`) ignoran órdenes entre sí.
  Una sola pestaña del computador escucha el canal (Web Locks `homeflix-remoto`) para que varias pestañas del mismo navegador no se echen del canal una a otra.
- **Límites sin app de escritorio:** la pestaña tiene que estar abierta y con sesión; el celular no puede abrirla ni encender el PC; Chrome puede dormir pestañas inactivas («Ahorro de memoria»).
- **Pruebas:** `cd servidor && npm test` (18 pasan; incluye identidad, migración y `?i=`). Falta probar el envío real celular → computador con la cuenta real y publicar el servidor en el VPS (no es obligatorio para que el computador aparezca, solo para ver la identidad completa).
- **Selector de destacados con puntero:** todo el selector es UN elemento enfocable con `data-action="hero-next"`, así que cualquier clic avanzaba. `handlePointerSelect` (app.js) ahora detecta la flecha izquierda (retrocede), la derecha (avanza) y cada punto (salta a ese destacado de la ventana de 6) vía `heroPointerPick` (library.js). Teclado y control remoto no cambian. Probado por clic en el demo (avanzar, retroceder con vuelta al final, punto).
- **Búsqueda (web PC):** (1) clic en el menú desde la búsqueda no volvía: `renderBrowse` pintaba detrás pero la ruta seguía en `search`; `handleSearchSelect` ahora hace `showRoute("browse")` para Inicio/Películas/Series/Mi lista/Anime (esto también vale para la TV con puntero). (2) botón ‹ (`.hf2-s-back`) y ✕ para borrar lo escrito (`.hf2-s-clear`, solo con texto), visibles solo con `data-web="pc"`. (3) los resultados tienen scroll propio (`#scrSearch .hf2-page`, rueda y barra nativa) y hasta 60 resultados en vez de 15; con las flechas el foco se mantiene a la vista (MutationObserver en web-pc.js). Probado en el demo.

## Apariencias (temas del lobby) — solo web de computador por ahora

- **Qué es:** Ajustes › «Apariencia: …» (botón nuevo, solo con `?web=1`) abre un selector con cuatro tarjetas: **Clásica** (la de siempre), **Nintendo Wii** (lista), **PlayStation 5** y **Xbox** («Próximamente»). Se guarda en `localStorage["hf.theme"]` de ese navegador; el tema pone `data-theme` en `<html>`.
- **Archivos:** `js/themes.js` (registro de temas, selector, y el dibujante `renderWii`) y `css/themes.css` (se cargan solo con `?web=1`, después de app.css; `app.html` los inyecta). `js/ui/library.js` solo añade el botón y la acción `theme` en Ajustes. `js/web-pc.js` le pregunta a `HFTheme.wheel` antes de desplazar.
- **Cómo se engancha (sin tocar el motor):** `themes.js` envuelve `renderBrowse` y `handleBrowseSelect`. Si el tema es Wii y la sección es Inicio/Películas/Series/Mi lista/Anime (con datos), pinta su propio lobby; si no, deja pasar al dibujante clásico. Usa los mismos datos (`continueWatching`, `library.recent`, `myListTitles`…), las mismas áreas de foco y la misma ficha (`openDetail`) al elegir un título.
- **Lobby Wii:** cuadrícula de 4 × 3 «canales» (16:9, imagen del título con nombre, tipo y barra de progreso; huecos vacíos en gris), páginas con flechas ‹ › celestes, puntos de página, rueda/trackpad, y ← → en el borde de una fila; barra inferior curva con reloj, fecha, botón redondo con el logo (Inicio), ícono SD (Mi lista) y botón redondo de buscar. La barra superior se re-viste en claro. Entrada de teselas en cascada al cambiar de página (solo transform/opacity).
- **Para agregar un tema nuevo:** una entrada en `TEMAS` (`listo: true`), su bloque en css/themes.css bajo `html[data-theme="<id>"]` y, si cambia la estructura, un dibujante como `renderWii` + su condición en el envoltorio de `renderBrowse`.
- **Pendiente / ideas:** la ficha, la búsqueda, el reproductor y Ajustes siguen oscuros (Wii solo cambia el lobby); sonidos de la Wii al pasar sobre un canal; guardar el tema en la cuenta (sync) para que lo sigan otros equipos; PS5 y Xbox; llevar los temas a TV/celular (pesan más: animar solo transform/opacity). Probado en el demo (páginas, rueda, puntos, bordes, ficha y regreso, selector, volver a Clásica); falta verlo con la biblioteca real.
- **Wii en TODAS las pantallas (regla del usuario: «todas las pestañas mantienen el mismo estilo»):** además del lobby, `css/themes.css` re-viste con la misma paleta clara la búsqueda (campo blanco con borde celeste, tarjetas de «canal», barra con reloj y atajos Inicio/Mi lista), la ficha (arte con fundido claro, sombras y botones claros), series y capítulos, Ajustes, perfiles, TV en vivo, modales y campos. Técnica: se re-mapean las variables de `.hf2` (`--text`, `--muted`, `--gold-*`…) bajo `html[data-theme="wii"] #app .hf2` y se corrigen los colores que estaban fijos en oscuro. Excepciones: el reproductor (`.pl`) se queda oscuro sobre el video con acento celeste, y la portada/inicio de sesión (`#scrSplash`, `#scrLogin`) conservan su muro de pósters oscuro con acento celeste. Regla para temas nuevos: cada pantalla nueva debe mirarse con cada tema (`?web=1`, `localStorage["hf.theme"]`).
- **Wii, ajustes de la 2.ª ronda:** (1) el logo de HomeFlix de arriba a la izquierda es el botón de **Inicio** (en el lobby, la búsqueda, la ficha y TV en vivo; `handlePointerSelect`). (2) El botón redondo de abajo a la izquierda es ahora un **selector de categorías** (`alternaCategorias` en js/themes.js): Todo, Continuar viendo, Mi lista, Agregados recientemente, Películas, Series, Infantil y las categorías del catálogo (Marvel va en orden cronológico), según la sección; se elige con clic o ↑ ↓ Enter, Esc cierra; la categoría activa queda como una píldora «Categoría · X ×» abajo a la izquierda para quitarla. El filtro se recuerda por sección. (3) La curva de la barra es más honda y plana en los bordes, como la referencia, y la hora y la fecha van en una sola fila separadas por un punto («1:55 AM · Sáb 14/11»). En la búsqueda la barra no lleva los botones redondos (solo el atajo de Mi lista y el reloj).
- **Wii, la película elegida ya no es una ficha aparte (3.ª ronda):** con el tema Wii, al elegir una **película** el lobby se transforma (`renderWiiDetalle` en js/themes.js, envuelve `renderDetail`; la ruta sigue siendo `detail`): la cuadrícula pasa a una **lista a la izquierda** (la misma lista y filtro de categoría que se veían; la actual resaltada; ‹ vuelve; ↑↓/rueda la recorren; Enter o clic cambia solo el lado derecho), y a la derecha un **mini reproductor** (`.wii-pv`) con la vista previa del video (`detailPvStart` de detail.js ahora también sabe vivir dentro de `.wii-pv`) y debajo título, datos, descripción y botones (los mismos `data-action` de siempre: Reproducir/Reanudar, Desde el inicio, Mi lista, Editar). Clic en el mini reproductor = reproducir. La barra de abajo (categorías, Mi lista, buscar, reloj) y la de arriba se mantienen; el botón de categorías cambia la lista sin salir. Entra con deslizamiento y teselas en cascada. **Series, anime y videos sin clasificar** siguen con la ficha clásica (con colores Wii): pendiente rediseñarlas con temporadas/capítulos dentro de este mismo esquema.
- **Wii, series en el mismo esquema (4.ª ronda):** una **serie** también usa `renderWiiDetalle`: la lista de la izquierda son los **capítulos de la temporada** (miniatura, título, `T1:E2 · 44 min`, ✓ si está visto, barra de progreso, el próximo capítulo resaltado), con las **temporadas como pastillas** encima (`.wii-pill`, con el «Viste X de Y»). Clic o Enter en un capítulo lo reproduce (como siempre, con la serie para pasar al siguiente); a la derecha, mini reproductor con la vista previa y los botones de siempre (Continuar/Ver T1:E1, Desde T1:E1, Mi lista). Foco: pastillas → lista → botones → barra de abajo; `setDetailScrolled` se anula en esta vista para no perder la clase `wii-detalle` al cambiar de temporada. El anime y los videos sin clasificar siguen con la ficha clásica (con colores Wii). Probado en el demo (temporadas, capítulo → reproductor → regreso, BACK).
- **Wii, ronda 5 (categorías, botones, hover):** (1) una **categoría** ya no es una etiqueta sobre el lobby: elegirla (botón de abajo a la izquierda) abre la **vista de película** con la lista filtrada y el **nombre de la categoría como título de la lista** (cuenta de títulos al lado) y el primer título (película si hay) a la derecha; el lobby siempre muestra todo, y al volver (‹/Esc, `closeDetail` envuelto) se quita la categoría. «Todo» desde la vista vuelve a la lista completa. (2) Se quitaron los botones grandes: el **mini reproductor es el botón de reproducir** (foco y clic: `data-action` play / play-next / play-first, con ícono ▶ y barra de progreso) y **«Mi lista» y «Editar» son círculos translúcidos dentro del mini reproductor, abajo a la derecha** (`.wii-ico`; en series solo «Mi lista»); la **descripción va completa**, sin recortar. (3) El anillo de las filas ya no se corta: el recorte de la lista (`.wii-lv-viewport`) deja aire alrededor. Limitación conocida: si una categoría trae una serie, al abrirla la lista pasa a ser la de sus capítulos.
- **Wii, la lista llega hasta la curva:** las tarjetas de la lista de la izquierda ya no se cortan en recto antes de la línea azul; la lista se extiende por debajo de la barra y es la propia curva (opaca, `.wii-curve .fill`, que también tapa los clics) la que las recorta. Para poder subir la última tarjeta por encima de la curva, `renderWiiDetalle` fija `viewSize = 630` en el área `wii-lista` (el motor y la rueda de web-pc usan ese valor para el tope del desplazamiento).

## Despliegue de la web en homeflix.fun (preparado el 2026-11-14; falta autorizar la subida)

- **Dominio:** homeflix.fun y www.homeflix.fun ya apuntan al VPS (187.77.20.217). Caddy (ya tiene `cloud-dev.homeflix.fun` de NexusPOS y `anime.homeflix.fun`) **aún no tiene el bloque de homeflix.fun**, por eso `https://homeflix.fun` no responde. El usuario `deploy` **no tiene sudo sin contraseña**: el cambio de Caddy lo corre una persona con `sudo`.
- **Qué se sirve:** `node tools/build-web.mjs` arma `dist/web/` (v1.1.91, 100 archivos, ~7 MB, con la clave de Telegram de la app). La raíz `/` es la interfaz del computador (el `index.html` trae `window.HF_WEB = true`, así que ya no hace falta `?web=1`) y redirige a `/web/` en celular y tablet (condición: ventana ≥ 720 px con mouse; `?pc=1` fuerza computador, `?movil=1` en `/web/` fuerza celular). `/web/` es el celular, instalable como app desde Safari/Chrome.
- **Pasos (en orden):** (1) `cd servidor && bash scripts/desplegar.sh` (servidor con la identidad de dispositivos; respalda la base; `--rollback` vuelve atrás). (2) En el VPS, UNA vez, con sudo: `sudo bash ~/homeflix-servidor/scripts/caddy-web.sh` (respalda el Caddyfile, agrega `homeflix.fun` + redirección de `www`, valida y recarga; deja `~/homeflix-web/current`). (3) `bash servidor/scripts/subir-web.sh` (sube `dist/web` a `~/homeflix-web/releases/<fecha>` y cambia `current`; `--dry-run`, `--rollback`; sin sudo). (4) `node tools/publicar-version.mjs 1.1.91 --notas "…" --subir` (OTA para TV/celular; ya armada en `dist/versiones/1.1.91`, nativo mínimo sin cambios: TV 1.1.51 · celular 1.1.58).
- **Estado:** probado en local (servidor `npm test` 18 pruebas, tools/test-*.mjs, `dist/web` servido en localhost: raíz = interfaz de computador con tema y `tipo: pc`, `/web/` = celular). **No se subió nada**: el clasificador de permisos bloqueó `desplegar.sh` y no se intentó rodearlo; hace falta que el usuario lo autorice en el chat.

## Web responsiva y tema Plaza Celeste en el celular (2026-11-14, sin publicar ni subir al VPS)
- **Qué interfaz se ve lo decide el ancho** (`js/responsive-web.js`, un solo archivo; lo cargan `app.html` solo con `?web=1`/`HF_WEB` y `web/index.html`): ventana ≥ 1024 px con mouse → interfaz de computador (raíz `/`); cualquier otra (celular, tablet, ventana angosta del computador) → las pantallas del celular, las mismas del APK (`/web/`). **Cambia sola al redimensionar** (recarga la página; espera si hay un video reproduciéndose). `?pc=1` / `?movil=1` fijan una; `?design=` (tablero) no se mueve. Antes la regla era 720 px y solo al cargar, y en pruebas locales `?web=1` nunca pasaba al celular. `tools/build-web.mjs` ya no lleva su propia redirección (solo marca `HF_WEB`). `web/sw.js` pasó a `hf-web-7`.
- **Tema en el celular (misma llave `hf.theme` que el computador; ids internos `clasica`/`wii`; nombres visibles: Clásica, Plaza Celeste, Cobalto y Esmeralda: nunca nombres de marcas)**: `mobile/themes.js` (se carga ANTES de m.js: `HFMTheme.view/nav/light/after/sheet`) y `mobile/themes.css`. Ganchos en `mobile/m.js`: `render()` (clase `lt` en `#m` y `hf-lt` en html para las pantallas claras, vista propia del tema), `nav()` (la lista de pestañas salió a `tabList()`), `card(…, {tile:true})`, fila «Apariencia» en Ajustes (hoja `SHEETS.theme`) y `themeKit()`/`lobbyOf()` (lo que se le presta al tema).
- **Plaza Celeste en el celular**: Inicio, Películas, Series, Mi lista y cada categoría = plaza de «canales» (portadas 16:9 en páginas que se deslizan, puntos de página, flechas solo en tablet con mouse; filas por página según la altura, columnas 2/3/4 según el ancho; lo que empezaste va primero); barra de abajo = curva con reloj, botón redondo de categorías (abre el selector de siempre), ícono de Mi lista y botón redondo de Buscar; las secciones pasan arriba como píldoras. Ficha: la portada como el mini reproductor (marco blanco con brillo celeste) y todo claro; Ajustes, Buscar, perfiles, hojas y categorías también. Siguen oscuros: inicio de sesión, reproductor, galería, control remoto y TV en vivo. Anime y la lista vacía usan las pantallas de siempre con la paleta clara.
- **Pendiente**: sin vista previa de video ni botón de sonido en la ficha del celular (no existe en el celular); series/anime con lista de capítulos propia al estilo de la TV; PS5/Xbox (ahora Cobalto/Esmeralda); probar con la biblioteca real, en el APK y en un iPhone. Probado en el navegador a 390 px y 768 px con los datos de demostración (`/web/?movil=1&design=home`).

- **anime.homeflix.fun, abierto otra vez para PRUEBAS (2026-11-14, temporal)**: lo cerramos y el usuario pidió reabrirlo porque le faltan pruebas. Estado: el contenedor `anime-api` publica `127.0.0.1:4600` (sección `ports` de `servidor/anime-api/docker-compose.yml`, también en `~/anime-api` del VPS) y Caddy tiene el bloque con su clave (sin clave responde 401). Lo puso `servidor/anime-api/poner-dominio-publico.sh` (root; toma el bloque del respaldo `…-antes-de-quitar-anime`). **Para cerrarlo de nuevo cuando el usuario avise**: root corre `quitar-dominio-publico.sh` y yo quito `ports` del compose y recreo el contenedor (`cd ~/anime-api && docker compose up -d`). El canal Anime de las apps no depende de esto (va por la red privada `anime-interna`).

## Importar desde un grupo antiguo — FASE 1 hecha: solo lectura (2026-11-14, SIN publicar)
- Diseño y decisiones: `docs/diseno-importar-grupo-antiguo.md`. Archivos: `tools/preparador/importar.js` (global `PrepImport`: `read` lee el canal con los filtros de video/documento/foto y los ordena por número de mensaje; `parseHeader`, `parseEpisode`, `sameScore`, `analyze` y `report`), pantalla `viewImportar` en `biblioteca.js` (estado `IM`, acciones `im-*`, botón «Importar grupo antiguo» en Herramientas; reutiliza el diseño de Migrar con `body.tm-on`), estilos al final de `biblioteca.css`. Registrado en `server.mjs` (`/importar.js`), `ui.html` y `publicar-version.mjs`.
- Qué hace: elige un chat (el canal antiguo debe aparecer entre tus chats), lo lee y muestra series con sus temporadas, idioma de cada una, rango de capítulos, el corte de temporada con sus pruebas (seguro / propuesto), y avisos (capítulos faltantes, repetidos, sin número, renumeración). Botón para descargar un informe `.json` de solo texto. NO copia ni cambia nada.
- Detección: el mismo anime con otro nombre en español = una serie si el parecido suma ≥ 5 (póster, título, año, géneros, episodios, duración); cortes por puntaje (encabezado nuevo +3, numeración vuelve a 1 +3, idioma cambia +2, calidad/peso/fecha +1, encabezado repetido con numeración continua −2). Si el encabezado dice «N temporadas» y no hay otro corte, propone partir en partes iguales.
- Prueba: `node tools/test-importar.mjs` (canal falso con el ejemplo del zodiaco: T1 japonés+subs, T2 latino con el capítulo 17 faltante, encabezado repetido, numeración que sigue, serie por nombre de archivo, película y videos sueltos). Probada la pantalla en el navegador (puerto 5191, config `preparador-prueba` de `.claude/launch.json`) con un cliente falso.
- FALTA: probar con el canal real (y afinar el motor con el informe), y las fases 2 (TMDB), 3 (copia con comentario nuevo a un grupo nuevo con temas) y 4 (validación de idiomas). Para ver la pantalla en el preparador del proyecto (5181) hay que reiniciarlo (nueva ruta en server.mjs); el instalado la recibe por OTA.
- **Probada con el canal REAL (2026-11-14, solo lectura)**: «Los guerreros del zodiaco: el lienzo perdido» = 54 fotos y videos → 2 encabezados + 52 capítulos → 1 serie, 2 temporadas (T1 japonés con subtítulos, 26 caps, ~278 MB c/u; T2 latino, 26 caps, ~161 MB c/u), corte SEGURO de 9 puntos (encabezado nuevo +3, idioma +2, numeración vuelve a 1 +3, peso +1), sin avisos. Coincide con el ejemplo de la prueba automática. Nota: el canal solo aparece si la cuenta de Telegram del preparador es miembro (la sesión se cambió a la cuenta correcta). Con la extensión de Chrome solo se controlan pestañas de su propio grupo: se abrió el 5181 en una pestaña propia (la sesión de Telegram vive en el navegador, así que sirve la misma). El servidor del 5181 del usuario es anterior al archivo nuevo: hay que reiniciarlo (si no, `/importar.js` da 404 y «Analizar» no hace nada); en la prueba se cargó el script desde el servidor `preparador-prueba` (5191).

## Importar desde un grupo antiguo — FASES 2 y 3 hechas (2026-11-14, SIN publicar)
- **Fase 2 · TMDB** (`PrepImport.match/matchAll/pick`): cada serie busca en TMDB por título original, español y el comienzo antes de «:», con el año; elige el mejor candidato (puntaje = parecido de palabras ×5 + año +3/+1/−2 + popularidad) con confianza segura/dudosa/baja/sin resultado, deja hasta 6 candidatos (se cambia con el desplegable de la serie) y trae su ficha (`/api/tmdb/ficha`: descripción es-MX, géneros, portada, banner y póster vertical). El nombre en el grupo nuevo se puede editar por serie.
- **Fase 3 · copia** (`PrepImport.planCopy/copyAll`): `client.sendCopy` (reutiliza el archivo de Telegram: NO se vuelve a subir) con el comentario de hoy: capítulo `serie(T/C)#Nombre#descripción de TMDB #Anime #tmdbtv<id>` (renumerado), portada `serie#Nombre#descripción #portada` (la descripción va en la portada: de ahí la toma la biblioteca para la serie), banner `serie#Nombre #banner`, y la foto del encabezado como `#vertical` si es vertical (si no, se usa la de TMDB). El tema «Nombre (serie)» lo pone `PrepTopics.patch` según el comentario. Avance guardado en `hf.preparador.importar.<canal>.<grupo>` (se reanuda sin repetir), espera ante FLOOD_WAIT, una imagen de TMDB que no baja se omite y se avisa. Modo prueba: 2 capítulos por temporada (casilla del paso 5; después se copia el resto sin repetir). Pantalla con 5 pasos: canal · análisis · fichas de TMDB · destino (crear grupo con temas con confirmación EN pantalla, sin diálogos del navegador, o usar uno existente) · copia (con «Verificar en Telegram»). Categoría fija «Anime» por ahora (`IM.cat`).
- Pruebas: `node tools/test-importar.mjs` y `node tools/test-importar-copia.mjs` (TMDB y Telegram falsos, con `temas.js` y `library.js` reales: comentarios, tema, resumir, FLOOD_WAIT, imagen que falla, y que la biblioteca junta todo en 1 serie con 2 temporadas, descripción y categoría Anime).
- **PROBADO CON TELEGRAM Y TMDB REALES (2026-11-14)**: canal «Los guerreros del zodiaco: el lienzo perdido» → grupo nuevo con temas «Prueba importar anime (borrar)» (el usuario lo borra) → tema «Los guerreros del zodiaco: el lienzo perdido (serie)» con 4 videos (T1:E1–2 y T2:E1–2, comentarios correctos) y 3 fotos (vertical 640×960 del encabezado, portada 1280×720 y banner 1920×1080 de TMDB). `Verificar` coincide (4 videos y 3 fotos). `HFLibrary.build` sobre ese grupo: 1 serie, T1: 1,2 / T2: 1,2, categoría Anime, portada, banner y vertical presentes. Telegram pidió esperar 32 s tras ~3 envíos (grupo recién creado); la herramienta espera sola. Esa prueba se hizo antes de poner la descripción en la portada: esa foto no la lleva (en la próxima copia sí).
- FALTA: copiar los 48 capítulos restantes (casilla de prueba apagada → Continuar), títulos de capítulo desde TMDB, validar idiomas/subtítulos por temporada (fase 4: panel ES/EN y «Idiomas por revisar»), elegir categoría por serie, películas (el flujo existe pero sin probar), y publicar. El servidor del 5181 del usuario debe reiniciarse para servir `/importar.js`; en la prueba se inyectó desde el servidor `preparador-prueba` (5191).
- **Copia COMPLETA probada con datos reales (2026-11-14)**: los 48 capítulos restantes (casilla de prueba apagada → Continuar, sin repetir los 7 de antes) → grupo «Prueba importar anime (borrar)»: 52 videos y 3 fotos en el tema «Los guerreros del zodiaco: el lienzo perdido (serie)». `Verificar` coincide; `HFLibrary.build` sobre el grupo: 1 serie, T1: 26 caps (1–26), T2: 26 caps (1–26), categoría Anime, portada/banner/vertical, 0 duplicados y 0 sin clasificar. Tardó ~10 min (Telegram pone FLOOD_WAIT de ~30 s cada pocos envíos; la herramienta espera sola). La descripción de la serie salió vacía porque la portada de la primera prueba no la llevaba: se reenvió esa portada con `sendCopy` y comentario nuevo (`serie#Nombre#descripción #portada`) y la biblioteca ya la muestra (gana la foto más nueva). La corrección ya está en `captionOf`. Para la herramienta: abrir con la extensión de Chrome exige que la pestaña propia cargue el 5181 (la sesión de Telegram vive en el navegador) y el servidor del usuario necesita reinicio para servir `/importar.js`.

## Publicada la 1.1.92 (2026-11-14)
Salió por OTA (sin --programa): solo cambió el preparador, con «Importar grupo antiguo» (fases 1-3: leer, emparejar con TMDB y copiar al grupo con temas). TV, celular y web no cambian (la web de homeflix.fun sigue en la subida 20261114-040208). Pendiente: que el usuario pulse «Versión nueva» en el preparador instalado (o reinicie el del 5181), validar idiomas/subtítulos (fase 4), títulos de capítulo desde TMDB, categoría por serie, y borrar el grupo de prueba «Prueba importar anime (borrar)».

## Importar grupo antiguo — FORMATO B: comentario en cada video, sin encabezado (2026-11-14, SIN publicar → 1.1.93)
- Segundo canal real («Star Wars: Tales Of The Jedi»): un póster sin texto y 6 videos con el comentario «Star Wars: Tales of the Jedi - Star Wars: Historias de los Jedi - 2022 - Latino» + «S01 E01» (el último, «S01 E06 - Fin de temporada»). El analizador del formato A daba 0 series y 6 videos sin encabezado.
- `importar.js`: `parseInline` lee título(s), año, idioma, temporada y capítulo del comentario de cada video (acepta si trae año, o idioma/2 títulos + número de capítulo); el título que parece español (`spanishness`: de/los/la…, tildes) queda como nombre y el otro como original; los videos del mismo título se juntan en una serie (`sameScore` ≥ 4); la temporada sale del comentario (S02 → temporada 2 aunque falte la 1; sin renumerar); «Fin de temporada» del capítulo anterior suma +3 al corte, y el cambio de idioma (+2) y de S01→S02 (+3) cuentan también dentro de un mismo bloque. Con un encabezado de arriba, un comentario solo se toma por serie nueva si trae año y es otro título (así «Capítulo 3 - El final» no engaña). Películas: comentario con título+año y sin S/E → película.
- Póster suelto: se asocia por parecido del título; si no, a la serie cuyo PRIMER capítulo va justo después (gana la foto más cercana); si hay una sola foto y una serie, a esa. Solo una foto asociada se copia como «encabezado/vertical» (`headers[].hasPhoto`); sin foto, la vertical sale de TMDB. El informe lista las fotos que no pudo asociar (texto y tamaño) y trae `fuente` (comentario | encabezado).
- Prueba: `node tools/test-importar-inline.mjs` (con los 6 comentarios reales). VERIFICADO con el canal real: 1 serie «Star Wars: Historias de los Jedi» (2022), T1 en latino, 6 caps (~209 MB c/u), póster asociado, «Seguro». Todavía NO se copió ese canal.
- Ojo operativo: el 5181 del usuario estaba apagado; se levantó con `preview_start preparador` (la sesión de Telegram vive en el navegador, por origen: el 5180 instalado no la tiene y el 5191 de prueba tampoco). Se detuvo al terminar.

## Publicada la 1.1.93 (2026-11-14)
Salió por OTA (sin --programa): solo el preparador, con el formato B de «Importar grupo antiguo» (comentario en cada video, sin encabezado). TV, celular y web no cambian. Pendiente: copiar el canal de Star Wars (TMDB + copia a un grupo con temas), validar idiomas/subtítulos (fase 4) y que el usuario pulse «Versión nueva» en el preparador instalado.

## Importar grupo antiguo — numeración CONTINUA sin marcas de temporada (2026-11-14, SIN publicar → 1.1.94)
- Tercer canal real («Los super campeones», 127 videos): una foto («SUPER CAMPEONES / CAPTAIN TSUBASA J (1983)» con «𝐈𝐝𝐢𝐨𝐦𝐚» en negrita matemática) y videos «Los super campeones {Captain Tsubasa} - Capitulo 01 Audio Latino 🇲🇽» del 1 al 128 (falta el 104; el último «128/Final»), todos iguales (53 MB, 24 min, 480p) y subidos a la vez. NADA dentro del canal marca las temporadas: el analizador dejó 1, el usuario dice que son 4 (TMDB dice 5: 26, 26, 26, 26 y 24).
- Arreglos en `importar.js`: el nombre entre llaves/corchetes es el título original; «Audio Latino», «720p», «Final» ya no son título de capítulo (`stripNoise`); el token del capítulo aporta el idioma; el año y el título de la foto suelta (`photoInfo`, puede ocupar dos renglones) enriquecen la serie; `cleanLine` normaliza con NFKC (letras matemáticas → normales).
- **Partir una numeración continua** (`resplit`, `tmdbStarts`, `equalStarts`, `parseStarts`, `restoreSeasons`, `maxNum`): según TMDB (la ficha ahora trae `seasons` con los episodios de cada una: cambio en `server.mjs`/`tmdbFicha`), en N partes iguales, o a mano («1, 33, 65, 97»). Cada temporada vuelve a contar desde 1, avisa los capítulos que faltan y compara con TMDB (p. ej. «TMDB dice 26 y hay 25»), y se puede volver a la detección. Panel «Temporadas» en cada serie (`imSplitPanel`, acción `im-split`). Si ya se copió algo con otro reparto, avisa (lo copiado conserva sus comentarios).
- Pruebas: `node tools/test-importar-continua.mjs` (con los comentarios reales) además de las anteriores; verificado en el navegador con el canal real: serie «Los super campeones · Captain Tsubasa · 1983», TMDB «Super Campeones (1983)» segura, y los 4 modos del panel. FALTA: que el usuario diga cómo se reparten sus 4 temporadas (¿partes iguales de 32?, ¿otros cortes?), copiarlo, y publicar (el cambio del servidor del preparador —ficha con temporadas— solo llega por OTA).

## Contenido borrado en el grupo que seguía en la TV (2026-11-14, SIN publicar al escribir esto)
Al borrar un tema en el grupo y volver a copiar (importador), la TV y el celular seguían mostrando lo viejo: la lectura normal pide solo lo NUEVO y los borrados solo se veían en la completa (↻ >1 h, automática >6 h).
Ahora `HFTelegram.countMedia(chatId)` (js/telegram.js: 3 `searchMessages` de 1 mensaje a la vez, usa `.total`) y `HFCatalog.scanChat` (js/catalog.js) guardan por chat `k` = total del chat − items; en cada lectura normal, si `items (viejos+nuevos) ≠ total − k` se hizo una lectura COMPLETA (una sola vez: después `k` cuadra y vuelve a ser rápida). Cubre «borrar y volver a subir lo mismo» (el total no cambia pero los items sobran). Si Telegram no da el total, se sigue como antes. Prueba: paso 8 de `tools/test-catalog.mjs`. Falta publicar por OTA (sin --programa) para que lo tomen TV, celular y web; el celular APK usa el mismo js/catalog.js. El preparador ya detectaba borrados (PrepCatalog.refresh revisa lo conocido).
Importador: el nombre de la serie sale en español de TMDB (`nameFromTmdb`; el servidor completa con la traducción es-ES cuando es-MX no existe), y el comentario de cada capítulo lleva título y descripción del capítulo (`/api/tmdb/temporada`, `epInfo`), solo si las temporadas del canal siguen a las de TMDB. Botón «Empezar de cero» (`im-reset`) olvida el avance de copia para repetirla tras borrar el tema en Telegram.

## Publicada la 1.1.94 (2026-11-14)
Salió por OTA (sin --programa): importador (formatos nuevos, nombre y capítulos en español desde TMDB, panel Temporadas, «Empezar de cero») y lectura de catálogo que detecta lo borrado en el grupo (total del chat vs lo guardado → lectura completa). Preparador y apps se actualizan desde su botón.

## Publicada la 1.1.95 (2026-11-14)
Arregla la 1.1.94: lo guardado sin `kv:2` (cuenta de lo borrado) se lee completo una vez (`canSkip` exige `s.kv === 2`); antes la primera lectura aprendía `k` con la caché vieja y no limpiaba lo borrado. Prueba: paso 9 de tools/test-catalog.mjs.

## Imagen de cada capítulo (2026-11-14, SIN publicar → 1.1.96)
El importador copia, además de los capítulos, una foto `serie#Nombre #capitulo` (imagen COMÚN = la horizontal de la serie) y, si TMDB tiene el «still» de un capítulo (`/api/tmdb/temporada` → `still`), una foto `serie(T/C)#Nombre #capitulo` por capítulo (la de cada capítulo manda sobre la común, ver docs/formato-comentarios.md). Misma regla de confianza que título/descripción (`epInfo`). Pruebas: test-importar-inline/copia/continua.

## Ficha de serie en la TV: aro, descripción y título (2026-11-14, SIN publicar → 1.1.96)
`css/app.css` (final): (1) `.hf2.dt.scrolled .hf2-dt-copy` va anclado (`bottom:740px`) encima de las temporadas: con títulos de 2 renglones ya no tapa «N temporadas · N capítulos»; (2) `.hf2-dt-episodes .hf2-ep-viewport` con relleno y margen negativo (`margin:-36px 0 -90px -52px; padding:42px 0 90px 52px`): el capítulo enfocado (escala 1.1 + sube 8 px) ya no pierde el aro ni la descripción por el `overflow:hidden` del carrusel. Probado con una maqueta a 1920×1080 (borrada) con los mismos CSS; falta verlo en la TV real.
- Separación entre las temporadas y las tarjetas de capítulo: `.hf2-dt-episodes .hf2-seasons{margin-bottom:48px}` (el enfocado sube/crece y rozaba los botones); descripción enfocada hasta 8 renglones con «…».

## Publicada la 1.1.96 (2026-11-14)
Ficha de serie en la TV (aro, descripción, título largo, separación con las temporadas) e imagen de cada capítulo en el importador (`#capitulo`: still de TMDB + común con la horizontal). Salió por OTA, sin --programa.

## Rama «preparador» en GitHub (2026-11-15)

- **Qué es:** la rama `preparador` de https://github.com/MonkeyDevC/homeflix-tv guarda SOLO el Preparador de videos, con historia propia (rama huérfana): los mismos archivos del zip que se publica con `tools/publicar-version.mjs` (su lista `PREP`), más `instalar-preparador.cmd`, `tools/preparar-video.mjs`, las pruebas del preparador (`test-corte`, `test-temas`, `test-preparador-cache`, `test-importar*`), un `README.md` y un `.gitignore` (sin `.env` ni claves; `js/config.js` va con la clave vacía). Primer commit: «Preparador de videos 1.1.110» (33 archivos).
- **Cómo se actualiza:** `node tools/rama-preparador.mjs --subir` (sin `--subir` solo arma la rama en local). Toma los archivos de este árbol de trabajo (la versión de `tools/preparador/version.json`), agrega un commit «Preparador de videos <versión>» con las notas de `dist/versiones/actual.json` si coinciden, y sube. Trabaja en un worktree temporal: no cambia tu rama ni tus cambios abiertos. Conviene correrlo después de `publicar-version.mjs … --subir`. `--coautor "Nombre <correo>"` agrega el `Co-Authored-By`.
- **Comprobado:** desde un checkout limpio de la rama, las 7 pruebas pasan y `node tools/preparador/server.mjs --puerto=5199` responde HTTP 200.
