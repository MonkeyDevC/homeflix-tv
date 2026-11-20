// Prueba del corte por peso real (tools/preparador/prepare.mjs → fixOversize): arma un video de prueba cuyo peso por segundo cambia mucho
// (quieto, ruido, quieto), lo parte por tiempo como hacía el preparador (una parte se pasa del tope) y comprueba que fixOversize
// vuelve a cortar solo la parte pasada: todas caben, ninguna se pierde y siguen en orden. Uso: node tools/test-corte.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixOversize } from './preparador/prepare.mjs';

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok  ' : ' FALLA ') + msg); if (!cond) fallos += 1; };
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr); };
const dur = (f) => Number(JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', f], { encoding: 'utf8' }).stdout).format.duration);

const dir = mkdtempSync(join(tmpdir(), 'hf-corte-'));
try {
  // 60 s: 20 s casi sin detalle, 20 s de ruido (pesado), 20 s casi sin detalle; fotograma clave cada 1 s
  const src = join(dir, 'origen.mp4');
  ff(['-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=25:d=20', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=25:d=20,noise=alls=80:allf=t+u', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=25:d=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', '25', '-keyint_min', '25', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '64k', '-shortest', src]);
  const total = statSync(src).size;
  const d0 = dur(src);
  console.log(`origen: ${(total / 1048576).toFixed(1)} MB, ${d0.toFixed(1)} s`);

  // corte por tiempo en 3 partes iguales (lo que hacía antes): la del medio (ruido) pesa muchísimo más
  const work = join(dir, 'trabajo');
  spawnSync(process.platform === 'win32' ? 'cmd' : 'mkdir', process.platform === 'win32' ? ['/c', 'mkdir', work] : ['-p', work]);
  ff(['-i', src, '-map', '0', '-c', 'copy', '-f', 'segment', '-segment_times', '20,40', '-reset_timestamps', '1', '-segment_format_options', 'movflags=+faststart', join(work, 'p%02d.mp4')]);
  const partes = readdirSync(work).filter((f) => /^p\d+\.mp4$/.test(f)).sort().map((f) => join(work, f));
  const tam = partes.map((f) => statSync(f).size);
  console.log('partes por tiempo (MB): ' + tam.map((n) => (n / 1048576).toFixed(2)).join(' · '));
  ok(partes.length === 3, 'el corte por tiempo da 3 partes');
  ok(tam[1] > tam[0] * 3, 'la parte del medio pesa mucho más (por eso se pasaba del tope)');

  // tope: un poco menos que la parte del medio, pero más que las otras
  const limit = Math.floor(tam[1] * 0.7);
  ok(tam[0] < limit && tam[2] < limit && tam[1] > limit, 'solo la parte del medio se pasa del tope de prueba (' + (limit / 1048576).toFixed(2) + ' MB)');

  const job = { proc: null, cancelled: false };
  const arreglado = await fixOversize(partes, limit, work, job);
  ok(!!arreglado, 'fixOversize devuelve las partes');
  if (arreglado) {
    ok(arreglado.length > 3, 'la parte pasada se cortó en más partes (' + arreglado.length + ' en total)');
    ok(arreglado.every((f) => statSync(f).size <= limit), 'todas las partes caben en el tope');
    ok(arreglado[0] === partes[0] && arreglado[arreglado.length - 1] === partes[2], 'la primera y la última no se tocaron y el orden se conserva');
    const suma = arreglado.reduce((n, f) => n + dur(f), 0);
    ok(Math.abs(suma - d0) < 1.5, `no se pierde ni se repite video: suma de duraciones ${suma.toFixed(1)} s ≈ ${d0.toFixed(1)} s`);
    ok(arreglado.every((f) => dur(f) > 1), 'ninguna parte quedó vacía');
    ok(readdirSync(work).filter((f) => /^p\d+\.mp4$/.test(f)).length === 2, 'la parte pasada original se borró');
  }

  // si nada se pasa, no toca nada
  const j2 = { proc: null, cancelled: false };
  const igual = await fixOversize(arreglado || partes, limit, work, j2);
  ok(!!igual && igual.length === (arreglado || partes).length, 'si ya todo cabe, no vuelve a cortar nada');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(fallos ? `\n${fallos} comprobación(es) fallaron` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
