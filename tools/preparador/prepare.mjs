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
//  - Copia directa: si una calidad sale igual que el original (misma resolución, códec que la TV ya reproduce y una tasa
//    razonable), el video NO se vuelve a codificar: se copia tal cual (minutos en vez de media hora, sin perder nada) y,
//    si no cabe en Telegram, se corta en cuadros clave: la parte 1 lo más grande que quepa y el resto al final.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
    forced: !!(s.disposition && s.disposition.forced),
  }));
  const rung = Math.max(v.height, Math.round((v.width * 9) / 16));
  const size = statSync(file).size;
  /* tasa del video original (si el archivo no la dice: tamaño total menos el audio) */
  const vBps = streamBps(v) || Math.max(0, (size * 8) / duration - audios.reduce((n, a) => n + (a.bps || 192000), 0));
  return {
    file, name: basename(file), size, duration,
    video: { index: v.index, codec: v.codec_name, pixFmt: v.pix_fmt || '', profile: v.profile || '', width: v.width, height: v.height, rung, kbps: Math.round(vBps / 1000), fps: v.avg_frame_rate, transfer: v.color_transfer || '', hdr: /smpte2084|arib-std-b67/.test(v.color_transfer || '') },
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
  return pickAudios(src, opts).reduce((n, a) => n + (a.copy ? a.bps || (a.codec === 'aac' ? 192000 : 640000) : 192000), 0) +
    (opts.extraAudio && opts.extraAudio.path ? 384000 : 0);
}

/* ¿Esta calidad puede salir copiando el video del original, sin recodificar? Misma resolución, el códec que esa calidad
 * usa en la TV (H.264 de 8 bits; el 4K en H.265), sin pasar HDR a SDR y sin una tasa desmedida (un remux de 30 Mbps sí
 * se recodifica: serían muchas partes y pesado para el celular). opts.reencode: forzar la recodificación. */
export function canCopy(src, r, opts) {
  if (opts.reencode) return false;
  const v = src.video;
  if (Math.abs(v.rung - r.h) > 8 || v.width > r.w + 8 || v.height > r.h + 8) return false;
  if (r.codec === 'h264') {
    if (v.codec !== 'h264' || v.hdr || (v.pixFmt && v.pixFmt !== 'yuv420p' && v.pixFmt !== 'yuvj420p') || /10|4:4:4|4:2:2/i.test(v.profile)) return false;
  } else if (!/hevc|h265/.test(v.codec)) {
    return false;
  }
  const top = r.id === '2160' ? Math.max(r.kbps, Number(opts.k4Mbps || 14) * 1000) : r.kbps;
  return !v.kbps || v.kbps <= top * 1.5;
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
    if (canCopy(src, r, opts)) {
      /* copia directa: pesa lo que pesa el original; la parte 1 lo más grande que quepa y el resto al final */
      const kbpsCopy = src.video.kbps || Math.round((src.size * 8) / src.duration / 1000);
      const bytesCopy = Math.round(((kbpsCopy * 1000 + aBps) * dur) / 8);
      const partsCopy = split && bytesCopy > limit * 0.97 ? Math.ceil(bytesCopy / (limit * 0.96)) : 1;
      return {
        id: r.id, name: r.name, file: r.file, codec: r.codec, kbps: kbpsCopy, parts: partsCopy,
        partSeconds: partsCopy > 1 ? Math.min(dur, Math.floor((limit * 0.96 * 8) / (kbpsCopy * 1000 + aBps))) : dur,
        bytes: bytesCopy, partBytes: partsCopy > 1 ? Math.round(limit * 0.96) : bytesCopy,
        low: false, rating: 'original', copy: true, audioKbps: Math.round(aBps / 1000),
      };
    }
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
  return c + catTags(o.categories) + (o.kids ? ' #infantil' : '') + (o.tmdb && o.tmdb.id ? ' #tmdb' + (o.tmdb.type === 'tv' ? 'tv' : '') + Number(o.tmdb.id) : '');
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
  const copyV = !!p.copy;
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
  /* Español de otro archivo: un audio (de otra copia de la película o un .ac3/.mka). «offset» (segundos) corre el
   * audio si no empieza igual que el video. Va primero y queda como predeterminado.
   * Los subtítulos de texto NO van dentro del video: se sacan una vez como .srt por idioma (extractSubs) y todas las
   * calidades usan los mismos, como en el streaming de siempre. Dentro solo quedan los de imagen (PGS) en un MKV. */
  const xa = opts.extraAudio && opts.extraAudio.path ? opts.extraAudio : null;
  let nextInput = 1;
  let xaIn = -1;
  if (xa) {
    const off = Number(xa.offset) || 0;
    if (off) a.push('-itsoffset', String(off));
    if (seg.start) a.push('-ss', String(seg.start));
    a.push('-i', xa.path);
    xaIn = nextInput++;
  }
  a.push('-map', `0:${src.video.index}`);
  if (copyV) {
    a.push('-c:v', 'copy');
    if (hevc) a.push('-tag:v', 'hvc1');
  } else {
  a.push('-vf', vf);
  if (gpu) a.push('-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc', ...NVENC_Q);
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
  }
  let ai = 0;
  if (xa) {
    a.push('-map', `${xaIn}:a:${Number(xa.track) || 0}`, `-c:a:0`, 'aac', `-b:a:0`, '384k', '-metadata:s:a:0', 'language=spa', '-metadata:s:a:0', 'title=' + (xa.title || 'Español'), '-disposition:a:0', 'default');
    ai = 1;
  }
  pickAudios(src, opts).forEach((au) => {
    const i = ai++;
    a.push('-map', `0:${au.index}`);
    if (au.copy) a.push(`-c:a:${i}`, 'copy');
    else a.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '192k', `-ac:a:${i}`, '2');
    if (xa) a.push(`-disposition:a:${i}`, '0');
  });
  const imageSubs = opts.mkv ? pickSubs(src, opts).filter((s) => !s.text) : [];
  if (imageSubs.length) {
    imageSubs.forEach((s) => a.push('-map', `0:${s.index}`));
    a.push('-c:s', 'copy');
  }
  a.push('-map_metadata', '0', '-map_chapters', p.parts > 1 ? '-1' : '0');
  if (!opts.mkv) a.push('-movflags', '+faststart');
  a.push(out);
  return a;
}

