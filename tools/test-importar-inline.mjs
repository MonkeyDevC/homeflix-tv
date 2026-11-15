// Importar desde un grupo antiguo, FORMATO B (tools/preparador/importar.js): sin foto de encabezado, cada video trae su título, año, idioma y «S01 E01» en el comentario.
// Los 6 comentarios de Star Wars son los del análisis real que dio 0 series. node tools/test-importar-inline.mjs
//   · los videos con el mismo título se juntan en una serie; el título que parece español queda como nombre, el otro como original;
//   · el número de temporada sale del comentario; «Fin de temporada» y el cambio de idioma cuentan como pistas de corte;
//   · el póster suelto se asocia a su serie (por título, o por ser la única foto de la única serie) y solo entonces se copia como imagen de encabezado;
//   · una película con comentario propio queda como película; los capítulos «Capítulo N - Título» de un canal con encabezados NO se toman por series nuevas.
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
let t0 = Date.UTC(2024, 4, 1);
function mk(kind, text, extra = {}) { return { id: id++, kind, text, fileName: extra.fileName || '', duration: 1400, size: (extra.mb || 0) * MB, width: extra.w || 0, height: extra.h || 0, uid: '', date: (t0 += (extra.gap || 60000)) }; }

/* ---- el canal real de Star Wars: un póster (sin datos) y 6 videos ---- */
const SW = 'Star Wars: Tales of the Jedi - Star Wars: Historias de los Jedi - 2022 - Latino';
const canal = [mk('photo', '', { w: 800, h: 1200 })];
const eps = [['S01 E01', 'Star_Wars_Tales_of_the_Jedi_S01E01_Life_and_Death_1080p_DSNP_WEB.mp4'], ['S01 E02', 'Star_Wars_Tales_of_the_Jedi_S01E02_Justice_1080p_DSNP_WEB_DL_DDP5.mp4'], ['S01 E03', 'Star_Wars_Tales_of_the_Jedi_S01E03_Choices_1080p_DSNP_WEB_DL_DDP5.mp4'],
  ['S01 E04', 'Star_Wars_Tales_of_the_Jedi_S01E04_The_Sith_Lord_1080p_DSNP_WEB.mp4'], ['S01 E05', 'Star_Wars_Tales_of_the_Jedi_S01E05_Practice_Makes_Perfect_1080p.mp4'], ['S01 E06 - Fin de temporada', 'Star_Wars_Tales_of_the_Jedi_S01E06_Resolve_1080p_DSNP_WEB_DL_DDP5.mp4']];
eps.forEach(([se, fn]) => canal.push(mk('video', SW + '\n' + se, { fileName: fn, mb: 230 })));

const a1 = PI.analyze(canal);
assert.equal(a1.series.length, 1, 'los 6 videos son UNA serie (antes: 0 series y 6 videos sin encabezado)');
assert.equal(a1.stats.videosSinEncabezado, 0);
const sw = a1.series[0];
assert.equal(sw.title, 'Star Wars: Historias de los Jedi', 'el título que parece español queda como nombre');
assert.equal(sw.original, 'Star Wars: Tales of the Jedi');
assert.equal(sw.year, 2022); assert.equal(sw.type, 'serie'); assert.equal(sw.source, 'comentario');
assert.equal(sw.seasons.length, 1); assert.equal(sw.seasons[0].n, 1); assert.equal(sw.seasons[0].count, 6);
assert.equal(sw.seasons[0].lang, 'latino'); assert.equal(sw.seasons[0].episodes.map((e) => e.newNum).join(','), '1,2,3,4,5,6');
assert.equal(sw.status, 'seguro', 'sin avisos');
assert.equal(sw.headers[0].hasPhoto, true, 'el póster suelto (única foto, única serie) queda asociado');
assert.equal(sw.headers[0].msgId, canal[0].id);
assert.equal(a1.stats.fotosSinDatos, 0); assert.equal(a1.stats.fotosAsignadas, 1);
assert.equal(PI.parseInline ? 1 : 1, 1);

