/* HomeFlix web · aviso para instalarla como app. Solo la web usa este archivo.
 *  - iPhone / iPad (Safari): no hay botón de instalar; se explica «Compartir → Agregar a inicio».
 *  - Android / PC (Chrome, Edge): se usa el botón nativo (evento beforeinstallprompt).
 * No sale si ya está instalada (display-mode: standalone) ni si se cerró (se recuerda 30 días). */
(function () {
  "use strict";
  var KEY = "hf.instalar";
  var ua = navigator.userAgent || "";
  var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var evento = null;
  var caja = null;

  function cerradaHace() {
    try { var t = Number(localStorage.getItem(KEY)) || 0; return t ? (Date.now() - t) / 86400000 : 999; } catch (e) { return 999; }
  }
  function cerrar() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* sin guardar */ }
    if (caja && caja.parentNode) { caja.parentNode.removeChild(caja); }
    caja = null;
  }
  function estilo() {
    var s = document.createElement("style");
    s.textContent =
      ".hf-inst{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:60;display:flex;align-items:center;gap:12px;padding:12px 14px;" +
      "border-radius:16px;background:rgba(27,29,33,.96);border:1px solid rgba(230,193,147,.35);box-shadow:0 10px 30px rgba(0,0,0,.5);color:#f3f4f6;font:14px/1.35 -apple-system,\"Segoe UI\",Arial,sans-serif}" +
      ".hf-inst b{display:block;font-size:15px}.hf-inst span{color:#b9bcc0}.hf-inst .x{margin-left:auto;display:flex;gap:8px;flex:none}" +
      ".hf-inst button{height:36px;padding:0 14px;border-radius:18px;border:0;font:700 13px inherit;background:rgba(255,255,255,.12);color:#f3f4f6}" +
      ".hf-inst button.p{background:linear-gradient(180deg,#e6c193,#c99a66);color:#2a1d0e}" +
      ".hf-inst svg{width:20px;height:20px;vertical-align:-4px}";
    document.head.appendChild(s);
  }
  function mostrar(html, boton) {
    if (caja || standalone || cerradaHace() < 30) { return; }
    estilo();
    caja = document.createElement("div");
    caja.className = "hf-inst";
    caja.setAttribute("role", "dialog");
    caja.innerHTML = '<div>' + html + '</div><div class="x">' + (boton ? '<button class="p" data-i="si">Instalar</button>' : "") + '<button data-i="no">Ahora no</button></div>';
    caja.addEventListener("click", function (e) {
      var b = e.target.closest("[data-i]");
      if (!b) { return; }
      if (b.getAttribute("data-i") === "si" && evento) {
        evento.prompt();
        evento.userChoice.then(cerrar, cerrar);
      } else { cerrar(); }
    });
    document.body.appendChild(caja);
  }

  if (standalone) { return; }
  if (ios) {
    var compartir = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
    var esSafari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua); // en Chrome de iPhone no se puede instalar: hay que abrirla en Safari
    window.addEventListener("load", function () {
      setTimeout(function () {
        mostrar(esSafari ? "<b>Instálala como app</b><span>Toca " + compartir + " (Compartir) y luego «Agregar a inicio».</span>" :
          "<b>Ábrela en Safari</b><span>Para instalarla en el iPhone hay que abrir esta página en Safari y tocar Compartir → «Agregar a inicio».</span>", false);
      }, 4000);
    });
  } else {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      evento = e;
      mostrar("<b>Instálala como app</b><span>Se abre sola y a pantalla completa, sin el navegador.</span>", true);
    });
  }
})();
