// Caché de la biblioteca del preparador (tools/preparador/cache.js) con un Telegram falso: node tools/test-preparador-cache.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const sandbox = { window: {}, console, setTimeout, Promise, Date, Object, JSON, Math };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'tools', 'preparador', 'cache.js'), 'utf8') + '\nthis.PrepCache = PrepCache; this.PrepCatalog = PrepCatalog;', sandbox);
const { PrepCache, PrepCatalog } = sandbox;

/* almacenamiento en memoria */
const mem = new Map();
PrepCache._use({ get: (s, k) => (mem.has(s + '|' + k) ? structuredClone(mem.get(s + '|' + k)) : null), put: (s, k, v) => mem.set(s + '|' + k, structuredClone(v)), del: (s, k) => mem.delete(s + '|' + k) });

/* ---- el chat ---- */
const CHAT = -1001234567890;
const OLD = -4321;
const chat = { id: CHAT };
const oldChat = { id: OLD };
const msgs = [];
let nextId = 1;
const add = (c, media, text) => { const id = nextId++; msgs.push({ id, chat: c, text, date: new Date(1.7e12 + id * 1000), media }); return id; };
const vid = (n, c = chat) => add(c, { type: 'video', isRound: false, isAnimation: false, fileName: `p${n}.mp4`, duration: 6000, fileSize: 1e9, width: 1920, height: 1080 }, `pelicula#Peli ${n} (2020)#d`);
const foto = (n, texto) => add(chat, { type: 'photo' }, texto === undefined ? `pelicula#Peli ${n} (2020)#portada #portada` : texto);
for (let i = 0; i < 230; i++) vid(i);
for (let i = 0; i < 20; i++) foto(i);
const fotoEditable = foto(99);
const viejos = [vid(500, oldChat), vid(501, oldChat)];

/* ---- Telegram falso ---- */
const llamadas = [];
let enCurso = 0;
let maxJuntas = 0;
let fallaGetMessages = false;
let floods = 0; // cuántas veces seguidas Telegram contesta FLOOD_WAIT antes de responder
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const FILTRO = { inputMessagesFilterVideo: (m) => m.media.type === 'video', inputMessagesFilterDocument: (m) => m.media.type === 'document', inputMessagesFilterPhotos: (m) => m.media.type === 'photo' };
const idDe = (t) => (typeof t === 'object' ? t.id : t);
const client = {
  searchMessages: async ({ chatId, filter, limit, offset }) => {
    enCurso += 1; maxJuntas = Math.max(maxJuntas, enCurso);
    llamadas.push('search:' + filter._ + ':' + (offset || 0));
    await pausa(10);
    enCurso -= 1;
    const todos = msgs.filter((m) => m.chat.id === idDe(chatId) && FILTRO[filter._](m)).sort((a, b) => b.id - a.id);
    const ini = offset || 0;
    const page = todos.slice(ini, ini + limit);
    page.next = ini + limit < todos.length ? ini + limit : undefined;
    return page;
  },
  getMessages: async (chatId, ids) => {
    llamadas.push('get:' + ids.length);
    await pausa(10);
    if (fallaGetMessages) throw new Error('red caída');
    if (floods > 0) { floods -= 1; throw new Error('FLOOD_WAIT_%d'); }
    return ids.map((id) => msgs.find((m) => m.chat.id === idDe(chatId) && m.id === id) || null);
  },
};
const cuenta = (re) => llamadas.filter((l) => re.test(l)).length;
const base = { client, peer: chat, old: oldChat, chatId: String(CHAT), meId: '77' };

// 0) sin caché
assert.equal(await PrepCatalog.peek('77', String(CHAT)), null);

// 1) primera vez: lectura completa (los tres filtros a la vez, y el grupo de antes) y se guarda
let m1 = {};
let r = await PrepCatalog.refresh({ ...base, msgs: m1 });
assert.equal(r.mode, 'completa');
assert.equal(r.items.length, 230 + 21 + 2);
assert.ok(maxJuntas >= 3, 'los tres filtros a la vez: ' + maxJuntas);
assert.equal(Object.keys(m1).length, 253, 'los mensajes quedan a mano');
let c = await PrepCatalog.peek('77', String(CHAT));
assert.equal(c.items.length, 253);
assert.equal(c.max, nextId - 3, 'el id más nuevo del chat actual (no el del grupo viejo)');

