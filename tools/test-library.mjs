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
assert.deepEqual(ps.map((p) => p.name), ['Principal', 'Kids'], 'una cuenta nueva arranca con los suyos (sin nombre de cuenta: «Principal»)');
assert.equal(ps.find((p) => p.name === 'Kids').kids, true);
L.setProfile(ps[0].id); L.setProgress('x', 100, 1000);
L.setProfile(ps[1].id); assert.equal(L.progress('x'), null, 'el progreso es por perfil');
L.setProgress('x', 300, 1000);
L.setProfile(ps[0].id); assert.equal(L.progress('x').t, 100);
assert.ok(L.saveProfile({ name: 'principal' }).error, 'nombre repetido');
const added = L.saveProfile({ name: 'Abuela', color: 'rojo' });
assert.ok(added.profile && added.profile.id);
assert.ok(L.saveProfile({ name: 'Tío' }).profile);
assert.ok(L.saveProfile({ name: 'Prima' }).profile);
assert.ok(L.saveProfile({ name: 'Sexto' }).error, 'máximo 5 perfiles');
assert.equal(L.deleteProfile(ps[1].id), true);
L.setProfile(ps[1].id); assert.equal(L.progress('x'), null, 'borrar el perfil borra su progreso');
assert.equal(L.profiles().length, 4);

// Cada cuenta tiene sus propios perfiles: una cuenta nueva toma el nombre de su cuenta de Telegram, no los de otra
{
  L.rememberAccount({ slot: 'main', id: '555', name: 'Laura Pérez' }, 'main');
  L.setAccount('555');
  assert.deepEqual(L.profiles().map((p) => p.name), ['Laura', 'Kids'], 'otra cuenta: su nombre y «Kids»');
  assert.ok(!L.profiles().some((p) => p.name === 'Santiago' || p.name === 'Familia'), 'nada de los perfiles de otra cuenta');
  // una cuenta que ya había arrancado con los 4 de fábrica de antes, sin tocar, pasa a los suyos
  store.set('hf.profiles.555', JSON.stringify([
    { id: 'p1', name: 'Familia', color: 'amarillo', avatar: 'panda', kids: false },
    { id: 'p2', name: 'Santiago', color: 'azul', avatar: 'zorro', kids: false },
    { id: 'p3', name: 'Kids', color: 'verde', avatar: 'dino', kids: true },
    { id: 'p4', name: 'Invitado', color: 'cafe', avatar: 'buho', kids: false }
  ]));
  assert.deepEqual(L.profiles().map((p) => p.name), ['Laura', 'Kids'], 'los 4 de fábrica viejos se cambian por los de la cuenta');
  // pero si se había editado alguno, se respeta
  store.set('hf.profiles.555', JSON.stringify([
    { id: 'p1', name: 'Familia', color: 'amarillo', avatar: '02-Captain_Carter', kids: false, at: 5 },
    { id: 'p2', name: 'Santiago', color: 'azul', avatar: 'zorro', kids: false },
    { id: 'p3', name: 'Kids', color: 'verde', avatar: 'dino', kids: true },
    { id: 'p4', name: 'Invitado', color: 'cafe', avatar: 'buho', kids: false }
  ]));
  assert.equal(L.profiles().length, 4, 'con un perfil editado no se toca nada');
  L.forgetAllAccounts();
  L.setAccount('123');
}

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
  assert.deepEqual(q.categories, ['Animadas', 'Ciencia ficción y fantasía']);
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
  assert.deepEqual(sinNumeral.categories, ['Ciencia ficción y fantasía']);
  assert.equal(L.parseCaption('pelicula#Toy Story (1995)').description, '');
  const back = L.parseCaption(L.composeCaption({ type: 'movie', name: 'Dune', year: 2021, description: 'Arena.', categories: ['Ciencia ficción', 'Acción'], kids: false }));
  assert.deepEqual(back.categories, ['Ciencia ficción y fantasía', 'Acción y aventura']);
  assert.equal(back.description, 'Arena.');
  const lib = L.build([
    v('a', 'pelicula#Iron Man (2008)#x [1080p] #Marvel', 10, { fileName: 'iron [1080p].mp4' }),
    v('b', 'pelicula#Iron Man (2008)#x #MARVEL #Acción', 11, { height: 720, fileName: 'iron [720p].mp4' }),
    v('c', 'serie(1/1)#Loki#Ep #Marvel', 12),
  ], {});
  assert.deepEqual(lib.movies[0].categories, ['Marvel', 'Acción y aventura'], 'se suman sin repetir entre versiones');
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
  assert.deepEqual(names, ['Principal', 'Santi']);

  // TV en vivo: el enlace puesto en el celular llega a la TV; los favoritos van con el perfil
  on('phone', () => { L.setProfile('p2'); L.setIptv('http://prov.example/lista.m3u'); L.toggleIptvFav('noticias|cnn'); });
  const ipDoc = on('phone', () => L.exportSync());
  const ipTv = on('tv', () => { L.mergeSync(ipDoc); L.setProfile('p2'); return { cfg: L.iptv(), favs: L.iptvFavs() }; });
  assert.equal(ipTv.cfg.url, 'http://prov.example/lista.m3u');
  assert.deepEqual(ipTv.favs, { 'noticias|cnn': true });
  // quitar la lista en la TV también llega al celular
  on('tv', () => L.setIptv(''));
  const ipDoc2 = on('tv', () => L.exportSync());
  assert.equal(on('phone', () => { L.mergeSync(ipDoc2); return L.iptv(); }), null);

  // Perfiles hechos antes de sincronizar: la TV tiene los suyos personalizados (uno con otro id); el celular, los
  // iniciales. Quedan los de la TV sin duplicar («Kids» es el mismo) y el «Continuar viendo» de la TV llega al celular.
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
    on2('phone', () => { L.setProfile('p1'); L.setProgress('v:otra', 100, 3000); });
    const tvDoc = on2('tv', () => L.exportSync());
    const r = on2('phone', () => {
      L.mergeSync(tvDoc);
      const ps = L.profiles();
      L.setProfile('pmh2x');
      const hop = L.progress('v:hoppers');
      L.setProfile('p1');
      return { names: ps.map((p) => p.name + ':' + p.avatar), hop: hop, otra: L.progress('v:otra') };
    });
    assert.deepEqual(r.names, ['Familia:01-Spider-Man', 'Kids:04-Spider-Man_comic', 'Santiago:02-Captain_Carter'], 'los perfiles personalizados de la TV reemplazan a los iniciales, sin duplicar');
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

