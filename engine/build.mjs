// Compila el motor de Telegram (mtcute + QR) en un solo script clásico: ../js/tg.bundle.js (global window.TGLib).
// Adaptado de build/bundle.sh de titlog/telegram-tizen (MIT, ver LICENSE.telegram-tizen) para que corra en Windows sin zsh.
// Uso (desde la carpeta engine/):  npm ci   y luego   node build.mjs
//
// Pasos:
//  1. wasm-opt (binaryen) baja mtcute.wasm a WebAssembly MVP: Tizen 5.5 (Chromium 69) no entiende instrucciones más nuevas.
//  2. esbuild empaqueta src/worker.js (mtcute en segundo plano) como texto.
//  3. esbuild empaqueta src/entry.js, que lleva dentro el worker y las dos versiones del wasm.
// El resultado necesita BigInt (Tizen 5.5 o más nuevo). La versión para Tizen 5.0 (tg.legacy.js) todavía no se arma.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(fileURLToPath(import.meta.url), '..');
const out = join(here, '..', 'js', 'tg.bundle.js');
const TARGET = 'chrome69';
const bin = (name) => join(here, 'node_modules', '.bin', process.platform === 'win32' ? name + '.cmd' : name);
const run = (name, args) => execFileSync(bin(name), args, { cwd: here, stdio: 'inherit', shell: process.platform === 'win32' });

mkdirSync(join(here, 'out'), { recursive: true });

console.log('1/3 wasm → MVP');
run('wasm-opt', ['node_modules/@mtcute/wasm/mtcute.wasm',
  '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '--enable-mutable-globals',
  '--llvm-nontrapping-fptoint-lowering', '--signext-lowering', '--llvm-memory-copy-fill-lowering', '-o', 'out/mtcute-mvp.wasm']);
run('wasm-opt', ['-q', 'out/mtcute-mvp.wasm', '--mvp-features', '-o', 'out/mvp-check.wasm']);

const common = ['--bundle', '--format=iife', `--target=${TARGET}`, '--loader:.wasm=binary', '--minify', '--legal-comments=none', '--log-level=warning'];

console.log('2/3 worker');
run('esbuild', ['src/worker.js', ...common, '--outfile=out/worker.bundle.txt']);

console.log('3/3 tg.bundle.js');
run('esbuild', ['src/entry.js', ...common, '--loader:.txt=text', `--outfile=${out}`]);

console.log(`listo: js/tg.bundle.js (${(statSync(out).size / 1024).toFixed(0)} KB)`);
