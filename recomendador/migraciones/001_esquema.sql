-- Esquema propio del motor. Los ids son los de HomeFlix, no UUID:
--   user_id  = '<cuenta sha256>:<perfil>'      (cuenta = sha256 de la llave, como en servidor/src/base.js)
--   title_key = 'm:<nombre normalizado>:<año>' | 's:<nombre normalizado>'   (js/library.js)
--   video_key = '<chatId>:<msgId>'
-- El catálogo NO se duplica como fuente: catalog_* es un índice derivado de Telegram que se puede reconstruir.

CREATE TABLE IF NOT EXISTS worker_state (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mensajes del grupo tal como los describe js/telegram.js (describe()), para armar el catálogo con js/library.js
CREATE TABLE IF NOT EXISTS catalog_raw_items (
    item_key   TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL,
    msg_id     BIGINT NOT NULL,
    item       JSONB NOT NULL,
    seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_raw_chat ON catalog_raw_items(chat_id, msg_id DESC);

CREATE TABLE IF NOT EXISTS catalog_titles (
    title_key        TEXT PRIMARY KEY,
    title_type       VARCHAR(10) NOT NULL CHECK (title_type IN ('movie', 'series')),
    name             TEXT NOT NULL,
    year             INTEGER,
    description      TEXT,
    kids             BOOLEAN NOT NULL DEFAULT FALSE,
    categories       JSONB NOT NULL DEFAULT '[]',
    primary_category TEXT,
    tmdb_type        VARCHAR(5),
    tmdb_id          BIGINT,
    added_at         TIMESTAMPTZ,
    first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted          BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS catalog_videos (
    video_key TEXT PRIMARY KEY,
    title_key TEXT NOT NULL REFERENCES catalog_titles(title_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_videos_title ON catalog_videos(title_key);

CREATE TABLE IF NOT EXISTS user_events (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    account_id      TEXT NOT NULL,
    profile_id      TEXT NOT NULL,
    profile_kids    BOOLEAN NOT NULL DEFAULT FALSE,
    movie_id        TEXT NULL,
    event_type      VARCHAR(30) NOT NULL,
    event_value     DOUBLE PRECISION NULL,
    search_query    TEXT NULL,
    source          VARCHAR(50),
    metadata        JSONB NOT NULL DEFAULT '{}',
    idempotency_key TEXT NOT NULL UNIQUE,
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_event_type CHECK (
        event_type IN ('favorite', 'view', 'search', 'watchlist', 'watchlist_remove', 'click')
    )
);
CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_movie ON user_events(movie_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);

CREATE TABLE IF NOT EXISTS movie_features (
    title_key         TEXT PRIMARY KEY,
    tmdb_id           BIGINT,
    tmdb_type         VARCHAR(5),
    tmdb_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (tmdb_status IN ('pending', 'ok', 'unmatched', 'error')),
    genres            JSONB NOT NULL DEFAULT '[]',
    keywords          JSONB NOT NULL DEFAULT '[]',
    cast_members      JSONB NOT NULL DEFAULT '[]',
    directors         JSONB NOT NULL DEFAULT '[]',
    overview          TEXT,
    original_language VARCHAR(10),
    release_year      INTEGER,
    popularity        DOUBLE PRECISION,
    vote_average      DOUBLE PRECISION,
    feature_vector    JSONB,
    embedding         vector(384),
    source_updated_at TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS movie_similar (
    title_key   TEXT NOT NULL,
    similar_key TEXT NOT NULL,
    score       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (title_key, similar_key)
);
CREATE INDEX IF NOT EXISTS idx_similar_rank ON movie_similar(title_key, score DESC);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id             TEXT PRIMARY KEY,
    preferred_genres    JSONB NOT NULL DEFAULT '{}',
    preferred_actors    JSONB NOT NULL DEFAULT '{}',
    preferred_directors JSONB NOT NULL DEFAULT '{}',
    disliked_movies     JSONB NOT NULL DEFAULT '[]',
    title_weights       JSONB NOT NULL DEFAULT '{}',
    profile_vector      JSONB,
    interaction_count   INTEGER NOT NULL DEFAULT 0,
    last_event_at       TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_versions (
    id          BIGSERIAL PRIMARY KEY,
    model_name  VARCHAR(100) NOT NULL,
    version     VARCHAR(50) NOT NULL,
    parameters  JSONB,
    metrics     JSONB,
    is_active   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_results (
    request_id    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    kind          VARCHAR(20) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    items         JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_results_user ON recommendation_results(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id         BIGSERIAL PRIMARY KEY,
    user_id    TEXT NOT NULL,
    movie_id   TEXT NOT NULL,
    action     VARCHAR(20) NOT NULL CHECK (action IN ('descartar', 'me_gusta', 'no_me_gusta')),
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON recommendation_feedback(user_id);

CREATE TABLE IF NOT EXISTS voice_queries (
    id             BIGSERIAL PRIMARY KEY,
    tg_user_id     BIGINT NOT NULL,
    user_id        TEXT,
    transcript     TEXT NOT NULL,
    interpretation JSONB NOT NULL DEFAULT '{}',
    results        JSONB NOT NULL DEFAULT '[]',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voice_created ON voice_queries(created_at);
