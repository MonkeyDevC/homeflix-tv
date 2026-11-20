from __future__ import annotations

from reco.voz.consulta import coincidencias, interpretar


def _top(rasgos, texto, n=3):
    _, c = coincidencias(texto, rasgos)
    return [rasgos.titulos[i].title_key for i, _ in sorted(c.items(), key=lambda x: -x[1][0])[:n]], c


def test_terror_de_los_90(rasgos):
    it = interpretar("ponme una de terror de los 90", rasgos)
    assert "terror" in it.generos and it.decada == (1990, 1999)
    top, c = _top(rasgos, "ponme una de terror de los 90", 5)
    assert set(top) <= {"m:it:1990", "m:scream:1996"} and top
    assert "Terror" in next(iter(c.values()))[1] and "90" in next(iter(c.values()))[1]


def test_parecida_a(rasgos):
    it = interpretar("algo parecido a Interestelar", rasgos)
    assert it.parecida_a == "m:interestelar:2014"
    top, _ = _top(rasgos, "algo parecido a Interestelar")
    assert "m:interestelar:2014" not in top
    assert "m:gravedad:2013" in top or "m:el origen:2010" in top


def test_con_actor(rasgos):
    it = interpretar("películas con keanu reeves", rasgos)
    assert it.personas == ["a:keanu_reeves"]
    top, _ = _top(rasgos, "películas con keanu reeves")
    assert set(top) == {"m:matrix:1999", "m:john wick:2014"}


def test_para_ninos_y_series(rasgos):
    top, _ = _top(rasgos, "una para niños", 10)
    assert top and all(rasgos.titulos[rasgos.fila(k)].kids for k in top)
    it = interpretar("una serie de misterio", rasgos)
    assert it.tipo == "series"
    top, _ = _top(rasgos, "una serie de misterio")
    assert top and all(k.startswith("s:") for k in top)


def test_se_relaja_si_no_hay_nada(rasgos):
    # comedia de los 80 no existe: suelta la década y devuelve comedias
    top, c = _top(rasgos, "una comedia de los 80")
    assert top and ("m:supercool:2007" in top or "m:que paso ayer:2009" in top)
    etiqueta = next(iter(c.values()))[1]
    assert "Comedia" in etiqueta and "80" not in etiqueta  # no promete la década que no cumplió


def test_por_nombre_y_sinopsis(rasgos):
    top, _ = _top(rasgos, "la del payaso")
    assert top[0] == "m:it:1990"
    top, _ = _top(rasgos, "matrix")
    assert top[0] == "m:matrix:1999"
