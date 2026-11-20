"""Worker del motor: un solo proceso con la sesión de Telegram (una sesión en dos lugares = AUTH_KEY_DUPLICATED).

  python -m reco.worker            arranca todo (catálogo, TMDB, historial, perfiles, bot de voz y tareas programadas)
  python -m reco.worker --login    primera vez: inicia sesión con la cuenta Premium (teléfono + código) y sale
  python -m reco.worker --una-vez  corre cada tarea una vez y sale (útil para probar)
  python -m reco.worker --salud    healthcheck de Docker: ¿el worker latió hace menos de 5 minutos?
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from telethon import TelegramClient

from . import db, registro
from .catalogo import lector
from .config import MODEL_NAME, MODEL_VERSION, config
from .eventos import desde_sync
from .eventos.normalizador import purgar
from .motor import perfiles
from .motor.rasgos import vecinos
from .motor.servicio import motor
from .tmdb import sincronizar as tmdb

log = logging.getLogger("reco.worker")


def clientes() -> tuple[TelegramClient, TelegramClient | None]:
    cfg = config()
    Path(cfg.sesiones_dir).mkdir(parents=True, exist_ok=True)
    usuario = TelegramClient(str(Path(cfg.sesiones_dir) / "user_session"), cfg.tg_api_id, cfg.tg_api_hash)
    bot = (TelegramClient(str(Path(cfg.sesiones_dir) / "bot_session"), cfg.tg_api_id, cfg.tg_api_hash)
           if cfg.bot_token else None)
    return usuario, bot


# ----- tareas -----
def recalcular_rasgos() -> dict[str, int]:
    """Reconstruye rasgos y guarda los 50 vecinos de cada título (movie_similar)."""
    m = motor()
    m.cargar()
    r = m.rasgos
    filas = [(t.title_key, r.titulos[j].title_key, s) for i, t in enumerate(r.titulos) for j, s in vecinos(r, i, 50)]
    with db.conexion() as conn, conn.transaction():
        conn.execute("DELETE FROM movie_similar")
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO movie_similar (title_key, similar_key, score) VALUES (%s, %s, %s)", filas)
    db.estado_set("rasgos_version", {"at": datetime.now(timezone.utc).isoformat(), "titulos": len(r)})
    return {"titulos": len(r), "pares": len(filas)}


def recalcular_perfiles() -> int:
    m = motor()
    r = m.asegurar()
    with db.conexion() as conn:
        usuarios = [f["user_id"] for f in conn.execute(
            "SELECT DISTINCT user_id FROM user_events WHERE occurred_at > NOW() - INTERVAL '365 days'")]
    for u in usuarios:
        fila = perfiles.a_fila(m.perfil(u), r)
        with db.conexion() as conn:
            conn.execute(
                """
                INSERT INTO user_profiles (user_id, preferred_genres, preferred_actors, preferred_directors,
                    disliked_movies, title_weights, profile_vector, interaction_count, last_event_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_id) DO UPDATE SET preferred_genres = EXCLUDED.preferred_genres,
                    preferred_actors = EXCLUDED.preferred_actors, preferred_directors = EXCLUDED.preferred_directors,
                    disliked_movies = EXCLUDED.disliked_movies, title_weights = EXCLUDED.title_weights,
                    profile_vector = EXCLUDED.profile_vector, interaction_count = EXCLUDED.interaction_count,
                    last_event_at = EXCLUDED.last_event_at, updated_at = NOW()
                """,
                (u, db.j(fila["preferred_genres"]), db.j(fila["preferred_actors"]), db.j(fila["preferred_directors"]),
                 db.j(fila["disliked_movies"]), db.j(fila["title_weights"]), db.j(fila["profile_vector"]),
                 fila["interaction_count"], fila["last_event_at"]),
            )
    log.info("perfiles recalculados", extra={"usuarios": len(usuarios)})
    return len(usuarios)


def evaluar() -> dict:
    from .evaluacion.metricas import evaluar_offline
    metricas = evaluar_offline()
    with db.conexion() as conn:
        conn.execute("UPDATE model_versions SET is_active = FALSE WHERE model_name = %s", (MODEL_NAME,))
        conn.execute(
            "INSERT INTO model_versions (model_name, version, parameters, metrics, is_active) VALUES (%s, %s, %s, %s, TRUE)",
            (MODEL_NAME, MODEL_VERSION, db.j(_parametros()), db.j(metricas)),
        )
    log.info("evaluación offline", extra=metricas)
    return metricas


def _parametros() -> dict:
    from .motor import perfiles as p, ranker, rasgos
    return {"pesos_campo": rasgos.PESOS_CAMPO, "pesos_ranker": ranker.PESOS, "lambda_mmr": ranker.LAMBDA_MMR,
            "vida_media_dias": p.VIDA_MEDIA_DIAS}


async def tarea_catalogo(usuario: TelegramClient, completa: bool = False) -> None:
    cfg = config()
    if not cfg.catalogo_chats:
        log.warning("CATALOGO_CHATS vacío: no hay grupo que leer")
        return
    resumen = await lector.sincronizar(usuario, cfg.catalogo_chats, forzar_completa=completa)
    if resumen.get("cambios"):
        await asyncio.to_thread(tmdb.sincronizar, 200)
        await asyncio.to_thread(recalcular_rasgos)


async def tarea_tmdb() -> None:
    cuenta = await asyncio.to_thread(tmdb.sincronizar, 60)
    if cuenta.get("ok"):
        await asyncio.to_thread(recalcular_rasgos)


async def tarea_historial(completo: bool = False) -> None:
    await asyncio.to_thread(desde_sync.importar, None, completo)


async def latido() -> None:
    await asyncio.to_thread(db.estado_set, "worker_latido", datetime.now(timezone.utc).isoformat())


def _seguro(nombre: str, fn):
    async def envoltura(*a, **k):
        try:
            await fn(*a, **k)
        except Exception:
            log.exception("tarea falló", extra={"tarea": nombre})
    return envoltura


async def _conectar_telegram() -> tuple[TelegramClient | None, TelegramClient | None]:
    """La cuenta Premium y el bot. Sin claves o sin sesión, el worker sigue (historial, TMDB, perfiles) y avisa."""
    cfg = config()
    if not (cfg.tg_api_id and cfg.tg_api_hash):
        log.warning("sin TG_API_ID/TG_API_HASH: no se lee el catálogo ni corre el bot")
        return None, None
    usuario, bot = clientes()
    await usuario.connect()
    if not await usuario.is_user_authorized():
        log.error("la sesión de Telegram no está iniciada: corre «python -m reco.worker --login» una vez")
        await usuario.disconnect()
        return None, None
    yo = await usuario.get_me()
    if yo.bot:
        log.error("la sesión de usuario es de un bot: bórrala y repite --login con tu NÚMERO, no con el token")
        await usuario.disconnect()
        return None, None
    return usuario, bot


async def principal(una_vez: bool = False) -> None:
    cfg = config()
    db.migrar()
    usuario, bot = await _conectar_telegram()

    if usuario is not None:
        await _seguro("catalogo", tarea_catalogo)(usuario)
    await _seguro("historial", tarea_historial)()
    await _seguro("tmdb", tarea_tmdb)()
    try:
        await asyncio.to_thread(recalcular_rasgos)
    except Exception:
        log.exception("no se pudieron calcular los rasgos (¿catálogo vacío?)")
    if una_vez:
        await _seguro("perfiles", lambda: asyncio.to_thread(recalcular_perfiles))()
        await _seguro("evaluacion", lambda: asyncio.to_thread(evaluar))()
        if usuario is not None:
            await usuario.disconnect()
        return

    if usuario is not None and bot is not None:
        from .voz.bot import BotVoz
        await bot.start(bot_token=cfg.bot_token)
        voz = BotVoz(usuario, bot)
        await voz.preparar()
    else:
        bot = None

    s = AsyncIOScheduler(timezone="America/Mexico_City")
    if usuario is not None:
        s.add_job(_seguro("catalogo", tarea_catalogo), "interval", minutes=15, args=[usuario],
                  max_instances=1, coalesce=True)
        s.add_job(_seguro("catalogo_completo", tarea_catalogo), "cron", hour=3, args=[usuario, True])
    s.add_job(_seguro("tmdb", tarea_tmdb), "interval", minutes=30, max_instances=1, coalesce=True)
    s.add_job(_seguro("historial", tarea_historial), "interval", minutes=60, max_instances=1, coalesce=True)
    s.add_job(_seguro("historial_completo", tarea_historial), "cron", hour=3, minute=30, args=[True])
    s.add_job(_seguro("perfiles", lambda: asyncio.to_thread(recalcular_perfiles)), "cron", hour=4)
    s.add_job(_seguro("purga", lambda: asyncio.to_thread(purgar, cfg.dias_busquedas, cfg.dias_voz)), "cron", hour=5)
    s.add_job(_seguro("evaluacion", lambda: asyncio.to_thread(evaluar)), "cron", day_of_week="sun", hour=5, minute=30)
    s.add_job(latido, "interval", minutes=1, next_run_time=datetime.now(timezone.utc))
    s.start()
    log.info("worker en marcha", extra={"telegram": usuario is not None, "bot": bot is not None,
                                        "chats": cfg.catalogo_chats})
    esperas = [c.run_until_disconnected() for c in (usuario, bot) if c is not None]
    if esperas:
        await asyncio.gather(*esperas)
    else:
        await asyncio.Event().wait()


async def login() -> None:
    usuario, _ = clientes()
    await usuario.start(phone=lambda: input("Número de la cuenta Premium con lada (ej. +57…): "))
    yo = await usuario.get_me()
    if yo.bot:
        await usuario.log_out()
        raise SystemExit("❌ Eso era el token de un bot. Repite y escribe tu NÚMERO de teléfono.")
    print(f"✅ Sesión iniciada como {yo.first_name} (Premium: {bool(getattr(yo, 'premium', False))})")
    await usuario.disconnect()


def salud() -> int:
    try:
        valor = db.estado_get("worker_latido")
        ok = bool(valor) and datetime.now(timezone.utc) - datetime.fromisoformat(valor) < timedelta(minutes=5)
    except Exception:
        ok = False
    return 0 if ok else 1


def main() -> None:
    registro.configurar()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--login", action="store_true")
    p.add_argument("--una-vez", action="store_true")
    p.add_argument("--salud", action="store_true")
    a = p.parse_args()
    if a.salud:
        sys.exit(salud())
    if a.login:
        asyncio.run(login())
        return
    asyncio.run(principal(una_vez=a.una_vez))


if __name__ == "__main__":
    main()
