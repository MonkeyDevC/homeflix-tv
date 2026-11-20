"""Business Rules: qué no se recomienda nunca, pase lo que pase con el puntaje."""

from __future__ import annotations

from dataclasses import dataclass

from .perfiles import Perfil
from .rasgos import Titulo

CATEGORIAS_FUERA = {"Anime"}  # el anime tiene su propio canal y perfil


@dataclass(frozen=True)
class Contexto:
    kids: bool = False
    excluir_vistos: bool = True
    excluir_lista: bool = True


def permitido(t: Titulo, perfil: Perfil | None, ctx: Contexto, retirados: set[str] | None = None) -> bool:
    if retirados and t.title_key in retirados:
        return False
    if ctx.kids and not t.kids:
        return False
    if t.categoria in CATEGORIAS_FUERA or any(c in CATEGORIAS_FUERA for c in t.categorias):
        return False
    if perfil is None:
        return True
    if t.title_key in perfil.descartados:
        return False
    if ctx.excluir_vistos and t.title_key in perfil.vistos:
        return False
    if ctx.excluir_lista and t.title_key in perfil.en_lista:
        return False
    return True
