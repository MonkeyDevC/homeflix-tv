// HomeFlix · servidor. Sin framework: node:http.
//
// Público (por Caddy, en https://scalvache.shop/productos/HomeFlix):
//   GET  /productos/HomeFlix/api/v1/sync   → {version, doc, at}             (404 si la cuenta aún no existe)
//   PUT  /productos/HomeFlix/api/v1/sync   {version, doc, cuenta, dispositivo} → {version}   (409 + lo de aquí si otro
//                                           dispositivo guardó antes: la app combina y vuelve a intentar)
//   La cuenta se identifica con «Authorization: Bearer <llave>» (la llave vive en los Mensajes guardados de Telegram).
//   «Ver en la TV» (src/remoto.js), con la misma llave:
//   GET  …/api/v1/remoto/escuchar       flujo de eventos (SSE) con los mensajes para este dispositivo
//   GET  …/api/v1/remoto/dispositivos   {dispositivos: [{id, tipo, nombre, desde}]} conectados ahora (menos este)
//   POST …/api/v1/remoto/enviar {a, msg} → {entregado}   (404 si ese dispositivo ya no está conectado)
//   Actualizaciones (src/versiones.js), sin llave: GET …/actualizaciones/v1 y GET …/actualizaciones/archivos/<v>/<archivo>
//   El dispositivo va en x-homeflix-dispositivo / x-homeflix-tipo / x-homeflix-nombre (este con encodeURIComponent).
//
// Interno (solo por la red privada «scalvache-interna», nunca por Caddy), para la consola de scalvache.shop:
//   /interno/v1/resumen · /interno/v1/cuentas · /interno/v1/cuentas/<id> · POST /interno/v1/cuentas/<id>/bloqueo
//   con «x-homeflix-admin: <ADMIN_TOKEN>». Sin token configurado, no existe.
import { timingSafeEqual } from 'node:crypto';
import { abrir, huella, llaveValida, leer, guardar, visto, resumenCuenta } from './base.js';
import { crearRemoto } from './remoto.js';
import { crearVersiones } from './versiones.js';

export const PREFIJO = '/productos/HomeFlix';
const MAX_CUERPO = 4 * 1024 * 1024; // el documento de una cuenta con mucho progreso pesa unos cientos de KB

export function crearApp({ dataDir, adminToken = '', versionsDir = '', ahora = () => Date.now() }) {
  const db = abrir(dataDir);
  const limite = limitador(240, 60_000); // pedidos por minuto por IP
  const remoto = crearRemoto({ ahora });
  const versiones = crearVersiones({ dir: versionsDir });

  function responder(res, codigo, cuerpo, extra = {}) {
    const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
    res.writeHead(codigo, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    });
    res.end(texto);
  }

  /* Las apps se abren desde orígenes distintos (la TV, el APK, la web, localhost): la API no usa cookies,
   * solo la llave en la cabecera, así que puede aceptar cualquier origen. */
  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-homeflix-dispositivo, x-homeflix-tipo, x-homeflix-nombre',
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
    if (ruta.startsWith('/actualizaciones/') && versiones.atender(req, res, ruta, CORS)) return undefined;
    if (ruta !== '/api/v1/sync') return responder(res, 404, { error: 'no_encontrado' }, CORS);
    const llave = llaveDe(req);
    if (!llave) return responder(res, 401, { error: 'sin_llave' }, CORS);
    const id = huella(llave);
    if (req.method === 'GET') {
      const fila = leer(db, id);
      if (!fila) return responder(res, 404, { error: 'sin_cuenta' }, CORS);
      if (fila.bloqueada) return responder(res, 403, { error: 'bloqueada' }, CORS);
      visto(db, id, { id: req.headers['x-homeflix-dispositivo'] || '' }, ahora());
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

  function dispositivoDe(req) {
    let nombre = String(req.headers['x-homeflix-nombre'] || '');
    try { nombre = decodeURIComponent(nombre); } catch { /* tal cual */ }
    return { id: String(req.headers['x-homeflix-dispositivo'] || ''), tipo: String(req.headers['x-homeflix-tipo'] || ''), nombre };
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
    if (req.method === 'GET' && ruta === '/escuchar') return remoto.escuchar(id, yo, req, res, CORS);
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

  async function interno(req, res, ruta) {
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
        if (!limite(ip)) return responder(res, 429, { error: 'demasiados_pedidos' }, CORS);
        return await publico(req, res, ruta.slice(PREFIJO.length));
      }
      return responder(res, 404, { error: 'no_encontrado' });
    } catch (e) {
      if (e && e.codigo) return responder(res, e.codigo, { error: e.message }, CORS);
      console.error('homeflix', e);
      return responder(res, 500, { error: 'interno' }, CORS);
    }
  }

  return { manejar, db };
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
