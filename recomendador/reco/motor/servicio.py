"""El motor en memoria: carga catálogo + rasgos desde Postgres, los recarga cuando el worker los cambia, y responde
«Para ti», «Similares», «Descubrir» y búsquedas. Lo usan la API y el bot de voz."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import numpy as np

from .. import db
from ..config import MODEL_VERSION
from ..eventos.normalizador import eventos_de
from ..voz import consulta as consulta_mod
from . import perfiles, ranker
from .rasgos import Rasgos, construir
from .reglas import Contexto

log = logging.getLogger(__name__)
RECARGA_SEG = 300
VERSION_SEG = 15     # cada cuánto se mira si el worker cambió el catálogo
CACHE_SEG = 60       # perfiles y respuestas: un evento nuevo de ese usuario los invalida antes
CACHE_MAX = 5000
DIAS_POPULARIDAD = 90
TOPE_RESULTADOS = 100

SQL_CATALOGO = """
SELECT t.title_key, t.title_type, t.name, t.year, t.description, t.kids, t.categories, t.primary_category,
       t.added_at, f.genres, f.keywords, f.cast_members, f.directors, f.overview, f.release_year,
       f.popularity, f.vote_average
FROM catalog_titles t LEFT JOIN movie_features f USING (title_key)
WHERE NOT t.deleted
ORDER BY t.title_key
"""


def _popularidad(r: Rasgos, conteos: dict[str, int]) -> np.ndarray:
    interna = np.array([conteos.get(t.title_key, 0) for t in r.titulos], dtype=np.float32)
    tmdb = np.array([t.popularidad_tmdb for t in r.titulos], dtype=np.float32)
    def escala(v: np.ndarray) -> np.ndarray:
        v = np.log1p(np.clip(v, 0, None))
        return v / v.max() if v.size and v.max() > 0 else np.zeros_like(v)
    return 0.7 * escala(interna) + 0.3 * escala(tmdb)


def _novedad(r: Rasgos, ahora: datetime) -> np.ndarray:
    salida = np.zeros(len(r), dtype=np.float32)
    for i, t in enumerate(r.titulos):
        if t.agregado:
            dias = (ahora - t.agregado).total_seconds() / 86400
            salida[i] = 1.0 if dias <= 14 else max(0.0, 1 - (dias - 14) / 76)
    return salida


class Motor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.rasgos: Rasgos | None = None
        self.senales: ranker.Senales | None = None
        self._cargado = 0.0
        self._version: Any = None
        self._version_visto = 0.0
        self._perfiles: dict[str, tuple[float, perfiles.Perfil]] = {}
        self._respuestas: dict[tuple, tuple[float, str, list[dict[str, Any]], dict[str, Any] | None]] = {}

    def invalidar(self, user_id: str | None = None) -> None:
        """Olvida lo calculado para ese usuario (o para todos) tras un evento o feedback nuevo."""
        if user_id is None:
            self._perfiles.clear()
            self._respuestas.clear()
            return
        self._perfiles.pop(user_id, None)
        for clave in [k for k in self._respuestas if k[0] == user_id]:
            self._respuestas.pop(clave, None)

    def _en_cache(self, clave: tuple, limite: int) -> dict[str, Any] | None:
        hit = self._respuestas.get(clave)
        if hit and time.monotonic() - hit[0] < CACHE_SEG:
            return self._pagina(hit[1], clave[0], hit[2], 0, limite, hit[3])
        return None

    def _guardar_cache(self, clave: tuple, respuesta: dict[str, Any], items: list[dict[str, Any]],
                       extra: dict[str, Any] | None) -> None:
        if len(self._respuestas) > CACHE_MAX:
            self._respuestas.clear()
        self._respuestas[clave] = (time.monotonic(), respuesta["request_id"], items, extra)

    # ----- carga -----
    def cargar_desde_filas(self, filas: list[dict[str, Any]], conteos: dict[str, int] | None = None,
                           ahora: datetime | None = None) -> None:
        r = construir(filas)
        ahora = ahora or datetime.now(timezone.utc)
        self.rasgos = r
        self.senales = ranker.Senales(_popularidad(r, conteos or {}), _novedad(r, ahora))
        self._cargado = time.monotonic()

    def cargar(self) -> None:
        with db.conexion() as conn:
            filas = list(conn.execute(SQL_CATALOGO))
            conteos = {
                f["movie_id"]: f["n"] for f in conn.execute(
                    "SELECT movie_id, COUNT(DISTINCT user_id) AS n FROM user_events "
                    "WHERE movie_id IS NOT NULL AND event_type IN ('view', 'watchlist', 'favorite') "
                    "AND occurred_at > NOW() - make_interval(days => %s) GROUP BY movie_id", (DIAS_POPULARIDAD,),
                )
            }
            version = conn.execute("SELECT value FROM worker_state WHERE key = 'rasgos_version'").fetchone()
        self.cargar_desde_filas(filas, conteos)
        self._version = version["value"] if version else None
        self.invalidar()
        log.info("motor cargado", extra={"titulos": len(self.rasgos), "terminos": len(self.rasgos.terminos)})

    def _cambio_version(self) -> bool:
        """¿El worker rearmó el catálogo o TMDB desde la última carga? Se mira cada VERSION_SEG (una consulta mínima)."""
        if time.monotonic() - self._version_visto < VERSION_SEG:
            return False
        self._version_visto = time.monotonic()
        try:
            with db.conexion() as conn:
                fila = conn.execute("SELECT value FROM worker_state WHERE key = 'rasgos_version'").fetchone()
        except Exception:
            return False
        return (fila["value"] if fila else None) != self._version

    def asegurar(self) -> Rasgos:
        with self._lock:
            if (self.rasgos is None or time.monotonic() - self._cargado > RECARGA_SEG
                    or (self.rasgos is not None and self._cambio_version())):
                try:
                    self.cargar()
                except Exception:
                    if self.rasgos is None:
                        raise
                    log.exception("no se pudo recargar el motor; sigo con lo que tengo")
                    self._cargado = time.monotonic()
        assert self.rasgos is not None
        return self.rasgos

    # ----- perfiles -----
    def perfil(self, user_id: str) -> perfiles.Perfil:
        r = self.asegurar()
        hit = self._perfiles.get(user_id)
        if hit and time.monotonic() - hit[0] < CACHE_SEG:
            return hit[1]
        with db.conexion() as conn:
            feedback = list(conn.execute(
                "SELECT movie_id, action, created_at FROM recommendation_feedback WHERE user_id = %s", (user_id,)
            ))
        p = perfiles.construir(user_id, eventos_de(user_id), r, feedback)
        if len(self._perfiles) > CACHE_MAX:
            self._perfiles.clear()
        self._perfiles[user_id] = (time.monotonic(), p)
        return p

    # ----- respuestas -----
    def _responder(self, user_id: str, tipo: str, recs: list[ranker.Recomendacion], limite: int,
                   extra: dict[str, Any] | None = None, kids: bool | None = None) -> dict[str, Any]:
        request_id = f"req-{uuid.uuid4().hex[:16]}"
        items = [x.json() for x in recs[:TOPE_RESULTADOS]]
        try:
            with db.conexion() as conn:
                conn.execute(
                    "INSERT INTO recommendation_results (request_id, user_id, kind, model_version, items) "
                    "VALUES (%s, %s, %s, %s, %s)", (request_id, user_id, tipo, MODEL_VERSION, db.j(items)),
                )
        except Exception:  # el resultado se entrega igual; solo se pierde la paginación consistente
            log.exception("no se guardó el resultado")
        respuesta = self._pagina(request_id, user_id, items, 0, limite, extra)
        if kids is not None:  # None = no se guarda (búsquedas)
            self._guardar_cache((user_id, tipo, (extra or {}).get("movie_id"), kids), respuesta, items, extra)
        return respuesta

    @staticmethod
    def _pagina(request_id: str, user_id: str, items: list[dict[str, Any]], desde: int, limite: int,
                extra: dict[str, Any] | None = None) -> dict[str, Any]:
        hasta = desde + limite
        return {
            "request_id": request_id, "model_version": MODEL_VERSION, "user_id": user_id,
            "recommendations": items[desde:hasta],
            "next_cursor": f"{request_id}:{hasta}" if hasta < len(items) else None,
            **(extra or {}),
        }

    def continuar(self, user_id: str, cursor: str, limite: int) -> dict[str, Any] | None:
        request_id, _, desde = cursor.rpartition(":")
        if not request_id or not desde.isdigit():
            return None
        with db.conexion() as conn:
            fila = conn.execute(
                "SELECT items FROM recommendation_results WHERE request_id = %s AND user_id = %s", (request_id, user_id)
            ).fetchone()
        return self._pagina(request_id, user_id, fila["items"], int(desde), limite) if fila else None

    def para_ti(self, user_id: str, kids: bool, limite: int = 20) -> dict[str, Any]:
        r = self.asegurar()
        if (hit := self._en_cache((user_id, "para_ti", None, kids), limite)) is not None:
            return hit
        p = self.perfil(user_id)
        lista = ranker.puntuar(r, p, self.senales, Contexto(kids=kids))
        return self._responder(user_id, "para_ti", ranker.diversificar(r, lista, min(TOPE_RESULTADOS, max(limite, 40))), limite,
                               kids=kids)

    def similares(self, user_id: str, title_key: str, kids: bool, limite: int = 12) -> dict[str, Any] | None:
        r = self.asegurar()
        i = r.fila(title_key)
        if i is None:
            return None
        if (hit := self._en_cache((user_id, "similares", title_key, kids), limite)) is not None:
            return hit
        p = self.perfil(user_id)
        base = {j: (s, "") for j, s in ranker.vecinos(r, i, 60)}
        lista = ranker.puntuar(r, p, self.senales, Contexto(kids=kids, excluir_lista=False), consulta=base)
        nombre = r.titulos[i].nombre
        for x in lista:
            x.reasons = [{"type": "similarity", "label": f"Parecida a {nombre}"}] + [
                y for y in x.reasons if y["type"] not in ("similarity", "query_match")][:1]
        return self._responder(user_id, "similares", ranker.diversificar(r, lista, limite, lam=0.85), limite,
                               {"movie_id": title_key}, kids=kids)

    def descubrir(self, user_id: str, kids: bool, limite: int = 20) -> dict[str, Any]:
        r = self.asegurar()
        if (hit := self._en_cache((user_id, "descubrir", None, kids), limite)) is not None:
            return hit
        vacio = perfiles.Perfil(user_id=user_id)
        p = self.perfil(user_id)
        vacio.vistos, vacio.descartados, vacio.generos = p.vistos, p.descartados, p.generos
        lista = ranker.puntuar(r, vacio, self.senales, Contexto(kids=kids, excluir_lista=False))
        return self._responder(user_id, "descubrir", ranker.diversificar(r, lista, limite), limite, kids=kids)

    def buscar(self, user_id: str, texto: str, kids: bool, limite: int = 10) -> dict[str, Any]:
        r = self.asegurar()
        interpretacion, coinc = consulta_mod.coincidencias(texto, r)
        p = self.perfil(user_id) if user_id else perfiles.Perfil(user_id="")
        ctx = Contexto(kids=kids or interpretacion.kids, excluir_vistos=False, excluir_lista=False)
        lista = ranker.puntuar(r, p, self.senales, ctx, consulta=coinc) if coinc else []
        return self._responder(user_id or "anonimo", "busqueda", lista, limite,
                               {"interpretacion": interpretacion.json()})

    def titulo(self, title_key: str) -> dict[str, Any] | None:
        r = self.asegurar()
        i = r.fila(title_key)
        if i is None:
            return None
        t = r.titulos[i]
        return {"title_key": t.title_key, "name": t.nombre, "year": t.anio, "type": t.tipo, "kids": t.kids}


_motor: Motor | None = None


def motor() -> Motor:
    global _motor
    if _motor is None:
        _motor = Motor()
    return _motor
