// Preparador de videos de HomeFlix: app con interfaz (se abre sola en el navegador).
// Uso: doble clic en «Preparar videos.cmd» (raíz del proyecto), o: node tools/preparador/server.mjs
// Solo escucha en este PC (127.0.0.1). Los botones «Elegir…» abren los diálogos normales de Windows.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, statfsSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync, readFileSync as readFileSyncFs, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, plan, caption, prepare, hasNvenc, gpuInfo, safeName, limitBytes, extractSubs } from './prepare.mjs';
import { listVersions, makeImage, serveMedia, makeThumbs, makeThumbsFrom, fotogramas, partir, mediaPath } from './publish.mjs';
import { loadApiKey, configJsWithKey, loadTmdbKey } from '../apikey.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/* --puerto=5181: el preparador del proyecto (desarrollo) no choca con el instalado, que usa el 5180 */
const PORT = Number(process.env.PORT || (process.argv.find((a) => a.startsWith('--puerto=')) || '').split('=')[1] || 5180);
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

/* Un archivo con el español: audio (de otra copia de la película o suelto) o subtítulos. */
function pickExtra(kind) {
  const filter = kind === 'sub' || kind === 'sub-en' ? 'Subtítulos|*.srt;*.ass;*.ssa;*.vtt|Todos los archivos|*.*' : 'Audio o video|*.mkv;*.mp4;*.m4v;*.mka;*.ac3;*.eac3;*.aac;*.m4a;*.mp3;*.wav;*.flac;*.dts|Todos los archivos|*.*';
  return psDialog('$d = New-Object System.Windows.Forms.OpenFileDialog;' +
    '$d.Title = ' + q(kind === 'sub-en' ? 'Elige los subtítulos en inglés (el .srt traducido)' : kind === 'sub' ? 'Elige los subtítulos en español' : 'Elige el archivo con el audio en español') + ';' +
    '$d.Filter = ' + q(filter) + ';' +
    'if ($d.ShowDialog($o) -eq "OK") { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.FileName }');
}
/* Saca una pista de subtítulos de texto del video a un .srt junto al video («Nombre.spa.srt») y lo muestra en el
 * Explorador: es el archivo que se traduce (por ejemplo, pasándoselo a Claude) para agregarlo luego como inglés. */
function extraerSubs(b) {
  const file = String(b.file || '');
  if (!file || !existsSync(file)) throw new Error('No encuentro el video.');
  const lang = String(b.lang || 'spa').replace(/[^a-z]/gi, '').toLowerCase() || 'sub';
  const out = join(dirname(file), basename(file, extname(file)) + '.' + lang + '.srt');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-map', '0:' + Number(b.index), '-c:s', 'srt', out], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !existsSync(out)) throw new Error('No pude sacar los subtítulos: ' + String(r.stderr || '').trim().split('\n').pop());
  /* sin las etiquetas de fuente que deja el MP4 (estorban al traducir); las cursivas <i> se quedan */
  writeFileSync(out, readFileSyncFs(out, 'utf8').replace(/<\/?font[^>]*>/gi, ''));
  const lines = readFileSyncFs(out, 'utf8').split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).length;
  if (process.platform === 'win32') spawn('explorer.exe', ['/select,' + out], { detached: true, stdio: 'ignore' }).unref();
  return { path: out, lines };
}

/* Pistas de audio de un archivo (para elegir cuál es la española) */
function audioTracksOf(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index,codec_name,channels:stream_tags=language,title:format=duration', '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
  let j = {};
  try { j = JSON.parse(r.stdout || '{}'); } catch { j = {}; }
  return { duration: Number(j.format && j.format.duration) || 0, tracks: (j.streams || []).map((s, i) => ({ n: i, lang: (s.tags && s.tags.language) || '', title: (s.tags && s.tags.title) || '', codec: s.codec_name || '', channels: s.channels || 0 })) };
}
/* Une las partes de una versión (bajadas del grupo) en un solo archivo, sin recodificar. */
/* Subtítulos aparte de un video del grupo (ya bajado a este PC): un .srt por idioma, listos para publicar */
function subsAparte(b) {
  if (!b.path || !existsSync(b.path)) throw new Error('No encuentro el video bajado.');
  const src = probe(b.path);
  const dir = join(tmpdir(), 'homeflix-preparador', 'subtitulos', String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7));
  mkdirSync(dir, { recursive: true });
  const base = safeName(String(b.base || 'Video')).slice(0, 80) || 'Video';
  extractSubs(src, {}, dir, base, src.duration);
  /* lo bajado solo para esto se borra (pesa lo que el video): solo lo que está en la carpeta de descargas del preparador */
  for (const f of [b.path].concat(Array.isArray(b.borrar) ? b.borrar : [])) {
    try {
      const r = f ? relative(DL_DIR, f) : '';
      if (r && !r.startsWith('..') && !isAbsolute(r) && existsSync(f)) unlinkSync(f);
    } catch { /* sigue */ }
  }
  return { subs: listVersions(dir).subs };
}

/* Videos que ya están en este PC, para sacar sus subtítulos sin bajar nada del grupo. Se busca en las carpetas que se
 * pasan, en las de la cola (y sus carpetas de origen) y un nivel adentro (ahí quedan las «… - HomeFlix»). Solo videos de
 * más de 200 MB; de cada uno, su duración y sus subtítulos de texto. */
