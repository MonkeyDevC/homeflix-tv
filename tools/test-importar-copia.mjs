// Importar desde un grupo antiguo, FASES 2 y 3 (tools/preparador/importar.js + temas.js) con un TMDB y un Telegram falsos: node tools/test-importar-copia.mjs
//   · TMDB: busca por título original y en español con el año, elige el mejor candidato (con su confianza) y deja cambiarlo (trae su ficha);
//   · plan: la foto vertical del encabezado, portada y banner de TMDB y los capítulos por temporada (renumerados);
//   · copia: sendCopy con el comentario de HOY (serie(T/C)#Nombre#descripción #Anime #tmdbtv<id>), sin volver a subir, cada pieza en el tema «Nombre (serie)»;
//   · se reanuda sin repetir, la prueba de «solo 2 capítulos» no estorba al resto, FLOOD_WAIT espera y una imagen de TMDB que falla no detiene lo demás.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
const sandbox = {
  window: { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } },
  console, setTimeout, clearTimeout, Promise, Object, Date, Math, JSON, Array, String, Number, RegExp, Error, AbortController,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'library.js'), 'utf8') + '\nthis.HFLibrary = HFLibrary;', sandbox);
sandbox.window.HFLibrary = sandbox.HFLibrary;
vm.runInContext(readFileSync(join(root, 'tools', 'preparador', 'temas.js'), 'utf8') + '\nthis.PrepTopics = PrepTopics;', sandbox);
vm.runInContext(readFileSync(join(root, 'tools', 'preparador', 'importar.js'), 'utf8') + '\nthis.PrepImport = PrepImport;', sandbox);
const PT = sandbox.PrepTopics;
const PI = sandbox.PrepImport;

/* ---- el canal antiguo (3 capítulos por temporada para que sea rápido) ---- */
const MB = 1048576;
let id = 1;
let t0 = Date.UTC(2024, 4, 1);
const canal = [];
const photo = (text, extra = {}) => canal.push({ id: id++, media: { type: 'photo', fileSize: 90000, width: 800, height: 1200, ...extra }, text, date: new Date(t0 += 60000) });
const video = (text, mb) => canal.push({ id: id++, media: { type: 'video', fileSize: mb * MB, duration: 1400, fileName: '' }, text, date: new Date(t0 += 60000) });
photo('Los guerreros del zodiaco: el lienzo perdido / Saint Seiya: Lost Canvas\n2 temporadas\nTipo: OVA\nPublicación: 2009\nGéneros: #Acción #Aventura\nEpisodios: 3\nDuración: 23 min\nIdioma: Jap+Sub\nFormato: 720p', { fileSize: 91000 });
for (let n = 1; n <= 3; n += 1) { video('Capítulo ' + n, 270); }
photo('El lienzo perdido - Los Caballeros del Zodiaco\n\nTipo: OVA\nPublicación: 2009\nGéneros: Acción, Aventura\nEpisodios: 3\nDuración: 23 min\nIdioma: Latino\nFormato: 720p', { fileSize: 93000 });
for (let n = 1; n <= 3; n += 1) { video('Capítulo ' + n, 160); }
const leidos = canal.map((m) => ({ id: m.id, kind: m.media.type === 'photo' ? 'photo' : 'video', text: m.text, fileName: '', duration: m.media.duration || 0, size: m.media.fileSize, width: m.media.width || 0, height: m.media.height || 0, uid: '', date: m.date.getTime() }));
const an = PI.analyze(leidos);
assert.equal(an.series.length, 1); assert.equal(an.series[0].seasons.length, 2);
const s = an.series[0];

