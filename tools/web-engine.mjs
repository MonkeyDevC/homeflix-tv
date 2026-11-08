// Para las pruebas de la web en Node: carga el motor compartido (js/library.js) como lo hace la página
// (global HFLibrary) con un almacenamiento en memoria. Importarlo ANTES que web/js/data/library.js.
import { createRequire } from 'node:module';

const mem = new Map();
const localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = globalThis.window || { localStorage };
globalThis.localStorage = globalThis.localStorage || localStorage;
globalThis.HFLibrary = createRequire(import.meta.url)('../js/library.js');
