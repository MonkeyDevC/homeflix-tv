// HomeFlix · servidor. Sin framework: node:http.
//
// Público (por Caddy, en https://scalvache.shop/productos/HomeFlix):
//   GET  /productos/HomeFlix/api/v1/sync   → {version, doc, at}             (404 si la cuenta aún no existe)
//   PUT  /productos/HomeFlix/api/v1/sync   {version, doc, cuenta, dispositivo} → {version}   (409 + lo de aquí si otro
//                                           dispositivo guardó antes: la app combina y vuelve a intentar)
//   La cuenta se identifica con «Authorization: Bearer <llave>» (la llave vive en los Mensajes guardados de Telegram).
//   «Ver en la TV» (src/remoto.js), con la misma llave:
//   GET  …/api/v1/remoto/escuchar       flujo de eventos (SSE) con los mensajes para este dispositivo
//   GET  …/api/v1/remoto/dispositivos   {dispositivos: [{id, tipo, nombre, plataforma, interfaz, canal, navegador, app, modelo, desde}]} conectados ahora (menos este)
//   POST …/api/v1/remoto/enviar {a, msg} → {entregado}   (404 si ese dispositivo ya no está conectado)
//   Actualizaciones (src/versiones.js), sin llave: GET …/actualizaciones/v1 y GET …/actualizaciones/archivos/<v>/<archivo>
//   El dispositivo va en x-homeflix-dispositivo / x-homeflix-tipo / x-homeflix-nombre (este con encodeURIComponent) y el resto de su
//   identidad (plataforma, interfaz, canal, navegador, app, modelo) en x-homeflix-info: JSON con encodeURIComponent. Ver base.js.
//
//   Recomendaciones (src/reco.js), con la misma llave: …/api/v1/reco/{recomendaciones, similares/<titleKey>, eventos, perfil,
//   descubrir, feedback, buscar} → el motor Python (contenedor «reco-api», red privada «reco-interna»).
//
// Interno (solo por la red privada «scalvache-interna», nunca por Caddy), para la consola de scalvache.shop:
//   /interno/v1/resumen · /interno/v1/cuentas · /interno/v1/cuentas/<id> · POST /interno/v1/cuentas/<id>/bloqueo
//   con «x-homeflix-admin: <ADMIN_TOKEN>». Sin token configurado, no existe.
// Para el motor de recomendaciones (red «reco-interna»), con «x-reco-token: <RECO_TOKEN>»:
//   GET /interno/v1/reco/docs?desde=<ms>&limite=<n>   documentos de sync que cambiaron (vistas y Mi lista → eventos)
//   GET /interno/v1/reco/cuenta-por-tg/<tg_id>        qué cuenta usa ese Telegram (para el bot de voz)
import { timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { abrir, huella, llaveValida, leer, guardar, visto, resumenCuenta, normalizarDispositivo } from './base.js';
import { crearRemoto } from './remoto.js';
import { crearVersiones } from './versiones.js';
import { crearAnime } from './anime.js';
import { crearReco } from './reco.js';

export const PREFIJO = '/productos/HomeFlix';
const MAX_CUERPO = 4 * 1024 * 1024; // el documento de una cuenta con mucho progreso pesa unos cientos de KB

export function crearApp({ dataDir, adminToken = '', versionsDir = '', ahora = () => Date.now(), animeUrl = '', animeClave = '', animeSecreto = '', animeRastreo = false, animeEspera = 20_000, animePedir, recoUrl = '', recoToken = '', recoPedir }) {
  const db = abrir(dataDir);
  const limite = limitador(240, 60_000); // pedidos por minuto por IP
  const limiteAnime = limitador(3000, 60_000); // los pedazos de video (/anime/p/) son muchos: tienen su propio tope
  const remoto = crearRemoto({ ahora });
  const versiones = crearVersiones({ dir: versionsDir });
  const reco = crearReco({ url: recoUrl, token: recoToken, ahora, ...(recoPedir ? { pedir: recoPedir } : {}) });
  const anime = crearAnime({ url: animeUrl, clave: animeClave, secreto: animeSecreto, dir: dataDir, rastreo: animeRastreo, esperaEspanol: animeEspera, ahora, ...(animePedir ? { pedir: animePedir } : {}) });

  function responder(res, codigo, cuerpo, extra = {}) {
    const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
    const encabezados = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    };
    /* el catálogo de anime pesa cientos de KB: comprimido baja a una sexta parte (la TV tarda menos en bajarlo y leerlo) */
    if (texto.length > 4096 && /\bgzip\b/.test(String((res.req && res.req.headers['accept-encoding']) || ''))) {
      encabezados['content-encoding'] = 'gzip';
      encabezados.vary = 'accept-encoding';
      res.writeHead(codigo, encabezados);
      res.end(gzipSync(texto));
      return;
    }
    res.writeHead(codigo, encabezados);
    res.end(texto);
  }

  /* Las apps se abren desde orígenes distintos (la TV, el APK, la web, localhost): la API no usa cookies,
   * solo la llave en la cabecera, así que puede aceptar cualquier origen. */
  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, range, x-homeflix-dispositivo, x-homeflix-tipo, x-homeflix-nombre, x-homeflix-info',
    'access-control-expose-headers': 'content-length, content-range',
    'access-control-max-age': '86400',
  };

  async function cuerpoJson(req, max = MAX_CUERPO) {
    let n = 0;
    const partes = [];
    for await (const c of req) {
      n += c.length;
      if (n > max) throw Object.assign(new Error('muy_grande'), { codigo: 413 });
      partes.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('json_invalido'), { codigo: 400 });
    }
  }

  function llaveDe(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    return m && llaveValida(m[1]) ? m[1] : null;
  }

  function iguales(dado, esperado) {
    const a = Buffer.from(String(dado || ''));
    const b = Buffer.from(String(esperado || ''));
    return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
  }
  const esReco = (req) => iguales(req.headers['x-reco-token'], recoToken);

  function esAdmin(req) {
    if (!adminToken) return false;
    const a = Buffer.from(String(req.headers['x-homeflix-admin'] || ''));
    const b = Buffer.from(adminToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function publico(req, res, ruta) {
    if (req.method === 'OPTIONS') return responder(res, 204, undefined, CORS);
    if (ruta === '' || ruta === '/') return responder(res, 200, { app: 'homeflix', ok: true }, CORS);
    if (ruta.startsWith('/api/v1/remoto/')) return enRemoto(req, res, ruta.slice('/api/v1/remoto'.length));
    if (ruta.startsWith('/api/v1/anime/')) return enAnime(req, res, ruta.slice('/api/v1/anime'.length));
    if (ruta.startsWith('/api/v1/reco/')) return enReco(req, res, ruta.slice('/api/v1/reco'.length));
    if (ruta.startsWith('/anime/p/')) {
      if (req.method !== 'GET') return responder(res, 405, { error: 'metodo' }, CORS);
      return anime.proxy(req, res, ruta.slice('/anime/p'.length), new URL(req.url, 'http://x').searchParams, PREFIJO, CORS);
    }
    if (ruta.startsWith('/actualizaciones/') && versiones.atender(req, res, ruta, CORS)) return undefined;
    if (ruta !== '/api/v1/sync') return responder(res, 404, { error: 'no_encontrado' }, CORS);
    const llave = llaveDe(req);
    if (!llave) return responder(res, 401, { error: 'sin_llave' }, CORS);
    const id = huella(llave);
    if (req.method === 'GET') {
      const fila = leer(db, id);
      if (!fila) return responder(res, 404, { error: 'sin_cuenta' }, CORS);
      if (fila.bloqueada) return responder(res, 403, { error: 'bloqueada' }, CORS);
      visto(db, id, dispositivoDe(req), ahora());
      return responder(res, 200, { version: fila.version, doc: JSON.parse(fila.doc), at: fila.vista }, CORS);
    }
    if (req.method === 'PUT') {
      const b = await cuerpoJson(req);
      if (!b || typeof b.doc !== 'object' || b.doc === null || b.doc.app !== 'homeflix') return responder(res, 400, { error: 'documento_invalido' }, CORS);
      const r = guardar(db, id, b, ahora());
      if (r.bloqueada) return responder(res, 403, { error: 'bloqueada' }, CORS);
      if (r.conflicto) return responder(res, 409, { error: 'conflicto', version: r.version, doc: r.doc }, CORS);
      return responder(res, 200, { version: r.version }, CORS);
    }
    return responder(res, 405, { error: 'metodo' }, CORS);
  }

  /* Quién llama: id, tipo y nombre en cabeceras sueltas (las apps viejas solo mandan esas) y el resto de su identidad (plataforma, interfaz,
   * canal, navegador, versión, modelo) en x-homeflix-info: un JSON con encodeURIComponent. */
  function dispositivoDe(req) {
    let nombre = String(req.headers['x-homeflix-nombre'] || '');
    try { nombre = decodeURIComponent(nombre); } catch { /* tal cual */ }
    let info = {};
    try {
      const t = String(req.headers['x-homeflix-info'] || new URL(req.url, 'http://x').searchParams.get('i') || '');
      if (t && t.length <= 1200) info = JSON.parse(t.startsWith('{') ? t : decodeURIComponent(t)) || {};
    } catch { info = {}; }
    return normalizarDispositivo({
      ...(typeof info === 'object' ? info : {}),
      id: String(req.headers['x-homeflix-dispositivo'] || ''),
      tipo: String(req.headers['x-homeflix-tipo'] || (info && info.tipo) || ''),
      nombre: nombre || (info && info.nombre) || '',
    });
  }

  /* «Ver en la TV»: solo para cuentas que ya existen (la app sincronizó al menos una vez) y no están bloqueadas. */
  async function enRemoto(req, res, ruta) {
    const llave = llaveDe(req);
    if (!llave) return responder(res, 401, { error: 'sin_llave' }, CORS);
    const id = huella(llave);
    const fila = leer(db, id);
    if (!fila) return responder(res, 404, { error: 'sin_cuenta' }, CORS);
    if (fila.bloqueada) return responder(res, 403, { error: 'bloqueada' }, CORS);
    const yo = dispositivoDe(req);
    if (req.method === 'GET' && ruta === '/escuchar') {
      visto(db, id, yo, ahora()); // queda anotado en la cuenta aunque este equipo nunca guarde datos (p. ej. una TV que solo mira)
      return remoto.escuchar(id, yo, req, res, CORS);
    }
    if (req.method === 'GET' && ruta === '/dispositivos') return responder(res, 200, { dispositivos: remoto.dispositivos(id, yo.id) }, CORS);
    if (req.method === 'POST' && ruta === '/enviar') {
      const b = await cuerpoJson(req, remoto.MAX_MSG);
      if (!b || typeof b.a !== 'string' || !b.a || typeof b.msg !== 'object' || b.msg === null) return responder(res, 400, { error: 'mensaje_invalido' }, CORS);
      const n = remoto.enviar(id, yo.id, b.a, b.msg);
      if (!n && b.a !== '*') return responder(res, 404, { error: 'no_conectado' }, CORS);
      return responder(res, 200, { entregado: n }, CORS);
    }
    return responder(res, 404, { error: 'no_encontrado' }, CORS);
  }

  /* Canal «Anime» (src/anime.js): solo cuentas que ya existen y no están bloqueadas. */
  async function enAnime(req, res, ruta) {
    const llave = llaveDe(req);
    if (!llave) return responder(res, 401, { error: 'sin_llave' }, CORS);
    const fila = leer(db, huella(llave));
    if (!fila) return responder(res, 404, { error: 'sin_cuenta' }, CORS);
    if (fila.bloqueada) return responder(res, 403, { error: 'bloqueada' }, CORS);
    if (req.method !== 'GET') return responder(res, 405, { error: 'metodo' }, CORS);
    const search = new URL(req.url, 'http://x').searchParams;
    const r = ruta === '/reproducir' ? await anime.reproducir(search, PREFIJO) : await anime.catalogo(ruta, search);
    return responder(res, r.codigo, r.cuerpo, CORS);
  }

  /* Recomendaciones (src/reco.js): solo cuentas que ya existen y no están bloqueadas; el perfil tiene que ser de la cuenta. */
  async function enReco(req, res, ruta) {
    const llave = llaveDe(req);
    if (!llave) return responder(res, 401, { error: 'sin_llave' }, CORS);
    const id = huella(llave);
    const fila = leer(db, id);
    if (!fila) return responder(res, 404, { error: 'sin_cuenta' }, CORS);
    if (fila.bloqueada) return responder(res, 403, { error: 'bloqueada' }, CORS);
    if (req.method !== 'GET' && req.method !== 'POST') return responder(res, 405, { error: 'metodo' }, CORS);
    let doc = {};
    try { doc = JSON.parse(fila.doc); } catch { doc = {}; }
    const r = await reco.atender(req.method, ruta, { cuenta: id, doc }, new URL(req.url, 'http://x').searchParams, (max) => cuerpoJson(req, max));
    return responder(res, r.codigo, r.cuerpo, CORS);
  }

  /* Lo que el motor de recomendaciones lee de aquí (red interna, x-reco-token). */
  function internoReco(req, res, ruta) {
    const perfilesDe = (doc, conNombre) => {
      const lista = (doc && doc.profiles && Array.isArray(doc.profiles.list)) ? doc.profiles.list : [];
      return lista.filter((p) => p && p.id).map((p) => (conNombre ? { id: String(p.id), name: String(p.name || ''), kids: !!p.kids } : { id: String(p.id), kids: !!p.kids }));
    };
    const docDe = (f) => { try { return JSON.parse(f.doc); } catch { return {}; } };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && ruta === '/docs') {
      const desde = Math.max(0, Number(url.searchParams.get('desde')) || 0);
      const limiteN = Math.min(200, Math.max(1, Number(url.searchParams.get('limite')) || 100));
      const filas = db.prepare('SELECT id, tg_id, doc_at, doc FROM cuentas WHERE doc_at > ? AND bloqueada = 0 ORDER BY doc_at ASC LIMIT ?').all(desde, limiteN);
      const cuentas = filas.map((f) => { const doc = docDe(f); return { cuenta: f.id, tg_id: f.tg_id, vista: f.doc_at, perfiles: perfilesDe(doc), doc }; });
      return responder(res, 200, { cuentas, siguiente: filas.length === limiteN ? filas[filas.length - 1].doc_at : null });
    }
    const m = /^\/cuenta-por-tg\/(\d{1,20})$/.exec(ruta);
    if (req.method === 'GET' && m) {
      /* tg_id lo informa la app al sincronizar: si varias cuentas dicen ser del mismo Telegram, vale la más antigua */
      const f = db.prepare('SELECT id, tg_id, doc, bloqueada FROM cuentas WHERE tg_id = ? ORDER BY creada ASC LIMIT 1').get(m[1]);
      if (!f) return responder(res, 404, { error: 'no_encontrado' });
      return responder(res, 200, { cuenta: f.id, perfiles: perfilesDe(docDe(f), true), bloqueada: !!f.bloqueada });
    }
    return responder(res, 404, { error: 'no_encontrado' });
  }

  async function interno(req, res, ruta) {
    if (ruta.startsWith('/reco/') && esReco(req)) return internoReco(req, res, ruta.slice('/reco'.length));
    if (!esAdmin(req)) return responder(res, 404, { error: 'no_encontrado' });
    const dispositivosDe = (id) => db.prepare('SELECT * FROM dispositivos WHERE cuenta = ? ORDER BY vista DESC').all(id);
    if (req.method === 'GET' && ruta === '/resumen') {
      const dia = ahora() - 86_400_000;
      const c = (sql, ...p) => db.prepare(sql).get(...p).n;
      return responder(res, 200, {
        cuentas: c('SELECT COUNT(*) AS n FROM cuentas'),
        activasHoy: c('SELECT COUNT(*) AS n FROM cuentas WHERE vista >= ?', dia),
        dispositivos: c('SELECT COUNT(*) AS n FROM dispositivos'),
        porTipo: db.prepare('SELECT tipo, COUNT(*) AS n FROM dispositivos GROUP BY tipo').all(),
        porPlataforma: db.prepare("SELECT plataforma, COUNT(*) AS n FROM dispositivos WHERE plataforma <> '' GROUP BY plataforma").all(),
        porVersion: db.prepare("SELECT app, COUNT(*) AS n FROM dispositivos WHERE app <> '' GROUP BY app ORDER BY n DESC LIMIT 20").all(),
        conectadosAhora: remoto.conectados(),
      });
    }
    if (req.method === 'GET' && ruta === '/cuentas') {
      const filas = db.prepare('SELECT * FROM cuentas ORDER BY vista DESC LIMIT 500').all();
      return responder(res, 200, { cuentas: filas.map((f) => resumenCuenta(f, dispositivosDe(f.id))) });
    }
    let m = /^\/cuentas\/([0-9a-f]{64})$/.exec(ruta);
    if (req.method === 'GET' && m) {
      const fila = leer(db, m[1]);
      if (!fila) return responder(res, 404, { error: 'no_encontrado' });
      return responder(res, 200, { ...resumenCuenta(fila, dispositivosDe(fila.id)), doc: JSON.parse(fila.doc) });
    }
    m = /^\/cuentas\/([0-9a-f]{64})\/bloqueo$/.exec(ruta);
    if (req.method === 'POST' && m) {
      const b = await cuerpoJson(req);
      const r = db.prepare('UPDATE cuentas SET bloqueada = ? WHERE id = ?').run(b.bloqueada ? 1 : 0, m[1]);
      return responder(res, r.changes ? 200 : 404, r.changes ? { ok: true } : { error: 'no_encontrado' });
    }
    return responder(res, 404, { error: 'no_encontrado' });
  }

  async function manejar(req, res) {
    const ruta = new URL(req.url, 'http://x').pathname;
    try {
      if (ruta === '/healthz') {
        db.prepare('SELECT 1').get();
        return responder(res, 200, { ok: true });
      }
      if (ruta.startsWith('/interno/v1/')) return await interno(req, res, ruta.slice('/interno/v1'.length));
      if (ruta === PREFIJO || ruta.startsWith(PREFIJO + '/')) {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const esVideo = ruta.startsWith(PREFIJO + '/anime/p/');
        if (!(esVideo ? limiteAnime(ip) : limite(ip))) return responder(res, 429, { error: 'demasiados_pedidos' }, CORS);
        return await publico(req, res, ruta.slice(PREFIJO.length));
      }
      return responder(res, 404, { error: 'no_encontrado' });
    } catch (e) {
      if (e && e.codigo) return responder(res, e.codigo, { error: e.message }, CORS);
      console.error('homeflix', e);
      return responder(res, 500, { error: 'interno' }, CORS);
    }
  }

  return { manejar, db, anime, reco };
}

/* Límite sencillo por IP (ventana deslizante en memoria). */
function limitador(max, ventana) {
  const vistos = new Map();
  return (ip) => {
    const ahora = Date.now();
    const lista = (vistos.get(ip) || []).filter((t) => ahora - t < ventana);
    lista.push(ahora);
    vistos.set(ip, lista);
    if (vistos.size > 5000) vistos.clear();
    return lista.length <= max;
  };
}
