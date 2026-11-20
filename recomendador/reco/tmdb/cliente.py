"""Cliente mínimo de TMDB (https://developer.themoviedb.org). Solo corre en el servidor: la TV y el celular nunca
llaman a TMDB. Respeta un tope de peticiones por segundo y reintenta los 429."""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import config

BASE = "https://api.themoviedb.org/3"


class ErrorTmdb(RuntimeError):
    pass


class ClienteTmdb:
    def __init__(self, por_segundo: float = 10.0, http: httpx.Client | None = None) -> None:
        cfg = config()
        if not (cfg.tmdb_api_key or cfg.tmdb_token):
            raise ErrorTmdb("Falta TMDB_API_KEY o TMDB_TOKEN")
        cabeceras = {"Accept": "application/json"}
        self._params: dict[str, str] = {"language": cfg.tmdb_idioma}
        if cfg.tmdb_token:
            cabeceras["Authorization"] = f"Bearer {cfg.tmdb_token}"
        else:
            self._params["api_key"] = cfg.tmdb_api_key
        self._http = http or httpx.Client(base_url=BASE, headers=cabeceras, timeout=15)
        self._intervalo = 1.0 / por_segundo
        self._ultima = 0.0

    def _get(self, ruta: str, **params: Any) -> dict[str, Any]:
        for intento in range(4):
            espera = self._intervalo - (time.monotonic() - self._ultima)
            if espera > 0:
                time.sleep(espera)
            self._ultima = time.monotonic()
            r = self._http.get(ruta, params={**self._params, **params})
            if r.status_code == 429:
                time.sleep(float(r.headers.get("Retry-After", 2 ** intento)))
                continue
            if r.status_code == 404:
                raise ErrorTmdb(f"No existe en TMDB: {ruta}")
            r.raise_for_status()
            return r.json()
        raise ErrorTmdb(f"TMDB sigue limitando: {ruta}")

    def detalle(self, tipo: str, tmdb_id: int) -> dict[str, Any]:
        if tipo == "tv":
            return self._get(f"/tv/{tmdb_id}", append_to_response="keywords,credits")
        return self._get(f"/movie/{tmdb_id}", append_to_response="keywords,credits")

    def buscar(self, tipo: str, nombre: str, anio: int | None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"query": nombre, "include_adult": "false"}
        if anio:
            params["first_air_date_year" if tipo == "tv" else "primary_release_year"] = anio
        return self._get(f"/search/{'tv' if tipo == 'tv' else 'movie'}", **params).get("results", [])

    def cerrar(self) -> None:
        self._http.close()