/* ---- 2) TMDB ---- */
const llamadas = [];
const api = {
  buscar: async ({ media, q, year }) => {
    llamadas.push(media + ':' + q);
    return { results: [
      { id: 999, title: 'Saint Seiya', original: 'Seinto Seiya', year: 1986, pop: 80, poster: '', overview: '' },
      { id: 40123, title: 'Saint Seiya: The Lost Canvas', original: 'Saint Seiya: The Lost Canvas', year: 2009, pop: 30, poster: '', overview: '' },
    ] };
  },
  ficha: async ({ media, id: fid }) => ({ id: fid, media, title: fid === 40123 ? 'Los guerreros del zodiaco: el lienzo perdido' : 'X' + fid, overview: fid === 40123 ? 'Los caballeros defienden a Atenea.' : 'Otra historia.', genres: ['Animación'], poster: { url: 'https://img/poster' + fid }, backdrop: { url: 'https://img/banner' + fid }, vertical: { url: 'https://img/vert' + fid } }),
  imagen: async ({ url, kind }) => { if (api.fallar && api.fallar.test(url)) { throw new Error('No pude bajar la imagen'); } return { id: kind + ':' + url }; },
  bytes: async (imgId) => new Uint8Array([1, 2, 3, imgId.length]),
};
await PI.match(s, api);
assert.equal(s.match.pick, 40123, 'elige «Saint Seiya: The Lost Canvas» por título parecido y año');
assert.equal(s.match.state, 'alta');
assert.equal(s.match.candidates[0].id, 40123);
assert.ok(llamadas.length >= 1 && llamadas.every((l) => l.startsWith('tv:')), 'una serie se busca como serie');
assert.equal(s.match.ficha.overview, 'Los caballeros defienden a Atenea.');
await PI.pick(s, 999, api);
assert.equal(s.match.ficha.overview, 'Otra historia.', 'cambiar de candidato trae su ficha');
await PI.pick(s, 40123, api);

/* ---- plan ---- */
const plan = PI.planCopy(an, { category: 'Anime' });
const claves = plan.groups[0].items.map((x) => x.label);
assert.equal(plan.total, 10, 'encabezado vertical + portada + banner + imagen común + 6 capítulos');
assert.ok(claves[0].startsWith('Encabezado como vertical'));
assert.deepEqual(JSON.parse(JSON.stringify(claves.slice(1, 3))), ['Portada de TMDB', 'Banner de TMDB']);
assert.deepEqual(JSON.parse(JSON.stringify(claves.slice(4))), ['T1:E1', 'T1:E2', 'T1:E3', 'T2:E1', 'T2:E2', 'T2:E3']);
assert.equal(PI.planCopy(an, { maxEpisodes: 2 }).total, 8, 'prueba: 2 capítulos por temporada');

/* ---- 3) copia a un grupo con temas ---- */
const FORO = { id: -1005551234567, title: 'Prueba temas', isForum: true };
PT.noteForum(FORO);
let topics = [{ id: 1, title: 'General' }];
let nextMsg = 100;
const enviados = [];
let fallosFlood = 0;
let creados = 0;
const client = {
  iterForumTopics: async function* () { for (const t of topics.slice()) { yield t; } },
  createForumTopic: async ({ title }) => { creados += 1; await new Promise((r) => setTimeout(r, 5)); const tid = nextMsg++; topics.push({ id: tid, title }); return { id: tid }; },
  sendMedia: async (chat, m, params) => { enviados.push({ via: 'subida', caption: m.caption, thread: params && params.threadId, file: m.file && m.file.length }); return { id: nextMsg++ }; },
  sendMediaGroup: async () => { throw new Error('no se usa'); },
  sendCopy: async (p) => {
    if (fallosFlood > 0) { fallosFlood -= 1; throw new Error('FLOOD_WAIT_1'); }
    enviados.push({ via: 'copia', from: p.fromChatId, msg: p.message, caption: p.caption, thread: p.threadId });
    return { id: nextMsg++ };
  },
};
PT.patch(client);
const base = { client, from: -1003086298910, to: FORO, analysis: an, api, category: 'Anime', pause: 0 };

