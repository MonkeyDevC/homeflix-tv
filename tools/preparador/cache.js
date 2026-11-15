/* HomeFlix · Preparador · caché de la biblioteca.
 *
 * Antes, cada vez que se abría el preparador (o se publicaba algo) se leía el chat ENTERO desde cero: tres filtros uno tras otro, cien
 * mensajes por petición y ~3,5 s por petición, con la pantalla en «Leyendo…» hasta el final; y las portadas se volvían a bajar de
 * Telegram una por una. Ahora:
 *   · el catálogo de cada chat (los videos, fotos y subtítulos con su comentario) se guarda en este navegador (IndexedDB) y se
 *     enseña AL INSTANTE al abrir, antes de que Telegram conteste;
 *   · en segundo plano se piden solo los mensajes NUEVOS (los tres filtros a la vez, parando en lo que ya se conocía) y a la vez
 *     se vuelven a pedir los ya conocidos por tandas de 100 (getMessages) para ver comentarios editados, imágenes cambiadas y
 *     mensajes borrados: lo que cambió se actualiza, lo borrado desaparece;
 *   · la lectura COMPLETA (única que encuentra una foto sin «#» a la que se le puso después) se hace la primera vez, cada 24 h o con ↻;
 *   · las portadas descargadas se guardan en este navegador (se vuelven a leer del disco, no de Telegram).
 * Los mensajes (objetos de Telegram) no se pueden guardar: por eso se piden otra vez, en segundo plano, para poder leer pistas,
 * editar comentarios o publicar (window.HFB marca cuándo están listos).
 *
 *   PrepCache      almacenamiento (IndexedDB; en las pruebas, memoria)
 *   PrepCatalog    peek(meId, chatId) · refresh({client, peer, old, chatId, meId, full, msgs, onProgress}) */
