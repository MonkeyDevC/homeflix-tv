// HomeFlix · canal «Anime». El servidor es la ÚNICA puerta hacia la anime-api (otro contenedor, sin puerto público):
//
//   GET …/api/v1/anime/<lista>        (con la llave de la cuenta)  catálogo: search, trending, popular, recent, info/<id>…
//   GET …/api/v1/anime/reproducir     (con la llave)  {streams, subtitulos}: pide los enlaces a la anime-api y los devuelve
//                                     como direcciones FIRMADAS de este mismo servidor
//   GET …/anime/p/<firma>/<m3u8|seg|sub>?u=<destino>&r=<referer>   (sin llave; la firma lo permite)
//                                     el reproductor de la TV / el celular no puede mandar cabeceras, así que la llave va
//                                     dentro de la dirección: HMAC(secreto, vence|tipo|destino|referer). Solo se sirve lo
//                                     que este servidor firmó; nada de pedir direcciones arbitrarias (SSRF).
//
// Los videos son HLS de terceros que exigen un «Referer»: el servidor los baja con esa cabecera y reescribe la lista
// (m3u8) para que cada pedazo vuelva a pasar por aquí con su firma.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { crearIdiomas } from './anime-idiomas.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const VIDA_FIRMA = 6 * 3600_000; // un capítulo largo con pausas cabe de sobra
const MAX_SUB = 2 * 1024 * 1024;
const MAX_LISTA = 3 * 1024 * 1024; // una lista m3u8 pesa unos KB
const PARAMS = new Set(['query', 'page', 'per_page', 'genre', 'tag', 'year', 'season', 'format', 'status', 'sort']);
const LISTAS = /^\/(search|suggestions|filter|spotlight|trending|popular|upcoming|recent|schedule|genres)$|^\/(info|episodes)\/\d{1,9}$/;

