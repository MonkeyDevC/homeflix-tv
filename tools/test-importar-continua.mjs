// Importar desde un grupo antiguo: numeración CONTINUA sin ninguna marca de temporada (tools/preparador/importar.js). node tools/test-importar-continua.mjs
// Canal real «Los super campeones»: una foto («SUPER CAMPEONES / CAPTAIN TSUBASA J (1983)», con «𝐈𝐝𝐢𝐨𝐦𝐚» en negrita matemática) y 127 videos
// «Los super campeones {Captain Tsubasa} - Capitulo NN Audio Latino 🇲🇽» del 1 al 128 (falta el 104; el último dice «128/Final»), todos iguales y subidos a la vez.
//   · el nombre y el título original (entre llaves) se separan, el año sale de la foto y «Audio Latino» NO es un título de capítulo;
//   · sin pistas dentro del canal queda UNA temporada (con el aviso del capítulo faltante) y TMDB (5 temporadas de 26, 26, 26, 26 y 24) permite partirla;
//   · se puede partir en N partes iguales o a mano, volver a la detección, y la copia usa los números de cada temporada.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const sandbox = { console, setTimeout, clearTimeout, Promise, Object, Date, Math, JSON, Array, String, Number, RegExp, Error };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, 'tools', 'preparador', 'importar.js'), 'utf8') + '\nthis.PrepImport = PrepImport;', sandbox);
const PI = sandbox.PrepImport;

const MB = 1048576;
let id = 1;
const t0 = Date.UTC(2026, 6, 22, 17, 45);
function mk(kind, text, extra = {}) { return { id: id++, kind, text, fileName: extra.fileName || '', duration: 1440, size: (extra.mb || 0) * MB, width: extra.w || 0, height: extra.h || 0, uid: '', date: t0 + id * 1000 }; }
const canal = [mk('photo', '⭐SUPER CAMPEONES / CAPTAIN \nTSUBASA J (1983)\n📀 𝐈𝐝𝐢𝐨𝐦𝐚: 𝐋𝐚𝐭𝐢𝐧𝐨 🇲🇽 彡', { w: 1000, h: 1500 })];
for (let n = 1; n <= 128; n += 1) {
  if (n === 104) { continue; }
  const num = String(n).padStart(2, '0');
  canal.push(mk('video', 'Los super campeones {Captain Tsubasa} - Capitulo ' + (n === 128 ? '128/Final' : num) + ' Audio Latino 🇲🇽', { fileName: n + '.mp4', mb: 53, h: 480 }));
}

const a = PI.analyze(canal);
assert.equal(a.series.length, 1); assert.equal(a.stats.chapters, 127);
const s = a.series[0];
assert.equal(s.title, 'Los super campeones'); assert.equal(s.original, 'Captain Tsubasa', 'lo de las llaves es el título original');
assert.equal(s.year, 1983, 'el año sale de la foto'); assert.equal(s.type, 'serie');
assert.equal(s.headers[0].hasPhoto, true, 'la foto (1000×1500) queda asociada');
assert.equal(s.seasons.length, 1, 'sin ninguna pista dentro del canal queda una temporada');
assert.equal(s.seasons[0].lang, 'latino');
assert.ok(s.seasons[0].episodes.every((e) => e.title === ''), '«Audio Latino 🇲🇽» no es un título de capítulo');
assert.equal(s.seasons[0].episodes[126].num, 128, '«128/Final» se lee como el 128');
assert.ok(s.seasons[0].warnings.some((w) => /Faltan los capítulos: 104/.test(w)));
assert.equal(s.status, 'revisar');
assert.equal(PI.maxNum(s), 128);

// la foto con letras en negrita se lee (NFKC): el idioma de la foto no se pierde y el nombre queda limpio
assert.equal(PI.langInfo('Latino').key, 'latino');