/* ---- el mismo canal con una 2.ª temporada, una película, otra serie y una foto con título ---- */
const canal2 = canal.slice();
canal2.push(mk('photo', 'Mi película increíble - My Incredible Movie - 2019', { w: 800, h: 1200 }));
for (let n = 1; n <= 3; n += 1) { canal2.push(mk('video', SW + '\nS02 E0' + n, { mb: 240 })); }
canal2.push(mk('video', 'Mi película increíble - My Incredible Movie - 2019 - Castellano', { fileName: 'peli.mkv', mb: 1400 }));
for (let n = 1; n <= 2; n += 1) { canal2.push(mk('video', 'Los Simpson - The Simpsons - 1989 - Latino\nS35 E0' + n, { mb: 180 })); }
const a2 = PI.analyze(canal2);
assert.equal(a2.series.length, 3, 'Star Wars, la película y Los Simpson');
const sw2 = a2.series.find((x) => /Jedi/.test(x.title));
assert.equal(sw2.seasons.length, 2); assert.equal(sw2.seasons[1].n, 2, 'la temporada sale del comentario (S02)');
assert.equal(sw2.seasons[1].count, 3); assert.equal(sw2.seasons[1].renumbered, false);
assert.equal(sw2.seasons[1].cut.certainty, 'seguro');
assert.ok(sw2.seasons[1].cut.evidence.some((e) => /fin de temporada/.test(e.text)), '«Fin de temporada» es una pista');
assert.ok(sw2.seasons[1].cut.evidence.some((e) => /otra temporada/.test(e.text)), 'y también el cambio S01 → S02');
const peli = a2.series.find((x) => /película/i.test(x.title));
assert.equal(peli.type, 'pelicula'); assert.equal(peli.year, 2019); assert.equal(peli.chapters, 1);
assert.equal(peli.headers[0].hasPhoto, true, 'la foto con el título de la película se asocia por el parecido del nombre');
const sim = a2.series.find((x) => /Simpson/.test(x.title));
assert.equal(sim.seasons.length, 1); assert.equal(sim.seasons[0].n, 35, 'una temporada 35 sola conserva su número'); assert.equal(sim.headers[0].hasPhoto, false);
assert.equal(sw2.headers[0].hasPhoto, true);

/* ---- el plan de copia no manda un video como si fuera la foto de encabezado ---- */
const fakeMatch = (s) => { s.match = { state: 'alta', candidates: [], pick: 123, media: s.type === 'pelicula' ? 'movie' : 'tv', ficha: { overview: 'Una descripción.', poster: { url: 'https://img/p' }, backdrop: { url: 'https://img/b' }, vertical: { url: 'https://img/v' } } }; };
a2.series.forEach(fakeMatch);
const plan = PI.planCopy(a2, { category: 'Anime' });
const gSim = plan.groups.find((g) => /Simpson/.test(g.name));
assert.ok(!gSim.items.some((x) => x.key.endsWith(':hdr')), 'Los Simpson no tienen foto: no se copia ningún «encabezado»');
assert.ok(gSim.items.some((x) => x.label === 'Vertical de TMDB'), 'sin foto propia, la vertical sale de TMDB');
const gSw = plan.groups.find((g) => /Jedi/.test(g.name));
assert.equal(gSw.items[0].caption, 'serie#Star Wars: Historias de los Jedi #vertical');
assert.equal(gSw.items.find((x) => x.label === 'T1:E1').caption, 'serie(1/1)#Star Wars: Historias de los Jedi#Una descripción. #Anime #tmdbtv123');
assert.equal(gSw.items.find((x) => x.label === 'T2:E1').caption, 'serie(2/1)#Star Wars: Historias de los Jedi#Una descripción. #Anime #tmdbtv123');
const gPeli = plan.groups.find((g) => /película/i.test(g.name));
assert.equal(gPeli.items.find((x) => x.label === 'T1:E1').caption, 'pelicula#Mi película increíble (2019)#Una descripción. #Anime #tmdb123');

/* ---- un canal con encabezados: «Capítulo 3 - El final» NO se toma por una serie nueva ---- */
const mixto = [mk('photo', 'Serie con encabezado\nTipo: Serie\nPublicación: 2010\nEpisodios: 3\nIdioma: Latino\nFormato: 720p', { w: 800, h: 1200 }),
  mk('video', 'Capítulo 1 - El comienzo', { mb: 100 }), mk('video', 'Capítulo 2 - El medio - Latino', { mb: 100 }), mk('video', 'Capítulo 3 - El final', { mb: 100 })];
const a3 = PI.analyze(mixto);
assert.equal(a3.series.length, 1, 'sigue siendo una sola serie, la del encabezado');
assert.equal(a3.series[0].source, 'encabezado'); assert.equal(a3.series[0].chapters, 3);