export function crearAnime({ url = '', clave: claveApi = '', secreto = '', dir = '', rastreo = false, pausaRastreo = 20_000, esperaEspanol = 20_000, ahora = () => Date.now(), pedir = (...a) => fetch(...a) } = {}) {
  /* Si la anime-api todavía estuviera detrás de una clave (X-Api-Key) en vez de la red privada, se manda en cada pedido. */
  const aApi = (dir, opts = {}) => pedir(dir, claveApi ? { ...opts, headers: { ...(opts.headers || {}), 'x-api-key': claveApi } } : opts);
  const base = String(url || '').replace(/\/+$/, '');
  const clave = Buffer.from(secreto || randomBytes(32)); // sin secreto fijo: las firmas valen hasta el próximo reinicio
  const cache = new Map();
  let actividad = 0; // última vez que una app pidió algo: el rastreo de idiomas espera a que nadie esté usando la API

  const activo = () => !!base;

  /* ---------- Firmas ---------- */
  function firmar(vence, tipo, destino, referer) {
    return createHmac('sha256', clave).update(`${vence}|${tipo}|${destino}|${referer}`).digest('base64url').slice(0, 32);
  }

  function urlFirmada(prefijo, tipo, destino, referer, vence) {
    const exp = vence || ahora() + VIDA_FIRMA;
    const f = `${exp}.${firmar(exp, tipo, destino, referer)}`;
    return `${prefijo}/anime/p/${f}/${tipo}?u=${encodeURIComponent(destino)}&r=${encodeURIComponent(referer || '')}`;
  }

  function firmaValida(f, tipo, destino, referer) {
    const m = /^(\d{10,16})\.([A-Za-z0-9_-]{32})$/.exec(f || '');
    if (!m || Number(m[1]) < ahora()) return false;
    const esperado = Buffer.from(firmar(m[1], tipo, destino, referer));
    const dada = Buffer.from(m[2]);
    return esperado.length === dada.length && timingSafeEqual(esperado, dada);
  }

  /* Direcciones que nunca se sirven, aunque vengan firmadas (la anime-api es de terceros). */
  function destinoPermitido(texto) {
    let u;
    try { u = new URL(texto); } catch { return false; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || !h.includes('.')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      const [a, b] = h.split('.').map(Number);
      if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return false;
    }
    if (h.startsWith('[')) return false;
    return true;
  }

  /* ---------- Catálogo ---------- */
  function ttl(ruta) {
    return /^\/(info|episodes)\//.test(ruta) ? 30 * 60_000 : /^\/(search|suggestions|filter)$/.test(ruta) ? 5 * 60_000 : 10 * 60_000;
  }

  function consulta(search) {
    const q = new URLSearchParams();
    [...search.keys()].filter((k) => PARAMS.has(k)).sort().forEach((k) => q.set(k, String(search.get(k)).slice(0, 120)));
    return q.toString();
  }

  async function json(ruta, qs) {
    const clave = `${ruta}?${qs}`;
    const hit = cache.get(clave);
    if (hit && hit.hasta > ahora()) return hit.dato;
    const r = await aApi(`${base}/anime${ruta}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
    if (!r.ok) throw Object.assign(new Error('anime_no_disponible'), { codigo: r.status === 404 ? 404 : 502 });
    const dato = adelgazar(ruta, await r.json());
    if (cache.size > 400) cache.clear();
    cache.set(clave, { hasta: ahora() + ttl(ruta), dato });
    return dato;
  }

  /* La ficha completa pesa ~90 KB (personajes, staff…) y los capítulos de One Piece 9 MB (todos los proveedores):
   * a las apps solo les llega lo que muestran. */
  function adelgazar(ruta, d) {
    if (/^\/info\//.test(ruta)) {
      const t = (d && d.title) || {};
      return {
        id: d.id, title: { romaji: t.romaji || '', english: t.english || '', native: t.native || '' }, description: d.description || '',
        coverImage: d.coverImage || {}, bannerImage: d.bannerImage || '', format: d.format || '', season: d.season || '', seasonYear: d.seasonYear || 0,
        episodes: d.episodes || 0, duration: d.duration || 0, status: d.status || '', averageScore: d.averageScore || 0, genres: d.genres || [],
        studios: ((d.studios && d.studios.nodes) || []).filter((s) => s.isAnimationStudio).slice(0, 2).map((s) => s.name),
        startDate: d.startDate || {}, nextAiringEpisode: d.nextAiringEpisode || null, isAdult: !!d.isAdult,
      };
    }
    if (/^\/episodes\//.test(ruta)) {
      /* el proveedor con más capítulos en subtítulos; el doblaje, solo qué números existen */
      const provs = Object.entries((d && d.providers) || {}).filter(([, v]) => v && v.episodes);
      provs.sort((a, b) => ((b[1].episodes.sub || []).length - (a[1].episodes.sub || []).length));
      const subs = provs.length ? provs[0][1].episodes.sub || [] : [];
      const dub = new Set();
      provs.forEach(([, v]) => (v.episodes.dub || []).forEach((e) => dub.add(Number(e.number))));
      return {
        anilistId: d && d.anilistId,
        episodios: subs.map((e) => ({ n: Number(e.number), titulo: String(e.title || '').slice(0, 160), imagen: e.image || '', minutos: Math.round((e.duration || 0) / 60), relleno: !!e.filler, fecha: e.airDate || '' })),
        doblados: [...dub].filter((n) => Number.isFinite(n)).sort((a, b) => a - b),
      };
    }
    return d;
  }

  /* {codigo, cuerpo} */
  async function catalogo(ruta, search) {
    if (!activo()) return { codigo: 503, cuerpo: { error: 'anime_apagado' } };
    actividad = ahora();
    if (ruta === '/idiomas') return { codigo: 200, cuerpo: idiomas.consultar() };
    if (ruta === '/inicio') return { codigo: 200, cuerpo: await inicio() };
    if (!LISTAS.test(ruta)) return { codigo: 404, cuerpo: { error: 'no_encontrado' } };
    try {
      const cuerpo = await json(ruta, consulta(search));
      if (cuerpo && Array.isArray(cuerpo.results)) idiomas.sembrar(cuerpo.results); // lo que se mira, se va sondeando
      return { codigo: 200, cuerpo };
    } catch (e) {
      return { codigo: e.codigo || 502, cuerpo: { error: e.message || 'anime_no_disponible' } };
    }
  }

  /* ¿Esta fuente sirve de verdad? Algunos proveedores devuelven una «lista» cifrada o una página de error con el tipo
   * de una lista HLS; un HLS vale solo si empieza con #EXTM3U y un mp4 si responde video (con rangos). */
  async function validar(st) {
    const tipo = st && st.type;
    if ((tipo !== 'hls' && tipo !== 'mp4') || !destinoPermitido(st.url)) return null;
    try {
      const r = await pedir(st.url, { headers: cabeceras(st.referer || '', tipo === 'mp4' ? { range: 'bytes=0-1' } : {}), signal: AbortSignal.timeout(15_000), redirect: 'follow' });
      if (!r.ok && r.status !== 206) return null;
      if (tipo === 'hls') {
        const t = (await r.text()).slice(0, 4000);
        return /^\s*#EXTM3U/.test(t) ? { ...st, tipo: 'hls' } : null;
      }
      const ct = r.headers.get('content-type') || '';
      if (r.body && r.body.cancel) r.body.cancel().catch(() => {});
      return /video|octet-stream|mpegurl/i.test(ct) ? { ...st, tipo: 'mp4' } : null;
    } catch {
      return null;
    }
  }

  async function extraer(id, e, tipo, prov) {
    const qs = new URLSearchParams({ e, type: tipo });
    if (prov) qs.set('provider', prov);
    try {
      const res = await aApi(`${base}/anime/extract/${id}?${qs}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /* Proveedores de la anime-api. Los RAPIDOS se piden a la vez (gana el primero que sirva); los demás, solo si ninguno sirvió.
   * «reanime» devuelve listas HLS cifradas: queda de último recurso (validar() las descarta). */
  const RAPIDOS = ['anikoto', 'animegg'];
  const PROVEEDORES = ['anikoto', 'animegg', 'anineko', 'mkissa', 'anizone', 'kaa', 'aniwaves', 'anibd', 'animeonsen', 'reanime'];
  const preferido = new Map(); // anime → último proveedor que funcionó

  const esRe = /spanish|espa[nñ]ol|latin|castell/i;
  const subEs = (t) => (String(t.srclang || '').toLowerCase() === 'es') || esRe.test(String(t.label || t.language || ''));
  const subEn = (t) => (String(t.srclang || '').toLowerCase() === 'en') || /english|ingl[eé]s/i.test(String(t.label || t.language || ''));

  /* Qué idiomas trae un grupo de fuentes: 3 = con español, 2 = con otros subtítulos, 1 = sin subtítulos aparte (mp4 de animegg) */
  function idiomasDe(validos) {
    const subs = validos.flatMap((s) => s.subtitles || []);
    return { es: subs.some(subEs), en: subs.some(subEn), hay: subs.length > 0 };
  }
  const puntaje = (i) => (i.es ? 3 : i.hay ? 2 : 1);

  /* Cuánto se espera, después de la primera fuente que sirve, a otra que traiga español (animegg responde en 4 s y no trae
   * subtítulos; anikoto, que sí los trae en varios idiomas, tarda 15–45 s). */
  const ESPERA_ESPANOL = esperaEspanol;
  const memoria = new Map(); // «id:e:tipo» → {hasta, hallado}: el segundo vistazo al mismo capítulo es inmediato
  const enCurso = new Map(); // «id:e:tipo» → promesa: si se pide lo que ya se está buscando (adelantado o repetido), se espera lo mismo

  /* Pide los enlaces, comprueba que sirvan (si no, prueba con otro proveedor) y firma lo que el reproductor va a pedir.
   * Prefiere la fuente con subtítulos en español; si no hay, la que traiga cualquier subtítulo; si no, el video solo. */
  async function reproducir(search, prefijo) {
    if (!activo()) return { codigo: 503, cuerpo: { error: 'anime_apagado' } };
    const id = /^\d{1,9}$/.test(search.get('id') || '') ? search.get('id') : '';
    const e = /^\d{1,4}$/.test(search.get('e') || '') ? search.get('e') : '';
    const tipo = search.get('type') === 'dub' ? 'dub' : 'sub';
    const prov = /^[a-z0-9_-]{2,20}$/i.test(search.get('provider') || '') ? search.get('provider') : '';
    if (!id || !e) return { codigo: 400, cuerpo: { error: 'faltan_datos' } };
    actividad = ahora();
    const clave = `${id}:${e}:${tipo}:${prov}`;
    const guardado = memoria.get(clave);
    let hallado = guardado && guardado.hasta > ahora() ? guardado.hallado : null;
    if (!hallado && enCurso.has(clave)) hallado = await enCurso.get(clave).catch(() => null);
    const intentar = async (p) => {
      const r = await extraer(id, e, tipo, p);
      if (!r) return null;
      const validos = (await Promise.all((r.streams || []).map(validar))).filter(Boolean);
      if (!validos.length) return null;
      const idi = idiomasDe(validos);
      if (tipo === 'sub' && idi.hay) idiomas.anotar(id, { es: idi.es, en: idi.en });
      return { r, validos, idi, puntaje: puntaje(idi) };
    };
    /* Junta lo que va llegando. Una fuente con subtítulos (español o no) se devuelve al instante; si la primera en llegar es un
     * video solo (animegg, que no trae subtítulos aparte) se espera ESPERA_ESPANOL a que llegue una con subtítulos. */
    const mejor = (ps) => new Promise((resolve) => {
      let faltan = ps.length;
      let best = null;
      let timer = null;
      if (!faltan) return resolve(null);
      const fin = () => { clearTimeout(timer); resolve(best); };
      const uno = (v) => {
        faltan -= 1;
        if (v) {
          if (!best || v.puntaje > best.puntaje) best = v;
          if (v.puntaje >= 2) return fin(); // las fuentes con subtítulos traen TODOS sus idiomas: si no hay español, no lo habrá en otra del mismo proveedor
          if (!timer) timer = setTimeout(fin, ESPERA_ESPANOL);
        }
        if (faltan === 0) fin();
      };
      ps.forEach((p) => p.then(uno, () => uno(null)));
    });
    if (!hallado) {
      const conocido = idiomas.saber(id);
      const buscar = async () => {
        let h = null;
        if (prov) return intentar(prov);
        /* Por fases: cada proveedor gasta CPU de la anime-api (descifra en Python), y pedirlos todos a la vez los hacía a todos
         * 3–4 veces más lentos. Si el índice ya sabe que anikoto trae subtítulos de este anime, va solo (≈10 s); si no, junto
         * con animegg (que responde en ≈6 s pero sin subtítulos aparte). Los demás, solo si esos no sirvieron. */
        const primeros = conocido && conocido.ok && conocido.en ? ['anikoto'] : RAPIDOS;
        h = await mejor(primeros.map(intentar));
        if (!h) h = await mejor(PROVEEDORES.filter((p) => !primeros.includes(p)).slice(0, 2).map(intentar));
        if (!h) h = await mejor(PROVEEDORES.filter((p) => !primeros.includes(p)).slice(2).map(intentar));
        return h;
      };
      const promesa = buscar();
      enCurso.set(clave, promesa);
      try { hallado = await promesa; } finally { enCurso.delete(clave); }
      if (hallado) {
        if (memoria.size > 300) memoria.clear();
        memoria.set(clave, { hasta: ahora() + 30 * 60_000, hallado });
      }
    }
    if (!hallado) return { codigo: 404, cuerpo: { error: 'sin_fuentes' } };
    if (hallado.r.provider) preferido.set(id, hallado.r.provider);
    const vence = ahora() + VIDA_FIRMA;
    const streams = hallado.validos.map((s) => ({
      servidor: s.server || '',
      audio: s.audio || tipo,
      tipo: s.tipo,
      url: urlFirmada(prefijo, s.tipo === 'hls' ? 'm3u8' : 'seg', s.url, s.referer || '', vence),
      subtitulos: (s.subtitles || []).filter((x) => x && destinoPermitido(x.url)).map((x) => ({
        /* cada proveedor lo llama distinto: «language» (reanime) o «label» + «srclang» (anikoto, anineko…) */
        idioma: String(x.language || x.label || '').slice(0, 80),
        codigo: String(x.srclang || '').slice(0, 8).toLowerCase(),
        formato: String(x.format || '').toLowerCase(),
        defecto: !!x.default,
        url: urlFirmada(prefijo, 'sub', x.url, s.referer || '', vence),
      })),
    }));
    return { codigo: 200, cuerpo: { id: Number(id), episodio: Number(e), tipo, proveedor: hallado.r.provider || prov, espanol: hallado.idi.es, streams } };
  }

  /* ---------- Inicio caliente ----------
   * Las apps pedían 11 listas por separado y cada una esperaba a la anime-api (que a veces está ocupada descifrando). Ahora el
   * servidor las trae él solo cada 8 minutos, de una en una, y las apps piden UNA respuesta: /inicio, siempre de memoria. */
  const FILAS = [
    ['trending', '/trending', 'per_page=24'], ['popular', '/popular', 'per_page=24'], ['recent', '/recent', 'per_page=24'], ['upcoming', '/upcoming', 'per_page=24'],
    ['g-accion', '/filter', 'genre=Action&per_page=24&sort=POPULARITY_DESC'], ['g-aventura', '/filter', 'genre=Adventure&per_page=24&sort=POPULARITY_DESC'],
    ['g-comedia', '/filter', 'genre=Comedy&per_page=24&sort=POPULARITY_DESC'], ['g-fantasia', '/filter', 'genre=Fantasy&per_page=24&sort=POPULARITY_DESC'],
    ['g-romance', '/filter', 'genre=Romance&per_page=24&sort=POPULARITY_DESC'], ['g-scifi', '/filter', 'genre=Sci-Fi&per_page=24&sort=POPULARITY_DESC'],
  ];
  let inicioCalc = { hasta: 0, filas: {} };
  let inicioEnCurso = null;

  /* de cada tarjeta solo lo que se pinta (y la portada «large»: la «extraLarge» pesa 4 veces más y la TV no la necesita) */
  function tarjeta(a) {
    const t = a.title || {};
    return {
      id: a.id, title: { romaji: t.romaji || '', english: t.english || '', native: '' }, coverImage: { large: (a.coverImage || {}).large || (a.coverImage || {}).extraLarge || '' },
      bannerImage: a.bannerImage || '', format: a.format || '', seasonYear: a.seasonYear || 0, episodes: a.episodes || 0, duration: a.duration || 0, status: a.status || '',
      averageScore: a.averageScore || 0, genres: (a.genres || []).slice(0, 3), nextAiringEpisode: a.nextAiringEpisode && a.nextAiringEpisode.episode ? { episode: a.nextAiringEpisode.episode } : null,
    };
  }

  async function calcularInicio() {
    const filas = { ...inicioCalc.filas };
    for (const [id, ruta, qs] of FILAS) {
      try {
        const d = await json(ruta, qs);
        const lista = (d.results || []).filter((a) => a && a.id && !a.isAdult).map(tarjeta);
        if (lista.length) filas[id] = lista;
      } catch { /* queda lo anterior */ }
    }
    inicioCalc = { hasta: ahora() + 8 * 60_000, filas };
    return inicioCalc;
  }

  async function inicio() {
    if (!inicioCalc.hasta || inicioCalc.hasta < ahora()) {
      /* vencido: lo ya calculado se entrega al instante y se renueva detrás; si nunca hubo nada, se espera */
      if (!inicioEnCurso) inicioEnCurso = calcularInicio().finally(() => { inicioEnCurso = null; });
      if (!Object.keys(inicioCalc.filas).length) await inicioEnCurso;
    }
    const i = idiomas.consultar();
    /* Las filas por idioma pueden tener cientos de títulos: la pantalla enseña los 100 mejor puntuados (y cuántos hay en total) */
    const L = 100;
    return {
      filas: inicioCalc.filas,
      idiomas: { es: i.es.slice(0, L).map(tarjeta), dub: i.dub.slice(0, L).map(tarjeta), en: i.en.slice(0, L).map(tarjeta), cuantos: { es: i.es.length, dub: i.dub.length, en: i.en.length }, total: i.total, sondeados: i.sondeados },
      actualizado: ahora(),
    };
  }

  /* ---------- Índice de idiomas (src/anime-idiomas.js) ---------- */
  /* Mira el capítulo 1 con anikoto (el proveedor que trae subtítulos en varios idiomas) y el doblaje por la lista de capítulos. */
  async function sondear(id) {
    const r = await extraer(id, '1', 'sub', 'anikoto');
    const subs = ((r && r.streams) || []).flatMap((s) => s.subtitles || []);
    const ok = !!(r && (r.streams || []).length);
    let dub = false;
    if (ok) {
      const d = await extraer(id, '1', 'dub', 'anikoto'); // el doblaje se ve con otro pedido (/episodes tarda 21 s y gasta toda la CPU)
      dub = !!(d && (d.streams || []).length);
    }
    return { ok, es: subs.some(subEs), en: subs.some(subEn), dub };
  }

  /* Siembra inicial: los más populares y en tendencia (cada 6 h se vuelve a mirar por si hay nuevos) */
  async function sembrarListas(sembrar) {
    const tandas = [['/popular', 8], ['/trending', 2]];
    for (const [ruta, paginas] of tandas) {
      for (let p = 1; p <= paginas; p += 1) {
        try { sembrar((await json(ruta, `page=${p}&per_page=50`)).results); } catch { /* otra vez en 6 h */ }
      }
    }
  }

  const idiomas = crearIdiomas({ dir, ahora, sondear, sembrarListas, pausa: pausaRastreo, libre: () => ahora() - actividad > 45_000 });
  if (rastreo && activo()) {
    idiomas.iniciar();
    /* inicio caliente: se arma al arrancar y se renueva solo (el cuerpo del temporizador no bloquea el cierre del proceso) */
    inicio().catch(() => {});
    const t = setInterval(() => { if (!inicioEnCurso) { inicioEnCurso = calcularInicio().finally(() => { inicioEnCurso = null; }); } }, 8 * 60_000);
    if (t.unref) t.unref();
  }

  /* ---------- Proxy firmado ---------- */
  function cabeceras(referer, extra = {}) {
    const h = { 'user-agent': UA, accept: '*/*', ...extra };
    if (referer) {
      h.referer = referer;
      try { h.origin = new URL(referer).origin; } catch { /* sin origin */ }
    }
    return h;
  }

  function reescribirLista(texto, destino, referer, prefijo, vence) {
    const absoluta = (rel) => new URL(rel, destino).href;
    const tipoDe = (u) => (/\.m3u8(\?|$)/i.test(new URL(u).pathname + new URL(u).search) ? 'm3u8' : 'seg');
    return texto.split(/\r?\n/).map((linea) => {
      const t = linea.trim();
      if (!t) return linea;
      if (t.startsWith('#')) {
        /* URI="…" de #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA…: también tienen que pasar por aquí */
        return linea.replace(/URI="([^"]+)"/g, (todo, uri) => {
          try {
            const abs = absoluta(uri);
            if (!destinoPermitido(abs)) return todo;
            const tipo = /^#EXT-X-MEDIA/.test(t) ? 'm3u8' : tipoDe(abs);
            return `URI="${urlFirmada(prefijo, tipo, abs, referer, vence)}"`;
          } catch { return todo; }
        });
      }
      try {
        const abs = absoluta(t);
        if (!destinoPermitido(abs)) return '';
        return urlFirmada(prefijo, tipoDe(abs), abs, referer, vence);
      } catch { return ''; }
    }).join('\n');
  }

  /* Atiende /anime/p/<firma>/<tipo>?u=&r= ; res ya viene con los CORS de la app. */
  async function proxy(req, res, resto, search, prefijo, cors) {
    const m = /^\/([^/]+)\/(m3u8|seg|sub)$/.exec(resto);
    const destino = search.get('u') || '';
    const referer = search.get('r') || '';
    if (!m || !destino || destino.length > 4000 || !firmaValida(decodeURIComponent(m[1]), m[2], destino, referer) || !destinoPermitido(destino)) {
      res.writeHead(403, { 'content-type': 'application/json', ...cors });
      return res.end('{"error":"firma_invalida"}');
    }
    const tipo = m[2];
    const vence = Number(m[1].split('.')[0]);
    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort()); // la app cerró la conexión: se deja de bajar del origen
    let r;
    /* el tope es para que el origen responda (cabeceras); el cuerpo de un mp4 puede tardar lo que dure el capítulo */
    const espera = setTimeout(() => ctrl.abort(), tipo === 'seg' ? 60_000 : 20_000);
    try {
      const extra = {};
      if (tipo === 'seg' && req.headers.range) extra.range = req.headers.range;
      r = await pedir(destino, { headers: cabeceras(referer, extra), signal: ctrl.signal, redirect: 'follow' });
    } catch {
      clearTimeout(espera);
      res.writeHead(502, { 'content-type': 'application/json', ...cors });
      return res.end('{"error":"origen_no_responde"}');
    }
    clearTimeout(espera);
    if (!r.ok && r.status !== 206) {
      res.writeHead(r.status === 404 ? 404 : 502, { 'content-type': 'application/json', ...cors });
      return res.end('{"error":"origen_error"}');
    }
    if (tipo === 'seg') {
      const h = { 'content-type': r.headers.get('content-type') || 'video/mp2t', 'cache-control': 'private, max-age=3600', ...cors };
      for (const k of ['content-length', 'content-range', 'accept-ranges']) if (r.headers.get(k)) h[k] = r.headers.get(k);
      res.writeHead(r.status, h);
      if (!r.body) return res.end();
      const flujo = Readable.fromWeb(r.body);
      flujo.on('error', () => res.destroy());
      return flujo.pipe(res);
    }
    const texto = await r.text();
    if (texto.length > (tipo === 'sub' ? MAX_SUB : MAX_LISTA)) {
      res.writeHead(502, { 'content-type': 'application/json', ...cors });
      return res.end('{"error":"muy_grande"}');
    }
    if (tipo === 'sub') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, max-age=3600', ...cors });
      return res.end(texto);
    }
    const final = r.url || destino; // tras redirecciones, las rutas relativas cuelgan de la dirección final
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', ...cors });
    return res.end(reescribirLista(texto, final, referer, prefijo, vence));
  }

  return { activo, catalogo, reproducir, proxy, idiomas, _: { firmar, firmaValida, urlFirmada, destinoPermitido, reescribirLista } };
}
