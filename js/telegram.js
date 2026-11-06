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

  return {
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
    rejectedApi: rejectedApi,
    mode: function () { return mode; }
  };
})();
