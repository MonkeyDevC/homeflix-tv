"""Catálogo sintético pequeño pero con estructura real (géneros, reparto, décadas, kids) para probar el motor sin
Postgres ni Telegram."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

AHORA = datetime(2026, 11, 20, tzinfo=timezone.utc)


def titulo(clave, nombre, anio, generos, reparto=(), directores=(), keywords=(), kids=False, tipo="movie",
           sinopsis="", dias=200, categorias=None, popularidad=10.0):
    return {
        "title_key": clave, "title_type": tipo, "name": nombre, "year": anio, "description": sinopsis,
        "kids": kids, "categories": categorias if categorias is not None else [generos[0]] if generos else [],
        "primary_category": (categorias or generos or [None])[0], "added_at": AHORA - timedelta(days=dias),
        "genres": list(generos), "keywords": list(keywords), "cast_members": list(reparto),
        "directors": list(directores), "overview": sinopsis, "release_year": anio, "popularity": popularidad,
        "vote_average": 7.0,
    }


CATALOGO = [
    titulo("m:el resplandor:1980", "El resplandor", 1980, ["Terror"], ["Jack Nicholson"], ["Stanley Kubrick"],
           ["hotel", "aislamiento", "fantasma"], sinopsis="Un escritor cuida un hotel aislado en invierno y enloquece."),
    titulo("m:it:1990", "It", 1990, ["Terror"], ["Tim Curry"], ["Tommy Lee Wallace"], ["payaso", "pueblo"],
           sinopsis="Un payaso aterroriza a los niños de un pueblo."),
    titulo("m:scream:1996", "Scream", 1996, ["Terror", "Misterio"], ["Neve Campbell"], ["Wes Craven"],
           ["asesino", "adolescentes"], sinopsis="Un asesino enmascarado acecha a unos adolescentes."),
    titulo("m:el sexto sentido:1999", "El sexto sentido", 1999, ["Suspense", "Drama"], ["Bruce Willis"],
           ["M. Night Shyamalan"], ["fantasma", "nino"], sinopsis="Un niño ve fantasmas y un psicólogo intenta ayudarlo."),
    titulo("m:el conjuro:2013", "El conjuro", 2013, ["Terror"], ["Vera Farmiga"], ["James Wan"],
           ["casa embrujada", "demonio"], sinopsis="Investigadores paranormales ayudan a una familia en una casa embrujada.",
           dias=5, popularidad=80),
    titulo("m:hereditary:2018", "Hereditary", 2018, ["Terror", "Misterio"], ["Toni Collette"], ["Ari Aster"],
           ["familia", "demonio"], sinopsis="Tras la muerte de la abuela una familia descubre secretos oscuros."),
    titulo("m:interestelar:2014", "Interestelar", 2014, ["Ciencia ficción", "Drama"], ["Matthew McConaughey"],
           ["Christopher Nolan"], ["espacio", "agujero negro", "viaje en el tiempo"],
           sinopsis="Astronautas viajan por un agujero de gusano en el espacio para salvar a la humanidad.", popularidad=90),
    titulo("m:el origen:2010", "El origen", 2010, ["Ciencia ficción", "Acción"], ["Leonardo DiCaprio"],
           ["Christopher Nolan"], ["sueños", "robo"], sinopsis="Un ladrón roba secretos entrando en los sueños."),
    titulo("m:gravedad:2013", "Gravedad", 2013, ["Ciencia ficción", "Suspense"], ["Sandra Bullock"],
           ["Alfonso Cuarón"], ["espacio", "astronauta"], sinopsis="Dos astronautas quedan a la deriva en el espacio."),
    titulo("m:matrix:1999", "Matrix", 1999, ["Ciencia ficción", "Acción"], ["Keanu Reeves"], ["Lana Wachowski"],
           ["realidad virtual", "hacker"], sinopsis="Un hacker descubre que la realidad es una simulación."),
    titulo("m:john wick:2014", "John Wick", 2014, ["Acción", "Suspense"], ["Keanu Reeves"], ["Chad Stahelski"],
           ["venganza", "asesino a sueldo"], sinopsis="Un exasesino busca venganza."),
    titulo("m:mad max furia en el camino:2015", "Mad Max: Furia en el camino", 2015, ["Acción", "Aventura"],
           ["Tom Hardy"], ["George Miller"], ["desierto", "persecucion"], sinopsis="Persecución en un desierto postapocalíptico."),
    titulo("m:supercool:2007", "Supercool", 2007, ["Comedia"], ["Jonah Hill"], ["Greg Mottola"], ["fiesta", "amistad"],
           sinopsis="Dos amigos intentan conseguir alcohol para una fiesta."),
    titulo("m:que paso ayer:2009", "¿Qué pasó ayer?", 2009, ["Comedia"], ["Bradley Cooper"], ["Todd Phillips"],
           ["las vegas", "despedida de soltero"], sinopsis="Tres amigos despiertan sin recordar la despedida de soltero."),
    titulo("m:toy story:1995", "Toy Story", 1995, ["Animación", "Familia", "Comedia"], ["Tom Hanks"],
           ["John Lasseter"], ["juguetes", "amistad"], kids=True, categorias=["Animadas"],
           sinopsis="Los juguetes de un niño cobran vida."),
    titulo("m:coco:2017", "Coco", 2017, ["Animación", "Familia", "Fantasía"], ["Anthony Gonzalez"], ["Lee Unkrich"],
           ["dia de muertos", "musica"], kids=True, categorias=["Animadas"],
           sinopsis="Un niño viaja a la tierra de los muertos."),
    titulo("m:el rey leon:1994", "El Rey León", 1994, ["Animación", "Familia", "Drama"], ["Matthew Broderick"],
           ["Roger Allers"], ["leon", "africa"], kids=True, categorias=["Animadas"],
           sinopsis="Un joven león debe reclamar su lugar como rey."),
    titulo("s:dark", "Dark", 2017, ["Misterio", "Ciencia ficción", "Drama"], ["Louis Hofmann"], ["Baran bo Odar"],
           ["viaje en el tiempo", "pueblo"], tipo="series", sinopsis="Niños desaparecen en un pueblo alemán y el tiempo se rompe."),
    titulo("s:stranger things", "Stranger Things", 2016, ["Ciencia ficción", "Misterio", "Terror"],
           ["Millie Bobby Brown"], ["Matt Duffer"], ["pueblo", "monstruo", "anos 80"], tipo="series",
           sinopsis="Un niño desaparece y sus amigos encuentran a una niña con poderes."),
    titulo("m:naruto la pelicula:2004", "Naruto la película", 2004, ["Animación"], [], [], [], categorias=["Anime"],
           sinopsis="Ninjas."),
]


@pytest.fixture
def filas():
    return [dict(f) for f in CATALOGO]


@pytest.fixture
def rasgos(filas):
    from reco.motor.rasgos import construir
    return construir(filas)


def evento(movie_id, tipo, valor=None, dias=1, consulta=None):
    return {"movie_id": movie_id, "event_type": tipo, "event_value": valor, "search_query": consulta,
            "occurred_at": AHORA - timedelta(days=dias)}
