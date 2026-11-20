from __future__ import annotations

import numpy as np

from reco.motor import perfiles, ranker
from reco.motor.rasgos import vecinos
from reco.motor.reglas import Contexto
from reco.motor.servicio import _novedad, _popularidad

from .conftest import AHORA, evento


def _senales(r):
    return ranker.Senales(_popularidad(r, {}), _novedad(r, AHORA))


def test_rasgos_similitud_tiene_sentido(rasgos):
    i = rasgos.fila("m:interestelar:2014")
    cercanos = [rasgos.titulos[j].title_key for j, _ in vecinos(rasgos, i, 3)]
    assert "m:gravedad:2013" in cercanos or "m:el origen:2010" in cercanos
    assert rasgos.similitud[i, i] == 0
    assert np.allclose(rasgos.similitud, rasgos.similitud.T, atol=1e-5)


def test_perfil_decaimiento_y_lista(rasgos):
    ev = [
        evento("m:el resplandor:1980", "view", 2, dias=1),
        evento("m:supercool:2007", "view", 2, dias=300),
        evento("m:it:1990", "watchlist", dias=10),
        evento("m:it:1990", "watchlist_remove", dias=2),
    ]
    p = perfiles.construir("u:p1", ev, rasgos, ahora=AHORA)
    assert p.pesos["m:el resplandor:1980"] > 1.9
    assert p.pesos["m:supercool:2007"] < 0.1           # 300 días: casi nada
    assert p.pesos["m:it:1990"] < 0                    # lo quitó de la lista: cuenta el estado más reciente
    assert "m:it:1990" not in p.en_lista
    assert p.vistos == {"m:el resplandor:1980", "m:supercool:2007"}
    assert max(p.generos, key=p.generos.get) == "g:terror"


def test_serie_no_infla_por_capitulos(rasgos):
    ev = [evento("s:dark", "view", 2, dias=d) for d in range(1, 30)] + [evento("m:matrix:1999", "view", 2, dias=1)]
    p = perfiles.construir("u:p1", ev, rasgos, ahora=AHORA)
    assert p.pesos["s:dark"] <= p.pesos["m:matrix:1999"] + 0.1


def test_para_ti_terror(rasgos):
    ev = [evento("m:el resplandor:1980", "view", 2), evento("m:scream:1996", "favorite"),
          evento("m:hereditary:2018", "watchlist")]
    p = perfiles.construir("u:p1", ev, rasgos, ahora=AHORA)
    lista = ranker.puntuar(rasgos, p, _senales(rasgos), Contexto())
    claves = [x.title_key for x in lista[:3]]
    assert "m:el conjuro:2013" in claves or "m:it:1990" in claves
    vistos_o_lista = {"m:el resplandor:1980", "m:hereditary:2018"}
    assert not vistos_o_lista & {x.title_key for x in lista}
    assert all(x.reasons for x in lista)
    assert any(r["type"] in ("similarity", "genre_affinity") for r in lista[0].reasons)


def test_anime_fuera_y_kids(rasgos):
    p = perfiles.construir("u:kids", [evento("m:toy story:1995", "view", 2)], rasgos, ahora=AHORA)
    lista = ranker.puntuar(rasgos, p, _senales(rasgos), Contexto(kids=True))
    assert lista and all(rasgos.titulos[x.indice].kids for x in lista)
    todo = ranker.puntuar(rasgos, perfiles.Perfil("u"), _senales(rasgos), Contexto())
    assert "m:naruto la pelicula:2004" not in {x.title_key for x in todo}


def test_usuario_nuevo_popular_y_nuevo(rasgos):
    p = perfiles.construir("u:nuevo", [], rasgos, ahora=AHORA)
    assert p.nuevo
    lista = ranker.diversificar(rasgos, ranker.puntuar(rasgos, p, _senales(rasgos), Contexto()), 5)
    assert len(lista) == 5
    assert lista[0].title_key in ("m:el conjuro:2013", "m:interestelar:2014")
    assert {r["type"] for x in lista for r in x.reasons} & {"popular", "new"}


def test_busqueda_de_genero_sin_titulo_suma_interes(rasgos):
    p = perfiles.construir("u", [evento(None, "search", consulta="algo de terror")], rasgos, ahora=AHORA)
    assert p.generos.get("g:terror", 0) > 0
    assert p.nuevo  # buscar no es haber visto


def test_diversificar_no_repite_todo_lo_mismo(rasgos):
    ev = [evento("m:interestelar:2014", "favorite")]
    p = perfiles.construir("u", ev, rasgos, ahora=AHORA)
    lista = ranker.puntuar(rasgos, p, _senales(rasgos), Contexto())
    div = ranker.diversificar(rasgos, lista, 6, lam=0.5)
    assert len({x.title_key for x in div}) == 6
    generos = {g for x in div for g in rasgos.terminos_de(x.indice, "g")}
    assert len(generos) >= 3


def test_descartado_no_vuelve(rasgos):
    p = perfiles.construir("u", [evento("m:el resplandor:1980", "view", 2)], rasgos,
                           feedback=[{"movie_id": "m:it:1990", "action": "descartar", "created_at": AHORA}], ahora=AHORA)
    assert "m:it:1990" not in {x.title_key for x in ranker.puntuar(rasgos, p, _senales(rasgos), Contexto())}
