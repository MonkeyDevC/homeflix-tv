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
  }

  function forgetCredentials() {
    window.localStorage.removeItem(STORE_KEY);
    client = null;
    starting = null;
  }

  function timeout(promise, ms, what) {
    return Promise.race([promise, new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error(what + ": sin respuesta en " + (ms / 1000) + " s")); }, ms);
    })]);
  }

  /* Conecta una sola vez (las llamadas siguientes reutilizan la misma promesa).
   * Primero en segundo plano (Worker); si en 15 s no conecta, directo en el hilo principal. */
  function start() {
    if (starting) {
      return starting;
    }
    starting = (async function () {
      var api = credentials();
      var r;
      if (!available()) {
        throw new Error("No se cargó el motor de Telegram (js/tg.bundle.js).");
      }
      if (!api) {
        throw new Error("Faltan las credenciales de la API de Telegram.");
      }
      r = await window.TGLib.create(api.id, api.hash, undefined, "hf-session");
      client = r.client;
      remake = r.reconnect || null;
      mode = r.mode;
      try {
        await timeout(client.connect(), 15000, "Conexión");
      } catch (e) {
        if (r.mode !== "worker") {
          throw e;
        }
        client = (await window.TGLib.create(api.id, api.hash, "direct", "hf-session")).client;
        remake = null;
        mode = "direct";
        await client.connect();
      }
      return client;
    })();
    starting.catch(function () { starting = null; });
    return starting;
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
    await start();
    try {
      return describeUser(await again(function () { return client.getMe(); }));
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

  async function logout() {
    try {
      await start();
      await client.logOut();
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
  var messages = {};
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
      res = await again(function () { return client.searchMessages({ chatId: Number(chatId), filter: filter, limit: 100, offset: offset }); });
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
  async function scan(chatId) {
    var out = [];
    await start();
    await collect(chatId, VIDEO, isVideoMsg, "video", out);
    await collect(chatId, DOCS, isVideoDoc, "video", out);
    await collect(chatId, PHOTOS, isPhotoWithCaption, "photo", out);
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

  /* Imagen para una tarjeta o ficha: portada que Telegram guarda del video, su miniatura, o la foto de la ficha.
   * Devuelve una URL blob: (se guarda en memoria) o null. */
  function image(key, want) {
    var cacheKey = key + "@" + want;
    if (!imageCache[cacheKey]) {
      imageCache[cacheKey] = (async function () {
        var m = await messageOf(key);
        var d = m && m.media;
        var t = null;
        var buf;
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
        return URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      })();
      imageCache[cacheKey].catch(function () { delete imageCache[cacheKey]; });
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

  return {
    source: source,
    available: available,
    credentials: credentials,
    validateCredentials: validateCredentials,
    saveCredentials: saveCredentials,
    forgetCredentials: forgetCredentials,
    start: start,
    me: me,
    loginQr: loginQr,
    logout: logout,
    qrSvg: qrSvg,
    dialogs: dialogs,
    videoCount: videoCount,
    scan: scan,
    image: image,
    messageOf: messageOf,
    rejectedApi: rejectedApi,
    mode: function () { return mode; }
  };
})();