// prueba de 2 capítulos por temporada
const st = { sent: {} };
await PI.copyAll({ ...base, state: st, maxEpisodes: 2 });
assert.equal(enviados.length, 8, 'imágenes + 2 capítulos de cada temporada');
assert.equal(creados, 1, 'un solo tema para toda la serie');
const tema = topics.find((t) => t.title === 'Los guerreros del zodiaco: el lienzo perdido (serie)');
assert.ok(tema, 'el tema se llama «Nombre (serie)»');
assert.ok(enviados.every((e) => e.thread === tema.id), 'todo cae en el tema de la serie');
const caps = enviados.filter((e) => e.via === 'copia');
assert.equal(caps.length, 5, 'encabezado + 4 capítulos copiados sin volver a subir');
assert.equal(caps[0].caption, 'serie#Los guerreros del zodiaco: el lienzo perdido #vertical', 'la foto del encabezado queda como vertical');
assert.equal(caps[1].caption, 'serie(1/1)#Los guerreros del zodiaco: el lienzo perdido#Los caballeros defienden a Atenea. #Anime #tmdbtv40123');
assert.equal(caps[3].caption, 'serie(2/1)#Los guerreros del zodiaco: el lienzo perdido#Los caballeros defienden a Atenea. #Anime #tmdbtv40123', 'la T2 empieza en 1');
assert.ok(caps.every((e) => e.from === -1003086298910), 'se copia desde el canal antiguo');
const subidas = enviados.filter((e) => e.via === 'subida');
assert.deepEqual(subidas.map((e) => e.caption), ['serie#Los guerreros del zodiaco: el lienzo perdido#Los caballeros defienden a Atenea. #portada', 'serie#Los guerreros del zodiaco: el lienzo perdido #banner', 'serie#Los guerreros del zodiaco: el lienzo perdido #capitulo']);
assert.ok(subidas.every((e) => e.file > 0));
// el comentario de hoy lo entiende la biblioteca
const lib = sandbox.HFLibrary.build(enviados.filter((e) => /^serie\(/.test(e.caption)).map((e, i) => ({ key: 'x:' + i, chatId: 'x', msgId: i, kind: 'video', caption: e.caption, fileName: '', duration: 1400, size: 1, width: 1280, height: 720, date: i })), {});
assert.equal(lib.series.length, 1, 'los capítulos se juntan en una serie');
assert.equal(lib.series[0].seasons.length, 2, 'con dos temporadas');
const lib2 = sandbox.HFLibrary.build(enviados.filter((e) => /^serie/.test(e.caption)).map((e, i) => ({ key: 'x:' + i, chatId: 'x', msgId: i, kind: /^serie\(\d/.test(e.caption) ? 'video' : 'photo', caption: e.caption, fileName: '', duration: 1400, size: 1, width: 1280, height: 720, date: i })), {});
assert.equal(lib2.series[0].description, 'Los caballeros defienden a Atenea.', 'la serie muestra la descripción de TMDB gracias a la portada');
assert.equal(sandbox.HFLibrary.primaryCategory(lib2.series[0], false), 'Anime');

// seguir con todo: solo falta lo que no se mandó (capítulos 3 de cada temporada); una espera por FLOOD_WAIT
const antes = enviados.length;
fallosFlood = 1;
const t1 = Date.now();
await PI.copyAll({ ...base, state: st });
assert.equal(enviados.length - antes, 2, 'solo los dos capítulos que faltaban');
assert.ok(Date.now() - t1 >= 1500, 'esperó el FLOOD_WAIT');
// otra vez: no repite nada
await PI.copyAll({ ...base, state: st });
assert.equal(enviados.length - antes, 2, 'no repite lo ya copiado');

// detener a la mitad y continuar
const enviados0 = enviados.length;
const st2 = { sent: {} };
const ctl = new AbortController();
let n = 0;
let detenido = false;
try { await PI.copyAll({ ...base, to: FORO, state: st2, signal: ctl.signal, onProgress: (p) => { if (p.step === 'copiando' && p.done === 3) { ctl.abort(); } n += 1; } }); } catch (e) { detenido = /Detenido/.test(e.message); }
assert.equal(detenido, true, 'se detiene');
assert.equal(Object.keys(st2.sent).length, 3);
await PI.copyAll({ ...base, state: st2 });
assert.equal(enviados.length - enviados0, 10, 'en total 10 mensajes, sin repetir los 3 de antes');

// una imagen de TMDB que no baja no detiene lo demás
api.fallar = /banner/;
const st3 = { sent: {} };
const e1 = enviados.length;
const r = await PI.copyAll({ ...base, state: st3 });
assert.equal(enviados.length - e1, 8, 'todo menos el banner y la imagen común (usa el mismo banner)');
assert.equal(r.errors.length, 2);
assert.ok(/banner/i.test(r.errors[0]));
assert.equal(st3.sent[s.id + ':banner'], 'omitida');

console.log('OK: TMDB (candidatos y ficha), plan, copia con el comentario de hoy en el tema de la serie, prueba de 2 capítulos, reanudar, FLOOD_WAIT e imagen que falla');