// Videos copiados del grupo de antes al supergrupo: lo visto pasa a la copia, en cada perfil, sin pisar lo más reciente
{
  store.clear();
  L.setAccount('999');
  const [a, b] = L.profiles();
  L.setProfile(a.id); L.setProgress('-5479:10', 500, 6000); L.toggleMyList('v:-5479:11');
  L.setProfile(b.id); L.setProgress('-5479:10', 900, 6000); L.setProgress('-1004:3', 1200, 6000);
  const changedSomething = L.aliasKeys({ '-5479:10': '-1004:3', '-5479:11': '-1004:4' });
  assert.equal(changedSomething, true);
  L.setProfile(a.id);
  assert.equal(L.progress('-1004:3').t, 500, 'el progreso pasa a la copia');
  assert.equal(L.progress('-5479:10'), null, 'y la clave vieja se quita');
  assert.deepEqual(L.myList(), ['v:-1004:4'], 'Mi lista de un video sin clasificar también');
  L.setProfile(b.id);
  assert.equal(L.progress('-1004:3').t, 1200, 'si la copia ya tenía algo más reciente, se respeta');
  assert.equal(L.aliasKeys({ '-5479:10': '-1004:3' }), false, 'una segunda vez no cambia nada');
}

// Fila Marvel en el orden de la historia, no por fecha de publicación; lo que no reconoce va al final por año
{
  const t = (name, year) => ({ name, year });
  const subidas = [
    t('Iron Man', 2008),                       // la primera que se sube
    t('Avengers: Endgame', 2019),
    t('Capitán América: El primer vengador', 2011),
    t('Spider-Man: No Way Home', 2021),
    t('Capitana Marvel', 2019),                // se sube después pero va antes de Iron Man
    t('Spider-Man: Un nuevo universo', 2018),  // no es del MCU: al final
    t('Los Vengadores', 2012),
    t('Iron Man 2', 2010)
  ];
  const orden = L.sortForCategory('Marvel', subidas).map((x) => x.name);
  assert.deepEqual(orden, ['Capitán América: El primer vengador', 'Capitana Marvel', 'Iron Man', 'Iron Man 2', 'Los Vengadores',
    'Avengers: Endgame', 'Spider-Man: No Way Home', 'Spider-Man: Un nuevo universo']);
  assert.equal(L.sortForCategory('#mcu'.slice(1), subidas)[0].name, 'Capitán América: El primer vengador', '#MCU también');
  assert.equal(L.sortForCategory('Acción', subidas), subidas, 'las demás categorías no cambian');
  assert.equal(L.chronoIndex(t('The Avengers', 2012)), L.chronoIndex(t('Vengadores', 2012)), 'nombres en inglés y de España');
  assert.equal(L.chronoIndex(t('Thor', 1990)), -1, 'el año tiene que coincidir');
  assert.ok(L.chronoIndex(t('Guardianes de la Galaxia Vol. 2', 2017)) > L.chronoIndex(t('Guardianes de la Galaxia', 2014)));
}

