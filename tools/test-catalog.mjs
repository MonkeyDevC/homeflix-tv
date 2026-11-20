// Lectura rápida del catálogo de Telegram (js/telegram.js + js/catalog.js) con un Telegram falso: node tools/test-catalog.mjs
//   · los tres filtros (videos, documentos, fotos) se piden A LA VEZ;
//   · la lectura normal pide solo lo NUEVO (pocas peticiones) y la completa se hace al primer uso, cada 6 h, a mano (1 h) o si lo guardado no cuadra;
//   · adelantar mensajes (warm): una petición por chat, sin repetir; las claves «anime:…» se ignoran.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const store = new Map();
const CHAT = -1001234567890;

/* ---- el chat: mensajes con id creciente ---- */
const msgs = [];
let nextId = 1;
const chat = { id: CHAT, title: 'NETSUCKS' };
function video(n, extra = {}) { const id = nextId++; msgs.push({ id, chat, text: `pelicula#Peli ${n} (2020)#d`, date: new Date(1.7e12 + id * 1000), media: { type: 'video', isRound: false, isAnimation: false, fileName: `p${n}.mp4`, duration: 6000, fileSize: 1e9, width: 1920, height: 1080 }, ...extra }); return id; }
function photo(n) { const id = nextId++; msgs.push({ id, chat, text: `pelicula#Peli ${n} (2020)#portada #portada`, date: new Date(1.7e12 + id * 1000), media: { type: 'photo', thumbnails: [] } }); return id; }
function sub(n) { const id = nextId++; msgs.push({ id, chat, text: `pelicula#Peli ${n} (2020) #subs-spa`, date: new Date(1.7e12 + id * 1000), media: { type: 'document', fileName: `Peli ${n}.spa.srt`, mimeType: 'application/x-subrip', fileSize: 5000 } }); return id; }
for (let i = 0; i < 250; i++) video(i);
for (let i = 0; i < 20; i++) photo(i);
for (let i = 0; i < 10; i++) sub(i);

/* ---- Telegram falso: páginas de 100, con latencia, y cuenta de peticiones ---- */
const llamadas = [];
let enCurso = 0;
let maxJuntas = 0;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const FILTRO = { inputMessagesFilterVideo: (m) => m.media.type === 'video', inputMessagesFilterDocument: (m) => m.media.type === 'document', inputMessagesFilterPhotos: (m) => m.media.type === 'photo' };
const client = {
  connect: async () => {},
  searchMessages: async ({ filter, limit, offset }) => {
    enCurso += 1; maxJuntas = Math.max(maxJuntas, enCurso);
    llamadas.push((limit === 1 ? 'count:' : 'search:') + filter._ + ':' + (offset || 0));
    await pausa(15);
    enCurso -= 1;
    const todos = msgs.filter(FILTRO[filter._]).sort((a, b) => b.id - a.id);
    const ini = offset || 0;
    const page = todos.slice(ini, ini + limit);
    page.next = ini + limit < todos.length ? ini + limit : undefined;
    page.total = todos.length;
    return page;
  },
  getChat: async () => { llamadas.push('getChat'); await pausa(15); return { raw: {} }; },
  getFullChat: async () => { llamadas.push('getFullChat'); await pausa(15); return { full: {} }; },
  getMessages: async (peer, ids) => { llamadas.push('getMessages:' + ids.join(',')); await pausa(5); return ids.map((id) => msgs.find((m) => m.id === id) || null); },
};

const sandbox = {
  window: {
    TGLib: { create: async () => ({ client, mode: 'direct' }) },
    HF_TG_API: { id: 12345, hash: 'a'.repeat(32) },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    addEventListener: () => {},
  },
  URL: { createObjectURL: () => 'blob:x' },
  Blob: class {},
  console, setTimeout, clearTimeout, Promise, Object, Date, Math, JSON,
};
sandbox.window.window = sandbox.window;
sandbox.HFLibrary = { accountId: () => 'acc1' };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'telegram.js'), 'utf8') + '\nthis.HFTelegram = HFTelegram;', sandbox);
vm.runInContext(readFileSync(join(root, 'js', 'catalog.js'), 'utf8') + '\nthis.HFCatalog = HFCatalog;', sandbox);
const TG = sandbox.HFTelegram;
const C = sandbox.HFCatalog;
const cuenta = (re) => llamadas.filter((l) => re.test(l)).length;