/* ---- el informe cuenta las fotos que no pudo asociar (para afinar el detector) ---- */
const fa = mk('photo', 'Algo sin relación', { w: 500, h: 500 });
const fb = mk('photo', 'Otra', { w: 500, h: 500 });
const suelta = PI.analyze([fa, fb, mk('video', SW + '\nS01 E01', { mb: 100 })]);
assert.equal(suelta.stats.fotosSinDatos, 1, 'la foto de justo antes del primer capítulo se asocia; la otra queda suelta');
assert.equal(suelta.series[0].headers[0].msgId, fb.id, 'gana la más cercana al capítulo');
const rep = PI.report(suelta);
assert.equal(rep.sueltos.fotos.length, 1); assert.equal(rep.sueltos.fotos[0].text, 'Algo sin relación');
assert.equal(rep.series[0].fuente, 'comentario');

console.log('OK: formato B (sin encabezado): series, título y original, temporadas del comentario, fin de temporada, póster suelto, película, plan de copia y canal mezclado');

// Canal «Chernobyl»: foto «⭐CHERNOBYL (2019) / Idioma: Castellano» + 5 videos «CHERNOBYL(2019) Episodio N Castellano» (título pegado, sin guiones) y luego un encabezado en foto («Audio: Español latino») con 5 videos sin número
{
  let k = 2;
  const q = (kind, text, x = {}) => ({ id: k++, kind, text, fileName: '', duration: 3000, size: (x.mb || 0) * 1048576, width: x.w || 0, height: x.h || 0, uid: '', date: 1e12 + k * 1000 });
  const ch = [q('photo', '⭐CHERNOBYL (2019)\n📀 𝐈𝐝𝐢𝐨𝐦𝐚: Castellano', { w: 932, h: 1280 })];
  for (let n = 1; n <= 5; n += 1) { ch.push(q('video', 'CHERNOBYL' + (n < 3 ? '' : ' ') + '(2019) Episodio ' + n + ' Castellano', { mb: 212 })); }
  ch.push(q('photo', 'Chernobyl 2019\n🌐 Audio: Español latino 🇲🇽\n📺 Calidad: 1080p HD\n🔢 Año: 2019\n🎭 Género: #acción #Suspenso', { w: 864, h: 1280 }));
  for (let n = 1; n <= 5; n += 1) { ch.push(q('video', '«Chernobyl 🚨 Audio: Español latino 🇲🇽 Calidad: 1080p HD Año: 2019 Género: #acción #Suspenso»', { mb: 1000 })); }
  const r = PI.analyze(ch);
  assert.equal(r.series.length, 1); assert.equal(r.stats.chapters, 10); assert.equal(r.stats.videosSinEncabezado, 0);
  assert.equal(r.series[0].seasons.length, 2); assert.equal(r.series[0].seasons[0].lang, 'castellano'); assert.equal(r.series[0].seasons[1].lang, 'latino');
  assert.equal(r.series[0].seasons[0].count, 5); assert.equal(r.series[0].seasons[1].count, 5);
  console.log('OK: título pegado al capítulo sin guiones + encabezado con «Audio:» (Chernobyl, 2 temporadas de 5)');
}

// Canal «¿Cómo se traduce éste amor?»: foto «TÍTULO / ORIGINAL (2026) 🇲🇽» + videos «Título? 1x1 🇲🇽» (la bandera es el idioma; el último dice «Fin»)
{
  let k = 2;
  const q = (kind, text, x = {}) => ({ id: k++, kind, text, fileName: x.f || '', duration: 3444, size: (x.mb || 0) * 1048576, width: x.w || 0, height: x.h || 0, uid: '', date: 1e12 + k * 1000 });
  const ch = [q('photo', 'CÓMO SE TRADUCE ESTE AMOR\nCAN THIS LOVE BE TRANSLATED\n(2026) 🇲🇽', { w: 1080, h: 1350 })];
  for (let n = 1; n <= 12; n += 1) { ch.push(q('video', 'Cómo se traduce este amor? 1x' + n + ' 🇲🇽' + (n === 12 ? '\n\nFin' : ''), { f: String(n).padStart(2, '0') + ' Lat.mp4', mb: 938 })); }
  const r = PI.analyze(ch);
  const s = r.series[0];
  assert.equal(r.series.length, 1); assert.equal(r.stats.chapters, 12); assert.equal(r.stats.videosSinEncabezado, 0);
  assert.equal(s.title, 'Cómo se traduce este amor?'); assert.equal(s.year, 2026); assert.equal(s.original, 'Can This Love Be Translated');
  assert.equal(s.seasons.length, 1); assert.equal(s.seasons[0].lang, 'latino'); assert.equal(s.seasons[0].count, 12);
  assert.ok(s.seasons[0].episodes.every((e) => e.title === ''), '«Fin» no es un título de capítulo');
  assert.equal(s.headers[0].hasPhoto, true);
  console.log('OK: bandera = idioma, «1x1», foto con original en la 2.ª línea y «Fin» (¿Cómo se traduce éste amor?, 12 capítulos)');
}

