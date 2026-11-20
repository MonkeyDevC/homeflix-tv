/* HomeFlix · sincronizar entre dispositivos (TV, celular, web).
 *
 * Mi lista, el progreso, los perfiles (con su PIN), los chats de cada perfil y las etiquetas puestas desde la TV
 * viven en cada dispositivo (HFLibrary). Para que sean los mismos en todos, cada app los guarda en el servidor de
 * HomeFlix (https://scalvache.shop/productos/HomeFlix, contenedor «homeflix» del VPS) y combina lo de allá con lo
 * suyo quedándose con lo más reciente de cada cosa (HFLibrary.mergeSync).
 *
 * La cuenta en el servidor se identifica con una llave secreta: la primera app de la cuenta la crea y la guarda en
 * los Mensajes guardados de Telegram (homeflix-cuenta.json); las demás la leen de ahí. Así Telegram sigue siendo la
 * prueba de que es la misma persona, sin usuarios ni contraseñas nuevas. Lo que había antes en homeflix-sync.json
 * (Mensajes guardados) se pasa al servidor la primera vez.
 *
 * Cuándo:
 *   - al iniciar sesión y al volver a la app (como mucho una vez por minuto),
 *   - después de un cambio: Mi lista, perfiles o chats a los 4 s; el progreso, cada 60 s como mucho,
 *   - al salir o pasar a segundo plano, si quedó algo pendiente.
 * Cada escritura lleva la versión que se leyó: si otro dispositivo guardó antes, el servidor responde «conflicto»
 * con lo suyo, se combina y se vuelve a intentar. Dos dispositivos a la vez no se pisan.
 *
 *   HFSync.start()            empezar con la cuenta activa (después de iniciar sesión)
 *   HFSync.stop()             al cerrar sesión o cambiar de cuenta (guarda antes lo pendiente)
 *   HFSync.now()              forzar (botón «Actualizar»)
 *   HFSync.onRemote(fn)       fn() cuando llegaron cambios de otro dispositivo (para volver a pintar)
 *   HFSync.status()           {state: "off"|"idle"|"busy"|"error", at, error} */
