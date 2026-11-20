"""Catálogo (mismo js/library.js que las apps), normalización y conversión del historial de sync."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from reco.catalogo.armar import armar
from reco.eventos.desde_sync import eventos_de_doc
from reco.texto import norm

LIBRARY = Path(__file__).resolve().parents[2] / "js" / "library.js"
pytestmark = pytest.mark.skipif(not shutil.which("node") or not LIBRARY.exists(), reason="necesita node y js/library.js")
CUENTA = "a" * 64


def _item(msg, caption, kind="video", chat="-1001234"):
    return {"key": f"{chat}:{msg}", "chatId": chat, "chatTitle": "", "msgId": msg, "kind": kind, "caption": caption,
            "fileName": f"{msg}.mp4", "duration": 5400, "size": msg * 1000, "width": 1920, "height": 1080,
            "date": 1_700_000_000_000 + msg, "edit": 0}


def test_armar_con_library_js():
    items = [
        _item(1, "pelicula#El Rey León (1994)#Simba debe reclamar su lugar. #Animadas #infantil #tmdb8587"),
        _item(2, "serie(1/1)#Dark#Niños desaparecen. #Suspenso #tmdbtv70523"),
        _item(3, "serie(1/2)#Dark#Sigue."),
        _item(4, "Mira este video de las vacaciones"),
        _item(5, "pelicula#Coco (2017)#Ficha #portada", kind="photo"),
        _item(6, "Película # Coco (2017) # Un niño viaja. #Animación"),
    ]
    cat = armar(items)
    por_clave = {t["titleKey"]: t for t in cat["titles"]}
    assert set(por_clave) == {"m:el rey leon:1994", "s:dark", "m:coco:2017"}
    assert por_clave["m:el rey leon:1994"]["kids"] is True
    assert por_clave["m:el rey leon:1994"]["tmdb"] == {"type": "movie", "id": 8587}
    assert por_clave["s:dark"]["tmdb"] == {"type": "tv", "id": 70523}   # completado desde el capítulo
    assert por_clave["m:coco:2017"]["categories"] == ["Animadas"]      # alias canónico de library.js
    assert cat["videos"]["-1001234:3"] == "s:dark"
    assert "-1001234:4" not in cat["videos"]                           # sin clasificar no entra


def test_norm_igual_que_js():
    textos = ["El Rey León", "¿Qué pasó ayer?", "Mad Max: Furia en el camino", "  AMÉLIE  ", "Niños_y-niñas 2"]
    js = subprocess.run(
        ["node", "-e", f"const L=require({json.dumps(str(LIBRARY))});"
         "const t=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(t.map(x=>{"
         "const k=L.build([{key:'1:1',chatId:'1',msgId:1,kind:'video',caption:'pelicula#'+x+' (2000)#d',"
         "fileName:'a.mp4',duration:1,size:1,width:1,height:1,date:1}],null);return Object.keys(k.titles)[0]})))",
         json.dumps(textos)],
        capture_output=True, text=True, check=True,
    ).stdout
    assert json.loads(js) == [f"m:{norm(t)}:2000" for t in textos]


def test_eventos_desde_sync():
    doc = {"p": {
        "p1": {"progress": {"-1:1": {"t": 0, "d": 5400, "at": 1_700_000_000_000, "done": True},
                            "-1:2": {"t": 900, "d": 3000, "at": 1_700_000_100_000},
                            "-1:3": {"t": 60, "d": 3000, "at": 1_700_000_100_000},
                            "-9:9": {"t": 0, "d": 1, "at": 1, "done": True}},
               "mylist": {"m:coco:2017": {"on": True, "at": 1_700_000_200_000},
                          "s:dark": {"on": False, "at": 1_700_000_300_000}}},
        "kids1": {"progress": {"-1:1": {"t": 0, "d": 5400, "at": 1_700_000_000_000, "done": True}}},
        "../malo": {"progress": {"-1:1": {"done": True}}},
    }}
    videos = {"-1:1": "m:coco:2017", "-1:2": "s:dark", "-1:3": "s:dark"}
    ev = list(eventos_de_doc(CUENTA, doc, [{"id": "kids1", "kids": True}], videos))
    resumen = sorted((e.perfil, e.tipo, e.movie_id, e.valor) for e in ev)
    assert resumen == [
        ("kids1", "view", "m:coco:2017", 2.0),
        ("p1", "view", "m:coco:2017", 2.0),
        ("p1", "view", "s:dark", 1.0),          # 15 min sin terminar: vista parcial
        ("p1", "watchlist", "m:coco:2017", None),
        ("p1", "watchlist_remove", "s:dark", None),
    ]
    assert all(e.kids for e in ev if e.perfil == "kids1")
    claves = [e.idempotency_key for e in ev]
    assert len(claves) == len(set(claves))
    assert claves == [e.idempotency_key for e in eventos_de_doc(CUENTA, doc, [{"id": "kids1", "kids": True}], videos)]
