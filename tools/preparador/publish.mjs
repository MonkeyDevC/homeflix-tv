// Preparador · publicar en Telegram (lado del PC).
// La subida la hace la página (motor de Telegram de la app, js/tg.bundle.js); aquí solo se listan las versiones
// de una carpeta, se arman portada y banner con la medida justa y se entregan los archivos a la página.
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename, extname } from 'node:path';
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
  return { dir, files, images, caption: savedCaption(dir) };
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
