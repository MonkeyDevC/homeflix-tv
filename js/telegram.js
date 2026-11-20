/* HomeFlix ↔ Telegram. Capa delgada sobre js/tg.bundle.js (mtcute en segundo plano, global TGLib).
 * Lógica de conexión y reconexión adaptada de app/js/tg.js de titlog/telegram-tizen (MIT).
 *
 * Credenciales de la API (my.telegram.org → API development tools). El usuario final no ve nada de esto:
 *   1. las guardadas en esta TV/navegador (formulario de respaldo: solo aparece si Telegram rechaza la clave incluida)
 *   2. js/config.local.js (solo en tu PC, no va al repo): var HF_TG_API = { id: 123456, hash: "..." };
 *   3. la clave del publicador incluida en el paquete (js/config.js, ofuscada)
 */
var HFTelegram = (function () {
  "use strict";

  var STORE_KEY = "hf.tgApi";
  var client = null;
  var remake = null;
  var mode = "";
  var reconnecting = null;
  var starting = null;
  var leaving = false;

  /* Varias cuentas de Telegram en la misma TV: cada una guarda su sesión en su propio almacén (IndexedDB)
   * y tiene su propio cliente. La cuenta principal usa "hf-session" (la de siempre).
   * useSlot() cambia la cuenta activa; los clientes ya abiertos se conservan para cambiar al instante. */
  var MAIN_SLOT = "hf-session";
  var slot = MAIN_SLOT;
  var sessions = {};
  var messages = {};

  function saveActive() {
    sessions[slot] = { client: client, remake: remake, mode: mode, starting: starting, reconnecting: reconnecting, messages: messages };
  }

  function useSlot(name) {
    var st;
    name = name || MAIN_SLOT;
    if (name === slot) {
      return;
    }
    saveActive();
    slot = name;
    st = sessions[name] || {};
    client = st.client || null;
    remake = st.remake || null;
    mode = st.mode || "";
    starting = st.starting || null;
    reconnecting = st.reconnecting || null;
    messages = st.messages || {};
  }

  function newSlotName() {
    return MAIN_SLOT + "-" + Date.now().toString(36);
  }

  /* Borra la sesión guardada de una cuenta que no es la principal (al quitarla o si se canceló al conectarla). */
  function forgetSlot(name) {
    if (!name || name === MAIN_SLOT) {
      return;
    }
    if (slot === name) {
      useSlot(MAIN_SLOT);
    }
    delete sessions[name];
    try {
      window.indexedDB.deleteDatabase(name);
    } catch (e) {
      /* nada */
    }
  }

  window.addEventListener("beforeunload", function () { leaving = true; });

  function available() {
    return typeof window.TGLib !== "undefined";
  }

  function credentials() {
    var raw;
    var saved;
    try {
      raw = window.localStorage.getItem(STORE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) {
      saved = null;
    }
    if (saved && saved.id && saved.hash) {
      return { id: saved.id, hash: saved.hash, from: "saved" };
    }
    if (window.HF_TG_API && window.HF_TG_API.id && window.HF_TG_API.hash) {
      return { id: Number(window.HF_TG_API.id), hash: String(window.HF_TG_API.hash), from: "config" };
    }
    if (window.HF_TG_API_PACKED) {
      saved = unpack(window.HF_TG_API_PACKED);
      if (saved) {
        return { id: saved.id, hash: saved.hash, from: "build" };
      }
    }
    return null;
  }

  /* Clave incluida en el paquete (js/config.js, la escribe tools/build-wgt.mjs): base64(sal de 8 bytes + "id:hash" con XOR). */
  function unpack(s) {
    var b;
    var out = "";
    var i;
    var j;
    var m;
    try {
      b = window.atob(s);
      for (i = 8; i < b.length; i += 1) {
        j = i - 8;
        out += String.fromCharCode(b.charCodeAt(i) ^ ((b.charCodeAt(j % 8) * 31 + j * 17 + 0x5a) & 0xff));
      }
      m = /^([1-9]\d{0,11}):([0-9a-f]{32})$/.exec(out);
      return m ? { id: Number(m[1]), hash: m[2] } : null;
    } catch (e) {
      return null;
    }
  }

  /* Devuelve un texto de error para mostrar en pantalla, o "" si los valores sirven. */
  function validateCredentials(idText, hashText) {
    var id = String(idText || "").replace(/\s+/g, "");
    var hash = String(hashText || "").replace(/\s+/g, "").toLowerCase();
    if (!/^\d{3,12}$/.test(id)) {
      return "El api_id son solo números (por ejemplo 1234567).";
    }
    if (!/^[0-9a-f]{32}$/.test(hash)) {
      return "El api_hash tiene 32 caracteres, solo números y letras de la a a la f.";
    }
    return "";
  }

  function saveCredentials(idText, hashText) {
    var value = {
      id: Number(String(idText).replace(/\s+/g, "")),
      hash: String(hashText).replace(/\s+/g, "").toLowerCase()
    };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
    client = null;
    starting = null;
    sessions = {};
  }

  function forgetCredentials() {
    window.localStorage.removeItem(STORE_KEY);
    client = null;
    starting = null;
    sessions = {};
  }

  function timeout(promise, ms, what) {
    return Promise.race([promise, new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error(what + ": sin respuesta en " + (ms / 1000) + " s")); }, ms);
    })]);
  }

  /* Conecta una sola vez (las llamadas siguientes reutilizan la misma promesa).
   * Primero en segundo plano (Worker); si en 15 s no conecta, directo en el hilo principal. */
  function start() {
    var mine = slot;
    var p;
    if (starting) {
      return starting;
    }
    /* Lo creado se guarda en la cuenta que lo pidió (mine), aunque mientras tanto se haya cambiado de cuenta. */
    function put(c, rm, md) {
      if (slot === mine) {
        client = c;
        remake = rm;
        mode = md;
      } else {
        sessions[mine] = sessions[mine] || {};
        sessions[mine].client = c;
        sessions[mine].remake = rm;
        sessions[mine].mode = md;
      }
    }
    p = (async function () {
      var api = credentials();
      var r;
      var c;
      if (!available()) {
        throw new Error("No se cargó el motor de Telegram (js/tg.bundle.js).");
      }
      if (!api) {
        throw new Error("Faltan las credenciales de la API de Telegram.");
      }
      r = await window.TGLib.create(api.id, api.hash, undefined, mine);
      c = r.client;
      put(c, r.reconnect || null, r.mode);
      try {
        await timeout(c.connect(), 15000, "Conexión");
      } catch (e) {
        if (r.mode !== "worker") {
          throw e;
        }
        c = (await window.TGLib.create(api.id, api.hash, "direct", mine)).client;
        put(c, null, "direct");
        await c.connect();
      }
      return c;
    })();
    starting = p;
    p.catch(function () {
      if (slot === mine) {
        if (starting === p) {
          starting = null;
        }
      } else if (sessions[mine] && sessions[mine].starting === p) {
        sessions[mine].starting = null;
      }
    });
    return p;
  }

  /* El Worker invalida la conexión si la app pasa más de un minuto en segundo plano: reconectar en el mismo Worker y reintentar. */
  function gone(e) {
    return /Worker connection (expired|closed)/.test(String(e && e.message));
  }

  function reconnect() {
    if (!reconnecting) {
      reconnecting = (async function () {
        client = remake();
        await client.connect();
      })();
      reconnecting.then(function () { reconnecting = null; }, function () { reconnecting = null; });
    }
    return reconnecting;
  }

  async function again(fn) {
    try {
      return await fn();
    } catch (e) {
      if (!remake || !gone(e)) {
        throw e;
      }
      await reconnect();
      return await fn();
    }
  }

  function signedOut(e) {
    return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(String(e && e.message));
  }

  function rejectedApi(e) {
    return /API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(String(e && e.message));
  }

  function describeUser(u) {
    if (!u) {
      return null;
    }
    return {
      id: u.id,
      name: u.displayName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "Telegram",
      username: u.username || ""
    };
  }

  /* Usuario con sesión iniciada, o null si todavía no hay sesión. */
  async function me() {
    var c = await start();
    try {
      return describeUser(await again(function () { return c.getMe(); }));
    } catch (e) {
      if (signedOut(e)) {
        return null;
      }
      throw e;
    }
  }

  /* Inicio de sesión con QR.
   * opts.onUrl(url, expires)   cada vez que cambia el código (unos 30 s)
   * opts.onScanned()           el teléfono ya lo escaneó
   * opts.askPassword()         → Promise<string>, solo si la cuenta tiene verificación en dos pasos
   * opts.onBadPassword()       la contraseña no era correcta
   * opts.signal                AbortSignal para cancelar (al salir de la pantalla) */
  async function loginQr(opts) {
    var tries;
    await start();
    for (tries = 0; ; tries += 1) {
      try {
        return describeUser(await client.signInQr({
          onUrlUpdated: opts.onUrl,
          onQrScanned: opts.onScanned,
          password: opts.askPassword,
          invalidPasswordCallback: opts.onBadPassword,
          abortSignal: opts.signal
        }));
      } catch (e) {
        if (opts.signal && opts.signal.aborted) {
          throw e;
        }
        if (!leaving && tries < 3 && signedOut(e)) {
          continue;
        }
        if (leaving || !remake || tries >= 3 || !gone(e)) {
          throw e;
        }
        await reconnect();
      }
    }
  }

  /* Inicio de sesión con número y código (el celular no puede escanear su propio QR). Tres pasos:
   *   sendCode("+573001234567")            → {hash, via: "app"|"sms"|"call"|…, length, timeout}
   *   signInCode(phone, hash, "12345")     → {user} o {password: true, hint} si la cuenta tiene verificación en dos pasos
   *   signInPassword("…")                  → user
   * Los errores salen con su código de Telegram en e.message (PHONE_NUMBER_INVALID, PHONE_CODE_INVALID,
   * PHONE_CODE_EXPIRED, PASSWORD_HASH_INVALID, FLOOD_WAIT_n…): loginError(e) los traduce. */
  function codeVia(type) {
    var t = String((type && (type._ || type.type)) || type || "").toLowerCase();
    return /app/.test(t) ? "app" : /sms/.test(t) ? "sms" : /call/.test(t) ? "call" : /flash/.test(t) ? "flash" : /email/.test(t) ? "email" : t || "app";
  }

  async function sendCode(phone) {
    var c = await start();
    var r = await again(function () { return c.sendCode({ phone: phone }); });
    return { hash: r.phoneCodeHash, via: codeVia(r.type), length: r.length || 5, timeout: r.timeout || 0, next: codeVia(r.nextType) };
  }

  async function resendCode(phone, hash) {
    var c = await start();
    var r = await again(function () { return c.resendCode({ phone: phone, phoneCodeHash: hash }); });
    return { hash: r.phoneCodeHash, via: codeVia(r.type), length: r.length || 5, timeout: r.timeout || 0, next: codeVia(r.nextType) };
  }

  function needsPassword(e) {
    return /SESSION_PASSWORD_NEEDED/.test((e && (e.text || e.message)) || "");
  }

  async function passwordHint() {
    var c = await start();
    try {
      var p = await c.call({ _: "account.getPassword" });
      return (p && p.hint) || "";
    } catch (e) {
      return "";
    }
  }

  async function signInCode(phone, hash, code) {
    var c = await start();
    try {
      return { user: describeUser(await c.signIn({ phone: phone, phoneCodeHash: hash, phoneCode: String(code) })) };
    } catch (e) {
      if (needsPassword(e)) {
        return { password: true, hint: await passwordHint() };
      }
      throw e;
    }
  }

  async function signInPassword(password) {
    var c = await start();
    return describeUser(await c.checkPassword(password));
  }

  /* Mensaje en español para los errores de inicio de sesión. */
  function loginError(e) {
    var m = String((e && (e.text || e.message)) || e || "");
    var flood = /FLOOD_WAIT_(\d+)/.exec(m);
    if (flood) {
      return "Telegram pide esperar " + (Number(flood[1]) > 90 ? Math.ceil(Number(flood[1]) / 60) + " minutos" : flood[1] + " segundos") + " antes de intentar de nuevo.";
    }
    if (/PHONE_NUMBER_INVALID|PHONE_NUMBER_BANNED/.test(m)) { return "Ese número no es válido para Telegram. Revisa el indicativo y el número."; }
    if (/PHONE_NUMBER_UNOCCUPIED/.test(m)) { return "Ese número no tiene cuenta de Telegram."; }
    if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(m)) { return "El código no es correcto. Revísalo e inténtalo de nuevo."; }
    if (/PHONE_CODE_EXPIRED/.test(m)) { return "El código venció. Pide uno nuevo."; }
    if (/PASSWORD_HASH_INVALID/.test(m)) { return "La contraseña no es correcta."; }
    if (/network|timeout|Conexi|ECONN|WebSocket/i.test(m)) { return "No hay conexión con Telegram. Revisa tu internet."; }
    return "Telegram respondió: " + m;
  }

  /* ===== Datos sincronizados entre dispositivos =====
   * Un archivo homeflix-sync.json en los Mensajes guardados de la cuenta (privado, sin servidor propio).
   * syncRead() → {id, data} o null si todavía no existe; syncWrite(obj, id) lo crea o lo reemplaza y devuelve el id. */
  var SYNC_FILE = "homeflix-sync.json";
  var SYNC_TAG = "#homeflix_sync";
  var SYNC_CAPTION = "HomeFlix guarda aquí Mi lista, el progreso y los perfiles para tenerlos en la TV y el celular. " + SYNC_TAG + "\nNo lo borres ni lo reenvíes.";

  async function syncFind(c) {
    var res = await again(function () { return c.searchMessages({ chatId: "me", query: "homeflix_sync", filter: DOCS, limit: 10 }); });
    var found = null;
    res.forEach(function (m) {
      if (!found && m.media && m.media.fileName === SYNC_FILE) {
        found = m;
      }
    });
    return found;
  }

  async function syncRead() {
    var c = await start();
    var m = await syncFind(c);
    var buf;
    if (!m) {
      return null;
    }
    buf = await again(function () { return c.downloadAsBuffer(m.media); });
    try {
      return { id: m.id, data: JSON.parse(new TextDecoder().decode(buf)) };
    } catch (e) {
      return { id: m.id, data: null }; // archivo dañado: se reemplaza con lo de este dispositivo
    }
  }

  async function syncWrite(obj, id) {
    var c = await start();
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var media = { type: "document", file: bytes, fileName: SYNC_FILE, fileMime: "application/json" };
    var m;
    if (id) {
      try {
        m = await again(function () { return c.editMessage({ chatId: "me", message: id, media: media, text: SYNC_CAPTION }); });
        return m && m.id ? m.id : id;
      } catch (e) {
        if (!/MESSAGE_ID_INVALID|MESSAGE_EDIT_TIME_EXPIRED|not found/i.test((e && (e.text || e.message)) || "")) {
          throw e;
        }
        /* lo borraron: se crea de nuevo */
      }
    }
    m = await again(function () { return c.sendMedia("me", Object.assign({ caption: SYNC_CAPTION }, media)); });
    return m.id;
  }

  async function logout() {
    /* start() se llama en el acto: cierra la sesión de la cuenta activa en este momento, aunque luego se cambie de cuenta */
    var p = start();
    try {
      await (await p).logOut();
    } catch (e) {
      /* si ya no había sesión, no importa */
    }
  }

  function qrSvg(url, cell) {
    return window.TGLib.qrSvg(url, cell);
  }

  /* ===== Chats y videos ===== */

  var VIDEO = { _: "inputMessagesFilterVideo" };
  var DOCS = { _: "inputMessagesFilterDocument" };
  var PHOTOS = { _: "inputMessagesFilterPhotos" };
  /* MKV y MP4 enviados "como archivo" no salen en el filtro de videos de Telegram. */
  var VIDEO_EXT = /\.(mkv|webm|mp4|m4v|mov)$/i;
  var VIDEO_MIME = /^video\/(x-matroska|webm|mp4|quicktime|x-m4v)$/i;
  var MAX_PER_FILTER = 3000;
  var imageCache = {};

  function isVideoMsg(m) {
    var d = m.media;
    return !!d && d.type === "video" && !d.isRound && !d.isAnimation;
  }

  function isVideoDoc(m) {
    var d = m.media;
    return !!d && d.type === "document" && (VIDEO_EXT.test(d.fileName || "") || VIDEO_MIME.test(d.mimeType || ""));
  }

  function isPhotoWithCaption(m) {
    return !!m.media && m.media.type === "photo" && !!(m.text && m.text.indexOf("#") >= 0);
  }

  function chatKind(p) {
    if (p.isSelf) { return "saved"; }
    if (p.type === "user") { return p.isBot ? "bot" : "user"; }
    return p.chatType === "channel" ? "channel" : "group";
  }

  /* Todos los chats de la cuenta (sin archivados), "Mensajes guardados" primero. */
  async function dialogs(limit) {
    await start();
    return again(async function () {
      var out = [];
      var d;
      var p;
      for await (d of client.iterDialogs({ limit: limit || 300, archived: "exclude" })) {
        p = d.peer;
        out.push({
          id: String(p.id),
          title: p.isSelf ? "Mensajes guardados" : (p.title || p.displayName || String(p.id)),
          kind: chatKind(p)
        });
      }
      out.sort(function (a, b) { return (a.kind === "saved" ? -1 : 0) - (b.kind === "saved" ? -1 : 0); });
      return out;
    });
  }

  /* Cuántos videos tiene un chat (rápido: pide 1 mensaje y lee el total). */
  async function videoCount(chatId) {
    var res = await again(function () { return client.searchMessages({ chatId: Number(chatId), filter: VIDEO, limit: 1 }); });
    return res.total || res.length || 0;
  }

  function describe(m, kind) {
    var d = m.media;
    var key = String(m.chat.id) + ":" + m.id;
    messages[key] = m;
    return {
      key: key,
      chatId: String(m.chat.id),
      chatTitle: (m.chat && (m.chat.title || m.chat.displayName)) || "",
      msgId: m.id,
      kind: kind,
      caption: m.text || "",
      fileName: (d && d.fileName) || "",
      duration: (d && d.duration) || 0,
      size: (d && d.fileSize) || 0,
      width: (d && d.width) || 0,
      height: (d && d.height) || 0,
      date: m.date ? m.date.getTime() : 0
    };
  }

  async function collect(chatId, filter, keep, kind, out) {
    var offset;
    var res;
    var n = 0;
    do {
      res = await again(function () { return client.searchMessages({ chatId: typeof chatId === "object" ? chatId : Number(chatId), filter: filter, limit: 100, offset: offset }); });
      res.forEach(function (m) {
        if (keep(m)) {
          out.push(describe(m, kind));
        }
      });
      n += res.length;
      offset = res.next;
    } while (res.length && offset !== undefined && n < MAX_PER_FILTER);
  }

  /* Todos los videos (y fotos-ficha) de un chat, con su comentario. */
  async function scanOne(peer, out) {
    await collect(peer, VIDEO, isVideoMsg, "video", out);
    await collect(peer, DOCS, isVideoDoc, "video", out);
    await collect(peer, PHOTOS, isPhotoWithCaption, "photo", out);
  }

  /* Cuando a un grupo se le cambian ciertas opciones (administradores, historial visible…), Telegram lo pasa a
   * supergrupo: el grupo de antes queda congelado con lo viejo y lo nuevo va al supergrupo, que tiene otro id.
   * Devuelve el supergrupo (como peer de entrada, con su access hash) o null si el chat no se migró. */
  async function migratedTo(chatId) {
    var n = Number(chatId);
    var chat;
    var to;
    if (!(n < 0 && n > -1000000000000)) {
      return null; // solo los grupos básicos se migran (los supergrupos y canales empiezan por -100…)
    }
    try {
      chat = await again(function () { return client.getChat(n); });
      to = chat && chat.raw && chat.raw.migratedTo;
      if (to && to.channelId) {
        return { _: "inputPeerChannel", channelId: to.channelId, accessHash: to.accessHash };
      }
    } catch (e) { /* sin acceso al grupo viejo: se lee solo lo que se pueda */ }
    return null;
  }

  /* Todos los videos (y fotos-ficha) de un chat, con su comentario. Si el grupo se pasó a supergrupo, se leen los dos
   * y todo cuenta como el mismo chat (así los perfiles que lo tenían elegido no tienen que volver a elegirlo). */
  async function scan(chatId) {
    var out = [];
    var more = [];
    var moved;
    await start();
    await scanOne(chatId, out);
    moved = await migratedTo(chatId);
    if (moved) {
      await scanOne(moved, more);
      more.forEach(function (it) { it.chatId = String(chatId); });
      out = out.concat(more);
    }
    return out;
  }

  /* El mensaje de un item: en memoria si ya se revisó el chat; si no, se pide a Telegram. */
  async function messageOf(key) {
    var parts;
    var ms;
    if (messages[key]) {
      return messages[key];
    }
    parts = key.split(":");
    ms = await again(function () { return client.getMessages(Number(parts[0]), [Number(parts[1])]); });
    if (ms && ms[0]) {
      messages[key] = ms[0];
    }
    return messages[key] || null;
  }

  function pickThumb(list, want) {
    var best = null;
    (list || []).forEach(function (t) {
      if (!t.width || t.isVideo || t.type === "i" || t.type === "j") {
        return;
      }
      if (!best || Math.abs(t.width - want) < Math.abs(best.width - want)) {
        best = t;
      }
    });
    return best;
  }

  /* ----- Caché de miniaturas en la TV (IndexedDB) -----
   * Cada miniatura descargada se guarda en este dispositivo; al volver a entrar se lee de aquí, sin pedirla a Telegram.
   * Se guardan hasta IMG_MAX; al pasarse se borran las que hace más tiempo no se usan. */
  var IMG_DB = "hf-images";
  var IMG_STORE = "img";
  var IMG_MAX = 1500;
  var imgDbPromise = null;
  var imgPuts = 0;
  var imageUrls = {};

  function imgDb() {
    if (!imgDbPromise) {
      imgDbPromise = new Promise(function (resolve) {
        var req;
        try {
          req = window.indexedDB.open(IMG_DB, 1);
        } catch (e) {
          resolve(null);
          return;
        }
        req.onupgradeneeded = function () {
          var st = req.result.createObjectStore(IMG_STORE);
          st.createIndex("at", "at");
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      });
    }
    return imgDbPromise;
  }

  function imgGet(key) {
    return imgDb().then(function (db) {
      if (!db) {
        return null;
      }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IMG_STORE, "readwrite");
          var st = tx.objectStore(IMG_STORE);
          var req = st.get(key);
          req.onsuccess = function () {
            var v = req.result;
            if (v && v.b) {
              /* marcar como usada recién (para el recorte por antigüedad), sin esperar */
              if (Date.now() - (v.at || 0) > 86400000) {
                v.at = Date.now();
                st.put(v, key);
              }
              resolve(v.b);
            } else {
              resolve(null);
            }
          };
          req.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  function imgPrune(db) {
    try {
      var tx = db.transaction(IMG_STORE, "readwrite");
      var st = tx.objectStore(IMG_STORE);
      var countReq = st.count();
      countReq.onsuccess = function () {
        var extra = countReq.result - IMG_MAX;
        if (extra <= 0) {
          return;
        }
        extra += 100;
        st.index("at").openCursor().onsuccess = function (ev) {
          var cur = ev.target.result;
          if (cur && extra > 0) {
            cur.delete();
            extra -= 1;
            cur.continue();
          }
        };
      };
    } catch (e) {
      /* nada */
    }
  }

  function imgPut(key, bytes) {
    imgDb().then(function (db) {
      if (!db) {
        return;
      }
      try {
        db.transaction(IMG_STORE, "readwrite").objectStore(IMG_STORE).put({ b: bytes, at: Date.now() }, key);
      } catch (e) {
        return;
      }
      imgPuts += 1;
      if (imgPuts % 50 === 0) {
        imgPrune(db);
      }
    });
  }

  function toUrl(bytes) {
    return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  }

  /* La URL de una miniatura que ya está lista en memoria (para pintarla al instante al redibujar), o null. */
  function imageReady(key, want) {
    return imageUrls[key + "@" + want] || null;
  }

  /* Imagen para una tarjeta o ficha: portada que Telegram guarda del video, su miniatura, o la foto de la ficha.
   * Primero se busca en la caché de la TV; si no está, se descarga de Telegram y se guarda.
   * Devuelve una URL blob: (se guarda en memoria) o null. */
  function image(key, want) {
    var cacheKey = key + "@" + want;
    if (!imageCache[cacheKey]) {
      imageCache[cacheKey] = (async function () {
        var saved = await imgGet(cacheKey);
        var m;
        var d;
        var t = null;
        var buf;
        if (saved) {
          return toUrl(saved);
        }
        m = await messageOf(key);
        d = m && m.media;
        if (!d) {
          return null;
        }
        if (d.type === "photo") {
          t = pickThumb(d.thumbnails, want);
        } else {
          t = (d.videoCover && pickThumb(d.videoCover.thumbnails, want)) || pickThumb(d.thumbnails, want);
        }
        if (!t) {
          return null;
        }
        buf = await again(function () { return client.downloadAsBuffer(t); });
        imgPut(cacheKey, buf.slice ? buf.slice(0) : buf);
        return toUrl(buf);
      })();
      imageCache[cacheKey].then(function (url) {
        if (url) {
          imageUrls[cacheKey] = url;
        }
      }, function () { delete imageCache[cacheKey]; });
    }
    return imageCache[cacheKey];
  }

  /* Fuente de datos para el reproductor (js/engine/player.js): {size, stream(offset, signal, throttle) → {start, iter}}.
   * Telegram entrega bloques de 512 KB alineados; mtcute descarga en segundo plano y el reproductor frena con throttle.
   * Adaptado de source() en app/js/tg.js de titlog/telegram-tizen (MIT). */
  async function source(key) {
    var m = await messageOf(key);
    var CH = 512 * 1024;
    var size;
    if (!m || !m.media) {
      throw new Error("No se encontró el video en Telegram (¿lo borraron del chat?)");
    }
    size = m.media.fileSize || 0;

    /* Si falla a mitad de camino: conexión vencida → reconectar; referencia de archivo vencida → pedir el mensaje otra vez.
     * Después se relanza el error y el reproductor reintenta con la conexión o la referencia nuevas. */
    async function* guard(it) {
      var e2;
      var ms;
      try {
        for await (var c of it) {
          yield c;
        }
      } catch (e) {
        e2 = e;
        if (remake && gone(e) && !leaving) {
          await reconnect();
          throw e;
        }
        if (/FILE_REFERENCE|File ref/i.test(String(e && (e.message || e.text)))) {
          ms = await again(function () { return client.getMessages(m.chat.id, [m.id]); });
          if (ms && ms[0] && ms[0].media) {
            m = ms[0];
            messages[key] = m;
          }
        }
        throw e2;
      }
    }

    return {
      size: size,
      stream: function (offset, signal, throttle) {
        var start = Math.floor(offset / CH) * CH;
        return {
          start: start,
          iter: guard(client.downloadAsIterable(m.media, { offset: start, fileSize: size, partSize: 512, abortSignal: signal, throttle: throttle }))
        };
      }
    };
  }

  /* Al abrir la app: borra las sesiones de cuentas que ya no están conectadas (por ejemplo, si se canceló al conectarla). */
  function cleanupSlots(keep) {
    try {
      if (!window.indexedDB || !window.indexedDB.databases) {
        return;
      }
      window.indexedDB.databases().then(function (list) {
        (list || []).forEach(function (d) {
          if (d.name && d.name.indexOf(MAIN_SLOT + "-") === 0 && keep.indexOf(d.name) < 0 && !sessions[d.name] && d.name !== slot) {
            window.indexedDB.deleteDatabase(d.name);
          }
        });
      }, function () {});
    } catch (e) {
      /* nada */
    }
  }

  return {
    cleanupSlots: cleanupSlots,
    source: source,
    available: available,
    credentials: credentials,
    validateCredentials: validateCredentials,
    saveCredentials: saveCredentials,
    forgetCredentials: forgetCredentials,
    start: start,
    me: me,
    loginQr: loginQr,
    sendCode: sendCode,
    resendCode: resendCode,
    signInCode: signInCode,
    signInPassword: signInPassword,
    loginError: loginError,
    syncRead: syncRead,
    syncWrite: syncWrite,
    logout: logout,
    qrSvg: qrSvg,
    dialogs: dialogs,
    videoCount: videoCount,
    scan: scan,
    image: image,
    imageReady: imageReady,
    messageOf: messageOf,
    rejectedApi: rejectedApi,
    mode: function () { return mode; },
    useSlot: useSlot,
    slot: function () { return slot; },
    MAIN_SLOT: MAIN_SLOT,
    newSlotName: newSlotName,
    forgetSlot: forgetSlot
  };
})();
