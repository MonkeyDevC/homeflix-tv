// Arma la versión web de HomeFlix como sitio estático en dist/web/ (se sube a cualquier hosting con HTTPS; sin servidor propio).
// Uso: node tools/build-web.mjs
//
// Qué lleva:
//   web/        la instalación como app (PWA: manifest, service worker, iconos, ajustes de iPhone) y la entrada del celular/tablet
//   mobile/     las pantallas del celular (las mismas del APK)
//   index.html  la interfaz de la TV con mouse y teclado (copia de app.html, sin el cargador de actualizaciones de la TV)
//   js/ css/ images/  lo que usan ambas
// La clave de Telegram (api_id / api_hash) se inyecta en js/config.js desde .env, igual que en el APK y el .wgt: nunca se escribe en
// el repo. OJO: va dentro del sitio, así que quien abra la web puede verla (pasa igual con el APK); es la clave de la app, no de una cuenta.
// Telegram solo funciona en HTTPS (o localhost): subirlo a un hosting sin HTTPS no sirve.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiKey, configJsWithKey, configJsWithVersion } from './apikey.mjs';
import { imagenesJs, IMAGENES_JS } from './portadas.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const out = join(root, 'dist', 'web');
const INCLUDE = ['web', 'mobile', 'js', 'images', 'css'];
/* sin copias viejas, archivos locales, ocultos ni originales de portadas; la intro en video (grande) es de la TV y no se usa aquí */
const EXCLUDE = [/\.old\./, /\.local\./, /(^|\/)\./, /^images\/(portadas|avatares)\/(originales\/|.*\.(md|txt)$)/i, /^js\/(portadas|imagenes)\.js$/, /^images\/intro\//, /^web\/CLAUDE\.md$/];

function walk(path) {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path).sort().flatMap((name) => walk(join(path, name)));
}

rmSync(out, { recursive: true, force: true });
const configXml = readFileSync(join(root, 'config.xml'), 'utf8');
const version = (configXml.match(/<widget[^>]*\sversion="([^"]+)"/) || [])[1];
const apiKey = loadApiKey();
if (!apiKey) { console.error('No hay clave de Telegram (.env con TG_API_ID y TG_API_HASH): la web no podría iniciar sesión. No se arma.'); process.exit(1); }
let count = 0;
let bytes = 0;
for (const abs of INCLUDE.flatMap((p) => walk(join(root, p)))) {
  const name = relative(root, abs).split(sep).join('/');
  if (EXCLUDE.some((re) => re.test(name))) continue;
  const dest = join(out, name);
  mkdirSync(dirname(dest), { recursive: true });
  if (name === 'js/config.js') {
    writeFileSync(dest, configJsWithVersion(configJsWithKey(readFileSync(abs, 'utf8'), apiKey), configXml));
  } else {
    copyFileSync(abs, dest);
  }
  if (readFileSync(dest).includes(apiKey.hash)) throw new Error(`${name} contiene el api_hash en texto plano; no se arma la web.`);
  bytes += statSync(dest).size;
  count += 1;
}
writeFileSync(join(out, IMAGENES_JS), imagenesJs(root));

/* la TV con mouse: app.html es la interfaz; sin el script de Tizen ni el cargador de actualizaciones de la TV (la web se actualiza al subir una versión nueva) */
/* HF_WEB marca el sitio publicado (en pruebas locales basta con ?web=1). La interfaz (computador o celular) la elige js/responsive-web.js, que app.html carga solo
 * en la web: ventana ancha con mouse → esta; el resto → /web/ (las pantallas del celular, instalables como app). ?pc=1 / ?movil=1 fuerzan una de las dos. */
const entrada = `<script>window.HF_WEB = true;</` + `script>
`;
const app = readFileSync(join(root, 'app.html'), 'utf8').replace(/<script src="\$WEBAPIS\/[^"]*"><\/script>\s*/g, '').replace('<script>', () => entrada + '<script>');
writeFileSync(join(out, 'index.html'), app);
count += 1;

console.log(`Web armada en dist/web/: ${count} archivos, ${(bytes / 1048576).toFixed(1)} MB (v${version}, con clave de Telegram).`);
console.log('Súbela tal cual a un hosting con HTTPS (la raíz abre la TV con mouse; /web/ abre el celular y la instalación como app).');
console.log('Para probarla aquí: node tools/serve.mjs sirve el repo; para probar dist/web: cualquier servidor estático con localhost o HTTPS.');
