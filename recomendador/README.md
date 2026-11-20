# Motor de recomendaciones de HomeFlix

Microservicio Python (FastAPI + worker) que recomienda películas y series del catálogo de Telegram y responde
búsquedas por voz con **@night_monkey_bot**. **No duplica** el catálogo ni los usuarios: Telegram sigue siendo la
fuente de verdad y el servidor Node de HomeFlix sigue siendo el único que da la cara a las apps.

```
Apps ──Bearer──> servidor Node (/api/v1/reco/*) ──red reco-interna──> reco-api (FastAPI, sin puerto público)
                       └─ /interno/v1/reco/* <── reco-worker: Telegram (NETSUCKS + bot de voz), TMDB, historial, perfiles
                                                  reco-db: Postgres 16 + pgvector, esquema «recommendation»
```

## Qué hace cada pieza

| Pieza | Archivo | Qué hace |
|---|---|---|
| Catálogo | `reco/catalogo/lector.py`, `armar.mjs` | Lee NETSUCKS (incremental cada 15 min, completa cada 6 h) y arma los títulos con **el mismo `js/library.js` de las apps**, así que nunca entiende un comentario distinto. |
| TMDB | `reco/tmdb/` | Agrega géneros, keywords, reparto, dirección y sinopsis. Usa el `#tmdb…` de la leyenda; si no lo hay, busca por nombre y año, y solo acepta coincidencias exactas. Corre solo en el servidor. |
| Historial | `reco/eventos/desde_sync.py` | Toma el `doc` de sincronización de cada cuenta: progreso → vistas, Mi lista → watchlist. La clave de idempotencia evita duplicados. |
| Eventos de la app | `POST /api/v1/events` | Recibe solo `click` (abrir ficha) y `search`. Las vistas y Mi lista nunca llegan por aquí. |
| Perfiles | `reco/motor/perfiles.py` | Pesos favorite +5, watchlist +3, vista completa +2, vista a medias +1, clic +0.5, quitar de la lista −1, con vida media de 60 días. Por tipo de evento cuenta el valor más alto, no la suma. |
| Motor | `reco/motor/` | TF-IDF por campo (géneros ×3, keywords ×2, dirección ×2, reparto ×1.5, década ×0.5, sinopsis ×1) y coseno. El ranking es `0.55·similitud + 0.15·género + 0.10·reparto + 0.10·popularidad + 0.10·novedad`, con MMR para variar. Cada resultado trae su razón. |
| Reglas | `reco/motor/reglas.py` | Excluye lo ya visto, lo que está en Mi lista (en «Para ti») y lo descartado. Kids → solo `#infantil`. El anime no sale. |
| Voz | `reco/voz/` | La cuenta Premium transcribe la nota de voz. `consulta.py` entiende «una de terror de los 90», «parecida a Interestelar», «con Keanu Reeves», «para niños» y «serie». |
| Evaluación | `reco/evaluacion/` | P@10, R@10, NDCG@10, cobertura y diversidad (dejando fuera la última interacción). Corre cada domingo y queda en `model_versions`. |

## API (interna; documentación en `/docs`)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/v1/recommendations/me?limite&cursor` | «Para ti» |
| GET | `/api/v1/recommendations/me/similar/{title_key}` | «Similares» en la ficha |
| POST | `/api/v1/events` | Clics y búsquedas (lotes de hasta 50; `id` aleatorio por evento) |
| GET | `/api/v1/profiles/me` | Preferencias calculadas |
| POST | `/api/v1/recommendations/feedback` | `descartar` / `me_gusta` / `no_me_gusta` |
| GET | `/api/v1/discover` | Popular y nuevo |
| POST | `/api/v1/search/semantic` | Búsqueda en lenguaje natural (la usa el bot) |
| GET | `/healthz`, `/readyz` | Vivo / listo (base + catálogo cargado) |

- **Identidad:** la ponen las cabeceras `x-reco-token` (secreto compartido con el servidor Node), `x-reco-cuenta` (sha256 de la llave), `x-reco-perfil` y `x-reco-kids`. Nunca se confía en un `user_id` que mande la app.
- **Score:** sirve para ordenar; no es una probabilidad.

## Desarrollo local
```bash
cd recomendador && /opt/homebrew/bin/python3.12 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q -m "not integracion"                                   # unitarias (sin base)
RECO_DB_ADMIN_PASSWORD=x RECO_DB_APP_PASSWORD=x docker compose --profile test up -d reco-db-test
RECO_DB_URL=postgresql://reco_app:prueba@127.0.0.1:55432/homeflix_reco .venv/bin/pytest -q   # todo
RECO_TOKEN=… .venv/bin/python scripts/carga.py --url http://127.0.0.1:8000 --rps 50 --segundos 60
```

## Despliegue (VPS, con permiso)
1. `bash recomendador/scripts/desplegar.sh --dry-run` revisa la memoria libre, la red y los archivos.
2. `bash recomendador/scripts/desplegar.sh` la primera vez crea `.env` con secretos al azar y copia el `RECO_TOKEN` al `.env` del servidor Node.
3. En el VPS, completa `~/homeflix-recomendador/recomendador/.env`: `TG_API_ID`, `TG_API_HASH`, `BOT_TOKEN`, `CATALOGO_CHATS` (id de NETSUCKS) y `TMDB_API_KEY`.
4. Inicia sesión una vez con la cuenta Premium (es interactivo y pide teléfono + código):
   `docker compose run --rm -it reco-worker python -m reco.worker --login`, y luego `docker compose restart reco-worker`.
   **Antes apaga el bot del Mac** (`~/Documents/night_monkey_bot`). La misma sesión en dos lugares da `AUTH_KEY_DUPLICATED`.
5. **Buzón:** crea un grupo privado con la cuenta Premium y el bot, y pon su id en `BUZON_CHAT`. Sin buzón, el bot solo entiende los audios del dueño.

## Privacidad
- Las búsquedas pierden el texto a los 90 días.
- Las consultas de voz se borran a los 30 días.
- Los resultados guardados para paginar se borran a los 2 días.
- Las sesiones de Telegram viven en el volumen `reco-sesiones`; nunca en el repo.
- TMDB pide atribución («Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB»). Si HomeFlix llega a cobrar, hay que revisar su licencia comercial.
