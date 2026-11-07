// Portadas propias del fondo animado (pantalla inicial y login).
// Pon tus imágenes en images/portadas/ (jpg, jpeg, png o webp, en vertical tipo póster 2:3).
// Una app de TV no puede listar carpetas, así que serve.mjs y build-wgt.mjs generan js/portadas.js con la lista.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PORTADAS_DIR = 'images/portadas';
const IMG = /\.(jpe?g|png|webp)$/i;

export function listPortadas(root) {
  const dir = join(root, PORTADAS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => IMG.test(f) && !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((f) => PORTADAS_DIR + '/' + f);
}

export function portadasJs(root) {
  return '/* Generado al empaquetar: imágenes de ' + PORTADAS_DIR + '/ */\nvar HF_PORTADAS = ' + JSON.stringify(listPortadas(root)) + ';\n';
}
