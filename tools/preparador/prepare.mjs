// Núcleo del Preparador de videos de HomeFlix: lee el video original y crea sus versiones (4K, 1080p, 720p, 360p)
// para subirlas a Telegram con el mismo comentario. Lo usan la app con interfaz (server.mjs) y la consola (../preparar-video.mjs).
//
// Reglas pensadas para la TV:
//  - 4K en H.265 (HEVC): las TVs Samsung con Tizen 5.5–6.5 no decodifican H.264 de más de 1088 líneas. El resto en H.264.
//  - Cada calidad tiene una tasa objetivo (4K: la que elijas, 14 Mbps por defecto). Si a esa tasa no cabe en el tope de
//    Telegram (2 GB, o 4 GB con Premium), se divide en partes iguales («… [2160p] parte 1 de 3.mp4») que la app de la TV
//    reproduce seguidas como una sola película. Si le falta poco para caber (hasta un 25 %), se baja un poco la tasa en vez
//    de partir. Sin partes («split: false»), el 4K se acerca lo más posible al tope y las demás se ajustan para caber.
//  - Si un archivo sale más grande que el tope, se vuelve a codificar con la tasa justa.
//  - HDR: el 4K se queda en HDR (10 bits); las demás se pasan a SDR para que no se vean lavadas.
//  - Un fotograma clave cada 2 s (la app cambia de calidad en esos puntos).
//  - Audio AAC / AC3 / E-AC3 se copia; cualquier otro (DTS, TrueHD, FLAC…) se pasa a AAC estéreo.
//  - MP4: subtítulos de texto como mov_text (los de imagen, PGS/VobSub, no caben). MKV: todos.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export const RUNGS = [
  /* good / ok: kbps de video para que se vea bien o aceptable en esa calidad */
  { h: 2160, w: 3840, id: '2160', name: '4K', file: '2160p', kbps: 14000, cap: 45000, min: 6000, good: 12000, ok: 7000, codec: 'hevc' },
  { h: 1080, w: 1920, id: '1080', name: '1080p', file: '1080p', kbps: 5000, min: 2000, good: 4000, ok: 2500, codec: 'h264' },
  { h: 720, w: 1280, id: '720', name: '720p', file: '720p', kbps: 2500, min: 1000, good: 2200, ok: 1300, codec: 'h264' },
  { h: 360, w: 640, id: '360', name: '360p', file: '360p', kbps: 800, min: 300, good: 600, ok: 350, codec: 'h264' },
];
const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'];
const COPY_AUDIO = ['aac', 'ac3', 'eac3'];
const MB = 1048576;

export function limitBytes(gb) {
  return (Number(gb) === 4 ? 4000 : 2000) * MB; // Telegram: 2000 MB (o 4000 MB con Premium)
}

function ffprobeJson(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', file], { encoding: 'utf8', maxBuffer: 64 * MB });
  if (r.error) throw new Error('No encontré ffprobe. Instala ffmpeg (https://www.gyan.dev/ffmpeg/builds/).');
  if (r.status !== 0) throw new Error('No pude leer el archivo: ' + (r.stderr || '').trim().split('\n').pop());
  return JSON.parse(r.stdout);
}

function streamBps(s) {
  const t = s.tags || {};
  return Number(s.bit_rate) || Number(t.BPS) || Number(t['BPS-eng']) || 0;
}

/* Tasa de un audio que no la dice (muchos MKV): se supone la más alta habitual para ese códec y canales,
 * así el tope nunca se pasa (un AAC 5.1 suele ir a 384 kbps, no a 192). */
function guessAudioBps(s) {
  const ch = s.channels || 2;
  const perCh = { aac: 64000, opus: 48000, vorbis: 64000, mp3: 160000, ac3: 107000, eac3: 128000, dts: 256000, truehd: 600000, flac: 500000 };
  const v = (perCh[s.codec_name] || 96000) * (s.codec_name === 'mp3' ? 2 : ch);
  return Math.max(192000, Math.round(v));
}

