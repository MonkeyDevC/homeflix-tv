#!/bin/bash
# Primera vez que arranca reco-db: extensión pgvector (necesita superusuario) y el usuario propio del motor,
# que solo es dueño del esquema «recommendation». La API y el worker se conectan como reco_app, nunca como admin.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -v app_pw="$RECO_DB_APP_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SELECT format('CREATE ROLE reco_app LOGIN PASSWORD %L', :'app_pw') \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO reco_app;
CREATE SCHEMA IF NOT EXISTS recommendation AUTHORIZATION reco_app;
ALTER ROLE reco_app SET search_path = recommendation, public;
SQL