/* Partes con el nombre cortado por Telegram («…_1080p_parte.mp4» en las dos) y hojas de miniaturas con nombre corto */
{
  const cap = 'pelicula#Demon slayer - Castillo del infinito (2025)#Desc';
  const cut = 'Demon_slayer_Castillo_del_infinito_2025_1080p_parte.mp4';
  const sheet = (n) => ({ key: 's' + n, chatId: 1, msgId: 200 + n, kind: 'thumbs', caption: cap.split('#').slice(0, 2).join('#') + ' #miniaturas', fileName: `miniaturas 10s 160x90 10x10 hoja ${n} de 2.jpg`, date: 300 });
  const b = L.build([
    v('p1', cap, 101, { fileName: cut, size: 1.6e9 }),
    v('p2', cap, 102, { fileName: cut, size: 1.5e9 }),
    v('p2b', cap, 103, { fileName: cut, size: 1.5e9 }), // la parte 2 subida otra vez: no es una tercera parte
    sheet(1), sheet(2)
  ]);
  const ver = b.movies[0].versions;
  assert.equal(ver.length, 1);
  assert.equal(ver[0].n, 2, 'dos partes, no tres');
  assert.deepEqual(Object.keys(ver[0].pieces).map((k) => ver[0].pieces[k].key), ['p1', 'p2b']);
  assert.deepEqual(b.movies[0].thumbs && b.movies[0].thumbs.sheets, ['s1', 's2'], 'hojas de miniaturas sin el título en el nombre');
  /* hojas con el nombre cortado por Telegram: las del último envío (mensajes seguidos), en orden */
  const old = (id) => ({ key: 'o' + id, chatId: 1, msgId: id, kind: 'thumbs', caption: 'pelicula#Demon slayer - Castillo del infinito (2025) #miniaturas', fileName: 'Demon_slayer_Castillo_del_infinito_2025_miniaturas.jpg', date: id });
  const oldLib = L.build([v('p1', cap, 101, { fileName: cut, size: 1.6e9 }), old(50), old(51), old(112), old(113), old(114)]);
  const ot = oldLib.movies[0].thumbs;
  assert.deepEqual(ot && ot.sheets, ['o112', 'o113', 'o114'], 'hojas cortadas: el último envío, en orden');
  assert.equal(ot.every, 10);
  const both = L.build([v('p1', cap, 101, { fileName: cut, size: 1.6e9 }), old(112), old(113), sheet(1), sheet(2)]);
  assert.deepEqual(both.movies[0].thumbs.sheets, ['s1', 's2'], 'si se volvieron a publicar con el nombre completo, ganan esas');
  const one = L.build([v('x', cap, 101, { fileName: cut })]);
  assert.equal(one.movies[0].versions[0].n, 1, 'un solo video así no es una película en partes');
}

console.log(`OK: ${cases.length} comentarios, armado de la biblioteca, infantil, etiquetas, perfiles y sincronización`);

