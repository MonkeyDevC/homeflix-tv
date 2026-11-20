# Importar desde un grupo antiguo (diseño, 2026-11-14; fase 1 programada, sin publicar)

Tercera herramienta de «Herramientas» en Inicio del preparador, junto a «Migrar a grupo con temas» y «Respaldar en grupo nuevo».
Diferencia: esas dos **reenvían tal cual**; esta debe **entender** cada mensaje del canal antiguo y **reescribirlo** al estándar de hoy
(`docs/formato-comentarios.md`), copiando sin volver a subir los archivos.

## El formato antiguo (visto en capturas del canal «Los guerreros del zodiaco…», 363 suscriptores)

- **Encabezado de cada anime**: una FOTO (póster vertical) con un texto informativo:
  `Título en español / Título original` · `N temporadas` · `Tipo: OVA` · `Publicación: 2009` · `Géneros: #Acción #Artes_Marciales…` (a veces sin #) ·
  `Episodios: 26` · `Duración: 23 min` · `Idioma: Jap+Sub | Latino` · `Formato: 720p`. Los textos varían entre encabezados del mismo canal.
- **Capítulos**: videos con comentario `Capítulo N` (también `Capitulo N` sin tilde).
- **Cambio de temporada**: normalmente otra foto de encabezado, y después la numeración vuelve a 1. Cada temporada puede estar en OTRO idioma
  (T1 japonés con subtítulos en español, T2 latino) y puede tener otros audios/subtítulos que entonces no se detectaban.

## Decisiones del usuario

- Destino: **grupo nuevo con temas** (se crea solo, como «Crear y migrar»).
- Descripciones, portadas y banners: **TMDB automático** (solo en el preparador). La foto del encabezado se aprovecha como portada vertical (`#vertical`).
- El canal antiguo **deja reenviar** (si algún día no deja, habría que descargar y subir: otro diseño).
- **Una sola serie** aunque sus temporadas estén en idiomas distintos (T1 japonés+subs, T2 latino): no se separa en «Nombre (Latino)». Los idiomas se validan
  después con las herramientas de siempre (panel ES/EN, «Idiomas por revisar», corrector) y se corrigen a mano si hace falta.
- Los cortes de temporada los decide un **motor de detección que suma evidencias** (automático, cubre varios escenarios); lo dudoso se revisa a mano.

## Motor de detección (puntaje de evidencias)

Se recorre el canal en orden de mensaje. Cada mensaje es: ENCABEZADO (foto con texto que trae ≥ 2 campos: Tipo, Publicación, Episodios, Duración, Idioma, Formato, «temporada(s)»),
CAPÍTULO (video/documento con «Capítulo N», o número en el nombre del archivo) u OTRO (se ignora y se cuenta).

Entre dos capítulos consecutivos de una misma serie se suma un puntaje de **corte de temporada**:

| Evidencia | Puntos |
|---|---|
| Entre ellos hay una foto con texto informativo (ENCABEZADO) con el mismo título/póster | +3 |
| La numeración vuelve a bajar (…13 → 1) | +3 |
| El idioma declarado cambia (Jap+Sub → Latino) | +2 |
| Cambian la calidad, la duración media o el peso medio de los videos | +1 |
| El encabezado dice «N temporadas» y el total de episodios se reparte en partes iguales aquí (26 / 2 = 13) | +1 |
| Pausa grande en las fechas de publicación | +1 |
| Encabezado idéntico y numeración continua (parece repetición, no corte) | −2 |

Decisión: **≥ 3 corte seguro** (verde) · **2 propuesta** (ámbar, se confirma) · **< 2 sin corte**. Si el encabezado declara N temporadas y se hallan menos cortes,
se propone partir el total en partes iguales (ámbar). Cada corte guarda sus evidencias para mostrarlas («Corte entre 13 y 14: encabezado nuevo +3, numeración reinicia +3 → seguro»).
Un encabezado con otro título/póster = **serie distinta**. Mismo título en otro idioma = **misma serie**, siguiente temporada.
Numeración: dentro de cada temporada se renumera desde 1 si la antigua seguía de largo (14…26 → 1…13); se avisa en la revisión.

## Del encabezado y los capítulos al estándar de hoy

- Ficha: `serie#Nombre (año)#descripción de TMDB #Acción #Aventura… #tmdbtv<id>` (los géneros del encabezado pasan a categorías). Foto del encabezado = `#vertical`;
  portada y banner horizontales de TMDB (`#portada`, `#banner`).
- Capítulo: `serie(T/C)#Nombre#título del capítulo (TMDB, si hay)#descripción`, en el tema «Nombre (serie)» del grupo nuevo.
- Búsqueda en TMDB (`/api/tmdb/buscar` y `/ficha`): por título (español y original) + año; se elige por año, número de temporadas y de episodios (26 contra lo que dice TMDB).
  Cada título muestra su confianza y se puede cambiar el resultado a mano.
- Lo que no se identifica va al tema «Sin clasificar», sin tocar su comentario.

## Validación de idiomas

Al terminar (y como muestra antes de importar: 1 capítulo por temporada) se pasan las mismas herramientas de siempre: pistas de audio y subtítulos, panel ES/EN,
filtro «Idiomas por revisar» y corrector. Si los subtítulos del japonés estuvieran quemados en la imagen, no hay nada que detectar y queda anotado.

## Pantalla

Botón «Importar grupo antiguo» en Herramientas. Misma estructura que «Migrar / Respaldo»: izquierda tres tarjetas (1 Canal de origen · 2 Destino: crear grupo nuevo o usar uno ·
3 Ejecución con barra y Pausar/Continuar); derecha la lista de series detectadas, cada una desplegable en temporadas y capítulos, con colores de confianza, corte marcado y botones
para mover el corte, fusionar/separar, cambiar la ficha de TMDB, renombrar o excluir. «Probar con 2 títulos» antes de todo. Informe descargable (.json) del análisis, solo texto.

## Copia

`client.sendCopy` con el comentario NUEVO (no reenvío: el reenvío conserva el comentario viejo) al tema del título, sin volver a subir; avance guardado (se reanuda), FLOOD_WAIT,
se puede detener; el canal antiguo no se toca. Orden: imágenes → capítulos por temporada. Estado en `hf.preparador.importar.<origen>.<destino>`.

## Fases (cada una se prueba sola)

1. **Analizador de solo lectura**: lee el canal, clasifica mensajes, agrupa series/temporadas con el puntaje y muestra el resultado con sus evidencias. No copia nada.
   Prueba automática con un Telegram falso armado como las capturas. Con esto se afina el motor con el canal real.
2. TMDB: emparejar cada serie y traer fichas, imágenes y títulos de capítulos.
3. Copia con comentario nuevo a un grupo nuevo con temas (primero 2 títulos).
4. Validación de idiomas y revisión final.
