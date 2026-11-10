/* HomeFlix · arranque. index.html solo carga esto; la app de verdad es app.html.
 *
 * En la TV, si hay una interfaz más nueva bajada del servidor (js/update.js la guarda en IndexedDB «hf-ota»), se usa
 * esa: su app.html, sus scripts y sus estilos (como blob:), y las imágenes del paquete instalado. Si no, la instalada.
 *
 * Vuelta atrás: al arrancar una interfaz nueva queda «probando»; la app avisa que arrancó bien (HFUpdate.ok()) y queda
 * «ok». Si la vez anterior quedó en «probando» (no llegó a arrancar), se marca «mala» y se usa la instalada.
 * Si el paquete instalado ya es igual o más nuevo que lo bajado (se reinstaló el .wgt), se borra lo bajado.
 * Escrito para el Chromium 69 de la TV: ES5, XMLHttpRequest e IndexedDB. */
(function () {
  "use strict";
  var LS = "hf.ota";

  function cmp(a, b) {
    var x = String(a || "0").split(".");
    var y = String(b || "0").split(".");
    for (var i = 0; i < Math.max(x.length, y.length); i += 1) {
      var d = (Number(x[i]) || 0) - (Number(y[i]) || 0);
      if (d) { return d > 0 ? 1 : -1; }
    }
    return 0;
  }
  function getOta() { try { return JSON.parse(window.localStorage.getItem(LS) || "null"); } catch (e) { return null; } }
  function setOta(o) { try { if (o) { window.localStorage.setItem(LS, JSON.stringify(o)); } else { window.localStorage.removeItem(LS); } } catch (e) { /* nada */ } }

  function write(html) {
    document.open();
    document.write(html);
    document.close();
  }

  function fail(msg) {
    document.body.innerHTML = '<div style="font:32px sans-serif;color:#eee;background:#111;position:fixed;inset:0;display:flex;align-items:center;justify-content:center">' + msg + "</div>";
  }

  function installed() {
    var x = new XMLHttpRequest();
    x.open("GET", "app.html", true);
    x.onload = function () { if (x.responseText) { write(x.responseText); } else { fail("No se pudo abrir HomeFlix"); } };
    x.onerror = function () { fail("No se pudo abrir HomeFlix"); };
    x.send();
  }

  function dropOta() {
    setOta(null);
    try { window.indexedDB.deleteDatabase("hf-ota"); } catch (e) { /* nada */ }
  }

  /* rutas: «../images/x.png» desde «css/app.css» → «images/x.png» (relativo a la carpeta de la app) */
  function resolve(rel, from) {
    if (/^(?:[a-z]+:|\/|#)/i.test(rel)) { return rel; }
    var parts = from.split("/").slice(0, -1).concat(rel.split("/"));
    var out = [];
    parts.forEach(function (p) {
      if (p === "..") { out.pop(); } else if (p !== "." && p !== "") { out.push(p); }
    });
    return out.join("/");
  }

  function fromBundle(b) {
    var base = window.location.href.replace(/[?#].*$/, "").replace(/[^\/]*$/, "");
    var urls = {};
    function blobOf(name) {
      if (urls[name]) { return urls[name]; }
      var text = b.files[name];
      var type = /\.css$/.test(name) ? "text/css" : /\.js$/.test(name) ? "text/javascript" : "text/html";
      if (/\.css$/.test(name)) {
        /* las imágenes de los estilos salen del paquete instalado */
        text = text.replace(/url\((['"]?)([^'")]+)\1\)/g, function (all, q, u) {
          return /^(data:|blob:|https?:)/i.test(u) ? all : "url(" + q + base + resolve(u, name) + q + ")";
        });
      }
      urls[name] = URL.createObjectURL(new Blob([text], { type: type }));
      return urls[name];
    }
    var html = b.files["app.html"].replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")([^"]+)(")/gi, function (all, a, u, z) {
      var name = resolve(u, "app.html");
      return b.files[name] !== undefined ? a + blobOf(name) + z : all;
    });
    write(html);
  }

  var ota = getOta();
  if (!window.tizen || !ota || !ota.version || ota.estado === "mala") { installed(); return; }
  var pkg = "";
  try { pkg = tizen.application.getAppInfo().version || ""; } catch (e) { pkg = ""; }
  if (pkg && cmp(pkg, ota.version) >= 0) { dropOta(); installed(); return; } // se reinstaló algo igual o más nuevo
  if (ota.estado === "probando") { ota.estado = "mala"; setOta(ota); installed(); return; } // no llegó a arrancar
  if (ota.estado !== "ok") { ota.estado = "probando"; }
  ota.intentos = (ota.intentos || 0) + 1;
  setOta(ota);

  var r = window.indexedDB.open("hf-ota", 1);
  r.onupgradeneeded = function () { r.result.createObjectStore("web"); };
  r.onerror = installed;
  r.onsuccess = function () {
    var db = r.result;
    var g;
    try { g = db.transaction("web", "readonly").objectStore("web").get("bundle"); } catch (e) { db.close(); installed(); return; }
    g.onsuccess = function () {
      var b = g.result;
      db.close();
      if (!b || !b.files || !b.files["app.html"] || b.version !== ota.version) { dropOta(); installed(); return; }
      try { fromBundle(b); } catch (e) { ota.estado = "mala"; setOta(ota); installed(); }
    };
    g.onerror = function () { db.close(); installed(); };
  };
})();
