// HomeFlix · canal «Anime»: qué animes traen subtítulos en español / doblaje en inglés.
//
// La anime-api no dice los idiomas en las listas: hay que pedir un capítulo para verlos. Aquí se lleva un índice que se
// llena solo, despacio (un anime cada ~20 s, para no saturar a los proveedores):
//   · se siembra con los populares y en tendencia, y con todo lo que las apps miran (búsquedas, filas…);
//   · «sondear(id)» (lo pone anime.js) mira el capítulo 1 y devuelve {ok, es, en, dub};
//   · cada reproducción también anota lo que vio (anotar);
//   · se guarda en DATA_DIR/anime-idiomas.json y sobrevive a los reinicios.
// Las apps piden `…/api/v1/anime/idiomas` y arman las filas «Subtítulos en español», «Doblaje en inglés» y «Japonés con
// subtítulos en inglés». Es una pista por título (capítulo 1): el español puede cambiar de un capítulo a otro.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX = 1500;
const LIMITE_FILA = 300;

/* de la ficha de AniList solo lo que las apps muestran en una tarjeta */
function recortar(a) {
  const t = a.title || {};
  return {
    id: Number(a.id),
    title: { romaji: t.romaji || '', english: t.english || '', native: t.native || '' },
    coverImage: a.coverImage || {},
    bannerImage: a.bannerImage || '',
    format: a.format || '',
    seasonYear: a.seasonYear || (a.startDate && a.startDate.year) || 0,
    episodes: a.episodes || 0,
    duration: a.duration || 0,
    status: a.status || '',
    averageScore: a.averageScore || 0,
    genres: (a.genres || []).slice(0, 4),
    nextAiringEpisode: a.nextAiringEpisode && a.nextAiringEpisode.episode ? { episode: a.nextAiringEpisode.episode } : null,
  };
}

export function crearIdiomas({ dir = '', ahora = () => Date.now(), sondear = null, sembrarListas = null, pausa = 30_000, libre = () => true, vigencia = 30 * 86_400_000, reintento = 3 * 86_400_000 } = {}) {
  const archivo = dir ? join(dir, 'anime-idiomas.json') : '';
  const datos = new Map(); // id → {c, es, en, dub, ok, at}
  let sucio = false;
  let timerGuardar = null;
  let corriendo = false;
  let sembrado = 0;

  try {
    if (archivo) {
      const j = JSON.parse(readFileSync(archivo, 'utf8'));
      (j.items || []).forEach((x) => { if (x && x.c && x.c.id) datos.set(x.c.id, x); });
    }
  } catch { /* primera vez */ }

  function guardar() {
    sucio = true;
    if (!archivo || timerGuardar) return;
    timerGuardar = setTimeout(() => {
      timerGuardar = null;
      try {
        mkdirSync(dir, { recursive: true });
        const tmp = archivo + '.tmp';
        writeFileSync(tmp, JSON.stringify({ v: 1, items: [...datos.values()] }));
        renameSync(tmp, archivo);
        sucio = false;
      } catch { /* el índice se vuelve a armar solo */ }
    }, 2000);
    if (timerGuardar.unref) timerGuardar.unref();
  }

  /* Lo que devuelve una lista de la anime-api (results): los que no se conocían quedan en la cola. */
  function sembrar(lista) {
    let nuevos = 0;
    (Array.isArray(lista) ? lista : []).forEach((a) => {
      if (!a || !a.id || a.isAdult) return;
      const id = Number(a.id);
      const x = datos.get(id);
      if (x) { x.c = recortar(a); return; }
      if (datos.size >= MAX) return;
      datos.set(id, { c: recortar(a), es: false, en: false, dub: false, ok: false, at: 0 });
      nuevos += 1;
    });
    if (nuevos) guardar();
    return nuevos;
  }

  /* Lo que se vio al reproducir (más fiable que el sondeo: es el capítulo que se está viendo) */
  function anotar(id, v) {
    const x = datos.get(Number(id));
    if (!x || !v) return;
    x.ok = true;
    x.es = x.es || !!v.es;
    x.en = x.en || !!v.en;
    if (v.dub !== undefined) x.dub = x.dub || !!v.dub;
    x.at = ahora();
    guardar();
  }

  const saber = (id) => datos.get(Number(id)) || null;

  function pendiente() {
    const t = ahora();
    let viejo = null;
    for (const x of datos.values()) {
      if (!x.at) return x; // nunca sondeado (el orden de inserción es el de popularidad)
      if (t - x.at > (x.ok ? vigencia : reintento) && !viejo) viejo = x;
    }
    return viejo;
  }

  const dormir = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

  async function ciclo() {
    while (corriendo) {
      const x = pendiente();
      if (!x) {
        if (sembrarListas && ahora() - sembrado > 6 * 3600_000) {
          sembrado = ahora();
          try { await sembrarListas(sembrar); } catch { /* se intenta luego */ }
          continue;
        }
        await dormir(120_000);
        continue;
      }
      /* cada sondeo gasta ≈10 s de CPU de la anime-api: si alguien la está usando, se espera a que termine */
      while (corriendo && !libre()) await dormir(5000);
      if (!corriendo) break;
      try {
        const v = await sondear(x.c.id);
        x.at = ahora();
        if (v && v.ok) { x.ok = true; x.es = !!v.es; x.en = !!v.en; x.dub = !!v.dub; } else { x.ok = false; }
      } catch {
        x.at = ahora();
        x.ok = false;
      }
      guardar();
      await dormir(pausa);
    }
  }

  function iniciar() {
    if (corriendo || !sondear) return;
    corriendo = true;
    ciclo();
  }

  function parar() {
    corriendo = false;
    if (timerGuardar) { clearTimeout(timerGuardar); timerGuardar = null; }
    if (sucio && archivo) {
      try { mkdirSync(dir, { recursive: true }); writeFileSync(archivo, JSON.stringify({ v: 1, items: [...datos.values()] })); } catch { /* nada */ }
    }
  }

  /* Lo que reciben las apps: tres listas ordenadas por nota */
  function consultar() {
    const todos = [...datos.values()];
    const sondeados = todos.filter((x) => x.ok);
    const orden = (a, b) => (b.c.averageScore || 0) - (a.c.averageScore || 0);
    const cortar = (l) => l.sort(orden).slice(0, LIMITE_FILA).map((x) => x.c);
    return {
      actualizado: ahora(),
      total: todos.length,
      sondeados: sondeados.length,
      es: cortar(sondeados.filter((x) => x.es)),
      dub: cortar(sondeados.filter((x) => x.dub)),
      en: cortar(sondeados.filter((x) => !x.es && x.en)),
    };
  }

  return { sembrar, anotar, saber, consultar, iniciar, parar, _: { datos, pendiente } };
}
