// Pruebas de la puerta al motor de recomendaciones (src/reco.js) y de las rutas internas que lee el motor.
// El motor Python es falso (se inyecta «recoPedir»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp, PREFIJO } from '../src/app.js';
import { huella } from '../src/base.js';

const LLAVE = 'Rk9_' + 'r'.repeat(40);
const OTRA = 'Zz1_' + 'z'.repeat(40);
const TOKEN = 't'.repeat(40);
const MOTOR = 'http://reco-api:8000';
const DOC = { app: 'homeflix', v: 2, profiles: { list: [{ id: 'p1', name: 'Diego', kids: false }, { id: 'p2', name: 'Kids', kids: true }] }, p: {} };

function motorFalso(visto, { caido = false, lento = false } = {}) {
  return async (url, opts = {}) => {
    visto.push({ url: String(url), metodo: opts.method, h: opts.headers || {}, cuerpo: opts.body ? JSON.parse(opts.body) : null });
    if (caido) throw new Error('ECONNREFUSED');
    if (lento) await new Promise((r, rej) => opts.signal.addEventListener('abort', () => rej(new Error('abort'))));
    const u = new URL(url);
    if (u.pathname === '/api/v1/recommendations/me') return Response.json({ request_id: 'req-1', model_version: 'content-v1', recommendations: [{ movie_id: 'm:coco:2017', score: 0.9, reasons: [{ type: 'popular', label: 'Popular' }] }], next_cursor: null });
    if (u.pathname.startsWith('/api/v1/recommendations/me/similar/')) return Response.json({ request_id: 'req-2', recommendations: [], movie_id: decodeURIComponent(u.pathname.split('/').pop()) });
    if (u.pathname === '/api/v1/events') return Response.json({ recibidos: 1, nuevos: 1 }, { status: 202 });
    if (u.pathname === '/api/v1/search/semantic') return Response.json({ recommendations: [] });
    return Response.json({ detail: 'no' }, { status: 404 });
  };
}

async function arrancar(opciones = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hf-reco-'));
  const visto = [];
  const app = crearApp({ dataDir: dir, recoUrl: MOTOR, recoToken: TOKEN, recoPedir: motorFalso(visto, opciones), ...(opciones.app || {}) });
  const srv = createServer(app.manejar);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const pedir = (ruta, { metodo = 'GET', llave = LLAVE, cuerpo, h = {} } = {}) => fetch(base + ruta, {
    method: metodo,
    headers: { ...(llave ? { authorization: `Bearer ${llave}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}), ...h },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  /* crear la cuenta como lo hace la app: un PUT de sync con su Telegram */
  const r = await pedir(`${PREFIJO}/api/v1/sync`, { metodo: 'PUT', cuerpo: { version: 0, doc: DOC, cuenta: { id: '555', nombre: 'Diego' } } });
  assert.equal(r.status, 200);
  return { app, visto, pedir, cerrar: () => { srv.close(); app.db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('reenvía al motor con la identidad puesta aquí, nunca la llave', async () => {
  const s = await arrancar();
  try {
    const r = await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones?perfil=p2&limite=5&otro=x`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).recommendations[0].movie_id, 'm:coco:2017');
    const v = s.visto[0];
    assert.equal(v.url, `${MOTOR}/api/v1/recommendations/me?limite=5`);
    assert.equal(v.h['x-reco-token'], TOKEN);
    assert.equal(v.h['x-reco-cuenta'], huella(LLAVE));
    assert.equal(v.h['x-reco-perfil'], 'p2');
    assert.equal(v.h['x-reco-kids'], '1');
    assert.ok(!JSON.stringify(v.h).includes(LLAVE));
  } finally { s.cerrar(); }
});

test('similares: el titleKey viaja codificado', async () => {
  const s = await arrancar();
  try {
    const r = await s.pedir(`${PREFIJO}/api/v1/reco/similares/${encodeURIComponent('m:el rey león:1994')}?perfil=p1`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).movie_id, 'm:el rey león:1994');
  } finally { s.cerrar(); }
});

