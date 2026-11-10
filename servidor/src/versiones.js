// HomeFlix · canal de actualizaciones (TV, celular y preparador).
//
// Las versiones viven en VERSIONS_DIR (en el VPS: ~/homeflix-servidor/versiones, montada de solo lectura en
// /versiones). La sube tools/publicar-version.mjs por scp:
//   versiones/actual.json             la versión vigente (lo que preguntan las apps)
//   versiones/<versión>/<archivo>     sus archivos: interfaz (web-<v>.json), .wgt, .apk y preparador-<v>.zip
//
// Público (sin llave: no hay nada privado):
//   GET …/actualizaciones/v1                       → actual.json  (404 si todavía no se publicó ninguna)
//   GET …/actualizaciones/archivos/<v>/<archivo>   → el archivo (se guarda en caché para siempre: cada versión es fija)
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TIPOS = {
  '.json': 'application/json; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
  '.wgt': 'application/widget',
  '.zip': 'application/zip',
};
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export function crearVersiones({ dir }) {
  function actual() {
    const f = join(dir, 'actual.json');
    if (!dir || !existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  }

  /* Devuelve true si atendió el pedido. */
  function atender(req, res, ruta, cors) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (ruta === '/actualizaciones/v1') {
      const v = actual();
      res.writeHead(v ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify(v || { error: 'sin_versiones' }));
      return true;
    }
    const m = /^\/actualizaciones\/archivos\/([^/]+)\/([^/]+)$/.exec(ruta);
    if (!m) return false;
    const [, ver, nombre] = m;
    const file = join(dir || '', ver, nombre);
    if (!dir || !NOMBRE.test(ver) || !NOMBRE.test(nombre) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', ...cors });
      res.end(JSON.stringify({ error: 'no_encontrado' }));
      return true;
    }
    const ext = (/\.[a-z0-9]+$/i.exec(nombre) || [''])[0].toLowerCase();
    res.writeHead(200, {
      'content-type': TIPOS[ext] || 'application/octet-stream',
      'content-length': statSync(file).size,
      'content-disposition': `attachment; filename="${nombre}"`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      ...cors,
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    const s = createReadStream(file);
    res.on('close', () => s.destroy());
    s.on('error', () => res.destroy());
    s.pipe(res);
    return true;
  }

  return { atender, actual };
}
