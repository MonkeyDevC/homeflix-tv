"""@night_monkey_bot dentro de HomeFlix: búsqueda por voz con recomendaciones.

Viene de ~/Documents/night_monkey_bot/bot.py. La Bot API no puede transcribir: solo una CUENTA Premium
(messages.transcribeAudio). Por eso hay dos clientes: el bot (recibe y contesta) y la cuenta Premium (transcribe).

Para que funcione con cualquiera de la familia (no solo con el dueño): el bot reenvía el audio a un grupo privado
«buzón» donde están el bot y la cuenta Premium; la cuenta encuentra ahí el audio (por el id del documento, que es el
mismo en los dos lados) y lo transcribe. Sin buzón configurado, solo funciona con los audios del dueño.

Texto escrito también vale: «una de terror de los 90» funciona igual que dicho en voz alta."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from telethon import TelegramClient, events
from telethon.errors import RPCError
from telethon.tl.functions.messages import TranscribeAudioRequest
from telethon.tl.types import UpdateTranscribedAudio

from .. import db, interno
from ..config import config
from ..eventos.normalizador import Evento, registrar
from ..motor.servicio import motor

log = logging.getLogger(__name__)
MAX_RESULTADOS = 5
AYUDA = (
    "🐒 Soy el buscador de HomeFlix.\n\n"
    "Mándame una **nota de voz** o escríbeme lo que quieres ver, por ejemplo:\n"
    "• «una de terror de los 90»\n• «algo parecido a Interestelar»\n• «con Keanu Reeves»\n"
    "• «una serie de misterio»\n• «una para niños»\n\n"
    "Te recomiendo del catálogo de HomeFlix según lo que ves. /perfil cambia de perfil."
)


class Transcriptor:
    """La parte de la cuenta Premium (igual que transcribe()/find_in_user_chat() de night_monkey_bot)."""

    def __init__(self, usuario: TelegramClient, espera: int) -> None:
        self.usuario = usuario
        self.espera = espera
        self._esperando: dict[int, asyncio.Future] = {}
        self._temprano: dict[int, str] = {}
        usuario.add_event_handler(self._al_transcribir, events.Raw(UpdateTranscribedAudio))

    async def _al_transcribir(self, update: UpdateTranscribedAudio) -> None:
        if update.pending:
            return
        fut = self._esperando.pop(update.transcription_id, None)
        if fut and not fut.done():
            fut.set_result(update.text)
        else:
            self._temprano[update.transcription_id] = update.text

    async def transcribir(self, peer: Any, msg_id: int) -> str:
        res = await self.usuario(TranscribeAudioRequest(peer=peer, msg_id=msg_id))
        if not res.pending:
            return res.text
        tid = res.transcription_id
        if tid in self._temprano:
            return self._temprano.pop(tid)
        fut = asyncio.get_running_loop().create_future()
        self._esperando[tid] = fut
        try:
            return await asyncio.wait_for(fut, timeout=self.espera)
        except asyncio.TimeoutError:
            self._esperando.pop(tid, None)
            res = await self.usuario(TranscribeAudioRequest(peer=peer, msg_id=msg_id))
            if res.pending:
                raise TimeoutError("Telegram sigue procesando el audio, intenta de nuevo.")
            return res.text

    async def buscar_mensaje(self, peer: Any, documento_id: int, intentos: int = 6):
        for _ in range(intentos):
            async for m in self.usuario.iter_messages(peer, limit=30):
                if m.document and m.document.id == documento_id:
                    return m
            await asyncio.sleep(1)
        return None


def _perfil_elegido(tg_id: int, cuenta: dict[str, Any]) -> dict[str, Any]:
    perfiles = cuenta.get("perfiles") or [{"id": "p1", "name": "Principal", "kids": False}]
    elegido = db.estado_get(f"bot_perfil:{tg_id}")
    for p in perfiles:
        if p.get("id") == elegido:
            return p
    return next((p for p in perfiles if not p.get("kids")), perfiles[0])


def formatear(resultado: dict[str, Any], transcripcion: str | None) -> str:
    m = motor()
    lineas = [f"🗣️ «{transcripcion}»\n"] if transcripcion else []
    recs = resultado.get("recommendations", [])[:MAX_RESULTADOS]
    if not recs:
        lineas.append("No encontré nada así en HomeFlix 😕. Prueba con otro género, año o actor.")
        return "\n".join(lineas)
    lineas.append("🎬 **Te recomiendo:**")
    for n, r in enumerate(recs, 1):
        t = m.titulo(r["movie_id"]) or {"name": r["movie_id"], "year": None, "type": "movie"}
        anio = f" ({t['year']})" if t.get("year") else ""
        tipo = " · serie" if t.get("type") == "series" else ""
        razon = r["reasons"][0]["label"] if r.get("reasons") else ""
        lineas.append(f"{n}. **{t['name']}**{anio}{tipo}\n    _{razon}_")
    lineas.append("\nBúscala en HomeFlix 📺")
    return "\n".join(lineas)


def guardar_consulta(tg_id: int, user_id: str | None, cuenta: str | None, perfil: dict[str, Any] | None,
                     texto: str, resultado: dict[str, Any], fuente: str) -> None:
    with db.conexion() as conn:
        conn.execute(
            "INSERT INTO voice_queries (tg_user_id, user_id, transcript, interpretation, results) "
            "VALUES (%s, %s, %s, %s, %s)",
            (tg_id, user_id, texto, db.j(resultado.get("interpretacion") or {}),
             db.j([r["movie_id"] for r in resultado.get("recommendations", [])])),
        )
    if cuenta and perfil:
        ahora = datetime.now(timezone.utc)
        registrar([Evento(cuenta, perfil["id"], "search", f"bot:{tg_id}:{int(ahora.timestamp() * 1000)}", ahora,
                          consulta=texto, origen=fuente, kids=bool(perfil.get("kids")))])


class BotVoz:
    def __init__(self, usuario: TelegramClient, bot: TelegramClient) -> None:
        cfg = config()
        self.cfg = cfg
        self.usuario = usuario
        self.bot = bot
        self.transcriptor = Transcriptor(usuario, cfg.transcribir_espera)
        self.dueno_id: int | None = None
        self.peer_bot = None
        self.peer_buzon_usuario = None
        bot.add_event_handler(self._mensaje, events.NewMessage(incoming=True, func=lambda e: e.is_private))

    async def preparar(self) -> None:
        yo = await self.usuario.get_me()
        if yo.bot:
            raise RuntimeError("La sesión de usuario es de un bot: inicia sesión con tu NÚMERO, no con el token")
        self.dueno_id = yo.id
        if not getattr(yo, "premium", False):
            log.warning("la cuenta del worker no es Premium: solo tendrá las pruebas gratis de transcripción")
        bot_yo = await self.bot.get_me()
        self.peer_bot = await self.usuario.get_input_entity(bot_yo.username)
        if self.cfg.buzon_chat:
            self.peer_buzon_usuario = await self.usuario.get_input_entity(self.cfg.buzon_chat)
        log.info("bot de voz listo", extra={"bot": bot_yo.username, "buzon": bool(self.cfg.buzon_chat)})

    async def _texto_de_audio(self, event) -> str:
        msg = event.message
        if self.peer_buzon_usuario is not None:
            reenviado = await self.bot.forward_messages(self.cfg.buzon_chat, msg)
            peer = self.peer_buzon_usuario
            documento = reenviado.document.id
        elif event.sender_id == self.dueno_id:
            peer, documento = self.peer_bot, msg.document.id
        else:
            raise PermissionError("El buzón no está configurado: por ahora solo entiendo los audios del dueño.")
        propio = await self.transcriptor.buscar_mensaje(peer, documento)
        if propio is None:
            raise LookupError("No encontré el audio para transcribirlo. Mándalo otra vez.")
        return (await self.transcriptor.transcribir(peer, propio.id)).strip()

    async def _mensaje(self, event) -> None:
        msg = event.message
        texto = (msg.raw_text or "").strip()
        tg_id = event.sender_id
        if texto.startswith(("/start", "/help", "/ayuda")):
            await event.reply(AYUDA)
            return
        try:
            cuenta = await asyncio.to_thread(interno.cuenta_por_tg, tg_id)
        except Exception:
            log.exception("no pude consultar la cuenta")
            await event.reply("⚠️ HomeFlix no responde ahora mismo. Intenta en un rato.")
            return
        if not cuenta or cuenta.get("bloqueada"):
            await event.reply("🔒 Primero entra a HomeFlix (TV o celular) con este mismo Telegram y vuelve a escribirme.")
            return
        if texto.startswith("/perfil"):
            await self._cambiar_perfil(event, tg_id, cuenta, texto)
            return

        transcripcion = None
        if msg.voice or msg.video_note:
            estado = await event.reply("🎧 Escuchando…")
            try:
                transcripcion = await self._texto_de_audio(event)
            except RPCError as e:
                await estado.edit(f"❌ Telegram no pudo transcribir ({e.message}).")
                return
            except (PermissionError, LookupError, TimeoutError) as e:
                await estado.edit(f"❌ {e}")
                return
            if not transcripcion:
                await estado.edit("🤷 No se entendió el audio. ¿Me lo repites?")
                return
            consulta = transcripcion
        elif texto and not texto.startswith("/"):
            estado = await event.reply("🔎 Buscando…")
            consulta = texto
        else:
            await event.reply("Mándame una nota de voz 🎙️ o escríbeme qué quieres ver.")
            return

        perfil = _perfil_elegido(tg_id, cuenta)
        user_id = f"{cuenta['cuenta']}:{perfil['id']}"
        resultado = await asyncio.to_thread(motor().buscar, user_id, consulta, bool(perfil.get("kids")), 10)
        await estado.edit(formatear(resultado, transcripcion))
        await asyncio.to_thread(guardar_consulta, tg_id, user_id, cuenta["cuenta"], perfil, consulta, resultado,
                                "voz" if transcripcion else "bot")

    async def _cambiar_perfil(self, event, tg_id: int, cuenta: dict[str, Any], texto: str) -> None:
        perfiles = cuenta.get("perfiles") or []
        pedido = texto.split(maxsplit=1)[1].strip().lower() if " " in texto else ""
        for p in perfiles:
            if pedido and pedido in (str(p.get("name", "")).lower(), str(p.get("id", "")).lower()):
                db.estado_set(f"bot_perfil:{tg_id}", p["id"])
                await event.reply(f"✅ Ahora te recomiendo para **{p.get('name') or p['id']}**.")
                return
        nombres = ", ".join(str(p.get("name") or p.get("id")) for p in perfiles) or "—"
        actual = _perfil_elegido(tg_id, cuenta)
        await event.reply(f"Perfil actual: **{actual.get('name') or actual['id']}**.\n"
                          f"Escribe /perfil y el nombre. Tus perfiles: {nombres}")
