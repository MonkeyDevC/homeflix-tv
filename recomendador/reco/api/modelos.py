"""Contratos de la API (los ve el backend de HomeFlix en /docs)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Razon(BaseModel):
    type: str = Field(examples=["genre_affinity"])
    label: str = Field(examples=["Coincide con tus géneros: Terror"])


class Recomendacion(BaseModel):
    movie_id: str = Field(description="titleKey de HomeFlix", examples=["m:interestelar:2014"])
    score: float = Field(description="Valor de ranking, no una probabilidad")
    reasons: list[Razon]


class Respuesta(BaseModel):
    request_id: str
    model_version: str
    user_id: str
    recommendations: list[Recomendacion]
    next_cursor: Optional[str] = None
    movie_id: Optional[str] = None
    interpretacion: Optional[dict] = None


class EventoApp(BaseModel):
    id: str = Field(min_length=6, max_length=64, description="Aleatorio por evento: si la app reintenta, no se duplica")
    tipo: Literal["click", "search"]
    title_key: Optional[str] = Field(default=None, max_length=300)
    consulta: Optional[str] = Field(default=None, max_length=500)
    at: Optional[float] = Field(default=None, description="ms desde 1970")


class LoteEventos(BaseModel):
    eventos: list[EventoApp] = Field(max_length=50)


class Feedback(BaseModel):
    title_key: str = Field(max_length=300)
    accion: Literal["descartar", "me_gusta", "no_me_gusta"]
    request_id: Optional[str] = Field(default=None, max_length=64)


class Busqueda(BaseModel):
    consulta: str = Field(min_length=1, max_length=500)
    limite: int = Field(default=10, ge=1, le=50)
