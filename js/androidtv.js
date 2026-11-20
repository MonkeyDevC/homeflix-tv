/* HomeFlix · Android TV / stick.
 *
 * En un Android TV el APK abre la interfaz de la TV (app.html, la misma de Samsung). Este archivo solo hace algo ahí
 * (HFAndroid.modoTV() de MainActivity); en la TV Samsung y en el navegador no existe HFAndroid y no pasa nada.
 *
 *   window.HF_TV = true     para sync.js (se registra como «TV» y aparece en «Ver en la TV» del celular), intro.js y
 *                           los textos que hablan de Apps2Samsung.
 *   HFTV.back()             tecla ATRÁS del control. true = la interfaz la usó; false = ya está en la pantalla inicial
 *                           y la app se cierra.
 *   HFTV.key(c)             teclas multimedia y de canales del control, ya traducidas por MainActivity.tvKey a los
 *                           códigos de la TV Samsung (415 play, 19 pausa, 10252 play/pausa, 417 ▶▶, 412 ◀◀, 413 ■…).
 *   Pantalla encendida mientras suena un video: sin eso, el protector de pantalla del stick corta la película.
 *
 * Las flechas y OK (DPAD) llegan solas al WebView como las teclas 37-40 y 13: no hace falta nada aquí. */
(function () {
  "use strict";
  var a = null;
  try {
    a = window.HFAndroid && typeof window.HFAndroid.modoTV === "function" && window.HFAndroid.modoTV() ? window.HFAndroid : null;
  } catch (e) {
    a = null;
  }
  if (!a) { return; }

  window.HF_TV = true;

  /* Lo mismo que si se hubiera pulsado esa tecla: la interfaz tiene un solo manejador de teclado (js/ui/app.js). */
  function press(code) {
    if (typeof handleKeyDown !== "function") { return false; }
    handleKeyDown({ keyCode: code, which: code, key: "", target: document.body, preventDefault: function () {}, stopPropagation: function () {} });
    return true;
  }

  window.HFTV = {
    model: function () { try { return a.modelo() || ""; } catch (e) { return ""; } },
    back: function () {
      var route = typeof currentRoute !== "undefined" ? currentRoute : "";
      if (!route || route === "splash") { return false; } // pantalla inicial: salir de la app
      return press(10009);
    },
    key: function (code) { return press(code); }
  };

  function keepScreenOn() {
    var on = false;
    var v = document.getElementsByTagName("video");
    var i;
    for (i = 0; i < v.length; i += 1) {
      if (!v[i].paused && !v[i].ended && v[i].readyState >= 2) { on = true; }
    }
    try { a.keepOn(on); } catch (e) { /* APK viejo */ }
  }
  /* los eventos de video no suben por el árbol: se escuchan en la fase de captura */
  ["playing", "pause", "ended", "emptied", "abort"].forEach(function (ev) {
    document.addEventListener(ev, keepScreenOn, true);
  });
})();
