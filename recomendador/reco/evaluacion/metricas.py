"""Evaluación offline: deja fuera la última interacción positiva de cada usuario y mira si el motor la recomienda.

  P@K, R@K, NDCG@K (relevancia binaria), cobertura del catálogo y diversidad dentro de la lista (1 − similitud media).
Con pocos usuarios las cifras son ruidosas; por eso también se corre sobre un dataset sintético (tests/)."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

import numpy as np

from ..motor import perfiles, ranker
from ..motor.rasgos import Rasgos
from ..motor.reglas import Contexto

POSITIVOS = {"view", "watchlist", "favorite"}


def precision_at_k(recomendados: list[str], relevantes: set[str], k: int) -> float:
    return sum(1 for x in recomendados[:k] if x in relevantes) / k if k else 0.0


def recall_at_k(recomendados: list[str], relevantes: set[str], k: int) -> float:
    return sum(1 for x in recomendados[:k] if x in relevantes) / len(relevantes) if relevantes else 0.0


def ndcg_at_k(recomendados: list[str], relevantes: set[str], k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, x in enumerate(recomendados[:k]) if x in relevantes)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(relevantes), k)))
    return dcg / ideal if ideal else 0.0


def diversidad(r: Rasgos, claves: list[str]) -> float:
    idx = [i for i in (r.fila(c) for c in claves) if i is not None]
    if len(idx) < 2:
        return 0.0
    sub = r.similitud[np.ix_(idx, idx)]
    n = len(idx)
    return float(1 - (sub.sum() / (n * (n - 1))))


def evaluar(r: Rasgos, senales: ranker.Senales, eventos_por_usuario: dict[str, list[dict[str, Any]]],
            k: int = 10, ahora: datetime | None = None) -> dict[str, Any]:
    ahora = ahora or datetime.now(timezone.utc)
    p_k, r_k, n_k, divs = [], [], [], []
    cubiertos: set[str] = set()
    for user_id, eventos in eventos_por_usuario.items():
        positivos = sorted((e for e in eventos if e.get("movie_id") and e["event_type"] in POSITIVOS
                            and r.fila(e["movie_id"]) is not None), key=lambda e: e["occurred_at"])
        titulos = list(dict.fromkeys(e["movie_id"] for e in positivos))
        if len(titulos) < 2:
            continue
        objetivo = titulos[-1]
        corte = max(e["occurred_at"] for e in positivos if e["movie_id"] == objetivo)
        historia = [e for e in eventos if e["occurred_at"] < corte and e.get("movie_id") != objetivo]
        perfil = perfiles.construir(user_id, historia, r, ahora=corte)
        lista = ranker.diversificar(r, ranker.puntuar(r, perfil, senales, Contexto(excluir_lista=False)), k)
        claves = [x.title_key for x in lista]
        relevantes = {objetivo}
        p_k.append(precision_at_k(claves, relevantes, k))
        r_k.append(recall_at_k(claves, relevantes, k))
        n_k.append(ndcg_at_k(claves, relevantes, k))
        divs.append(diversidad(r, claves))
        cubiertos.update(claves)
    media = lambda v: round(float(np.mean(v)), 4) if v else None  # noqa: E731
    return {
        "k": k, "usuarios_evaluados": len(p_k),
        f"precision@{k}": media(p_k), f"recall@{k}": media(r_k), f"ndcg@{k}": media(n_k),
        "cobertura": round(len(cubiertos) / len(r), 4) if len(r) else None,
        "diversidad": media(divs), "fecha": ahora.isoformat(),
    }


def agrupar(filas: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    salida: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in filas:
        salida[f["user_id"]].append(f)
    return salida


def evaluar_offline(k: int = 10) -> dict[str, Any]:
    from .. import db
    from ..motor.servicio import motor
    m = motor()
    r = m.asegurar()
    with db.conexion() as conn:
        filas = conn.execute(
            "SELECT user_id, movie_id, event_type, event_value, search_query, occurred_at FROM user_events "
            "WHERE occurred_at > NOW() - INTERVAL '365 days'"
        ).fetchall()
    return evaluar(r, m.senales, agrupar(filas), k)


if __name__ == "__main__":
    import json
    from .. import registro
    registro.configurar()
    print(json.dumps(evaluar_offline(), indent=2, ensure_ascii=False))
