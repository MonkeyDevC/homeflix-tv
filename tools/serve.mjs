// Servidor local para ver HomeFlix en el navegador mientras se diseña.
// Uso: node tools/serve.mjs [puerto]   → http://localhost:5173
// En el navegador: flechas = mando, Enter = OK, Esc = Back.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiKey, configJsWithKey, configJsWithVersion } from './apikey.mjs';
import { portadasJs } from './portadas.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  /* Solo desarrollo: guarda el HTML de una pantalla en design/snapshots/<nombre>.html (tablero de diseño). */
  if (req.method === 'POST' && path.startsWith('/__snapshot/')) {
    const name = path.slice('/__snapshot/'.length).replace(/[^a-z0-9-]/gi, '');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(join(root, 'design', 'snapshots'), { recursive: true });
    await writeFile(join(root, 'design', 'snapshots', name + '.html'), Buffer.concat(chunks));
    res.writeHead(204).end();
    return;
  }
  if (path === '/js/portadas.js') {
    // Igual que en el .wgt: la lista de images/portadas/ se arma al vuelo.
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(portadasJs(root));
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('no es archivo');
    let body = await readFile(file);
    if (path === '/js/config.js') {
      // Igual que en el .wgt: la clave del .env va ofuscada en config.js (se relee en cada carga).
      body = Buffer.from(configJsWithVersion(configJsWithKey(body.toString('utf8'), loadApiKey()), await readFile(join(root, 'config.xml'), 'utf8')), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado: ' + path);
  }
}).listen(port, () => {
  let key = null;
  try { key = loadApiKey(); } catch (e) { console.log('Clave de Telegram en .env con error: ' + e.message); }
  console.log(`HomeFlix en http://localhost:${port}`);
  console.log(key ? 'Clave de Telegram: tomada del .env (directo al QR).' : 'Clave de Telegram: no hay .env; la app pedirá api_id y api_hash.');
});