// 2) segunda vez: solo lo nuevo + revisar lo conocido (ediciones y borrados)
const nueva = vid(901); const nuevaFoto = foto(901);
msgs.find((m) => m.id === 10).text = 'pelicula#Peli 9 EDITADA (2020)#d #Marvel'; // comentario editado
msgs.splice(msgs.findIndex((m) => m.id === 11), 1);                             // video borrado
msgs.find((m) => m.id === fotoEditable).text = 'ya no es una ficha';           // a una foto se le quitó el #
llamadas.length = 0; maxJuntas = 0;
const m2 = {};
r = await PrepCatalog.refresh({ ...base, msgs: m2 });
assert.equal(r.mode, 'nuevos');
assert.equal(r.nuevos, 2, 'dos mensajes nuevos');
assert.equal(r.quitados, 2, 'el borrado y la foto que dejó de ser ficha');
assert.equal(r.cambiados, 1, 'el comentario editado');
assert.equal(r.items.length, 253 + 2 - 2);
assert.ok(r.items.some((i) => i.msgId === 10 && /EDITADA/.test(i.caption)), 'el comentario nuevo');
assert.ok(!r.items.some((i) => i.msgId === 11), 'el borrado ya no está');
assert.ok(!r.items.some((i) => i.msgId === fotoEditable));
assert.equal(JSON.stringify(Array.from(r.items.slice(0, 2).map((i) => i.msgId)).sort((a, b) => b - a)), JSON.stringify([nuevaFoto, nueva].sort((a, b) => b - a)), 'lo nuevo va primero');
assert.ok(cuenta(/^search/) <= 3, 'una página por filtro: ' + llamadas.join(' '));
assert.equal(cuenta(/^get:/), 4, '3 tandas de ≤100 del chat actual y 1 del grupo de antes: ' + llamadas.join(' '));
assert.ok(Object.keys(m2).length >= 250, 'los mensajes conocidos vuelven a estar a mano');
assert.equal(r.hydrated, true);

// 3) si Telegram no contesta al revisar lo conocido, no se pierde nada
fallaGetMessages = true;
r = await PrepCatalog.refresh({ ...base, msgs: {} });
assert.equal(r.hydrated, false);
assert.equal(r.items.length, 253, 'se conserva lo guardado');
fallaGetMessages = false;

// 3b) un FLOOD_WAIT de Telegram no deja la lectura de fondo a medias: espera y reintenta
floods = 1;
r = await PrepCatalog.refresh({ ...base, msgs: {} });
assert.equal(r.hydrated, true, 'con un FLOOD_WAIT se reintenta y se hidrata');
assert.equal(floods, 0);

// 4) cuándo se lee completo
r = await PrepCatalog.refresh({ ...base, msgs: {}, full: true });
assert.equal(r.mode, 'completa');
const k = 'cat:77:' + CHAT;
const g = mem.get('kv|' + k);
mem.set('kv|' + k, { ...g, full: Date.now() - 25 * 3600 * 1000 });
r = await PrepCatalog.refresh({ ...base, msgs: {} });
assert.equal(r.mode, 'completa', 'pasaron más de 24 h');
mem.set('kv|' + k, { ...mem.get('kv|' + k), n: 1000 });
r = await PrepCatalog.refresh({ ...base, msgs: {} });
assert.equal(r.mode, 'completa', 'lo guardado no cuadra con lo que se esperaba');
r = await PrepCatalog.refresh({ ...base, msgs: {} });
assert.equal(r.mode, 'nuevos', 'y vuelve a lo rápido');
r = await PrepCatalog.refresh({ ...base, chatId: '-100555', peer: { id: -100555 }, old: null, msgs: {} });
assert.equal(r.mode, 'completa', 'un chat nuevo se lee completo');

// 5) portadas guardadas en el navegador
assert.equal(await PrepCache.thumbGet('x'), null);
await PrepCache.thumbPut('x', new Uint8Array([1, 2, 3]));
assert.equal(Array.from(await PrepCache.thumbGet('x')).join(','), '1,2,3');

console.log('OK: caché del preparador (completa, solo lo nuevo, ediciones, borrados, fallas y portadas)');
