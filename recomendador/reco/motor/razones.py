"""Explicabilidad: cada recomendación dice por qué está ahí, a partir del componente que más aportó."""

from __future__ import annotations

from typing import Any

ORIGEN_TEXTO = {
    "favorite": "Porque te gustó {nombre}",
    "view": "Porque viste {nombre}",
    "watchlist": "Parecida a {nombre}, de tu lista",
    "click": "Parecida a {nombre}",
    "search": "Parecida a {nombre}",
}


def razon(tipo: str, label: str) -> dict[str, str]:
    return {"type": tipo, "label": label}


def armar(aportes: dict[str, float], detalle: dict[str, Any], maximo: int = 2) -> list[dict[str, str]]:
    """aportes: componente → cuánto sumó al puntaje. detalle: los nombres para el texto."""
    candidatas: list[tuple[float, dict[str, str]]] = []
    if detalle.get("semilla") and aportes.get("sim", 0) > 0:
        plantilla = ORIGEN_TEXTO.get(detalle.get("semilla_origen", ""), "Parecida a {nombre}")
        candidatas.append((aportes["sim"] + 0.01, razon("similarity", plantilla.format(nombre=detalle["semilla"]))))
    elif aportes.get("sim", 0) > 0:
        candidatas.append((aportes["sim"], razon("similarity", "Parecida a lo que ves")))
    if detalle.get("genero") and aportes.get("genero", 0) > 0:
        candidatas.append((aportes["genero"], razon("genre_affinity", f"Coincide con tus géneros: {detalle['genero']}")))
    if detalle.get("persona") and aportes.get("persona", 0) > 0:
        tipo, nombre = detalle["persona"]
        texto = f"De {nombre}" if tipo == "d" else f"Con {nombre}"
        candidatas.append((aportes["persona"], razon("cast_affinity", texto)))
    if aportes.get("novedad", 0) > 0.03:
        candidatas.append((aportes["novedad"], razon("new", "Nuevo en HomeFlix")))
    if aportes.get("popularidad", 0) > 0.03:
        candidatas.append((aportes["popularidad"], razon("popular", "Popular en HomeFlix")))
    if detalle.get("consulta"):
        candidatas.append((1.0, razon("query_match", detalle["consulta"])))
    candidatas.sort(key=lambda x: -x[0])
    vistas: set[str] = set()
    salida = []
    for _, r in candidatas:
        if r["type"] not in vistas:
            salida.append(r)
            vistas.add(r["type"])
        if len(salida) == maximo:
            break
    return salida or [razon("popular", "Para descubrir en HomeFlix")]
