// Pruebas del lector de comentarios y del armado de la biblioteca: node tools/test-library.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const L = require('../js/library.js');

const cases = [
  ['pelicula#El Rey León (1994)#Simba debe reclamar su lugar.', { type: 'movie', name: 'El Rey León', year: 1994, description: 'Simba debe reclamar su lugar.' }],
  ['Película # Coco # Un niño viaja a la tierra de los muertos.', { type: 'movie', name: 'Coco', year: 0 }],
  ['#pelicula#Up#', { type: 'movie', name: 'Up', description: '' }],
  ['MOVIE#Matrix#Neo #despierta.', { type: 'movie', name: 'Matrix', description: 'Neo #despierta.' }],
  ['pelicula#Coco\nDescripción en otra línea\ny otra más', { type: 'movie', name: 'Coco', description: 'Descripción en otra línea\ny otra más' }],
  ['serie(1/3)#Bluey#Juegan a los médicos.', { type: 'series', name: 'Bluey', season: 1, episode: 3, episodeTitle: '', description: 'Juegan a los médicos.' }],
  ['serie(T2/E10)#Bluey#El hospital#Juegan a los médicos.', { type: 'series', season: 2, episode: 10, episodeTitle: 'El hospital', description: 'Juegan a los médicos.' }],
  ['Serie (1x03) # Dark # Desc', { type: 'series', name: 'Dark', season: 1, episode: 3 }],
  ['series(S01E05)#Dark#Desc', { type: 'series', season: 1, episode: 5 }],
  ['serie(T1 C7)#Dark#Desc', { type: 'series', season: 1, episode: 7 }],
  ['serie(T1E2)#Dark#Desc', { type: 'series', season: 1, episode: 2 }],
  ['serie#Bluey#Ficha de la serie', { type: 'series', name: 'Bluey', season: 0, episode: 0, description: 'Ficha de la serie' }],
  ['Mira este video de las vacaciones', null],
  ['documental#Algo#x', null],
  ['', null],
  ['pelicula#   #sin nombre', null],
];

for (const [text, expected] of cases) {
  const got = L.parseCaption(text);
  if (expected === null) {
    assert.equal(got, null, `debería ignorar: ${JSON.stringify(text)}`);
  } else {
    for (const k of Object.keys(expected)) assert.equal(got[k], expected[k], `${JSON.stringify(text)} → ${k}`);
  }
}

assert.equal(L.titleFromFile('The.Last.Emperor.1987.1080p.BluRay.x264-WiKi.mkv'), 'The Last Emperor 1987');
assert.equal(L.titleFromFile('[Grupo] Vacaciones_playa.mp4'), 'Vacaciones playa');

const v = (key, caption, date, extra = {}) => ({ key, chatId: 1, msgId: date, kind: 'video', caption, fileName: key + '.mp4', duration: 1200, size: 1e8, height: 1080, date, ...extra });
const lib = L.build([
  v('a', 'serie(1/2)#Bluey#Dos', 5),
  v('b', 'serie(1/1)#Bluey#El primero#Uno', 4),
  v('c', 'serie(2/1)#bluey#Segunda temporada', 6),
  v('d', 'serie(1/1)#Bluey#Uno repetido más nuevo', 9),
  v('e', 'pelicula#Coco (2017)#Desc', 3),
  v('f', 'pelicula#Coco (2017)#Repetida vieja', 1),
  v('g', 'Video de la playa', 2),
  v('h', 'serie#Dark#sin capítulo', 7),
  { key: 'p1', kind: 'photo', caption: 'serie#Bluey#Ficha con portada', date: 8 },
]);

assert.equal(lib.movies.length, 1);
assert.equal(lib.movies[0].video.key, 'e', 'la película repetida usa la más nueva');
assert.equal(lib.movies[0].year, 2017);
const bluey = lib.series.find((s) => s.name === 'Bluey');
assert.equal(bluey.seasons.length, 2);
assert.deepEqual(bluey.seasons[0].episodes.map((e) => e.key), ['d', 'a'], 'el capítulo repetido usa el más nuevo');
assert.equal(bluey.seasons[0].episodes[1].title, 'Capítulo 2');
assert.equal(bluey.description, 'Ficha con portada');
assert.equal(bluey.imageKey, 'p1');
assert.equal(bluey.episodeCount, 3);
const dark = lib.series.find((s) => s.name === 'Dark');
assert.equal(dark.seasons[0].episodes[0].episode, 1, 'capítulo sin número va a T1 en orden');
assert.equal(lib.unclassified.length, 1);
assert.equal(lib.unclassified[0].name, 'g');
assert.equal(lib.recent[0].name, 'Bluey');

