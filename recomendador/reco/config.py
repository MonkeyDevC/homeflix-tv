"""Configuración por variables de entorno (ver .env.example). Nada de claves en el código."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent  # recomendador/
MODEL_NAME = "content-based"
MODEL_VERSION = "content-v1"


def _int(nombre: str, defecto: int) -> int:
    valor = os.environ.get(nombre, "").strip()
    return int(valor) if valor else defecto


def _lista_int(nombre: str) -> list[int]:
    return [int(x) for x in os.environ.get(nombre, "").replace(" ", "").split(",") if x]


@dataclass(frozen=True)
class Config:
    db_url: str = field(default_factory=lambda: os.environ.get("RECO_DB_URL", ""))
    reco_token: str = field(default_factory=lambda: os.environ.get("RECO_TOKEN", ""))

    # Servidor Node de HomeFlix (rutas /interno/v1/reco/*), por la red interna
    homeflix_interno_url: str = field(
        default_factory=lambda: os.environ.get("HOMEFLIX_INTERNO_URL", "http://homeflix:3000").rstrip("/")
    )

    # Telegram: la cuenta Premium (lee el catálogo y transcribe) y el bot
    tg_api_id: int = field(default_factory=lambda: _int("TG_API_ID", 0))
    tg_api_hash: str = field(default_factory=lambda: os.environ.get("TG_API_HASH", ""))
    bot_token: str = field(default_factory=lambda: os.environ.get("BOT_TOKEN", ""))
    bot_username: str = field(default_factory=lambda: os.environ.get("BOT_USERNAME", "night_monkey_bot").lstrip("@"))
    catalogo_chats: list[int] = field(default_factory=lambda: _lista_int("CATALOGO_CHATS"))
    buzon_chat: int = field(default_factory=lambda: _int("BUZON_CHAT", 0))
    sesiones_dir: str = field(default_factory=lambda: os.environ.get("RECO_SESIONES", str(RAIZ / "sesiones")))
    transcribir_espera: int = field(default_factory=lambda: _int("TRANSCRIBE_TIMEOUT", 180))

    # TMDB (solo en el servidor; nunca en la TV ni el celular)
    tmdb_api_key: str = field(default_factory=lambda: os.environ.get("TMDB_API_KEY", ""))
    tmdb_token: str = field(default_factory=lambda: os.environ.get("TMDB_TOKEN", ""))
    tmdb_idioma: str = field(default_factory=lambda: os.environ.get("TMDB_IDIOMA", "es-MX"))

    # Node para armar el catálogo con js/library.js
    node_bin: str = field(default_factory=lambda: os.environ.get("NODE_BIN", "node"))
    library_js: str = field(
        default_factory=lambda: os.environ.get("HF_LIBRARY_JS", str(RAIZ.parent / "js" / "library.js"))
    )

    # Retención (privacidad)
    dias_busquedas: int = field(default_factory=lambda: _int("RETENCION_BUSQUEDAS_DIAS", 90))
    dias_voz: int = field(default_factory=lambda: _int("RETENCION_VOZ_DIAS", 30))


@lru_cache(maxsize=1)
def config() -> Config:
    return Config()
