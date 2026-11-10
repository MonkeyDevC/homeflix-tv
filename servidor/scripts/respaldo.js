// Copia consistente de la base (API de respaldo de SQLite, sin parar el servidor): node scripts/respaldo.js <destino>
import Database from 'better-sqlite3';
import { join } from 'node:path';

const destino = process.argv[2];
if (!destino) { console.error('Uso: node scripts/respaldo.js <archivo-destino>'); process.exit(2); }
const db = new Database(join(process.env.DATA_DIR || './data', 'homeflix.db'), { readonly: true });
await db.backup(destino);
const copia = new Database(destino, { readonly: true });
const ok = copia.pragma('integrity_check', { simple: true });
console.log('integridad:', ok, '| cuentas:', copia.prepare('SELECT COUNT(*) AS n FROM cuentas').get().n);
process.exit(ok === 'ok' ? 0 : 1);
