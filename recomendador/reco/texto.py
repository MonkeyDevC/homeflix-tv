"""Normalización de texto igual que norm() de js/library.js: sin tildes, minúsculas, solo letras y números."""

from __future__ import annotations

import re
import unicodedata

_NO_ALFANUM = re.compile(r"[^a-z0-9]+")


def norm(texto: str | None) -> str:
    t = " ".join(str(texto or "").replace("\r", "").split()).lower()
    t = "".join(c for c in unicodedata.normalize("NFD", t) if not unicodedata.combining(c))
    return _NO_ALFANUM.sub(" ", t).strip()


def ficha(texto: str | None) -> str:
    """Token para listas (género, actor, keyword): «Ciencia ficción» → «ciencia_ficcion»."""
    return norm(texto).replace(" ", "_")
