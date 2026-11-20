// Preparador de videos de HomeFlix: app con interfaz (se abre sola en el navegador).
// Uso: doble clic en «Preparar videos.cmd» (raíz del proyecto), o: node tools/preparador/server.mjs
// Solo escucha en este PC (127.0.0.1). Los botones «Elegir…» abren los diálogos normales de Windows.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, plan, caption, prepare, hasNvenc, safeName, limitBytes } from './prepare.mjs';
import { listVersions, makeImage, serveMedia } from './publish.mjs';
import { loadApiKey, configJsWithKey } from '../apikey.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5180);
const clients = new Set();
let job = null;          // trabajo en curso
let last = [];           // eventos del trabajo actual (para quien abra la página a mitad de camino)

function send(ev) {
  if (ev.type !== 'progress') last.push(ev);
  else last = last.filter((e) => !(e.type === 'progress' && e.index === ev.index)).concat(ev);
  const data = 'data: ' + JSON.stringify(ev) + '\n\n';
  clients.forEach((res) => res.write(data));
}

/* Diálogos de Windows (PowerShell en modo STA, con una ventana siempre encima para que no queden detrás del navegador). */
function psDialog(script) {
  const full = 'Add-Type -AssemblyName System.Windows.Forms;' +
    '$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; WindowState="Minimized"};' +
    '$o.Show(); $o.Hide();' + script;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', full], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').trim();
}
function q(s) {
  return "'" + String(s || '').replace(/'/g, "''") + "'";
}
function pickFile(start) {
  const dir = start && existsSync(start) ? (statSync(start).isDirectory() ? start : dirname(start)) : '';
  return psDialog('$d = New-Object System.Windows.Forms.OpenFileDialog;' +
    '$d.Title = "Elige la película o el capítulo (original en la mejor calidad)";' +
    '$d.Filter = "Videos|*.mkv;*.mp4;*.m4v;*.mov;*.avi;*.ts;*.m2ts;*.webm|Todos los archivos|*.*";' +
    (dir ? '$d.InitialDirectory = ' + q(dir) + ';' : '') +
    'if ($d.ShowDialog($o) -eq "OK") { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.FileName }');
}
function pickFolder(start) {
  return psDialog('$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
    '$d.Description = "Carpeta donde se guardarán las versiones";' +
    '$d.ShowNewFolderButton = $true;' +
    (start && existsSync(start) ? '$d.SelectedPath = ' + q(start) + ';' : '') +
    'if ($d.ShowDialog($o) -eq "OK") { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }');
}

function pickImage(start) {
  const dir = start && existsSync(start) ? (statSync(start).isDirectory() ? start : dirname(start)) : '';
  return psDialog('$d = New-Object System.Windows.Forms.OpenFileDialog;' +
    '$d.Title = "Elige la imagen";' +
    '$d.Filter = "Imágenes|*.jpg;*.jpeg;*.png;*.webp;*.bmp|Todos los archivos|*.*";' +
    (dir ? '$d.InitialDirectory = ' + q(dir) + ';' : '') +
    'if ($d.ShowDialog($o) -eq "OK") { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.FileName }');
}

function openInExplorer(path) {
  if (!path || !existsSync(path)) return;
  spawn('explorer.exe', statSync(path).isDirectory() ? [path] : ['/select,', path], { detached: true, stdio: 'ignore' }).unref();
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

function defaultOutDir(file) {
  return join(dirname(file), safeName(basename(file, extname(file))) + ' - HomeFlix');
}

const routes = {
  'GET /api/state': () => ({ busy: !!job, events: last, gpu: hasNvenc() }),
  'POST /api/pick-file': (b) => ({ path: pickFile(b.start) }),
  'POST /api/pick-folder': (b) => ({ path: pickFolder(b.start) }),
  'POST /api/probe': (b) => {
    const src = probe(b.path);
    return { src, outDir: defaultOutDir(src.file) };
  },
  'POST /api/plan': (b) => {
    const src = probe(b.file);
    return { plan: plan(src, b), caption: caption(b), limit: limitBytes(b.limitGb) };
  },
  'POST /api/start': (b) => {
    if (job) throw new Error('Ya hay un trabajo en curso.');
    last = [];
    const run = prepare(b, send);
    job = run.job;
    run.promise.then(() => { job = null; }, (e) => {
      job = null;
      send(e.cancelled ? { type: 'cancelled' } : { type: 'error', message: e.message });
    });
    return { ok: true };
  },
  'POST /api/cancel': () => {
    if (job) job.cancel();
    return { ok: true };
  },
  'POST /api/pick-image': (b) => ({ path: pickImage(b.start) }),
  'POST /api/versions': (b) => listVersions(b.dir),
  'POST /api/image': (b) => makeImage(b.path, b.kind, b.outDir),
  'POST /api/open': (b) => {
    openInExplorer(b.path);
    return { ok: true };
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(await readFile(join(here, 'ui.html')));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/logo.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(await readFile(join(here, '..', '..', 'images', 'panda-login.png')));
    return;
  }
  /* Motor de Telegram de la app (la subida la hace la página) y la lectura de comentarios de la app */
  const JS = { '/js/tg.bundle.js': 'tg.bundle.js', '/js/telegram.js': 'telegram.js', '/js/library.js': 'library.js', '/js/config.js': 'config.js' };
  if (req.method === 'GET' && JS[url.pathname]) {
    let code = await readFile(join(here, '..', '..', 'js', JS[url.pathname]), 'utf8');
    if (url.pathname === '/js/config.js') {
      let key = null;
      try { key = loadApiKey(); } catch { key = null; }
      code = configJsWithKey(code, key);
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(code);
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) {
    serveMedia(url.pathname.slice('/api/media/'.length), res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hola\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const fn = routes[req.method + ' ' + url.pathname];
  if (!fn) { res.writeHead(404).end(); return; }
  try {
    json(res, 200, await fn(req.method === 'POST' ? await body(req) : {}));
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Preparador de videos de HomeFlix: ${url}`);
  console.log('Deja esta ventana abierta mientras lo usas. Para cerrarlo: cierra esta ventana o pulsa Ctrl+C.');
  if (!process.env.NO_OPEN && !process.argv.includes('--no-open')) spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('El preparador ya estaba abierto: lo abro en el navegador.');
    spawn('cmd.exe', ['/c', 'start', '', `http://localhost:${PORT}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => process.exit(0), 500);
  } else {
    throw e;
  }
});