function videosLocales(b) {
  const dirs = new Set();
  const add = (d) => { if (d && existsSync(d)) { try { if (statSync(d).isDirectory()) dirs.add(d); } catch { /* nada */ } } };
  (Array.isArray(b.carpetas) ? b.carpetas : []).forEach(add);
  COLA.items.forEach((x) => { add(x.outDir); if (x.outDir) add(dirname(x.outDir)); if (x.opts && x.opts.file) add(dirname(x.opts.file)); });
  const files = new Set();
  const look = (d, deep) => {
    let names = [];
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (deep) look(p, false); continue; }
      if (!/\.(mp4|mkv|m4v|mov)$/i.test(e.name) || /\.tmp\./i.test(e.name)) continue;
      try { if (statSync(p).size > 200 * 1048576) files.add(p); } catch { /* nada */ }
    }
  };
  for (const d of dirs) look(d, true);
  const out = [];
  for (const f of files) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name:stream_tags=language:stream_disposition=forced', '-of', 'json', f], { encoding: 'utf8', windowsHide: true });
    let j = {};
    try { j = JSON.parse(r.stdout || '{}'); } catch { j = {}; }
    const subs = (j.streams || []).filter((x) => x.codec_type === 'subtitle' && /^(mov_text|subrip|srt|ass|ssa|webvtt|text)$/.test(x.codec_name || ''))
      .map((x) => ({ lang: (x.tags && x.tags.language) || '', forced: !!(x.disposition && x.disposition.forced) }));
    out.push({ path: f, name: basename(f), size: statSync(f).size, duration: Number(j.format && j.format.duration) || 0, subs });
  }
  return { carpetas: [...dirs], videos: out };
}

function unirPartes(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('No hay partes para unir.');
  if (paths.length === 1) return { path: paths[0] };
  const out = paths[0].replace(/\s*(parte|part)\s*\d+\s*de\s*\d+/i, '').replace(/(\.[^.]+)$/, ' completa$1');
  if (existsSync(out)) return { path: out };
  const list = out + '.txt';
  writeFileSync(list, paths.map((p) => "file '" + p.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0', '-c', 'copy', out], { encoding: 'utf8', windowsHide: true });
  try { unlinkSync(list); } catch { /* nada */ }
  if (r.status !== 0 || !existsSync(out)) throw new Error('No pude unir las partes: ' + (r.stderr || '').trim().split('\n').pop());
  return { path: out };
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

/* Pistas de audio y subtítulos a partir del encabezado de un archivo (MKV) o de su «moov» (MP4). */
async function probeBytes(req, ext) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 80 * 1048576) throw new Error('Demasiado grande');
    chunks.push(c);
  }
  const dir = join(tmpdir(), 'homeflix-preparador');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'idioma-' + process.pid + '-' + Date.now() + (ext === 'mkv' ? '.mkv' : '.mp4'));
  writeFileSync(file, Buffer.concat(chunks));
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_type,codec_name,channels:stream_tags=language,title,handler_name:stream_disposition=forced', '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
    let info = {};
    try { info = JSON.parse(r.stdout || '{}'); } catch { info = {}; }
    const streams = info.streams || [];
    if (!streams.length) throw new Error('No se pudieron leer las pistas del archivo');
    const pick = (type) => streams.filter((s) => s.codec_type === type).map((s) => ({
      lang: (s.tags && s.tags.language) || '', title: (s.tags && (s.tags.title || (/^(sound|video|subtitle|text)handler$|^iso media|^gpac|^core media|^mainconcept/i.test(String(s.tags.handler_name || '').trim()) ? '' : s.tags.handler_name))) || '', codec: s.codec_name || '',
      channels: s.channels || 0, forced: !!(s.disposition && s.disposition.forced),
    }));
    return { audio: pick('audio'), subs: pick('subtitle') };
  } finally {
    try { unlinkSync(file); } catch { /* se borra después */ }
  }
}