// Canal «La reina de las lágrimas»: encabezado con «Título: …», «Género», «Año», «Capítulos: 16» y videos «» La Reina de Lágrimas » Temp 1 » Capítulo 1/16»
{
  let k = 2;
  const q = (kind, text, x = {}) => ({ id: k++, kind, text, fileName: '', duration: 4600, size: (x.mb || 0) * 1048576, width: x.w || 0, height: x.h || 0, uid: '', date: 1e12 + k * 1000 });
  const ch = [q('photo', '🇰🇷Título: La reina de las Lágrimas\n🎬Género: Drama/Romance\n📆Año: 2024\n🎞Capítulos: 16\n\n#LaReinaDeLagrimas\nLa reina de las tiendas departamentales y su esposo, proveniente de un pueblo pequeño, atraviesan una crisis conyugal hasta que el amor comienza a florecer otra vez.', { w: 800, h: 1200 })];
  for (let n = 1; n <= 16; n += 1) { ch.push(q('video', '🤍 » La Reina de Lágrimas\n🎬 » Temp 1\n🎞 » Capítulo ' + n + '/16', { mb: 590 })); }
  const r = PI.analyze(ch);
  const s = r.series[0];
  assert.equal(r.series.length, 1); assert.equal(s.title, 'La reina de las Lágrimas', 'sin el «Título:» delante');
  assert.equal(s.year, 2024); assert.equal(s.chapters, 16); assert.equal(s.seasons.length, 1);
  assert.ok(s.seasons[0].episodes.every((e) => e.title === ''), '«/16» no es un título de capítulo');
  assert.equal(s.seasons[0].warnings.length, 0);
  console.log('OK: encabezado con «Título:» y «Capítulos:», «Capítulo 1/16» y «Temp 1» (La reina de las lágrimas)');
}

// Canal «How to Sell Drugs Online (Fast)»: una foto por temporada («Título - 2019 / Dual Audio 🇲🇽 - 🇩🇪 / Temporada 1») y videos «Título 1x1» (el nombre del archivo trae S01E01)
{
  let k = 23;
  const q = (kind, text, x = {}) => ({ id: k++, kind, text, fileName: x.f || '', duration: 2100, size: (x.mb || 0) * 1048576, width: x.w || 0, height: x.h || 0, uid: '', date: 1e12 + k * 1000 });
  const T = 'How to Sell Drugs Online (Fast)';
  const ch = [];
  [[2019, 1], [2020, 2], [2021, 3], [2025, 4]].forEach(([y, se]) => {
    ch.push(q('photo', T + ' - ' + y + ' / Dual Audio 🇲🇽 - 🇩🇪\n\nTemporada ' + se + '\n\n#Crimen #Comedia #Drama #Drogas\n\n🎥 👇🏻👇🏻', { w: 680, h: 1000 }));
    for (let n = 1; n <= 6; n += 1) { ch.push(q('video', T + ' ' + se + 'x' + n, { f: '[@PSDFHD] ' + T + ' S0' + se + 'E0' + n + '.mp4', mb: 1100 })); }
  });
  const r = PI.analyze(ch);
  const s = r.series[0];
  assert.equal(r.series.length, 1); assert.equal(r.stats.chapters, 24); assert.equal(r.stats.videosSinEncabezado, 0);
  assert.equal(s.title, T); assert.equal(s.year, 2019, 'el año de la primera foto');
  assert.equal(s.seasons.length, 4); assert.equal(s.seasons.map((x) => x.count).join(), '6,6,6,6');
  assert.equal(s.seasons[3].episodes[5].newNum, 6);
  assert.ok(s.seasons.every((x) => x.warnings.length === 0));
  console.log('OK: una foto por temporada + «Título 1x1» (How to Sell Drugs Online, 4 temporadas de 6) · idioma de temporada 1: ' + s.seasons[0].lang);
}

