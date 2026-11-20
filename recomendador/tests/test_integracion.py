"""De punta a punta con Postgres real (pgvector): migraciones, catálogo desde mensajes de Telegram, historial del
sync sin duplicados, API completa. Levantar la base de prueba:
    RECO_DB_ADMIN_PASSWORD=x RECO_DB_APP_PASSWORD=x docker compose --profile test up -d reco-db-test
y correr con RECO_DB_URL=postgresql://reco_app:prueba@127.0.0.1:55432/homeflix_reco"""

from __future__ import annotations

import json
import os

import httpx
import pytest

pytestmark = pytest.mark.integracion
URL = os.environ.get("RECO_DB_URL", "")
TOKEN = "t" * 40
CUENTA = "c" * 64
CHAT = "-1001234"


def _item(msg, caption, dias_atras=100):
    return {"key": f"{CHAT}:{msg}", "chatId": CHAT, "chatTitle": "", "msgId": msg, "kind": "video",
            "caption": caption, "fileName": f"{msg}.mp4", "duration": 5400, "size": msg, "width": 1920,
            "height": 1080, "date": 1_790_000_000_000 - dias_atras * 86_400_000, "edit": 0}


ITEMS = [
    _item(1, "pelicula#El resplandor (1980)#Un escritor cuida un hotel aislado. #Terror"),
    _item(2, "pelicula#It (1990)#Un payaso aterroriza a los niños de un pueblo. #Terror"),
    _item(3, "pelicula#Scream (1996)#Un asesino enmascarado acecha adolescentes. #Terror #Suspenso"),
    _item(4, "pelicula#El conjuro (2013)#Una familia en una casa embrujada. #Terror"),
    _item(5, "pelicula#Interestelar (2014)#Astronautas viajan por el espacio. #Ciencia_ficción"),
    _item(6, "pelicula#Gravedad (2013)#Dos astronautas a la deriva en el espacio. #Ciencia_ficción"),
    _item(7, "pelicula#Toy Story (1995)#Los juguetes cobran vida. #Animadas #infantil"),
    _item(8, "pelicula#Coco (2017)#Un niño viaja a la tierra de los muertos. #Animadas #infantil"),
    _item(9, "serie(1/1)#Dark#Niños desaparecen en un pueblo. #Suspenso"),
    _item(10, "serie(1/2)#Dark#Sigue el misterio."),
]
DOC = {"profiles": {"list": [{"id": "p1", "kids": False}, {"id": "p2", "kids": True}]}, "p": {
    "p1": {"progress": {f"{CHAT}:1": {"t": 0, "d": 5400, "at": 1_789_000_000_000, "done": True},
                        f"{CHAT}:3": {"t": 0, "d": 5400, "at": 1_789_100_000_000, "done": True}},
           "mylist": {"m:interestelar:2014": {"on": True, "at": 1_789_200_000_000}}},
    "p2": {"progress": {f"{CHAT}:7": {"t": 0, "d": 5400, "at": 1_789_000_000_000, "done": True}}},
}}


@pytest.fixture(scope="module")
def entorno():
    if not URL:
        pytest.skip("sin RECO_DB_URL")
    os.environ["RECO_TOKEN"] = TOKEN
    from reco import config as cfg_mod, db
    cfg_mod.config.cache_clear()
    db.usar_pool(None)
    with db.conexion() as conn:
        for t in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'recommendation'").fetchall():
            conn.execute(f'DROP TABLE IF EXISTS recommendation."{t["tablename"]}" CASCADE')
    assert db.migrar() == ["001_esquema.sql"]
    assert db.migrar() == []  # idempotente

    from reco.catalogo import armar
    armar.guardar_items(CHAT, ITEMS, completa=True)
    resumen = armar.rearmar()
    assert resumen["titulos"] == 9 and resumen["videos"] == 10

    from reco.eventos import desde_sync
    def servidor(req: httpx.Request) -> httpx.Response:
        assert req.headers["x-reco-token"] == TOKEN
        desde = int(req.url.params["desde"])
        cuentas = [] if desde >= 1_789_300_000_000 else [
            {"cuenta": CUENTA, "tg_id": 1, "vista": 1_789_300_000_000, "perfiles": DOC["profiles"]["list"], "doc": DOC}]
        return httpx.Response(200, json={"cuentas": cuentas, "siguiente": None})
    cliente = httpx.Client(transport=httpx.MockTransport(servidor))
    primera = desde_sync.importar(cliente)
    assert primera == {"cuentas": 1, "nuevos": 4}
    assert desde_sync.importar(cliente, completo=True)["nuevos"] == 0  # sin duplicados al repetir

    from reco.motor.servicio import motor
    motor().cargar()
    from fastapi.testclient import TestClient
    from reco.api.main import app
    with TestClient(app) as c:
        yield c
    db.usar_pool(None)