/* ----- Imágenes para portada y banner -----
 * Búsqueda: API oficial de TMDB (themoviedb.org). Se busca el título y se traen sus fondos (backdrops, 16:9) con la
 * medida exacta y el idioma del texto que llevan («» = sin texto, ideal para el banner). Antes se leía un endpoint
 * interno de DuckDuckGo, que empezó a bloquear con 403 las peticiones automáticas.
 * La clave va en el .env como TMDB_API_KEY (gratis: themoviedb.org → Ajustes → API).
 * Lo elegido se baja aquí y se deja a la medida con makeImage (1280×720 o 1920×1080, recorte al centro). */
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' }; // para bajar la imagen elegida
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
async function tmdb(path, params) {
  const key = loadTmdbKey();
  if (!key) throw new Error('Falta la clave de TMDB. Crea una gratis en themoviedb.org (Ajustes → API) y ponla en el archivo .env del proyecto como TMDB_API_KEY=… Mientras tanto, usa «Abrir en Google».');
  const bearer = key.startsWith('eyJ'); // token de lectura v4; si no, es la clave v3
  const u = new URL(TMDB + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  if (!bearer) u.searchParams.set('api_key', key);
  let r;
  try {
    r = await fetch(u, { headers: Object.assign({ Accept: 'application/json' }, bearer ? { Authorization: 'Bearer ' + key } : {}), signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new Error(e && e.name === 'TimeoutError' ? 'TMDB no respondió a tiempo. Llena los datos a mano o prueba de nuevo.' : 'No pude conectar con TMDB (' + (e && e.cause && e.cause.code || e.message) + '). Llena los datos a mano o prueba de nuevo.');
  }
  if (r.status === 401) throw new Error('TMDB no aceptó la clave. Revisa TMDB_API_KEY en el .env (themoviedb.org → Ajustes → API).');
  if (!r.ok) throw new Error('TMDB respondió ' + r.status + '. Prueba de nuevo o usa «Abrir en Google».');
  return r.json();
}
/* ----- Ficha de TMDB para llenar solo los datos al elegir el video -----
 * buscar: {q, year, media} → candidatos (los del año pedido ±1 primero). ficha: {id, media} → todo lo que el preparador
 * llena (nombre en español latino, año, sinopsis, géneros, clasificación por país, duración) y la mejor portada y fondo. */
const IMG_BASE = 'https://image.tmdb.org/t/p/';
async function tmdbBuscar(b) {
  const media = b.media === 'tv' ? 'tv' : 'movie';
  const q = String(b.q || '').trim();
  if (!q) return { results: [] };
  const year = Number(b.year) || 0;
  const r = await tmdb('/search/' + media, { query: q, language: 'es-MX', include_adult: 'false' });
  const yearOf = (x) => Number(String(x.release_date || x.first_air_date || '').slice(0, 4)) || 0;
  const list = (r.results || []).map((x) => ({
    id: x.id, media, title: x.title || x.name || '', original: x.original_title || x.original_name || '', year: yearOf(x),
    poster: x.poster_path ? IMG_BASE + 'w185' + x.poster_path : '', overview: String(x.overview || '').slice(0, 180), pop: x.popularity || 0,
  }));
  list.sort((a, c) => (year ? (Math.abs(a.year - year) <= 1 ? 0 : 1) - (Math.abs(c.year - year) <= 1 ? 0 : 1) : 0) || c.pop - a.pop);
  return { results: list.slice(0, 8) };
}
/* Capítulos de una temporada (título y descripción de cada uno, en español): primero es-MX y lo que falte se completa con es-ES. «Episodio 3» no cuenta como título. */
async function tmdbTemporada(b) {
  const id = Number(b.id);
  const n = Number(b.season);
  if (!id || !n) throw new Error('Falta la serie o la temporada de TMDB.');
  const mx = await tmdb('/tv/' + id + '/season/' + n, { language: 'es-MX' });
  let es = null;
  const hueco = (mx.episodes || []).some((e) => !String(e.overview || '').trim() || /^(episodio|episode|capítulo)\s*\d+$/i.test(String(e.name || '').trim()));
  if (hueco) { try { es = await tmdb('/tv/' + id + '/season/' + n, { language: 'es-ES' }); } catch (e) { es = null; } }
  const byN = {};
  ((es && es.episodes) || []).forEach((e) => { byN[e.episode_number] = e; });
  const bueno = (t) => { t = String(t || '').trim(); return t && !/^(episodio|episode|capítulo)\s*\d+$/i.test(t) ? t : ''; };
  return {
    season: n,
    episodes: (mx.episodes || []).map((e) => {
      const o = byN[e.episode_number] || {};
      return { n: e.episode_number, name: bueno(e.name) || bueno(o.name), overview: String(e.overview || '').trim() || String(o.overview || '').trim(), runtime: e.runtime || 0, still: e.still_path ? IMG_BASE + 'original' + e.still_path : '' };
    }),
  };
}
async function tmdbFicha(b) {
  const media = b.media === 'tv' ? 'tv' : 'movie';
  const id = Number(b.id);
  if (!id) throw new Error('Falta la película de TMDB.');
  const extra = media === 'movie' ? 'release_dates,keywords,images,translations' : 'content_ratings,keywords,images,translations';
  const d = await tmdb('/' + media + '/' + id, { language: 'es-MX', append_to_response: extra, include_image_language: 'es,en,null' });
  const cert = {};
  if (media === 'movie') {
    for (const r of (d.release_dates && d.release_dates.results) || []) {
      const c = (r.release_dates || []).map((x) => x.certification).filter(Boolean)[0];
      if (c) cert[r.iso_3166_1] = c;
    }
  } else {
    for (const r of (d.content_ratings && d.content_ratings.results) || []) if (r.rating) cert[r.iso_3166_1] = r.rating;
  }
  const kw = (d.keywords && (d.keywords.keywords || d.keywords.results)) || [];
  const imgs = d.images || {};
  /* En la app la portada (tarjeta) y el banner son horizontales: portada = fondo CON el título (español, si no inglés);
   * banner = fondo SIN texto. Los más votados y grandes primero. */
  const rank = (lang) => (lang === 'es' ? 0 : lang === 'en' ? 1 : 2);
  const bds = (imgs.backdrops || []).slice().sort((x, y) => y.vote_average - x.vote_average || y.width - x.width);
  const poster = bds.filter((x) => x.iso_639_1).sort((x, y) => rank(x.iso_639_1) - rank(y.iso_639_1))[0] || bds[0];
  const backdrop = bds.filter((x) => !x.iso_639_1 && x !== poster)[0] || bds.find((x) => x !== poster) || bds[0];
  /* portada vertical (póster 2:3): con el título en español primero, luego inglés, luego sin texto; los más votados y grandes primero */
  const vps = (imgs.posters || []).slice().sort((x, y) => rank(x.iso_639_1) - rank(y.iso_639_1) || y.vote_average - x.vote_average || y.width - x.width);
  const vposter = vps[0];
  const year = Number(String(d.release_date || d.first_air_date || '').slice(0, 4)) || 0;
  /* título en español: con language=es-MX TMDB devuelve el original cuando no hay traducción mexicana, aunque exista la de España («Cómo vender drogas online (rápido)») */
  const original = d.original_title || d.original_name || '';
  let titulo = d.title || d.name || '';
  if (d.original_language !== 'es' && (!titulo || titulo === original)) {
    const tr = ((d.translations && d.translations.translations) || []).filter((x) => x.iso_639_1 === 'es' && x.data && (x.data.title || x.data.name));
    const best = tr.find((x) => x.iso_3166_1 === 'MX') || tr.find((x) => x.iso_3166_1 === 'ES') || tr[0];
    if (best) titulo = best.data.title || best.data.name;
  }
  return {
    id, media, title: titulo, original: d.original_title || d.original_name || '', year,
    overview: d.overview || '', runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
    genres: (d.genres || []).map((g) => g.name), lang: d.original_language || '',
    companies: (d.production_companies || []).map((c) => c.name), keywords: kw.map((k) => k.name),
    collection: d.belongs_to_collection ? d.belongs_to_collection.name : '', cert,
    /* temporadas de TMDB (sin los especiales): sirven para partir una numeración continua (1…128) en temporadas */
    seasons: media === 'tv' ? (d.seasons || []).filter((x) => x.season_number > 0 && x.episode_count > 0).map((x) => ({ n: x.season_number, episodes: x.episode_count, name: x.name || '', year: Number(String(x.air_date || '').slice(0, 4)) || 0 })) : [],
    poster: poster ? { url: IMG_BASE + 'original' + poster.file_path, w: poster.width, h: poster.height, lang: poster.iso_639_1 || '' } : null,
    backdrop: backdrop ? { url: IMG_BASE + 'original' + backdrop.file_path, w: backdrop.width, h: backdrop.height, lang: backdrop.iso_639_1 || '' } : null,
    vertical: vposter ? { url: IMG_BASE + 'original' + vposter.file_path, w: vposter.width, h: vposter.height, lang: vposter.iso_639_1 || '' } : null,
  };
}

/* b: { q: «Nombre 2026» } busca el título; { id, media: 'movie'|'tv' } trae las imágenes de uno ya elegido. */
async function buscarImagenes(b) {
  const q = String(b.q || '').trim();
  let pick = b.id ? { id: Number(b.id), media: b.media === 'tv' ? 'tv' : 'movie' } : null;
  let matches = [];
  if (!pick) {
    if (!q) throw new Error('Escribe qué buscar.');
    const m = /^(.*?)\s*\(?((?:19|20)\d{2})\)?$/.exec(q); // el año al final se usa para ordenar, no para buscar
    const query = m && m[1] ? m[1] : q;
    const year = m ? Number(m[2]) : 0;
    const j = await tmdb('/search/multi', { query, language: 'es-ES', include_adult: 'false' });
    matches = (j.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv').map((x) => ({
      id: x.id, media: x.media_type, title: x.title || x.name || '',
      year: Number(String(x.release_date || x.first_air_date || '').slice(0, 4)) || 0,
      thumb: x.backdrop_path ? TMDB_IMG + 'w300' + x.backdrop_path : x.poster_path ? TMDB_IMG + 'w154' + x.poster_path : '',
    }));
    if (year) { // los del año pedido (±1) primero, sin perder el orden de relevancia de TMDB
      const near = (x) => (Math.abs(x.year - year) <= 1 ? 0 : 1);
      matches = matches.map((x, i) => [x, i]).sort((a, c) => near(a[0]) - near(c[0]) || a[1] - c[1]).map((p) => p[0]);
    }
    matches = matches.slice(0, 6);
    pick = matches[0] || null;
  }
  if (!pick) return { results: [], matches, picked: null, next: 0 };
  const season = Number(b.season) || 0;
  const episode = Number(b.episode) || 0;
  const still = b.kind === 'capitulo' && pick.media === 'tv' && season && episode; // imágenes de ese capítulo
  const im = await tmdb(still ? '/tv/' + pick.id + '/season/' + season + '/episode/' + episode + '/images' : '/' + pick.media + '/' + pick.id + '/images', { include_image_language: 'es,en,null' });
  const vertical = b.kind === 'vertical';
  const results = (still ? im.stills || [] : vertical ? im.posters || [] : im.backdrops || []).map((x) => ({
    url: TMDB_IMG + 'original' + x.file_path, thumb: TMDB_IMG + (vertical ? 'w342' : 'w300') + x.file_path, w: x.width, h: x.height,
    lang: x.iso_639_1 || '', score: x.vote_average || 0, title: '', site: 'themoviedb.org',
  })).sort((a, c) => c.score - a.score || c.w - a.w);
  return { results, matches, picked: pick, next: 0 };
}
function tempImageDir() {
  const base = join(tmpdir(), 'homeflix-preparador', 'imagenes');
  /* las imágenes temporales de más de un día ya no hacen falta: se borran para no llenar el disco */
  try { for (const n of readdirSync(base)) { const p = join(base, n); if (Date.now() - statSync(p).mtimeMs > 86400000) rmSync(p, { recursive: true, force: true }); } } catch { /* no hay carpeta aún */ }
  const d = join(base, String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7));
  mkdirSync(d, { recursive: true });
  return d;
}
async function imagenDesdeUrl(b) {
  if (!/^https?:\/\//i.test(String(b.url || ''))) throw new Error('Esa dirección no es una imagen.');
  const r = await fetch(b.url, { headers: Object.assign({ Referer: new URL(b.url).origin + '/' }, UA) });
  if (!r.ok) throw new Error('No pude bajar la imagen (' + r.status + '). Prueba con otra.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 40 * 1048576) throw new Error('La imagen es demasiado grande.');
  const d = tempImageDir();
  const src = join(d, 'original');
  writeFileSync(src, buf);
  return makeImage(src, b.kind, carpetaImagen(b.outDir) || d, b.num);
}
/* la carpeta de la película (la de «Carpeta a publicar»), si existe: ahí la cola y la pestaña 4 la encuentran */
function carpetaImagen(dir) {
  try { return dir && existsSync(dir) && statSync(dir).isDirectory() ? dir : ''; } catch { return ''; }
}
async function imagenDesdeBytes(req, kind, outDir, num) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > 40 * 1048576) throw new Error('La imagen es demasiado grande.'); chunks.push(c); }
  const d = tempImageDir();
  const src = join(d, 'original');
  writeFileSync(src, Buffer.concat(chunks));
  return makeImage(src, kind, carpetaImagen(outDir) || d, num);
}

