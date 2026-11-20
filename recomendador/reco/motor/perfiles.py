"""User Profile Builder: de los eventos de un usuario (cuenta:perfil) a sus preferencias.

- Peso por título = Σ por tipo de evento (el valor más alto de ese tipo) × decaimiento temporal (vida media 60 días).
  Usar el máximo por tipo evita que una serie de 40 capítulos pese 40 veces más que una película.
- Mi lista: cuenta solo su estado más reciente (agregar +3, quitar −1).
- Vista no implica gusto: una vista completa suma +2 y una a medias +1; «no me gusta» la convierte en exclusión.
- Búsquedas sin título elegido suman interés al género que nombran (+0.3), no a una película."""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from ..eventos.normalizador import PESOS
from ..texto import ficha, norm
from .rasgos import Rasgos

VIDA_MEDIA_DIAS = 60.0
PESO_BUSQUEDA_GENERO = 0.3
TOP_AFINIDADES = 15


@dataclass
class Perfil:
    user_id: str
    pesos: dict[str, float] = field(default_factory=dict)           # title_key → peso (puede ser negativo)
    vistos: set[str] = field(default_factory=set)                    # vista completa
    en_lista: set[str] = field(default_factory=set)                  # hoy en Mi lista
    descartados: set[str] = field(default_factory=set)               # «descartar» / «no me gusta»
    origen: dict[str, str] = field(default_factory=dict)             # title_key → evento más fuerte
    generos: dict[str, float] = field(default_factory=dict)          # «g:terror» → 0..1
    personas: dict[str, float] = field(default_factory=dict)         # «a:…» / «d:…» → 0..1
    vector: np.ndarray | None = None
    interacciones: int = 0
    ultimo: datetime | None = None

    @property
    def nuevo(self) -> bool:
        return not any(p > 0 for p in self.pesos.values())

    def semillas(self, n: int = 10) -> list[tuple[str, float]]:
        return sorted(((k, p) for k, p in self.pesos.items() if p > 0), key=lambda x: -x[1])[:n]

    def resumen(self, rasgos: Rasgos) -> dict[str, Any]:
        def top(d: dict[str, float], prefijo: str) -> dict[str, float]:
            return {rasgos.nombres.get(k, k.split(":", 1)[1]): round(v, 3)
                    for k, v in sorted(d.items(), key=lambda x: -x[1]) if k.startswith(prefijo)}
        return {
            "user_id": self.user_id,
            "preferred_genres": top(self.generos, "g:"),
            "preferred_actors": top(self.personas, "a:"),
            "preferred_directors": top(self.personas, "d:"),
            "disliked_movies": sorted(self.descartados),
            "interaction_count": self.interacciones,
            "last_event_at": self.ultimo.isoformat() if self.ultimo else None,
        }


def _decaimiento(cuando: datetime, ahora: datetime) -> float:
    dias = max(0.0, (ahora - cuando).total_seconds() / 86400)
    return 0.5 ** (dias / VIDA_MEDIA_DIAS)


def _a_dt(valor: Any) -> datetime:
    if isinstance(valor, datetime):
        return valor if valor.tzinfo else valor.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(valor))


