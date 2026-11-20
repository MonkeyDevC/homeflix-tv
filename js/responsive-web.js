/* HomeFlix web · elige la interfaz según la ventana, y la cambia sola al redimensionarla.
 *   ventana ancha (≥ 1024 px, con mouse)   → la interfaz de la TV con mouse y teclado (raíz «/», app.html)
 *   cualquier otra (celular, tablet, ventana angosta) → las pantallas del celular, las mismas del APK («/web/»)
 * Lo cargan app.html (solo en la web) y web/index.html, al principio de la página, antes que el resto de los scripts.
 * Pruebas: ?pc=1 fija la interfaz de computador, ?movil=1 la del celular y ?design=… (tablero de diseño) no se mueve.
 * Al cambiar de interfaz se recarga la página (son dos programas distintos); la sesión de Telegram y el perfil se conservan, y no se
 * corta un video que se esté reproduciendo: el cambio espera a que termine o se pause. */
(function () {
  "use strict";
  var q = location.search;
  var enMovil = /\/web\/(index\.html)?$/.test(location.pathname);
  var mq;
  var espera = null;

  if (/[?&]design=/.test(q) || !window.matchMedia) { return; }
  if (enMovil && /[?&]movil=1/.test(q)) { return; }
  if (!enMovil && /[?&]pc=1/.test(q)) { return; }
  mq = window.matchMedia("(min-width: 1024px) and (pointer: fine) and (hover: hover)");

  function limpia() { return q.replace(/([?&])web=1(&|$)/, function (m, a, b) { return b ? a : ""; }).replace(/[?&]$/, ""); }
  function destino() {
    var resto = limpia();
    if (mq.matches) { return "../?web=1" + resto.replace(/^\?/, "&"); } // de celular a computador
    return "web/" + resto; // de computador a celular
  }
  function sobra() { return mq.matches === enMovil; } // la interfaz actual no es la que toca
  function reproduciendo() {
    var v = document.querySelectorAll("video");
    var i;
    for (i = 0; i < v.length; i += 1) { if (!v[i].paused && !v[i].ended && v[i].readyState > 2) { return true; } }
    return false;
  }
  function cambia() {
    clearTimeout(espera);
    if (!sobra()) { return; }
    if (reproduciendo()) { espera = setTimeout(cambia, 1500); return; }
    location.replace(destino());
  }

  if (sobra()) { cambia(); }
  window.addEventListener("resize", function () { clearTimeout(espera); espera = setTimeout(cambia, 300); }); // además del aviso de la consulta: no todos los navegadores lo mandan
  if (mq.addEventListener) { mq.addEventListener("change", function () { clearTimeout(espera); espera = setTimeout(cambia, 250); }); }
  else if (mq.addListener) { mq.addListener(function () { clearTimeout(espera); espera = setTimeout(cambia, 250); }); }
})();