/* ----- Videos del grupo bajados a este PC (para sacar fotogramas, miniaturas o crear calidades) -----
 * La página baja el archivo de Telegram y lo manda por pedazos; queda en la carpeta temporal del preparador. */
/* Pesan lo que el video (1–4 GB): si el disco de la carpeta temporal tiene poco espacio, van a la unidad con más espacio
 * libre (p. ej. D:\HomeFlix Preparador (temporal)\del-grupo). */
function libre(path) { try { const f = statfsSync(path); return f.bavail * f.bsize; } catch { return -1; } }
function carpetaDescargas() {
  const tmp = join(tmpdir(), 'homeflix-preparador', 'del-grupo');
  if (process.platform !== 'win32' || libre(tmpdir()) > 8 * 1073741824) return tmp;
  let best = { dir: tmp, free: libre(tmpdir()) };
  for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = L + ':/';
    const free = existsSync(root) ? libre(root) : -1;
    if (free > best.free + 1073741824) best = { dir: join(root, 'HomeFlix Preparador (temporal)', 'del-grupo'), free };
  }
  return best.dir;
}
const DL_DIR = carpetaDescargas();
function dlPath(name) {
  const safe = String(name || 'video.mp4').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 180) || 'video.mp4';
  return join(DL_DIR, safe);
}
async function recibir(req, url) {
  mkdirSync(DL_DIR, { recursive: true });
  const file = dlPath(url.searchParams.get('name'));
  const offset = Number(url.searchParams.get('offset') || 0);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (offset === 0) writeFileSync(file, buf);
  else {
    if (!existsSync(file) || statSync(file).size !== offset) throw new Error('Se perdió un pedazo del archivo; vuelve a bajarlo.');
    appendFileSync(file, buf);
  }
  return { path: file, size: statSync(file).size };
}
function yaBajado(b) {
  const file = dlPath(b.name);
  return existsSync(file) && statSync(file).size === Number(b.size) ? { path: file } : { path: '' };
}