// El nombre de la serie en el grupo va en español: sale de la ficha de TMDB (es-MX), salvo que el usuario ya lo haya escrito o TMDB no lo traduzca
{
  const T = 'How to Sell Drugs Online (Fast)';
  const mkS = () => PI.analyze([{ id: 2, kind: 'video', text: T + ' 1x1', fileName: '', duration: 2000, size: 1e9, width: 0, height: 0, uid: '', date: 1e12 }, { id: 3, kind: 'video', text: T + ' 1x2', fileName: '', duration: 2000, size: 1e9, width: 0, height: 0, uid: '', date: 1e12 + 1 }]).series[0];
  const apiEs = { buscar: async () => ({ results: [{ id: 94954, title: 'Cómo vender drogas online (rápido)', original: T, year: 2019, poster: '', overview: '', pop: 50 }] }), ficha: async () => ({ id: 94954, title: 'Cómo vender drogas online (rápido)', original: T, year: 2019, overview: 'x', seasons: [] }) };
  const a1 = mkS(); await PI.match(a1, apiEs);
  assert.notEqual(a1.match.state, 'baja'); assert.equal(a1.name, 'Cómo vender drogas online (rápido)', 'el nombre pasa a español');
  const a2 = mkS(); a2.name = 'Mi nombre'; a2.nameEdited = true; await PI.match(a2, apiEs);
  assert.equal(a2.name, 'Mi nombre', 'lo escrito a mano no se pisa');
  const apiSin = { buscar: apiEs.buscar, ficha: async () => ({ id: 94954, title: T, original: T, year: 2019, overview: 'x', seasons: [] }) };
  const a3 = mkS(); a3.title = 'Cómo vender drogas'; await PI.match(a3, apiSin);
  assert.equal(a3.name, undefined, 'si TMDB no traduce, queda el nombre del canal');
  console.log('OK: el nombre de la serie sale en español de TMDB (sin pisar lo escrito a mano ni cuando TMDB no traduce)');
}

// Cada capítulo lleva el título y la descripción de SU capítulo (TMDB: temporada → capítulos); si no hay, la de la serie
{
  const T = 'How to Sell Drugs Online (Fast)';
  const msgs = [];
  let k = 2;
  for (let se = 1; se <= 2; se += 1) { for (let n = 1; n <= 3; n += 1) { msgs.push({ id: k++, kind: 'video', text: T + ' ' + se + 'x' + n, fileName: '', duration: 2000, size: 1e9, width: 0, height: 0, uid: '', date: 1e12 + k }); } }
  const an = PI.analyze(msgs);
  const api = {
    buscar: async () => ({ results: [{ id: 88236, title: 'Cómo vender drogas online (a toda pastilla)', original: T, year: 2019, poster: '', overview: '', pop: 50 }] }),
    ficha: async () => ({ id: 88236, title: 'Cómo vender drogas online (a toda pastilla)', original: T, year: 2019, overview: 'Descripción de la serie.', backdrop: { url: 'https://img/horizontal.jpg' }, seasons: [{ n: 1, episodes: 3 }, { n: 2, episodes: 3 }] }),
    temporada: async ({ season }) => ({ episodes: [1, 2, 3].map((n) => ({ n, name: n === 3 ? '' : 'Título ' + season + '.' + n, overview: n === 2 ? '' : 'Resumen del capítulo ' + season + '.' + n, still: n === 3 ? '' : 'https://img/still-' + season + '-' + n + '.jpg' })) }),
  };
  await PI.match(an.series[0], api);
  const plan = PI.planCopy(an, { category: 'Series' });
  const cap = (l) => plan.groups[0].items.find((x) => x.label === l).caption;
  assert.equal(cap('T1:E1'), 'serie(1/1)#Cómo vender drogas online (a toda pastilla)#Título 1.1#Resumen del capítulo 1.1 #Series #tmdbtv88236');
  assert.equal(cap('T2:E2'), 'serie(2/2)#Cómo vender drogas online (a toda pastilla)#Título 2.2#Descripción de la serie. #Series #tmdbtv88236', 'sin descripción del capítulo: la de la serie');
  assert.equal(cap('T2:E3'), 'serie(2/3)#Cómo vender drogas online (a toda pastilla)#Resumen del capítulo 2.3 #Series #tmdbtv88236', 'sin título del capítulo: solo la descripción');
  // imagen de cada capítulo (still de TMDB, #capitulo) y una imagen común con la horizontal de la serie
  const imgs = plan.groups[0].items.filter((x) => x.kind === 'capitulo');
  assert.equal(imgs.length, 1 + 4, 'una común + los 4 capítulos que tienen su imagen (2 sin imagen)');
  assert.equal(imgs[0].caption, 'serie#Cómo vender drogas online (a toda pastilla) #capitulo'); assert.equal(imgs[0].url, 'https://img/horizontal.jpg');
  assert.equal(plan.groups[0].items.find((x) => x.key.indexOf(':still:') > 0).caption, 'serie(1/1)#Cómo vender drogas online (a toda pastilla) #capitulo');
  assert.ok(!plan.groups[0].items.some((x) => x.label === 'Imagen de T1:E3'), 'sin imagen del capítulo no hay foto: usa la común');
  // partida a mano: ya no coincide con TMDB y se usa la descripción de la serie
  PI.resplit(an.series[0], [1, 3], 'A mano');
  const plan2 = PI.planCopy(an, { category: 'Series' });
  assert.ok(plan2.groups[0].items.every((x) => !/Resumen del capítulo/.test(x.caption)));
  assert.ok(!plan2.groups[0].items.some((x) => x.key.indexOf(':still:') > 0), 'partida a mano: sin imágenes por capítulo, queda la común');
  console.log('OK: título y descripción de cada capítulo desde TMDB (con la de la serie cuando falta, y sin usarlos si las temporadas se partieron a mano)');
}

