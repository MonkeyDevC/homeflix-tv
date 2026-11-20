// Rapidez del canal Anime en la app: inicio en UNA petición, capítulos al instante y fuentes adelantadas: node tools/test-anime-inicio.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
const llamadas = [];
const json = (obj, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(obj) });
const tarjeta = (id, nombre, extra = {}) => ({ id, title: { romaji: nombre, english: nombre }, coverImage: { large: 'https://img.test/l' + id + '.jpg' }, bannerImage: '', format: 'TV', seasonYear: 2020, episodes: 12, duration: 24, status: 'FINISHED', averageScore: 80, genres: ['Action'], ...extra });

const sandbox = {
  window: { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } },
  HFSync: { server: 'https://srv.test/productos/HomeFlix', key: () => Promise.resolve('K'.repeat(43)), now: () => Promise.resolve() },
  HFLibrary: { enabledSources: () => ({ anime: 'Anime' }), accountId: () => 'acc' },
  fetch: (url) => {
    const p = new URL(url).pathname.replace('/productos/HomeFlix/api/v1/anime', '');
    llamadas.push(p + new URL(url).search);
    if (p === '/inicio') return json({
      filas: { trending: [tarjeta(1, 'Uno', { episodes: 0, nextAiringEpisode: { episode: 8 } })], popular: [tarjeta(2, 'Dos')], 'g-accion': [tarjeta(3, 'Tres')] },
      idiomas: { es: [tarjeta(2, 'Dos')], dub: [], en: [tarjeta(3, 'Tres')], total: 10, sondeados: 4 },
    });
    if (p === '/episodes/2') return json({ anilistId: 2, episodios: [{ n: 1, titulo: 'Piloto', imagen: '', minutos: 22, relleno: false, fecha: '' }, { n: 2, titulo: 'Dos', imagen: '', minutos: 22, relleno: false, fecha: '' }], doblados: [1] });
    if (p === '/info/2') return json({ id: 2, title: { romaji: 'Dos', english: 'Dos' }, description: 'Ficha larga', coverImage: {}, genres: [], episodes: 12, duration: 24 });
    if (p === '/reproducir') return json({ streams: [] });
    return json({ error: 'no' }, 404);
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'anime.js'), 'utf8') + '\nthis.HFAnime = HFAnime;', sandbox);
const A = sandbox.HFAnime;

// 1) El inicio entero llega en UNA petición (antes eran 11) y ya trae las filas por idioma
let cambios = 0;
assert.equal(await A.refresh(() => { cambios += 1; }, true), true);
assert.equal(llamadas.length, 1, 'una sola petición');
assert.equal(llamadas[0], '/inicio');
assert.equal(cambios, 1, 'y se avisa a la pantalla una sola vez (no una por fila: eso reiniciaba las filas mientras se navegaba)');
const filas = A.rows();
assert.equal(JSON.stringify(filas.map((r) => r.name)), JSON.stringify(['En tendencia', 'Con subtítulos en español', 'Los más populares', 'Acción', 'Japonés con subtítulos en inglés']));
assert.equal(filas[0].titles[0].imageKey, 'https://img.test/l1.jpg', 'portada liviana («large»)');
assert.equal(filas[0].titles[0].episodeCount, 7, 'en emisión: los ya salidos');

// 2) Capítulos AL INSTANTE: sin esperar a /episodes (hasta 20 s)
const uno = A.rows()[0].titles[0];
assert.equal(A.quick(uno), true);
assert.equal(uno.loaded, true);
assert.equal(uno.provisional, true);
assert.equal(uno.seasons[0].episodes.length, 7);
assert.equal(uno.seasons[0].episodes[2].key, 'anime:1:3');
assert.equal(llamadas.filter((c) => c.startsWith('/episodes')).length, 0, 'no se pidió nada para mostrarlos');
const sinCuenta = A.rows()[2].titles[0]; // «Dos» (12 capítulos)
assert.equal(A.quick(sinCuenta), true);
assert.equal(sinCuenta.seasons[0].episodes.length, 12);

// 3) La lista real reemplaza a la provisional (con títulos) cuando llega; la ficha va aparte
await A.ensure(sinCuenta);
assert.equal(sinCuenta.provisional, false);
assert.equal(sinCuenta.seasons[0].episodes.length, 2);
assert.equal(sinCuenta.seasons[0].episodes[0].title, 'Piloto');
assert.equal(sinCuenta.seasons[0].episodes[0].dub, true);
await A.info(sinCuenta);
assert.equal(sinCuenta.description, 'Ficha larga');
assert.equal(A.quick({ anime: true, loaded: false, episodeCount: 0, seasons: [] }), false, 'sin cuántos son no se inventa nada');

// 4) Adelantar la fuente: una vez por capítulo, y el «siguiente» sale de la misma lista
const ep1 = sinCuenta.seasons[0].episodes[0];
const antes = llamadas.filter((c) => c.startsWith('/reproducir')).length;
A.prefetch(ep1);
A.prefetch(ep1);
await new Promise((r) => setTimeout(r, 10));
assert.equal(llamadas.filter((c) => c.startsWith('/reproducir')).length, antes + 1, 'no repite');
assert.ok(llamadas.some((c) => c.includes('e=1') && c.includes('type=sub')));
A.prefetchNext(ep1);
await new Promise((r) => setTimeout(r, 10));
assert.ok(llamadas.some((c) => c.includes('e=2')), 'el siguiente capítulo también');

console.log('OK: inicio en una petición, capítulos al instante y fuentes adelantadas');