/* ----- Actualizaciones del preparador (mismo canal que la TV y el celular: el servidor de HomeFlix en el VPS) -----
 * Como en la TV: se revisa al abrir; «Actualizar» baja preparador-<v>.zip (con avance), revisa su sha256 y reemplaza sus
 * archivos en la carpeta donde está instalado (el .env, los videos y todo lo demás no se tocan). Al terminar, «Reiniciar»
 * lo cierra y lo vuelve a abrir solo en una ventana nueva. La copia del proyecto (con .git) no se actualiza así: es la
 * de desarrollo y se actualiza con git. */
const ROOT = join(here, '..', '..');
const UPDATES = process.env.HF_UPDATES || 'https://scalvache.shop/productos/HomeFlix/actualizaciones';
const UPD = { estado: '', got: 0, total: 0, error: '', version: '' };
function miVersion() {
  try { return JSON.parse(readFileSyncFs(join(here, 'version.json'), 'utf8')).version || ''; } catch { /* sin archivo */ }
  try { return (/<widget[^>]*\sversion="([^"]+)"/.exec(readFileSyncFs(join(ROOT, 'config.xml'), 'utf8')) || [])[1] || ''; } catch { return ''; }
}
/* la versión con la que arrancó ESTE proceso: si en disco hay otra, se actualizó y falta reiniciar */
const VERSION_ARRANQUE = miVersion();
function esDesarrollo() { return !process.env.HF_FORZAR_ACTUALIZAR && existsSync(join(ROOT, '.git')); }
function cmpVer(a, b) {
  const x = String(a || '0').split('.').map(Number);
  const y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
async function vigente() {
  const r = await fetch(UPDATES + '/v1', { headers: { 'Cache-Control': 'no-cache' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('El servidor de HomeFlix respondió ' + r.status);
  return r.json();
}
async function buscarActualizacion() {
  const actual = miVersion();
  const m = await vigente();
  if (!m) return { actual, hay: false, dev: esDesarrollo() };
  const hay = !!(m.preparador && cmpVer(m.version, actual) > 0) && !esDesarrollo();
  return { actual, hay, dev: esDesarrollo(), version: m.version, notas: m.notas || '', fecha: m.fecha || '', bytes: m.preparador ? m.preparador.bytes : 0, estado: UPD.estado };
}
/* Empieza a bajar e instalar en segundo plano; el avance se lee con GET /api/actualizar/estado. */
function actualizar() {
  if (job) throw new Error('Hay un trabajo en marcha: espera a que termine para actualizar.');
  if (esDesarrollo()) throw new Error('Esta es la copia del proyecto (desarrollo): se actualiza con git, no desde aquí.');
  if (UPD.estado === 'bajando' || UPD.estado === 'instalando') return { ok: true };
  Object.assign(UPD, { estado: 'bajando', got: 0, total: 0, error: '', version: '' });
  (async () => {
    const m = await vigente();
    if (!m || !m.preparador || cmpVer(m.version, miVersion()) <= 0) throw new Error('Ya tienes la última versión.');
    UPD.version = m.version;
    UPD.total = m.preparador.bytes || 0;
    const r = await fetch(UPDATES + '/archivos/' + encodeURIComponent(m.version) + '/' + encodeURIComponent(m.preparador.archivo));
    if (!r.ok) throw new Error('No pude bajar la actualización (' + r.status + ').');
    UPD.total = Number(r.headers.get('content-length')) || UPD.total;
    const parts = [];
    for await (const chunk of r.body) { parts.push(Buffer.from(chunk)); UPD.got += chunk.length; }
    const buf = Buffer.concat(parts);
    UPD.estado = 'instalando';
    if (createHash('sha256').update(buf).digest('hex') !== m.preparador.sha256) throw new Error('La actualización llegó dañada; inténtalo otra vez.');
    const tmp = join(tmpdir(), 'homeflix-preparador', 'actualizacion-' + m.version);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const zip = join(tmp, 'preparador.zip');
    writeFileSync(zip, buf);
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
    const x = spawnSync(tar, ['-x', '-f', zip, '-C', tmp], { encoding: 'utf8', windowsHide: true });
    if (x.status !== 0) throw new Error('No pude abrir la actualización: ' + (x.stderr || '').trim());
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (f !== zip) files.push(f); });
    walk(tmp);
    for (const f of files) {
      const rel = relative(tmp, f);
      if (rel.startsWith('..') || /(^|[\\/])\.env/.test(rel)) continue;
      const dest = join(ROOT, rel);
      /* el lanzador en uso no se reescribe mientras corre (cmd lo va leyendo): queda el nuevo para la próxima instalación */
      if (process.env.HF_LAUNCHER && /^Preparar videos.cmd$/i.test(rel) && existsSync(dest) && !readFileSyncFs(dest).equals(readFileSyncFs(f))) continue;
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(f, dest);
    }
    rmSync(tmp, { recursive: true, force: true });
    /* en «Aplicaciones instaladas» de Windows se ve la versión nueva (si lo instaló el instalador) */
    if (process.platform === 'win32') spawnSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HomeFlixPreparador', '/v', 'DisplayVersion', '/d', m.version, '/f'], { windowsHide: true, stdio: 'ignore' });
    UPD.estado = 'listo';
  })().catch((e) => { UPD.estado = 'error'; UPD.error = e.message || String(e); });
  return { ok: true };
}
/* ----- Claves de este PC (preparador instalado) -----
 * El paquete público NO trae claves: la primera vez, el preparador pide la de Telegram (my.telegram.org) y la de TMDB y
 * las guarda en el .env de su carpeta, solo en este equipo (la actualización nunca toca el .env). */
function clavesEstado() {
  let tg = false;
  try { tg = !!loadApiKey(); } catch { tg = false; }
  return { tg, tmdb: !!loadTmdbKey() };
}
function guardarClaves(b) {
  const set = {};
  const id = String(b.tgId || '').trim();
  const hash = String(b.tgHash || '').trim().toLowerCase();
  const tmdbK = String(b.tmdb || '').trim();
  if (id || hash) {
    if (!/^[1-9]\d{0,11}$/.test(id)) throw new Error('El api_id de Telegram son solo números.');
    if (!/^[0-9a-f]{32}$/.test(hash)) throw new Error('El api_hash de Telegram tiene 32 letras y números (0-9, a-f).');
    set.TG_API_ID = id;
    set.TG_API_HASH = hash;
  }
  if (tmdbK) {
    if (!/^[0-9a-f]{32}$/i.test(tmdbK) && !/^eyJ[\w.-]{20,}$/.test(tmdbK)) throw new Error('La clave de TMDB es la «clave de API» (32 caracteres) o el «token de lectura» (empieza por eyJ).');
    set.TMDB_API_KEY = tmdbK;
  }
  if (!Object.keys(set).length) throw new Error('Escribe al menos una clave.');
  const f = join(ROOT, '.env');
  const lines = existsSync(f) ? readFileSyncFs(f, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(set)) {
    const i = lines.findIndex((l) => new RegExp('^\\s*' + k + '\\s*=').test(l));
    if (i >= 0) lines[i] = k + '=' + v; else lines.push(k + '=' + v);
  }
  writeFileSync(f, lines.filter((l, i) => l || i < lines.length - 1).join('\r\n') + '\r\n');
  return clavesEstado();
}

/* Cierra este preparador y abre el nuevo en una ventana nueva (espera a que el puerto quede libre). */
function reiniciar() {
  if (UPD.estado !== 'listo') throw new Error('Todavía no hay una actualización lista.');
  /* abierto con «Preparar videos.cmd» (lo normal): sale con el código 3 y el lanzador lo vuelve a abrir en la misma ventana */
  if (process.env.HF_LAUNCHER) {
    writeFileSync(join(ROOT, '.reinicio'), String(Date.now())); // al volver a abrir, sin otra pestaña del navegador
    setTimeout(() => process.exit(3), 300);
    return { ok: true };
  }
  setTimeout(() => {
    spawn('cmd.exe', ['/c', 'start', '"HomeFlix - Preparador de videos"', 'cmd', '/c', 'node', 'tools\\preparador\\server.mjs', '--no-open', '--reinicio'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => process.exit(0), 300);
  }, 300);
  return { ok: true };
}

/* ----- Cola de películas -----
 * Se pueden encolar varias: se renderizan una tras otra (la tarjeta gráfica hace una a la vez) y, si «Publicar al
 * terminar» está encendido, la página del preparador sube cada una al grupo apenas termina, sin que nadie pulse nada.
 * La cola se guarda en .cola.json (sobrevive a cerrar el preparador). Cada película deja su carpeta completa:
 * versiones + portada.jpg + banner.jpg + COMO-SUBIR.txt (con el comentario), que es lo que se publica.
 * Estados: espera → renderizando → renderizado → publicando → publicado (o error / cancelado). */
const COLA_FILE = join(ROOT, '.cola.json');
const COLA = { items: [], pausa: false, auto: true };
try { Object.assign(COLA, JSON.parse(readFileSyncFs(COLA_FILE, 'utf8'))); } catch { /* sin cola guardada */ }
/* lo que quedó a medias al cerrar: el render vuelve a esperar; la subida se retoma (la página no repite lo que ya está) */
COLA.items.forEach((x) => {
  if (x.estado === 'renderizando') x.estado = 'espera';
  if (x.estado === 'publicando') x.estado = 'renderizado';
});
function colaGuardar() {
  try { writeFileSync(COLA_FILE, JSON.stringify(COLA, null, 1)); } catch { /* sin disco: sigue en memoria */ }
  send({ type: 'cola', cola: colaVista() });
}
/* Avance de la publicación de cada película (qué archivo va, bytes, velocidad y el estado de cada archivo). Lo manda la página que sube
 * (la única con la sesión de Telegram) y lo ve CUALQUIER pestaña —o la misma tras recargar—: antes vivía solo en la memoria de esa página y
 * las demás mostraban «Publicando…» con la barra vacía y sin marcar nada de lo ya subido. Solo en memoria: al reiniciar se vuelve a empezar. */
const PUBS = {};
function colaVista() {
  return { items: COLA.items.map((x) => ({ id: x.id, nombre: x.nombre, estado: x.estado, outDir: x.outDir, error: x.error || '', creado: x.creado, fin: x.fin || 0, calidades: x.opts.qualities || [], opts: x.opts, pub: PUBS[x.id] || null })), pausa: COLA.pausa, auto: COLA.auto, actual: (COLA.items.find((x) => x.estado === 'renderizando') || {}).id || '' };
}
/* Evento en vivo: va a las páginas conectadas pero no se guarda en el historial que se repite a las que llegan después. */
function sendLive(ev) {
  const data = 'data: ' + JSON.stringify(ev) + '\n\n';
  clients.forEach((res) => res.write(data));
}
function colaProgreso(b) {
  const x = colaItem(b.id);
  const p = b.pub && typeof b.pub === 'object' ? b.pub : null;
  if (!p || x.estado !== 'publicando') return { ok: true }; // lo que llega tarde (ya terminó o se devolvió a la fila) no se guarda
  PUBS[x.id] = { i: Number(p.i) || 0, n: Number(p.n) || 0, done: Number(p.done) || 0, sent: Number(p.sent) || 0, total: Number(p.total) || 0, speed: String(p.speed || '').slice(0, 40), skip: Number(p.skip) || 0, keys: p.keys && typeof p.keys === 'object' ? p.keys : {}, at: Date.now() };
  sendLive({ type: 'cola-pub', id: x.id, pub: PUBS[x.id] });
  return { ok: true };
}
function colaItem(id) {
  const x = COLA.items.find((i) => i.id === id);
  if (!x) throw new Error('Esa película ya no está en la cola.');
  return x;
}
/* Agrega una película: su configuración (la de las pestañas 1 a 3) y las imágenes elegidas, que se copian a su carpeta. */
function colaAgregar(b) {
  const o = b.opts || {};
  if (!o.file || !existsSync(o.file)) throw new Error('Elige el video original.');
  if (!o.qualities || !o.qualities.length) throw new Error('Marca al menos una calidad.');
  o.outDir = String(o.outDir || '').trim() || defaultOutDir(o.file);
  mkdirSync(o.outDir, { recursive: true });
  /* Un doble clic (o dos pestañas, o un reintento de la red) no puede meter la misma película dos veces: si ya hay una igual
   * esperando o renderizándose se devuelve esa y no se agrega nada (antes se procesaba dos veces). */
  const igual = COLA.items.find((y) => (y.estado === 'espera' || y.estado === 'renderizando') && colaClave(y.opts) === colaClave(o));
  if (igual) return { ok: true, id: igual.id, repetida: true, cola: colaVista() };
  for (const kind of ['portada', 'banner', 'vertical', 'capitulo', 'capitulos']) {
    const p = b.images && b.images[kind];
    /* una imagen guardada en la carpeta de otra película de la cola es de esa película (la página la arrastró): no se copia */
    const deOtra = p && COLA.items.some((y) => y.outDir && y.outDir !== o.outDir && dirname(p).toLowerCase() === y.outDir.toLowerCase());
    if (p && existsSync(p) && !deOtra && p !== join(o.outDir, kind + '.jpg')) copyFileSync(p, join(o.outDir, kind + '.jpg'));
  }
  for (const p of (b.images && b.images.galeria) || []) {
    const m = /(galeria-\d{1,3}\.jpg)$/i.exec(String(p || ''));
    if (m && existsSync(p) && p !== join(o.outDir, m[1])) copyFileSync(p, join(o.outDir, m[1]));
  }
  const x = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nombre: (o.name || basename(o.file)) + (Number(o.year) ? ' (' + Number(o.year) + ')' : ''), opts: o, estado: 'espera', outDir: o.outDir, creado: Date.now() };
  /* Siempre al final: «Crear versiones» (sin cola) y «＋ Agregar a la cola» (con cola) son el mismo botón del paso 3 y agregan de última;
   * el orden se cambia a propósito desde la cola (subir / bajar), no porque una película se cuele. */
  COLA.items.push(x);
  colaGuardar();
  colaSeguir();
  return { ok: true, id: x.id, cola: colaVista() };
}
/* Lo que identifica «la misma película con lo mismo»: el archivo, la carpeta de salida y las calidades pedidas. */
function colaClave(o) {
  return [o.file, o.outDir, (o.qualities || []).slice().sort().join(','), o.testSeconds || 0].join('|').toLowerCase();
}
/* Si no hay nada renderizando, empieza la siguiente que espera.
 * El arranque de un trabajo (probar la tarjeta, leer el video…) tiene partes que paran el programa un buen rato: se hace unos
 * milisegundos DESPUÉS, para que quien pidió esto (un clic) reciba su respuesta antes. «arrancando» evita que, en ese ratito,
 * otra llamada empiece una segunda película al mismo tiempo. */
let arrancando = false;
function colaSeguir() {
  if (job || arrancando || COLA.pausa) return;
  const x = COLA.items.find((i) => i.estado === 'espera');
  if (!x) return;
  arrancando = true;
  x.estado = 'renderizando';
  x.error = '';
  last = [];
  colaGuardar();
  setTimeout(() => {
    arrancando = false;
    let run;
    try {
      run = prepare(x.opts, (ev) => send(Object.assign({ cola: x.id, colaNombre: x.nombre }, ev)));
    } catch (e) {
      x.estado = 'error';
      x.error = e.message;
      send({ type: 'error', message: e.message, cola: x.id });
      colaGuardar();
      colaSeguir();
      return;
    }
    job = run.job;
    run.promise.then((r) => {
      job = null;
      x.estado = 'renderizado';
      x.outDir = r.outDir;
      x.fin = Date.now();
      colaGuardar();
      colaSeguir();
    }, (e) => {
      job = null;
      x.estado = e.cancelled ? 'cancelado' : 'error';
      x.error = e.cancelled ? '' : e.message;
      send(e.cancelled ? { type: 'cancelled', cola: x.id } : { type: 'error', message: e.message, cola: x.id });
      colaGuardar();
      colaSeguir();
    });
  }, 150);
}
function colaEstado(b) {
  const x = colaItem(b.id);
  if (!['publicando', 'publicado', 'error', 'renderizado'].includes(b.estado)) throw new Error('Estado no válido.');
  x.estado = b.estado;
  x.error = b.estado === 'error' ? String(b.error || '') : '';
  if (b.estado === 'publicando' || b.estado === 'renderizado') delete PUBS[x.id]; // empieza de cero (o se devolvió a la fila)
  if (b.estado === 'publicado') x.fin = Date.now();
  colaGuardar();
  return colaVista();
}
function colaQuitar(b) {
  const x = colaItem(b.id);
  if (x.estado === 'renderizando') throw new Error('Se está renderizando: cancélala primero.');
  if (x.estado === 'publicando') throw new Error('Se está publicando: espera a que termine.');
  COLA.items = COLA.items.filter((i) => i !== x);
  delete PUBS[x.id];
  colaGuardar();
  return colaVista();
}
function colaMover(b) {
  const i = COLA.items.findIndex((x) => x.id === b.id);
  const j = i + (b.dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= COLA.items.length) return colaVista();
  [COLA.items[i], COLA.items[j]] = [COLA.items[j], COLA.items[i]];
  colaGuardar();
  return colaVista();
}
function colaReintentar(b) {
  const x = colaItem(b.id);
  if (x.estado === 'error' || x.estado === 'cancelado') x.estado = existsSync(join(x.outDir || '', 'COMO-SUBIR.txt')) && x.fin ? 'renderizado' : 'espera';
  x.error = '';
  colaGuardar();
  colaSeguir();
  return colaVista();
}

function defaultOutDir(file) {
  return join(dirname(file), safeName(basename(file, extname(file))) + ' - HomeFlix');
}

const routes = {
  'GET /api/state': () => ({ busy: !!job, events: last, gpu: hasNvenc(), gpuInfo: hasNvenc() ? gpuInfo() : null, version: miVersion(), corriendo: VERSION_ARRANQUE, cola: colaVista() }),
  'GET /api/actualizacion': () => buscarActualizacion(),
  'POST /api/actualizar': () => actualizar(),
  'GET /api/actualizar/estado': () => ({ ...UPD, actual: miVersion() }),
  'POST /api/reiniciar': () => reiniciar(),
  'GET /api/claves': () => clavesEstado(),
  'POST /api/claves': (b) => guardarClaves(b),
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
  'POST /api/start': (b) => colaAgregar(b.opts ? b : { opts: b }), // lo mismo que «Agregar a la cola» (la página ya solo manda por un botón)
  'GET /api/cola': () => colaVista(),
  'POST /api/cola/agregar': (b) => colaAgregar(b),
  'POST /api/cola/estado': (b) => colaEstado(b),
  'POST /api/cola/progreso': (b) => colaProgreso(b),
  'POST /api/cola/quitar': (b) => colaQuitar(b),
  'POST /api/cola/mover': (b) => colaMover(b),
  'POST /api/cola/reintentar': (b) => colaReintentar(b),
  'POST /api/cola/limpiar': () => { COLA.items = COLA.items.filter((x) => x.estado !== 'publicado'); colaGuardar(); return colaVista(); },
  'POST /api/cola/pausa': (b) => { COLA.pausa = !!b.pausa; colaGuardar(); colaSeguir(); return colaVista(); },
  'POST /api/cola/auto': (b) => { COLA.auto = !!b.auto; colaGuardar(); return colaVista(); },
  'POST /api/cancel': () => {
    if (job) job.cancel();
    return { ok: true };
  },
  'POST /api/pick-image': (b) => ({ path: pickImage(b.start) }),
  'POST /api/versions': (b) => listVersions(b.dir),
  'POST /api/image': (b) => makeImage(b.path, b.kind, b.outDir || tempImageDir(), b.num),
  /* quita una escena de la galería de la carpeta (galeria-NN.jpg) */
  'POST /api/borrar-escena': (b) => {
    const p = String(b.path || '');
    if (!/galeria-\d{1,3}\.jpg$/i.test(p) || !existsSync(p)) throw new Error('Esa escena ya no está en la carpeta.');
    unlinkSync(p);
    return { ok: true };
  },
  'POST /api/thumbs': (b) => makeThumbs(b.dir),
  'POST /api/buscar-imagenes': (b) => buscarImagenes(b),
  'POST /api/tmdb/buscar': (b) => tmdbBuscar(b),
  'POST /api/tmdb/ficha': (b) => tmdbFicha(b),
  'POST /api/tmdb/temporada': (b) => tmdbTemporada(b),
  'POST /api/imagen-url': (b) => imagenDesdeUrl(b),
  'POST /api/ya-bajado': (b) => yaBajado(b),
  'POST /api/fotogramas': (b) => fotogramas(b.path, b.n, b.seed),
  'POST /api/pick-extra': (b) => ({ path: pickExtra(b.kind) }),
  'POST /api/extraer-subs': (b) => extraerSubs(b),
  'POST /api/audio-tracks': (b) => audioTracksOf(b.path),
  'POST /api/unir': (b) => unirPartes(b.paths),
  'POST /api/subs-aparte': (b) => subsAparte(b),
  'POST /api/videos-locales': (b) => videosLocales(b),
  'POST /api/partir': (b) => partir(mediaPath(b.id), b.limit),
  'POST /api/thumbs-file': (b) => makeThumbsFrom(b.paths, b.name),
  'POST /api/open': (b) => {
    openInExplorer(b.path);
    return { ok: true };
  },
};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(await readFile(join(here, 'ui.html')));
    return;
  }
  /* La biblioteca del preparador (entrar, elegir el chat, Inicio y ficha) */
  const OWN = { '/biblioteca.js': ['biblioteca.js', 'text/javascript'], '/importar.js': ['importar.js', 'text/javascript'], '/biblioteca.css': ['biblioteca.css', 'text/css'], '/cola.js': ['cola.js', 'text/javascript'], '/subsync.js': ['subsync.js', 'text/javascript'], '/cache.js': ['cache.js', 'text/javascript'], '/temas.js': ['temas.js', 'text/javascript'], '/sw-stream.js': ['sw-stream.js', 'text/javascript'] };
  if (req.method === 'GET' && OWN[url.pathname]) {
    res.writeHead(200, { 'Content-Type': OWN[url.pathname][1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
    res.end(await readFile(join(here, OWN[url.pathname][0])));
    return;
  }
  /* Idioma de un video del grupo: la página manda el encabezado del archivo (unos MB) y ffprobe dice sus pistas */
  if (req.method === 'POST' && (url.pathname === '/api/imagen-bytes' || url.pathname === '/api/recibir')) {
    try {
      json(res, 200, url.pathname === '/api/recibir' ? await recibir(req, url) : await imagenDesdeBytes(req, url.searchParams.get('kind'), url.searchParams.get('outDir'), url.searchParams.get('num')));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/probe-bytes') {
    try {
      json(res, 200, await probeBytes(req, url.searchParams.get('ext')));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }
  if (req.method === 'GET' && url.pathname === '/logo.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(await readFile(join(here, '..', '..', 'images', 'logo.png')));
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
  /* si quedaron películas en la cola, sigue con ellas */
  colaSeguir();
  /* después de actualizarse se reabre sin abrir otra pestaña (la que estaba se recarga sola) */
  const reinicio = existsSync(join(ROOT, '.reinicio'));
  if (reinicio) { try { unlinkSync(join(ROOT, '.reinicio')); } catch { /* nada */ } }
  if (!reinicio && !process.env.NO_OPEN && !process.argv.includes('--no-open')) spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE' && process.argv.includes('--reinicio') && (global.__intentos = (global.__intentos || 0) + 1) < 40) {
    setTimeout(() => httpServer.listen(PORT, '127.0.0.1'), 500);
    return;
  }
  if (e.code === 'EADDRINUSE') {
    console.log('El preparador ya estaba abierto: lo abro en el navegador.');
    spawn('cmd.exe', ['/c', 'start', '', `http://localhost:${PORT}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => process.exit(0), 500);
  } else {
    throw e;
  }
});
