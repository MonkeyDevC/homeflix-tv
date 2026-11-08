// Servidor local de desarrollo (sin dependencias). Sirve la raíz del repo.
// Uso: node tools/serve.mjs [puerto] [--https]
//   TV       → http://localhost:5173            (flechas = mando, Enter = OK, Esc = Back)
//   celular  → http://localhost:5173/mobile/
//   web      → http://localhost:5173/web/
//   tablero  → http://localhost:5173/design/
//
// IMPORTANTE: Telegram necesita WebCrypto, y el navegador solo lo da en una conexión segura: https, o http en
// localhost / 127.0.0.1. Por http con la IP (http://192.168.x.x:5173) sale «WebCrypto is not available».
// Para entrar desde OTRO dispositivo (celular, otro computador): node tools/serve.mjs --https
// (crea una vez un certificado propio en .cert/; el navegador avisa que no es de confianza: «Avanzado → continuar»).
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { loadApiKey, configJsWithKey, configJsWithVersion } from './apikey.mjs';
import { imagenesJs, IMAGENES_JS } from './portadas.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const https = args.includes('--https');
const port = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5173);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

/* Certificado propio para https en la red local (.cert/, fuera de git). Se rehace si cambió la IP. */
function devCertificate() {
  const dir = join(root, '.cert');
  const key = join(dir, 'dev.key');
  const crt = join(dir, 'dev.crt');
  const ips = lanAddresses();
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  const stamp = join(dir, 'san.txt');
  if (!existsSync(key) || !existsSync(crt) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== san) {
    mkdirSync(dir, { recursive: true });
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '825',
      '-subj', '/CN=HomeFlix (desarrollo)', '-addext', `subjectAltName=${san}`], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error('No pude crear el certificado con openssl (instálalo o usa un túnel https): ' + ((r.stderr || r.error || '') + '').trim().split('\n').pop());
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(stamp, san);
  }
  return { key: readFileSync(key), cert: readFileSync(crt) };
}


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

async function handle(req, res) {
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
}

const server = https ? createHttpsServer(devCertificate(), handle) : createServer(handle);
server.listen(port, '0.0.0.0', () => {
  const proto = https ? 'https' : 'http';
  let key = null;
  try { key = loadApiKey(); } catch (e) { console.log('Clave de Telegram en .env con error: ' + e.message); }
  console.log(`HomeFlix en ${proto}://localhost:${port}  (web: /web/ · celular: /mobile/ · tablero: /design/)`);
  console.log(key ? 'Clave de Telegram: tomada del .env.' : 'Clave de Telegram: no hay .env; la app pedirá api_id y api_hash.');
  if (https) {
    for (const ip of lanAddresses()) console.log(`En otro dispositivo de la misma red → https://${ip}:${port}/web/  (acepta el aviso del certificado)`);
  } else {
    console.log('Ábrelo con localhost en este equipo. Para entrar desde otro dispositivo: node tools/serve.mjs --https');
    console.log('(por http con la IP, Telegram no funciona: el navegador no da WebCrypto sin conexión segura)');
  }
});
