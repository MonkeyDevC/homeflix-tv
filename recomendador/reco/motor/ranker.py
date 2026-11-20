"""Candidate Generator + Hybrid Ranker + diversificación (MMR).

score = 0.55·similitud + 0.15·afinidad de género + 0.10·afinidad de reparto/dirección + 0.10·popularidad + 0.10·novedad
El score es un valor para ordenar, NO una probabilidad de que guste."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import razones
from .perfiles import Perfil
from .rasgos import Rasgos, vecinos
from .reglas import Contexto, permitido

PESOS = {"sim": 0.55, "genero": 0.15, "persona": 0.10, "popularidad": 0.10, "novedad": 0.10}
PESOS_NUEVO = {"popularidad": 0.5, "novedad": 0.3, "genero": 0.2}
LAMBDA_MMR = 0.7
N_SEMILLAS = 10
VECINOS_POR_SEMILLA = 30
TOP_PERFIL = 200


@dataclass
class Senales:
    popularidad: np.ndarray  # 0..1 por título
    novedad: np.ndarray      # 0..1 por título
    retirados: set[str] = field(default_factory=set)


@dataclass
class Recomendacion:
    title_key: str
    score: float
    reasons: list[dict[str, str]]
    indice: int

    def json(self) -> dict[str, Any]:
        return {"movie_id": self.title_key, "score": round(self.score, 4), "reasons": self.reasons}


def candidatos(r: Rasgos, perfil: Perfil) -> dict[int, tuple[float, str | None]]:
    """índice → (mejor similitud con una semilla ponderada, semilla que la dio)."""
    salida: dict[int, tuple[float, str | None]] = {}
    semillas = perfil.semillas(N_SEMILLAS)
    peso_max = semillas[0][1] if semillas else 1.0
    for clave, peso in semillas:
        i = r.fila(clave)
        if i is None:
            continue
        factor = 0.5 + 0.5 * (peso / peso_max)
        for j, s in vecinos(r, i, VECINOS_POR_SEMILLA):
            v = s * factor
            if v > salida.get(j, (0.0, None))[0]:
                salida[j] = (v, clave)
    if perfil.vector is not None and r.matriz.shape[1]:
        coseno = np.asarray(r.matriz @ perfil.vector).ravel()
        for j in np.argsort(-coseno)[:TOP_PERFIL]:
            if coseno[j] > 0 and int(j) not in salida:
                salida[int(j)] = (0.0, None)
    return salida


def _afinidad(r: Rasgos, i: int, afinidades: dict[str, float], prefijos: tuple[str, ...]) -> tuple[float, str | None]:
    mejor, termino = 0.0, None
    for pref in prefijos:
        for t in r.terminos_de(i, pref):
            if afinidades.get(t, 0) > mejor:
                mejor, termino = afinidades[t], t
    return mejor, termino


def puntuar(r: Rasgos, perfil: Perfil, senales: Senales, ctx: Contexto,
            consulta: dict[int, tuple[float, str]] | None = None) -> list[Recomendacion]:
    """Ordena candidatos. `consulta` (búsqueda) reemplaza la similitud con el perfil por la coincidencia con el texto."""
    if consulta is not None:
        base = {i: (s, None) for i, (s, _) in consulta.items()}
    elif perfil.nuevo:
        base = {i: (0.0, None) for i in range(len(r))}
    else:
        base = candidatos(r, perfil)
    coseno = (np.asarray(r.matriz @ perfil.vector).ravel()
              if perfil.vector is not None and r.matriz.shape[1] else None)
    salida: list[Recomendacion] = []
    for i, (sim_semilla, semilla) in base.items():
        t = r.titulos[i]
        if not permitido(t, perfil, ctx, senales.retirados):
            continue
        g, g_term = _afinidad(r, i, perfil.generos, ("g",))
        pe, pe_term = _afinidad(r, i, perfil.personas, ("a", "d"))
        pop, nov = float(senales.popularidad[i]), float(senales.novedad[i])
        if consulta is not None:
            sim = sim_semilla
            aportes = {"sim": 0.70 * sim, "genero": 0.10 * g, "persona": 0.05 * pe, "popularidad": 0.10 * pop,
                       "novedad": 0.05 * nov}
        elif perfil.nuevo:
            aportes = {k: PESOS_NUEVO[k] * v for k, v in (("popularidad", pop), ("novedad", nov), ("genero", g))}
        else:
            sim = max(sim_semilla, float(coseno[i]) if coseno is not None else 0.0)
            aportes = {"sim": PESOS["sim"] * sim, "genero": PESOS["genero"] * g, "persona": PESOS["persona"] * pe,
                       "popularidad": PESOS["popularidad"] * pop, "novedad": PESOS["novedad"] * nov}
        detalle: dict[str, Any] = {}
        if semilla and sim_semilla >= 0.2:
            j = r.fila(semilla)
            detalle["semilla"] = r.titulos[j].nombre if j is not None else None
            detalle["semilla_origen"] = perfil.origen.get(semilla, "")
        if g_term:
            detalle["genero"] = r.nombres.get(g_term, g_term[2:])
        if pe_term:
            detalle["persona"] = (pe_term[0], r.nombres.get(pe_term, pe_term[2:]))
        if consulta is not None and consulta.get(i, (0, ""))[1]:
            detalle["consulta"] = consulta[i][1]
        salida.append(Recomendacion(t.title_key, sum(aportes.values()), razones.armar(aportes, detalle), i))
    salida.sort(key=lambda x: -x.score)
    return salida


def diversificar(r: Rasgos, lista: list[Recomendacion], n: int, lam: float = LAMBDA_MMR) -> list[Recomendacion]:
    """Maximal Marginal Relevance: no llenar la fila con cinco secuelas de lo mismo."""
    pool = lista[: max(n * 4, 60)]
    if not pool:
        return []
    maximo = max(x.score for x in pool) or 1.0
    elegidos: list[Recomendacion] = []
    while pool and len(elegidos) < n:
        def valor(c: Recomendacion) -> float:
            parecido = max((float(r.similitud[c.indice, e.indice]) for e in elegidos), default=0.0)
            return lam * (c.score / maximo) - (1 - lam) * parecido
        mejor = max(pool, key=valor)
        elegidos.append(mejor)
        pool.remove(mejor)
    return elegidos