/* Lo que hace falta saber del original (para mostrarlo y para planear). */
export function probe(file) {
  if (!file || !existsSync(file)) throw new Error('No existe el archivo: ' + file);
  const info = ffprobeJson(file);
  const v = info.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (!v) throw new Error('El archivo no tiene video.');
  const duration = Number(info.format.duration) || Number(v.duration) || 0;
  if (!duration) throw new Error('No pude leer la duración del video.');
  const lang = (s) => (s.tags && (s.tags.language || s.tags.LANGUAGE)) || '';
  const title = (s) => (s.tags && (s.tags.title || s.tags.TITLE)) || '';
  const audios = info.streams.filter((s) => s.codec_type === 'audio').map((s) => ({
    index: s.index, codec: s.codec_name, channels: s.channels || 2, lang: lang(s), title: title(s),
    bps: streamBps(s) || guessAudioBps(s),
    copy: COPY_AUDIO.includes(s.codec_name) && (s.channels || 2) <= 6,
  }));
  const subs = info.streams.filter((s) => s.codec_type === 'subtitle').map((s) => ({
    index: s.index, codec: s.codec_name, lang: lang(s), title: title(s), text: TEXT_SUBS.includes(s.codec_name),
  }));
  const rung = Math.max(v.height, Math.round((v.width * 9) / 16));
  const size = statSync(file).size;
  /* tasa del video original (si el archivo no la dice: tamaño total menos el audio) */
  const vBps = streamBps(v) || Math.max(0, (size * 8) / duration - audios.reduce((n, a) => n + (a.bps || 192000), 0));
  return {
    file, name: basename(file), size, duration,
    video: { index: v.index, codec: v.codec_name, width: v.width, height: v.height, rung, kbps: Math.round(vBps / 1000), fps: v.avg_frame_rate, transfer: v.color_transfer || '', hdr: /smpte2084|arib-std-b67/.test(v.color_transfer || '') },
    audios, subs, chapters: (info.chapters || []).length,
    rungs: RUNGS.map((r) => ({ id: r.id, name: r.name, possible: r.h <= rung + 8 })),
    guess: guessTitle(basename(file, extname(file))),
  };
}

/* «The.Last.Emperor.1987.2160p.UHD…» → {name: "The Last Emperor", year: 1987} */
export function guessTitle(base) {
  let s = String(base).replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ');
  const y = /\b(19\d{2}|20\d{2})\b/.exec(s);
  let year = 0;
  if (y) {
    year = Number(y[1]);
    s = s.slice(0, y.index);
  } else {
    s = s.replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|bluray|web-?dl|webrip|x26[45]|h26[45]|hevc|remux)\b.*$/i, '');
  }
  return { name: s.replace(/\s+/g, ' ').replace(/[-\s(]+$/, '').trim(), year };
}

/* Pistas elegidas (por defecto todas) y si cada audio se copia o se pasa a AAC estéreo. */
function pickAudios(src, opts) {
  const sel = Array.isArray(opts.audioTracks) ? opts.audioTracks.map(Number) : null;
  return src.audios.filter((a) => !sel || sel.includes(a.index)).map((a) => ({ ...a, copy: opts.audioMode === 'aac' ? false : a.copy }));
}
function pickSubs(src, opts) {
  const sel = Array.isArray(opts.subTracks) ? opts.subTracks.map(Number) : null;
  return src.subs.filter((s) => (!sel || sel.includes(s.index)) && (opts.mkv || s.text));
}

/* Peso del audio (para descontarlo del tope). */
function audioBps(src, opts) {
  return pickAudios(src, opts).reduce((n, a) => n + (a.copy ? a.bps || (a.codec === 'aac' ? 192000 : 640000) : 192000), 0);
}

