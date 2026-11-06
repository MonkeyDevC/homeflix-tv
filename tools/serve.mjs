// Servidor local para ver HomeFlix en el navegador mientras se diseña.
// Uso: node tools/serve.mjs [puerto]   → http://localhost:5173
// En el navegador: flechas = mando, Enter = OK, Esc = Back.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiKey, configJsWithKey } from './apikey.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('no es archivo');
    let body = await readFile(file);
    if (path === '/js/config.js') {
      // Igual que en el .wgt: la clave del .env va ofuscada en config.js (se relee en cada carga).
      body = Buffer.from(configJsWithKey(body.toString('utf8'), loadApiKey()), 'utf8');
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