def h(perfil="p1", kids="0"):
    return {"x-reco-token": TOKEN, "x-reco-cuenta": CUENTA, "x-reco-perfil": perfil, "x-reco-kids": kids}


def test_sin_token_no_entra(entorno):
    assert entorno.get("/api/v1/recommendations/me").status_code == 401
    assert entorno.get("/api/v1/recommendations/me", headers={**h(), "x-reco-token": "x" * 40}).status_code == 401
    assert entorno.get("/api/v1/recommendations/me", headers={**h(), "x-reco-cuenta": "../x"}).status_code == 400


def test_salud(entorno):
    assert entorno.get("/healthz").json() == {"ok": True}
    r = entorno.get("/readyz")
    assert r.status_code == 200 and r.json()["titulos"] == 9


def test_para_ti(entorno):
    r = entorno.get("/api/v1/recommendations/me?limite=3", headers=h())
    assert r.status_code == 200
    d = r.json()
    assert d["model_version"] == "content-v1" and d["user_id"] == f"{CUENTA}:p1"
    claves = [x["movie_id"] for x in d["recommendations"]]
    assert len(claves) == 3
    assert not {"m:el resplandor:1980", "m:scream:1996", "m:interestelar:2014"} & set(claves)  # vistos / en lista
    # Interestelar está en su lista (+3) y vio dos de terror (+2 c/u): sale lo de los dos lados, con su razón
    assert {"m:it:1990", "m:el conjuro:2013"} & set(claves) and "m:gravedad:2013" in claves
    razones = {x["movie_id"]: x["reasons"][0]["label"] for x in d["recommendations"]}
    assert razones["m:gravedad:2013"] == "Parecida a Interestelar, de tu lista"
    assert all(x["reasons"] for x in d["recommendations"])
    siguiente = entorno.get(f"/api/v1/recommendations/me?limite=3&cursor={d['next_cursor']}", headers=h()).json()
    assert not set(claves) & {x["movie_id"] for x in siguiente["recommendations"]}


def test_kids(entorno):
    d = entorno.get("/api/v1/recommendations/me", headers=h("p2", "1")).json()
    assert {x["movie_id"] for x in d["recommendations"]} == {"m:coco:2017"}


def test_similares(entorno):
    d = entorno.get("/api/v1/recommendations/me/similar/m:gravedad:2013", headers=h("p9")).json()
    assert d["recommendations"][0]["movie_id"] == "m:interestelar:2014"
    assert d["recommendations"][0]["reasons"][0]["label"] == "Parecida a Gravedad"
    assert entorno.get("/api/v1/recommendations/me/similar/m:no existe", headers=h()).status_code == 404


def test_eventos_idempotentes_y_busqueda(entorno):
    lote = {"eventos": [{"id": "abc123", "tipo": "click", "title_key": "m:coco:2017", "at": 1_789_400_000_000},
                        {"id": "abc124", "tipo": "search", "consulta": "algo de terror"}]}
    assert entorno.post("/api/v1/events", headers=h(), json=lote).json() == {"recibidos": 2, "nuevos": 2}
    assert entorno.post("/api/v1/events", headers=h(), json=lote).json() == {"recibidos": 2, "nuevos": 0}
    malo = entorno.post("/api/v1/events", headers=h(), json={"eventos": [{"id": "abc125", "tipo": "view"}]})
    assert malo.status_code == 422  # las vistas solo entran por la sincronización

    d = entorno.post("/api/v1/search/semantic", headers=h(), json={"consulta": "una de terror de los 90"}).json()
    assert {x["movie_id"] for x in d["recommendations"]} <= {"m:it:1990", "m:scream:1996"}
    assert d["interpretacion"]["decada"] == [1990, 1999]


def test_feedback_y_perfil(entorno):
    assert entorno.post("/api/v1/recommendations/feedback", headers=h(),
                        json={"title_key": "m:it:1990", "accion": "descartar"}).status_code == 202
    d = entorno.get("/api/v1/recommendations/me?limite=20", headers=h()).json()
    assert "m:it:1990" not in {x["movie_id"] for x in d["recommendations"]}
    p = entorno.get("/api/v1/profiles/me", headers=h()).json()
    assert "Terror" in p["preferred_genres"] and "m:it:1990" in p["disliked_movies"]


def test_descubrir_y_openapi(entorno):
    d = entorno.get("/api/v1/discover", headers=h("nuevo")).json()
    assert d["recommendations"]
    esquema = entorno.get("/openapi.json").json()
    assert "/api/v1/recommendations/me" in esquema["paths"]
    json.dumps(esquema)
