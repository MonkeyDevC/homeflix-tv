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

/* ===== IDENTIDAD DEL DISPOSITIVO =====
 * Cada app dice quién es (js/sync.js device()). Es la base de la futura consola (backoffice): qué equipos tiene una cuenta,
 * cuáles están conectados, qué versión corren. Los campos nuevos se agregan aquí y en CAMPOS_DISPOSITIVO; las apps viejas que no los
 * mandan siguen funcionando (llegan vacíos y no pisan lo ya guardado).
 *   tipo        tv | android | pc | web   (tv = Samsung Tizen o Android TV; android = APK de celular; pc = navegador de computador;
 *               web = navegador/PWA de celular o tablet). «Ver en la TV» lista los que pueden reproducir: tv y pc.
 *   plataforma  tizen | androidtv | android | ios | ipados | windows | macos | linux | chromeos
 *   interfaz    tv | movil | pc
 *   canal       tizen | androidtv | apk | pwa | navegador | escritorio  */
export const CAMPOS_DISPOSITIVO = ['plataforma', 'interfaz', 'canal', 'navegador', 'app', 'modelo'];
const LARGO = { id: 64, tipo: 16, nombre: 80, plataforma: 24, interfaz: 12, canal: 20, navegador: 40, app: 20, modelo: 60 };

/** Deja un dispositivo como el servidor lo guarda y lo reparte: solo los campos conocidos, como texto y cortos. */
export function normalizarDispositivo(d = {}) {
  const o = {};
  for (const k of Object.keys(LARGO)) o[k] = String(d && d[k] != null ? d[k] : '').replace(/[\u0000-\u001f]/g, '').slice(0, LARGO[k]);
  return o;
}

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
      cuenta      TEXT NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
      id          TEXT NOT NULL,
      tipo        TEXT NOT NULL DEFAULT '',  -- tv | android | pc | web  (quién es: ver IDENTIDAD DEL DISPOSITIVO abajo)
      nombre      TEXT NOT NULL DEFAULT '',
      plataforma  TEXT NOT NULL DEFAULT '',  -- sistema: tizen | androidtv | android | ios | ipados | windows | macos | linux | chromeos
      interfaz    TEXT NOT NULL DEFAULT '',  -- cuál de las tres pantallas usa: tv | movil | pc
      canal       TEXT NOT NULL DEFAULT '',  -- cómo corre: tizen | androidtv | apk | pwa | navegador | escritorio
      navegador   TEXT NOT NULL DEFAULT '',  -- «Chrome 131» (solo web/pc)
      app         TEXT NOT NULL DEFAULT '',  -- versión de HomeFlix (la del OTA)
      modelo      TEXT NOT NULL DEFAULT '',  -- modelo de TV / equipo, si se conoce
      creado      INTEGER NOT NULL DEFAULT 0,-- primera vez que se vio
      vista       INTEGER NOT NULL,
      PRIMARY KEY (cuenta, id)
    );
  `);
  /* bases que ya existían (sin las columnas nuevas): se agregan sin perder nada */
  const columnas = new Set(db.prepare('PRAGMA table_info(dispositivos)').all().map((c) => c.name));
  for (const c of CAMPOS_DISPOSITIVO) if (!columnas.has(c)) db.exec(`ALTER TABLE dispositivos ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
  if (!columnas.has('creado')) db.exec("ALTER TABLE dispositivos ADD COLUMN creado INTEGER NOT NULL DEFAULT 0");
  db.exec('UPDATE dispositivos SET creado = vista WHERE creado = 0');
  /* doc_at: cuándo cambió el documento por última vez (vista cambia con cada lectura). Lo usa el motor de recomendaciones
   * para leer solo las cuentas que cambiaron (/interno/v1/reco/docs). */
  const colCuentas = new Set(db.prepare('PRAGMA table_info(cuentas)').all().map((c) => c.name));
  if (!colCuentas.has('doc_at')) {
    db.exec('ALTER TABLE cuentas ADD COLUMN doc_at INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE cuentas SET doc_at = vista WHERE doc_at = 0');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuentas_doc_at ON cuentas(doc_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuentas_tg_id ON cuentas(tg_id)');
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
      db.prepare(`UPDATE cuentas SET version = ?, doc = ?, bytes = ?, vista = ?, doc_at = ?,
        tg_id = COALESCE(NULLIF(?, ''), tg_id), tg_nombre = COALESCE(NULLIF(?, ''), tg_nombre), tg_usuario = COALESCE(NULLIF(?, ''), tg_usuario)
        WHERE id = ?`).run(nueva, texto, texto.length, ahora, ahora, corto(cuenta.id, 32), corto(cuenta.nombre, 80), corto(cuenta.usuario, 64), id);
    } else {
      db.prepare(`INSERT INTO cuentas (id, creada, vista, doc_at, tg_id, tg_nombre, tg_usuario, version, doc, bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ahora, ahora, ahora, corto(cuenta.id, 32), corto(cuenta.nombre, 80), corto(cuenta.usuario, 64), nueva, texto, texto.length);
    }
    visto(db, id, dispositivo, ahora);
    return { ok: true, version: nueva };
  })();
}

export function visto(db, id, dispositivo = {}, ahora = Date.now()) {
  const d = normalizarDispositivo(dispositivo);
  db.prepare('UPDATE cuentas SET vista = ? WHERE id = ?').run(ahora, id);
  if (!d.id) return;
  const cols = ['tipo', 'nombre', ...CAMPOS_DISPOSITIVO];
  db.prepare(`INSERT INTO dispositivos (cuenta, id, ${cols.join(', ')}, creado, vista) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)
    ON CONFLICT(cuenta, id) DO UPDATE SET ${cols.map((c) => `${c} = COALESCE(NULLIF(excluded.${c}, ''), ${c})`).join(', ')}, vista = excluded.vista`)
    .run(id, d.id, ...cols.map((c) => d[c]), ahora, ahora);
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
    dispositivos: dispositivos.map((d) => ({
      id: d.id, tipo: d.tipo, nombre: d.nombre, plataforma: d.plataforma, interfaz: d.interfaz, canal: d.canal,
      navegador: d.navegador, app: d.app, modelo: d.modelo, creado: d.creado, vista: d.vista,
    })),
  };
}
