// Arma el catálogo con el MISMO js/library.js de la TV y el celular (así el motor entiende los comentarios igual
// que las apps). Entrada por stdin: [item de js/telegram.js describe()]. Salida por stdout:
// {titles: [{titleKey, type, name, year, description, kids, categories, primaryCategory, tmdb, date}], videos: {videoKey: titleKey}}
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const L = require(process.env.HF_LIBRARY_JS || path.resolve(aqui, '../../../js/library.js'));

let entrada = '';
process.stdin.setEncoding('utf8');
for await (const pedazo of process.stdin) entrada += pedazo;
const items = JSON.parse(entrada || '[]');

const lib = L.build(items, null);
const titles = Object.values(lib.titles).map((t) => ({
  titleKey: t.titleKey,
  type: t.type,
  name: t.name,
  year: t.year || 0,
  description: t.description || '',
  kids: !!t.kids,
  categories: (t.categories || []).map(L.canonicalCategory || ((c) => c)),
  primaryCategory: L.primaryCategory ? L.primaryCategory(t, false) : '',
  tmdb: t.tmdb || null,
  date: t.date || 0,
}));
const videos = {};
for (const [k, v] of Object.entries(lib.byKey)) {
  if (!v) continue;
  const tk = v.type === 'episode' ? v.seriesKey : v.titleKey;
  if (tk && !tk.startsWith('v:')) videos[k] = tk;
}
process.stdout.write(JSON.stringify({ titles, videos }));
