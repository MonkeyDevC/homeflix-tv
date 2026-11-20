// Publica una versión de HomeFlix en el canal de actualizaciones del servidor (VPS).
//
//   node tools/publicar-version.mjs 1.1.4 --notas "Qué cambió"            arma todo en dist/versiones/1.1.4/
//   node tools/publicar-version.mjs 1.1.4 --notas "…" --programa          además pide reinstalar el .wgt/.apk (cuando
//                                                                       cambia lo nativo: arranque de la TV, Java del APK)
//   node tools/publicar-version.mjs 1.1.4 --notas "…" --local             y la publica en el servidor de la casa (local/versiones)
//   (--subir era para el VPS, que ya no existe)
//
// Qué arma:
//   web-<v>.json        la interfaz (TV: app.html, css/, js/; celular: mobile/, js/), la que se actualiza sola
//   homeflix-<v>.wgt    el programa de la TV (Apps2Samsung)
//   homeflix-<v>.apk    el programa del celular
//   preparador-<v>.zip  el preparador de videos (se actualiza desde su propio botón)
//   actual.json         la versión vigente: lo que preguntan las apps
// La versión sale de config.xml (se cambia aquí) y es la misma para todo. «nativoMinimo» (tools/nativo-minimo.json)
// es la versión del programa que necesita esta interfaz; solo sube con --programa.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadApiKey, configJsWithKey, configJsWithVersion } from './apikey.mjs';
import { imagenesJs, IMAGENES_JS } from './portadas.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
/* HOMEFLIX_HOST y HOMEFLIX_KEY cambian el VPS y la llave (el dueño usa deploy@…; un colaborador usa deploycolab@…, que solo puede publicar actualizaciones:
 * servidor/scripts/colab/, docs/acceso-colaborador.md). */
const VPS = { key: process.env.HOMEFLIX_KEY || join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'nexuspos_vps'), host: process.env.HOMEFLIX_HOST || 'deploy@187.77.20.217', dir: '~/homeflix-servidor/versiones' };
const COLAB = /^deploycolab@/.test(VPS.host);

const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const flag = (n) => args.includes('--' + n);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] || '' : ''; };
if (!version) {
  console.log('Uso: node tools/publicar-version.mjs 1.2.3 --notas "Qué cambió" [--programa] [--subir]');
  process.exit(1);
}
const notas = opt('notas');

function run(cmd, a) {
  const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`Falló: ${cmd} ${a.join(' ')}`);
}
function walk(path) {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path).sort().flatMap((name) => walk(join(path, name)));
}
const rel = (abs) => relative(root, abs).split(sep).join('/');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/* 1. la versión, en config.xml (de ahí la toman la TV, el APK y la interfaz) */
const cfgPath = join(root, 'config.xml');
let config = readFileSync(cfgPath, 'utf8');
config = config.replace(/(<widget[^>]*\sversion=")[^"]+(")/, `$1${version}$2`);
writeFileSync(cfgPath, config);
writeFileSync(join(root, 'tools', 'preparador', 'version.json'), JSON.stringify({ version }, null, 1) + '\n');
console.log(`\n== HomeFlix ${version} ==`);

/* 2. programas: .wgt y .apk */
run('node', ['tools/build-wgt.mjs']);
run('node', ['tools/build-apk.mjs']);

const out = join(root, 'dist', 'versiones', version);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'dist', `homeflix-${version}.wgt`), join(out, `homeflix-${version}.wgt`));
copyFileSync(join(root, 'dist', `homeflix-${version}-debug.apk`), join(out, `homeflix-${version}.apk`));

/* 3. la interfaz: todo el texto de la TV y del celular (las imágenes salen del programa instalado) */
const apiKey = loadApiKey();
const EXCLUDE = [/\.old\./, /\.local\./, /(^|\/)\./, /^js\/(portadas|imagenes)\.js$/];
const files = {};
for (const abs of ['app.html', 'css', 'js', 'mobile'].flatMap((p) => walk(join(root, p)))) {
  const name = rel(abs);
  if (EXCLUDE.some((re) => re.test(name)) || !/\.(html|css|js|json|svg)$/i.test(name)) continue;
  let text = readFileSync(abs, 'utf8');
  if (name === 'js/config.js') text = configJsWithVersion(configJsWithKey(text, apiKey), config);
  if (apiKey && text.includes(apiKey.hash)) throw new Error(`${name} contiene el api_hash en texto plano`);
  files[name] = text;
}
files[IMAGENES_JS] = imagenesJs(root);
const web = Buffer.from(JSON.stringify({ app: 'homeflix-web', version, files }), 'utf8');
writeFileSync(join(out, `web-${version}.json`), web);

/* 4. el preparador de videos (sin claves: su servidor las pone desde el .env de cada PC) */
const PREP = ['tools/preparador/server.mjs', 'tools/preparador/prepare.mjs', 'tools/preparador/publish.mjs', 'tools/preparador/ui.html',
  'tools/preparador/biblioteca.js', 'tools/preparador/biblioteca.css', 'tools/preparador/cola.js', 'tools/preparador/subsync.js', 'tools/preparador/cache.js', 'tools/preparador/temas.js', 'tools/preparador/importar.js', 'tools/preparador/sw-stream.js', 'tools/preparador/version.json', 'tools/apikey.mjs',
  'js/tg.bundle.js', 'js/telegram.js', 'js/library.js', 'js/config.js', 'images/logo.png', 'Preparar videos.cmd', 'tools/preparador/logo.ico', 'tools/preparador/desinstalar-preparador.cmd'];
