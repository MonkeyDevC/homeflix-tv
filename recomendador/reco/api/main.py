"""API del motor de recomendaciones (FastAPI). Solo la llama el servidor Node por la red interna."""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .. import db, registro
from ..config import MODEL_VERSION
from ..motor.servicio import motor
from .rutas import busqueda, eventos, recomendaciones

log = logging.getLogger("reco.api")


@asynccontextmanager
async def vida(app: FastAPI):
    registro.configurar()
    try:
        db.migrar()
        motor().cargar()
    except Exception:  # la API arranca igual y /readyz dice que no está lista
        log.exception("arranque incompleto")
    yield
    db.usar_pool(None)


app = FastAPI(
    title="HomeFlix — motor de recomendaciones",
    version=MODEL_VERSION,
    description="Content-based (TF-IDF + coseno) con ranking híbrido. El `score` ordena; no es una probabilidad.",
    lifespan=vida,
)
app.include_router(recomendaciones.router)
app.include_router(eventos.router)
app.include_router(busqueda.router)


@app.middleware("http")
async def registrar_peticion(request: Request, call_next):
    inicio = time.perf_counter()
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    try:
        respuesta = await call_next(request)
    except Exception:
        log.exception("error no controlado", extra={"ruta": request.url.path, "rid": rid})
        return JSONResponse({"detail": "error interno"}, status_code=500)
    ms = round((time.perf_counter() - inicio) * 1000, 1)
    if request.url.path not in ("/healthz", "/readyz"):
        log.info("petición", extra={"ruta": request.url.path, "estado": respuesta.status_code, "ms": ms, "rid": rid})
    respuesta.headers["x-request-id"] = rid
    return respuesta


@app.get("/healthz", tags=["salud"])
def healthz():
    """Vivo (el proceso responde)."""
    return {"ok": True}


@app.get("/readyz", tags=["salud"])
def readyz():
    """Listo: base de datos y catálogo cargado."""
    estado = {"db": False, "titulos": 0}
    try:
        with db.conexion() as conn:
            conn.execute("SELECT 1")
        estado["db"] = True
        estado["titulos"] = len(motor().asegurar())
    except Exception as e:  # noqa: BLE001
        estado["error"] = type(e).__name__
    listo = estado["db"] and estado["titulos"] > 0
    return JSONResponse(estado, status_code=200 if listo else 503)
