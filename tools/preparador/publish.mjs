// Preparador · publicar en Telegram (lado del PC).
// La subida la hace la página (motor de Telegram de la app, js/tg.bundle.js); aquí solo se listan las versiones
// de una carpeta, se arman portada y banner con la medida justa y se entregan los archivos a la página.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, createReadStream, writeFileSync, unlinkSync, renameSync, rmdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { join, basename, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';

/* Solo se entregan archivos que pasaron por aquí (versiones listadas o imágenes armadas): nada más del disco. */
const media = new Map();
let nextId = 1;
function register(path, type) {
  for (const [id, m] of media) if (m.path === path) return id;
  const id = String(nextId++);
  media.set(id, { path, type });
  return id;
}

/* La ruta en el disco de un archivo que la página conoce por su id */
export function mediaPath(id) {
  const m = media.get(String(id));
  return m ? m.path : '';
}

export function serveMedia(id, res) {
  const m = media.get(String(id));
  if (!m || !existsSync(m.path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': m.type, 'Content-Length': statSync(m.path).size, 'Cache-Control': 'no-store' });
  const stream = createReadStream(m.path);
  /* si la página corta la descarga (detener, recargar), el archivo se suelta: en Windows uno abierto no se puede reemplazar */
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const VIDEO_EXT = /\.(mp4|m4v|mkv|mov|webm)$/i;
const PART = /\b(?:parte|part|pt)\s*(\d+)\s*(?:de|of|\/)\s*(\d+)\b/i;

function ffprobe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout); } catch { return {}; }
}

function thumbFor(file, duration, dir) {
  const out = join(dir, basename(file, extname(file)) + '.thumb.jpg');
  if (!existsSync(out)) {
    const at = Math.max(1, Math.min(600, Math.round(duration * 0.15)));
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out], { windowsHide: true });
  }
  return existsSync(out) ? out : '';
}

/* Las versiones de una carpeta del preparador: «Nombre [1080p] parte 1 de 2.mp4», «Nombre [360p].mp4»… */
export function listVersions(dir) {
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('No existe la carpeta: ' + dir);
  const thumbs = join(tmpdir(), 'homeflix-preparador', 'miniaturas');
  mkdirSync(thumbs, { recursive: true });
  const files = readdirSync(dir).filter((f) => VIDEO_EXT.test(f) && !/\.tmp\./i.test(f)).map((f) => {
    const path = join(dir, f);
    const info = ffprobe(path);
    const s = (info.streams && info.streams[0]) || {};
    const duration = Math.round(Number(info.format && info.format.duration) || 0);
    const width = s.width || 0;
    const height = s.height || 0;
    const q = /\[(\d{3,4})p\]/i.exec(f);
    const rung = q ? Number(q[1]) : Math.max(height, Math.round((width * 9) / 16));
    const part = PART.exec(f);
    const thumb = thumbFor(path, duration, thumbs);
    return {
      id: register(path, /\.mkv$/i.test(f) ? 'video/x-matroska' : 'video/mp4'),
      name: f, size: statSync(path).size, duration, width, height, rung,
      part: part ? Number(part[1]) : 0, parts: part ? Number(part[2]) : 0,
      thumb: thumb ? register(thumb, 'image/jpeg') : '',
      mime: /\.mkv$/i.test(f) ? 'video/x-matroska' : 'video/mp4',
    };
  });
  files.sort((a, b) => a.rung - b.rung || a.part - b.part || a.name.localeCompare(b.name));
  const images = {};
  for (const kind of ['portada', 'banner']) {
    const p = join(dir, kind + '.jpg');
    if (existsSync(p)) images[kind] = imageInfo(p);
  }
  return { dir, files, images, subs: subsIn(dir), caption: savedCaption(dir), thumbs: thumbsInfo(dir) };
}