// ----- Fase 4: infantil, etiquetas desde la TV, perfiles -----
assert.equal(L.parseCaption('pelicula#Coco#Desc #infantil').kids, true);
assert.equal(L.parseCaption('pelicula#Coco#Desc #infantil').description, 'Desc');
assert.equal(L.parseCaption('serie(1/2)#Bluey#Hospital#Desc #kids').episodeTitle, 'Hospital');
assert.equal(L.parseCaption('pelicula#Coco#Desc').kids, false);

for (const f of [
  { type: 'movie', name: 'El Rey León', year: 1994, description: 'Simba.', kids: true },
  { type: 'series', name: 'Bluey', season: 2, episode: 7, episodeTitle: 'Abuelos', description: 'Visita.', kids: false },
  { type: 'series', name: 'Dark', season: 1, episode: 1, description: 'Sin título.' },
]) {
  const p = L.parseCaption(L.composeCaption(f));
  assert.equal(p.type, f.type);
  assert.equal(p.name, f.name);
  assert.equal(p.kids, !!f.kids);
  if (f.year) assert.equal(p.year, f.year);
  if (f.type === 'series') { assert.equal(p.season, f.season); assert.equal(p.episode, f.episode); assert.equal(p.episodeTitle, f.episodeTitle || ''); }
  assert.equal(p.description, f.description);
}
assert.equal(L.parseCaption(L.composeCaption({ type: 'movie', name: 'Con # raro', description: 'a#b' })).name, 'Con  raro'.replace('  ', ' '));

const tagged = L.build([v('g', 'Video de la playa', 2), v('e', 'pelicula#Coco (2017)#Desc', 3)], { g: 'serie(1/1)#Bluey#Etiquetado en la TV #infantil' });
assert.equal(tagged.unclassified.length, 0, 'la etiqueta local saca el video de Sin clasificar');
assert.equal(tagged.series[0].name, 'Bluey');
assert.equal(tagged.series[0].kids, true);
assert.equal(tagged.series[0].seasons[0].episodes[0].tagged, true);
const kidsLib = L.filterKids(tagged);
assert.deepEqual(kidsLib.series.map((s) => s.name), ['Bluey']);
assert.equal(kidsLib.movies.length, 0, 'Coco no está marcada #infantil');
assert.equal(kidsLib.unclassified.length, 0);

// Perfiles con almacenamiento simulado
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, val) => store.set(k, String(val)), removeItem: (k) => store.delete(k) } };
L.setAccount('123');
const ps = L.profiles();
assert.equal(ps.length, 4);
assert.equal(ps.find((p) => p.name === 'Kids').kids, true);
L.setProfile(ps[0].id); L.setProgress('x', 100, 1000);
L.setProfile(ps[1].id); assert.equal(L.progress('x'), null, 'el progreso es por perfil');
L.setProgress('x', 300, 1000);
L.setProfile(ps[0].id); assert.equal(L.progress('x').t, 100);
assert.ok(L.saveProfile({ name: 'familia' }).error, 'nombre repetido');
const added = L.saveProfile({ name: 'Abuela', color: 'rojo' });
assert.ok(added.profile && added.profile.id);
assert.ok(L.saveProfile({ name: 'Sexto' }).error, 'máximo 5 perfiles');
assert.equal(L.deleteProfile(ps[1].id), true);
L.setProfile(ps[1].id); assert.equal(L.progress('x'), null, 'borrar el perfil borra su progreso');
assert.equal(L.profiles().length, 4);