/* ---- Los Caballeros del Zodiaco: foto con título + «Idioma» en letras especiales y comentarios «Título Capitulo N» (sin año, sin idioma, sin temporada) ---- */
{
  id = 1;
  const msgs = [mk('photo', '⭐LOS CABALLEROS DEL \nZODIACO (1986)\n📀 𝐈𝐝𝐢𝐨𝐦𝐚: 𝐋𝐚𝐭𝐢𝐧𝐨 🇲🇽 彡', { w: 500, h: 735 })];
  for (let i = 1; i <= 50; i += 1) { msgs.push(mk('video', 'Los Caballeros del Zodiaco Capitulo ' + i, { fileName: 'Episodio ' + String(i).padStart(3, '0') + ' Algo.mp4', mb: 90 })); }
  const a = PI.analyze(msgs);
  assert.equal(a.series.length, 1, 'una serie');
  assert.equal(a.series[0].chapters, 50, '50 capítulos');
  assert.equal(a.loose.videosSinEncabezado.length, 0);
  assert.equal(a.stats.fotosAsignadas, 1, 'la foto se asocia');
  assert.equal(a.series[0].year, 1986);
  console.log('OK: Caballeros del Zodiaco: 50 capítulos «Título Capitulo N» y foto con idioma en letras especiales');
}

/* ---- Art Attack: encabezado con foto + una foto SIN texto entre temporadas; archivos con guiones bajos «Art_Attack_S02E01_Episode_27_…» ---- */
{
  id = 1;
  const msgs = [mk('photo', '🎬 Art Attack 🎬\n📆 Año: 1990\n📚 Género: Arte\n🔊 Audio: Latino\n📌 Sinopsis: Un programa único e inspirador de arte.', { w: 592, h: 841 })];
  const eps = [25, 25, 27, 26];
  let abs = 0;
  eps.forEach((n, si) => {
    if (si) { msgs.push(mk('photo', '', { w: 185, h: 272 })); } // la foto «Season N»
    for (let e = 1; e <= n; e += 1) {
      abs += 1;
      msgs.push(mk('video', 'Art Attack 1990', { fileName: 'Art_Attack_S0' + (si + 1) + 'E' + String(e).padStart(2, '0') + '_Episode_' + abs + '_1080p_DSNP_WEB_DL_AAC2_0_H_264_Byx10.mp4', mb: 1450 }));
    }
  });
  const a = PI.analyze(msgs);
  assert.equal(a.series.length, 1);
  assert.equal(a.series[0].seasons.map((x) => x.count).join(','), '25,25,27,26', 'cuatro temporadas, cortadas por las fotos y por S0NE0M');
  assert.ok(a.series[0].seasons.every((x) => !x.warnings.some((w) => /no trae número/.test(w))), 'los números salen del nombre del archivo');
  assert.equal(a.series[0].seasons[1].episodes[0].newNum, 1);
  console.log('OK: Art Attack: una foto sin texto entre capítulos abre temporada y los nombres con guiones bajos traen S0NE0M');
}