/* Ajustes de NVENC: p4 + multipass qres + AQ espacial. Medido (2026-11-10, RTX 3050, 1080p→720p): misma calidad que p6
 * (VMAF 95,99 frente a 95,96) en un 30 % menos de tiempo. */
const NVENC_Q = ['-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-multipass', 'qres', '-spatial-aq', '1'];

/* ¿Puede la tarjeta hacer TODO con este archivo? (leerlo con NVDEC, escalarlo con CUDA y, si es HDR, pasarlo a SDR con
 * libplacebo en Vulkan). Se prueba con un segundo del archivo; si no, se usa el camino de siempre. */
const fullGpuCache = new Map();
export function canFullGpu(src) {
  const k = src.file + '|' + src.size;
  if (!fullGpuCache.has(k)) {
    const vf = src.video.hdr
      ? 'hwdownload,format=p010le,libplacebo=w=640:h=-2:tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p'
      : 'scale_cuda=w=640:h=-2:interp_algo=lanczos:format=nv12';
    fullGpuCache.set(k, works(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-ss', String(Math.min(60, Math.floor(src.duration / 2))), '-t', '1', '-i', src.file,
      '-map', `0:${src.video.index}`, '-vf', vf, '-c:v', 'h264_nvenc']));
  }
  return fullGpuCache.get(k);
}

/* Todas las calidades que se recodifican, en UNA sola pasada y todo en la tarjeta: el original se lee una vez (NVDEC),
 * la imagen se reparte (split) y cada calidad se escala en la GPU (scale_cuda, lanczos; o libplacebo si hay que pasar
 * HDR a SDR) y se comprime con NVENC. Salen archivos enteros; si alguno pasa del tope, se corta después sin recodificar
 * (los cuadros clave van cada 2 s). Medido: 720p + 360p de un 1080p en ~40 % del tiempo de hacerlas por separado. */
