"""Autenticación de servicio. La API NO es pública: solo la llama el servidor Node de HomeFlix, que ya validó la llave
de la cuenta y pone quién es. Nunca se confía en un user_id que mande la app."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastapi import Header, HTTPException

from ..config import config
from ..eventos.normalizador import CUENTA_RE, PERFIL_RE, usuario


@dataclass(frozen=True)
class Quien:
    cuenta: str
    perfil: str
    kids: bool

    @property
    def user_id(self) -> str:
        return usuario(self.cuenta, self.perfil)


def token_valido(x_reco_token: str | None) -> None:
    esperado = config().reco_token
    if not esperado or len(esperado) < 32:
        raise HTTPException(503, "RECO_TOKEN no configurado")
    if not x_reco_token or not hmac.compare_digest(x_reco_token.encode(), esperado.encode()):
        raise HTTPException(401, "token de servicio inválido")


def quien(
    x_reco_token: str | None = Header(default=None),
    x_reco_cuenta: str | None = Header(default=None),
    x_reco_perfil: str | None = Header(default=None),
    x_reco_kids: str | None = Header(default=None),
) -> Quien:
    token_valido(x_reco_token)
    if not x_reco_cuenta or not CUENTA_RE.match(x_reco_cuenta):
        raise HTTPException(400, "falta la cuenta")
    perfil = x_reco_perfil or "p1"
    if not PERFIL_RE.match(perfil):
        raise HTTPException(400, "perfil inválido")
    return Quien(x_reco_cuenta, perfil, x_reco_kids == "1")


def solo_servicio(x_reco_token: str | None = Header(default=None)) -> None:
    token_valido(x_reco_token)
