// Pruebas del canal «Anime» (src/anime.js): la anime-api y los CDN de video son falsos (se inyecta «pedir»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp, PREFIJO } from '../src/app.js';
import { crearIdiomas } from '../src/anime-idiomas.js';

const LLAVE = 'Qx7_' + 'k'.repeat(40);
const API = 'http://anime-api:8000';
const CDN = 'https://cdn.ejemplo.com/_v8/abc/master.m3u8';

const LISTA = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-KEY:METHOD=AES-128,URI="llave.key"',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000',
  'hd/index.m3u8',
  '#EXTINF:6.0,',
  'https://otro.ejemplo.com/seg/1.ts',
  '',
].join('\n');

function falso(visto) {
  return async (url, opts = {}) => {
    const u = String(url);
    visto.push({ u, h: opts.headers || {} });
    /* animes 77/78/79: animegg responde enseguida con un mp4 SIN subtítulos; anikoto tarda y trae los subtítulos */
    const m = /\/anime\/extract\/(7[789])\?.*provider=([a-z]+)/.exec(u);
    if (m) {
      const [, id, p] = m;
      const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
      if (p === 'animegg') return ok({ provider: 'animegg', streams: [{ url: 'https://mp4.ejemplo.com/v.mp4', type: 'mp4', server: 'Animegg', referer: 'https://www.animegg.org/' }] });
      if (p === 'anikoto' && id !== '79') {
        await new Promise((r) => setTimeout(r, 120));
        const ing = { url: 'https://vault.ejemplo.com/s.srt', label: 'English', srclang: 'en' };
        const esp = { url: 'https://vault.ejemplo.com/e.vtt', label: 'Spanish', srclang: 'es' };
        return ok({ provider: 'anikoto', streams: [{ url: CDN, type: 'hls', server: 'HD-1', audio: 'sub', referer: 'https://flixcloud.cc/', subtitles: id === '77' ? [ing, esp] : [ing] }] });
      }
      return new Response('no', { status: 404 });
    }
    if (u === 'https://mp4.ejemplo.com/v.mp4') return new Response(Buffer.from([0, 0]), { status: 206, headers: { 'content-type': 'video/mp4' } });
    if (u.startsWith(`${API}/anime/trending`)) return new Response(JSON.stringify({ results: [{ id: 1 }] }), { status: 200 });
    if (u.startsWith(`${API}/anime/extract/21`) && /provider=animegg/.test(u)) {
      /* un proveedor da una «lista» cifrada: no sirve y gana otro */
      return new Response(JSON.stringify({ provider: 'cifrado', streams: [{ url: 'https://cdn.ejemplo.com/cifrado.m3u8', type: 'hls', server: 'HD-2', referer: 'https://flixcloud.cc/' }] }), { status: 200 });
    }
    if (u === 'https://cdn.ejemplo.com/cifrado.m3u8') return new Response('jsE/SB6pC5u5o8t7TRcHQJc+wJwbEKrEbzsTTAfvv2ng', { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    if (u.startsWith(`${API}/anime/extract/21`)) {
      return new Response(JSON.stringify({
        provider: 'anineko',
        streams: [
          { url: CDN, type: 'hls', server: 'HD-2', audio: 'sub', referer: 'https://flixcloud.cc/', subtitles: [{ url: 'https://vault.ejemplo.com/s.srt', language: 'English', format: 'srt', default: true }, { url: 'https://vault.ejemplo.com/e.vtt', label: 'Spanish', srclang: 'es', format: 'vtt' }] },
          { url: 'http://127.0.0.1:9/secreto.m3u8', type: 'hls', server: 'malo', referer: '' },
          { url: 'https://x.ejemplo.com/video.mp4', type: 'mp4', server: 'directo' },
        ],
      }), { status: 200 });
    }
    if (u.startsWith(`${API}/anime/episodes/21`)) {
      const ep = (n, t) => ({ id: `x/${n}`, number: n, title: t, duration: 1500, image: 'https://i.ejemplo.com/e.jpg', airDate: '1999-10-20', filler: n === 2, description: 'largo' });
      return new Response(JSON.stringify({
        anilistId: 21,
        providers: {
          corto: { meta: {}, episodes: { sub: [ep(1, 'Uno')], dub: [] } },
          largo: { meta: {}, episodes: { sub: [ep(1, 'Uno'), ep(2, 'Dos')], dub: [ep(1, 'One')] } },
        },
      }), { status: 200 });
    }
    if (u.startsWith(`${API}/anime/info/21`)) {
      return new Response(JSON.stringify({ id: 21, title: { romaji: 'One Piece' }, description: 'd', coverImage: { large: 'a' }, episodes: 0, characters: new Array(500).fill({ x: 1 }), studios: { nodes: [{ name: 'Toei', isAnimationStudio: true }, { name: 'Otro', isAnimationStudio: false }] } }), { status: 200 });
    }
    if (u === CDN) return new Response(LISTA, { status: 200 });
    if (u === 'https://otro.ejemplo.com/seg/1.ts') return new Response(Buffer.from([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'video/mp2t' } });
    if (u === 'https://vault.ejemplo.com/s.srt') return new Response('1\n00:00:01,000 --> 00:00:02,000\nHola\n', { status: 200 });
    return new Response('no', { status: 404 });
  };
}

async function levantar(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hf-anime-'));
  const visto = [];
  const app = crearApp({ dataDir: dir, animeUrl: API, animeSecreto: 's'.repeat(40), animePedir: falso(visto), ...extra });
  const srv = createServer(app.manejar);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const cerrar = () => new Promise((r) => srv.close(() => { app.db.close(); rmSync(dir, { recursive: true, force: true }); r(); }));
  return { base, visto, cerrar, app };
}

const crearCuenta = (base) => fetch(`${base}${PREFIJO}/api/v1/sync`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${LLAVE}`, 'content-type': 'application/json' },
  body: JSON.stringify({ version: 0, doc: { app: 'homeflix', v: 2, at: 1, profiles: { at: 0, list: [] }, sources: {}, tags: {}, p: {} } }),
});
const api = (base, ruta, llave = LLAVE) => fetch(`${base}${PREFIJO}/api/v1/anime${ruta}`, { headers: llave ? { authorization: `Bearer ${llave}` } : {} });

test('el catálogo exige una cuenta de HomeFlix', async () => {
  const { base, cerrar } = await levantar();
  try {
    assert.equal((await api(base, '/trending', null)).status, 401, 'sin llave');
    assert.equal((await api(base, '/trending')).status, 404, 'llave sin cuenta');
    await crearCuenta(base);
    const r = await api(base, '/trending?page=1&per_page=20&malo=1');
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).results, [{ id: 1 }]);
    assert.equal((await api(base, '/proxy_m3u8')).status, 404, 'solo las rutas de la lista blanca');
    assert.equal((await api(base, '/info/21%2F..%2Fx')).status, 404);
  } finally { await cerrar(); }
});

test('la ficha y los capítulos llegan adelgazados', async () => {
  const { base, cerrar } = await levantar();
  try {
    await crearCuenta(base);
    const info = await (await api(base, '/info/21')).json();
    assert.equal(info.title.romaji, 'One Piece');
    assert.deepEqual(info.studios, ['Toei']);
    assert.equal(info.characters, undefined);
    const eps = await (await api(base, '/episodes/21')).json();
    assert.equal(eps.episodios.length, 2, 'el proveedor con más capítulos');
    assert.deepEqual(eps.episodios[1], { n: 2, titulo: 'Dos', imagen: 'https://i.ejemplo.com/e.jpg', minutos: 25, relleno: true, fecha: '1999-10-20' });
    assert.deepEqual(eps.doblados, [1]);
  } finally { await cerrar(); }
});

test('prefiere la fuente con subtítulos en español aunque otra responda antes', async () => {
  const { base, cerrar, app } = await levantar({ animeEspera: 400 });
  try {
    await crearCuenta(base);
    app.anime.idiomas.sembrar([{ id: 77, title: { romaji: 'Con español' }, averageScore: 80 }, { id: 78, title: { romaji: 'Solo inglés' }, averageScore: 70 }, { id: 79, title: { romaji: 'Sin subtítulos' }, averageScore: 60 }]);
    const es = await (await api(base, '/reproducir?id=77&e=1')).json();
    assert.equal(es.proveedor, 'anikoto', 'gana la que trae español, no el mp4 de animegg que llegó antes');
    assert.equal(es.espanol, true);
    assert.deepEqual(es.streams[0].subtitulos.map((x) => x.codigo), ['en', 'es']);

    const en = await (await api(base, '/reproducir?id=78&e=1')).json();
    assert.equal(en.proveedor, 'anikoto', 'sin español, mejor la que trae subtítulos en inglés que el video solo');
    assert.equal(en.espanol, false);

    const solo = await (await api(base, '/reproducir?id=79&e=1')).json();
    assert.equal(solo.proveedor, 'animegg', 'si ninguna trae subtítulos aparte, el video que haya');
    assert.equal(solo.streams[0].tipo, 'mp4');

    /* el índice de idiomas se llena con lo que se reproduce y las apps lo piden */
    const idi = await (await api(base, '/idiomas')).json();
    assert.deepEqual(idi.es.map((x) => x.id), [77]);
    assert.deepEqual(idi.en.map((x) => x.id), [78], 'japonés con subtítulos en inglés');
    assert.equal(idi.es[0].title.romaji, 'Con español');
  } finally { await cerrar(); }
});

test('el índice de idiomas se siembra con lo que se mira, se sondea despacio y se guarda', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-idi-'));
  try {
    const sondeos = [];
    const idi = crearIdiomas({ dir, pausa: 1, sondear: async (id) => { sondeos.push(id); return id === 5 ? { ok: true, es: true, en: true, dub: true } : { ok: true, es: false, en: true, dub: false }; } });
    assert.equal(idi.sembrar([{ id: 5, title: { romaji: 'Cinco' }, averageScore: 90 }, { id: 6, title: { romaji: 'Seis' }, averageScore: 50 }, { id: 7, isAdult: true }]), 2, 'lo adulto no entra');
    idi.iniciar();
    await new Promise((r) => setTimeout(r, 200));
    idi.parar();
    assert.deepEqual(sondeos, [5, 6], 'en el orden en que se sembró, uno por uno');
    const c = idi.consultar();
    assert.deepEqual([c.total, c.sondeados], [2, 2]);
    assert.deepEqual(c.es.map((x) => x.id), [5]);
    assert.deepEqual(c.dub.map((x) => x.id), [5]);
    assert.deepEqual(c.en.map((x) => x.id), [6]);
    const otra = crearIdiomas({ dir });
    assert.equal(otra.consultar().sondeados, 2, 'sobrevive a un reinicio');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('inicio: todas las filas en una sola respuesta, desde memoria', async () => {
  const { base, visto, cerrar } = await levantar();
  try {
    await crearCuenta(base);
    const j = await (await api(base, '/inicio')).json();
    assert.equal(j.filas.trending.length, 1);
    assert.equal(j.filas.trending[0].id, 1);
    assert.ok(j.idiomas && 'es' in j.idiomas && 'sondeados' in j.idiomas);
    const antes = visto.filter((v) => v.u.includes('/anime/trending')).length;
    await (await api(base, '/inicio')).json();
    assert.equal(visto.filter((v) => v.u.includes('/anime/trending')).length, antes, 'la segunda vez no vuelve a preguntar a la anime-api');
  } finally { await cerrar(); }
});

test('dos pedidos del mismo capítulo a la vez hacen una sola búsqueda (el adelantado sirve al que llega después)', async () => {
  const { base, visto, cerrar } = await levantar({ animeEspera: 300 });
  try {
    await crearCuenta(base);
    const [a, b] = await Promise.all([api(base, '/reproducir?id=77&e=1'), api(base, '/reproducir?id=77&e=1')]);
    assert.equal((await a.json()).proveedor, 'anikoto');
    assert.equal((await b.json()).proveedor, 'anikoto');
    assert.equal(visto.filter((v) => v.u.includes("extract/77") && v.u.includes("provider=anikoto")).length, 1, 'anikoto se pidió una sola vez');
    const otra = await (await api(base, '/reproducir?id=77&e=1')).json();
    assert.equal(otra.proveedor, 'anikoto');
    assert.equal(visto.filter((v) => v.u.includes("extract/77") && v.u.includes("provider=anikoto")).length, 1, 'y la tercera salió de memoria');
  } finally { await cerrar(); }
});

test('sin ANIME_URL el canal no existe', async () => {
  const { base, cerrar } = await levantar({ animeUrl: '' });
  try {
    await crearCuenta(base);
    assert.equal((await api(base, '/trending')).status, 503);
  } finally { await cerrar(); }
});

test('reproducir devuelve direcciones firmadas y el proxy reescribe la lista', async () => {
  const { base, visto, cerrar } = await levantar();
  try {
    await crearCuenta(base);
    const r = await api(base, '/reproducir?id=21&e=1&type=sub');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.streams.length, 1, 'solo el HLS válido con destino público');
    assert.equal(j.streams[0].tipo, 'hls');
    const s = j.streams[0];
    assert.match(s.url, /^\/productos\/HomeFlix\/anime\/p\/\d+\.[\w-]{32}\/m3u8\?u=/);

    /* el reproductor no manda llave: la firma basta */
    const lista = await fetch(base + s.url);
    assert.equal(lista.status, 200);
    assert.match(lista.headers.get('content-type'), /mpegurl/);
    const texto = await lista.text();
    assert.ok(!texto.includes('cdn.ejemplo.com') || texto.includes('%2F'), 'las direcciones ya no apuntan directo al CDN');
    assert.equal(j.proveedor, 'anineko', 'saltó al siguiente proveedor porque el primero daba una lista cifrada');
    const pedidos = visto.filter((v) => v.u === CDN);
    assert.ok(pedidos.length >= 2, 'una vez al validar y otra al reproducir');
    pedidos.forEach((p) => assert.equal(p.h.referer, 'https://flixcloud.cc/', 'el servidor pone el Referer que exige el CDN'));

    const tags = texto.split('\n');
    const llaveTag = tags.find((l) => l.startsWith('#EXT-X-KEY'));
    assert.match(llaveTag, /URI="\/productos\/HomeFlix\/anime\/p\/[^"]+\/seg\?u=https%3A%2F%2Fcdn\.ejemplo\.com%2F_v8%2Fabc%2Fllave\.key/);
    const sub = tags.find((l) => /m3u8\?u=/.test(l) && !l.startsWith('#'));
    assert.match(sub, /^\/productos\/HomeFlix\/anime\/p\/[^/]+\/m3u8\?u=https%3A%2F%2Fcdn\.ejemplo\.com%2F_v8%2Fabc%2Fhd%2Findex\.m3u8/);
    const seg = tags.find((l) => /\/seg\?u=/.test(l) && !l.startsWith('#'));
    const bytes = await (await fetch(base + seg)).arrayBuffer();
    assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3, 4]);

    assert.deepEqual(s.subtitulos.map((x) => [x.idioma, x.codigo]), [['English', ''], ['Spanish', 'es']], 'el idioma sale de «language» o de «label» + «srclang»');
    const subt = await fetch(base + s.subtitulos[0].url);
    assert.equal(subt.status, 200);
    assert.match(await subt.text(), /Hola/);
  } finally { await cerrar(); }
});

test('el proxy rechaza firmas falsas, cambiadas, vencidas y destinos internos', async () => {
  let t = 1_800_000_000_000;
  const { base, cerrar } = await levantar({ ahora: () => t });
  try {
    await crearCuenta(base);
    const j = await (await api(base, '/reproducir?id=21&e=1')).json();
    const url = j.streams[0].url;
    assert.equal((await fetch(base + url)).status, 200);
    assert.equal((await fetch(base + url.replace(/\.[\w-]{32}\//, '.' + 'A'.repeat(32) + '/'))).status, 403, 'firma inventada');
    assert.equal((await fetch(base + url.replace(/%2F_v8/, '%2F_v9'))).status, 403, 'destino cambiado');
    assert.equal((await fetch(base + url.replace('/m3u8?', '/seg?'))).status, 403, 'otro tipo');
    assert.equal((await fetch(`${base}${PREFIJO}/anime/p/1.${'A'.repeat(32)}/m3u8?u=http%3A%2F%2F127.0.0.1%3A9%2Fx&r=`)).status, 403, 'destino interno');
    t += 7 * 3600_000;
    assert.equal((await fetch(base + url)).status, 403, 'vencida');
  } finally { await cerrar(); }
});