/* ---- The Mentalist: «🎬 The Mentalist (12/13)\n⬜ Temporada 7.\n\n📶 Latino.» — «(n/N)» es el capítulo, no parte del título ---- */
{
  id = 1;
  const msgs = [];
  [23, 23, 24, 24, 22, 22, 13].forEach((n, si) => {
    for (let e = 1; e <= n; e += 1) { msgs.push(mk('video', '🎬 The Mentalist (' + e + '/' + n + ')\n⬜ Temporada ' + (si + 1) + '.\n\n📶 Latino.', { mb: 1250 })); }
  });
  const a = PI.analyze(msgs);
  assert.equal(a.series.length, 1, 'una sola serie (no una por cada «(n/N)»)');
  assert.equal(a.series[0].title, 'The Mentalist');
  assert.equal(a.series[0].seasons.map((x) => x.count).join(','), '23,23,24,24,22,22,13');
  assert.ok(a.series[0].seasons.every((x) => !x.warnings.length), 'sin avisos');
  assert.ok(a.series[0].seasons.every((x) => !x.episodes.some((e) => e.title)), 'sin títulos falsos («Temporada 7. Latino.»)');
  console.log('OK: The Mentalist: «(n/N)» + «Temporada N.» + idioma en otro renglón (7 temporadas)');
}

/* ---- Mucha Lucha: ni encabezado ni comentarios; solo «01x01 - …», «ML 2x1», «2X22», «ML 3X23» en los nombres de archivo (y una foto sin texto) ---- */
{
  id = 1;
  const msgs = [mk('photo', '', { w: 600, h: 800 })];
  const names = [];
  [3, 1, 2, 6, 5, 7, 4, 8, 9, 10, 11, 12, 13].forEach((n) => names.push(n === 6 ? '01X06_Trae_a_tu_papá_al_dia_de_Lucha_Nuestro_Fundador_HD.mp4' : '01x' + String(n).padStart(2, '0') + ' - Titulo ' + n + ' (HD).mp4'));
  for (let n = 1; n <= 22; n += 1) { names.push(n === 22 ? '2X22.mp4' : 'ML 2x' + n + '.mp4'); }
  for (let n = 23; n <= 37; n += 1) { names.push('ML 3X' + n + '.mp4'); }
  names.forEach((fn) => msgs.push(mk('video', '', { fileName: fn, mb: 220 })));
  const a = PI.analyze(msgs, { chatTitle: 'Mucha lucha' });
  assert.equal(a.series.length, 1);
  assert.equal(a.series[0].title, 'Mucha lucha', 'el nombre es el del canal');
  assert.equal(a.series[0].seasons.map((x) => x.count).join(','), '13,22,15');
  assert.equal(a.series[0].seasons[2].episodes[0].newNum, 1, 'la 3.ª temporada seguía la cuenta (23…37): se renumera desde 1');
  assert.equal(a.series[0].seasons[0].episodes.map((e) => e.newNum).join(','), '1,2,3,4,5,6,7,8,9,10,11,12,13', 'ordenados por número aunque lleguen revueltos');
  assert.equal(a.loose.videosSinEncabezado.length, 0);
  assert.equal(PI.analyze(msgs).series.length, 0, 'sin título del canal no se inventa nada');
  console.log('OK: Mucha Lucha: sin encabezado ni comentarios, serie con el nombre del canal y temporadas por «1x01 / ML 2x1»');
}

