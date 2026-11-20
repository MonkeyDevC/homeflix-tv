// Recomendaciones («Para ti», «Similares», búsqueda) — puerta al motor Python (recomendador/, contenedor «reco-api»,
// red privada «reco-interna», sin puerto público). Mismo criterio que el canal Anime: la app solo habla con este
// servidor; aquí se valida la llave y se le dice al motor QUIÉN es (cuenta = huella de la llave, perfil, kids) con
// el secreto compartido RECO_TOKEN. El motor nunca ve la llave ni confía en lo que diga la app.
//
// Público (con «Authorization: Bearer <llave>», bajo /productos/HomeFlix):
//   GET  /api/v1/reco/recomendaciones?perfil&limite&cursor   → «Para ti»
//   GET  /api/v1/reco/similares/<titleKey>?perfil&limite     → «Similares» de una ficha
//   POST /api/v1/reco/eventos   {perfil, eventos:[{id, tipo:'click'|'search', title_key?, consulta?, at}]}
//   GET  /api/v1/reco/perfil?perfil · GET /api/v1/reco/descubrir?perfil
//   POST /api/v1/reco/feedback  {perfil, title_key, accion} · POST /api/v1/reco/buscar {perfil, consulta, limite}
// Si el motor no está o tarda (3 s), los GET responden 200 con la lista vacía (la fila no aparece y nada se rompe) y
// los POST 503 (la app los reintenta luego).

const ESPERA = 3000;
const CACHE_MS = 60_000;
const CACHE_MAX = 5000;
const PERFIL_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_CUERPO = 64 * 1024;

const RUTAS = {
  'GET /recomendaciones': { motor: '/api/v1/recommendations/me', query: ['limite', 'cursor'] },
  'GET /perfil': { motor: '/api/v1/profiles/me', query: [] },
  'GET /descubrir': { motor: '/api/v1/discover', query: ['limite'] },
  'POST /eventos': { motor: '/api/v1/events', cuerpo: (b) => ({ eventos: Array.isArray(b.eventos) ? b.eventos.slice(0, 50) : [] }), invalida: true },
  'POST /feedback': { motor: '/api/v1/recommendations/feedback', cuerpo: (b) => ({ title_key: b.title_key, accion: b.accion, request_id: b.request_id }), invalida: true },
  'POST /buscar': { motor: '/api/v1/search/semantic', cuerpo: (b) => ({ consulta: b.consulta, limite: b.limite }) },
};

/** Perfil pedido y si es Kids, según el documento de la cuenta (lo que sincronizan las apps). null = no existe. */
export function perfilDe(doc, pedido) {
  const id = String(pedido || 'p1');
  if (!PERFIL_RE.test(id)) return null;
  const lista = (doc && doc.profiles && Array.isArray(doc.profiles.list)) ? doc.profiles.list : [];
  if (!lista.length) return id === 'p1' ? { id, kids: false } : null;
  const p = lista.find((x) => x && String(x.id) === id);
  return p ? { id, kids: !!p.kids } : null;
}

export function crearReco({ url = '', token = '', pedir = fetch, ahora = () => Date.now(), espera = ESPERA } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const activo = !!base && String(token || '').length >= 32;
  const cache = new Map();

  function invalidar(cuenta, perfil) {
    const prefijo = `${cuenta}|${perfil}|`;
    for (const k of cache.keys()) if (k.startsWith(prefijo)) cache.delete(k);
  }

  async function llamar(metodo, ruta, quien, cuerpo) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), espera);
    try {
      const r = await pedir(base + ruta, {
        method: metodo,
        signal: c.signal,
        headers: {
          'x-reco-token': token, 'x-reco-cuenta': quien.cuenta, 'x-reco-perfil': quien.perfil, 'x-reco-kids': quien.kids ? '1' : '0',
          ...(cuerpo ? { 'content-type': 'application/json' } : {}),
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      let json = null;
      try { json = await r.json(); } catch { json = null; }
      return { codigo: r.status, cuerpo: json };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Atiende una ruta pública ya autenticada. quien = {cuenta, doc}. Devuelve {codigo, cuerpo}.
   * search = URLSearchParams de la petición; leerCuerpo() = el JSON del POST.
   */
  async function atender(metodo, ruta, quien, search, leerCuerpo) {
    let clave = `${metodo} ${ruta}`;
    let ruteo = RUTAS[clave];
    let destino;
    const sim = /^\/similares\/(.+)$/.exec(ruta);
    if (metodo === 'GET' && sim) {
      let titulo;
      try { titulo = decodeURIComponent(sim[1]); } catch { return { codigo: 400, cuerpo: { error: 'titulo_invalido' } }; }
      if (!titulo || titulo.length > 300) return { codigo: 400, cuerpo: { error: 'titulo_invalido' } };
      ruteo = { query: ['limite', 'cursor'] };
      destino = '/api/v1/recommendations/me/similar/' + encodeURIComponent(titulo);
      clave = 'GET /similares';
    }
    if (!ruteo) return { codigo: 404, cuerpo: { error: 'no_encontrado' } };
    destino = destino || ruteo.motor;

    const cuerpoApp = metodo === 'POST' ? await leerCuerpo(MAX_CUERPO) : null;
    const perfil = perfilDe(quien.doc, metodo === 'POST' ? cuerpoApp && cuerpoApp.perfil : search.get('perfil'));
    if (!perfil) return { codigo: 400, cuerpo: { error: 'perfil_invalido' } };
    const yo = { cuenta: quien.cuenta, perfil: perfil.id, kids: perfil.kids };

    if (metodo === 'GET') {
      const q = new URLSearchParams();
      for (const k of ruteo.query) if (search.get(k)) q.set(k, String(search.get(k)).slice(0, 100));
      const ruta2 = destino + (q.size ? '?' + q : '');
      const k = `${yo.cuenta}|${yo.perfil}|${ruta2}`;
      const hit = cache.get(k);
      if (hit && ahora() - hit.at < CACHE_MS) return { codigo: 200, cuerpo: hit.cuerpo };
      if (!activo) return { codigo: 200, cuerpo: { recommendations: [], degradado: true } };
      try {
        const r = await llamar('GET', ruta2, yo);
        if (r.codigo === 200 && r.cuerpo) {
          if (cache.size > CACHE_MAX) cache.clear();
          cache.set(k, { at: ahora(), cuerpo: r.cuerpo });
        }
        if (r.codigo >= 500) return { codigo: 200, cuerpo: { recommendations: [], degradado: true } };
        return { codigo: r.codigo, cuerpo: r.cuerpo || {} };
      } catch {
        return { codigo: 200, cuerpo: { recommendations: [], degradado: true } };
      }
    }

    if (!activo) return { codigo: 503, cuerpo: { error: 'motor_apagado' } };
    try {
      const r = await llamar('POST', destino, yo, ruteo.cuerpo(cuerpoApp || {}));
      if (ruteo.invalida && r.codigo < 300) invalidar(yo.cuenta, yo.perfil);
      if (r.codigo >= 500) return { codigo: 503, cuerpo: { error: 'motor_no_responde' } };
      return { codigo: r.codigo, cuerpo: r.cuerpo || {} };
    } catch {
      return { codigo: 503, cuerpo: { error: 'motor_no_responde' } };
    }
  }

  return { atender, activo, invalidar, _cache: cache };
}