/* Catálogo de categorías: alias, una sola fila por título y Marvel primero */
{
  assert.equal(L.canonicalCategory('Accion'), 'Acción y aventura');
  assert.equal(L.canonicalCategory('CienciaFiccion'), 'Ciencia ficción y fantasía');
  assert.equal(L.canonicalCategory('Animación'), 'Animadas', 'lo publicado como #Animación se lee como Animadas');
  assert.equal(L.canonicalCategory('MCU'), 'Marvel');
  assert.equal(L.canonicalCategory('Navidad'), 'Navidad', 'lo que no está en el catálogo se respeta');
  assert.equal(L.primaryCategory({ name: 'Iron Man 2', year: 2010, categories: ['Acción y aventura', 'Marvel'] }, true), 'Marvel');
  assert.equal(L.primaryCategory({ name: 'Iron Man', year: 2008, categories: [] }, true), 'Marvel', 'Marvel por la historia aunque el comentario no lo diga');
  assert.equal(L.primaryCategory({ name: 'Minions 3', categories: ['Animación'], kids: true }, true), 'Infantil');
  assert.equal(L.primaryCategory({ name: 'Minions 3', categories: ['Animación'], kids: true }, false), 'Animadas', 'en el perfil Kids, por género');
  assert.equal(L.primaryCategory({ name: 'Scary Movie', categories: ['Comedia', 'Terror'] }, true), 'Terror', 'gana la de más prioridad');
  assert.equal(L.primaryCategory({ name: 'X', categories: [] }, true), '');
}

/* Ficha de TMDB: la marca #tmdb, la categoría y lo infantil */
{
  const p = L.parseCaption('pelicula#Iron Man 3 (2013)#Tony Stark… #Marvel #tmdb68721');
  assert.deepEqual(p.categories, ['Marvel']);
  assert.deepEqual(p.tmdb, { type: 'movie', id: 68721 });
  assert.equal(p.description, 'Tony Stark…');
  assert.deepEqual(L.parseCaption('serie(1/2)#Bluey#Juegos#Desc #Animadas #infantil #tmdbtv82728').tmdb, { type: 'tv', id: 82728 });
  assert.equal(L.parseCaption('pelicula#Coco (2017)#desc #Animadas').tmdb, null);
  assert.ok(L.composeCaption({ type: 'movie', name: 'Iron Man 3', year: 2013, categories: ['Marvel'], tmdb: { type: 'movie', id: 68721 } }).endsWith('#Marvel #tmdb68721'));
  const lib = L.build([{ key: 'c:1', chatId: 'c', msgId: 1, kind: 'video', caption: 'pelicula#Iron Man 3 (2013)#d #Marvel #tmdb68721', date: 1, duration: 100, fileName: 'a.mp4', size: 1 }], {});
  assert.deepEqual(lib.movies[0].tmdb, { type: 'movie', id: 68721 });
  assert.equal(L.categoryFromTmdb({ name: 'Iron Man 3', year: 2013, genres: ['Acción', 'Aventura', 'Ciencia ficción'], companies: ['Marvel Studios'] }), 'Marvel');
  assert.equal(L.categoryFromTmdb({ name: 'X', genres: ['Animación', 'Acción', 'Fantasía'], lang: 'ja' }), 'Anime');
  assert.equal(L.categoryFromTmdb({ name: 'La astronauta', genres: ['Terror', 'Ciencia ficción', 'Suspense'] }), 'Terror');
  assert.equal(L.categoryFromTmdb({ name: 'Animales', genres: ['Suspense', 'Drama', 'Acción', 'Crimen'] }), 'Suspenso');
  assert.equal(L.categoryFromTmdb({ name: 'Toy Story 5', genres: ['Animación', 'Familia', 'Comedia', 'Aventura'] }), 'Animadas');
  assert.equal(L.categoryFromTmdb({ name: 'Depredador: Cazador de asesinos', genres: ['Animación', 'Acción', 'Ciencia ficción'] }), 'Acción y aventura', 'animada para adultos: por su género');
  assert.equal(L.categoryFromTmdb({ name: 'Y', genres: ['Animación', 'Familia'] }), 'Animadas');
  assert.equal(L.kidsFromTmdb({ cert: { MX: 'AA' }, genres: [] }), true);
  assert.equal(L.kidsFromTmdb({ cert: { MX: 'A', US: 'PG' }, genres: ['Animación'] }), true);
  assert.equal(L.kidsFromTmdb({ cert: { MX: 'B', US: 'PG-13' }, genres: ['Acción'] }), false);
}