/* Qué se va a hacer con cada calidad: tasa de video, en cuántas partes y tamaño esperado.
 * opts.split (por defecto true): partir lo que no cabe. opts.k4Mbps: tasa objetivo del 4K. opts.partSeconds: forzar el largo de cada parte. */
export function plan(src, opts) {
  const dur = opts.testSeconds ? Math.min(src.duration, Number(opts.testSeconds)) : src.duration;
  const limit = limitBytes(opts.limitGb);
  const aBps = audioBps(src, opts);
  const budget = Math.floor(((limit * 0.97 * 8) / dur - aBps) / 1000); // kbps de video para llegar al 97 % del tope en un archivo
  const split = opts.split !== false;
  const want = opts.qualities && opts.qualities.length ? opts.qualities.map(String) : RUNGS.map((r) => r.id);
  return RUNGS.filter((r) => want.includes(r.id) && src.rungs.find((x) => x.id === r.id).possible).map((r) => {
    let capped = false;
    let target = r.id === '2160' ? Math.max(4000, Math.min(r.cap, Math.round(Number(opts.k4Mbps || 14) * 1000))) : r.kbps;
    /* Nunca más tasa que el original en su misma resolución: no gana calidad y ocupa más.
     * (H.265 necesita menos que H.264 para lo mismo; un original H.265 pasado a H.264 necesita algo más.) */
    /* En las resoluciones menores, la proporción que les toca (menos píxeles, menos tasa). */
    if (src.video.kbps) {
      const srcHevc = /hevc|h265|av1|vp9/.test(src.video.codec);
      const factor = r.codec === 'hevc' ? (srcHevc ? 1.1 : 0.8) : (srcHevc ? 1.4 : 1.1);
      const scale = Math.pow(Math.min(1, r.h / src.video.rung), 0.75);
      const fromSrc = Math.max(r.min, Math.round(src.video.kbps * factor * scale));
      if (fromSrc < target) {
        target = fromSrc;
        capped = true;
      }
    }
    let kbps;
    let parts = 1;
    if (!split) {
      kbps = Math.min(r.id === '2160' ? r.cap : r.kbps, budget);
    } else if (target <= budget) {
      kbps = r.id === '2160' ? Math.min(r.cap, budget) : target; // cabe: el 4K aprovecha hasta el tope
    } else if (budget >= target * 0.75) {
      kbps = budget; // le falta poco: se baja un poco la tasa en vez de partir
    } else {
      kbps = target;
      parts = Math.ceil(((kbps * 1000 + aBps) * dur) / 8 / (limit * 0.95));
    }
    if (opts.partSeconds && Number(opts.partSeconds) < dur) {
      parts = Math.max(parts, Math.ceil(dur / Number(opts.partSeconds)));
    }
    /* partes de igual largo, en múltiplos de 2 s (donde hay fotogramas clave) */
    let partSeconds = parts > 1 ? Math.ceil(dur / parts / 2) * 2 : dur;
    if (opts.partSeconds && parts > 1) partSeconds = Math.min(partSeconds, Math.ceil(Number(opts.partSeconds) / 2) * 2);
    if (parts > 1) parts = Math.ceil(dur / partSeconds);
    kbps = Math.max(100, kbps);
    const bytes = Math.round(((kbps * 1000 + aBps) * dur) / 8);
    return {
      id: r.id, name: r.name, file: r.file, codec: r.codec, kbps, parts, partSeconds,
      bytes, partBytes: Math.round(bytes / parts),
      low: kbps < r.min,
      /* «original»: tiene toda la tasa que el original da en esa resolución (no se puede ver mejor) */
      rating: capped && kbps >= target * 0.95 ? 'original' : kbps >= r.good ? 'buena' : kbps >= r.ok ? 'aceptable' : 'baja',
      audioKbps: Math.round(aBps / 1000),
    };
  });
}

