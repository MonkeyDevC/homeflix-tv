// Empaqueta HomeFlix como .wgt (un zip) en dist/homeflix-<version>.wgt.
// El paquete sale SIN firmar: Apps2Samsung (o `apps2samsung-cli sign`) lo firma con tu certificado de Samsung al instalar.
// Uso: node tools/build-wgt.mjs   (sin dependencias, Node 22+)
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// Lo que va dentro del paquete. Todo lo demás (.cursor, .sign, tools, dist, *.old.*) queda fuera.
const INCLUDE = ['config.xml', 'index.html', 'icon.png', 'css', 'js', 'images'];
const EXCLUDE = [/\.old\./, /(^|\/)\./];

function walk(path) {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path).sort().flatMap((name) => walk(join(path, name)));
}

const files = INCLUDE.flatMap((p) => walk(join(root, p)))
  .map((abs) => ({ abs, name: relative(root, abs).split(sep).join('/') }))
  .filter((f) => !EXCLUDE.some((re) => re.test(f.name)));

const config = readFileSync(join(root, 'config.xml'), 'utf8');
const version = (config.match(/<widget[^>]*\sversion="([^"]+)"/) || [])[1];
if (!version) throw new Error('No encontré version="..." en config.xml');

// Hora DOS fija para que el mismo código dé el mismo paquete.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const f of files) {
  const data = readFileSync(f.abs);
  const packed = deflateRawSync(data, { level: 9 });
  const useDeflate = packed.length < data.length;
  const body = useDeflate ? packed : data;
  const name = Buffer.from(f.name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + body.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `homeflix-${version}.wgt`);
const zip = Buffer.concat([...locals, centralBuf, end]);
writeFileSync(out, zip);
console.log(`${relative(root, out)}  ${files.length} archivos, ${(zip.length / 1024).toFixed(0)} KB`);
for (const f of files) console.log('  ' + f.name);