{
  /* idioma corregido de las pistas: #audio-spa-eng #subs-x-spa */
  const p = L.parseCaption('pelicula#Avengers: Era de Ultrón (2015)#desc #Marvel #tmdb99861 #audio-spa-eng #subs-x-spa');
  assert.deepEqual(p.langs, { audio: ['spa', 'eng'], subs: ['x', 'spa'] });
  assert.deepEqual(p.categories, ['Marvel'], 'la marca no es una categoría');
  assert.equal(p.description, 'desc');
  assert.equal(L.parseCaption('pelicula#Coco (2017)#desc').langs, null);
  assert.ok(L.composeCaption(p).endsWith('#Marvel #tmdb99861 #audio-spa-eng #subs-x-spa'));
  const lib = L.build([
    { key: 'c:1', chatId: 'c', msgId: 1, kind: 'video', caption: 'pelicula#Avengers 2 (2015)#d #audio-spa-eng', date: 1, duration: 100, fileName: 'a.mp4', size: 1, width: 1920, height: 1080 },
    { key: 'c:2', chatId: 'c', msgId: 2, kind: 'video', caption: 'pelicula#Avengers 2 (2015)#d', date: 2, duration: 100, fileName: 'b.mp4', size: 2, width: 640, height: 360 }
  ], {});
  const parts = lib.movies[0].versions.map((v) => v.parts[0]);
  assert.deepEqual(parts.find((x) => x.key === 'c:1').langs, { audio: ['spa', 'eng'] }, 'cada archivo lleva la suya');
  assert.equal(parts.find((x) => x.key === 'c:2').langs, null);
}

{
  /* subtítulos aparte: un .srt con el comentario de la película vale para todas sus calidades */
  const lib = L.build([
    { key: 'c:1', chatId: 'c', msgId: 1, kind: 'video', caption: 'pelicula#Avengers 2: Era de Ultrón (2015)#d #Marvel', date: 1, duration: 100, fileName: 'a.mp4', size: 1, width: 1920, height: 1080 },
    { key: 'c:5', chatId: 'c', msgId: 5, kind: 'sub', caption: 'pelicula#Avengers 2: Era de Ultrón (2015) #subs-eng', date: 5, fileName: 'Avengers 2 Era de Ultrón 2015.eng.srt', size: 90000 },
    { key: 'c:6', chatId: 'c', msgId: 6, kind: 'sub', caption: 'pelicula#Avengers 2: Era de Ultrón (2015)#', date: 6, fileName: 'Avengers.es.srt', size: 90000 },
    { key: 'c:7', chatId: 'c', msgId: 7, kind: 'sub', caption: 'serie(1/2)#Loki #subs-spa', date: 7, fileName: 'loki.srt', size: 1 },
    { key: 'c:8', chatId: 'c', msgId: 8, kind: 'video', caption: 'serie(1/2)#Loki', date: 8, duration: 100, fileName: 'l.mp4', size: 1 }
  ], {});
  assert.deepEqual(lib.movies[0].subFiles.map((x) => x.lang), ['spa', 'eng'], 'español primero');
  assert.equal(lib.movies.length, 1, 'el .srt no crea otra película');
  assert.deepEqual(lib.series[0].seasons[0].episodes[0].subFiles.map((x) => x.key), ['c:7']);
  assert.equal(L.subFileLang('Avengers.Age.of.Ultron.2015.1080p.BluRay.x264.YIFY-en.srt'), 'eng');
}


// Canal «Anime»: el perfil «Anime» se crea una vez, con su canal fijo activo; no pisa lo del usuario
{
  store.clear();
  L.setAccount('4242');
  assert.equal(L.ensureAnimeProfile(), true, 'se crea la primera vez');
  assert.deepEqual(L.profiles().map((p) => p.name), ['Principal', 'Kids', 'Anime']);
  assert.deepEqual(L.enabledSources('anime'), { anime: 'Anime' }, 'con el canal fijo «Anime» activo');
  assert.equal(L.ensureAnimeProfile(), false, 'no se repite');
  assert.equal(L.deleteProfile('anime'), true);
  assert.equal(L.ensureAnimeProfile(), false, 'si el usuario lo borró, no vuelve');
  L.setAccount('4343');
  L.saveProfile({ name: 'Uno' }); L.saveProfile({ name: 'Dos' }); L.saveProfile({ name: 'Tres' });
  assert.equal(L.profiles().length, 5);
  assert.equal(L.ensureAnimeProfile(), false, 'sin lugar (5 perfiles) no se crea');
  L.setAccount('4444');
  L.saveProfile({ name: 'Anime' });
  assert.equal(L.ensureAnimeProfile(), false, 'si ya hay uno llamado Anime, no se crea otro');
}
