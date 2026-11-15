// Importar desde un grupo antiguo, FASE 1 (tools/preparador/importar.js) con un Telegram falso: node tools/test-importar.mjs
//   · lee el canal (videos, documentos de video y fotos, todo lo demás se ignora) y lo deja en el orden real del canal;
//   · interpreta el encabezado (foto con «Título / Original», «N temporadas», Tipo, Publicación, Géneros, Episodios, Duración, Idioma, Formato) y los capítulos;
//   · el MISMO anime con otro nombre en español y otro idioma es una sola serie; el otro anime es otra serie;
//   · el corte de temporada se decide sumando evidencias (encabezado nuevo, numeración que vuelve a 1, cambio de idioma…) y un encabezado repetido NO corta;
//   · avisa de capítulos faltantes, repetidos o sin número y renumera cuando la numeración seguía de largo.
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
const HORA = 3600 * 1000;
let id = 1;
let t0 = Date.UTC(2024, 4, 1, 0, 0, 0);
const canal = [];
function photo(text, extra = {}) { canal.push({ id: id++, media: { type: 'photo', fileSize: 90000, width: 800, height: 1200, ...extra }, text, date: new Date(t0 += 60000) }); }
function video(text, mb, extra = {}) { canal.push({ id: id++, media: { type: 'video', fileSize: mb * MB, duration: 1400, fileName: extra.fileName || '' }, text, date: new Date(t0 += (extra.gap || 60000)) }); }
function doc(text, fileName, mb) { canal.push({ id: id++, media: { type: 'document', fileName, mimeType: 'video/x-matroska', fileSize: mb * MB, duration: 0 }, text, date: new Date(t0 += 60000) }); }

/* ---- 1) el ejemplo de las capturas: T1 japonés con subtítulos y T2 latino, cada una con su encabezado ---- */
video('Capítulo 1 de algo que no tiene encabezado', 10); // un video suelto antes de cualquier encabezado
photo('Los guerreros del zodiaco: el lienzo perdido / Saint Seiya: Lost Canvas\n2 temporadas\nTipo: OVA\nPublicación: 2009\nGéneros: #Acción #Artes_Marciales\n#Aventura #Fantasía #Histórico #Sobrenatural\nEpisodios: 26\nDuración: 23 min\nIdioma: 🇯🇵Jap+Sub\nFormato: 720p', { fileSize: 91000 });
for (let n = 1; n <= 26; n += 1) { video(n === 26 ? 'Capitulo 26' : 'Capítulo ' + n, 270 + (n % 5)); }
photo('El lienzo perdido - Los Caballeros del Zodiaco\n\nTipo: OVA\nPublicación: 2009\nGéneros: Acción, Artes marciales, Aventura, Fantasía, Histórico, Sobrenatural\nEpisodios: 26\nDuración: 23 min\nIdioma: Latino\nFormato: 720p', { fileSize: 93000 });
for (let n = 1; n <= 26; n += 1) { if (n !== 17) { video('Capítulo ' + n, 160 + (n % 3)); } } // falta el 17

/* ---- 2) otra serie: encabezado repetido cada 10 capítulos con la numeración corrida (NO es otra temporada) ---- */
const encB = 'Naruto Clásico / Naruto\nTipo: Serie\nPublicación: 2002\nGéneros: #Acción #Aventura\nEpisodios: 30\nDuración: 22 min\nIdioma: Latino\nFormato: 480p';
photo(encB);
for (let n = 1; n <= 10; n += 1) { video('Capítulo ' + n, 120); }
photo(encB);
for (let n = 11; n <= 20; n += 1) { video('Capítulo ' + n, 120); }
photo(encB);
for (let n = 21; n <= 30; n += 1) { video('Capítulo ' + n, 120); }

/* ---- 3) una serie con «2 temporadas» y sin más pistas: se propone partir en dos ---- */
photo('Cazadores de Sombras\n2 temporadas\nTipo: Serie\nPublicación: 2016\nGéneros: Fantasía\nEpisodios: 12\nDuración: 40 min\nIdioma: Castellano\nFormato: 1080p');
for (let n = 1; n <= 12; n += 1) { video('Capítulo ' + n, 600); }

