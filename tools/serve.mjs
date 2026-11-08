// Servidor local de desarrollo (sin dependencias). Sirve la raíz del repo.
// Uso: node tools/serve.mjs [puerto]
//   TV       → http://localhost:5173            (flechas = mando, Enter = OK, Esc = Back)
//   celular  → http://localhost:5173/mobile/
//   web      → http://localhost:5173/web/      (en un iPhone de la misma red: http://<ip-de-tu-compu>:5173/web/;
//                                               sin HTTPS el service worker no se registra, la app funciona igual)
//   tablero  → http://localhost:5173/design/
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadApiKey, configJsWithKey, configJsWithVersion } from './apikey.mjs';
import { imagenesJs, IMAGENES_JS } from './portadas.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
};
/* Nunca se sirven secretos ni la carpeta de git */
const BLOCKED = /(^|\/)(\.env|\.git|\.sign|secrets)(\/|$)|\.local\./;

createServer(async (req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  /* Solo desarrollo: guarda la biblioteca y sus imágenes para el tablero (design/media/<nombre>). */
  if (req.method === 'POST' && path.startsWith('/__media/')) {
    const name = path.slice('/__media/'.length).replace(/[^a-z0-9._-]/gi, '_');
    if (!/\.(jpg|json)$/i.test(name)) { res.writeHead(400).end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(join(root, 'design', 'media'), { recursive: true });
    await writeFile(join(root, 'design', 'media', name), Buffer.concat(chunks));
    res.writeHead(204).end();
    return;
  }
  if (BLOCKED.test(path)) { res.writeHead(404).end(); return; }
  if (path === '/' + IMAGENES_JS) {
    // Igual que en el .wgt: las listas de images/portadas/ e images/avatares/ se arman al vuelo.
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }).end(imagenesJs(root));
    return;
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file).catch(() => null);
    if (st && st.isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(301, { Location: `${path}/` }).end(); return; }
      file = join(file, 'index.html');
    }
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
}).listen(port, '0.0.0.0', () => {
  let key = null;
  try { key = loadApiKey(); } catch (e) { console.log('Clave de Telegram en .env con error: ' + e.message); }
  console.log(`HomeFlix en http://localhost:${port}  (web: /web/ · celular: /mobile/ · tablero: /design/)`);
  console.log(key ? 'Clave de Telegram: tomada del .env.' : 'Clave de Telegram: no hay .env; la app pedirá api_id y api_hash.');
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) console.log(`En otro dispositivo de la misma red → http://${n.address}:${port}/web/`);
  }
});
