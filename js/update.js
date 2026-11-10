/* HomeFlix · actualizaciones (TV y celular). El canal es el servidor de HomeFlix en el VPS:
 *   GET https://scalvache.shop/productos/HomeFlix/actualizaciones/v1   → la versión vigente (actual.json)
 *   GET …/actualizaciones/archivos/<v>/<archivo>                       → la interfaz (web-<v>.json), el .wgt, el .apk
 *
 * Dos clases de actualización:
 *   - Interfaz (lo que más cambia: pantallas, motor, arreglos): se baja y se usa al reiniciar la app, sin reinstalar.
 *     TV: se guarda en este aparato (IndexedDB) y la carga js/arranque.js. Celular: la guarda el APK (HFAndroid.ota*).
 *     Si la versión nueva no llega a arrancar, la siguiente vez se vuelve sola a la instalada.
 *   - Programa (el .wgt o el .apk): solo cuando la interfaz nueva necesita un programa más nuevo (web.nativoMinimo).
 *     Celular: se baja el APK y se abre el instalador de Android. TV: se avisa para reinstalar con Apps2Samsung.
 *
 *   HFUpdate.check()          → Promise {hay, version, notas, fecha, programa: bool, manifest}
 *   HFUpdate.install(m, fn)   baja e instala la interfaz (fn({got, total})); al terminar, HFUpdate.restart()
 *   HFUpdate.installNative(m) celular: baja el APK y abre el instalador
 *   HFUpdate.ok()             la app arrancó bien con esta interfaz (la deja como buena)
 *   HFUpdate.current()        {web, programa, plataforma, ota}
 *   HFUpdate.auto(fn)         revisa al abrir la app (y como mucho cada 30 min mientras sigue abierta) y llama fn(info) si hay algo nuevo */
