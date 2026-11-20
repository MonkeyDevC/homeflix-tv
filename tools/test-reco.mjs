// Pruebas de las recomendaciones del lado de la app (js/reco.js) con un servidor falso: node tools/test-reco.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
const llamadas = [];
let perfil = { id: 'p1', kids: false };
let estadoEventos = 202;
let caido = false;

const json = (obj, status = 200) => Promise.resolve({ status, json: () => Promise.resolve(obj) });
const espera = () => new Promise((r) => setTimeout(r, 0));
const plano = (x) => JSON.parse(JSON.stringify(x)); // los arreglos del vm son de otro «mundo»

const sandbox = {
  window: { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } },
  document: { hidden: false, addEventListener: () => {} },
  HFSync: { server: 'https://srv.test/productos/HomeFlix', key: () => Promise.resolve('K'.repeat(43)) },
  HFLibrary: { accountId: () => 'acc', currentProfile: () => perfil },
  setTimeout: (fn) => 0, clearTimeout: () => {},
  fetch: (url, opts) => {
    const u = new URL(url);
    llamadas.push({ ruta: u.pathname.replace('/productos/HomeFlix/api/v1/reco', '') + u.search, metodo: opts.method, auth: opts.headers.authorization, cuerpo: opts.body ? JSON.parse(opts.body) : null });
    if (caido) return Promise.reject(new Error('sin red'));
    if (u.pathname.endsWith('/recomendaciones')) return json({ recommendations: [
      { movie_id: 'm:coco:2017', score: 0.9, reasons: [{ type: 'similarity', label: 'Porque viste Toy Story' }] },
      { movie_id: 'm:no esta:2000', score: 0.8, reasons: [] },
      { movie_id: 'm:scream:1996', score: 0.7, reasons: [{ type: 'genre_affinity', label: 'Coincide con tus géneros: Terror' }] },
    ] });
    if (u.pathname.includes('/similares/')) return json({ recommendations: [{ movie_id: 'm:scream:1996', score: 0.5, reasons: [{ type: 'similarity', label: 'Parecida a Coco' }] }] });
    if (u.pathname.endsWith('/eventos')) return json({ recibidos: 1 }, estadoEventos);
    return json({}, 404);
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'reco.js'), 'utf8') + '\nthis.HFReco = HFReco;', sandbox);
const R = sandbox.HFReco;

const library = { titles: {
  'm:coco:2017': { titleKey: 'm:coco:2017', name: 'Coco', kids: true },
  'm:scream:1996': { titleKey: 'm:scream:1996', name: 'Scream', kids: false },
} };

/* 1. Al principio no hay nada (no bloquea) y se pide en segundo plano; al llegar, avisa una sola vez */
let avisos = 0;
R.onChange(() => { avisos += 1; });
assert.deepEqual(plano(R.paraTi(library)), []);
await espera(); await espera(); await espera();
assert.equal(llamadas[0].ruta, '/recomendaciones?perfil=p1&limite=24');
assert.equal(llamadas[0].auth, 'Bearer ' + 'K'.repeat(43));
assert.equal(avisos, 1);
const lista = R.paraTi(library);
assert.deepEqual(plano(lista.map((e) => [e.item.name, e.sub])), [['Coco', 'Porque viste Toy Story'], ['Scream', 'Coincide con tus géneros: Terror']]); // «no esta» no está en sus chats
assert.equal(llamadas.length, 1, 'con caché fresca no vuelve a pedir');
assert.ok(R.huella());

/* 2. Perfil Kids: solo lo infantil, aunque el servidor mande otra cosa */
perfil = { id: 'p2', kids: true };
R.paraTi(library);
await espera(); await espera(); await espera();
assert.deepEqual(plano(R.paraTi(library).map((e) => e.item.name)), ['Coco']);
perfil = { id: 'p1', kids: false };

/* 3. Similares: el titleKey viaja codificado; los videos sin clasificar no piden nada */
assert.deepEqual(plano(R.similares('v:1:2', library)), []);
R.similares('m:coco:2017', library);
await espera(); await espera(); await espera();
assert.equal(llamadas.at(-1).ruta, '/similares/m%3Acoco%3A2017?perfil=p1&limite=12');
assert.deepEqual(plano(R.similares('m:coco:2017', library).map((e) => e.sub)), ['Parecida a Coco']);

/* 4. Eventos: en cola, en lote, sin repetir; un 503 los deja para después */
estadoEventos = 503;
R.click('m:coco:2017');
R.busqueda('  algo   de terror ', 'm:scream:1996');
R.click('v:1:2'); // sin clasificar: no se manda
R.enviar();
await espera(); await espera(); await espera();
let ev = llamadas.filter((l) => l.ruta === '/eventos');
assert.equal(ev.length, 1);
assert.equal(ev[0].cuerpo.perfil, 'p1');
assert.deepEqual(plano(ev[0].cuerpo.eventos.map((e) => [e.tipo, e.title_key, e.consulta])), [['click', 'm:coco:2017', null], ['search', 'm:scream:1996', 'algo de terror']]);
assert.equal(JSON.parse(store.get('hf.reco.cola')).length, 2, '503: siguen en la cola');
estadoEventos = 202;
R.enviar();
await espera(); await espera(); await espera();
ev = llamadas.filter((l) => l.ruta === '/eventos');
assert.equal(ev.length, 2);
assert.deepEqual(plano(ev[1].cuerpo.eventos.map((e) => e.id)), plano(ev[0].cuerpo.eventos.map((e) => e.id)), 'mismo id al reintentar: el motor no duplica');
assert.equal(JSON.parse(store.get('hf.reco.cola')).length, 0);

/* 5. Sin red: la fila sigue con lo guardado y no se reintenta enseguida */
caido = true;
const antes = llamadas.length;
R.similares('m:scream:1996', library);
await espera(); await espera();
R.similares('m:scream:1996', library);
await espera();
assert.equal(llamadas.length, antes + 1, 'tras un fallo espera antes de volver a pedir');

console.log('test-reco: ok');
