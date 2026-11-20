from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ... import db
from ...eventos.normalizador import Evento, registrar
from ...motor import perfiles
from ...motor.servicio import motor
from ..auth import Quien, quien
from ..modelos import Feedback, Respuesta

router = APIRouter(prefix="/api/v1", tags=["recomendaciones"])


@router.get("/recommendations/me", response_model=Respuesta, summary="Para ti (P0)")
def para_ti(yo: Quien = Depends(quien), limite: int = Query(20, ge=1, le=50), cursor: str | None = None):
    if cursor:
        pagina = motor().continuar(yo.user_id, cursor, limite)
        if pagina is None:
            raise HTTPException(410, "el cursor venció; pide la primera página")
        return pagina
    return motor().para_ti(yo.user_id, yo.kids, limite)


@router.get("/recommendations/me/similar/{movie_id:path}", response_model=Respuesta, summary="Similares (P0)")
def similares(movie_id: str, yo: Quien = Depends(quien), limite: int = Query(12, ge=1, le=50),
              cursor: str | None = None):
    if cursor:
        pagina = motor().continuar(yo.user_id, cursor, limite)
        if pagina is None:
            raise HTTPException(410, "el cursor venció; pide la primera página")
        return pagina
    r = motor().similares(yo.user_id, movie_id, yo.kids, limite)
    if r is None:
        raise HTTPException(404, "ese título no está en el catálogo")
    return r


@router.get("/discover", response_model=Respuesta, summary="Descubrir: popular y nuevo (P1)")
def descubrir(yo: Quien = Depends(quien), limite: int = Query(20, ge=1, le=50)):
    return motor().descubrir(yo.user_id, yo.kids, limite)


@router.get("/profiles/me", summary="Preferencias calculadas (P1)")
def perfil(yo: Quien = Depends(quien)):
    m = motor()
    p = m.perfil(yo.user_id)
    fila = perfiles.a_fila(p, m.asegurar())
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
            (yo.user_id, db.j(fila["preferred_genres"]), db.j(fila["preferred_actors"]),
             db.j(fila["preferred_directors"]), db.j(fila["disliked_movies"]), db.j(fila["title_weights"]),
             db.j(fila["profile_vector"]), fila["interaction_count"], fila["last_event_at"]),
        )
    return {k: v for k, v in fila.items() if k not in ("title_weights", "profile_vector")}


@router.post("/recommendations/feedback", status_code=202, summary="Me gusta / no me gusta / descartar (P1)")
def feedback(cuerpo: Feedback, yo: Quien = Depends(quien)):
    with db.conexion() as conn:
        conn.execute(
            "INSERT INTO recommendation_feedback (user_id, movie_id, action, request_id) VALUES (%s, %s, %s, %s)",
            (yo.user_id, cuerpo.title_key, cuerpo.accion, cuerpo.request_id),
        )
    if cuerpo.accion == "me_gusta":
        from datetime import datetime, timezone
        registrar([Evento(yo.cuenta, yo.perfil, "favorite", f"fb:{yo.user_id}:{cuerpo.title_key}:favorite",
                          datetime.now(timezone.utc), cuerpo.title_key, origen="feedback", kids=yo.kids)])
    motor().invalidar(yo.user_id)
    return {"ok": True}
