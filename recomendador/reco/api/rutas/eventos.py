from __future__ import annotations

from fastapi import APIRouter, Depends

from ...eventos.normalizador import Evento, fecha_ms, registrar
from ...motor.servicio import motor
from ..auth import Quien, quien
from ..modelos import LoteEventos

router = APIRouter(prefix="/api/v1", tags=["eventos"])


@router.post("/events", status_code=202, summary="Eventos de la app: clic en una ficha y búsquedas (P0)")
def eventos(lote: LoteEventos, yo: Quien = Depends(quien)):
    """Las vistas y «Mi lista» NO llegan por aquí: el worker las lee de la sincronización (sin duplicados)."""
    lista = []
    for e in lote.eventos:
        clave = f"app:{yo.user_id}:{e.id}"
        if e.tipo == "click" and not e.title_key:
            continue
        lista.append(Evento(
            yo.cuenta, yo.perfil, e.tipo, clave, fecha_ms(e.at), e.title_key or None,
            consulta=e.consulta if e.tipo == "search" else None,
            valor=1.0 if (e.tipo == "search" and e.title_key) else None, origen="app", kids=yo.kids,
        ))
    nuevos = registrar(lista)
    if nuevos:
        motor().invalidar(yo.user_id)
    return {"recibidos": len(lote.eventos), "nuevos": nuevos}
