"""Métricas offline sobre un dataset sintético: usuarios con gustos claros por género."""

from __future__ import annotations

import random

from reco.evaluacion.metricas import evaluar, ndcg_at_k, precision_at_k, recall_at_k
from reco.motor import ranker
from reco.motor.servicio import _novedad, _popularidad

from .conftest import AHORA, evento

GUSTOS = {
    "terror": ["m:el resplandor:1980", "m:it:1990", "m:scream:1996", "m:el conjuro:2013", "m:hereditary:2018"],
    "scifi": ["m:interestelar:2014", "m:el origen:2010", "m:gravedad:2013", "m:matrix:1999", "s:dark"],
    "kids": ["m:toy story:1995", "m:coco:2017", "m:el rey leon:1994"],
}


def test_metricas_basicas():
    assert precision_at_k(["a", "b"], {"b"}, 2) == 0.5
    assert recall_at_k(["a", "b"], {"b", "c"}, 2) == 0.5
    assert ndcg_at_k(["b", "a"], {"b"}, 2) == 1.0
    assert 0 < ndcg_at_k(["a", "b"], {"b"}, 2) < 1


def test_dataset_sintetico_supera_al_azar(rasgos):
    azar = random.Random(7)
    usuarios = {}
    for n in range(30):
        gusto = list(GUSTOS)[n % 3]
        vistos = azar.sample(GUSTOS[gusto], k=min(4, len(GUSTOS[gusto])))
        usuarios[f"u{n}:p1"] = [evento(t, "view", 2, dias=40 - i * 5) for i, t in enumerate(vistos)]
    senales = ranker.Senales(_popularidad(rasgos, {}), _novedad(rasgos, AHORA))
    m = evaluar(rasgos, senales, usuarios, k=5, ahora=AHORA)
    assert m["usuarios_evaluados"] == 30
    # al azar, acertar 1 entre ~18 títulos con 5 intentos ≈ 0.28 de recall
    assert m["recall@5"] > 0.5, m
    assert m["ndcg@5"] > 0.3, m
    assert 0 < m["diversidad"] <= 1
