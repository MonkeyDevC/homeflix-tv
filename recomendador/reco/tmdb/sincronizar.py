"""Enriquecimiento incremental con TMDB: títulos nuevos (pending) y refresco cada 30 días.
Con #tmdb… en el comentario se usa ese id; sin él se busca por nombre y año, y solo se acepta una coincidencia
exacta (nombre normalizado igual y año ±1). Si no, queda «unmatched» y el motor usa solo lo del comentario."""

from __future__ import annotations

import logging
from typing import Any

from .. import db
from ..texto import norm
from .cliente import ClienteTmdb, ErrorTmdb

log = logging.getLogger(__name__)
MAX_REPARTO = 8
MAX_KEYWORDS = 20


def extraer(tipo: str, d: dict[str, Any]) -> dict[str, Any]:
    """Del JSON de TMDB a las columnas de movie_features."""
    creditos = d.get("credits") or {}
    if tipo == "tv":
        keywords = (d.get("keywords") or {}).get("results", [])
        directores = [p.get("name") for p in d.get("created_by", []) if p.get("name")]
        fecha = d.get("first_air_date") or ""
        titulo_original = d.get("original_name")
    else:
        keywords = (d.get("keywords") or {}).get("keywords", [])
        directores = [p.get("name") for p in creditos.get("crew", []) if p.get("job") == "Director" and p.get("name")]
        fecha = d.get("release_date") or ""
        titulo_original = d.get("original_title")
    reparto = sorted(creditos.get("cast", []), key=lambda p: p.get("order", 999))
    return {
        "genres": [g["name"] for g in d.get("genres", []) if g.get("name")],
        "keywords": [k["name"] for k in keywords if k.get("name")][:MAX_KEYWORDS],
        "cast_members": [p["name"] for p in reparto if p.get("name")][:MAX_REPARTO],
        "directors": list(dict.fromkeys(directores))[:3],
        "overview": d.get("overview") or "",
        "original_language": d.get("original_language"),
        "release_year": int(fecha[:4]) if fecha[:4].isdigit() else None,
        "popularity": d.get("popularity"),
        "vote_average": d.get("vote_average"),
        "titulo_original": titulo_original,
    }


def elegir(resultados: list[dict[str, Any]], tipo: str, nombre: str, anio: int | None) -> dict[str, Any] | None:
    objetivo = norm(nombre)
    for r in resultados:
        nombres = {norm(r.get("title") or r.get("name")), norm(r.get("original_title") or r.get("original_name"))}
        fecha = r.get("release_date") if tipo == "movie" else r.get("first_air_date")
        anio_r = int(fecha[:4]) if fecha and fecha[:4].isdigit() else None
        if objetivo in nombres and (not anio or not anio_r or abs(anio_r - anio) <= 1):
            return r
    return None


def pendientes(limite: int) -> list[dict[str, Any]]:
    with db.conexion() as conn:
        return list(conn.execute(
            """
            SELECT t.title_key, t.title_type, t.name, t.year, f.tmdb_id, f.tmdb_type, f.tmdb_status
            FROM catalog_titles t JOIN movie_features f USING (title_key)
            WHERE NOT t.deleted AND (
                f.tmdb_status = 'pending'
                OR (f.tmdb_status = 'ok' AND f.source_updated_at < NOW() - INTERVAL '30 days')
                OR (f.tmdb_status IN ('error', 'unmatched') AND f.updated_at < NOW() - INTERVAL '7 days'))
            ORDER BY (f.tmdb_status = 'pending') DESC, t.added_at DESC NULLS LAST
            LIMIT %s
            """,
            (limite,),
        ))


def sincronizar(limite: int = 60, cliente: ClienteTmdb | None = None) -> dict[str, int]:
    propio = cliente is None
    try:
        cliente = cliente or ClienteTmdb()
    except ErrorTmdb as e:
        log.warning("TMDB desactivado", extra={"motivo": str(e)})
        return {"ok": 0, "unmatched": 0, "error": 0}
    cuenta = {"ok": 0, "unmatched": 0, "error": 0}
    try:
        for fila in pendientes(limite):
            tipo = fila["tmdb_type"] or ("tv" if fila["title_type"] == "series" else "movie")
            try:
                tmdb_id = fila["tmdb_id"]
                if not tmdb_id:
                    elegido = elegir(cliente.buscar(tipo, fila["name"], fila["year"]), tipo, fila["name"], fila["year"])
                    if not elegido and not fila["tmdb_type"]:
                        # «It» (1990) es miniserie en TMDB aunque en el grupo vaya como película (y al revés)
                        otro = "movie" if tipo == "tv" else "tv"
                        elegido = elegir(cliente.buscar(otro, fila["name"], fila["year"]), otro, fila["name"], fila["year"])
                        tipo = otro if elegido else tipo
                    if not elegido:
                        _marcar(fila["title_key"], "unmatched")
                        cuenta["unmatched"] += 1
                        continue
                    tmdb_id = elegido["id"]
                datos = extraer(tipo, cliente.detalle(tipo, tmdb_id))
                _guardar(fila["title_key"], tipo, tmdb_id, datos)
                cuenta["ok"] += 1
            except ErrorTmdb:
                _marcar(fila["title_key"], "unmatched")
                cuenta["unmatched"] += 1
            except Exception:  # noqa: BLE001 — un título roto no detiene a los demás
                log.exception("TMDB falló", extra={"title_key": fila["title_key"]})
                _marcar(fila["title_key"], "error")
                cuenta["error"] += 1
    finally:
        if propio and cliente:
            cliente.cerrar()
    if any(cuenta.values()):
        log.info("TMDB sincronizado", extra=cuenta)
    return cuenta


def _marcar(title_key: str, estado: str) -> None:
    with db.conexion() as conn:
        conn.execute(
            "UPDATE movie_features SET tmdb_status = %s, updated_at = NOW() WHERE title_key = %s", (estado, title_key)
        )


def _guardar(title_key: str, tipo: str, tmdb_id: int, d: dict[str, Any]) -> None:
    with db.conexion() as conn:
        conn.execute(
            """
            UPDATE movie_features SET tmdb_id = %s, tmdb_type = %s, tmdb_status = 'ok', genres = %s, keywords = %s,
                cast_members = %s, directors = %s, overview = %s, original_language = %s, release_year = %s,
                popularity = %s, vote_average = %s, source_updated_at = NOW(), updated_at = NOW()
            WHERE title_key = %s
            """,
            (
                tmdb_id, tipo, db.j(d["genres"]), db.j(d["keywords"]), db.j(d["cast_members"]), db.j(d["directors"]),
                d["overview"], d["original_language"], d["release_year"], d["popularity"], d["vote_average"], title_key,
            ),
        )
