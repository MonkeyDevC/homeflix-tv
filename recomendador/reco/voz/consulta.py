"""Interpreta una búsqueda en lenguaje natural («una de terror de los 90», «algo como Interestelar», «con Keanu
Reeves para niños») y la convierte en filtros + similitud sobre el catálogo. Sin modelos: reglas y TF-IDF.
Si los filtros dejan la lista vacía se van soltando (primero la década, luego el género)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np

from ..motor.rasgos import Rasgos, tokens_texto
from ..texto import ficha, norm

# palabra (normalizada) → fichas de género que cubre (de los comentarios y de TMDB es-MX)
GENEROS: dict[str, tuple[str, ...]] = {}
for _palabras, _fichas in [
    ("terror horror miedo susto sustos miedosa miedosas", ("terror",)),
    ("comedia comedias risa chistosa chistosas graciosa graciosas divertida divertidas humor", ("comedia",)),
    ("accion balazos peleas explosiones", ("accion", "accion_y_aventura", "action_adventure")),
    ("aventura aventuras", ("aventura", "accion_y_aventura", "action_adventure")),
    ("scifi espacial espacio futurista", ("ciencia_ficcion", "ciencia_ficcion_y_fantasia", "sci_fi_fantasy")),
    ("fantasia magia fantastica", ("fantasia", "ciencia_ficcion_y_fantasia", "sci_fi_fantasy")),
    ("suspenso suspense thriller intriga", ("suspense", "suspenso")),
    ("misterio misterios", ("misterio", "suspenso")),
    ("crimen policiaca policiaco policial mafia", ("crimen", "suspenso")),
    ("drama dramatica dramaticas", ("drama",)),
    ("romance romantica romanticas amor", ("romance", "comedia")),
    ("animada animadas animacion caricatura caricaturas dibujos", ("animacion", "animadas")),
    ("documental documentales", ("documental",)),
    ("familiar familia", ("familia", "animadas", "kids")),
    ("guerra belica belicas", ("belica", "war_politics")),
    ("western vaqueros", ("western",)),
    ("musical musicales", ("musica",)),
    ("historica historicas", ("historia",)),
    ("marvel superheroes superheroe", ("marvel",)),
]:
    for _p in _palabras.split():
        GENEROS[_p] = _fichas
FRASES_GENERO = {"ciencia ficcion": ("ciencia_ficcion", "ciencia_ficcion_y_fantasia", "sci_fi_fantasy")}

DECADAS_PALABRA = {"setentas": 1970, "setenteras": 1970, "ochentas": 1980, "ochenteras": 1980, "ochentera": 1980,
                   "noventas": 1990, "noventeras": 1990, "noventera": 1990, "dosmil": 2000}
RE_DECADA = re.compile(r"\b(?:de los|los|anos|decada de los)\s+(\d{2}|\d{4})s?\b")
RE_ANIO = re.compile(r"\b(?:del|de|en)\s+((?:19|20)\d{2})\b")
RE_PARECIDA = re.compile(r"\b(?:parecid[ao]s?\s+a|similar(?:es)?\s+a|como|tipo|estilo)\s+(.+)$")
RE_PERSONA = re.compile(r"\b(?:con|de|dirigida por|actua|sale)\s+([a-z]+(?:\s+[a-z]+){1,2})")
PALABRAS_KIDS = {"ninos", "nino", "ninas", "infantil", "infantiles", "chiquitos", "peques"}
PALABRAS_SERIE = {"serie", "series"}
PALABRAS_PELI = {"pelicula", "peliculas", "peli", "pelis", "film"}
PALABRAS_NUEVO = {"nueva", "nuevas", "nuevo", "reciente", "recientes", "estreno", "estrenos"}
RELLENO = set("""quiero ver una un unas unos algo alguna alguno pon ponme busca buscame recomienda recomiendame dame
me gustaria tienes hay que de del la el los las para con sin por favor pelicula peliculas peli pelis serie series
mira mirar verla verlo""".split())


@dataclass
class Interpretacion:
    texto: str
    generos: set[str] = field(default_factory=set)       # fichas «terror»
    decada: tuple[int, int] | None = None
    tipo: str | None = None                             # movie | series
    kids: bool = False
    nuevo: bool = False
    parecida_a: str | None = None                       # title_key
    personas: list[str] = field(default_factory=list)   # términos «a:…» / «d:…»
    palabras: list[str] = field(default_factory=list)   # resto, para TF-IDF y nombres

    def json(self) -> dict[str, Any]:
        return {
            "texto": self.texto, "generos": sorted(self.generos), "decada": self.decada, "tipo": self.tipo,
            "kids": self.kids, "nuevo": self.nuevo, "parecida_a": self.parecida_a, "personas": self.personas,
            "palabras": self.palabras,
        }

    def etiqueta(self, r: Rasgos) -> str:
        partes = []
        for g in sorted(self.generos):
            nombre = r.nombres.get(f"g:{g}")
            if nombre and nombre not in partes:
                partes.append(nombre)
                break
        if self.decada and self.decada[0] == self.decada[1]:
            partes.append(f"del {self.decada[0]}")
        elif self.decada:
            partes.append(f"años {str(self.decada[0])[2:] if self.decada[0] < 2000 else self.decada[0]}")
        if self.parecida_a and (i := r.fila(self.parecida_a)) is not None:
            partes.append(f"parecida a {r.titulos[i].nombre}")
        for p in self.personas[:1]:
            partes.append(("de " if p.startswith("d:") else "con ") + r.nombres.get(p, p[2:]))
        if self.kids:
            partes.append("para niños")
        return "Coincide con tu búsqueda" + (": " + " · ".join(partes) if partes else "")


def _titulo_parecido(r: Rasgos, texto: str) -> str | None:
    objetivo = set(norm(texto).split()) - RELLENO
    if not objetivo:
        return None
    mejor, clave = 0.0, None
    for t in r.titulos:
        nombre = set(norm(t.nombre).split())
        if not nombre:
            continue
        comun = len(objetivo & nombre)
        puntaje = comun / max(len(nombre), len(objetivo))
        if puntaje > mejor:
            mejor, clave = puntaje, t.title_key
    return clave if mejor >= 0.5 else None


def interpretar(texto: str, r: Rasgos) -> Interpretacion:
    limpio = norm(texto)
    it = Interpretacion(texto=texto.strip())
    usadas: set[str] = set()

    m = RE_PARECIDA.search(limpio)
    if m:
        it.parecida_a = _titulo_parecido(r, m.group(1))
        if it.parecida_a:
            usadas |= set(m.group(1).split())
            limpio = limpio[: m.start()]

    for frase, fichas in FRASES_GENERO.items():
        if frase in limpio:
            it.generos.update(fichas)
            usadas |= set(frase.split())
    m = RE_DECADA.search(limpio)
    if m:
        n = int(m.group(1))
        inicio = n if n >= 1000 else (1900 + n if n >= 30 else 2000 + n)
        it.decada = (inicio, inicio + 9)
        usadas |= set(m.group(0).split())
    else:
        m = RE_ANIO.search(limpio)
        if m:
            it.decada = (int(m.group(1)), int(m.group(1)))
            usadas |= set(m.group(0).split())

    personas_vocab = {k for k in r.nombres if k[:2] in ("a:", "d:")}
    for m in RE_PERSONA.finditer(limpio):
        palabras = m.group(1).split()
        for largo in (3, 2):
            if len(palabras) >= largo:
                candidato = ficha(" ".join(palabras[:largo]))
                for pref in ("a:", "d:"):
                    if pref + candidato in personas_vocab:
                        it.personas.append(pref + candidato)
                        usadas |= set(palabras[:largo])
                        break

    for palabra in limpio.split():
        if palabra in usadas:
            continue
        if palabra in GENEROS:
            it.generos.update(GENEROS[palabra])
        elif palabra in DECADAS_PALABRA:
            it.decada = (DECADAS_PALABRA[palabra], DECADAS_PALABRA[palabra] + 9)
        elif palabra in PALABRAS_KIDS:
            it.kids = True
        elif palabra in PALABRAS_SERIE:
            it.tipo = "series"
        elif palabra in PALABRAS_PELI:
            it.tipo = it.tipo or "movie"
        elif palabra in PALABRAS_NUEVO:
            it.nuevo = True
        elif palabra not in RELLENO and len(palabra) > 2:
            it.palabras.append(palabra)
    return it


def _filtra(r: Rasgos, i: int, it: Interpretacion, con_genero: bool, con_decada: bool) -> bool:
    t = r.titulos[i]
    if it.tipo and t.tipo != it.tipo:
        return False
    if it.kids and not t.kids:
        return False
    if con_decada and it.decada and not (t.anio and it.decada[0] <= t.anio <= it.decada[1]):
        return False
    if con_genero and it.generos:
        propios = {x[2:] for x in r.terminos_de(i, "g")}
        if not propios & it.generos:
            return False
    if it.personas:
        propios = set(r.terminos_de(i, "a")) | set(r.terminos_de(i, "d"))
        if not propios & set(it.personas):
            return False
    return True


def coincidencias(texto: str, r: Rasgos) -> tuple[Interpretacion, dict[int, tuple[float, str]]]:
    """índice → (qué tan bien coincide 0..1, etiqueta para la razón)."""
    it = interpretar(texto, r)
    n = len(r)
    if not n:
        return it, {}
    puntaje = np.zeros(n, dtype=np.float32)

    if it.palabras and r.vectorizador_txt is not None and "txt" in r.bloques:
        q = r.vectorizador_txt.transform([tokens_texto(" ".join(it.palabras))])
        if q.nnz:
            a, b = r.bloques["txt"]
            bloque = r.matriz[:, a:b]
            puntaje += 0.6 * np.asarray(bloque @ q.T.toarray()).ravel() / (np.max(np.abs(bloque.data)) if bloque.nnz else 1)
        palabras = set(it.palabras)
        for i, t in enumerate(r.titulos):
            nombre = set(norm(t.nombre).split())
            if nombre and palabras & nombre:
                puntaje[i] += 0.8 * len(palabras & nombre) / len(nombre)
    if it.parecida_a and (j := r.fila(it.parecida_a)) is not None:
        puntaje += 0.8 * r.similitud[j]
        puntaje[j] = -1
    if it.nuevo:
        anios = np.array([t.anio or 0 for t in r.titulos], dtype=np.float32)
        if anios.max() > 0:
            puntaje += 0.2 * np.clip((anios - (anios.max() - 15)) / 15, 0, 1)

    hay_filtros = bool(it.generos or it.decada or it.tipo or it.kids or it.personas)
    for con_genero, con_decada in ((True, True), (True, False), (False, False)):
        # la razón dice solo lo que de verdad se cumplió (si se soltó la década, ya no dice «años 90»)
        etiqueta = replace(it, generos=it.generos if con_genero else set(),
                           decada=it.decada if con_decada else None).etiqueta(r)
        salida = {}
        for i in range(n):
            if puntaje[i] < 0 or not _filtra(r, i, it, con_genero, con_decada):
                continue
            base = float(puntaje[i]) + (0.4 if hay_filtros else 0.0)
            if base > 0:
                salida[i] = (min(base, 1.5) / 1.5, etiqueta)
        if salida:
            return it, salida
    return it, {}
