// Base de datos de HomeFlix (SQLite en el volumen /data del contenedor).
//
// Una cuenta = una llave secreta que crea la primera app de esa cuenta de Telegram y guarda en los Mensajes
// guardados (homeflix-cuenta.json); las demás apps la leen de ahí. Aquí solo se guarda la huella (sha256) de la
// llave, nunca la llave. El documento es el mismo que arma HFLibrary.exportSync() en las apps (perfiles, chats,
// etiquetas, progreso y Mi lista); quien combina es la app (HFLibrary.mergeSync), el servidor solo lo guarda con
// un número de versión para que dos dispositivos a la vez no se pisen.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function abrir(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'homeflix.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cuentas (
      id          TEXT PRIMARY KEY,          -- sha256 de la llave
      creada      INTEGER NOT NULL,
      vista       INTEGER NOT NULL,          -- última vez que una app sincronizó
      tg_id       TEXT NOT NULL DEFAULT '',  -- lo que la app dice de su cuenta de Telegram (para la consola)
      tg_nombre   TEXT NOT NULL DEFAULT '',
      tg_usuario  TEXT NOT NULL DEFAULT '',
      version     INTEGER NOT NULL DEFAULT 0,
      doc         TEXT NOT NULL DEFAULT '{}',
      bytes       INTEGER NOT NULL DEFAULT 0,
      bloqueada   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dispositivos (
      cuenta  TEXT NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
      id      TEXT NOT NULL,
      tipo    TEXT NOT NULL DEFAULT '',      -- tv | android | web
      nombre  TEXT NOT NULL DEFAULT '',
      vista   INTEGER NOT NULL,
      PRIMARY KEY (cuenta, id)
    );
  `);
  return db;
}

export const huella = (llave) => createHash('sha256').update(String(llave)).digest('hex');

/* La llave: 32 bytes al azar en base64url (43 caracteres) o hex (64). Otra cosa no se acepta. */
export const llaveValida = (llave) => /^[A-Za-z0-9_-]{43,86}$/.test(String(llave || ''));

const corto = (s, n) => String(s == null ? '' : s).slice(0, n);

export function leer(db, id) {
  return db.prepare('SELECT * FROM cuentas WHERE id = ?').get(id) || null;
}

/**
 * Guarda el documento si la versión que trae la app es la última. Devuelve
 * {ok: true, version} o {conflicto: true, version, doc} (la app combina con ese y vuelve a intentar).
 */
export function guardar(db, id, { version, doc, cuenta = {}, dispositivo = {} }, ahora = Date.now()) {
  const texto = JSON.stringify(doc);
  return db.transaction(() => {
    const fila = leer(db, id);
    if (fila && fila.bloqueada) return { bloqueada: true };
    const actual = fila ? fila.version : 0;
    if (Number(version) !== actual) return { conflicto: true, version: actual, doc: fila ? JSON.parse(fila.doc) : null };
    const nueva = actual + 1;
    if (fila) {
      db.prepare(`UPDATE cuentas SET version = ?, doc = ?, bytes = ?, vista = ?,
        tg_id = COALESCE(NULLIF(?, ''), tg_id), tg_nombre = COALESCE(NULLIF(?, ''), tg_nombre), tg_usuario = COALESCE(NULLIF(?, ''), tg_usuario)
        WHERE id = ?`).run(nueva, texto, texto.length, ahora, corto(cuenta.id, 32), corto(cuenta.nombre, 80), corto(cuenta.usuario, 64), id);
    } else {
      db.prepare(`INSERT INTO cuentas (id, creada, vista, tg_id, tg_nombre, tg_usuario, version, doc, bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ahora, ahora, corto(cuenta.id, 32), corto(cuenta.nombre, 80), corto(cuenta.usuario, 64), nueva, texto, texto.length);
    }
    visto(db, id, dispositivo, ahora);
    return { ok: true, version: nueva };
  })();
}

export function visto(db, id, dispositivo = {}, ahora = Date.now()) {
  const did = corto(dispositivo.id, 64);
  db.prepare('UPDATE cuentas SET vista = ? WHERE id = ?').run(ahora, id);
  if (!did) return;
  db.prepare(`INSERT INTO dispositivos (cuenta, id, tipo, nombre, vista) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cuenta, id) DO UPDATE SET tipo = COALESCE(NULLIF(excluded.tipo, ''), tipo),
      nombre = COALESCE(NULLIF(excluded.nombre, ''), nombre), vista = excluded.vista`)
    .run(id, did, corto(dispositivo.tipo, 16), corto(dispositivo.nombre, 80), ahora);
}

/** Resumen de una cuenta para la consola (sin el documento completo). */
export function resumenCuenta(fila, dispositivos = []) {
  let doc = {};
  try { doc = JSON.parse(fila.doc); } catch { doc = {}; }
  const perfiles = (doc.profiles && doc.profiles.list) || [];
  let lista = 0;
  let progreso = 0;
  for (const p of Object.values(doc.p || {})) {
    lista += Object.values(p.mylist || {}).filter((x) => x && x.on).length;
    progreso += Object.keys(p.progress || {}).length;
  }
  return {
    id: fila.id, creada: fila.creada, vista: fila.vista, bloqueada: !!fila.bloqueada,
    telegram: { id: fila.tg_id, nombre: fila.tg_nombre, usuario: fila.tg_usuario },
    perfiles: perfiles.map((p) => ({ id: p.id, nombre: p.name, infantil: !!p.kids, pin: !!p.pin })),
    miLista: lista, videosConProgreso: progreso, bytes: fila.bytes, version: fila.version,
    dispositivos: dispositivos.map((d) => ({ tipo: d.tipo, nombre: d.nombre, vista: d.vista })),
  };
}