/* ---- 4) la numeración sigue de largo después de un encabezado nuevo (14 a 26): se renumera ---- */
photo('Dragón Rojo\nTipo: Serie\nPublicación: 1999\nEpisodios: 26\nIdioma: Jap+Sub\nFormato: 720p');
for (let n = 1; n <= 13; n += 1) { video('Capítulo ' + n, 200); }
photo('Dragón Rojo (segunda parte)\nTipo: Serie\nPublicación: 1999\nEpisodios: 26\nIdioma: Jap+Sub\nFormato: 720p');
for (let n = 14; n <= 26; n += 1) { video('Capítulo ' + n, 200); }

/* ---- 5) una película, capítulos sin número en el comentario (el nombre del archivo lo trae) y fotos sin datos ---- */
photo('Mi película\nTipo: Película\nPublicación: 2020\nDuración: 95 min\nIdioma: Latino\nFormato: 1080p');
video('', 1400, { fileName: 'Mi.Pelicula.2020.mkv' });
photo('Serie por nombre de archivo\nTipo: Serie\nPublicación: 2011\nEpisodios: 3\nIdioma: Latino\nFormato: 720p');
doc('', 'Serie S01E01.mkv', 300);
doc('', 'Serie S01E02.mkv', 300);
video('Capítulo 3 - El final', 300);
photo('una foto cualquiera, sin datos');

/* ---- Telegram falso: searchMessages por filtro, de lo más nuevo a lo más viejo, de a poco ---- */
const llamadas = [];
const client = {
  searchMessages: async ({ chatId, filter, limit, offset }) => {
    llamadas.push(filter._);
    const kind = { inputMessagesFilterVideo: (m) => m.media.type === 'video', inputMessagesFilterDocument: (m) => m.media.type === 'document', inputMessagesFilterPhotos: (m) => m.media.type === 'photo' }[filter._];
    const todos = canal.filter((m) => kind(m)).slice().reverse();
    const from = offset || 0;
    const res = todos.slice(from, from + Math.min(limit, 40));
    res.next = from + res.length < todos.length ? from + res.length : undefined;
    return res;
  },
};

// 1) lectura: orden real y solo fotos y videos
let progreso = 0;
const leidos = await PI.read(client, -1001, { onProgress: (n) => { progreso = n; } });
assert.equal(leidos.length, canal.length, 'se leyeron todas las fotos y videos del canal');
assert.ok(llamadas.includes('inputMessagesFilterVideo') && llamadas.includes('inputMessagesFilterPhotos') && llamadas.includes('inputMessagesFilterDocument'));
assert.equal(JSON.stringify(leidos.map((m) => m.id)), JSON.stringify(leidos.map((m) => m.id).slice().sort((a, b) => a - b)), 'quedan en el orden del canal');
assert.ok(progreso > 0);

// 2) encabezado y capítulo
const h = PI.parseHeader(canal[1].text);
assert.equal(h.title, 'Los guerreros del zodiaco: el lienzo perdido');
assert.equal(h.original, 'Saint Seiya: Lost Canvas');
assert.equal(h.seasons, 2); assert.equal(h.year, 2009); assert.equal(h.episodes, 26); assert.equal(h.minutes, 23); assert.equal(h.height, 720);
assert.equal(h.lang, 'japones+subs'); assert.equal(h.type, 'serie');
assert.ok(h.genres.includes('Artes Marciales') && h.genres.includes('Sobrenatural'), 'géneros con # y con guion bajo');
assert.equal(PI.parseHeader('una foto cualquiera, sin datos'), null, 'sin al menos 2 datos no es un encabezado');
assert.equal(PI.parseHeader('Mi película\nTipo: Película\nPublicación: 2020').type, 'pelicula');
assert.equal(PI.parseEpisode({ text: 'Capitulo 26' }).num, 26, 'sin tilde también');
assert.equal(PI.parseEpisode({ text: 'Capítulo 3 - El final' }).title, 'El final');
assert.equal(JSON.stringify(PI.parseEpisode({ text: '', fileName: 'Serie S01E02.mkv' })), JSON.stringify({ num: 2, title: '', season: 1 }));
assert.equal(PI.parseEpisode({ text: '', fileName: 'Mi.Pelicula.2020.mkv' }), null);

