/* HomeFlix web en computador (index.html?web=1): las pantallas de la TV, manejadas con mouse y teclado.
 * Solo se carga en la versión web (index.html lo agrega si hay ?web=1). En la TV nunca corre.
 * No cambia el diseño: usa el mismo motor de foco (js/ui/core.js) y agrega lo propio del mouse.
 *
 *   - Pasar el mouse por encima enfoca (mismo resaltado que con el control), sin mover filas ni la página.
 *   - Rueda arriba / abajo: pasa de fila en fila (como ▲ ▼). Rueda de lado (o Shift + rueda) sobre una fila: la desliza.
 *   - Flechas ‹ › a los lados de cada fila al pasar el mouse: avanzan una página de tarjetas.
 *   - Botón «atrás» del mouse = Atrás (Esc).
 *   - Con el mouse, lo que está bajo el cursor se ve igual que lo enfocado con el control (mismo diseño). */
(function () {
  "use strict";
  var html = document.documentElement;
  if (html.getAttribute("data-web") !== "pc") { return; }

  /* ---------- Modo mouse / modo teclado ---------- */
  var lastX = -1;
  var lastY = -1;
  document.addEventListener("mousemove", function (e) {
    if (e.clientX === lastX && e.clientY === lastY) { return; } /* algunos navegadores mandan mousemove sin mover */
    lastX = e.clientX;
    lastY = e.clientY;
    html.classList.add("hf-mouse");
    hoverFocus(e.target);
  }, true);
  document.addEventListener("keydown", function () { html.classList.remove("hf-mouse"); }, true);

  /* ---------- Enfocar al pasar el mouse, sin desplazar ----------
   * updateFocus() desplaza la fila y la página para que se vea lo enfocado. Con el mouse lo enfocado ya está a la
   * vista: se enfoca sin mover nada (si no, la fila saltaría debajo del cursor). */
  var still = false;
  var baseScrollTrack = window.scrollTrack;
  var baseScrollPage = window.scrollPage;
  window.scrollTrack = function (a) { if (!still) { baseScrollTrack(a); } };
  window.scrollPage = function (a) { if (!still) { baseScrollPage(a); } };

  /* Se hace con cada movimiento real del mouse (no con mouseover: ese llega antes que el primer mousemove y la
   * primera tarjeta bajo el cursor quedaba sin enfocar hasta salir y volver a entrar). */
  function hoverFocus(target) {
    if (isTypingInInput()) { return; }
    var el = findFocusableFromTarget(target);
    if (!el || el.getAttribute("data-focused") === "true") { return; }
    still = true;
    try { syncStateToElement(el); } finally { still = false; }
  }

  /* ---------- Escala del lienzo (fitToWindow lo escala con transform) ---------- */
  function scale() {
    var app = byId("app");
    return app && app.offsetWidth ? app.getBoundingClientRect().width / app.offsetWidth : 1;
  }

  /* Área (fila) que contiene un elemento de la pantalla */
  function rowAreaOf(target) {
    for (var i = 0; i < areas.length; i += 1) {
      var a = areas[i];
      if (a.dir === "h" && a.track && a.block && a.block.contains(target)) { return a; }
    }
    return null;
  }

  /* Desliza una fila normal (no en ciclo) sin mover el foco */
  function maxOffset(a) { return Math.max(0, (a.total || 0) + 40 - (a.viewSize || 0)); }
  function slideRow(a, px, animate) {
    if (!a || a.loop) { return; }
    if (animate) { a.track.classList.add("anim"); } else { a.track.classList.remove("anim"); }
    setTrackOffset(a, Math.max(0, Math.min(maxOffset(a), (a.track._hfOff || 0) + px)));
    paintArrows(a);
  }

  /* Avanza una página: en una fila en ciclo mueve el foco tantas tarjetas como caben; en una normal la desliza */
  function pageRow(a, dir) {
    var first = a.items[0];
    var cardW = first ? first.offsetWidth + 24 : 360;
    var perPage = Math.max(1, Math.floor(((a.viewSize || 1600) - 120) / cardW));
    if (a.loop) {
      var cur = currentArea();
      if (cur !== a) {
        state.areaIndex = areas.indexOf(a);
        state.itemIndex = areaMemory[currentRoute + ":" + a.name] || 0;
        a.domIndex = a.count + state.itemIndex;
      }
      stepLoop(a, dir * perPage);
    } else {
      slideRow(a, dir * perPage * cardW, true);
    }
  }

  /* ---------- Flechas ‹ › de cada fila ---------- */
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  function paintArrows(a) {
    var vp = a.block && a.block.querySelector(".hf2-row-viewport");
    if (!vp) { return; }
    var l = vp.querySelector(".hf-web-arrow.left");
    var r = vp.querySelector(".hf-web-arrow.right");
    if (!l || !r) { return; }
    if (a.loop) { l.hidden = false; r.hidden = false; return; }
    var off = a.track._hfOff || 0;
    l.hidden = off <= 0;
    r.hidden = off >= maxOffset(a) - 1;
  }
  function addArrows() {
    areas.forEach(function (a) {
      if (a.dir !== "h" || !a.block) { return; }
      var vp = a.block.querySelector(".hf2-row-viewport");
      if (!vp || vp.querySelector(".hf-web-arrow")) { return; }
      /* Si todo cabe, no hacen falta */
      if (!a.loop && maxOffset(a) <= 0) { return; }
      vp.insertAdjacentHTML("beforeend",
        '<button type="button" class="hf-web-arrow left" aria-label="Anteriores">' + CHEVRON + "</button>" +
        '<button type="button" class="hf-web-arrow right" aria-label="Siguientes">' + CHEVRON + "</button>");
      paintArrows(a);
    });
  }
  var baseSetAreas = window.setAreas;
  window.setAreas = function () {
    var r = baseSetAreas.apply(this, arguments);
    addArrows();
    return r;
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".hf-web-arrow");
    if (!b) { return; }
    e.stopPropagation();
    var a = rowAreaOf(b);
    if (a) { pageRow(a, b.classList.contains("left") ? -1 : 1); }
  }, true);

  /* ---------- Rueda del mouse / panel táctil ---------- */
  var acc = 0;
  var lastStep = 0;
  var slideIdle = 0;
  document.addEventListener("wheel", function (e) {
    if (isTypingInInput() || currentRoute === "player") { return; }
    var dx = e.deltaX;
    var dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 32; dy *= 32; } /* por líneas → píxeles */
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    /* De lado: desliza la fila que está bajo el mouse */
    if (Math.abs(dx) > Math.abs(dy)) {
      var a = rowAreaOf(e.target);
      if (!a) { return; }
      e.preventDefault();
      if (a.loop) {
        acc += dx;
        if (Math.abs(acc) >= 120 && Date.now() - lastStep > 260) { lastStep = Date.now(); pageRow(a, acc > 0 ? 1 : -1); acc = 0; }
        return;
      }
      slideRow(a, dx / scale(), false);
      clearTimeout(slideIdle);
      slideIdle = setTimeout(function () { a.track.classList.add("anim"); }, 200);
      return;
    }
    /* Arriba / abajo: de fila en fila */
    e.preventDefault();
    acc += dy;
    if (Math.abs(acc) < 50 || Date.now() - lastStep < 220) { return; }
    lastStep = Date.now();
    var down = acc > 0;
    acc = 0;
    html.classList.remove("hf-mouse"); /* el foco lo mueve la rueda: que se vea dónde quedó */
    if (down) { moveDown(); } else { moveUp(); }
  }, { passive: false });

  /* ---------- Reproductor ----------
   *   Mover el mouse muestra los controles (se ocultan solos a los 5 s, y con ellos el cursor).
   *   Clic en el video: pausa / sigue. Doble clic: pantalla completa. Clic o arrastrar en la barra: ir a ese punto.
   *   Teclado: Espacio o K pausa · J / L −10 / +10 s · F pantalla completa · M silencio. Las flechas siguen como en la TV. */
  function inPlayer() { return currentRoute === "player"; }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function fullscreen() {
    var d = document;
    if (isFullscreen()) {
      var x = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      if (x && x.catch) { x.catch(function () {}); }
      return;
    }
    var el = d.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try {
        var r = req.call(el);
        if (r && r.catch) { r.catch(function () { /* el navegador no la dio: se queda en ventana */ }); }
      } catch (e) { /* sin pantalla completa */ }
    }
  }
  /* El botón del reproductor (js/ui/player.js) usa estas dos */
  window.hfToggleFullscreen = fullscreen;
  window.hfIsFullscreen = isFullscreen;
  /* Al entrar o salir (con el botón, F, doble clic o Esc del navegador), el ícono se pone al día */
  function paintFullscreen() {
    var b = byId("plFs");
    if (!b) { return; }
    var on = isFullscreen();
    b.innerHTML = on ? IC_FS_EXIT : IC_FS;
    b.setAttribute("data-title", on ? "Salir de pantalla completa" : "Pantalla completa");
    b._hfDescription = b.getAttribute("data-title");
  }
  document.addEventListener("fullscreenchange", paintFullscreen);
  document.addEventListener("webkitfullscreenchange", paintFullscreen);
  /* Partes del reproductor que no son «el video» (controles, paneles, tarjeta de siguiente) */
  function onChrome(target) {
    if (findFocusableFromTarget(target)) { return true; }
    var el = target;
    while (el && el !== document) {
      if (el.id === "plTracks" || el.id === "plEps" || el.id === "plNext") { return el.getAttribute("data-visible") === "true"; }
      if (el.classList && (el.classList.contains("hf2-pl-bottom") || el.classList.contains("hf2-pl-top"))) { return player.overlay; }
      el = el.parentNode;
    }
    return false;
  }

  document.addEventListener("mousemove", function () {
    if (inPlayer() && !player.error) { showPlayerOverlay(); }
  });

  /* Barra de tiempo con el mouse: vista previa al arrastrar, se salta al soltar */
  var drag = null;
  function barRatio(e) {
    var bar = byId("plBar");
    var r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  function previewAt(ratio) {
    var d = HFPlayback.duration();
    byId("plFill").style.width = ratio * 100 + "%";
    byId("plKnob").style.left = ratio * 100 + "%";
    if (d) { byId("plTime").textContent = HFLibrary.formatClock(ratio * d); }
  }
  var baseOnPlayerTime = window.onPlayerTime;
  window.onPlayerTime = function () { if (!drag) { baseOnPlayerTime.apply(this, arguments); } };
  document.addEventListener("mousedown", function (e) {
    if (!inPlayer() || e.button !== 0 || !e.target.closest || !e.target.closest("#plBar")) { return; }
    e.preventDefault();
    drag = { ratio: barRatio(e) };
    previewAt(drag.ratio);
    showPlayerOverlay();
  }, true);
  document.addEventListener("mousemove", function (e) {
    if (!drag) { return; }
    drag.ratio = barRatio(e);
    previewAt(drag.ratio);
    showPlayerOverlay();
  }, true);
  document.addEventListener("mouseup", function () {
    if (!drag) { return; }
    var r = drag.ratio;
    drag = null;
    HFPlayback.seek(r * HFPlayback.duration());
  }, true);

  document.addEventListener("click", function (e) {
    if (!inPlayer()) { return; }
    /* La barra ya se manejó al soltar el mouse: que la TV no la tome como «pausa» */
    if (e.target.closest && e.target.closest("#plBar")) { e.stopPropagation(); return; }
    /* La flecha ‹ de arriba sale del video (en la TV no hacía falta tocarla) */
    if (e.target.closest && e.target.closest(".hf2-pl-back")) { e.stopPropagation(); exitPlayer(); return; }
    if (onChrome(e.target)) { return; }
    e.stopPropagation();
    if (player.panel) { closePanel(); return; }
    if (player.error) { return; }
    HFPlayback.toggle();
    showPlayerOverlay();
  }, true);
  document.addEventListener("dblclick", function (e) {
    if (inPlayer() && !onChrome(e.target)) { fullscreen(); }
  });

  document.addEventListener("keydown", function (e) {
    if (!inPlayer() || isTypingInInput() || player.panel || e.ctrlKey || e.metaKey || e.altKey) { return; }
    var k = e.key && e.key.toLowerCase();
    var v = byId("playerVideo");
    if (k === " " || k === "k") { HFPlayback.toggle(); }
    else if (k === "j") { seekBy(-1); }
    else if (k === "l") { seekBy(1); }
    else if (k === "f") { fullscreen(); }
    else if (k === "m") {
      if (v) { v.muted = !v.muted; }
      setPlayerCenter(v && v.muted ? "Sin sonido" : "Con sonido");
      setTimeout(function () { if (/sonido/.test(byId("playerCenter").textContent)) { setPlayerCenter(""); } }, 900);
    }
    else { return; }
    e.preventDefault();
    e.stopPropagation();
    showPlayerOverlay();
  }, true);

  /* ---------- «Volver» de la ficha ----------
   * En la TV es una ayuda («BACK vuelve»); en el computador se puede tocar: hace lo mismo que Esc. */
  function goBack() {
    handleKeyDown({ keyCode: 27, which: 27, target: document.body, preventDefault: function () {}, stopPropagation: function () {} });
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".hf2-back")) { e.stopPropagation(); goBack(); }
  }, true);

  /* ---------- Botón «atrás» del mouse ---------- */
  document.addEventListener("mouseup", function (e) {
    if (e.button !== 3) { return; }
    e.preventDefault();
    handleKeyDown({ keyCode: 27, which: 27, target: document.body, preventDefault: function () {}, stopPropagation: function () {} });
  });
})();