/* Subtítulos aparte de la carpeta: «Nombre (2015).eng.srt», «….spa.forzados.srt», «….eng.2.srt» (los deja prepare) */
export function subLangOf(name) {
  const m = /\.([a-z]{2,3})(\.forzados)?(?:\.(\d+))?\.(srt|vtt|ass|ssa)$/i.exec(name);
  const iso = { es: 'spa', esp: 'spa', lat: 'spa', en: 'eng', pt: 'por', fr: 'fre', fra: 'fre', it: 'ita', de: 'ger', deu: 'ger', ja: 'jpn' };
  if (!m) return { lang: 'und', forced: /forzad|forced/i.test(name), n: 1 };
  const c = m[1].toLowerCase();
  return { lang: iso[c] || c, forced: !!m[2], n: Number(m[3] || 1) };
}
function subsIn(dir) {
  return readdirSync(dir).filter((f) => /\.(srt|vtt|ass|ssa)$/i.test(f)).map((f) => {
    const path = join(dir, f);
    return { id: register(path, 'text/plain; charset=utf-8'), name: f, size: statSync(path).size, ...subLangOf(f) };
  }).sort((a, b) => (a.lang === 'spa' ? 0 : 1) - (b.lang === 'spa' ? 0 : 1) || a.lang.localeCompare(b.lang) || a.forced - b.forced || a.n - b.n);
}

/* ----- Miniaturas para «Recortar» del celular -----
 * Un cuadro cada THUMB.every segundos, de THUMB.w×THUMB.h, en hojas de cols×rows (JPG) dentro de «miniaturas/» de la
 * carpeta. Se publican como archivos (sin que Telegram las comprima) con el nombre
 * «Nombre (año) miniaturas 10s 160x90 10x10 hoja 1 de 8.jpg»: así la app sabe cómo recortar cada cuadro. */
export const THUMB = { every: 10, w: 160, h: 90, cols: 10, rows: 10 };

function thumbsInfo(dir) {
  const td = join(dir, 'miniaturas');
  if (!existsSync(join(td, 'miniaturas.json'))) return null;
  try {
    const meta = JSON.parse(readFileSync(join(td, 'miniaturas.json'), 'utf8'));
    const sheets = meta.sheets.map((f) => join(td, f)).filter((f) => existsSync(f));
    if (sheets.length !== meta.sheets.length) return null;
    return Object.assign({}, meta, {
      sheets: sheets.map((f) => ({ id: register(f, 'image/jpeg'), size: statSync(f).size })),
      bytes: sheets.reduce((n, f) => n + statSync(f).size, 0),
    });
  } catch { return null; }
}

/* Crea las hojas desde la versión más chica de la carpeta (si viene en partes, las une). Solo lee los cuadros clave: rápido. */
export function makeThumbs(dir) {
  const list = listVersions(dir).files;
  if (!list.length) throw new Error('No hay versiones en la carpeta para sacar las miniaturas.');
  const rung = Math.min(...list.map((f) => f.rung));
  const pieces = list.filter((f) => f.rung === rung).sort((a, b) => a.part - b.part);
  return thumbsInto(dir, pieces.map((f) => media.get(f.id).path), pieces.reduce((n, f) => n + f.duration, 0));
}

/* Lo mismo con videos sueltos (por ejemplo, la versión más chica bajada del grupo), en una carpeta temporal. */
export function makeThumbsFrom(paths, name) {
  if (!Array.isArray(paths) || !paths.length || !paths.every((p) => existsSync(p))) throw new Error('No encuentro el video en este equipo.');
  const dir = join(tmpdir(), 'homeflix-preparador', 'miniaturas-del-grupo', String(name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80));
  mkdirSync(dir, { recursive: true });
  const duration = paths.reduce((n, p) => n + (Number((ffprobe(p).format || {}).duration) || 0), 0);
  return thumbsInto(dir, paths, duration);
}