// Fotos de portada y banner: se pegan al título por nombre (y año)
{
  const ph = (key, caption, date) => ({ key, chatId: 1, msgId: date, kind: 'photo', caption, date });
  assert.equal(L.parseCaption('pelicula#Toy Story 5 (2026) #portada').image, 'portada');
  assert.equal(L.parseCaption('pelicula#Toy Story 5 (2026)#banner').image, 'banner');
  const pk = L.parseCaption('pelicula#Toy Story 5 (2026) #banner #infantil');
  assert.equal(pk.image, 'banner'); assert.equal(pk.kids, true); assert.equal(pk.name, 'Toy Story 5'); assert.equal(pk.year, 2026);
  const b = L.build([
    v('ts5', 'pelicula#Toy Story 5 (2026)#Los juguetes vuelven. #infantil', 10),
    ph('p1', 'pelicula#Toy Story 5 (2026) #portada', 11),
    ph('b1', 'pelicula#Toy Story 5 (2026) #banner', 12),
    v('dk', 'serie(1/1)#Dark#Piloto', 13),
    ph('db', 'serie#Dark #banner', 14),
    v('up', 'pelicula#Up (2009)#Globos', 15),
    ph('upf', 'pelicula#Up#Ficha vieja sin marca', 16),
  ]);
  const ts = b.movies.find((m) => m.name === 'Toy Story 5');
  assert.equal(ts.imageKey, 'p1', 'la portada va en la tarjeta');
  assert.equal(ts.bannerKey, 'b1', 'el banner va en el fondo grande');
  const dark = b.series.find((s) => s.name === 'Dark');
  assert.equal(dark.bannerKey, 'db'); assert.equal(dark.imageKey, 'dk', 'sin portada, la tarjeta sigue usando el video');
  const up = b.movies.find((m) => m.name === 'Up');
  assert.equal(up.imageKey, 'upf', 'la foto sin año vale para la película con año');
  assert.equal(up.bannerKey, 'upf'); assert.equal(up.description, 'Ficha vieja sin marca');
}

// Varias calidades del mismo título: un solo título con sus versiones
{
  const q = (key, caption, date, w, h, size) => ({ key, chatId: 1, msgId: date, kind: 'video', caption, fileName: key + '.mp4', duration: 100, size, width: w, height: h, date });
  const c = 'pelicula#Toy Story 5 (2026)#x';
  const b = L.build([
    q('k1080', c, 20, 1920, 1080, 62.5e6),
    q('k4k', c, 21, 3840, 1608, 200e6),
    q('k360', c, 22, 640, 360, 8.75e6),
    q('k720', c, 23, 1280, 536, 32.5e6),
    q('k720b', c, 24, 1280, 720, 33e6),
    { key: 'kdoc', chatId: 1, msgId: 30, kind: 'video', caption: 'serie(1/1)#Dark#P', fileName: 'Dark T1E1 [1080p].mkv', duration: 0, size: 1, width: 0, height: 0, date: 30 },
    q('kdoc2', 'serie(1/1)#Dark#P', 31, 3840, 2160, 9),
  ]);
  assert.equal(b.movies.length, 1, 'las calidades no se repiten como títulos');
  const m = b.movies[0];
  assert.deepEqual(m.versions.map((x) => x.q), ['4K', '1080p', '720p', '360p']);
  assert.equal(m.versions.find((x) => x.q === '720p').key, 'k720b', 'misma calidad: gana la más nueva');
  assert.equal(m.video.key, 'k1080', 'la identidad es la versión más antigua (no cambia al subir otra calidad)');
  assert.equal(m.quality, '4K');
  assert.equal(m.versions[0].bps, 16e6);
  assert.equal(b.byKey.k360, m);
  const ep = b.series[0].seasons[0].episodes[0];
  assert.equal(b.series[0].seasons[0].episodes.length, 1);
  assert.deepEqual(ep.versions.map((x) => x.q), ['4K', '1080p'], 'el MKV sin medidas toma la calidad del nombre');
  assert.equal(ep.key, 'kdoc');
}

// Una calidad en partes: se juntan en orden; si falta alguna, esa versión no se usa todavía
{
  const pt = (key, file, date, dur, size, h = 2160) => ({ key, chatId: 1, msgId: date, kind: 'video', caption: 'pelicula#Larga (2026)', fileName: file, duration: dur, size, width: Math.round((h * 16) / 9), height: h, date });
  const b = L.build([
    pt('p2', 'Larga (2026) [2160p] parte 2 de 3.mp4', 41, 1000, 1.7e9),
    pt('p1', 'Larga (2026) [2160p] parte 1 de 3.mp4', 40, 1000, 1.7e9),
    pt('p3', 'Larga (2026) [2160p] parte 3 de 3.mp4', 42, 600, 1.0e9),
    pt('h1', 'Larga (2026) [1080p].mp4', 43, 2600, 1.6e9, 1080),
  ]);
  const m = b.movies[0];
  assert.equal(b.movies.length, 1);
  const k4 = m.versions[0];
  assert.equal(k4.q, '4K');
  assert.deepEqual(k4.parts.map((x) => x.key), ['p1', 'p2', 'p3'], 'partes en orden');
  assert.equal(k4.dur, 2600);
  assert.equal(k4.bps, Math.round((4.4e9 * 8) / 2600));
  assert.equal(m.video.key, 'h1', 'la identidad prefiere la versión de un solo archivo');
  assert.equal(m.video.duration, 2600, 'la duración es la de la película entera');
  assert.equal(b.byKey.p3, m, 'cada parte lleva al título');
  const inc = L.build([pt('q1', 'X [2160p] parte 1 de 2.mp4', 50, 900, 1e9), pt('q9', 'X [1080p].mp4', 51, 1800, 1e9, 1080)]).movies[0];
  assert.deepEqual(inc.versions.map((x) => x.q), ['1080p'], 'el 4K incompleto no se ofrece');
  const only = L.build([pt('r2', 'Y [2160p] parte 2 de 2.mp4', 60, 900, 1e9)]).movies[0];
  assert.equal(only.versions.length, 1);
  assert.equal(only.versions[0].incomplete, true, 'solo partes sueltas: se muestra la que hay');
}


