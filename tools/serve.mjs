// Servidor de desarrollo sin dependencias. Sirve la raíz del repo.
// Uso: node tools/serve.mjs [puerto]   → http://localhost:5173/web/
// Para probar en un iPhone en la misma red: http://<ip-de-tu-compu>:5173/web/
// (sin HTTPS el service worker no se registra; la app funciona igual).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};
const BLOCKED = /(^|\/)(\.env|\.git|\.sign|secrets)(\/|$)|\.local\./;

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (BLOCKED.test(path)) { res.writeHead(404).end(); return; }
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(301, { Location: `${path}/` }).end(); return; }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`HomeFlix web → http://localhost:${port}/web/`);
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) console.log(`En tu iPhone (misma red) → http://${n.address}:${port}/web/`);
  }
});
