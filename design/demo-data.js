/* Tablero de diseño · datos compartidos por las vistas de TV y del celular (solo desarrollo).
 * La biblioteca y sus imágenes son las reales, exportadas una vez a design/media/ (library.json + <chat>_<msg>.jpg),
 * así el tablero se ve igual que la app sin conectarse a Telegram. Se agrega una serie de demostración (no hay series
 * publicadas todavía) para poder diseñar sus vistas. Nada aquí escribe en Telegram. */
var HFDemo = (function () {
  "use strict";

  var base = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/demo-data\.js.*$/, "") : "design/";
  })();

  function mediaUrl(key) {
    return base + "media/" + String(key).replace(/[^0-9a-z-]/gi, "_") + ".jpg";
  }

  /* Serie de demostración (sin imágenes: usa el arte de respaldo de la app). */
  function demoSeries() {
    var mk = function (k, cap, d, dur) {
      return { key: "demo:" + k, chatId: "-5479575394", chatTitle: "NETSUCKS", msgId: k, kind: "video", caption: cap,
        fileName: "video_" + k + ".mp4", duration: dur, size: 6e8, width: 1920, height: 1080, date: d };
    };
    var t0 = Date.UTC(2026, 9, 1);
    return [
      mk(101, "serie(1/1)#Ciudad neón#Luces de neón#La ciudad se apaga y solo una torre sigue encendida. Nora decide averiguar por qué.", t0, 2640),
      mk(102, "serie(1/2)#Ciudad neón#El taller#Nora encuentra en el taller de su padre un aparato que capta señales.", t0 + 1e6, 2460),
      mk(103, "serie(1/3)#Ciudad neón#Señales#La misma luz aparece cada noche a la misma hora.", t0 + 2e6, 2580),
      mk(104, "serie(1/4)#Ciudad neón#Interferencia#La señal se repite y alguien más la está escuchando.", t0 + 3e6, 2760),
      mk(105, "serie(2/1)#Ciudad neón#Apagón#Un año después, la torre vuelve a encenderse.", t0 + 4e6, 2700)
    ];
  }

  var cache = null;
  function load() {
    if (!cache) {
      cache = fetch(base + "media/library.json", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : []; }, function () { return []; })
        .then(function (items) { return items.concat(demoSeries()); });
    }
    return cache;
  }

  /* Progreso de ejemplo para «Continuar viendo» (en memoria, no toca nada guardado). */
  function progressFor(items) {
    var out = {};
    var hop = items.filter(function (i) { return i.kind === "video" && /Hoppers/.test(i.caption) && /720p/.test(i.fileName); })[0];
    var spi = items.filter(function (i) { return i.kind === "video" && /Spider-Man/.test(i.caption); })[0];
    if (hop) { out[hop.key] = { t: 2380, d: hop.duration, at: Date.now() - 3600e3 }; }
    if (spi) { out[spi.key] = { t: 1500, d: spi.duration, at: Date.now() - 86400e3 }; }
    out["demo:102"] = { t: 900, d: 2460, at: Date.now() - 7200e3 };
    return out;
  }

  function param(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : "";
  }

  return { load: load, mediaUrl: mediaUrl, progressFor: progressFor, param: param };
})();