function thumbsInto(dir, paths, duration) {
  const td = join(dir, 'miniaturas');
  mkdirSync(td, { recursive: true });
  readdirSync(td).filter((f) => /^hoja-\d+\.jpg$|^miniaturas\.json$/i.test(f)).forEach((f) => unlinkSync(join(td, f)));
  let input = ['-i', paths[0]];
  let listFile = '';
  if (paths.length > 1) {
    listFile = join(td, 'partes.txt');
    writeFileSync(listFile, paths.map((p) => "file '" + p.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'));
    input = ['-f', 'concat', '-safe', '0', '-i', listFile];
  }
  const { every, w, h, cols, rows } = THUMB;
  const vf = `fps=1/${every},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},tile=${cols}x${rows}`;
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', '-skip_frame', 'nokey', ...input, '-an', '-sn', '-vf', vf, '-q:v', '5', join(td, 'hoja-%02d.jpg')], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (listFile) { try { unlinkSync(listFile); } catch { /* nada */ } }
      const sheets = readdirSync(td).filter((f) => /^hoja-\d+\.jpg$/i.test(f)).sort();
      if (code !== 0 || !sheets.length) return reject(new Error('No pude crear las miniaturas: ' + err.trim().split('\n').pop()));
      const frames = Math.ceil(duration / every);
      writeFileSync(join(td, 'miniaturas.json'), JSON.stringify({ every, w, h, cols, rows, frames, duration, sheets, from: basename(paths[0]) }, null, 1));
      resolve(thumbsInfo(dir));
    });
  });
}

