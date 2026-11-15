// Grupos con temas del preparador (tools/preparador/temas.js) con un Telegram falso: node tools/test-temas.mjs
//   · publicar: lo que se manda a un grupo con temas va al tema de su título (se crea una sola vez aunque lleguen muchos a la vez);
//     un chat sin temas queda como antes; un comentario que no es de HomeFlix no se toca;
//   · plan: qué mensajes van a cada tema (solo lo vigente: sin versiones viejas ni fotos reemplazadas) y los sueltos en «Sin clasificar»;
//   · migrar: reenvía sin autor, en orden, dentro del tema; se reanuda si se corta; espera si Telegram dice FLOOD_WAIT.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
const sandbox = {
  window: { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } },
  console, setTimeout, clearTimeout, Promise, Object, Date, Math, JSON, Array, String, Number,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'library.js'), 'utf8') + '\nthis.HFLibrary = HFLibrary;', sandbox);
sandbox.window.HFLibrary = sandbox.HFLibrary;
vm.runInContext(readFileSync(join(root, 'tools', 'preparador', 'temas.js'), 'utf8') + '\nthis.PrepTopics = PrepTopics;', sandbox);
const PT = sandbox.PrepTopics;

/* ---- Telegram falso con un grupo con temas ---- */
const FORO = { id: -1005551234567, title: 'NETSUCKS temas', isForum: true };
const PLANO = { id: -1009990000001, title: 'NETSUCKS viejo', isForum: false };
let topics = [{ id: 1, title: 'General' }];
let nextMsg = 100;
const enviados = [];
const reenviados = [];
let fallosFlood = 0;
let creados = 0;
const client = {
  iterForumTopics: async function* () { for (const t of topics.slice()) { yield t; } },
  createForumTopic: async ({ chatId, title }) => { creados += 1; await new Promise((r) => setTimeout(r, 5)); const id = nextMsg++; topics.push({ id, title }); return { id }; },
  sendMedia: async (chat, media, params) => { enviados.push({ chat: chat.id, caption: media.caption, thread: params && params.threadId }); return { id: nextMsg++ }; },
  sendMediaGroup: async (chat, medias, params) => { enviados.push({ chat: chat.id, caption: medias[0].caption, group: medias.length, thread: params && params.threadId }); return medias.map(() => ({ id: nextMsg++ })); },
  sendCopy: async (params) => { enviados.push({ copy: true, chat: params.toChatId.id, caption: params.caption, thread: params.threadId }); return { id: nextMsg++ }; },
  forwardMessages: async () => { throw new Error("forwardMessages pide mensajes, no números: hay que usar forwardMessagesById"); },
  forwardMessagesById: async (p) => {
    if (fallosFlood > 0) { fallosFlood -= 1; throw new Error('FLOOD_WAIT_1'); }
    reenviados.push({ ids: p.messages, from: p.fromChatId, thread: p.toThreadId, noAuthor: p.noAuthor });
    return p.messages.map(() => ({ id: nextMsg++ }));
  },
};

// 1) publicar dentro del tema
PT.noteForum(FORO);
PT.noteForum(PLANO);
assert.equal(PT.isForum(FORO), true);
assert.equal(PT.isForum(PLANO), false);
assert.equal(PT.isForum(-1005551234567), true, 'se recuerda por número de chat');
PT.patch(client);
PT.patch(client); // dos veces no lo envuelve dos veces
const cap = 'pelicula#Hoppers (2026)#Una nutria. #Animadas';
await Promise.all([1, 2, 3, 4, 5].map(() => client.sendMedia(FORO, { type: 'video', caption: cap })));
assert.equal(creados, 1, 'cinco envíos a la vez del mismo título crean UN solo tema');
const tHoppers = topics.find((t) => t.title === 'Hoppers (2026)');
assert.ok(tHoppers, 'el tema se llama «Nombre (año)»');
assert.ok(enviados.every((e) => e.thread === tHoppers.id), 'todos van a ese tema');
await client.sendMedia(FORO, { type: 'photo', caption: 'pelicula#Hoppers #portada' });
assert.equal(enviados.at(-1).thread, tHoppers.id, 'la foto sin año va al tema de la película con año');
assert.equal(creados, 1);
await client.sendMediaGroup(FORO, [{ type: 'photo', caption: 'pelicula#Hoppers (2026) #galeria1' }, { type: 'photo', caption: 'pelicula#Hoppers (2026) #galeria2' }]);
assert.equal(enviados.at(-1).thread, tHoppers.id, 'un grupo de fotos (miniaturas) va al tema');
await client.sendMedia(FORO, { type: 'video', caption: 'serie(1/3)#Bluey#El hospital#Juegan.' });
assert.ok(topics.some((t) => t.title === 'Bluey (serie)'), 'una serie tiene UN tema para todos sus capítulos');
await client.sendMedia(FORO, { type: 'video', caption: 'serie(2/1)#Bluey#Otro#Juegan.' });
assert.equal(topics.filter((t) => /Bluey/.test(t.title)).length, 1, 'el segundo capítulo cae en el mismo tema');
await client.sendMedia(PLANO, { type: 'video', caption: cap });
assert.equal(enviados.at(-1).thread, undefined, 'un chat sin temas queda como antes');
await client.sendMedia(FORO, { type: 'video', caption: 'texto cualquiera' });
assert.equal(enviados.at(-1).thread, undefined, 'un comentario que no es de HomeFlix no se toca');
const antes = creados;
PT._.reset(); // otra sesión: el tema ya existe en Telegram y se reutiliza
await client.sendMedia(FORO, { type: 'video', caption: cap });
assert.equal(creados, antes, 'reutiliza el tema que ya existe');
await client.sendCopy({ toChatId: FORO, fromChatId: PLANO, message: 5, caption: cap });
assert.equal(enviados.at(-1).thread, tHoppers.id, 'una copia con comentario nuevo también va a su tema');
assert.equal(await PT.topicFor(client, PLANO, cap), 0, 'topicFor: sin temas = 0');
assert.equal(await PT.topicFor(client, FORO, cap), tHoppers.id, 'topicFor: el número del tema');