function gpuAllArgs(src, steps, opts, outs, dur) {
  const hdr = src.video.hdr;
  const a = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-extra_hw_frames', '16'];
  if (opts.testSeconds) a.push('-t', String(dur));
  a.push('-i', src.file);
  const xa = opts.extraAudio && opts.extraAudio.path ? opts.extraAudio : null;
  if (xa) {
    const off = Number(xa.offset) || 0;
    if (off) a.push('-itsoffset', String(off));
    if (opts.testSeconds) a.push('-t', String(dur));
    a.push('-i', xa.path);
  }
  const n = steps.length;
  const chains = [`[0:${src.video.index}]${n > 1 ? 'split=' + n + steps.map((_, i) => '[s' + i + ']').join('') : 'null[s0]'}`];
  steps.forEach((p, i) => {
    const r = RUNGS.find((x) => x.id === p.id);
    const hevc = r.codec === 'hevc';
    const keepHdr = hdr && hevc;
    const fit = `w='min(${r.w},iw)':h='min(${r.h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    if (hdr && !keepHdr) {
      /* se achica primero en la GPU (CUDA) y solo el cuadro chico pasa a libplacebo (Vulkan) para HDR→SDR: bajar el 4K
       * entero por cada calidad era lo que frenaba */
      chains.push(`[s${i}]scale_cuda=${fit}:interp_algo=lanczos:format=p010,hwdownload,format=p010le,libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p[v${i}]`);
    } else {
      chains.push(`[s${i}]scale_cuda=${fit}:interp_algo=lanczos:format=${keepHdr ? 'p010' : 'nv12'}[v${i}]`);
    }
  });
  a.push('-filter_complex', chains.join(';'));
  steps.forEach((p, i) => {
    const r = RUNGS.find((x) => x.id === p.id);
    const hevc = r.codec === 'hevc';
    const keepHdr = hdr && hevc;
    const kbps = p.kbps;
    a.push('-map', `[v${i}]`, '-c:v', hevc ? 'hevc_nvenc' : 'h264_nvenc', ...NVENC_Q,
      '-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.6) + 'k', '-bufsize', kbps * 2 + 'k');
    if (hevc) {
      a.push('-tag:v', 'hvc1');
      if (keepHdr) a.push('-profile:v', 'main10', '-color_primaries', 'bt2020', '-color_trc', src.video.transfer, '-colorspace', 'bt2020nc');
      else a.push('-profile:v', 'main');
    } else {
      a.push('-profile:v', 'high', '-level:v', r.h > 720 ? '4.1' : '3.1');
    }
    a.push('-force_key_frames', 'expr:gte(t,n_forced*2)', '-forced-idr', '1');
    /* audio: el mismo de siempre en cada archivo */
    let ai = 0;
    if (xa) {
      a.push('-map', `1:a:${Number(xa.track) || 0}`, '-c:a:0', 'aac', '-b:a:0', '384k', '-metadata:s:a:0', 'language=spa', '-metadata:s:a:0', 'title=' + (xa.title || 'Español'), '-disposition:a:0', 'default');
      ai = 1;
    }
    pickAudios(src, opts).forEach((au) => {
      const k = ai++;
      a.push('-map', `0:${au.index}`);
      if (au.copy) a.push(`-c:a:${k}`, 'copy');
      else a.push(`-c:a:${k}`, 'aac', `-b:a:${k}`, '192k', `-ac:a:${k}`, '2');
      if (xa) a.push(`-disposition:a:${k}`, '0');
    });
    const imageSubs = opts.mkv ? pickSubs(src, opts).filter((x) => !x.text) : [];
    if (imageSubs.length) {
      imageSubs.forEach((x) => a.push('-map', `0:${x.index}`));
      a.push('-c:s', 'copy');
    }
    a.push('-map_metadata', '0', '-map_chapters', '0');
    if (!opts.mkv) a.push('-movflags', '+faststart');
    a.push(outs[i]);
  });
  return a;
}

/* Subtítulos aparte, como en el streaming: un .srt por idioma que comparten TODAS las calidades.
 * «Nombre (2015).spa.srt», «Nombre (2015).eng.srt», «Nombre (2015).spa.forzados.srt»; si hay dos del mismo idioma, el
 * segundo es «.eng.2.srt». Salen del .srt que se eligió (español / inglés) y de los de texto del original. */
const ISO3 = { es: 'spa', esp: 'spa', lat: 'spa', en: 'eng', pt: 'por', fr: 'fre', fra: 'fre', it: 'ita', de: 'ger', deu: 'ger', ja: 'jpn', ko: 'kor', zh: 'chi', zho: 'chi', ru: 'rus' };
export function lang3(c) { c = String(c || '').toLowerCase().trim(); return ISO3[c] || (/^[a-z]{3}$/.test(c) ? c : 'und'); }
export function extractSubs(src, opts, outDir, base, dur) {
  const list = [];
  if (opts.extraSub && opts.extraSub.path) list.push({ input: opts.extraSub.path, map: '0:s:0', lang: 'spa', forced: false });
  if (opts.extraSubEn && opts.extraSubEn.path) list.push({ input: opts.extraSubEn.path, map: '0:s:0', lang: 'eng', forced: false });
  pickSubs(src, opts).filter((s) => s.text).forEach((s) => list.push({ input: src.file, map: `0:${s.index}`, lang: lang3(s.lang), forced: s.forced || /forz|forced/i.test(s.title) }));
  const used = {};
  list.forEach((x) => {
    const k = x.lang + (x.forced ? '.forzados' : '');
    used[k] = (used[k] || 0) + 1;
    x.name = `${base}.${k}${used[k] > 1 ? '.' + used[k] : ''}.srt`;
    x.file = join(outDir, x.name);
  });
  /* las del mismo archivo salen en UNA pasada (un video de varios GB se lee una sola vez); si esa falla, una por una */
  const run = (input, items) => {
    const args = ['-hide_banner', '-v', 'error', '-y', '-i', input];
    items.forEach((x) => {
      args.push('-map', x.map);
      if (opts.testSeconds) args.push('-t', String(dur));
      args.push('-c:s', 'srt', x.file);
    });
    return spawnSync('ffmpeg', args, { encoding: 'utf8', windowsHide: true }).status === 0;
  };
  const inputs = [...new Set(list.map((x) => x.input))];
  inputs.forEach((input) => {
    const items = list.filter((x) => x.input === input);
    if (!run(input, items) && items.length > 1) items.forEach((x) => run(input, [x]));
  });
  const out = [];
  list.forEach((x) => {
    if (existsSync(x.file) && statSync(x.file).size > 0) out.push({ file: x.file, name: x.name, lang: x.lang, forced: x.forced, size: statSync(x.file).size });
    else { try { if (existsSync(x.file)) unlinkSync(x.file); } catch { /* nada */ } }
  });
  /* Muchos originales traen los forzados (carteles, diálogos en otro idioma) sin la marca: una segunda pista del mismo
   * idioma con muy pocas líneas al lado de la completa. Se marcan y se renombran «….spa.forzados.srt». */
  const cues = (f) => { try { return (readFileSync(f, 'utf8').match(/-->/g) || []).length; } catch { return 0; } };
  out.forEach((x) => { x.cues = cues(x.file); });
  out.forEach((x) => {
    if (x.forced) return;
    const top = Math.max(...out.filter((y) => y.lang === x.lang && !y.forced).map((y) => y.cues));
    if (top >= 200 && x.cues < top * 0.2) {
      const others = out.filter((y) => y.lang === x.lang && y.forced).length;
      const name = `${base}.${x.lang}.forzados${others ? '.' + (others + 1) : ''}.srt`;
      const file = join(outDir, name);
      try { renameSync(x.file, file); x.file = file; x.name = name; x.forced = true; } catch { /* queda como está */ }
    }
  });
  out.forEach((x) => { delete x.cues; });
  return out;
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

/* Copia directa y cortes en UNA sola pasada (lee y escribe la película una vez): se arman los argumentos de siempre y
 * la salida pasa por el «segment» de ffmpeg con cortes según el peso esperado. Devuelve las partes o null si alguna se
 * pasó del tope (entonces se hace en dos pasos: copiar y luego cortar con márgenes más amplios). */
async function copyInParts(args, p, dur, limit, nameFor, job, onPct) {
  const ext = extname(args[args.length - 1]);
  const mp4 = /\.(mp4|m4v|mov)$/i.test(ext);
  const a = args.slice(0, -1);
  const mf = a.indexOf('-movflags');
  if (mf >= 0) a.splice(mf, 2);
  const perSec = p.bytes / dur;
  const chunk = limit * 0.96;
  const n = Math.max(2, Math.ceil(p.bytes / chunk));
  const times = [];
  for (let k = 1; k < n; k += 1) times.push(((k * chunk) / perSec).toFixed(3));
  const tmpDir = join(dirname(nameFor(1, n)), '.copiando-' + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  a.push('-f', 'segment', '-segment_times', times.join(','), '-reset_timestamps', '1');
  if (mp4) a.push('-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart');
  a.push(join(tmpDir, 'p%02d' + ext));
  const clean = () => {
    readdirSync(tmpDir).forEach((f) => { try { unlinkSync(join(tmpDir, f)); } catch { /* nada */ } });
    try { rmdirSync(tmpDir); } catch { /* nada */ }
  };
  job.current = tmpDir;
  try { await encode(a, dur, (pr) => onPct(pr.pct, pr), job); } catch (e) { clean(); throw e; }
  const out = readdirSync(tmpDir).filter((f) => /^p\d+/.test(f)).sort().map((f) => join(tmpDir, f));
  if (out.length !== n || !out.every((f) => statSync(f).size <= limit)) { clean(); return null; }
  const files = out.map((f, i) => {
    const dest = nameFor(i + 1, n);
    renameSync(f, dest);
    return { file: dest, size: statSync(dest).size };
  });
  clean();
  return files;
}

/* Corta un archivo (ya copiado) en partes que quepan en Telegram, sin recodificar: cortes en cuadros clave, la parte 1 lo
 * más grande que quepa y lo que sobra al final. Si un corte cae lejos de un cuadro clave y una parte se pasa, se prueba
 * con cortes un poco antes. nameFor(i, n) da el nombre de cada parte. */
async function splitCopy(file, limit, nameFor, job, onPct) {
  const size = statSync(file).size;
  const dur = Number(ffprobeJson(file).format.duration) || 0;
  const mp4 = /\.(mp4|m4v|mov)$/i.test(file);
  const ext = extname(file);
  for (const fill of [0.96, 0.92, 0.87, 0.8, 0.7]) {
    const chunk = limit * fill;
    const n = Math.ceil(size / chunk);
    const times = [];
    for (let k = 1; k < n; k += 1) times.push(((dur * k * chunk) / size).toFixed(3));
    const tmpDir = join(dirname(file), '.partiendo-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const args = ['-hide_banner', '-y', '-nostats', '-progress', 'pipe:1', '-i', file, '-map', '0', '-map_chapters', '-1', '-c', 'copy', '-f', 'segment', '-segment_times', times.join(','), '-reset_timestamps', '1'];
    if (mp4) args.push('-segment_format', 'mp4', '-segment_format_options', 'movflags=+faststart');
    args.push(join(tmpDir, 'p%02d' + ext));
    let failed = null;
    try { await encode(args, dur, (pr) => onPct(pr.pct), job); } catch (e) { failed = e; }
    const out = readdirSync(tmpDir).filter((f) => /^p\d+/.test(f)).sort().map((f) => join(tmpDir, f));
    const ok = !failed && out.length === n && out.every((f) => statSync(f).size <= limit);
    if (!ok) {
      out.forEach((f) => { try { unlinkSync(f); } catch { /* nada */ } });
      try { rmdirSync(tmpDir); } catch { /* nada */ }
      if (failed) throw failed;
      continue;
    }
    const files = out.map((f, i) => {
      const dest = nameFor(i + 1, n);
      renameSync(f, dest);
      return { file: dest, size: statSync(dest).size };
    });
    try { rmdirSync(tmpDir); } catch { /* nada */ }
    return files;
  }
  throw new Error('No pude partirlo en partes que quepan sin recodificar.');
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
    const limit = Number(opts.limitBytesTest) || limitBytes(opts.limitGb); // limitBytesTest: solo para pruebas del corte en partes
    const text = caption(opts);
    const gpuTotal = !!(gpu && opts.gpuTotal !== false && steps.some((x) => !x.copy) && canFullGpu(src));
    emit({ type: 'start', outDir, gpu, gpuTotal, steps, caption: text });
    /* subtítulos aparte primero (son segundos): sirven para todas las calidades, también las que ya están en el grupo */
    const subs = extractSubs(src, opts, outDir, base, dur);
    emit({ type: 'subs', files: subs.map((x) => ({ name: x.name, lang: x.lang, forced: x.forced, size: x.size })) });
    const results = [];
    /* todo en la tarjeta, todas juntas (si se puede); lo que no salga así se hace por el camino de siempre */
    const gpuDone = new Set();
    const enc = steps.map((p, i) => ({ p, i })).filter((x) => !x.p.copy);
    if (gpu && opts.gpuTotal !== false && enc.length && canFullGpu(src)) {
      const tmps = enc.map((x) => join(outDir, `${base} [${x.p.file}].tmp${ext}`));
      enc.forEach((x) => emit({ type: 'rung-start', id: x.p.id, index: x.i, kbps: x.p.kbps, parts: x.p.parts, together: true }));
      job.current = tmps[0];
      try {
        await encode(gpuAllArgs(src, enc.map((x) => x.p), opts, tmps, dur), dur, (pr) => enc.forEach((x) => emit({
          type: 'progress', id: x.p.id, index: x.i, part: 0, parts: 1, pct: pr.pct, left: pr.left, speed: pr.speed, elapsed: pr.elapsed, together: true,
        })), job);
        for (const [k, x] of enc.entries()) {
          const files = [];
          const size = statSync(tmps[k]).size;
          if (size <= limit || opts.split === false) {
            const out = join(outDir, `${base} [${x.p.file}]${ext}`);
            renameSync(tmps[k], out);
            files.push({ file: out, size, over: size > limit });
          } else {
            const parts = await splitCopy(tmps[k], limit, (q, m) => join(outDir, `${base} [${x.p.file}] parte ${q} de ${m}${ext}`), job,
              (pct) => emit({ type: 'progress', id: x.p.id, index: x.i, part: 0, parts: 1, pct: 99, left: 0, speed: '', elapsed: 0 }));
            unlinkSync(tmps[k]);
            parts.forEach((f) => files.push({ file: f.file, size: f.size, over: false }));
          }
          const total = files.reduce((m, f) => m + f.size, 0);
          files.forEach((f) => results.push({ id: x.p.id, name: x.p.name, file: f.file, size: f.size, kbps: x.p.kbps, over: f.over }));
          emit({ type: 'rung-done', id: x.p.id, index: x.i, size: total, over: files.some((f) => f.over), parts: files.length, files: files.map((f) => basename(f.file)) });
          gpuDone.add(x.p.id);
        }
      } catch (e) {
        tmps.forEach((t) => { try { if (existsSync(t)) unlinkSync(t); } catch { /* nada */ } });
        if (e.cancelled) throw e;
        emit({ type: 'retry', id: enc[0].p.id, index: enc[0].i, message: 'La tarjeta no pudo hacerlo todo junta; sigo una por una. ' + String(e.message || e).split('\n').pop() });
      }
      job.current = null;
    }
    for (let i = 0; i < steps.length; i += 1) {
      const p = steps[i];
      if (gpuDone.has(p.id)) continue;
      let kbps = p.kbps;
      const files = [];
      emit({ type: 'rung-start', id: p.id, index: i, kbps, parts: p.parts, copy: !!p.copy });
      try {
        if (p.copy) {
          /* copia directa: un archivo con el video tal cual (pistas y subtítulos como en las demás) y, si se pasa del
           * tope, se corta sin recodificar */
          const whole = join(outDir, `${base} [${p.file}].tmp${ext}`);
          const partName = (k, n) => join(outDir, `${base} [${p.file}] parte ${k} de ${n}${ext}`);
          /* lo normal: copiar y cortar en una sola pasada */
          const direct = p.parts > 1 && opts.split !== false
            ? await copyInParts(ffmpegArgs(src, p, opts, whole, kbps, false, { start: 0, len: dur }), p, dur, limit, partName, job,
              (pct, pr) => emit({ type: 'progress', id: p.id, index: i, part: 0, parts: 1, pct, left: pr.left, speed: pr.speed, elapsed: pr.elapsed, copy: true }))
            : null;
          if (direct) direct.forEach((f) => files.push({ file: f.file, size: f.size, over: false }));
          job.current = whole;
          if (!direct) try {
            await encode(ffmpegArgs(src, p, opts, whole, kbps, false, { start: 0, len: dur }), dur, (pr) => emit({
              type: 'progress', id: p.id, index: i, part: 0, parts: 1, pct: pr.pct * (p.parts > 1 ? 0.6 : 1), left: pr.left, speed: pr.speed, elapsed: pr.elapsed, copy: true,
            }), job);
            const wsize = statSync(whole).size;
            if (wsize <= limit || opts.split === false) {
              const out = join(outDir, `${base} [${p.file}]${ext}`);
              renameSync(whole, out);
              files.push({ file: out, size: wsize, over: wsize > limit });
            } else {
              const parts = await splitCopy(whole, limit, (k, n) => join(outDir, `${base} [${p.file}] parte ${k} de ${n}${ext}`), job,
                (pct) => emit({ type: 'progress', id: p.id, index: i, part: 0, parts: 1, pct: 60 + pct * 0.4, left: 0, speed: '', elapsed: 0, copy: true }));
              unlinkSync(whole);
              parts.forEach((f) => files.push({ file: f.file, size: f.size, over: false }));
            }
          } catch (e) {
            try { if (existsSync(whole)) unlinkSync(whole); } catch { /* nada */ }
            throw e;
          }
        }
        for (let j = 0; j < (p.copy ? 0 : p.parts); j += 1) {
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
    emit({ type: 'done', outDir, results: results.map((r) => ({ ...r, file: basename(r.file) })), subs: subs.map((x) => x.name), caption: text });
    return { outDir, results, subs, caption: text };
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
