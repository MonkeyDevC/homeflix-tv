// Arma HomeFlix para Android (android/) y, si se pide, lo instala en el celular conectado por USB.
//
//   node tools/build-apk.mjs                 → APK de prueba con los archivos dentro: dist/homeflix-<versión>-debug.apk
//   node tools/build-apk.mjs --install       → además lo instala (adb) y lo abre
//   node tools/build-apk.mjs --dev --install → APK de desarrollo: carga mobile/ desde este PC (node tools/serve.mjs)
//                                              con «adb reverse»; los cambios se ven recargando, sin reinstalar.
//   node tools/build-apk.mjs --release       → APK de publicación sin firmar (firmarlo es un paso aparte)
//
// Igual que el .wgt: copia mobile/, js/ e images/ a android/app/build/www con la clave de Telegram ofuscada
// dentro de js/config.js; *.local.* y los originales pesados nunca entran.
// Necesita: SDK de Android (ANDROID_HOME o %LOCALAPPDATA%\Android\Sdk) y un JDK 17–21 (JAVA_HOME o Eclipse Adoptium).
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadApiKey, configJsWithKey, configJsWithVersion } from './apikey.mjs';
import { imagenesJs, IMAGENES_JS } from './portadas.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const android = join(root, 'android');
const args = new Set(process.argv.slice(2));
const release = args.has('--release');
const dev = args.has('--dev');
const install = args.has('--install');
const DEVICE = process.env.ANDROID_SERIAL || '';

const INCLUDE = ['mobile', 'js', 'images'];
const EXCLUDE = [/\.old\./, /\.local\./, /(^|\/)\./, /^images\/(portadas|avatares)\/(originales\/|.*\.(md|txt)$)/i, /^js\/(portadas|imagenes)\.js$/];

function walk(path) {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path).sort().flatMap((name) => walk(join(path, name)));
}

/* ---------- 1. Archivos de la app ---------- */
const www = join(android, 'app', 'build', 'www');
rmSync(www, { recursive: true, force: true });
const configXml = readFileSync(join(root, 'config.xml'), 'utf8');
const version = (configXml.match(/<widget[^>]*\sversion="([^"]+)"/) || [])[1];
const apiKey = loadApiKey();
let count = 0;
for (const abs of INCLUDE.flatMap((p) => walk(join(root, p)))) {
  const name = relative(root, abs).split(sep).join('/');
  if (EXCLUDE.some((re) => re.test(name))) continue;
  const out = join(www, name);
  mkdirSync(dirname(out), { recursive: true });
  if (name === 'js/config.js') {
    writeFileSync(out, configJsWithVersion(configJsWithKey(readFileSync(abs, 'utf8'), apiKey), configXml));
  } else {
    copyFileSync(abs, out);
  }
  if (apiKey && readFileSync(out).includes(apiKey.hash)) {
    throw new Error(`${name} contiene el api_hash en texto plano; no se arma el APK.`);
  }
  count += 1;
}
writeFileSync(join(www, IMAGENES_JS), imagenesJs(root));
console.log(`Archivos de la app: ${count + 1} en android/app/build/www (v${version}${apiKey ? ', con clave de Telegram' : ', SIN clave de Telegram'})`);

/* ---------- 2. Herramientas (SDK y JDK) ---------- */
const env = { ...process.env };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || join(env.LOCALAPPDATA || '', 'Android', 'Sdk');
if (!existsSync(sdk)) throw new Error('No encontré el SDK de Android (ANDROID_HOME).');
env.ANDROID_HOME = sdk;
if (!existsSync(join(android, 'local.properties'))) {
  writeFileSync(join(android, 'local.properties'), 'sdk.dir=' + sdk.split(sep).join('/') + '\n');
}
/* AGP 8.7 corre con JDK 17–21: si JAVA_HOME es más nuevo (p. ej. 25), se busca un 21 de Eclipse Adoptium. */
const javaOk = (h) => h && /jdk-?(17|21)/i.test(h) && existsSync(h);
if (!javaOk(env.JAVA_HOME)) {
  const base = 'C:\\Program Files\\Eclipse Adoptium';
  const found = existsSync(base) ? readdirSync(base).filter((d) => /^jdk-(21|17)/.test(d)).sort().reverse()[0] : '';
  if (found) env.JAVA_HOME = join(base, found);
}
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adbArgs = (a) => (DEVICE ? ['-s', DEVICE, ...a] : a);

/* ---------- 3. Compilar ---------- */
const task = release ? 'assembleRelease' : 'assembleDebug';
const gradle = join(android, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const gArgs = [task, '--console=plain', '-q'];
if (dev && !release) gArgs.push('-PdevUrl=http://localhost:5173/mobile/');
console.log(`Compilando (${task}${dev ? ', modo desarrollo' : ''})…`);
const g = spawnSync(process.platform === 'win32' ? '"' + gradle + '"' : gradle, gArgs, { cwd: android, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (g.status !== 0) process.exit(g.status || 1);

const kind = release ? 'release' : 'debug';
const built = join(android, 'app', 'build', 'outputs', 'apk', kind, `app-${kind}${release ? '-unsigned' : ''}.apk`);
mkdirSync(join(root, 'dist'), { recursive: true });
const apk = join(root, 'dist', `homeflix-${version}-${dev ? 'dev' : kind}.apk`);
copyFileSync(built, apk);
console.log(`APK: ${relative(root, apk)} (${(statSync(apk).size / 1048576).toFixed(1)} MB)`);

/* ---------- 4. Instalar y abrir ---------- */
if (install) {
  const run = (a) => spawnSync(adb, adbArgs(a), { stdio: 'inherit' });
  if (run(['install', '-r', apk]).status !== 0) process.exit(1);
  if (dev) run(['reverse', 'tcp:5173', 'tcp:5173']); // el localhost:5173 del celular = el de este PC
  const pkg = 'com.homeflix.app' + (release ? '' : '.dev');
  run(['shell', 'am', 'start', '-n', `${pkg}/com.homeflix.app.MainActivity`]);
  console.log('Instalado y abierto en el celular.');
}