/* Categorías: cualquier #palabra al final (separada por espacio) que no sea una marca conocida */
{
  const p = L.parseCaption('pelicula#Spider-Man: No Way Home (2021)#Peter pide ayuda. #Marvel');
  assert.deepEqual(p.categories, ['Marvel']);
  assert.equal(p.description, 'Peter pide ayuda.');
  const q = L.parseCaption('pelicula#Coco (2017)#Desc #Animación #ciencia_ficción #infantil');
  assert.deepEqual(q.categories, ['Animación', 'Ciencia ficción']);
  assert.equal(q.kids, true);
  assert.equal(q.description, 'Desc');
  assert.deepEqual(L.parseCaption('pelicula#Coco#El #1 del año').categories, [], 'un # en medio de la descripción no es categoría');
  assert.deepEqual(L.parseCaption('pelicula #Marvel').categories, [], 'el nombre no se toma como categoría');
  assert.deepEqual(L.parseCaption('pelicula#Marvel').categories, []);
  assert.equal(L.parseCaption('pelicula#Marvel').name, 'Marvel');
  /* falta el # después del año: lo que sigue es la descripción */
  const sinNumeral = L.parseCaption('Pelicula#La leyenda del Dragón Blanco (2026) Tras un cataclismo devastador, los héroes… #Fantasía');
  assert.equal(sinNumeral.name, 'La leyenda del Dragón Blanco');
  assert.equal(sinNumeral.year, 2026);
  assert.equal(sinNumeral.description, 'Tras un cataclismo devastador, los héroes…');
  assert.deepEqual(sinNumeral.categories, ['Fantasía']);
  assert.equal(L.parseCaption('pelicula#Toy Story (1995)').description, '');
  const back = L.parseCaption(L.composeCaption({ type: 'movie', name: 'Dune', year: 2021, description: 'Arena.', categories: ['Ciencia ficción', 'Acción'], kids: false }));
  assert.deepEqual(back.categories, ['Ciencia ficción', 'Acción']);
  assert.equal(back.description, 'Arena.');
  const lib = L.build([
    v('a', 'pelicula#Iron Man (2008)#x [1080p] #Marvel', 10, { fileName: 'iron [1080p].mp4' }),
    v('b', 'pelicula#Iron Man (2008)#x #MARVEL #Acción', 11, { height: 720, fileName: 'iron [720p].mp4' }),
    v('c', 'serie(1/1)#Loki#Ep #Marvel', 12),
  ], {});
  assert.deepEqual(lib.movies[0].categories, ['Marvel', 'Acción'], 'se suman sin repetir entre versiones');
  assert.deepEqual(lib.series[0].categories, ['Marvel']);
}

