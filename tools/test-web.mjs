// Pruebas de la biblioteca de demostración de la web.
// Uso: node tools/test-web.mjs
//  o, sin Node, con el motor de Safari: /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tools/test-web.mjs
import * as L from '../web/js/data/library.js';
import { demoItems } from '../web/js/data/demo-items.js';

const log = globalThis.console?.log ?? globalThis.print;
let fails = 0; let passes = 0;
function ok(cond, msg) { if (cond) passes += 1; else { fails += 1; log(`✗ ${msg}`); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }

// parseCaption
let c = L.parseCaption('pelicula#Hoppers (2026)#Mabel, una joven amante de los animales… #Animación #infantil');
eq([c.type, c.name, c.year, c.kids], ['movie', 'Hoppers', 2026, true], 'película con infantil');
eq(c.categories, ['Animación'], 'categorías de película');
eq(c.description, 'Mabel, una joven amante de los animales…', 'descripción');

c = L.parseCaption('pelicula#Hoppers (2026) #portada');
eq([c.name, c.image, c.description], ['Hoppers', 'portada', ''], 'foto de portada');

c = L.parseCaption('pelicula#Rumbo al norte (2022) Dos hermanos recorren la costa #Aventura');
eq([c.name, c.description], ['Rumbo al norte', 'Dos hermanos recorren la costa'], 'tolerancia sin # tras el año');

c = L.parseCaption('serie(2/3)#Casa Solar#El pozo#Algo pasa. #Ciencia_ficción');
eq([c.type, c.season, c.episode, c.title, c.description], ['series', 2, 3, 'El pozo', 'Algo pasa.'], 'capítulo de serie');
eq(c.categories, ['Ciencia ficción'], '_ se muestra como espacio');

eq(L.parseCaption('video de la fiesta'), null, 'comentario sin formato');
eq(L.partOf('X [4K] parte 2 de 3.mkv'), { part: 2, pieces: 3 }, 'partes desde el nombre');
eq(L.qualityOf('X [1080p].mp4', 0), '1080p', 'calidad desde el nombre');

// composeCaption ida y vuelta
const round = L.parseCaption(L.composeCaption({ type: 'movie', name: 'Prueba', year: 2020, description: 'Hola', categories: ['Ciencia ficción'], kids: true }));
eq([round.name, round.year, round.categories, round.kids], ['Prueba', 2020, ['Ciencia ficción'], true], 'composeCaption ↔ parseCaption');

// build
const lib = L.build(demoItems());
eq(lib.movies.length, 12, 'películas');
eq(lib.series.length, 3, 'series');
eq(lib.unclassified.length, 1, 'sin clasificar');

const est = lib.titles['m:la ultima estacion:2025'];
ok(est, 'titleKey normalizado');
eq(est.versions.map((v) => v.q), ['4K', '1080p', '720p', '360p'], 'versiones ordenadas');
eq([est.versions[0].n, est.versions[0].pieces], [3, 3], '4K en 3 partes');
eq(est.quality, '4K', 'mejor calidad');
ok(Math.abs(est.versions[0].dur - 128 * 60) < 5, 'las partes suman una sola película');
ok(est.imageKey && est.bannerKey, 'portada y banner asignados');
ok(lib.byKey[est.versions[0].parts[2].key]?.titleKey === est.titleKey, 'byKey de una parte');

const casa = lib.titles['s:casa solar'];
eq(casa.seasons.map((s) => s.episodes.length), [3, 2], 'temporadas y capítulos');
ok(casa.description.startsWith('Tres generaciones'), 'descripción de serie desde la portada');
eq(casa.seasons[0].episodes[0].versions.length, 2, 'versiones por capítulo');

const kids = L.filterKids(lib);
ok(kids.movies.every((t) => t.kids) && kids.movies.length === 4, 'perfil infantil: películas');
eq(kids.series.map((s) => s.name), ['Los Exploradores del Patio'], 'perfil infantil: series');

// Progreso y siguiente capítulo
L.setAccount('test'); L.setProfile('familia');
const e1 = casa.seasons[0].episodes[0];
eq(L.nextEpisode(casa).video, e1.video, 'sin progreso: primer capítulo');
L.setProgress(e1.video, 2700, 2760);
eq(L.nextEpisode(casa).video, casa.seasons[0].episodes[1].video, 'terminado: el siguiente');
eq(L.episodeAfter(casa, casa.seasons[0].episodes[2].video).video, casa.seasons[1].episodes[0].video, 'cambia de temporada');
ok(L.toggleMyList(est.titleKey) && L.inMyList(est.titleKey), 'Mi lista agrega');
ok(!L.toggleMyList(est.titleKey) && !L.inMyList(est.titleKey), 'Mi lista quita');
ok(L.checkPin('santi', '1234') && !L.checkPin('santi', '0000'), 'PIN');

eq(L.formatDuration(7680), '2 h 8 min', 'formatDuration');
eq(L.formatClock(3725), '1:02:05', 'formatClock');
eq(L.formatSize(1610612736), '1,5 GB', 'formatSize');

log(`${passes} pruebas bien, ${fails} mal`);
if (fails) { if (globalThis.process) process.exit(1); else throw new Error('fallaron pruebas'); }