// 1) Lectura COMPLETA: los tres filtros a la vez y la comprobación de «grupo migrado» en paralelo
let r = await C.scanChat(CHAT, []);
assert.equal(r.incremental, false);
assert.equal(r.items.length, 250 + 20 + 10);
assert.ok(maxJuntas >= 3, 'peticiones simultáneas: ' + maxJuntas);
assert.equal(cuenta(/^search:inputMessagesFilterVideo/), 3, '250 videos = 3 páginas');
assert.equal(cuenta(/^getFullChat/), 1, 'se averigua si el grupo migró (supergrupo)');
const maxId = Math.max(...r.items.map((i) => i.msgId));
assert.equal(maxId, nextId - 1);
const st = JSON.parse(store.get('hf.scan.acc1'));
assert.equal(st[String(CHAT)].max, maxId);
assert.equal(st[String(CHAT)].n, 280);
assert.equal(st[String(CHAT)].mig, false);
let guardados = r.items;

// 2) Lectura NORMAL con 3 videos nuevos: solo lo nuevo, sin tocar lo de «migró», y lo viejo se conserva
llamadas.length = 0;
video(900); video(901); photo(901);
r = await C.scanChat(CHAT, guardados);
assert.equal(r.incremental, true, 'solo lo nuevo');
assert.equal(r.nuevos, 3);
assert.equal(r.items.length, 283);
assert.ok(llamadas.filter((l) => !/^count:/.test(l)).length <= 3, 'una página por filtro: ' + llamadas.join(' '));
assert.equal(cuenta(/getChat|getFullChat/), 0, 'sin comprobar la migración otra vez');
assert.equal(JSON.stringify(Array.from(r.items.slice(0, 3).map((i) => i.msgId)).sort((a, b) => b - a)), JSON.stringify([nextId - 1, nextId - 2, nextId - 3]), 'lo nuevo va primero');
guardados = r.items;

// 3) Sin novedades: una petición por filtro y nada cambia
llamadas.length = 0;
r = await C.scanChat(CHAT, guardados);
assert.equal(r.nuevos, 0);
assert.equal(r.items.length, 283);
assert.ok(llamadas.filter((l) => !/^count:/.test(l)).length <= 3);

// 4) Cuándo SÍ se lee completo
llamadas.length = 0;
r = await C.scanChat(CHAT, guardados, { full: true });
assert.equal(r.incremental, false, 'forzada');
r = await C.scanChat(CHAT, guardados.slice(0, 100));
assert.equal(r.incremental, false, 'la caché no cuadra con lo guardado (se vació o se perdió)');
const viejo = JSON.parse(store.get('hf.scan.acc1'));
viejo[String(CHAT)].full = Date.now() - 2 * 3600 * 1000; // la última lectura completa fue hace 2 h
store.set('hf.scan.acc1', JSON.stringify(viejo));
r = await C.scanChat(CHAT, guardados);
assert.equal(r.incremental, true, 'automática: aún no pasaron 6 h');
store.set('hf.scan.acc1', JSON.stringify(viejo));
r = await C.scanChat(CHAT, guardados, { manual: true });
assert.equal(r.incremental, false, 'a mano (↻): pasó más de 1 h');
viejo[String(CHAT)].full = Date.now() - 7 * 3600 * 1000;
store.set('hf.scan.acc1', JSON.stringify(viejo));
r = await C.scanChat(CHAT, guardados);
assert.equal(r.incremental, false, 'pasaron más de 6 h');
r = await C.scanChat('-100999', []);
assert.equal(r.incremental, false, 'un chat nuevo se lee completo');

// 5) Adelantar mensajes (warm): UNA petición por chat, sin repetir, y solo de Telegram
llamadas.length = 0;
const [a, b, c] = [5, 6, 7].map((n) => `-100777:${n}`); // de un chat que no se ha leído: sus mensajes no están en memoria
TG.warm([a, b, c, 'anime:21:3', 'anime:21:4']);
await pausa(60);
assert.equal(cuenta(/^getMessages/), 1, 'una sola petición para los tres');
assert.equal(llamadas.find((l) => l.startsWith('getMessages')), 'getMessages:5,6,7');
TG.warm([a, b, c]);
await pausa(30);
assert.equal(cuenta(/^getMessages/), 1, 'ya están en memoria: no se repite');

// 6) Imágenes: lo de internet pasa directo; lo que no está guardado devuelve null sin pedir nada a Telegram
assert.equal(await TG.imageLocal('https://img.test/a.jpg', 480), 'https://img.test/a.jpg');
llamadas.length = 0;
assert.equal(await TG.imageLocal(`${CHAT}:9`, 480), null);
assert.equal(llamadas.length, 0);