var PrepCache = (function () {
  "use strict";
  var DB = "hf-preparador-cache";
  var KV = "kv";
  var TH = "thumbs";
  var THUMB_MAX = 600;
  var dbp = null;
  var puts = 0;
  var backend = null; // solo para pruebas: {get(store, key), put(store, key, val), del(store, key)}

  function db() {
    if (!dbp) {
      dbp = new Promise(function (resolve) {
        var req;
        try {
          req = window.indexedDB.open(DB, 1);
        } catch (e) {
          resolve(null);
          return;
        }
        req.onupgradeneeded = function () {
          req.result.createObjectStore(KV);
          req.result.createObjectStore(TH).createIndex("at", "at");
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      });
    }
    return dbp;
  }

  function get(store, key) {
    if (backend) { return Promise.resolve(backend.get(store, key)); }
    return db().then(function (d) {
      if (!d) { return null; }
      return new Promise(function (resolve) {
        try {
          var r = d.transaction(store, "readonly").objectStore(store).get(key);
          r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
          r.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  function put(store, key, val) {
    if (backend) { backend.put(store, key, val); return Promise.resolve(); }
    return db().then(function (d) {
      if (!d) { return; }
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(store, "readwrite");
          tx.objectStore(store).put(val, key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = tx.onabort = function () { resolve(); };
        } catch (e) {
          resolve();
        }
      });
    });
  }

  function del(store, key) {
    if (backend) { backend.del(store, key); return Promise.resolve(); }
    return db().then(function (d) {
      if (!d) { return; }
      try { d.transaction(store, "readwrite").objectStore(store).delete(key); } catch (e) { /* nada */ }
    });
  }

  /* Portadas: se guardan las más recientes (THUMB_MAX); al pasarse, se borran las de hace más tiempo */
  function prune(d) {
    try {
      var st = d.transaction(TH, "readwrite").objectStore(TH);
      var c = st.count();
      c.onsuccess = function () {
        var extra = c.result - THUMB_MAX;
        if (extra <= 0) { return; }
        extra += 40;
        st.index("at").openCursor().onsuccess = function (ev) {
          var cur = ev.target.result;
          if (cur && extra > 0) { cur.delete(); extra -= 1; cur.continue(); }
        };
      };
    } catch (e) { /* nada */ }
  }

  function thumbPut(key, bytes) {
    puts += 1;
    return put(TH, key, { b: bytes, at: Date.now() }).then(function () {
      if (!backend && puts % 40 === 0) { db().then(function (d) { if (d) { prune(d); } }); }
    });
  }

  function thumbGet(key) {
    return get(TH, key).then(function (v) { return v && v.b ? v.b : null; });
  }

  return {
    get: function (k) { return get(KV, k); },
    set: function (k, v) { return put(KV, k, v); },
    del: function (k) { return del(KV, k); },
    thumbGet: thumbGet,
    thumbPut: thumbPut,
    _use: function (b) { backend = b; }
  };
}());

var PrepCatalog = (function () {
  "use strict";
  var VIDEO = { _: "inputMessagesFilterVideo" };
  var DOCS = { _: "inputMessagesFilterDocument" };
  var PHOTOS = { _: "inputMessagesFilterPhotos" };
  var VIDEO_EXT = /\.(mkv|webm|mp4|m4v|mov)$/i;
  var FULL_EVERY = 24 * 3600 * 1000;
  var MAX_PER_FILTER = 3000;
  var BATCH = 100;

  function isVideoMsg(m) { var d = m.media; return !!d && d.type === "video" && !d.isRound && !d.isAnimation; }
  function isVideoDoc(m) { var d = m.media; return !!d && d.type === "document" && (VIDEO_EXT.test(d.fileName || "") || /^video\//i.test(d.mimeType || "")); }
  function isThumbDoc(m) { var d = m.media; return !!d && d.type === "document" && /miniaturas[\s_]+\d+s[\s_]+\d+x\d+[\s_]+\d+x\d+[\s_]+hoja[\s_]+\d+[\s_]+de[\s_]+\d+\.jpe?g$/i.test(d.fileName || ""); }
  function isSubDoc(m) { var d = m.media; return !!d && d.type === "document" && /\.(srt|vtt|ass|ssa)$/i.test(d.fileName || "") && !!(m.text && m.text.indexOf("#") >= 0); }
  function isPhoto(m) { return !!m.media && m.media.type === "photo" && !!(m.text && m.text.indexOf("#") >= 0); }
  function docKeep(m) { return isVideoDoc(m) || isThumbDoc(m) || isSubDoc(m); }
  function docKind(m) { return isThumbDoc(m) ? "thumbs" : isSubDoc(m) ? "sub" : "video"; }

  /* ¿sigue valiendo este mensaje como item de ese tipo? (si se le quitó el «#» a una foto, ya no cuenta) */
  function stillIs(kind, m) {
    if (!m || !m.media) { return false; }
    return kind === "photo" ? isPhoto(m) : kind === "thumbs" ? isThumbDoc(m) : kind === "sub" ? isSubDoc(m) : (isVideoMsg(m) || isVideoDoc(m));
  }

  function describe(m, kind, msgs) {
    var d = m.media;
    var key = String(m.chat.id) + ":" + m.id;
    msgs[key] = m;
    return { key: key, chatId: String(m.chat.id), chatTitle: "", msgId: m.id, kind: kind, caption: m.text || "", fileName: (d && d.fileName) || "",
      duration: (d && d.duration) || 0, size: (d && d.fileSize) || 0, width: (d && d.width) || 0, height: (d && d.height) || 0, date: m.date ? m.date.getTime() : 0 };
  }

  /* Un filtro, de lo más nuevo a lo más viejo. stopAt: lectura incremental (ver arriba). */
  async function collect(client, target, filter, keep, kind, out, msgs, stopAt, onProgress) {
    var offset;
    var res;
    var n = 0;
    do {
      res = await client.searchMessages({ chatId: target, filter: filter, limit: 100, offset: offset });
      res.forEach(function (m) {
        if (keep(m) && !(stopAt && m.id <= stopAt)) { out.push(describe(m, typeof kind === "function" ? kind(m) : kind, msgs)); }
      });
      n += res.length;
      offset = res.next;
      if (onProgress) { onProgress(out.length); }
      if (stopAt && res.some(function (m) { return m.id <= stopAt; })) { break; }
    } while (res.length && offset !== undefined && n < MAX_PER_FILTER);
  }

  /* Los tres filtros (videos, documentos, fotos) A LA VEZ; si Telegram protesta, uno por uno como antes. */
  async function scanPeer(client, target, out, msgs, stopAt, onProgress) {
    var a = [];
    var b = [];
    var c = [];
    var count = function () { return a.length + b.length + c.length; };
    var prog = onProgress ? function () { onProgress(out.length + count()); } : null;
    try {
      await Promise.all([
        collect(client, target, VIDEO, isVideoMsg, "video", a, msgs, stopAt, prog),
        collect(client, target, DOCS, docKeep, docKind, b, msgs, stopAt, prog),
        collect(client, target, PHOTOS, isPhoto, "photo", c, msgs, stopAt, prog)
      ]);
    } catch (e) {
      a = []; b = []; c = [];
      await collect(client, target, VIDEO, isVideoMsg, "video", a, msgs, stopAt, prog);
      await collect(client, target, DOCS, docKeep, docKind, b, msgs, stopAt, prog);
      await collect(client, target, PHOTOS, isPhoto, "photo", c, msgs, stopAt, prog);
    }
    a.concat(b, c).forEach(function (it) { out.push(it); });
  }

  /* Vuelve a pedir los mensajes ya conocidos (de a 100, hasta 3 tandas a la vez): trae los objetos de Telegram, que no se pueden guardar,
   * y deja ver lo editado o borrado. Devuelve {gone: {clave: true}, updated: {clave: item}, ok} */
  /* getMessages que espera y reintenta si Telegram pone FLOOD_WAIT (antes un solo FLOOD_WAIT dejaba la lectura de fondo a medias:
   * los mensajes no se hidrataban y las portadas salían en blanco). */
  async function getBatch(client, peer, ids) {
    for (var n = 0; ; n += 1) {
      try {
        return await client.getMessages(peer, ids);
      } catch (e) {
        var t = String((e && (e.text || e.message)) || e);
        if (!/FLOOD/i.test(t) || n >= 4) { throw e; }
        await new Promise(function (ok) { setTimeout(ok, 6000 * (n + 1)); });
      }
    }
  }
  async function hydrate(client, targets, items, msgs) {
    var byChat = {};
    var gone = {};
    var updated = {};
    var ok = true;
    var jobs = [];
    var next = 0;
    items.forEach(function (it) { if (targets[it.chatId]) { (byChat[it.chatId] = byChat[it.chatId] || []).push(it); } });
    Object.keys(byChat).forEach(function (chat) {
      for (var i = 0; i < byChat[chat].length; i += BATCH) { jobs.push({ chat: chat, list: byChat[chat].slice(i, i + BATCH) }); }
    });
    async function worker() {
      var job;
      var res;
      while (next < jobs.length) {
        job = jobs[next];
        next += 1;
        try {
          res = await getBatch(client, targets[job.chat], job.list.map(function (it) { return it.msgId; }));
        } catch (e) {
          ok = false;
          continue;
        }
        job.list.forEach(function (it, i) {
          var m = res && res[i];
          var d;
          if (res && res.length === job.list.length && !m) { gone[it.key] = true; return; }
          if (!m) { return; }
          if (!stillIs(it.kind, m)) { gone[it.key] = true; return; }
          d = describe(m, it.kind, msgs);
          if (d.caption !== it.caption || d.size !== it.size || d.width !== it.width || d.height !== it.height || d.fileName !== it.fileName || d.duration !== it.duration) { updated[it.key] = d; }
        });
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return { gone: gone, updated: updated, ok: ok };
  }

  function catKey(meId, chatId) { return "cat:" + meId + ":" + chatId; }

  /* Lo guardado de un chat (o null): para pintarlo al abrir, antes de hablar con Telegram */
  function peek(meId, chatId) {
    return PrepCache.get(catKey(meId, chatId)).then(function (c) { return c && c.items && c.items.length ? c : null; }, function () { return null; });
  }

  function maxOf(items, chatId) {
    return items.reduce(function (n, it) { return String(it.chatId) === String(chatId) && (it.msgId || 0) > n ? it.msgId : n; }, 0);
  }

  /* opts: {client, peer (el chat actual: objeto de Telegram o su id), old (el grupo de antes, opcional), chatId, meId, full, msgs (se llena), onProgress}
   * → {items, mode: "completa" | "nuevos", nuevos, quitados, cambiados, hydrated, at} */
  async function refresh(opts) {
    var chatId = String(opts.chatId);
    var msgs = opts.msgs;
    var c = await peek(opts.meId, chatId);
    var inc = !!c && !opts.full && !!c.max && !!c.full && Date.now() - c.full < FULL_EVERY && c.items.length >= (c.n || 1) * 0.98;
    var out = [];
    var items;
    /* onlyIncremental: lo pide quien aún no conoce el grupo de antes (la revisión al abrir): una lectura completa saldría sin él */
    if (!inc && opts.onlyIncremental) { return null; }
    var res = { items: [], mode: inc ? "nuevos" : "completa", nuevos: 0, quitados: 0, cambiados: 0, hydrated: true, at: Date.now() };
    var targets = {};
    var h = null;
    var seen = {};
    if (inc) {
      targets[chatId] = opts.peer;
      if (opts.old) { targets[String(opts.old.id)] = opts.old; }
      var r = await Promise.all([
        scanPeer(opts.client, opts.peer, out, msgs, c.max, opts.onProgress),
        hydrate(opts.client, targets, c.items, msgs)
      ]);
      h = r[1];
      out.forEach(function (it) { seen[it.key] = true; });
      items = out.concat(c.items.filter(function (it) { return !seen[it.key] && !h.gone[it.key]; }).map(function (it) { return h.updated[it.key] || it; }));
      res.nuevos = out.length;
      res.quitados = Object.keys(h.gone).length;
      res.cambiados = Object.keys(h.updated).length;
      res.hydrated = h.ok;
    } else {
      await scanPeer(opts.client, opts.peer, out, msgs, 0, opts.onProgress);
      if (opts.old) {
        try { await scanPeer(opts.client, opts.old, out, msgs, 0, opts.onProgress); } catch (e) { /* el grupo de antes puede no verse: se sigue con el actual */ }
      }
      items = out;
      res.nuevos = out.length;
    }
    res.items = items;
    PrepCache.set(catKey(opts.meId, chatId), { items: items, max: maxOf(items, chatId), n: items.length, full: inc ? c.full : res.at, at: res.at });
    return res;
  }

  return { peek: peek, refresh: refresh, _: { stillIs: stillIs, describe: describe, hydrate: hydrate, scanPeer: scanPeer } };
}());