const zip = join(out, `preparador-${version}.zip`);
/* los .cmd siempre con saltos de línea de Windows: con saltos de Unix, cmd los lee corridos y no funcionan */
for (const f of ['Preparar videos.cmd', 'tools/preparador/instalar-preparador.cmd', 'tools/preparador/desinstalar-preparador.cmd']) {
  const fp = join(root, f);
  writeFileSync(fp, readFileSync(fp, 'utf8').replace(/\r?\n/g, '\r\n'));
}
/* el ícono del acceso directo del preparador instalado (sin claves: el preparador las pide la primera vez en cada PC) */
const ico = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(root, 'images', 'logo.png'), '-vf', 'scale=256:256', join(root, 'tools', 'preparador', 'logo.ico')], { stdio: 'inherit' });
if (ico.status !== 0) throw new Error('No pude armar el ícono del preparador');
/* el tar de Windows (bsdtar) arma zip; el de Git no */
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
const z = spawnSync(TAR, ['-a', '-c', '-f', zip, ...PREP], { cwd: root, stdio: 'inherit' });
if (z.status !== 0) throw new Error('No pude armar el zip del preparador');
/* el instalador para otro PC (siempre baja la última versión del canal) */
copyFileSync(join(root, 'tools', 'preparador', 'instalar-preparador.cmd'), join(out, 'instalar-preparador.cmd'));

/* 5. la versión vigente */
const nmPath = join(root, 'tools', 'nativo-minimo.json');
let nativo = existsSync(nmPath) ? JSON.parse(readFileSync(nmPath, 'utf8')) : { tv: version, android: version };
if (flag('programa')) nativo = { tv: version, android: version };
writeFileSync(nmPath, JSON.stringify(nativo, null, 1) + '\n');
const info = (name, extra = {}) => { const b = readFileSync(join(out, name)); return { archivo: name, bytes: b.length, sha256: sha(b), ...extra }; };
const actual = {
  version, fecha: new Date().toISOString(), notas,
  web: info(`web-${version}.json`, { nativoMinimo: nativo }),
  wgt: info(`homeflix-${version}.wgt`, { version }),
  apk: info(`homeflix-${version}.apk`, { version }),
  preparador: info(`preparador-${version}.zip`, { version }),
  instalador: info('instalar-preparador.cmd'),
};
writeFileSync(join(root, 'dist', 'versiones', 'actual.json'), JSON.stringify(actual, null, 1));
console.log(`\nListo en dist/versiones/${version}/:`);
for (const k of ['web', 'wgt', 'apk', 'preparador', 'instalador']) console.log(`  ${actual[k].archivo}  ${(actual[k].bytes / 1048576).toFixed(1)} MB`);
console.log(`  programa mínimo: TV ${nativo.tv} · celular ${nativo.android}`);

/* 6a. publicar en el servidor de la casa (Docker en este Mac, local/README.md): local/versiones es /versiones del contenedor
 * «homeflix». Igual que en el VPS: primero los archivos y al final actual.json. */
if (flag('local')) {
  const destino = join(root, 'local', 'versiones');
  mkdirSync(join(destino, version), { recursive: true });
  for (const f of readdirSync(out)) copyFileSync(join(out, f), join(destino, version, f));
  copyFileSync(join(root, 'dist', 'versiones', 'actual.json'), join(destino, 'actual.json'));
  console.log(`\nPublicada en el servidor de la casa: local/versiones/${version} (las apps la ven en <servidor>/actualizaciones/v1)`);
} else
/* 6b. subir al VPS (ya no existe desde 2026-11; queda por si vuelve): primero los archivos y al final actual.json */
if (flag('subir')) {
  const ssh = ['-i', VPS.key, '-o', 'BatchMode=yes'];
  if (COLAB) {
    /* colaborador: sin consola en el VPS; solo las órdenes de homeflix-colab (ota-subir y ota-actual), con los archivos por la entrada como .tar.gz.
     * El servidor revisa nombres, tamaños y sha256 antes de cambiar nada. --forzar permite volver a subir la versión que ya es la vigente. */
    const pack = spawnSync(TAR, ['-czf', '-', '-C', out, '.'], { maxBuffer: 1 << 30 });
    if (pack.status !== 0) throw new Error('No pude empaquetar la versión');
    const orden = (o, datos) => { const r = spawnSync('ssh', [...ssh, VPS.host, ...o], { input: datos, stdio: ['pipe', 'inherit', 'inherit'] }); if (r.status !== 0) throw new Error(`Falló: ssh ${o.join(' ')}`); };
    orden(['ota-subir', version, ...(flag('forzar') ? ['forzar'] : [])], pack.stdout);
    orden(['ota-actual'], readFileSync(join(root, 'dist', 'versiones', 'actual.json')));
  } else {
    run('ssh', [...ssh, VPS.host, `mkdir -p ${VPS.dir}`]);
    run('scp', [...ssh, '-r', out, `${VPS.host}:${VPS.dir}/`]);
    run('scp', [...ssh, join(root, 'dist', 'versiones', 'actual.json'), `${VPS.host}:${VPS.dir}/actual.json`]);
  }
  console.log(`\nPublicada: https://scalvache.shop/productos/HomeFlix/actualizaciones/v1 → ${version}`);
  console.log(`Instalador del preparador: https://scalvache.shop/productos/HomeFlix/actualizaciones/archivos/${version}/instalar-preparador.cmd`);
} else {
  console.log('\nNo se subió nada. Para publicarla en el servidor de la casa: agrega --local');
}
