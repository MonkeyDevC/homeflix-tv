"""Logs estructurados en JSON (una línea por evento), para `docker logs reco-api | jq`."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

_CAMPOS_BASE = set(vars(logging.makeLogRecord({})).keys()) | {"message", "asctime"}


class FormatoJson(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        datos = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "nivel": record.levelname.lower(),
            "origen": record.name,
            "msg": record.getMessage(),
        }
        for clave, valor in vars(record).items():
            if clave not in _CAMPOS_BASE and not clave.startswith("_"):
                datos[clave] = valor
        if record.exc_info:
            datos["error"] = self.formatException(record.exc_info)
        return json.dumps(datos, ensure_ascii=False, default=str)


def configurar(nivel: str = "INFO") -> None:
    raiz = logging.getLogger()
    if any(isinstance(h.formatter, FormatoJson) for h in raiz.handlers):
        return
    manejador = logging.StreamHandler(sys.stdout)
    manejador.setFormatter(FormatoJson())
    raiz.handlers[:] = [manejador]
    raiz.setLevel(nivel)
    logging.getLogger("telethon").setLevel("WARNING")
    logging.getLogger("httpx").setLevel("WARNING")
    logging.getLogger("apscheduler").setLevel("WARNING")
