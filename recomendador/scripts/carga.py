"""Prueba de carga: N peticiones por segundo durante S segundos contra «Para ti».
    python scripts/carga.py --url http://127.0.0.1:8000 --rps 50 --segundos 60 --usuarios 200
Meta: p95 < 200 ms. Necesita RECO_TOKEN en el entorno."""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import statistics
import time

import httpx


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://127.0.0.1:8000")
    p.add_argument("--rps", type=int, default=50)
    p.add_argument("--segundos", type=int, default=60)
    p.add_argument("--usuarios", type=int, default=200)
    a = p.parse_args()
    token = os.environ["RECO_TOKEN"]
    tiempos: list[float] = []
    errores = 0

    async with httpx.AsyncClient(base_url=a.url, timeout=10) as c:
        async def una() -> None:
            nonlocal errores
            cuenta = f"{random.randrange(a.usuarios):064x}"
            inicio = time.perf_counter()
            try:
                r = await c.get("/api/v1/recommendations/me", params={"limite": 20},
                                headers={"x-reco-token": token, "x-reco-cuenta": cuenta, "x-reco-perfil": "p1"})
                if r.status_code != 200:
                    errores += 1
            except httpx.HTTPError:
                errores += 1
            tiempos.append((time.perf_counter() - inicio) * 1000)

        tareas = []
        fin = time.perf_counter() + a.segundos
        while time.perf_counter() < fin:
            tareas += [asyncio.create_task(una()) for _ in range(a.rps)]
            await asyncio.sleep(1)
        await asyncio.gather(*tareas)

    tiempos.sort()
    p95 = tiempos[int(len(tiempos) * 0.95) - 1]
    print(f"peticiones={len(tiempos)} errores={errores} p50={statistics.median(tiempos):.1f}ms "
          f"p95={p95:.1f}ms p99={tiempos[int(len(tiempos) * 0.99) - 1]:.1f}ms → {'OK' if p95 < 200 else 'LENTO'}")


if __name__ == "__main__":
    asyncio.run(main())
