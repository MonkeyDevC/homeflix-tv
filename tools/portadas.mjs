// Imágenes propias de la app, sin tocar código:
//   images/portadas/  → fondo animado de la pantalla inicial y el login (vertical tipo póster 2:3)
//   images/avatares/  → imágenes de perfil (cuadradas)
// Una app de TV no puede listar carpetas, así que serve.mjs y build-wgt.mjs generan js/imagenes.js con las listas.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PORTADAS_DIR = 'images/portadas';
export const AVATARES_DIR = 'images/avatares';
export const IMAGENES_JS = 'js/imagenes.js';
const IMG = /\.(jpe?g|png|webp)$/i;

function listDir(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => IMG.test(f) && !f.startsWith('.'))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((f) => dir + '/' + f);
}

export const listPortadas = (root) => listDir(root, PORTADAS_DIR);
export const listAvatares = (root) => listDir(root, AVATARES_DIR);

export function imagenesJs(root) {
  return '/* Generado al empaquetar: imágenes de ' + PORTADAS_DIR + '/ y ' + AVATARES_DIR + '/ */\n' +
    'var HF_PORTADAS = ' + JSON.stringify(listPortadas(root)) + ';\n' +
    'var HF_AVATARES = ' + JSON.stringify(listAvatares(root)) + ';\n';
}
