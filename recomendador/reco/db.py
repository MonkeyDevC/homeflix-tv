"""Conexión a Postgres (psycopg 3 + pool) y migraciones numeradas de migraciones/*.sql."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import RAIZ, config

log = logging.getLogger(__name__)
_pool: ConnectionPool | None = None


def _configurar_conexion(conn: Connection) -> None:
    conn.execute("SET search_path = recommendation, public")
    conn.commit()


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = config().db_url
        if not url:
            raise RuntimeError("Falta RECO_DB_URL")
        _pool = ConnectionPool(
            url, min_size=1, max_size=8, open=True, configure=_configurar_conexion,
            kwargs={"row_factory": dict_row, "connect_timeout": 5},
        )
    return _pool


def usar_pool(nuevo: ConnectionPool | None) -> None:
    """Para las pruebas: reemplaza (o cierra) el pool global."""
    global _pool
    if _pool is not None and _pool is not nuevo:
        _pool.close()
    _pool = nuevo


@contextmanager
def conexion() -> Iterator[Connection]:
    with pool().connection() as conn:
        yield conn


def j(valor: Any) -> Jsonb:
    return Jsonb(valor)


def migrar() -> list[str]:
    """Aplica en orden las migraciones que falten. Idempotente; se puede correr al arrancar cada proceso."""
    aplicadas: list[str] = []
    with conexion() as conn:
        conn.execute("SELECT pg_advisory_lock(7302001)")
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (nombre TEXT PRIMARY KEY, aplicada TIMESTAMPTZ DEFAULT NOW())"
            )
            hechas = {r["nombre"] for r in conn.execute("SELECT nombre FROM schema_migrations")}
            for archivo in sorted((RAIZ / "migraciones").glob("*.sql")):
                if archivo.name in hechas:
                    continue
                with conn.transaction():
                    conn.execute(archivo.read_text(encoding="utf-8"))
                    conn.execute("INSERT INTO schema_migrations (nombre) VALUES (%s)", (archivo.name,))
                aplicadas.append(archivo.name)
                log.info("migración aplicada", extra={"migracion": archivo.name})
            conn.commit()
        finally:
            conn.execute("SELECT pg_advisory_unlock(7302001)")
            conn.commit()
    return aplicadas


def estado_get(clave: str, defecto: Any = None) -> Any:
    with conexion() as conn:
        fila = conn.execute("SELECT value FROM worker_state WHERE key = %s", (clave,)).fetchone()
    return fila["value"] if fila else defecto


def estado_set(clave: str, valor: Any) -> None:
    with conexion() as conn:
        conn.execute(
            "INSERT INTO worker_state (key, value, updated_at) VALUES (%s, %s, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
            (clave, j(valor)),
        )
