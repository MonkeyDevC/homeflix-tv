"""Historial desde la sincronización de HomeFlix (el `doc` que guarda servidor/ por cuenta, ver exportSync() en
js/library.js): progreso → vistas, Mi lista → watchlist. Las apps NO reenvían estas cosas como eventos, así que no
hay duplicados; y la clave de idempotencia hace que correrlo dos veces no cambie nada."""

from __future__ import annotations

import logging
from typing import Any, Iterator

import httpx

from .. import db
from ..config import config
from .normalizador import Evento, PERFIL_RE, fecha_ms, registrar

log = logging.getLogger(__name__)
VISTA_PARCIAL_SEG = 600  # 10 minutos sin terminar = interés, no consumo completo


def eventos_de_doc(cuenta: str, doc: dict[str, Any], perfiles: list[dict[str, Any]],
                   videos: dict[str, str]) -> Iterator[Evento]:
    kids = {str(p.get("id")): bool(p.get("kids")) for p in perfiles or []}
    for perfil, datos in (doc.get("p") or {}).items():
        if not PERFIL_RE.match(str(perfil)) or not isinstance(datos, dict):
            continue
        es_kids = kids.get(perfil, False)
        for video_key, prog in (datos.get("progress") or {}).items():
            titulo = videos.get(video_key)
            if not titulo or not isinstance(prog, dict):
                continue  # anime, IPTV o algo que ya no está en el grupo
            base = f"sync:{cuenta}:{perfil}:{video_key}"
            if prog.get("done"):
                yield Evento(cuenta, perfil, "view", f"{base}:view_done", fecha_ms(prog.get("at")), titulo,
                             valor=2.0, origen="sync", kids=es_kids, meta={"video": video_key, "completo": True})
            elif float(prog.get("t") or 0) >= VISTA_PARCIAL_SEG:
                yield Evento(cuenta, perfil, "view", f"{base}:view_partial", fecha_ms(prog.get("at")), titulo,
                             valor=1.0, origen="sync", kids=es_kids, meta={"video": video_key, "completo": False})
        for title_key, marca in (datos.get("mylist") or {}).items():
            if not isinstance(marca, dict) or not str(title_key)[:2] in ("m:", "s:"):
                continue
            tipo = "watchlist" if marca.get("on") else "watchlist_remove"
            yield Evento(cuenta, perfil, tipo, f"sync:{cuenta}:{perfil}:{title_key}:{tipo}:{marca.get('at', 0)}",
                         fecha_ms(marca.get("at")), title_key, origen="sync", kids=es_kids)


def mapa_videos() -> dict[str, str]:
    with db.conexion() as conn:
        return {r["video_key"]: r["title_key"] for r in conn.execute("SELECT video_key, title_key FROM catalog_videos")}


def paginas_docs(desde: int, http: httpx.Client | None = None) -> Iterator[dict[str, Any]]:
    """GET /interno/v1/reco/docs del servidor Node (red interna, x-reco-token), página por página."""
    cfg = config()
    cliente = http or httpx.Client(timeout=30)
    try:
        while True:
            r = cliente.get(
                f"{cfg.homeflix_interno_url}/interno/v1/reco/docs",
                params={"desde": desde, "limite": 200}, headers={"x-reco-token": cfg.reco_token},
            )
            r.raise_for_status()
            pagina = r.json()
            yield pagina
            if not pagina.get("siguiente") or not pagina.get("cuentas"):
                return
            desde = int(pagina["siguiente"])
    finally:
        if http is None:
            cliente.close()


def importar(http: httpx.Client | None = None, completo: bool = False) -> dict[str, int]:
    """Trae los docs que cambiaron desde la última vez y los convierte en eventos. `completo` (cada noche) vuelve a
    leer todo: sirve para los videos que entraron al catálogo después de que se vieron. Es idempotente."""
    desde = 0 if completo else int(db.estado_get("sync_desde", 0) or 0)
    videos = mapa_videos()
    if not videos:
        log.info("sin catálogo todavía: la importación del historial espera")
        return {"cuentas": 0, "nuevos": 0}
    cuentas = nuevos = 0
    for pagina in paginas_docs(desde, http):
        for c in pagina.get("cuentas", []):
            doc = c.get("doc") or {}
            perfiles = c.get("perfiles") or (doc.get("profiles") or {}).get("list") or []
            nuevos += registrar(eventos_de_doc(c["cuenta"], doc, perfiles, videos))
            cuentas += 1
            desde = max(desde, int(c.get("vista") or 0))
        db.estado_set("sync_desde", desde)
    log.info("historial importado", extra={"cuentas": cuentas, "nuevos": nuevos})
    return {"cuentas": cuentas, "nuevos": nuevos}
