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

console.log(`OK: ${cases.length} comentarios, armado de la biblioteca, infantil, etiquetas y perfiles`);
