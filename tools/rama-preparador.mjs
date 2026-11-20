// Deja la ÚLTIMA versión del Preparador de videos en la rama «preparador» de GitHub (el repositorio del proyecto).
//
//   node tools/rama-preparador.mjs                 arma la rama en local (en una carpeta temporal) y dice qué cambia; no sube nada
//   node tools/rama-preparador.mjs --subir         además la sube a origin (git push origin preparador)
//   opciones: --remoto=origin   --rama=preparador   --coautor "Nombre <correo>"   (esta última agrega un «Co-Authored-By» al commit)
//
// La rama es SOLO el preparador (historia propia, sin el resto de la app): los mismos archivos que lleva el zip que se publica con
// tools/publicar-version.mjs (su lista PREP), más los instaladores, el lanzador y las pruebas del preparador, un README y un .gitignore.
// Cada vez que se corre toma los archivos de ESTE árbol de trabajo (la versión de tools/preparador/version.json) y, si algo cambió, agrega un commit
// «Preparador de videos <versión>». No toca la rama ni los cambios que tengas abiertos en el proyecto: trabaja en un worktree temporal.
// Nunca lleva claves: el .env y los *.local.* están en el .gitignore del repo y de la rama; js/config.js va con la clave vacía.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d = '') => { const a = args.find((x) => x.startsWith('--' + n + '=')); if (a) return a.slice(n.length + 3); const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const subir = args.includes('--subir');
const REMOTO = opt('remoto', 'origin');
const RAMA = opt('rama', 'preparador');
const coautor = opt('coautor');

function git(a, cwd = root, ok = false) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !ok) throw new Error(`git ${a.join(' ')}: ${(r.stderr || r.stdout || '').trim()}`);
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/* 1. qué archivos: la lista PREP de publicar-version.mjs (una sola fuente de verdad) + lo que solo sirve en el repo */
const pub = readFileSync(join(root, 'tools', 'publicar-version.mjs'), 'utf8');
const m = /const PREP = \[([\s\S]*?)\];/.exec(pub);
if (!m) throw new Error('No encontré la lista PREP en tools/publicar-version.mjs');
const PREP = new Function(`return [${m[1]}];`)();
const EXTRA = [
  'tools/preparador/instalar-preparador.cmd', 'tools/preparar-video.mjs',
  'tools/test-corte.mjs', 'tools/test-temas.mjs', 'tools/test-preparador-cache.mjs',
  'tools/test-importar.mjs', 'tools/test-importar-continua.mjs', 'tools/test-importar-copia.mjs', 'tools/test-importar-inline.mjs'
];
const archivos = [...new Set([...PREP, ...EXTRA])];
const faltan = archivos.filter((f) => !existsSync(join(root, f)));
if (faltan.length) throw new Error('Faltan archivos del preparador: ' + faltan.join(', '));

const version = JSON.parse(readFileSync(join(root, 'tools', 'preparador', 'version.json'), 'utf8')).version;
let notas = '';
try { const a = JSON.parse(readFileSync(join(root, 'dist', 'versiones', 'actual.json'), 'utf8')); if (a.version === version) notas = a.notas || ''; } catch { /* sin notas */ }

/* 2. la rama: la de origin si ya existe, la local si ya existe, o una nueva y sin historia (huérfana) */
const existeLocal = git(['rev-parse', '--verify', '--quiet', `refs/heads/${RAMA}`], root, true).status === 0;
const existeRemota = git(['ls-remote', '--exit-code', '--heads', REMOTO, RAMA], root, true).status === 0;
if (existeRemota && !existeLocal) git(['fetch', REMOTO, `${RAMA}:${RAMA}`]);
const tmp = join(tmpdir(), `homeflix-rama-${RAMA}-${process.pid}`);
rmSync(tmp, { recursive: true, force: true });
const hayRama = existeLocal || existeRemota;
if (hayRama) git(['worktree', 'add', tmp, RAMA]); else git(['worktree', 'add', '--orphan', '-b', RAMA, tmp]);

function limpia(dir) {
  for (const n of readdirSync(dir)) { if (n !== '.git') rmSync(join(dir, n), { recursive: true, force: true }); }
}