/* El comentario que dejó el preparador en COMO-SUBIR.txt (para no tener que escribirlo otra vez al publicar). */
function savedCaption(dir) {
  const p = join(dir, 'COMO-SUBIR.txt');
  if (!existsSync(p)) return '';
  const line = readFileSync(p, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => /^(pelicula|serie\(\d+\/\d+\))#/i.test(l));
  return line || '';
}

export const IMAGE_SIZE = { portada: [1280, 720], banner: [1920, 1080] };

function imageInfo(path) {
  const info = ffprobe(path);
  const s = (info.streams && info.streams[0]) || {};
  return { id: register(path, 'image/jpeg'), path, width: s.width || 0, height: s.height || 0, size: statSync(path).size, at: statSync(path).mtimeMs };
}

/* Deja la imagen en la medida justa (rellena y recorta al centro), en JPG, como portada.jpg / banner.jpg de la carpeta. */
export function makeImage(src, kind, outDir) {
  const size = IMAGE_SIZE[kind];
  if (!size) throw new Error('Tipo de imagen desconocido.');
  if (!src || !existsSync(src)) throw new Error('No existe la imagen: ' + src);
  const orig = ffprobe(src);
  const os = (orig.streams && orig.streams[0]) || {};
  const dir = outDir && existsSync(outDir) ? outDir : join(tmpdir(), 'homeflix-preparador');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, kind + '.jpg');
  const [w, h] = size;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-frames:v', '1',
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`, '-q:v', '2', out], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !existsSync(out)) throw new Error('No pude convertir la imagen: ' + (r.stderr || '').trim().split('\n').pop());
  return Object.assign(imageInfo(out), { srcWidth: os.width || 0, srcHeight: os.height || 0 });
}

/* ----- Fotogramas de un video para usarlos de portada o banner -----
 * n cuadros repartidos por la película (sin el principio ni el final); «seed» corre los puntos para ver otros. */
export function fotogramas(file, n = 6, seed = 0) {
  if (!file || !existsSync(file)) throw new Error('No encuentro el video en este equipo.');
  const info = ffprobe(file);
  const dur = Number(info.format && info.format.duration) || 0;
  if (!dur) throw new Error('No pude leer la duración del video.');
  const dir = join(tmpdir(), 'homeflix-preparador', 'fotogramas');
  mkdirSync(dir, { recursive: true });
  const out = [];
  const k = Math.max(1, Math.min(12, Number(n) || 6));
  for (let i = 0; i < k; i += 1) {
    const frac = 0.08 + 0.84 * (((i + 0.5 + (Number(seed) || 0) * 0.37) % k) / k);
    const at = Math.round(dur * frac);
    const f = join(dir, basename(file, extname(file)).slice(0, 60) + '-' + at + '.jpg');
    if (!existsSync(f)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-q:v', '2', f], { windowsHide: true });
    if (existsSync(f)) out.push({ at, path: f, id: register(f, 'image/jpeg') });
  }
  if (!out.length) throw new Error('No pude sacar cuadros de ese video.');
  return { frames: out.sort((a, b) => a.at - b.at), duration: dur };
}

/* ----- Partir sin volver a renderizar -----
 * Un archivo que se pasa del tope de Telegram (por ejemplo, un 1080p de 2,2 GB) se corta en partes copiando el video
 * tal cual (sin recodificar: tarda segundos y no pierde calidad). Los cortes caen en cuadros clave, repartidos según
 * el tamaño; si alguna parte aún se pasa, se prueba con una parte más. Las partes quedan como
 * «Nombre [1080p] parte 1 de 2.mp4» (la app las reproduce seguidas) y el original se guarda en «sin partir/». */
export async function partir(file, limit) {
  if (!file || !existsSync(file)) throw new Error('No encuentro el archivo: ' + file);
  const size = statSync(file).size;
  const max = Number(limit) || 2000 * 1048576;
  if (size <= max) throw new Error('Ese archivo ya cabe en Telegram.');
  const info = ffprobe(file);
  const dur = Number(info.format && info.format.duration) || 0;
  if (!dur) throw new Error('No pude leer la duración del video.');
  const dir = dirname(file);
  const ext = extname(file);
  const base = basename(file, ext).replace(/\s*(?:parte|part)\s*\d+\s*(?:de|of)\s*\d+\s*$/i, '').trim();
  const mp4 = /\.(mp4|m4v|mov)$/i.test(ext);
  /* la primera parte lo más grande que quepa y lo que sobra al final; si un corte cae lejos de un cuadro clave y
   * la parte se pasa, se prueba con cortes un poco antes */
  for (const fill of [0.96, 0.92, 0.87, 0.8, 0.7, 0.55]) {
    const chunk = max * fill;
    const n = Math.ceil(size / chunk);
    const tmp = join(dir, '.partiendo-' + Date.now());
    mkdirSync(tmp, { recursive: true });
    const times = [];
    for (let k = 1; k < n; k += 1) times.push((dur * (k * chunk) / size).toFixed(3));
    const args = ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', '-f', 'segment', '-segment_times', times.join(','), '-reset_timestamps', '1'];
    if (mp4) args.push('-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart');
    args.push(join(tmp, 'p%02d' + ext));
    const r = await new Promise((resolve) => {
      const pr = spawn('ffmpeg', args, { windowsHide: true });
      let err = '';
      pr.stderr.on('data', (d) => { err += d; });
      pr.on('close', (code) => resolve({ code, err }));
      pr.on('error', (e) => resolve({ code: -1, err: e.message }));
    });
    const out = existsSync(tmp) ? readdirSync(tmp).filter((f) => /^p\d+/.test(f)).sort().map((f) => join(tmp, f)) : [];
    const ok = r.code === 0 && out.length === n && out.every((f) => statSync(f).size <= max);
    if (!ok) {
      out.forEach((f) => { try { unlinkSync(f); } catch { /* nada */ } });
      try { rmdirSync(tmp); } catch { /* nada */ }
      if (r.code !== 0) throw new Error('No pude partir el video: ' + r.err.trim().split('\n').pop());
      continue; // un corte quedó lejos de un cuadro clave: se prueba con una parte más
    }
    const keep = join(dir, 'sin partir');
    mkdirSync(keep, { recursive: true });
    renameSync(file, join(keep, basename(file)));
    const parts = out.map((f, i) => {
      const dest = join(dir, `${base} parte ${i + 1} de ${n}${ext}`);
      renameSync(f, dest);
      return { name: basename(dest), size: statSync(dest).size };
    });
    try { rmdirSync(tmp); } catch { /* nada */ }
    return { parts, original: join(keep, basename(file)) };
  }
  throw new Error('No pude partirlo en partes que quepan; vuelve a crear esta versión.');
}
