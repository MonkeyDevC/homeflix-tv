# Motor de recomendaciones de HomeFlix (API y worker usan la misma imagen).
# Se construye desde la RAÍZ del repo (docker-compose: context ..) porque el catálogo se arma con el mismo
# js/library.js que usan la TV y el celular: así el motor nunca entiende los comentarios distinto que las apps.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/recomendador
COPY recomendador/pyproject.toml ./
RUN pip install --upgrade pip && pip install "fastapi>=0.115" "uvicorn[standard]>=0.30" "psycopg[binary,pool]>=3.2" \
    "numpy>=1.26" "scipy>=1.13" "scikit-learn>=1.5" "httpx>=0.27" "telethon>=1.36" "apscheduler>=3.10,<4"

COPY js/library.js /app/js/library.js
COPY recomendador/ /app/recomendador/
RUN pip install --no-deps -e . \
 && useradd --create-home --uid 10001 reco \
 && mkdir -p /sesiones && chown reco /sesiones
USER reco

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1
CMD ["uvicorn", "reco.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