var HFUpdate = (function () {
  "use strict";

  var SERVER = String(window.HF_SYNC_URL || "https://scalvache.shop/productos/HomeFlix").replace(/\/+$/, "");
  var android = window.HFAndroid || null;
  var LS_LAST = "hf.update.last";
  var LS_OTA = "hf.ota";
  var DB = "hf-ota";

  function store(k, v) {
    try {
      if (v === undefined) { return window.localStorage.getItem(k); }
      if (v === null) { window.localStorage.removeItem(k); } else { window.localStorage.setItem(k, v); }
    } catch (e) { /* sin almacenamiento */ }
    return null;
  }

  /* «1.10.2» > «1.9.9» */
  function cmp(a, b) {
    var x = String(a || "0").split(".");
    var y = String(b || "0").split(".");
    for (var i = 0; i < Math.max(x.length, y.length); i += 1) {
      var d = (Number(x[i]) || 0) - (Number(y[i]) || 0);
      if (d) { return d > 0 ? 1 : -1; }
    }
    return 0;
  }

  function platform() { return window.tizen ? "tv" : android ? "android" : "web"; }

  function nativeVersion() {
    try {
      if (window.tizen) { return tizen.application.getAppInfo().version || ""; }
      if (android && android.version) { return android.version(); }
    } catch (e) { /* sin dato */ }
    return "";
  }

  function current() {
    var ota = null;
    try { ota = JSON.parse(store(LS_OTA) || "null"); } catch (e) { ota = null; }
    return { web: typeof HF_VERSION !== "undefined" ? HF_VERSION : "", programa: nativeVersion(), plataforma: platform(), ota: ota };
  }

  function getJson(url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.timeout = 20000;
      x.onload = function () {
        if (x.status === 404) { resolve(null); return; }
        if (x.status !== 200) { reject(new Error("El servidor respondió " + x.status)); return; }
        try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(new Error("Respuesta dañada")); }
      };
      x.onerror = function () { reject(new Error("Sin conexión con el servidor de HomeFlix")); };
      x.ontimeout = x.onerror;
      x.send();
    });
  }

  function fileUrl(m, f) { return SERVER + "/actualizaciones/archivos/" + encodeURIComponent(m.version) + "/" + encodeURIComponent(f.archivo); }

  function check() {
    return getJson(SERVER + "/actualizaciones/v1?t=" + Date.now()).then(function (m) {
      var cur = current();
      store(LS_LAST, String(Date.now()));
      if (!m || !m.version) { return { hay: false }; }
      var plat = cur.plataforma;
      var min = m.web && m.web.nativoMinimo ? m.web.nativoMinimo[plat] : "";
      /* el programa (.apk/.wgt) solo hace falta si la interfaz nueva lo pide (nativoMinimo) */
      var necesita = !!(min && cur.programa && cmp(cur.programa, min) < 0);
      /* una interfaz que ya se probó y no arrancó («mala») no se vuelve a ofrecer: se espera a la siguiente */
      var mala = !!(cur.ota && cur.ota.estado === "mala" && cmp(cur.ota.version, m.version) >= 0);
      var webNueva = cmp(m.version, cur.web) > 0 && !mala;
      return {
        hay: webNueva || necesita,
        web: webNueva && !necesita && !!m.web,
        programa: necesita,
        version: m.version, notas: m.notas || "", fecha: m.fecha || "", manifest: m
      };
    });
  }

  /* ----- TV: la interfaz se guarda en IndexedDB y la usa js/arranque.js ----- */
  function idb() {
    return new Promise(function (resolve, reject) {
      var r = window.indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("web"); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function idbPut(key, val) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("web", "readwrite");
        tx.objectStore("web").put(val, key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function downloadText(url, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.onprogress = function (e) { if (onProgress) { onProgress({ got: e.loaded, total: e.total || 0 }); } };
      x.onload = function () { if (x.status === 200) { resolve(x.responseText); } else { reject(new Error("No se pudo bajar la actualización (" + x.status + ")")); } };
      x.onerror = function () { reject(new Error("Sin conexión con el servidor de HomeFlix")); };
      x.send();
    });
  }

  function install(m, onProgress) {
    var plat = platform();
    var url = fileUrl(m, m.web);
    if (plat === "android") {
      if (!android || !android.otaInstalar) { return Promise.reject(new Error("Esta versión del programa no puede actualizarse sola: instala el APK nuevo.")); }
      android.otaInstalar(url, m.version, m.web.bytes || 0);
      return new Promise(function (resolve, reject) {
        var t = setInterval(function () {
          var st = {};
          try { st = JSON.parse(android.otaEstado() || "{}"); } catch (e) { st = {}; }
          if (onProgress) { onProgress({ got: st.got || 0, total: st.total || m.web.bytes || 0 }); }
          if (st.estado === "listo") {
            clearInterval(t);
            /* el APK decide qué interfaz abre; aquí solo se anota para saber, al volver a abrir, si arrancó (ok()) */
            store(LS_OTA, JSON.stringify({ version: m.version, estado: "nueva", intentos: 0, at: Date.now() }));
            resolve();
          }
          if (st.estado === "error") { clearInterval(t); reject(new Error(st.error || "No se pudo instalar la actualización")); }
        }, 400);
      });
    }
    if (plat !== "tv") { return Promise.resolve(); } // en el navegador siempre se ve lo último del servidor web
    return downloadText(url, onProgress).then(function (text) {
      var b = JSON.parse(text);
      if (!b || b.app !== "homeflix-web" || b.version !== m.version || !b.files || !b.files["app.html"]) { throw new Error("La actualización llegó dañada"); }
      return idbPut("bundle", b).then(function () {
        store(LS_OTA, JSON.stringify({ version: b.version, estado: "nueva", intentos: 0, at: Date.now() }));
      });
    });
  }

  function installNative(m) {
    if (platform() === "android" && android && android.apkInstalar && m.apk) {
      android.apkInstalar(fileUrl(m, m.apk));
      return true;
    }
    return false;
  }

  function restart() {
    if (android && android.otaActivar) {
      try { android.otaActivar(); } catch (e) { /* recarga igual */ }
      var o = current().ota;
      if (o && o.estado === "nueva") { o.estado = "probando"; store(LS_OTA, JSON.stringify(o)); }
    }
    window.location.reload();
  }

  function ok() {
    if (android && android.otaOk) { try { android.otaOk(); } catch (e) { /* nada */ } }
    var cur = current();
    var o = cur.ota;
    if (!o || o.estado === "ok" || o.estado === "mala") { return; }
    if (o.version === cur.web) {
      o.estado = "ok";
      o.intentos = 0;
      store(LS_OTA, JSON.stringify(o));
    } else if (android && cmp(o.version, cur.web) > 0) {
      /* celular: la nueva ya se bajó y el APK la abre sola al reiniciar (Actualizador.decidir); si al arrancar seguimos
       * en la vieja es que la probó, no llegó a arrancar y volvió a la suya */
      o.estado = "mala";
      store(LS_OTA, JSON.stringify(o));
    }
  }

  /* Revisa al abrir la app y, mientras sigue abierta, como mucho cada 30 min. La revisión es un JSON de unos 500 bytes:
   * no hay por qué esperar horas, y como lo encontrado solo vive en memoria, aplazarla dejaba la versión nueva sin
   * avisar hasta la próxima revisión (la app abierta justo antes de publicarla no la veía en 6 h). */
  var lastAuto = 0;
  function auto(fn, delay) {
    if (Date.now() - lastAuto < 30 * 60 * 1000) { return; }
    lastAuto = Date.now();
    setTimeout(function () {
      check().then(function (info) { if (info.hay) { fn(info); } }, function () { lastAuto = 0; /* sin conexión: se reintenta */ });
    }, delay === undefined ? 8000 : delay);
  }

  return { check: check, install: install, installNative: installNative, restart: restart, ok: ok, current: current, auto: auto, cmp: cmp, server: SERVER };
})();
