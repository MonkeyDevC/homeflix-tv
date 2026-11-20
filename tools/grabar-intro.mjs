// Graba la intro de la TV (js/intro.js, nivel «tvx») como VIDEO en alta calidad: images/intro/intro.mp4 (un solo clip).
//
//   node tools/grabar-intro.mjs            graba el clip (1920×1080 a 60 cuadros por segundo, con sonido, 4,05 s)
//   node tools/grabar-intro.mjs --prueba   solo 20 cuadros de cada parte (para revisar rápido que todo funciona)
//
// Cómo: abre dev/intro-grabar.html en Chrome sin ventana, detiene TODAS las animaciones de la intro y las mueve cuadro a cuadro
// (así el resultado es exacto y no depende de la velocidad del PC), captura cada cuadro como PNG, genera el sonido fuera de línea con
// el mismo «ta-dum» de la intro y lo codifica con ffmpeg (H.264 High, AAC). Un solo clip: la entrada (0–3,15 s) seguida del acercamiento
// final (0,9 s). En la TV lo reproduce js/intro.js (si la app no está lista en el segundo 3,15 lo pausa ahí y lo reanuda cuando lo esté;
// la TV solo decodifica UN video a la vez, por eso no son dos clips).
// Necesita Chrome (C:\Program Files\Google\Chrome) y ffmpeg en el PATH.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const prueba = process.argv.includes('--prueba');
const FPS = 60;
const A_MS = 3150;
const B_MS = 900;
const nA = prueba ? 20 : Math.round((A_MS / 1000) * FPS);
const nB = prueba ? 20 : Math.round((B_MS / 1000) * FPS);
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'].find((p) => existsSync(p));
if (!chrome) throw new Error('No encontré Chrome.');
const work = join(tmpdir(), 'homeflix-intro-' + Date.now());
mkdirSync(work, { recursive: true });
const out = join(root, 'images', 'intro');
mkdirSync(out, { recursive: true });
const PORT = 9555;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, 'perfil')}`, '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1920,1080', '--allow-file-access-from-files', '--disable-gpu-vsync', '--disable-frame-rate-limit', 'about:blank'], { stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page'); } catch { /* aún no arranca */ }
  }
  if (!page) throw new Error('Chrome no abrió el puerto de depuración.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = {};
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params) => new Promise((r) => { id += 1; pend[id] = r; ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const frame2 = () => ev('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})');

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(join(root, 'dev', 'intro-grabar.html')).href });
  await sleep(1200);
  console.log('logo cargado:', await ev('__ready()'));
  console.log('animaciones detenidas:', await ev('__start()'));
  await sleep(300);

  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: false });
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  };

  /* clip A */
  for (let i = 0; i < nA; i++) {
    await ev(`__seekA(${(i * 1000) / FPS})`);
    await frame2();
    await shot(join(work, `a_${String(i).padStart(4, '0')}.png`));
    if (i % 30 === 0) console.log(`clip A: cuadro ${i}/${nA}`);
  }
  /* clip B: parte exactamente donde terminaría A (A_MS) */
  await ev(`__seekA(${A_MS})`);
  console.log('animaciones nuevas del acercamiento:', await ev('__beginB()'));
  for (let i = 0; i < nB; i++) {
    await ev(`__seekB(${(i * 1000) / FPS})`);
    await frame2();
    await shot(join(work, `a_${String(nA + i).padStart(4, '0')}.png`));
    if (i % 30 === 0) console.log(`clip B: cuadro ${i}/${nB}`);
  }
  /* sonido */
  const wav = await ev('__audio(4.4)');
  writeFileSync(join(work, 'audio.wav'), Buffer.from(wav, 'base64'));
  ws.close();
} finally {
  proc.kill();
}

const ff = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: work, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || r.error));
};
/* el sonido: todo el recorrido (entrada + cierre) */
ff(['-i', 'audio.wav', '-ss', '0', '-t', String((nA + nB) / FPS), 'audioA.wav']);
/* H.264 High nivel 4.2 (lo decodifica el chip de video de la TV), calidad muy alta (crf 11), un pelo de ruido para que los degradados
 * oscuros del resplandor no se vean con bandas, 4:2:0 de 8 bits. */
const enc = ['-c:v', 'libx264', '-preset', 'veryslow', '-crf', '13', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-g', '30', '-bf', '2',
  '-vf', 'noise=alls=1:allf=t,format=yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'];
ff(['-framerate', String(FPS), '-i', 'a_%04d.png', '-i', 'audioA.wav', ...enc, join(out, 'intro.mp4')]);
rmSync(work, { recursive: true, force: true });
console.log(`intro.mp4: ${(statSync(join(out, 'intro.mp4')).size / 1048576).toFixed(2)} MB`);