def construir(user_id: str, eventos: list[dict[str, Any]], rasgos: Rasgos,
              feedback: list[dict[str, Any]] | None = None, ahora: datetime | None = None) -> Perfil:
    ahora = ahora or datetime.now(timezone.utc)
    p = Perfil(user_id=user_id, interacciones=len(eventos))
    # (título, tipo) → (valor máximo, fecha más nueva)
    por_tipo: dict[tuple[str, str], tuple[float, datetime]] = {}
    lista_estado: dict[str, tuple[datetime, bool]] = {}
    generos_busqueda: dict[str, float] = defaultdict(float)
    vocab_generos = {k for k in rasgos.terminos if k.startswith("g:")}

    for e in eventos:
        cuando = _a_dt(e["occurred_at"])
        p.ultimo = max(p.ultimo, cuando) if p.ultimo else cuando
        tipo, titulo = e["event_type"], e.get("movie_id")
        valor = float(e["event_value"] if e.get("event_value") is not None else PESOS.get(tipo, 0))
        if tipo in ("watchlist", "watchlist_remove") and titulo:
            if titulo not in lista_estado or cuando > lista_estado[titulo][0]:
                lista_estado[titulo] = (cuando, tipo == "watchlist")
            continue
        if tipo == "search" and not titulo:
            for palabra in norm(e.get("search_query") or "").split():
                g = f"g:{ficha(palabra)}"
                if g in vocab_generos:
                    generos_busqueda[g] += PESO_BUSQUEDA_GENERO * _decaimiento(cuando, ahora)
            continue
        if not titulo:
            continue
        if tipo == "view" and valor >= 2:
            p.vistos.add(titulo)
        clave = (titulo, tipo)
        previo = por_tipo.get(clave)
        por_tipo[clave] = (max(valor, previo[0]) if previo else valor, max(cuando, previo[1]) if previo else cuando)

    for titulo, (cuando, activo) in lista_estado.items():
        tipo = "watchlist" if activo else "watchlist_remove"
        por_tipo[(titulo, tipo)] = (PESOS[tipo], cuando)
        if activo:
            p.en_lista.add(titulo)

    for f in feedback or []:
        if f["action"] in ("descartar", "no_me_gusta"):
            p.descartados.add(f["movie_id"])
        elif f["action"] == "me_gusta":
            por_tipo[(f["movie_id"], "favorite")] = (PESOS["favorite"], _a_dt(f["created_at"]))

    fuerza: dict[str, float] = {}
    for (titulo, tipo), (valor, cuando) in por_tipo.items():
        aporte = valor * _decaimiento(cuando, ahora)
        p.pesos[titulo] = p.pesos.get(titulo, 0.0) + aporte
        if aporte > fuerza.get(titulo, 0):
            fuerza[titulo] = aporte
            p.origen[titulo] = tipo
    for titulo in p.descartados:
        p.pesos[titulo] = min(p.pesos.get(titulo, 0.0), -1.0)

    _vector_y_afinidades(p, rasgos, generos_busqueda)
    return p


def _vector_y_afinidades(p: Perfil, rasgos: Rasgos, generos_busqueda: dict[str, float]) -> None:
    generos: dict[str, float] = defaultdict(float, generos_busqueda)
    personas: dict[str, float] = defaultdict(float)
    filas, pesos = [], []
    for titulo, peso in p.pesos.items():
        i = rasgos.fila(titulo)
        if i is None or peso <= 0:
            continue
        filas.append(i)
        pesos.append(peso)
        for t in rasgos.terminos_de(i, "g"):
            generos[t] += peso
        for pref in ("a", "d"):
            for t in rasgos.terminos_de(i, pref):
                personas[t] += peso
    if filas and rasgos.matriz.shape[1]:
        v = np.asarray(rasgos.matriz[filas].T @ np.array(pesos)).ravel()
        n = np.linalg.norm(v)
        p.vector = v / n if n > 0 else None
    p.generos = _escala(generos)
    p.personas = _escala(personas)


def _escala(d: dict[str, float]) -> dict[str, float]:
    if not d:
        return {}
    maximo = max(d.values())
    if maximo <= 0:
        return {}
    top = sorted(d.items(), key=lambda x: -x[1])[:TOP_AFINIDADES * 2]
    return {k: v / maximo for k, v in top if v > 0}


def a_fila(p: Perfil, rasgos: Rasgos) -> dict[str, Any]:
    """Para guardar en recommendation.user_profiles (lo hace el worker cada noche y la API al pedir el perfil)."""
    r = p.resumen(rasgos)
    return {
        **r,
        "title_weights": {k: round(v, 4) for k, v in sorted(p.pesos.items(), key=lambda x: -abs(x[1]))[:100]},
        "profile_vector": None if p.vector is None else _vector_ralo(p.vector, rasgos),
    }


def _vector_ralo(v: np.ndarray, rasgos: Rasgos, n: int = 40) -> dict[str, float]:
    idx = np.argsort(-v)[:n]
    return {rasgos.terminos[i]: round(float(v[i]), 4) for i in idx if v[i] > 0 and not math.isnan(v[i])}