// 1b) un tema existente SIN año (creado a mano) se reutiliza en vez de duplicarlo; y «find» solo mira, no crea
topics = [{ id: 1, title: 'General' }, { id: 77, title: 'Moana' }];
PT._.reset();
creados = 0;
const enc = await PT.find(client, FORO, { type: 'movie', name: 'Moana', year: 2016 });
assert.equal(enc && enc.id, 77, 'find: encuentra el tema aunque no lleve año');
assert.equal(await PT.find(client, FORO, { type: 'movie', name: 'Nada', year: 2020 }), null, 'find: null si no existe');
assert.equal(await PT.find(client, PLANO, { type: 'movie', name: 'Moana', year: 2016 }), null, 'find: un chat sin temas no tiene temas');
assert.equal(creados, 0, 'find nunca crea');
await client.sendMedia(FORO, { type: 'video', caption: 'pelicula#Moana (2016)#x' });
assert.equal(enviados.at(-1).thread, 77, 'al publicar con año va al tema que ya existe (sin duplicar)');
assert.equal(creados, 0);
topics = [{ id: 1, title: 'General' }, { id: 5, title: 'Coco (2017)' }];
PT._.reset();
creados = 0;

// 2) plan de migración
let id = 1000;
const C = -1001111111111;
const v = (cap, file, h, size, extra = {}) => ({ key: `${C}:${id}`, chatId: String(C), msgId: id++, kind: 'video', caption: cap, fileName: file, width: h * 16 / 9, height: h, size, duration: 6000, date: 1e12 + id * 1000, ...extra });
const f = (cap, extra = {}) => ({ key: `${C}:${id}`, chatId: String(C), msgId: id++, kind: 'photo', caption: cap, fileName: '', size: 5000, width: 800, height: 1200, date: 1e12 + id * 1000, ...extra });
const s = (cap, file) => ({ key: `${C}:${id}`, chatId: String(C), msgId: id++, kind: 'sub', caption: cap, fileName: file, size: 100, date: 1e12 + id * 1000 });
const th = (cap, file) => ({ key: `${C}:${id}`, chatId: String(C), msgId: id++, kind: 'thumbs', caption: cap, fileName: file, size: 900, date: 1e12 + id * 1000 });
const items = [
  v('pelicula#Coco (2017)#Miguel.', 'Coco 1080p.mp4', 1080, 2e9),          // vieja (se reemplazó)
  f('pelicula#Coco (2017) #portada', { width: 1280, height: 720 }),         // portada vieja
  v('pelicula#Coco (2017)#Miguel.', 'Coco 1080p v2.mp4', 1080, 2.1e9),      // vigente
  v('pelicula#Coco (2017)#Miguel.', 'Coco 720p.mp4', 720, 1e9),
  f('pelicula#Coco (2017) #portada', { width: 1280, height: 720 }),         // portada vigente
  f('pelicula#Coco #vertical'),                                            // sin año: va a la película con año
  s('pelicula#Coco (2017) #subs-spa', 'Coco (2017).spa.srt'),
  s('pelicula#Coco (2017) #subs-eng', 'Coco (2017).eng.srt'),
  th('pelicula#Coco (2017)', 'Coco miniaturas 10s 160x90 10x10 hoja 1 de 1.jpg'),
  v('serie(1/1)#Bluey#Hospital#x', 'Bluey 1x1 720p.mp4', 720, 5e8),
  v('serie(1/2)#Bluey#Otro#x', 'Bluey 1x2 720p.mp4', 720, 5e8),
  f('serie#Bluey#Una perrita. #portada', { width: 1280, height: 720 }),
  v('', 'video suelto.mp4', 720, 3e8),                                    // sin comentario
  f('esto no es de homeflix #cosa'),                                       // foto con # pero sin el formato
];
const pl = PT.plan(items);
const porTema = Object.fromEntries(pl.groups.map((g) => [g.topic, g]));
assert.deepEqual(Array.from(Object.keys(porTema)).sort(), ['Bluey (serie)', 'Coco (2017)', 'Sin clasificar']);
const coco = porTema['Coco (2017)'];
assert.equal(coco.counts.video, 2, 'Coco: 1080p vigente + 720p (la 1080p vieja no va)');
assert.equal(coco.counts.photo, 2, 'Coco: portada vigente y vertical (la portada vieja no va)');
assert.equal(coco.counts.sub, 2);
assert.equal(coco.counts.thumbs, 1);
assert.ok(!coco.items.some((x) => x.fileName === 'Coco 1080p.mp4'), 'la versión vieja no se copia');
assert.deepEqual(Array.from(coco.items.map((x) => x.kind)), ['photo', 'photo', 'video', 'video', 'sub', 'sub', 'thumbs'], 'orden: imágenes, videos, subtítulos, miniaturas');
assert.equal(porTema['Bluey (serie)'].counts.video, 2);
assert.equal(porTema['Bluey (serie)'].counts.photo, 1);
assert.equal(porTema['Sin clasificar'].items.length, 2, 'el video sin comentario y la foto rara van a «Sin clasificar»');
assert.equal(pl.skipped.length, 2, 'se avisa de lo que no se copia (1080p vieja y portada vieja)');
assert.equal(pl.total, items.length - 2);

