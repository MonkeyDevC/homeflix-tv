# Cómo escribir el comentario de cada video en Telegram

HomeFlix lee el comentario (la descripción) de cada video de los chats que actives en **Ajustes** y con eso decide
si es una película o un capítulo de una serie, cómo se llama y qué descripción mostrar.

## Película

```
pelicula#El Rey León (1994)#Simba, un joven león, debe reclamar el lugar que le corresponde como rey.
```

- `pelicula` también vale como `película`, `peli`, `movie` o `film`.
- El año entre paréntesis al final del nombre es opcional; si está, se muestra aparte.

## Capítulo de serie

```
serie(1/3)#Bluey#Bluey y Bingo juegan a ser médicos.
```

- `(1/3)` = temporada 1, capítulo 3. También se entiende `(T1/E3)`, `(T1E3)`, `(1x03)`, `(S01E03)` o `(T1 C3)`.
- Si quieres darle título al capítulo, agrega un campo más:

  ```
  serie(1/3)#Bluey#El hospital#Bluey y Bingo juegan a ser médicos.
  ```

- `serie` también vale como `series` o `show`.
- Todos los capítulos con el mismo nombre de serie se agrupan solos, aunque estén en chats distintos.

## Ficha con portada (opcional)

Envía una **foto** (no un video) con el comentario sin temporada ni capítulo:

```
serie#Bluey#Una perrita de seis años convierte la vida diaria en aventuras.
pelicula#El Rey León (1994)#Descripción que quieres mostrar en la ficha.
```

La foto se usa como portada y la descripción como resumen de la serie o película.
Sin ficha, HomeFlix usa la portada del propio video.

## Contenido infantil

Agrega `#infantil` al final del comentario (también vale `#kids` o `#niños`):

```
pelicula#Coco (2017)#Miguel sueña con ser músico. #infantil
serie(1/3)#Bluey#Juegan a los médicos. #infantil
```

Los perfiles marcados como **infantiles** solo ven películas y series con esa marca
(en una serie basta con que un capítulo o su ficha la tenga).

## Etiquetar desde la TV (sin tocar Telegram)

En la ficha de un video **Sin clasificar** pulsa **🏷 Etiquetar**; en una película, **✎ Editar datos**;
mientras ves algo, **✎ Editar datos** en los controles del reproductor. Con ◀ ▶ eliges si es película o capítulo,
la serie, temporada, capítulo e infantil; con OK escribes nombre y descripción.

La etiqueta se guarda en la TV (para tu cuenta) y tiene prioridad sobre el comentario de Telegram.
Abajo del editor se muestra el comentario equivalente por si quieres copiarlo a Telegram.
**Quitar etiqueta** vuelve a usar el comentario original.

## Reglas

- Mayúsculas, tildes y espacios alrededor de `#` no importan.
- La descripción puede ocupar varias líneas.
- Los videos sin comentario o con otro formato aparecen en la fila **Sin clasificar** con el nombre del archivo,
  para que veas cuáles faltan por etiquetar.
- Si subes el mismo capítulo o película dos veces, HomeFlix muestra uno (el más reciente).

## Marcas que pone el preparador (al final del comentario)

| Marca | Dónde | Qué hace |
|---|---|---|
| `#tmdb603` / `#tmdbtv1399` | video | Ficha de TMDB (solo la usa el preparador). |
| `#miniaturas` | hojas `.jpg` | Tira de cuadros para «Recortar» del celular. |
| `#audio-x-eng` | video | Idioma correcto de cada pista de audio, en orden (`x` = deja el suyo). Va en el comentario **de cada archivo**. |
| `#subs-x-spa` | video | Lo mismo para las pistas de subtítulos que el video trae dentro (videos viejos). |
| `#subs-spa` | archivo `.srt` | **Subtítulos aparte**: un `.srt` por idioma, con el comentario de la película (`pelicula#Nombre (2015) #subs-eng`). Sirven para todas las calidades. |
| `#subs-spa-f` | archivo `.srt` | Igual, pero son **forzados** (carteles y diálogos en otro idioma): se activan solos con el audio de ese idioma. |

Desde la versión 1.1.28 los subtítulos no van dentro de los videos: cada idioma se publica una sola vez como `.srt`
aparte (`Nombre (2015).spa.srt`, `.eng.srt`, `.spa.forzados.srt`) y la TV y el celular los usan en todas las calidades.

## Portada vertical (`#vertical`)

Desde la 1.1.56 las tarjetas pueden verse en vertical (póster 2:3; se elige por perfil en Ajustes). Para eso hay una tercera foto
del título, con el mismo comentario y la marca `#vertical` al final (`pelicula#Nombre (2015) #vertical`; también vale `#retrato`).
Es un póster de 800×1200. Si el título no tiene `#vertical`, la vista vertical usa la portada horizontal recortada.
El preparador la arma en la pestaña 4 (interruptor Horizontal / Vertical) y en «Imágenes por revisar» (formato Vertical) se ve cuáles títulos todavía no la tienen.

## Imagen de los capítulos (`#capitulo`)

En una serie, una foto con `#capitulo` al final es la imagen que se muestra en la lista de capítulos, en el aviso de «Siguiente capítulo»
y en «Seguir viendo»:

- `serie(1/3)#Bluey #capitulo` → la imagen de **ese** capítulo (T1:E3). Manda sobre la común.
- `serie#Bluey #capitulo` (sin números) → una imagen **común** para todos los capítulos que no tengan la suya.

Sin ninguna de las dos, cada capítulo muestra un cuadro de su propio video. La portada, el banner y la portada vertical de la serie
(`serie#Bluey #portada`, `#banner`, `#vertical`) funcionan igual que en las películas. El preparador las arma en la pestaña 4
(interruptor Horizontal / Vertical / Capítulos).

## Galería de escenas (`#galeria1`, `#galeria2`…)

Fotos de distintas escenas de una película o serie, con el mismo comentario del título y `#galeria<N>` al final
(`pelicula#Nombre (2015) #galeria1`, `serie#Nombre #galeria2`; también vale `#escena1`). El número da el orden en la galería.
En el celular, con las tarjetas en vista vertical, la ficha del título muestra un botón **Galería** (entre «Mi lista» y «Detalles»)
que abre las escenas en un carrusel (efectos: carrusel 3D, pila y abanico, presentación automática, tocar la del centro para verla completa).
Sin fotos `#galeria`, el botón no aparece. El preparador las carga en la pestaña 4 → «Galería de escenas» (varias de TMDB o propias).

### Galería a dos niveles (series)

- `serie#Nombre #galeria1` → galería **de la serie**: botón «Galería» en la ficha del celular (junto a «Mi lista» y «Detalles»).
- `serie(1/3)#Nombre #galeria1` → galería **de ese capítulo**: aparece un botón a la derecha de ese capítulo en la lista.
Los capítulos o la serie sin escenas no muestran ningún botón. En el preparador, la ficha de la serie lista cuántas escenas tiene la serie y cada capítulo.
