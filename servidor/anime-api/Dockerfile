FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Usuario sin privilegios
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Sin --reload (es solo para desarrollo)
# 2 procesos: la anime-api descifra en Python (CPU) y con uno solo cada extracción detenía las demás peticiones
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
