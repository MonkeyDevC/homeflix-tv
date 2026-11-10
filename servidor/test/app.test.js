// Pruebas del servidor: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp, PREFIJO } from '../src/app.js';

const ADMIN = 'a'.repeat(40);
const LLAVE = 'Qx7_' + 'k'.repeat(40);
const OTRA = 'Zz9-' + 'm'.repeat(40);

async function levantar() {
  const dir = mkdtempSync(join(tmpdir(), 'hf-srv-'));
  const app = crearApp({ dataDir: dir, adminToken: ADMIN });
  const srv = createServer(app.manejar);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const cerrar = () => new Promise((r) => srv.close(() => { app.db.close(); rmSync(dir, { recursive: true, force: true }); r(); }));
  return { base, cerrar };
}

const doc = (extra = {}) => ({ app: 'homeflix', v: 2, at: Date.now(), profiles: { at: 0, list: [{ id: 'p1', name: 'Familia' }] }, sources: {}, tags: {}, p: { p1: { progress: {}, mylist: {} } }, ...extra });
const put = (base, llave, body) => fetch(`${base}${PREFIJO}/api/v1/sync`, { method: 'PUT', headers: { authorization: `Bearer ${llave}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (base, llave) => fetch(`${base}${PREFIJO}/api/v1/sync`, { headers: { authorization: `Bearer ${llave}` } });

test('crear la cuenta, leerla y guardar de nuevo', async () => {
  const { base, cerrar } = await levantar();
  try {
    assert.equal((await get(base, LLAVE)).status, 404, 'una llave nueva no tiene cuenta todavía');
    const r1 = await put(base, LLAVE, { version: 0, doc: doc(), cuenta: { id: '777', nombre: 'David' }, dispositivo: { id: 'tv-1', tipo: 'tv', nombre: 'TV 55' } });
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).version, 1);
    const g = await get(base, LLAVE);
    assert.equal(g.status, 200);
    const j = await g.json();
    assert.equal(j.version, 1);
    assert.equal(j.doc.profiles.list[0].name, 'Familia');
    const r2 = await put(base, LLAVE, { version: 1, doc: doc({ tags: { x: { at: 1, c: 'y' } } }) });
    assert.equal((await r2.json()).version, 2);
    assert.equal((await get(base, OTRA)).status, 404, 'otra llave no ve esta cuenta');
  } finally { await cerrar(); }
});

test('dos dispositivos a la vez: el segundo recibe 409 con lo guardado para combinar', async () => {
  const { base, cerrar } = await levantar();
  try {
    await put(base, LLAVE, { version: 0, doc: doc() });
    assert.equal((await put(base, LLAVE, { version: 1, doc: doc({ tags: { tv: { at: 2, c: 'a' } } }) })).status, 200);
    const tarde = await put(base, LLAVE, { version: 1, doc: doc({ tags: { cel: { at: 3, c: 'b' } } }) });
    assert.equal(tarde.status, 409);
    const j = await tarde.json();
    assert.equal(j.version, 2);
    assert.ok(j.doc.tags.tv, 'trae lo que guardó el otro dispositivo');
  } finally { await cerrar(); }
});

test('sin llave, con llave mal formada o con un documento que no es de HomeFlix', async () => {
  const { base, cerrar } = await levantar();
  try {
    assert.equal((await fetch(`${base}${PREFIJO}/api/v1/sync`)).status, 401);
    assert.equal((await get(base, 'corta')).status, 401);
    assert.equal((await put(base, LLAVE, { version: 0, doc: { app: 'otra' } })).status, 400);
    const pre = await fetch(`${base}${PREFIJO}/api/v1/sync`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-headers'), /x-homeflix-dispositivo/, 'las apps mandan su dispositivo: tiene que estar permitido');
  } finally { await cerrar(); }
});

test('API interna: solo con el token; resumen, cuentas y bloqueo', async () => {
  const { base, cerrar } = await levantar();
  try {
    await put(base, LLAVE, { version: 0, doc: doc({ p: { p1: { progress: { v1: { t: 5, d: 9, at: 1 } }, mylist: { 'm:a:1': { on: true, at: 1 } } } } }), cuenta: { id: '777', nombre: 'David', usuario: 'dav' }, dispositivo: { id: 'w1', tipo: 'web' } });
    assert.equal((await fetch(`${base}/interno/v1/resumen`)).status, 404, 'sin token no existe');
    const h = { 'x-homeflix-admin': ADMIN };
    const res = await (await fetch(`${base}/interno/v1/resumen`, { headers: h })).json();
    assert.equal(res.cuentas, 1);
    const lista = await (await fetch(`${base}/interno/v1/cuentas`, { headers: h })).json();
    const c = lista.cuentas[0];
    assert.equal(c.telegram.nombre, 'David');
    assert.equal(c.miLista, 1);
    assert.equal(c.videosConProgreso, 1);
    assert.equal(c.dispositivos[0].tipo, 'web');
    await fetch(`${base}${PREFIJO}/api/v1/sync`, { headers: { authorization: `Bearer ${LLAVE}`, 'x-homeflix-dispositivo': 'w1' } });
    const otra = await (await fetch(`${base}/interno/v1/cuentas`, { headers: h })).json();
    assert.equal(otra.cuentas[0].dispositivos[0].tipo, 'web', 'una lectura no borra el tipo del dispositivo');
    const b = await fetch(`${base}/interno/v1/cuentas/${c.id}/bloqueo`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{"bloqueada":true}' });
    assert.equal(b.status, 200);
    assert.equal((await get(base, LLAVE)).status, 403, 'una cuenta bloqueada no sincroniza');
    assert.equal((await fetch(`${base}${PREFIJO}/../interno/v1/resumen`)).status, 404, 'la API interna no se alcanza desde la ruta pública');
  } finally { await cerrar(); }
});

/* «Ver en la TV»: dos dispositivos de la misma cuenta se ven y se mandan mensajes; otra cuenta no los ve. */
function escuchar(base, llave, disp) {
  const ctrl = new AbortController();
  const llegados = [];
  let avisar = null;
  const listo = fetch(`${base}${PREFIJO}/api/v1/remoto/escuchar`, {
    headers: { authorization: `Bearer ${llave}`, 'x-homeflix-dispositivo': disp.id, 'x-homeflix-tipo': disp.tipo, 'x-homeflix-nombre': encodeURIComponent(disp.nombre) },
    signal: ctrl.signal,
  }).then(async (res) => {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for await (const c of res.body) {
          buf += dec.decode(c, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const bloque = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const datos = bloque.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
            if (datos && !/^event: hola/m.test(bloque)) { llegados.push(JSON.parse(datos)); if (avisar) avisar(); }
          }
        }
      } catch { /* cerrado */ }
    })();
  });
  const siguiente = () => new Promise((r) => { if (llegados.length) return r(llegados.shift()); avisar = () => { avisar = null; r(llegados.shift()); }; });
  return { listo, siguiente, cerrar: () => ctrl.abort() };
}
const remotoPost = (base, llave, disp, body) => fetch(`${base}${PREFIJO}/api/v1/remoto/enviar`, {
  method: 'POST', headers: { authorization: `Bearer ${llave}`, 'x-homeflix-dispositivo': disp, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const remotoLista = async (base, llave, disp) => (await (await fetch(`${base}${PREFIJO}/api/v1/remoto/dispositivos`, { headers: { authorization: `Bearer ${llave}`, 'x-homeflix-dispositivo': disp } })).json()).dispositivos;

test('ver en la TV: el celular encuentra la TV, le manda una orden y ella contesta', async () => {
  const { base, cerrar } = await levantar();
  const tv = { id: 'tv-1', tipo: 'tv', nombre: 'TV Sala ñ' };
  const cel = { id: 'cel-1', tipo: 'android', nombre: 'Android' };
  let a, b;
  try {
    assert.equal(await remotoLista(base, LLAVE, 'x'), undefined, 'sin cuenta todavía: 404');
    await put(base, LLAVE, { version: 0, doc: doc() });
    a = escuchar(base, LLAVE, tv); await a.listo;
    b = escuchar(base, LLAVE, cel); await b.listo;
    const lista = await remotoLista(base, LLAVE, cel.id);
    assert.deepEqual(lista.map((d) => [d.id, d.tipo, d.nombre]), [['tv-1', 'tv', 'TV Sala ñ']], 'el celular ve solo la TV, con su nombre');
    assert.equal((await remotoLista(base, OTRA, cel.id)), undefined, 'otra cuenta (sin documento) no entra');

    const r = await remotoPost(base, LLAVE, cel.id, { a: tv.id, msg: { t: 'play', key: '-1:7', start: 39 } });
    assert.equal(r.status, 200);
    const m = await a.siguiente();
    assert.equal(m.msg.t, 'play');
    assert.equal(m.de.id, cel.id);
    assert.equal(m.de.nombre, 'Android');

    await remotoPost(base, LLAVE, tv.id, { a: cel.id, msg: { t: 'state', time: 40 } });
    assert.equal((await b.siguiente()).msg.time, 40, 'la TV le contesta al celular');

    assert.equal((await remotoPost(base, LLAVE, cel.id, { a: 'nadie', msg: { t: 'x' } })).status, 404, 'a un dispositivo que no está conectado');
    assert.equal((await remotoPost(base, LLAVE, cel.id, { a: tv.id, msg: 'texto' })).status, 400);
    assert.equal((await remotoPost(base, LLAVE, cel.id, { a: tv.id, msg: { x: 'y'.repeat(20000) } })).status, 413, 'mensajes grandes no');

    a.cerrar();
    for (let i = 0; i < 50 && (await remotoLista(base, LLAVE, cel.id)).length; i++) await new Promise((r2) => setTimeout(r2, 20));
    assert.equal((await remotoLista(base, LLAVE, cel.id)).length, 0, 'al cerrar la app de la TV deja de aparecer');
  } finally { a?.cerrar(); b?.cerrar(); await cerrar(); }
});

test('actualizaciones: la versión vigente y sus archivos', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const vdir = mkdtempSync(join(tmpdir(), 'hf-ver-'));
  mkdirSync(join(vdir, '1.2.0'));
  writeFileSync(join(vdir, '1.2.0', 'web-1.2.0.json'), '{"ok":1}');
  writeFileSync(join(vdir, 'actual.json'), JSON.stringify({ version: '1.2.0', web: { archivo: 'web-1.2.0.json' } }));
  const dir = mkdtempSync(join(tmpdir(), 'hf-srv-'));
  const app = crearApp({ dataDir: dir, versionsDir: vdir });
  const srv = createServer(app.manejar);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}${PREFIJO}`;
  try {
    const v = await fetch(base + '/actualizaciones/v1');
    assert.equal(v.status, 200);
    assert.equal((await v.json()).version, '1.2.0');
    assert.equal(v.headers.get('access-control-allow-origin'), '*');
    const f = await fetch(base + '/actualizaciones/archivos/1.2.0/web-1.2.0.json');
    assert.equal(f.status, 200);
    assert.match(f.headers.get('cache-control'), /immutable/);
    assert.equal(await f.text(), '{"ok":1}');
    assert.equal((await fetch(base + '/actualizaciones/archivos/1.2.0/..%2Factual.json')).status, 404, 'no se sale de la carpeta');
    assert.equal((await fetch(base + '/actualizaciones/archivos/9.9.9/x.apk')).status, 404);
  } finally {
    await new Promise((r) => srv.close(r));
    app.db.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(vdir, { recursive: true, force: true });
  }
});

