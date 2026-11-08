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