// Sincronizar entre dispositivos: dos almacenamientos (TV y celular) que se pasan el documento de un lado a otro
{
  const devices = { tv: new Map(), phone: new Map() };
  const use = (name) => { store.clear(); devices[name].forEach((v, k) => store.set(k, v)); };
  const keep = (name) => { devices[name] = new Map(store); };
  const tick = () => { const t = Date.now(); while (Date.now() === t) { /* un milisegundo entre dispositivos */ } };
  const on = (name, fn) => { tick(); use(name); L.setAccount('777'); const r = fn(); keep(name); return r; };
  let notices = 0;
  L.onChange(() => { notices += 1; });

  // La TV ya tenía Mi lista de antes (sin registro de fechas) y progreso
  on('tv', () => {
    L.setProfile('p2');
    store.set('hf.mylist.777.p2', JSON.stringify(['m:coco:2017', 'm:up:2009']));
    L.setProgress('c:1', 600, 6000);
    L.setEnabledSources({ '-100': 'NETSUCKS' });
  });
  const fromTv = on('tv', () => L.exportSync());

  // El celular, recién instalado, recibe todo
  const got = on('phone', () => { const ch = L.mergeSync(fromTv); L.setProfile('p2'); return { ch, list: L.myList(), p: L.progress('c:1'), src: L.enabledSources() }; });
  assert.equal(got.ch, true);
  assert.deepEqual(got.list, ['m:coco:2017', 'm:up:2009'], 'Mi lista de la TV llega al celular');
  assert.equal(got.p.t, 600);
  assert.deepEqual(got.src, { '-100': 'NETSUCKS' }, 'los chats del perfil también');

  // En el celular se quita Coco y se avanza la película; en la TV se agrega otra cosa
  on('phone', () => { L.setProfile('p2'); L.toggleMyList('m:coco:2017'); L.setProgress('c:1', 1200, 6000); });
  on('tv', () => { L.setProfile('p2'); L.toggleMyList('m:hoppers:2026'); });
  const fromPhone = on('phone', () => L.exportSync());
  const tvNow = on('tv', () => { L.mergeSync(fromPhone); L.setProfile('p2'); return { list: L.myList(), p: L.progress('c:1') }; });
  assert.deepEqual(tvNow.list, ['m:hoppers:2026', 'm:up:2009'], 'lo quitado en el celular se quita en la TV y se conserva lo agregado en la TV');
  assert.equal(tvNow.p.t, 1200, 'gana el progreso más reciente');

  // Y de vuelta: el celular recibe lo agregado en la TV, sin que reaparezca Coco
  const fromTv2 = on('tv', () => L.exportSync());
  const phoneNow = on('phone', () => { L.mergeSync(fromTv2); L.setProfile('p2'); return L.myList(); });
  assert.deepEqual(phoneNow, ['m:hoppers:2026', 'm:up:2009']);

  // Perfiles: un cambio de nombre en la TV llega al celular; los perfiles por defecto del celular no pisan nada
  on('tv', () => { L.saveProfile({ id: 'p2', name: 'Santi', avatar: '02-Captain_Carter', kids: false }); });
  const fromTv3 = on('tv', () => L.exportSync());
  const names = on('phone', () => { L.mergeSync(fromTv3); return L.profiles().map((p) => p.name); });
  assert.deepEqual(names, ['Familia', 'Santi', 'Kids', 'Invitado']);

  // Perfiles hechos antes de sincronizar: la TV tiene «Santiago» con otro id y su avatar; el celular, el de fábrica.
  // Debe quedar uno solo (el de la TV) y su «Continuar viendo» tiene que llegar al celular.
  {
    const d2 = { tv: new Map(), phone: new Map() };
    const on2 = (name, fn) => { tick(); store.clear(); d2[name].forEach((v, k) => store.set(k, v)); L.setAccount('888'); const r = fn(); d2[name] = new Map(store); return r; };
    on2('tv', () => {
      store.set('hf.profiles.888', JSON.stringify([
        { id: 'p1', name: 'Familia', avatar: '01-Spider-Man', kids: false },
        { id: 'pmh2x', name: 'Santiago', avatar: '02-Captain_Carter', kids: false },
        { id: 'p3', name: 'Kids', avatar: '04-Spider-Man_comic', kids: true }
      ]));
      L.setProfile('pmh2x');
      L.setProgress('v:hoppers', 2400, 6000);
    });
    on2('phone', () => { L.setProfile('p2'); L.setProgress('v:otra', 100, 3000); });
    const tvDoc = on2('tv', () => L.exportSync());
    const r = on2('phone', () => {
      L.mergeSync(tvDoc);
      const ps = L.profiles();
      L.setProfile('pmh2x');
      return { names: ps.map((p) => p.name + ':' + p.avatar), hop: L.progress('v:hoppers'), otra: L.progress('v:otra') };
    });
    assert.deepEqual(r.names, ['Familia:01-Spider-Man', 'Santiago:02-Captain_Carter', 'Kids:04-Spider-Man_comic', 'Invitado:buho'], 'los perfiles personalizados de la TV reemplazan a los de fábrica, sin duplicar');
    assert.equal(r.hop.t, 2400, '«Continuar viendo» de la TV llega al celular');
    assert.equal(r.otra.t, 100, 'y se conserva lo que el celular tenía en ese perfil');
  }

  // Sin novedades: no cambia nada y no avisa (para no devolver el documento en bucle)
  const before = notices;
  const fromTv4 = on('tv', () => L.exportSync());
  const again = on('phone', () => L.mergeSync(fromTv4));
  assert.equal(again, false);
  assert.equal(notices, before, 'combinar no dispara avisos de cambio');
}

console.log(`OK: ${cases.length} comentarios, armado de la biblioteca, infantil, etiquetas, perfiles y sincronización`);