export function caption(o) {
  const name = String(o.name || '').replace(/#/g, '').trim();
  const desc = String(o.description || '').replace(/#/g, '').trim();
  if (!name) return '';
  let c;
  if (o.type === 'series') {
    const ep = String(o.episodeTitle || '').replace(/#/g, '').trim();
    c = `serie(${Number(o.season) || 1}/${Number(o.episode) || 1})#${name}` + (ep ? `#${ep}#${desc}` : desc ? `#${desc}` : '');
  } else {
    c = `pelicula#${name}${Number(o.year) ? ` (${Number(o.year)})` : ''}` + (desc ? `#${desc}` : '');
  }
  return c + catTags(o.categories) + (o.kids ? ' #infantil' : '');
}

/* «Marvel, ciencia ficción» (o una lista) → « #Marvel #ciencia_ficción»: cada una es una fila en la app */
export function catTags(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(',');
  return arr.map((c) => String(c).replace(/#/g, '').trim().replace(/\s+/g, '_'))
    .filter((c) => c && !/^(infantil|kids|ni[ñn]os|portada|poster|banner|fondo)$/i.test(c))
    .map((c) => ' #' + c).join('');
}

export function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').trim();
}

export function baseNameFor(o, src) {
  if (o.type === 'series' && o.name) return safeName(`${o.name} T${Number(o.season) || 1}E${Number(o.episode) || 1}`);
  if (o.name) return safeName(o.name + (Number(o.year) ? ` (${Number(o.year)})` : ''));
  return safeName(basename(src.file, extname(src.file)));
}

let nvencCache = null;
function works(args) {
  return spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-f', 'null', '-'], { encoding: 'utf8' }).status === 0;
}
/* Tarjeta gráfica NVIDIA: muchísimo más rápido (un 4K de 2 horas: minutos en vez de horas). */
export function hasNvenc() {
  if (nvencCache === null) {
    nvencCache = works(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=0.2', '-c:v', 'hevc_nvenc']) &&
      works(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=0.2', '-c:v', 'h264_nvenc']);
  }
  return nvencCache;
}

function ffmpegArgs(src, p, opts, out, kbps, gpu, seg) {
  const r = RUNGS.find((x) => x.id === p.id);
  const hevc = r.codec === 'hevc';
  const hdr = src.video.hdr;
  const keepHdr = hdr && hevc;
  let vf = `scale=w='min(${r.w},iw)':h='min(${r.h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  if (hdr && !keepHdr) {
    vf += ',zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
  }
  const a = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1'];
  if (seg.start) a.push('-ss', String(seg.start));
  a.push('-i', src.file, '-t', String(seg.len));
  a.push('-map', `0:${src.video.index}`, '-vf', vf);
  if (gpu) a.push('-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc', '-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-multipass', 'qres', '-spatial-aq', '1');
  else a.push('-c:v', hevc ? 'libx265' : 'libx264', '-preset', 'medium');
  a.push('-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.6) + 'k', '-bufsize', kbps * 2 + 'k');
  if (hevc) {
    a.push('-tag:v', 'hvc1');
    if (keepHdr) {
      a.push('-pix_fmt', gpu ? 'p010le' : 'yuv420p10le', '-profile:v', 'main10', '-color_primaries', 'bt2020', '-color_trc', src.video.transfer, '-colorspace', 'bt2020nc');
      if (!gpu) a.push('-x265-params', `hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=${src.video.transfer}:colormatrix=bt2020nc`);
    } else {
      a.push('-pix_fmt', 'yuv420p', '-profile:v', 'main');
    }
  } else {
    a.push('-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', r.h > 720 ? '4.1' : '3.1');
  }
  a.push('-force_key_frames', 'expr:gte(t,n_forced*2)');
  if (gpu) a.push('-forced-idr', '1');
  pickAudios(src, opts).forEach((au, i) => {
    a.push('-map', `0:${au.index}`);
    if (au.copy) a.push(`-c:a:${i}`, 'copy');
    else a.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '192k', `-ac:a:${i}`, '2');
  });
  const subs = pickSubs(src, opts);
  if (subs.length) {
    subs.forEach((s) => a.push('-map', `0:${s.index}`));
    a.push('-c:s', opts.mkv ? 'copy' : 'mov_text');
  }
  a.push('-map_metadata', '0', '-map_chapters', p.parts > 1 ? '-1' : '0');
  if (!opts.mkv) a.push('-movflags', '+faststart');
  a.push(out);
  return a;
}

/* Corre ffmpeg informando el avance. job.kill() lo detiene. */
function encode(args, duration, onProgress, job) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    job.proc = p;
    let err = '';
    let buf = '';
    const t0 = Date.now();
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      const kv = {};
      lines.forEach((l) => { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1).trim(); });
      if (kv.out_time_us || kv.out_time_ms) {
        const done = Number(kv.out_time_us || kv.out_time_ms) / 1e6;
        const pct = Math.max(0, Math.min(100, (done / duration) * 100));
        const el = (Date.now() - t0) / 1000;
        onProgress({ pct, elapsed: el, left: pct > 0.5 ? (el / pct) * (100 - pct) : 0, speed: kv.speed || '', fps: Number(kv.fps) || 0 });
      }
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-6000); });
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      job.proc = null;
      if (job.cancelled) reject(Object.assign(new Error('Cancelado'), { cancelled: true }));
      else if (code === 0) resolve();
      else reject(new Error(err.trim().split('\n').slice(-6).join('\n') || 'ffmpeg terminó con error ' + code));
    });
  });
}

/* Prepara todas las versiones. emit(evento) informa: start, rung-start, progress, retry, rung-done, rung-error, done.
 * Devuelve {job, promise}: job.cancel() detiene todo y borra el archivo a medias. */
export function prepare(opts, emit) {
  const job = { proc: null, cancelled: false, current: null };
  job.cancel = () => {
    job.cancelled = true;
    if (job.proc) job.proc.kill('SIGKILL');
  };
  const promise = (async () => {
    const src = probe(opts.file);
    const gpu = opts.encoder === 'cpu' ? false : hasNvenc();
    const steps = plan(src, opts);
    if (!steps.length) throw new Error('No hay calidades para hacer (el original es de ' + src.video.width + '×' + src.video.height + ').');
    const outDir = opts.outDir || join(dirname(src.file), safeName(basename(src.file, extname(src.file))) + ' - HomeFlix');
    mkdirSync(outDir, { recursive: true });
    const base = baseNameFor(opts, src);
    const ext = opts.mkv ? '.mkv' : '.mp4';
    const dur = opts.testSeconds ? Math.min(src.duration, Number(opts.testSeconds)) : src.duration;
    const limit = limitBytes(opts.limitGb);
    const text = caption(opts);
    emit({ type: 'start', outDir, gpu, steps, caption: text });
    const results = [];
    for (let i = 0; i < steps.length; i += 1) {
      const p = steps[i];
      let kbps = p.kbps;
      const files = [];
      emit({ type: 'rung-start', id: p.id, index: i, kbps, parts: p.parts });
      try {
        for (let j = 0; j < p.parts; j += 1) {
          const start = j * p.partSeconds;
          const len = Math.min(p.partSeconds, dur - start);
          const tag = p.parts > 1 ? ` parte ${j + 1} de ${p.parts}` : '';
          const out = join(outDir, `${base} [${p.file}]${tag}${ext}`);
          /* se escribe aparte y solo al terminar bien reemplaza al archivo final (cancelar no borra una versión buena de antes) */
          const tmp = join(outDir, `${base} [${p.file}]${tag}.tmp${ext}`);
          job.current = tmp;
          try {
            for (let attempt = 0; ; attempt += 1) {
              await encode(ffmpegArgs(src, p, opts, tmp, kbps, gpu, { start, len }), len, (pr) => emit({
                type: 'progress', id: p.id, index: i, part: j, parts: p.parts,
                pct: ((j + pr.pct / 100) / p.parts) * 100,
                left: pr.left + (p.parts - j - 1) * (pr.elapsed + pr.left) * (p.partSeconds / len),
                speed: pr.speed, elapsed: pr.elapsed,
              }), job);
              const size = statSync(tmp).size;
              /* se pasó del tope de Telegram: otra vez con la tasa justa (solo una vez) */
              if (size > limit && attempt === 0) {
                /* lo que no es video (audio, subtítulos, contenedor) se saca de lo que pesó de verdad, no de la tasa supuesta */
                const otherBits = Math.max(p.audioKbps * 1000 * len, size * 8 - kbps * 1000 * len);
                kbps = Math.floor((limit * 0.94 * 8 - otherBits) / len / 1000);
                emit({ type: 'retry', id: p.id, index: i, part: j, size, kbps });
                continue;
              }
              renameSync(tmp, out);
              files.push({ file: out, size, over: size > limit });
              break;
            }
          } catch (e) {
            try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* nada */ }
            throw e;
          }
        }
        const size = files.reduce((n, f) => n + f.size, 0);
        const over = files.some((f) => f.over);
        files.forEach((f) => results.push({ id: p.id, name: p.name, file: f.file, size: f.size, kbps, over: f.over }));
        emit({ type: 'rung-done', id: p.id, index: i, size, over, parts: files.length, files: files.map((f) => basename(f.file)) });
      } catch (e) {
        if (e.cancelled) throw e;
        emit({ type: 'rung-error', id: p.id, index: i, message: e.message });
      }
    }
    job.current = null;
    if (!results.length) throw new Error('No se pudo crear ninguna versión.');
    /* en la lista van todas las versiones de la carpeta (también las de una corrida anterior) */
    const all = readdirSync(outDir).filter((f) => /\.(mp4|mkv)$/i.test(f) && !/\.tmp\./i.test(f))
      .map((f) => ({ file: join(outDir, f), size: statSync(join(outDir, f)).size }));
    writeFileSync(join(outDir, 'COMO-SUBIR.txt'), howTo(text, all.length ? all : results), 'utf8');
    emit({ type: 'done', outDir, results: results.map((r) => ({ ...r, file: basename(r.file) })), caption: text });
    return { outDir, results, caption: text };
  })();
  promise.catch(() => {});
  return { job, promise };
}

export function howTo(text, results) {
  return [
    'HomeFlix · cómo subir estas versiones',
    '',
    'Lo más fácil: en el Preparador de videos, sección «7 · Publicar en Telegram», elige esta carpeta, el grupo,',
    'la portada y el banner, y pulsa Publicar. Sube todo con su comentario.',
    '',
    'A mano:',
    '1. Abre Telegram Desktop en el PC (el del teléfono comprime los videos y los deja en baja calidad).',
    '2. En el chat o canal de tu biblioteca, envía CADA archivo de esta carpeta como video (no como archivo)',
    '   y pon en cada uno exactamente este comentario:',
    '',
    '   ' + (text || '(escribe el comentario con el formato de HomeFlix)'),
    '',
    '   Si una calidad viene en partes («parte 1 de 3»…), súbelas todas sin cambiarles el nombre: la TV las junta sola.',
    '',
    '3. En la TV aparece un solo título y la app elige sola la calidad según tu internet.',
    '   En el reproductor, el botón «Calidad» deja elegirla a mano.',
    '',
    'Opcional: sube también la foto de la tarjeta y la del fondo con el mismo comentario y #portada / #banner al final.',
    '',
    'Archivos:',
    ...results.map((x) => `   ${basename(x.file)}  (${(x.size / MB).toFixed(0)} MB)`),
    '',
  ].join('\r\n');
}
