// Pruebas del canal «Anime» del lado de la app (js/anime.js) con un servidor falso: node tools/test-anime.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
const llamadas = [];
let sources = { anime: 'Anime' };

const pedido = (path) => new URL(path, 'https://srv.test').pathname.replace('/productos/HomeFlix/api/v1/anime', '');
const json = (obj, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(obj) });

const eps = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, titulo: 'Capítulo ' + (i + 1), imagen: 'https://serveproxy.com/url?url=' + encodeURIComponent('https://img.test/e' + (i + 1) + '.jpg'), minutos: 24, relleno: false, fecha: '' }));

const sandbox = {
  window: { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } },
  HFSync: { server: 'https://srv.test/productos/HomeFlix', key: () => Promise.resolve('K'.repeat(43)), now: () => Promise.resolve() },
  HFLibrary: { enabledSources: () => sources, accountId: () => 'acc' },
  fetch: (url, opts) => {
    const p = pedido(url);
    llamadas.push({ p, auth: opts && opts.headers && opts.headers.authorization });
    if (p.startsWith('/trending')) return json({ results: [
      { id: 21, title: { romaji: 'ONE PIECE', english: 'One Piece' }, coverImage: { extraLarge: 'https://serveproxy.com/url?url=' + encodeURIComponent('https://img.test/c21.jpg') }, bannerImage: '', format: 'TV', status: 'RELEASING', seasonYear: 1999, averageScore: 87, genres: ['Action'], episodes: null, duration: 24, isAdult: false, nextAiringEpisode: { episode: 1181 } },
      { id: 666, title: { romaji: 'Adulto' }, isAdult: true },
    ] });
    if (p === '/idiomas') return json({ total: 40, sondeados: 33,
      es: [{ id: 113415, title: { romaji: 'Jujutsu Kaisen', english: 'JUJUTSU KAISEN' }, coverImage: {}, format: 'TV', seasonYear: 2020, averageScore: 85, genres: [] }],
      dub: [{ id: 21, title: { romaji: 'ONE PIECE', english: 'One Piece' }, coverImage: {}, format: 'TV', seasonYear: 1999, averageScore: 87, genres: [] }],
      en: [{ id: 1535, title: { romaji: 'Death Note' }, coverImage: {}, format: 'TV', seasonYear: 2006, averageScore: 84, genres: [] }] });
    if (p.startsWith('/search')) return json({ results: [{ id: 154587, title: { romaji: 'Sousou no Frieren', english: 'Frieren' }, coverImage: {}, format: 'TV', seasonYear: 2023, genres: [] }] });
    if (p === '/episodes/21') return json({ anilistId: 21, episodios: eps(120), doblados: [1, 2] });
    if (p === '/info/21') return json({ id: 21, title: { romaji: 'ONE PIECE', english: 'One Piece' }, description: 'Piratas.<br>Más<br><br><br><br>texto', coverImage: {}, genres: ['Action'], episodes: 0, duration: 24 });
    if (p === '/reproducir') return json({ streams: [{ servidor: 'HD-1', audio: 'sub', tipo: 'mp4', url: '/productos/HomeFlix/anime/p/1.x/seg?u=a', subtitulos: [
      { idioma: 'English (Full Subtitles (Restyled))', formato: 'ass', defecto: true, url: '/productos/HomeFlix/anime/p/1.x/sub?u=1' },
      { idioma: 'English (Dubtitle(AI))', formato: 'srt', defecto: false, url: '/productos/HomeFlix/anime/p/1.x/sub?u=2' },
      { idioma: 'Spanish', formato: 'srt', defecto: false, url: 'https://otro.test/s.srt' },
    ] }] });
    return json({ error: 'no' }, 404);
  },
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'anime.js'), 'utf8') + '\nthis.HFAnime = HFAnime;', sandbox);
const A = sandbox.HFAnime;

assert.equal(A.SOURCE, 'anime');
assert.equal(A.enabled(), true);
sources = {};
assert.equal(A.enabled(), false, 'sin el canal activo en el perfil no hay anime');
assert.equal(A.mergeInto({ titles: {}, byKey: {} }).anime.length, 0);
sources = { anime: 'Anime' };