// 3) migrar
const dest = { id: -1008880000001, isForum: true };
PT.noteForum(dest);
PT._.reset();
topics = [{ id: 1, title: 'General' }];
creados = 0;
const progreso = [];
let guardado = null;
const estado = {};
const r1 = await PT.migrate({ client, to: dest, plan: pl, state: estado, save: (s2) => { guardado = JSON.stringify(s2); }, onProgress: (p) => progreso.push(p), pause: 0 });
assert.equal(creados, 3, 'un tema por título y uno para los sueltos');
assert.ok(reenviados.every((x) => x.noAuthor === true), 'se reenvía SIN autor (no se vuelve a subir nada)');
const tCoco = topics.find((t) => t.title === 'Coco (2017)').id;
const fCoco = reenviados.filter((x) => x.thread === tCoco);
assert.equal(fCoco.length, 1, 'Coco sale en una sola llamada');
assert.deepEqual(Array.from(fCoco[0].ids), Array.from(coco.items.map((x) => x.msgId)), 'en el orden del plan');
assert.equal(fCoco[0].from, C);
assert.equal(Object.keys(r1.sent).length, pl.total, 'queda el mapa de cada mensaje copiado');
assert.ok(Object.values(r1.sent).every((x) => x.startsWith(String(dest.id) + ':')), 'cada uno con su número nuevo');
assert.ok(JSON.parse(guardado).done, 'el avance se guarda');
assert.equal(progreso.at(-1).groupsDone, 3);

// 4) se reanuda: lo ya copiado no se repite; y FLOOD_WAIT espera y sigue
reenviados.length = 0;
const parcial = { topics: { [coco.gid]: tCoco }, sent: Object.fromEntries(coco.items.slice(0, 3).map((x) => [x.key, `${dest.id}:9`])), done: {} };
fallosFlood = 1;
await PT.migrate({ client, to: dest, plan: { groups: [coco] }, state: parcial, pause: 0 });
assert.equal(reenviados.length, 1);
assert.deepEqual(Array.from(reenviados[0].ids), Array.from(coco.items.slice(3).map((x) => x.msgId)), 'solo lo que faltaba');
assert.equal(parcial.done[coco.gid], true);
assert.equal(fallosFlood, 0, 'tras el FLOOD_WAIT volvió a intentar');

// 4b) respaldo al día: una segunda vez solo se copia lo NUEVO (y lo ya copiado no se repite)
reenviados.length = 0;
const nuevo = v('pelicula#Coco (2017)#Miguel.', 'Coco 4K.mp4', 2160, 4e9);
const pl2 = PT.plan(items.concat([nuevo]));
const st2 = { topics: r1.topics, sent: r1.sent, done: {} }; // done vacío: se vuelve a mirar cada tema
const ya = Object.keys(r1.sent).length;
await PT.migrate({ client, to: dest, plan: pl2, state: st2, pause: 0 });
assert.equal(reenviados.length, 1, 'solo el tema con novedades hace una llamada');
assert.deepEqual(Array.from(reenviados[0].ids), [nuevo.msgId], 'solo lo nuevo');
assert.equal(Object.keys(st2.sent).length, ya + 1);
assert.equal(reenviados[0].thread, tCoco, 'dentro del mismo tema de siempre');

// 5) se puede detener
const ctl = new AbortController();
ctl.abort();
await assert.rejects(PT.migrate({ client, to: dest, plan: pl, state: {}, signal: ctl.signal, pause: 0 }), /Detenido/);

console.log('OK: publicar dentro del tema, plan de migración (solo lo vigente), migrar sin autor, reanudar y FLOOD_WAIT');