test('perfil inválido, sin llave, cuenta inexistente o bloqueada', async () => {
  const s = await arrancar();
  try {
    assert.equal((await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones?perfil=p9`)).status, 400);
    assert.equal((await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones?perfil=../x`)).status, 400);
    assert.equal((await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones`, { llave: null })).status, 401);
    assert.equal((await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones`, { llave: OTRA })).status, 404);
    s.app.db.prepare('UPDATE cuentas SET bloqueada = 1').run();
    assert.equal((await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones?perfil=p1`)).status, 403);
    assert.equal(s.visto.length, 0);
  } finally { s.cerrar(); }
});

test('caché de 60 s por usuario; un evento la invalida', async () => {
  const s = await arrancar();
  try {
    const ruta = `${PREFIJO}/api/v1/reco/recomendaciones?perfil=p1`;
    await s.pedir(ruta); await s.pedir(ruta);
    assert.equal(s.visto.filter((v) => v.url.includes('/recommendations/me')).length, 1);
    const ev = await s.pedir(`${PREFIJO}/api/v1/reco/eventos`, { metodo: 'POST', cuerpo: { perfil: 'p1', eventos: [{ id: 'abc123', tipo: 'click', title_key: 'm:coco:2017' }], extra: 'no viaja' } });
    assert.equal(ev.status, 202);
    const enviado = s.visto.find((v) => v.url.endsWith('/api/v1/events'));
    assert.deepEqual(enviado.cuerpo, { eventos: [{ id: 'abc123', tipo: 'click', title_key: 'm:coco:2017' }] });
    await s.pedir(ruta);
    assert.equal(s.visto.filter((v) => v.url.includes('/recommendations/me')).length, 2);
  } finally { s.cerrar(); }
});

test('motor caído: GET con lista vacía, POST 503', async () => {
  const s = await arrancar({ caido: true });
  try {
    const r = await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones?perfil=p1`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { recommendations: [], degradado: true });
    const p = await s.pedir(`${PREFIJO}/api/v1/reco/eventos`, { metodo: 'POST', cuerpo: { perfil: 'p1', eventos: [] } });
    assert.equal(p.status, 503);
  } finally { s.cerrar(); }
});

test('sin RECO_URL/RECO_TOKEN las rutas existen pero no llaman a nadie', async () => {
  const s = await arrancar({ app: { recoUrl: '', recoToken: '' } });
  try {
    const r = await s.pedir(`${PREFIJO}/api/v1/reco/recomendaciones?perfil=p1`);
    assert.deepEqual(await r.json(), { recommendations: [], degradado: true });
    assert.equal(s.visto.length, 0);
  } finally { s.cerrar(); }
});

test('rutas internas: docs que cambiaron y cuenta por Telegram, solo con x-reco-token', async () => {
  const s = await arrancar();
  try {
    const sinToken = await s.pedir('/interno/v1/reco/docs?desde=0', { llave: null });
    assert.equal(sinToken.status, 404);
    const malo = await s.pedir('/interno/v1/reco/docs?desde=0', { llave: null, h: { 'x-reco-token': 'x'.repeat(40) } });
    assert.equal(malo.status, 404);
    const r = await s.pedir('/interno/v1/reco/docs?desde=0&limite=10', { llave: null, h: { 'x-reco-token': TOKEN } });
    const d = await r.json();
    assert.equal(d.cuentas.length, 1);
    assert.equal(d.cuentas[0].cuenta, huella(LLAVE));
    assert.deepEqual(d.cuentas[0].perfiles, [{ id: 'p1', kids: false }, { id: 'p2', kids: true }]);
    assert.equal(d.siguiente, null);
    const despues = await (await s.pedir(`/interno/v1/reco/docs?desde=${d.cuentas[0].vista}`, { llave: null, h: { 'x-reco-token': TOKEN } })).json();
    assert.equal(despues.cuentas.length, 0);

    const c = await (await s.pedir('/interno/v1/reco/cuenta-por-tg/555', { llave: null, h: { 'x-reco-token': TOKEN } })).json();
    assert.equal(c.cuenta, huella(LLAVE));
    assert.deepEqual(c.perfiles[1], { id: 'p2', name: 'Kids', kids: true });
    assert.equal((await s.pedir('/interno/v1/reco/cuenta-por-tg/999', { llave: null, h: { 'x-reco-token': TOKEN } })).status, 404);

    /* otra cuenta que diga ser del mismo Telegram no le gana a la original */
    await s.pedir(`${PREFIJO}/api/v1/sync`, { metodo: 'PUT', llave: OTRA, cuerpo: { version: 0, doc: DOC, cuenta: { id: '555' } } });
    const c2 = await (await s.pedir('/interno/v1/reco/cuenta-por-tg/555', { llave: null, h: { 'x-reco-token': TOKEN } })).json();
    assert.equal(c2.cuenta, huella(LLAVE));
  } finally { s.cerrar(); }
});
