// Si el servidor falla, la app NO debe reintentar en bucle (pasó: cada repintado pedía todo otra vez y se bloqueaba con 429).
// node tools/test-anime-fallos.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
let pedidos = 0;
let estado = 429;
const sandbox = {
  window: { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } },
  HFSync: { server: 'https://srv.test/productos/HomeFlix', key: () => Promise.resolve('K'.repeat(43)), now: () => Promise.resolve() },
  HFLibrary: { enabledSources: () => ({ anime: 'Anime' }), accountId: () => 'acc' },
  fetch: () => {
    pedidos += 1;
    if (estado !== 200) return Promise.resolve({ ok: false, status: estado, json: () => Promise.resolve({ error: 'x' }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [{ id: 21, title: { romaji: 'ONE PIECE' }, coverImage: {}, genres: [] }] }) });
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'anime.js'), 'utf8') + '\nthis.HFAnime = HFAnime;', sandbox);
const A = sandbox.HFAnime;

// 1) Todo falla (429): un intento (11 pedidos); los repintados que lo vuelven a pedir no hacen nada hasta pasar la pausa
let cambios = 0;
assert.equal(await A.refresh(() => { cambios += 1; }), false);
const primero = pedidos;
assert.ok(primero > 0 && primero <= 12, 'un solo intento');
assert.match(A.lastError(), /Demasiadas peticiones/, 'el 429 se explica');
for (let i = 0; i < 50; i += 1) await A.refresh(() => { cambios += 1; }); // lo que haría un bucle de repintado
assert.equal(pedidos, primero, '50 repintados seguidos no generan ni un pedido más');

// 2) El botón «Reintentar» (forzar) sí vuelve a intentar, y al funcionar se normaliza
estado = 200;
assert.equal(await A.refresh(() => { cambios += 1; }, true), true);
assert.ok(pedidos > primero);
assert.equal(A.lastError(), '');
assert.equal(A.rows()[0].titles[0].name, 'ONE PIECE');
const despues = pedidos;
await A.refresh(() => {});
assert.equal(pedidos, despues, 'con la lista fresca (30 min) tampoco se vuelve a pedir');

console.log('OK: un fallo del servidor no provoca reintentos en bucle');