// 3) análisis
const a = PI.analyze(leidos);
const por = (t) => a.series.find((s) => s.title.indexOf(t) === 0);
assert.equal(a.series.length, 6, 'zodiaco, naruto, cazadores, dragón, película y serie por nombre de archivo (el 2.º encabezado del zodiaco es la misma serie)');
assert.equal(a.loose.videosSinEncabezado.length, 1, 'el video suelto de antes del primer encabezado queda aparte');
assert.equal(a.loose.fotosSinDatos, 1);

const z = por('Los guerreros');
assert.equal(z.headers.length, 2, 'dos encabezados: el mismo anime con otro nombre en español');
assert.equal(z.seasons.length, 2, 'dos temporadas');
assert.equal(z.seasons[0].count, 26); assert.equal(z.seasons[1].count, 25);
assert.equal(z.seasons[0].lang, 'japones+subs'); assert.equal(z.seasons[1].lang, 'latino', 'cada temporada con su idioma');
assert.equal(z.seasons[1].cut.certainty, 'seguro');
assert.ok(z.seasons[1].cut.score >= 8, 'encabezado +3, numeración a 1 +3, idioma +2 y peso +1');
assert.ok(z.seasons[1].cut.evidence.some((e) => /encabezado nuevo/.test(e.text)) && z.seasons[1].cut.evidence.some((e) => /vuelve a 1/.test(e.text)) && z.seasons[1].cut.evidence.some((e) => /idioma cambia/.test(e.text)));
assert.ok(z.seasons[1].warnings.some((w) => /Faltan los capítulos: 17/.test(w)), 'avisa del capítulo 17 que falta');
assert.equal(z.seasons[0].episodes[25].num, 26, '«Capitulo 26» sin tilde se leyó');
assert.equal(z.status, 'revisar');

const n = por('Naruto');
assert.equal(n.seasons.length, 1, 'el encabezado repetido con numeración continua NO corta');
assert.equal(n.seasons[0].count, 30);
assert.equal(n.status, 'seguro');

const c = por('Cazadores');
assert.equal(c.seasons.length, 2, 'dice 2 temporadas y no hay otra pista: se propone partir en partes iguales');
assert.equal(c.seasons[1].cut.certainty, 'propuesto');
assert.equal(c.seasons[0].count, 6); assert.equal(c.seasons[1].count, 6);

const d = a.series.find((s) => /^Dragón Rojo/.test(s.title));
assert.equal(d.seasons.length, 2, 'encabezado nuevo + otro título parecido = misma serie, otra temporada');
assert.equal(d.seasons[1].renumbered, true, 'la numeración seguía de largo (14 a 26)');
assert.equal(d.seasons[1].episodes[0].newNum, 1); assert.equal(d.seasons[1].episodes[12].newNum, 13);
assert.equal(d.seasons[1].cut.certainty, 'seguro');

const p = por('Mi película');
assert.equal(p.type, 'pelicula'); assert.equal(p.chapters, 1);
assert.ok(p.seasons[0].warnings.some((w) => /no trae número/.test(w)) || p.seasons[0].episodes[0].newNum === 1);

const f = por('Serie por nombre');
assert.equal(JSON.stringify(f.seasons[0].episodes.map((e) => e.newNum)), '[1,2,3]', 'S01E01, S01E02 y «Capítulo 3» (documentos y videos juntos)');

// 4) informe: solo texto
const r = PI.report(a);
assert.equal(r.stats.series, 6);
assert.ok(JSON.stringify(r).length > 500);
assert.ok(!/fileUniqueId|api_hash|token/i.test(JSON.stringify(r)));

console.log('OK: lectura, encabezados, capítulos, series, cortes de temporada (seguros, propuestos y repetidos), faltantes, renumeración e informe');
