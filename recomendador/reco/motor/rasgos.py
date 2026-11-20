"""Movie Feature Extractor: convierte cada título (comentario de Telegram + TMDB) en un vector TF-IDF comparable.

Cada campo es su propio vocabulario y pesa distinto:
  géneros/categorías ×3 · keywords ×2 · directores ×2 · reparto ×1.5 · década ×0.5 · sinopsis ×1
Con ~1000 títulos la matriz de similitud completa cabe en memoria (float32)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

from ..texto import ficha, norm

PESOS_CAMPO = {"g": 3.0, "k": 2.0, "d": 2.0, "a": 1.5, "dec": 0.5, "txt": 1.0}
MAX_REPARTO = 5
STOPWORDS_ES = set("""
a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en
entre era eran es esa esas ese eso esos esta estaba estado estan estar este esto estos fue fueron ha hace hacia han
hasta hay la las le les lo los mas me mi mientras muy nada ni no nos nosotros o os otra otro otros para pero poco por
porque que quien se sea ser si sido sin sobre su sus tambien te tiene tienen todo todos tras tu tus un una uno unos y
ya yo cuyo cuya donde despues luego tras vez veces asi aun aunque debe deben puede pueden sera seran solo sus the of
and to in is his her their with for on at an be by from as that this it
""".split())
_PALABRA = re.compile(r"[a-z0-9]{3,}")


def tokens_texto(texto: str) -> list[str]:
    return [w for w in _PALABRA.findall(norm(texto)) if w not in STOPWORDS_ES]


@dataclass
class Titulo:
    title_key: str
    tipo: str
    nombre: str
    anio: int | None
    kids: bool
    categorias: list[str]
    categoria: str | None
    agregado: datetime | None
    generos: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    reparto: list[str] = field(default_factory=list)
    directores: list[str] = field(default_factory=list)
    sinopsis: str = ""
    popularidad_tmdb: float = 0.0
    nota_tmdb: float = 0.0

    @classmethod
    def de_fila(cls, f: dict[str, Any]) -> "Titulo":
        return cls(
            title_key=f["title_key"], tipo=f["title_type"], nombre=f["name"],
            anio=f.get("release_year") or f.get("year") or None, kids=bool(f.get("kids")),
            categorias=list(f.get("categories") or []), categoria=f.get("primary_category"),
            agregado=f.get("added_at"), generos=list(f.get("genres") or []), keywords=list(f.get("keywords") or []),
            reparto=list(f.get("cast_members") or [])[:MAX_REPARTO], directores=list(f.get("directors") or []),
            sinopsis=(f.get("overview") or f.get("description") or ""),
            popularidad_tmdb=float(f.get("popularity") or 0), nota_tmdb=float(f.get("vote_average") or 0),
        )

    def campos(self) -> dict[str, list[str]]:
        generos = {ficha(g) for g in self.generos + self.categorias if g}
        return {
            "g": sorted(generos),
            "k": [ficha(k) for k in self.keywords],
            "d": [ficha(d) for d in self.directores],
            "a": [ficha(a) for a in self.reparto],
            "dec": [str(self.anio // 10 * 10)] if self.anio else [],
            "txt": tokens_texto(f"{self.sinopsis} {' '.join(self.keywords)}"),
        }


@dataclass
class Rasgos:
    titulos: list[Titulo]
    indice: dict[str, int]
    matriz: sparse.csr_matrix          # n × términos, filas L2 = 1
    terminos: list[str]                # «g:terror», «a:keanu_reeves», «txt:espacio»…
    nombres: dict[str, str]            # término → cómo se muestra («Terror», «Keanu Reeves»)
    similitud: np.ndarray              # n × n, float32, diagonal 0
    vectorizador_txt: TfidfVectorizer | None = None
    bloques: dict[str, tuple[int, int]] = field(default_factory=dict)  # campo → (columna inicial, final)

    def __len__(self) -> int:
        return len(self.titulos)

    def fila(self, title_key: str) -> int | None:
        return self.indice.get(title_key)

    def terminos_de(self, i: int, prefijo: str) -> list[str]:
        fila = self.matriz.getrow(i)
        return [self.terminos[j] for j in fila.indices if self.terminos[j].startswith(prefijo + ":")]


def _vectorizar(docs: list[list[str]]) -> tuple[sparse.csr_matrix, list[str], TfidfVectorizer] | None:
    if not any(docs):
        return None
    vec = TfidfVectorizer(analyzer=lambda x: x, sublinear_tf=True, norm="l2", min_df=1)
    try:
        m = vec.fit_transform(docs)
    except ValueError:  # vocabulario vacío
        return None
    return m.tocsr(), list(vec.get_feature_names_out()), vec


def construir(filas: list[dict[str, Any]]) -> Rasgos:
    titulos = [Titulo.de_fila(f) for f in filas]
    campos = [t.campos() for t in titulos]
    bloques: list[sparse.csr_matrix] = []
    terminos: list[str] = []
    vec_txt: TfidfVectorizer | None = None
    bloques_pos: dict[str, tuple[int, int]] = {}
    for nombre_campo, peso in PESOS_CAMPO.items():
        r = _vectorizar([c[nombre_campo] for c in campos])
        if r is None:
            continue
        m, nombres, vec = r
        bloques_pos[nombre_campo] = (len(terminos), len(terminos) + len(nombres))
        bloques.append(m * peso)
        terminos.extend(f"{nombre_campo}:{n}" for n in nombres)
        if nombre_campo == "txt":
            vec_txt = vec
    n = len(titulos)
    if bloques:
        matriz = normalize(sparse.hstack(bloques).tocsr(), norm="l2", axis=1)
    else:
        matriz = sparse.csr_matrix((n, 0))
    similitud = (matriz @ matriz.T).toarray().astype(np.float32) if n else np.zeros((0, 0), np.float32)
    np.fill_diagonal(similitud, 0.0)

    mostrar: dict[str, str] = {}
    for t in titulos:
        for g in t.generos + t.categorias:
            mostrar.setdefault(f"g:{ficha(g)}", g)
        for a in t.reparto:
            mostrar.setdefault(f"a:{ficha(a)}", a)
        for d in t.directores:
            mostrar.setdefault(f"d:{ficha(d)}", d)
        for k in t.keywords:
            mostrar.setdefault(f"k:{ficha(k)}", k)
    return Rasgos(titulos, {t.title_key: i for i, t in enumerate(titulos)}, matriz, terminos, mostrar,
                  similitud, vec_txt, bloques_pos)


def vecinos(r: Rasgos, i: int, k: int = 50) -> list[tuple[int, float]]:
    fila = r.similitud[i]
    if not len(fila):
        return []
    k = min(k, len(fila) - 1) if len(fila) > 1 else 0
    if k <= 0:
        return []
    idx = np.argpartition(-fila, k - 1)[:k]
    idx = idx[np.argsort(-fila[idx])]
    return [(int(j), float(fila[j])) for j in idx if fila[j] > 0]
