// Clave de la API de Telegram del publicador de HomeFlix (la que se registra en my.telegram.org).
// Telegram pide que una app publicada use la clave de quien la publica; así el usuario final solo escanea el QR.
//
// De dónde sale (nunca del repo):
//   - variables de entorno TG_API_ID y TG_API_HASH (GitHub Actions las toma de los secretos del repo)
//   - o el archivo .env de la raíz (solo en tu PC, está en .gitignore):
//       TG_API_ID=1234567
//       TG_API_HASH=0123456789abcdef0123456789abcdef
//
// Dentro del .wgt va ofuscada (base64 de sal + XOR, mismo formato que titlog/telegram-tizen). No es cifrado:
// solo evita que el hash quede a la vista o lo encuentre una búsqueda simple dentro del paquete.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

function readDotEnv() {
  const file = join(root, '.env');
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** {id, hash} o null si no está configurada. Lanza error si está pero tiene mal formato. */
export function loadApiKey() {
  const env = { ...readDotEnv(), ...process.env };
  const id = String(env.TG_API_ID || '').trim();
  const hash = String(env.TG_API_HASH || '').trim().toLowerCase();
  if (!id && !hash) return null;
  if (!/^[1-9]\d{0,11}$/.test(id)) throw new Error('TG_API_ID debe ser solo números');
  if (!/^[0-9a-f]{32}$/.test(hash)) throw new Error('TG_API_HASH debe tener 32 caracteres 0-9 a-f');
  return { id: Number(id), hash };
}

/** base64( 8 bytes de sal + "id:hash" con XOR ((sal[i%8]*31 + i*17 + 0x5a) & 0xff) ) */
export function pack({ id, hash }) {
  const salt = randomBytes(8);
  const text = Buffer.from(`${id}:${hash}`, 'latin1');
  const body = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i++) body[i] = text[i] ^ ((salt[i % 8] * 31 + i * 17 + 0x5a) & 0xff);
  return Buffer.concat([salt, body]).toString('base64');
}

export function unpack(s) {
  const b = Buffer.from(s, 'base64');
  let out = '';
  for (let i = 8; i < b.length; i++) {
    const j = i - 8;
    out += String.fromCharCode(b[i] ^ ((b[j % 8] * 31 + j * 17 + 0x5a) & 0xff));
  }
  const m = /^([1-9]\d{0,11}):([0-9a-f]{32})$/.exec(out);
  return m ? { id: Number(m[1]), hash: m[2] } : null;
}

/** Contenido de js/config.js con la clave ofuscada (o el original si no hay clave). */
export function configJsWithKey(original, key) {
  if (!key) return original;
  const packed = pack(key);
  const unpacked = unpack(packed);
  if (!unpacked || unpacked.id !== key.id || unpacked.hash !== key.hash) throw new Error('La clave no se pudo ofuscar bien');
  const next = original.replace(/var HF_TG_API_PACKED = "[^"]*";/, `var HF_TG_API_PACKED = "${packed}";`);
  if (next === original) throw new Error('js/config.js no tiene la línea var HF_TG_API_PACKED = "";');
  return next;
}