var HFSync = (function () {
  "use strict";

  var SERVER = typeof hfServidor === "function" ? hfServidor() : String(window.HF_SYNC_URL || "https://scalvache.shop/productos/HomeFlix").replace(/\/+$/, "");

  var on = false;
  var account = "";
  var busy = false;
  var again = false;
  var timer = null;
  var due = 0;
  var lastPull = 0;
  var lastOk = 0;
  var lastError = "";
  var listeners = [];
  var hooked = false;

  var FAST = 4000;
  var SLOW = 60000;
  var PULL_EVERY = 60000;

  function same(a, b) {
    /* lo mismo salvo la fecha del documento */
    var x = Object.assign({}, a, { at: 0 });
    var y = Object.assign({}, b || {}, { at: 0 });
    return JSON.stringify(x) === JSON.stringify(y);
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { /* nada */ }
    });
  }

  function store(k, v) {
    try {
      if (v === undefined) { return window.localStorage.getItem(k); }
      if (v === null) { window.localStorage.removeItem(k); } else { window.localStorage.setItem(k, v); }
    } catch (e) { /* sin almacenamiento */ }
    return null;
  }

  /* ----- Este dispositivo (para que la consola sepa desde dónde se sincroniza) -----
   * Identidad completa; el servidor la guarda por cuenta (servidor/src/base.js, «IDENTIDAD DEL DISPOSITIVO»):
   *   tipo        tv (Samsung Tizen o Android TV) · android (APK de celular) · pc (navegador de computador) · web (navegador/PWA de celular o tablet)
   *   plataforma  tizen · androidtv · android · ios · ipados · windows · macos · linux · chromeos
   *   interfaz    tv · movil · pc   (cuál de las tres pantallas de HomeFlix usa)
   *   canal       tizen · androidtv · apk · pwa (instalada desde el navegador) · navegador · escritorio (app de PC, a futuro)
   *   navegador   «Chrome 131» (web y pc)    app: versión de HomeFlix    modelo: modelo de la TV, si se conoce
   * «Ver en la TV» lista los que pueden reproducir (tv y pc). Las apps viejas solo mandan id/tipo/nombre y siguen funcionando. */
  var entornoCache = null;

  function navegadorDe(ua) {
    var m;
    if ((m = /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua))) { return "Edge " + m[1]; }
    if ((m = /OPR\/(\d+)/.exec(ua))) { return "Opera " + m[1]; }
    if ((m = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua))) { return "Firefox " + m[1]; }
    if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) { return "Chrome " + m[1]; }
    if ((m = /Version\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari/.exec(ua))) { return "Safari " + m[1]; }
    return "";
  }

  function entorno() {
    var ua = navigator.userAgent || "";
    var tv = !!(window.tizen || window.HF_TV);
    var pc = document.documentElement.getAttribute("data-web") === "pc";
    var plataforma;
    var canal;
    var standalone = false;
    var e;
    if (entornoCache && entornoCache.pc === pc) { return entornoCache; }
    try { standalone = !!(navigator.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)); } catch (err) { standalone = false; }
    if (window.tizen) { plataforma = "tizen"; }
    else if (window.HF_TV) { plataforma = "androidtv"; }
    else if (window.HFAndroid) { plataforma = "android"; }
    else if (/iPhone|iPod/.test(ua)) { plataforma = "ios"; }
    else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)) { plataforma = "ipados"; }
    else if (/Android/.test(ua)) { plataforma = "android"; }
    else if (/CrOS/.test(ua)) { plataforma = "chromeos"; }
    else if (/Windows/.test(ua)) { plataforma = "windows"; }
    else if (/Macintosh|Mac OS X/.test(ua)) { plataforma = "macos"; }
    else if (/Linux|X11/.test(ua)) { plataforma = "linux"; }
    else { plataforma = ""; }
    canal = window.tizen ? "tizen" : window.HF_TV ? "androidtv" : window.HFAndroid ? "apk" : standalone ? "pwa" : "navegador";
    e = {
      pc: pc,
      tipo: tv ? "tv" : window.HFAndroid ? "android" : pc ? "pc" : "web",
      plataforma: plataforma,
      interfaz: tv ? "tv" : pc ? "pc" : "movil",
      canal: canal,
      navegador: tv || window.HFAndroid ? "" : navegadorDe(ua),
      app: typeof HF_VERSION !== "undefined" && HF_VERSION ? String(HF_VERSION) : ""
    };
    entornoCache = e;
    return e;
  }

  var SO_NOMBRE = { windows: "Windows", macos: "macOS", linux: "Linux", chromeos: "ChromeOS", ios: "iPhone", ipados: "iPad", android: "Android" };

  function device() {
    var id = store("hf.device");
    var e;
    var nombre;
    if (!id) {
      id = randomKey().slice(0, 16);
      store("hf.device", id);
    }
    e = entorno();
    if (e.tipo === "tv") { nombre = tvName(); }
    else if (e.tipo === "android") { nombre = "Android"; }
    else if (e.tipo === "pc") { nombre = (e.navegador ? e.navegador.split(" ")[0] : "Navegador") + " en " + (SO_NOMBRE[e.plataforma] || "computador"); }
    else { nombre = (SO_NOMBRE[e.plataforma] || "Navegador") + (e.canal === "pwa" ? " (app instalada)" : e.navegador ? " · " + e.navegador.split(" ")[0] : ""); }
    return {
      id: id, tipo: e.tipo, nombre: nombre, plataforma: e.plataforma, interfaz: e.interfaz, canal: e.canal,
      navegador: e.navegador, app: e.app, modelo: e.tipo === "tv" ? tvModel() : ""
    };
  }

  /* Lo que se manda en la dirección del canal en vivo (sin cabecera nueva: un servidor sin actualizar la ignora en lugar de rechazar la petición). */
  function deviceInfo() {
    var d = device();
    return { plataforma: d.plataforma, interfaz: d.interfaz, canal: d.canal, navegador: d.navegador, app: d.app, modelo: d.modelo };
  }

  /* «TV Samsung QN55Q65B»: así se reconoce en la lista de «Ver en la TV» del celular. */
  var tvNameCache = "";
  function tvName() {
    var m = "";
    if (tvNameCache) { return tvNameCache; }
    if (window.HF_TV && window.HFTV) {
      tvNameCache = "TV Android" + (window.HFTV.model() ? " " + window.HFTV.model() : "");
      return tvNameCache;
    }
    try { m = window.webapis && webapis.productinfo && webapis.productinfo.getRealModel ? webapis.productinfo.getRealModel() : ""; } catch (e) { m = ""; }
    if (!m) {
      try { m = tizen.systeminfo.getCapability("http://tizen.org/system/model_name"); } catch (e) { m = ""; }
    }
    tvNameCache = "TV Samsung" + (m ? " " + String(m).replace(/^Samsung\s*/i, "") : "");
    return tvNameCache;
  }

  /* El modelo a secas («QN55Q65B»), o vacío. */
  function tvModel() {
    var m = "";
    if (window.HF_TV && window.HFTV) { try { return String(window.HFTV.model() || ""); } catch (e) { return ""; } }
    try { m = window.webapis && webapis.productinfo && webapis.productinfo.getRealModel ? webapis.productinfo.getRealModel() : ""; } catch (e) { m = ""; }
    if (!m) { try { m = tizen.systeminfo.getCapability("http://tizen.org/system/model_name"); } catch (e) { m = ""; } }
    return String(m || "").replace(/^Samsung\s*/i, "");
  }

  function accountInfo() {
    var id = HFLibrary.accountId();
    var acc = (HFLibrary.accounts() || []).filter(function (a) { return String(a.id) === id; })[0] || {};
    return { id: id, nombre: acc.name || "", usuario: acc.username || "" };
  }

  /* ----- La llave de la cuenta ----- */
  function randomKey() {
    var b = new Uint8Array(32);
    window.crypto.getRandomValues(b);
    var s = "";
    for (var i = 0; i < b.length; i += 1) { s += String.fromCharCode(b[i]); }
    return window.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  var validKey = function (k) { return /^[A-Za-z0-9_-]{43,86}$/.test(String(k || "")); };

  /* La llave guardada en este dispositivo; si no hay, la de los Mensajes guardados; si tampoco, una nueva. */
  function accountKey(acc) {
    var cached = store("hf.synckey." + acc);
    if (validKey(cached)) { return Promise.resolve(cached); }
    return HFTelegram.keyRead().then(function (r) {
      if (r && r.data && validKey(r.data.key)) { return r.data.key; }
      var nueva = randomKey();
      return HFTelegram.keyWrite({ app: "homeflix", v: 1, servidor: SERVER, key: nueva }, r ? r.id : undefined)
        /* si otro dispositivo la creó al mismo tiempo, todos se quedan con la más antigua */
        .then(function () { return HFTelegram.keyRead(); })
        .then(function (r2) { return r2 && r2.data && validKey(r2.data.key) ? r2.data.key : nueva; });
    }).then(function (k) {
      if (HFLibrary.accountId() === acc) { store("hf.synckey." + acc, k); }
      return k;
    });
  }

  /* ----- El servidor ----- */
  function api(method, key, body) {
    var dev = device();
    return fetch(SERVER + "/api/v1/sync", {
      method: method,
      headers: Object.assign({ authorization: "Bearer " + key, "x-homeflix-dispositivo": dev.id }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    });
  }

  function failText(r) {
    if (r.status === 403) { return "Esta cuenta está bloqueada en el servidor de HomeFlix."; }
    if (r.status === 429) { return "Demasiados intentos; se reintenta en un momento."; }
    return "El servidor de HomeFlix respondió " + r.status + (r.data && r.data.error ? " (" + r.data.error + ")" : "");
  }

  /* Leer, combinar y, si este dispositivo tiene algo más nuevo, escribir. */
  function run() {
    var acc = HFLibrary.accountId();
    var key;
    var version = 0;
    var changed = false;
    if (!on || acc !== account) {
      return Promise.resolve();
    }
    if (busy) {
      again = true;
      return Promise.resolve();
    }
    busy = true;
    lastPull = Date.now();

    function save(attempt) {
      var local = HFLibrary.exportSync();
      return api("PUT", key, { version: version, doc: local, cuenta: accountInfo(), dispositivo: device() }).then(function (r) {
        if (r.status === 200) {
          return null;
        }
        if (r.status === 409 && attempt < 3 && HFLibrary.accountId() === acc) {
          /* otro dispositivo guardó antes: combinar con lo suyo y volver a intentar */
          version = r.data.version || 0;
          if (r.data.doc && HFLibrary.mergeSync(r.data.doc)) {
            notify();
          }
          return save(attempt + 1);
        }
        throw new Error(failText(r));
      });
    }

    return accountKey(acc).then(function (k) {
      key = k;
      return api("GET", key);
    }).then(function (r) {
      if (HFLibrary.accountId() !== acc) {
        return null;
      }
      if (r.status === 200) {
        version = r.data.version || 0;
        changed = HFLibrary.mergeSync(r.data.doc);
        if (changed) { notify(); }
        if (same(HFLibrary.exportSync(), r.data.doc)) {
          return null; // nada nuevo de este lado
        }
        return save(0);
      }
      if (r.status === 404) {
        /* cuenta nueva en el servidor: lo que hubiera en Mensajes guardados (antes del servidor) se trae primero */
        return HFTelegram.syncRead().then(function (old) {
          if (old && old.data && HFLibrary.mergeSync(old.data)) { notify(); }
        }, function () { /* sin archivo viejo */ }).then(function () { return save(0); });
      }
      throw new Error(failText(r));
    }).then(function () {
      lastOk = Date.now();
      lastError = "";
    }, function (e) {
      lastError = (e && (e.text || e.message)) || String(e);
      if (/Failed to fetch|NetworkError|Load failed/i.test(lastError)) {
        lastError = "Sin conexión con el servidor de HomeFlix";
      }
    }).then(function () {
      busy = false;
      if (again) {
        again = false;
        schedule(FAST);
      }
    });
  }

  function schedule(delay) {
    var at = Date.now() + delay;
    if (!on) {
      return;
    }
    if (timer && due <= at) {
      return; // ya hay una más pronto
    }
    clearTimeout(timer);
    due = at;
    timer = setTimeout(function () {
      timer = null;
      due = 0;
      run();
    }, delay);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      due = 0;
      run();
    }
  }

  function hook() {
    if (hooked) {
      return;
    }
    hooked = true;
    HFLibrary.onChange(function (kind) {
      schedule(kind === "progress" ? SLOW : FAST);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        flush();
      } else if (on && Date.now() - lastPull > PULL_EVERY) {
        run();
      }
    }, false);
    window.addEventListener("pagehide", flush, false);
  }

  /* ----- Dirección del servidor (js/config.js hfServidor) -----
   * setServidor(url): la guarda en este aparato y en el archivo de la cuenta en Telegram (homeflix-cuenta.json), así la TV
   * y los demás la toman solos al abrir. Solo se adopta lo que trae «servidorAt» (lo escribe esta función): el «servidor» que
   * venía en archivos viejos era el del VPS, que ya no existe. Rige al volver a abrir la app. */
  function setServidor(url) {
    var u = String(url || "").trim().replace(/\/+$/, "");
    if (typeof hfServidorValido === "function" && !hfServidorValido(u)) { return Promise.reject(new Error("direccion_invalida")); }
    var at = Date.now();
    store("hf.servidor", u);
    store("hf.servidor.at", String(at));
    return HFTelegram.keyRead().then(function (r) {
      if (!r || !r.data || !validKey(r.data.key)) { return null; }
      return HFTelegram.keyWrite(Object.assign({}, r.data, { servidor: u, servidorAt: at }), r.id);
    }).catch(function () { return null; }); // sin Telegram: queda solo en este aparato
  }

  var adoptado = false;
  function adoptarServidor() {
    if (adoptado || typeof HFTelegram === "undefined" || !HFTelegram.keyRead) { return; }
    adoptado = true;
    HFTelegram.keyRead().then(function (r) {
      var d = r && r.data;
      var local = Number(store("hf.servidor.at")) || 0;
      if (d && d.servidorAt && d.servidorAt > local && typeof hfServidorValido === "function" && hfServidorValido(d.servidor)) {
        store("hf.servidor", String(d.servidor).replace(/\/+$/, ""));
        store("hf.servidor.at", String(d.servidorAt));
      }
    }, function () { /* sin Telegram: sigue con el de este aparato */ });
  }

  function start() {
    hook();
    adoptarServidor();
    if (on && account === HFLibrary.accountId()) {
      if (Date.now() - lastPull > PULL_EVERY) {
        run();
      }
      return;
    }
    on = true;
    account = HFLibrary.accountId();
    lastPull = 0;
    run();
  }

  /* Deja de sincronizar; si quedaba algo por guardar, lo guarda antes (esperar la promesa antes de cerrar sesión). */
  function stop() {
    var last = timer ? (clearTimeout(timer), timer = null, run()) : Promise.resolve();
    return last.then(function () {
      on = false;
      account = "";
    });
  }

  return {
    start: start,
    stop: stop,
    now: function () { return run(); },
    onRemote: function (fn) { listeners.push(fn); },
    status: function () {
      return { state: !on ? "off" : busy ? "busy" : lastError ? "error" : "idle", at: lastOk, error: lastError };
    },
    server: SERVER,
    setServidor: setServidor,
    /* para «Ver en la TV» (js/remote.js): la misma llave y el mismo dispositivo que la sincronización */
    key: function () { return accountKey(HFLibrary.accountId()); },
    device: device,
    deviceInfo: deviceInfo
  };
})();
