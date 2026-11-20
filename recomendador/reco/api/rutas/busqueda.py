from __future__ import annotations

from fastapi import APIRouter, Depends

from ...motor.servicio import motor
from ..auth import Quien, quien
from ..modelos import Busqueda, Respuesta

router = APIRouter(prefix="/api/v1", tags=["búsqueda"])


@router.post("/search/semantic", response_model=Respuesta, summary="Búsqueda en lenguaje natural (P2)")
def buscar(cuerpo: Busqueda, yo: Quien = Depends(quien)):
    """MVP: reglas + TF-IDF («una de terror de los 90», «como Interestelar», «con Keanu Reeves»).
    La épica 07 la cambia por embeddings en pgvector sin cambiar este contrato."""
    return motor().buscar(yo.user_id, cuerpo.consulta, yo.kids, cuerpo.limite)