// TMDB: 5 temporadas de 26, 26, 26, 26 y 24
const ficha = { seasons: [26, 26, 26, 26, 24].map((e, i) => ({ n: i + 1, episodes: e })) };
assert.equal(PI.tmdbStarts(ficha).join(','), '1,27,53,79,105');
assert.equal(PI.tmdbStarts({ seasons: [{ n: 1, episodes: 128 }] }), null, 'con una sola temporada en TMDB no hay nada que partir');
PI.resplit(s, PI.tmdbStarts(ficha), 'Según TMDB', [26, 26, 26, 26, 24]);
assert.equal(s.seasons.length, 5);
assert.equal(s.seasons.map((x) => x.count).join(','), '26,26,26,25,24', 'la T4 tiene 25: falta el 104');
assert.equal(s.seasons[1].episodes[0].newNum, 1); assert.equal(s.seasons[1].episodes[0].num, 27, 'el 27 del canal es el 1 de la T2');
assert.equal(s.seasons[4].episodes[0].num, 105); assert.equal(s.seasons[4].episodes[23].newNum, 24);
assert.ok(s.seasons[3].warnings.some((w) => /TMDB dice que esta temporada tiene 26 capítulos y hay 25/.test(w)), 'avisa que a la T4 le falta uno');
assert.equal(s.seasons[2].cut.certainty, 'manual'); assert.ok(/Según TMDB/.test(s.seasons[2].cut.evidence[0].text));
assert.equal(s.seasons[0].warnings.length, 0);

// en 4 partes iguales (como dijo el usuario) y a mano
assert.equal(PI.equalStarts(128, 4).join(','), '1,33,65,97');
PI.resplit(s, PI.equalStarts(128, 4), 'En 4 partes iguales');
assert.equal(s.seasons.length, 4); assert.equal(s.seasons.map((x) => x.count).join(','), '32,32,32,31');
assert.equal(s.seasons[3].episodes[0].newNum, 1); assert.equal(s.seasons[3].episodes[6].num, 103);
assert.equal(PI.parseStarts('33, 65 y 97').join(','), '1,33,65,97', 'siempre empieza en 1');
PI.resplit(s, PI.parseStarts('1, 40, 80'), 'A mano');
assert.equal(s.seasons.map((x) => x.count).join(','), '39,40,48');

// volver a la detección
PI.restoreSeasons(s);
assert.equal(s.seasons.length, 1); assert.equal(s.seasons[0].count, 127); assert.equal(s.split, undefined);

// la copia usa la temporada y el número de cada una (serie(3/1) = capítulo 53 del canal)
s.match = { state: 'alta', candidates: [], pick: 25707, media: 'tv', ficha: { overview: 'Tsubasa y su balón.', poster: { url: 'https://img/p' }, backdrop: { url: 'https://img/b' }, vertical: { url: 'https://img/v' } } };
PI.resplit(s, PI.tmdbStarts(ficha), 'Según TMDB', [26, 26, 26, 26, 24]);
const plan = PI.planCopy(a, { category: 'Anime' });
const g = plan.groups[0];
assert.equal(g.items.find((x) => x.label === 'T3:E1').caption, 'serie(3/1)#Los super campeones#Tsubasa y su balón. #Anime #tmdbtv25707');
assert.equal(g.items.find((x) => x.label === 'T5:E24').caption, 'serie(5/24)#Los super campeones#Tsubasa y su balón. #Anime #tmdbtv25707');
assert.equal(g.items[0].caption, 'serie#Los super campeones #vertical', 'la foto vertical del canal');
assert.equal(plan.total, 1 + 1 + 1 + 1 + 127, 'foto vertical + portada + banner + imagen común + 127 capítulos');

// el informe y las pruebas anteriores de caption (sin título de capítulo)
assert.ok(!/Audio Latino/.test(JSON.stringify(g.items.map((x) => x.caption))), 'ningún comentario nuevo lleva «Audio Latino»');

console.log('OK: numeración continua sin marcas: nombre y original, año de la foto, sin título falso, partir según TMDB, en N partes o a mano, restaurar y copia con temporada y número');