// 7) Una foto editada EN EL MISMO MENSAJE (portada vertical cambiada): la lectura de solo lo nuevo la detecta y cambia la llave de su imagen
r = await C.scanChat(CHAT, []); // lectura completa: deja guardado lo último
guardados = r.items;
const fotoId = msgs.find((m) => m.media.type === 'photo').id;
const fotoKey = `${CHAT}:${fotoId}`;
const antes = TG.imageStamp(fotoKey);
assert.equal(antes, '', 'sin editar: la llave de la imagen no cambia');
llamadas.length = 0;
r = await C.scanChat(CHAT, guardados, { manual: true });
assert.equal(r.incremental, true);
assert.equal(r.nuevos, 0, 'nada editado: no vuelve nada');
assert.ok(cuenta(/^getMessages/) >= 1, 'a mano revisa las fotos ya conocidas');
msgs.find((m) => m.id === fotoId).editDate = new Date(1.8e12);
llamadas.length = 0;
r = await C.scanChat(CHAT, guardados, { manual: true });
assert.equal(r.incremental, true);
assert.equal(r.nuevos, 1, 'solo vuelve la foto editada');
assert.equal(r.items.filter((i) => i.msgId === fotoId).length, 1, 'sin repetirla');
assert.equal(r.items.find((i) => i.msgId === fotoId).edit, 1.8e12);
assert.notEqual(TG.imageStamp(fotoKey), '', 'la imagen guardada ya no vale: se baja la nueva');
await pausa(900); // se guarda aparte (con un pequeño retraso) para valer desde el primer pintado de la próxima vez
assert.equal(JSON.parse(store.get('hf.imgedit'))[fotoKey], 1.8e12);
guardados = r.items;
llamadas.length = 0;
r = await C.scanChat(CHAT, guardados); // automática, hace poco se revisó: no vuelve a pedir
assert.equal(cuenta(/^getMessages/), 0, 'automática: no revisa si se revisó hace menos de 15 min');

// 8) Se BORRÓ algo (p. ej. se eliminó un tema y se volvió a copiar con lo mismo): una lectura de solo lo nuevo no lo vería; el conteo del chat no cuadra y se hace completa
r = await C.scanChat(CHAT, [], {});
guardados = r.items;
const antesN = guardados.length;
const borrar = msgs.filter((m) => m.media.type === 'video').slice(-5).map((m) => m.id); // los 5 videos más nuevos
borrar.forEach((id) => msgs.splice(msgs.findIndex((m) => m.id === id), 1));
video(2000); video(2001); video(2002); video(2003); video(2004); // se vuelven a subir 5
r = await C.scanChat(CHAT, guardados);
assert.equal(r.incremental, false, 'el total no cuadra: lectura completa');
assert.equal(r.items.length, antesN, 'ya no quedan los 5 borrados y están los 5 nuevos');
assert.ok(!r.items.some((i) => borrar.includes(i.msgId)), 'los borrados desaparecen');
guardados = r.items;
llamadas.length = 0;
r = await C.scanChat(CHAT, guardados); // sin cambios: otra vez solo lo nuevo, no repite la completa
assert.equal(r.incremental, true, 'sin cambios vuelve a ser rápida');
// borrar sin volver a subir
const uno = msgs.filter((m) => m.media.type === 'video').slice(-1)[0].id;
msgs.splice(msgs.findIndex((m) => m.id === uno), 1);
r = await C.scanChat(CHAT, guardados);
assert.equal(r.incremental, false); assert.ok(!r.items.some((i) => i.msgId === uno));

// 9) Lo guardado por una versión sin la cuenta de lo borrado (sin kv, como la 1.1.94) se lee completo una vez, aunque sea reciente: así se limpia lo borrado que ya estaba en la caché
const stv = JSON.parse(store.get('hf.scan.acc1')); delete stv[String(CHAT)].kv; delete stv[String(CHAT)].k; store.set('hf.scan.acc1', JSON.stringify(stv));
r = await C.scanChat(CHAT, guardados);
assert.equal(r.incremental, false, 'sin kv: lectura completa una vez');
r = await C.scanChat(CHAT, r.items);
assert.equal(r.incremental, true, 'y después vuelve a ser rápida');

console.log('OK: lectura completa en paralelo, incremental (solo lo nuevo), cuándo se repite completa, adelantar mensajes y fotos editadas y lo borrado');