try {
  if (existeRemota && existeLocal) {
    const r = git(['merge-base', '--is-ancestor', RAMA, `${REMOTO}/${RAMA}`], root, true);
    if (r.status !== 0 && git(['rev-parse', `${REMOTO}/${RAMA}`], root, true).status === 0) {
      console.log(`Aviso: la rama local ${RAMA} no está contenida en ${REMOTO}/${RAMA}; se suma encima de la local.`);
    }
  }
  limpia(tmp);
  for (const f of archivos) {
    const dest = join(tmp, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, f), dest);
  }
  writeFileSync(join(tmp, '.gitignore'), [
    '# Claves y configuración local: nunca al repo',
    '.env', '*.local.*', 'secrets/', '',
    '# El preparador crea estos al trabajar', '.cola.json', '.reinicio', 'node_modules/', ''
  ].join('\n'));
  writeFileSync(join(tmp, 'README.md'), [
    '# HomeFlix · Preparador de videos',
    '',
    `Versión **${version}** (la misma que se publica en el canal de actualizaciones de HomeFlix).`,
    '',
    'Programa para Windows que prepara películas y series para subirlas a Telegram y que HomeFlix las lea: crea las versiones 4K, 1080p, 720p y 360p,',
    'corta lo que pasa del límite de Telegram, saca portadas, subtítulos y miniaturas, completa los datos con TMDB, publica en el grupo (con un tema por',
    'película), importa desde grupos antiguos y migra lo ya publicado. Se abre en el navegador y solo escucha en este PC (127.0.0.1).',
    '',
    '> Esta rama es solo el preparador (historia aparte del resto de la app). La app de la TV, el celular y la web viven en `main` y sus ramas.',
    '',
    '## Cómo usarlo',
    '',
    '1. Instala [Node.js](https://nodejs.org) y [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) (o corre `tools/preparador/instalar-preparador.cmd`, que los instala con winget,',
    '   baja la última versión del canal oficial y deja accesos directos).',
    '2. Doble clic en **`Preparar videos.cmd`** (o `node tools/preparador/server.mjs`). Se abre solo en el navegador.',
    '3. La primera vez pide la clave de Telegram de HomeFlix (`TG_API_ID` y `TG_API_HASH`) y, si quieres datos automáticos, una de TMDB (`TMDB_API_KEY`):',
    '   se guardan en un `.env` en tu PC, que **nunca** va al repositorio.',
    '',
    '## Qué hay aquí',
    '',
    '- `tools/preparador/` — el servidor y la interfaz (`server.mjs`, `ui.html`, `prepare.mjs`, `publish.mjs`, `cola.js`, `importar.js`, `temas.js`, `cache.js`, `subsync.js`…).',
    '- `js/` — el motor de Telegram y la lectura de la biblioteca que comparte con la app (`tg.bundle.js`, `telegram.js`, `library.js`, `config.js` con la clave vacía).',
    '- `tools/apikey.mjs` — lee las claves del `.env`.',
    '- `tools/test-*.mjs` — pruebas del preparador (`node tools/test-corte.mjs`, `test-temas`, `test-preparador-cache`, `test-importar*`).',
    '',
    '## Cómo se actualiza esta rama',
    '',
    'Desde el proyecto principal: `node tools/rama-preparador.mjs --subir`. Toma los archivos de la versión vigente y agrega un commit',
    '«Preparador de videos <versión>». El preparador instalado se actualiza solo desde su aviso «Versión nueva»; esta rama es la copia del código.',
    ''
  ].join('\n'));

  git(['add', '-A', '-f'], tmp);
  const estado = git(['status', '--porcelain'], tmp).out;
  if (!estado) {
    console.log(`La rama ${RAMA} ya tiene la versión ${version}: nada que cambiar.`);
  } else {
    const nuevos = estado.split('\n').length;
    const msg = [`Preparador de videos ${version}`, '', notas ? notas : `Archivos del preparador tomados de la versión ${version} del proyecto.`];
    if (coautor) msg.push('', `Co-Authored-By: ${coautor}`);
    git(['commit', '-m', msg.join('\n')], tmp);
    console.log(`Commit en la rama ${RAMA}: ${nuevos} archivos con cambios (versión ${version}).`);
  }
  const log = git(['log', '--oneline', '-5'], tmp).out;
  console.log('\nÚltimos commits de la rama:\n' + log);
  const total = git(['ls-files'], tmp).out.split('\n').filter(Boolean);
  console.log(`\nLa rama lleva ${total.length} archivos.`);
  if (subir) {
    console.log(`\nSubiendo ${RAMA} a ${REMOTO}…`);
    const r = git(['push', '-u', REMOTO, RAMA], root, true);
    console.log((r.err || r.out) + (r.status === 0 ? '\nListo: la rama está en GitHub.' : ''));
    if (r.status !== 0) process.exitCode = 1;
  } else {
    console.log(`\nNo se subió nada. Para subirla: node tools/rama-preparador.mjs --subir`);
  }
} finally {
  git(['worktree', 'remove', '--force', tmp], root, true);
  rmSync(tmp, { recursive: true, force: true });
  git(['worktree', 'prune'], root, true);
}
