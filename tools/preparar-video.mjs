// Versión de consola del Preparador de videos (la app con interfaz es «Preparar videos.cmd» en la raíz del proyecto).
// Crea las versiones 4K, 1080p, 720p y 360p de un video para subirlas a Telegram con el mismo comentario.
//
//   node tools/preparar-video.mjs "C:\Videos\toy-story-5.mkv" --titulo "Toy Story 5 (2026)" --infantil
//   node tools/preparar-video.mjs "dark-s01e03.mkv" --serie "Dark" --temporada 1 --capitulo 3 --nombre-capitulo "Pasado y presente"
//
// Opciones: --descripcion "…"  --categorias "Marvel, Acción"  --calidades 2160,1080,720,360  --limite 2|4  --salida carpeta
//           --audio-aac (todo el audio a AAC estéreo, ocupa menos)  --cpu  --mkv  --prueba N (solo N segundos)
//           --4k-mbps 14 (calidad del 4K)  --sin-partes (no dividir: bajar la calidad para que quepa en un archivo)
// Las reglas (partes, HDR, audio, subtítulos) están en tools/preparador/prepare.mjs.
import { probe, plan, prepare, guessTitle } from './preparador/prepare.mjs';

const argv = process.argv.slice(2);
const o = { _: [] };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (['infantil', 'cpu', 'mkv', 'audio-aac', 'sin-partes'].includes(k)) o[k] = true;
    else o[k] = argv[(i += 1)];
  } else o._.push(a);
}
if (!o._[0]) {
  console.log('Uso: node tools/preparar-video.mjs "archivo" --titulo "Nombre (año)"   (o abre «Preparar videos.cmd» para usar la interfaz)');
  process.exit(1);
}

const t = o.titulo ? guessTitle(o.titulo) : { name: '', year: 0 };
const opts = {
  file: o._[0],
  type: o.serie ? 'series' : 'movie',
  name: o.serie || t.name,
  year: t.year,
  season: o.temporada, episode: o.capitulo, episodeTitle: o['nombre-capitulo'],
  description: o.descripcion, kids: !!o.infantil, categories: o.categorias || '',
  qualities: o.calidades ? String(o.calidades).split(',').map((x) => x.trim()) : null,
  limitGb: Number(o.limite) === 4 ? 4 : 2,
  split: !o['sin-partes'], k4Mbps: o['4k-mbps'] ? Number(o['4k-mbps']) : 14,
  audioMode: o['audio-aac'] ? 'aac' : 'auto',
  mkv: !!o.mkv, encoder: o.cpu ? 'cpu' : 'gpu',
  testSeconds: o.prueba ? Number(o.prueba) : 0,
  outDir: o.salida || '',
};

const clock = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const src = probe(opts.file);
console.log(`\nHomeFlix · preparar video\n  Original: ${src.video.width}×${src.video.height} ${src.video.codec}${src.video.hdr ? ' HDR' : ''} · ${clock(src.duration)}`);
plan(src, opts).forEach((p) => console.log(`  ${p.name.padEnd(5)} ${(p.kbps / 1000).toFixed(1)} Mbps · ~${Math.round(p.bytes / 1048576)} MB${p.parts > 1 ? ` en ${p.parts} partes` : ''} · calidad ${p.rating}`));
console.log('');

let names = [];
const { promise } = prepare(opts, (ev) => {
  if (ev.type === 'start') { names = ev.steps.map((s) => s.name); console.log(`  Codificador: ${ev.gpu ? 'tarjeta NVIDIA' : 'procesador'} · carpeta: ${ev.outDir}`); }
  else if (ev.type === 'progress') process.stdout.write(`\r  ${names[ev.index].padEnd(5)} ${ev.parts > 1 ? `parte ${ev.part + 1}/${ev.parts} ` : ''}${ev.pct.toFixed(1).padStart(5)} % · faltan ~${clock(ev.left)}     `);
  else if (ev.type === 'retry') console.log(`\n  ${names[ev.index]}: se pasó del tope, rehaciendo a ${(ev.kbps / 1000).toFixed(1)} Mbps`);
  else if (ev.type === 'rung-done') console.log(`\n    → ${ev.files.join('\n      ')} ·${Math.round(ev.size / 1048576)} MB${ev.over ? '  ⚠ PASA DEL TOPE' : ''}`);
  else if (ev.type === 'rung-error') console.log(`\n  ✖ ${names[ev.index]} falló: ${ev.message}`);
  else if (ev.type === 'done') console.log(`\nListo. Comentario para cada archivo:\n\n  ${ev.caption}\n\nInstrucciones en COMO-SUBIR.txt\n`);
});
promise.catch((e) => { console.error('\n✖ ' + e.message); process.exit(1); });
