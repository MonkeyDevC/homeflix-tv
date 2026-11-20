"""Unifica los eventos de cualquier origen en recommendation.user_events, sin duplicados (idempotency_key)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

from .. import db

TIPOS = ("favorite", "view", "search", "watchlist", "watchlist_remove", "click")
PESOS = {"favorite": 5.0, "watchlist": 3.0, "view": 2.0, "click": 0.5, "watchlist_remove": -1.0, "search": 1.0}
CUENTA_RE = re.compile(r"^[0-9a-f]{64}$")
PERFIL_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_CONSULTA = 200


@dataclass
class Evento:
    cuenta: str
    perfil: str
    tipo: str
    idempotency_key: str
    ocurrido: datetime
    movie_id: str | None = None
    valor: float | None = None
    consulta: str | None = None
    origen: str = "app"
    kids: bool = False
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def user_id(self) -> str:
        return f"{self.cuenta}:{self.perfil}"

    def validar(self) -> None:
        if self.tipo not in TIPOS:
            raise ValueError(f"tipo de evento desconocido: {self.tipo}")
        if not PERFIL_RE.match(self.perfil):
            raise ValueError("perfil inválido")
        if not self.cuenta or not (CUENTA_RE.match(self.cuenta) or self.cuenta.startswith("tg:")):
            raise ValueError("cuenta inválida")
        if self.consulta is not None:
            self.consulta = " ".join(self.consulta.split())[:MAX_CONSULTA]


def usuario(cuenta: str, perfil: str) -> str:
    return f"{cuenta}:{perfil}"


def fecha_ms(ms: Any) -> datetime:
    try:
        valor = float(ms)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)
    if valor <= 0:
        return datetime.now(timezone.utc)
    return datetime.fromtimestamp(valor / 1000, tz=timezone.utc)


def registrar(eventos: Iterable[Evento]) -> int:
    """Guarda los eventos. Un evento repetido (misma clave) solo refresca su fecha si es más nueva.
    Devuelve cuántos eran nuevos."""
    lista = list(eventos)
    for e in lista:
        e.validar()
    if not lista:
        return 0
    nuevos = 0
    with db.conexion() as conn, conn.transaction():
        for e in lista:
            fila = conn.execute(
                """
                INSERT INTO user_events (user_id, account_id, profile_id, profile_kids, movie_id, event_type,
                    event_value, search_query, source, metadata, idempotency_key, occurred_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (idempotency_key) DO UPDATE SET
                    occurred_at = GREATEST(user_events.occurred_at, EXCLUDED.occurred_at)
                RETURNING (xmax = 0) AS nuevo
                """,
                (
                    e.user_id, e.cuenta, e.perfil, e.kids, e.movie_id, e.tipo,
                    e.valor if e.valor is not None else PESOS[e.tipo], e.consulta, e.origen, db.j(e.meta),
                    e.idempotency_key, e.ocurrido,
                ),
            ).fetchone()
            nuevos += 1 if fila and fila["nuevo"] else 0
    return nuevos


def eventos_de(user_id: str, dias: int = 365, limite: int = 3000) -> list[dict[str, Any]]:
    with db.conexion() as conn:
        return list(conn.execute(
            "SELECT movie_id, event_type, event_value, search_query, occurred_at FROM user_events "
            "WHERE user_id = %s AND occurred_at > NOW() - make_interval(days => %s) "
            "ORDER BY occurred_at DESC LIMIT %s",
            (user_id, dias, limite),
        ))


def purgar(dias_busquedas: int, dias_voz: int) -> dict[str, int]:
    """Privacidad: las búsquedas y las consultas de voz no se guardan para siempre."""
    with db.conexion() as conn:
        b = conn.execute(
            "UPDATE user_events SET search_query = NULL WHERE search_query IS NOT NULL "
            "AND occurred_at < NOW() - make_interval(days => %s)", (dias_busquedas,),
        ).rowcount
        v = conn.execute(
            "DELETE FROM voice_queries WHERE created_at < NOW() - make_interval(days => %s)", (dias_voz,)
        ).rowcount
        r = conn.execute("DELETE FROM recommendation_results WHERE created_at < NOW() - INTERVAL '2 days'").rowcount
    return {"busquedas": b, "voz": v, "resultados": r}
