"""Cliente de las rutas internas del servidor Node de HomeFlix (/interno/v1/reco/*), por la red interna."""

from __future__ import annotations

from typing import Any

import httpx

from .config import config


def cuenta_por_tg(tg_id: int) -> dict[str, Any] | None:
    """{cuenta, perfiles:[{id, name, kids}], bloqueada} o None si esa persona no tiene cuenta de HomeFlix."""
    cfg = config()
    r = httpx.get(f"{cfg.homeflix_interno_url}/interno/v1/reco/cuenta-por-tg/{int(tg_id)}",
                  headers={"x-reco-token": cfg.reco_token}, timeout=10)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()