/* ---- One Piece (canal mezclado): «Idioma … Sinopsis:», «秘Título: Movie N», película suelta, foto «Temporada NN / Arco», comentarios «» 770» y «One Piece - 772» ---- */
{
  id = 1;
  const msgs = [];
  msgs.push(mk('photo', '🎬 Título: One Piece\n📆 Año: 1999\n🎭 Género: Acción/Drama\n🔊 Idioma: Sub Esp\nSinopsis: One Piece narra la historia de un joven llamado Monkey D. Luffy.', { w: 632, h: 899 }));
  for (let n = 1; n <= 6; n += 1) { msgs.push(mk('video', 'One Piece ' + n, { mb: 120 })); }
  msgs.push(mk('photo', '秘Título: One Piece Movie 1 - The Movie\n📆 Año: 2000\n🎭 Género: Acción', { w: 350, h: 467 }));
  msgs.push(mk('video', 'One Piece Movie 1', { mb: 1400 }));
  msgs.push(mk('photo', 'Título: One Piece Film: Red\n📆 Año: 2022\n🎭 Género: Acción/Aventura\nParte: 15', { w: 904, h: 1280 }));
  msgs.push(mk('video', 'One Piece Film: Red (15) - Lat', { mb: 1400 }));
  msgs.push(mk('photo', 'One Piece \nTemporada 01 \nArco East Blue', { w: 300, h: 450 }));
  for (let n = 1; n <= 4; n += 1) { msgs.push(mk('video', 'One Piece - ' + n, { mb: 130 })); }
  msgs.push(mk('photo', 'One Piece \nTemporada 02 \nArco Arabasta', { w: 300, h: 450 }));
  for (let n = 5; n <= 9; n += 1) { msgs.push(mk('video', '🍿 » One Piece: Saga de Dressrosa\n🎬 » Temporada\n🗣 » Latino 🇲🇽\n🎥 » ' + n, { mb: 125 })); }
  const a = PI.analyze(msgs, { chatTitle: 'One Piece' });
  const by = (t) => a.series.filter((s) => s.title === t)[0];
  const main = by('One Piece');
  assert.ok(main && main.type === 'serie');
  assert.ok(!/Sinopsis/i.test(a.series[0].headers[0].lang || ''), 'el idioma no se come la sinopsis');
  const mv = a.series.filter((s) => /Movie 1/.test(s.title))[0];
  assert.ok(mv, 'la película suelta se reconoce');
  assert.equal(mv.title, 'One Piece Movie 1 - The Movie', 'sin el carácter suelto ni «Título:»');
  assert.equal(mv.type, 'pelicula');
  const red = by('One Piece Film: Red');
  assert.ok(red && red.type === 'pelicula', 'Film: Red es película');
  assert.equal(a.series.filter((s) => s.title === 'One Piece').length, 1, '«One Piece» en Sub y en Latino es UNA sola serie');
  assert.equal(main.chapters, 15, '6 de la versión Sub + 4 + 5 de la versión por temporadas');
  assert.equal(main.seasons.map((x) => x.count).join(','), '6,4,5', 'las fotos «Temporada NN» siguen cortando temporadas');
  assert.equal(a.series.length, 3, 'serie + Movie 1 + Film: Red (las películas siguen aparte)');
  console.log('OK: One Piece mezclado: sinopsis fuera del idioma, películas sueltas, fotos «Temporada NN / Arco» y números al final');
}

/* ---- Station 19: foto con «: Station 19 / : 2018 / : Audio Latino», comentarios «Station 19, 1X1 /Latino», luego «》ESTACIÓN 19» y «7x1\nSub» sin título ---- */
{
  id = 1;
  const msgs = [mk('photo', '📺: Station 19\n🌟: 2018\n📩: Audio Latino 🇲🇽\n🔮: 6 Temp', { w: 800, h: 1200 })];
  [10, 17, 16, 16].forEach((n, si) => { for (let e = 1; e <= n; e += 1) { msgs.push(mk('video', 'Station 19, ' + (si + 1) + 'X' + e + ' /Latino', { mb: 340 })); } });
  [18, 18].forEach((n, si) => { for (let e = 1; e <= n; e += 1) { msgs.push(mk('video', '》ESTACIÓN 19\n' + (si + 5) + 'x' + e + '\nLatino', { mb: 340 })); } });
  for (let e = 1; e <= 6; e += 1) { msgs.push(mk('video', '7x' + e + '\nSubtitulado', { mb: 340 })); }
  for (let e = 7; e <= 10; e += 1) { msgs.push(mk('video', '》ESTACIÓN 19\n7x' + e + '\nInglés', { mb: 340 })); }
  const a = PI.analyze(msgs);
  assert.equal(a.series.length, 1, 'Station 19 y ESTACIÓN 19 son la misma serie');
  assert.equal(a.series[0].title, 'Station 19', 'sin la coma de «Station 19,»');
  assert.equal(a.series[0].year, 2018, 'el año sale de la foto («: 2018»)');
  assert.ok(!/2018/.test(a.series[0].original || ''), 'el año no se toma por título original');
  assert.equal(a.series[0].seasons.map((x) => x.count).join(','), '10,17,16,16,18,18,10', 'siete temporadas; la 7 junta los «7x1 Sub» sin título con los demás');
  assert.equal(a.loose.videosSinEncabezado.length, 0);
  console.log('OK: Station 19: foto con «: título / : año / : Audio», nombre en inglés y español unidos y «7x1 Sub» sin título');
}
