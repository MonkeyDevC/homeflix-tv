"""Del grupo de Telegram al índice del motor: arma títulos con js/library.js (vía Node) y los guarda en Postgres."""

from __future__ import annotations

import json
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import db
from ..config import config

log = logging.getLogger(__name__)
ARMAR_MJS = Path(__file__).with_name("armar.mjs")
TMDB_MARCA = re.compile(r"#\s*tmdb(tv)?[_:-]?(\d{1,9})\b", re.I)


def armar(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Corre js/library.js build() sobre los mensajes. Devuelve {titles: [...], videos: {videoKey: titleKey}}."""
    cfg = config()
    proceso = subprocess.run(
        [cfg.node_bin, str(ARMAR_MJS)],
        input=json.dumps(items, ensure_ascii=False),
        capture_output=True, text=True, timeout=120, check=False,
        env={"HF_LIBRARY_JS": cfg.library_js, "PATH": "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"},
    )
    if proceso.returncode != 0:
        raise RuntimeError(f"armar.mjs falló: {proceso.stderr.strip()[:500]}")
    catalogo = json.loads(proceso.stdout)
    _completar_tmdb(catalogo, items)
    return catalogo


def _completar_tmdb(catalogo: dict[str, Any], items: list[dict[str, Any]]) -> None:
    """library.js no guarda el #tmdbtv… de las series (va en cada capítulo): se toma del primer capítulo que lo tenga."""
    por_titulo: dict[str, dict[str, Any]] = {}
    for it in items:
        tk = catalogo["videos"].get(it.get("key", ""))
        m = TMDB_MARCA.search(it.get("caption") or "")
        if tk and m and tk not in por_titulo:
            por_titulo[tk] = {"type": "tv" if m.group(1) else "movie", "id": int(m.group(2))}
    for t in catalogo["titles"]:
        if not t.get("tmdb") and t["titleKey"] in por_titulo:
            t["tmdb"] = por_titulo[t["titleKey"]]


def _fecha(ms: int | float | None) -> datetime | None:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc) if ms else None


def guardar(catalogo: dict[str, Any]) -> dict[str, int]:
    """Actualiza catalog_titles/catalog_videos. Lo que ya no está en el grupo queda deleted=TRUE (no se borra:
    los eventos viejos lo siguen nombrando)."""
    titulos = catalogo["titles"]
    claves = [t["titleKey"] for t in titulos]
    with db.conexion() as conn, conn.transaction():
        for t in titulos:
            tmdb = t.get("tmdb") or {}
            conn.execute(
                """
                INSERT INTO catalog_titles (title_key, title_type, name, year, description, kids, categories,
                    primary_category, tmdb_type, tmdb_id, added_at, last_seen, deleted)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), FALSE)
                ON CONFLICT (title_key) DO UPDATE SET
                    title_type = EXCLUDED.title_type, name = EXCLUDED.name, year = EXCLUDED.year,
                    description = EXCLUDED.description, kids = EXCLUDED.kids, categories = EXCLUDED.categories,
                    primary_category = EXCLUDED.primary_category,
                    tmdb_type = COALESCE(EXCLUDED.tmdb_type, catalog_titles.tmdb_type),
                    tmdb_id = COALESCE(EXCLUDED.tmdb_id, catalog_titles.tmdb_id),
                    added_at = LEAST(COALESCE(catalog_titles.added_at, EXCLUDED.added_at), EXCLUDED.added_at),
                    last_seen = NOW(), deleted = FALSE
                """,
                (
                    t["titleKey"], t["type"], t["name"], t.get("year") or None, t.get("description") or "",
                    bool(t.get("kids")), db.j(t.get("categories") or []), t.get("primaryCategory") or None,
                    tmdb.get("type"), tmdb.get("id"), _fecha(t.get("date")),
                ),
            )
            conn.execute(
                "INSERT INTO movie_features (title_key, tmdb_id, tmdb_type) VALUES (%s, %s, %s) "
                "ON CONFLICT (title_key) DO UPDATE SET "
                "tmdb_status = CASE WHEN movie_features.tmdb_id IS DISTINCT FROM EXCLUDED.tmdb_id "
                "  AND EXCLUDED.tmdb_id IS NOT NULL THEN 'pending' ELSE movie_features.tmdb_status END, "
                "tmdb_id = COALESCE(EXCLUDED.tmdb_id, movie_features.tmdb_id), "
                "tmdb_type = COALESCE(EXCLUDED.tmdb_type, movie_features.tmdb_type)",
                (t["titleKey"], tmdb.get("id"), tmdb.get("type")),
            )
        borrados = conn.execute(
            "UPDATE catalog_titles SET deleted = TRUE WHERE deleted = FALSE AND NOT (title_key = ANY(%s))",
            (claves,),
        ).rowcount
        conn.execute("DELETE FROM catalog_videos")
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO catalog_videos (video_key, title_key) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                list(catalogo["videos"].items()),
            )
    resumen = {"titulos": len(titulos), "videos": len(catalogo["videos"]), "retirados": borrados}
    log.info("catálogo guardado", extra=resumen)
    return resumen


def guardar_items(chat_id: str, items: list[dict[str, Any]], completa: bool) -> None:
    """Guarda los mensajes leídos. En una lectura completa, lo que no vino ya no está en el grupo."""
    with db.conexion() as conn, conn.transaction():
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO catalog_raw_items (item_key, chat_id, msg_id, item, seen_at) VALUES (%s, %s, %s, %s, NOW()) "
                "ON CONFLICT (item_key) DO UPDATE SET item = EXCLUDED.item, seen_at = NOW()",
                [(it["key"], chat_id, it["msgId"], db.j(it)) for it in items],
            )
        if completa:
            conn.execute(
                "DELETE FROM catalog_raw_items WHERE chat_id = %s AND NOT (item_key = ANY(%s))",
                (chat_id, [it["key"] for it in items]),
            )


def items_guardados() -> list[dict[str, Any]]:
    with db.conexion() as conn:
        return [r["item"] for r in conn.execute("SELECT item FROM catalog_raw_items ORDER BY chat_id, msg_id")]


def rearmar() -> dict[str, int]:
    resumen = guardar(armar(items_guardados()))
    db.estado_set("catalogo_version", {"at": datetime.now(timezone.utc).isoformat(), **resumen})
    return resumen
