"""python -m reco.evaluacion → métricas offline sobre los eventos reales (necesita RECO_DB_URL)."""

import json

from .. import registro
from .metricas import evaluar_offline

registro.configurar()
print(json.dumps(evaluar_offline(), indent=2, ensure_ascii=False))