// Lista de inicio: lleva la llave de la cuenta, descarta lo adulto y desenvuelve las portadas
let cambios = 0;
assert.equal(await A.refresh(() => { cambios += 1; }, true), true);
assert.ok(llamadas.every((c) => c.auth === 'Bearer ' + 'K'.repeat(43)), 'todas las peticiones van con la llave de la cuenta');
const rows = A.rows();
assert.equal(rows[0].name, 'En tendencia');
assert.equal(rows[0].titles.length, 1, 'el título adulto no entra');
const op = rows[0].titles[0];
assert.equal(JSON.stringify(rows.slice(0, 3).map((r) => r.name)), JSON.stringify(['En tendencia', 'Con subtítulos en español', 'Doblados al inglés']), 'filas por idioma junto a las de siempre');
assert.equal(rows[rows.length - 1].name, 'Japonés con subtítulos en inglés', 'inglés al final');
assert.equal(rows[1].note, '1 · 33 de 40 revisados');
assert.equal(rows[1].titles[0].es, true, 'los de la fila en español llevan la marca «ES»');
assert.equal(op.es, false);
assert.ok(A.byKey('a:113415'), 'y se pueden abrir');
assert.equal(op.titleKey, 'a:21');
assert.equal(op.name, 'One Piece');
assert.equal(op.imageKey, 'https://img.test/c21.jpg', 'la portada sin el proxy');
assert.equal(op.episodeCount, 1180, 'sin total: el último emitido');
assert.equal(op.anime, true);
assert.ok(cambios > 0);

// Se arma la biblioteca del perfil con los animes aparte de Películas y Series
const lib = A.mergeInto({ titles: {}, byKey: {}, movies: [], series: [] });
assert.equal(lib.anime.length, 3, "los de la lista de inicio y los de las filas por idioma");
assert.equal(lib.titles['a:21'], op);
assert.equal(lib.series.length, 0, 'no se mezcla con las series de Telegram');

// Capítulos: bloques de 50, claves «anime:<id>:<n>» (el prefijo es el id del chat fijo) y etiqueta «Cap. n»
await A.ensure(op);
assert.equal(op.loaded, true);
assert.equal(op.seasons.length, 3, '120 capítulos → 3 bloques de 50');
assert.equal(op.seasons[0].label, 'Cap. 1–50');
assert.equal(op.seasons[2].label, 'Cap. 101–120');
const ep = op.seasons[1].episodes[0];
assert.equal(ep.key, 'anime:21:51');
assert.equal(ep.video.key, 'anime:21:51');
assert.equal(ep.video.chatId, 'anime');
assert.equal(ep.coverKey, 'https://img.test/e51.jpg');
assert.equal(ep.dub, false);
assert.equal(op.seasons[0].episodes[1].dub, true, 'el doblaje solo donde existe');
assert.equal(A.tag(ep), 'Cap. 51');
assert.equal(op.description, 'Piratas.\nMás\n\ntexto', 'la ficha completa limpia el HTML');
const lib2 = A.mergeInto({ titles: {}, byKey: {}, movies: [], series: [] });
assert.equal(lib2.byKey['anime:21:51'], ep, 'Continuar viendo encuentra el capítulo por su clave de progreso');

// Lo ya consultado queda guardado: tras «reiniciar» la app los capítulos están sin red
A.touch(op);
assert.ok(JSON.parse(store.get('hf.anime.known')).list.some((c) => c.i === 21));
assert.ok(store.has('hf.anime.eps.21'));

// Búsqueda en el catálogo completo; el resultado se encuentra por su clave aunque no esté en la biblioteca
const found = await A.search('Frieren');
assert.equal(found[0].name, 'Frieren');
assert.equal(A.byKey('a:154587'), found[0]);
assert.equal(A.cachedSearch('frieren')[0], found[0]);
assert.equal((await A.search('x')).length, 0, 'menos de 2 letras no busca');

// Video: dirección absoluta del servidor y subtítulos con nombre de idioma en español
const st = await A.stream(ep, 'sub');
assert.equal(st.url, 'https://srv.test/productos/HomeFlix/anime/p/1.x/seg?u=a');
assert.equal(st.tipo, 'mp4');
assert.equal(JSON.stringify(st.subs.map((s) => s.label)), JSON.stringify(['Inglés', 'Inglés · 2', 'Español']));
assert.equal(st.subs[2].lang, 'spa');
assert.equal(st.subs[2].url, 'https://otro.test/s.srt', 'las direcciones completas no se tocan');

// Capítulo suelto que la app no conoce (lo manda el celular a la TV)
const r = await A.resolve(21, 3);
assert.equal(r.item.key, 'anime:21:3');
assert.equal(r.series, op);
await assert.rejects(A.resolve(21, 9999), /no encontró/);

console.log('OK: canal Anime (lista, capítulos, claves, búsqueda, video y subtítulos)');
