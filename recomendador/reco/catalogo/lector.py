"""Lee el grupo del catálogo (NETSUCKS) con la sesión de Telegram del worker, igual que js/telegram.js scanOne():
videos, documentos de video y fotos con comentario. Incremental (solo lo nuevo) y completa cada 6 h
(la única que ve comentarios editados o mensajes borrados)."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from telethon import TelegramClient, utils
from telethon.tl.types import (
    DocumentAttributeAnimated,
    DocumentAttributeVideo,
    InputMessagesFilterDocument,
    InputMessagesFilterPhotos,
    InputMessagesFilterVideo,
    Message,
)

from .. import db
from . import armar

log = logging.getLogger(__name__)
VIDEO_EXT = re.compile(r"\.(mkv|webm|mp4|m4v|mov)$", re.I)
VIDEO_MIME = re.compile(r"^video/(x-matroska|webm|mp4|quicktime|x-m4v)$", re.I)
CADA_COMPLETA = timedelta(hours=6)
MAX_POR_FILTRO = 3000


def _ms(fecha: datetime | None) -> int:
    return int(fecha.timestamp() * 1000) if fecha else 0


def _es_video(m: Message) -> bool:
    doc = m.document
    if not doc or not m.video:
        return False
    for a in doc.attributes:
        if isinstance(a, DocumentAttributeVideo) and a.round_message:
            return False
        if isinstance(a, DocumentAttributeAnimated):
            return False
    return True


def _es_doc_video(m: Message) -> bool:
    if not m.document or m.video:
        return False
    return bool(VIDEO_EXT.search(m.file.name or "") or VIDEO_MIME.match(m.file.mime_type or ""))


def _es_foto_ficha(m: Message) -> bool:
    return bool(m.photo) and "#" in (m.message or "")


def describir(m: Message, tipo: str) -> dict[str, Any]:
    """Mismo formato que describe() de js/telegram.js."""
    chat_id = str(utils.get_peer_id(m.peer_id))
    f = m.file
    return {
        "edit": _ms(m.edit_date),
        "key": f"{chat_id}:{m.id}",
        "chatId": chat_id,
        "chatTitle": "",
        "msgId": m.id,
        "kind": tipo,
        "caption": m.message or "",
        "fileName": (f.name if f else "") or "",
        "duration": int((f.duration if f else 0) or 0),
        "size": int((f.size if f else 0) or 0),
        "width": int((f.width if f else 0) or 0),
        "height": int((f.height if f else 0) or 0),
        "date": _ms(m.date),
    }


async def leer_chat(cliente: TelegramClient, chat: int, desde: int = 0) -> list[dict[str, Any]]:
    """desde = msg id más nuevo ya guardado (0 = todo)."""
    filtros = [
        (InputMessagesFilterVideo(), _es_video, "video"),
        (InputMessagesFilterDocument(), _es_doc_video, "video"),
        (InputMessagesFilterPhotos(), _es_foto_ficha, "photo"),
    ]
    vistos: dict[str, dict[str, Any]] = {}
    for filtro, sirve, tipo in filtros:
        async for m in cliente.iter_messages(chat, filter=filtro, min_id=desde, limit=MAX_POR_FILTRO):
            if sirve(m):
                it = describir(m, tipo)
                vistos[it["key"]] = it
    return list(vistos.values())


async def sincronizar(cliente: TelegramClient, chats: list[int], forzar_completa: bool = False) -> dict[str, Any]:
    """Lee cada chat del catálogo y rearma el índice si hubo algo nuevo."""
    ahora = datetime.now(timezone.utc)
    hubo_cambios = False
    for chat in chats:
        clave = f"lector:{chat}"
        estado = db.estado_get(clave, {}) or {}
        ultima_completa = datetime.fromisoformat(estado["completa"]) if estado.get("completa") else None
        completa = forzar_completa or not ultima_completa or ahora - ultima_completa > CADA_COMPLETA
        items = await leer_chat(cliente, chat, 0 if completa else int(estado.get("max", 0)))
        if items or completa:
            chat_id = str(utils.get_peer_id(await cliente.get_input_entity(chat)))
            armar.guardar_items(chat_id, items, completa)
            hubo_cambios = True
        maximo = max([estado.get("max", 0)] + [it["msgId"] for it in items])
        db.estado_set(clave, {
            "max": maximo,
            "completa": ahora.isoformat() if completa else estado.get("completa"),
            "leidos": len(items),
        })
        log.info("chat leído", extra={"chat": chat, "completa": completa, "nuevos": len(items)})
    resumen = armar.rearmar() if hubo_cambios else {}
    return {"cambios": hubo_cambios, **resumen}
