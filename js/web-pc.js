/* HomeFlix web · la interfaz de la TV manejada como una página web en un computador (solo se carga con ?web=1).
 * La interfaz nació para un control remoto: un «foco» salta de tarjeta en tarjeta con las flechas y la pantalla se desplaza sola para
 * seguirlo. En un computador eso se siente raro, así que aquí se le suma una capa de mouse y trackpad NATIVA, sin tocar el motor de la TV:
 *   · la rueda y el trackpad desplazan la página (arriba/abajo) y la fila bajo el puntero (lateral o Shift + rueda) a píxel, sin mover el foco;
 *   · cada carrusel tiene botones ‹ › al pasar el mouse por encima;
 *   · barra de desplazamiento a la derecha (se arrastra);
 *   · pasar el mouse por una tarjeta o botón la resalta (y se inclina en 3D), pero NUNCA desplaza la pantalla ni las filas;
 *   · Re Pág / Av Pág / Inicio / Fin / Espacio recorren la página; el 4.º botón del mouse es «atrás».
 * Las flechas del teclado siguen moviendo el foco (accesibilidad). Todo se apoya en las funciones de la propia interfaz y se instala al
 * terminar de cargarse la página: la TV no carga este archivo. */
(function () {
  "use strict";
  if (!window.HF_WEB && !/[?&]web=1/.test(location.search)) { return; }

  var lastX = -1;
  var lastY = -1;
  var quiet = false; // true mientras el foco cambia por pasar el mouse: el motor no debe desplazar nada
  var sb = null;
  var sbThumb = null;

  function press(code) {
    if (typeof handleKeyDown !== "function") { return; }
    handleKeyDown({ keyCode: code, which: code, key: "", target: document.body, preventDefault: function () {}, stopPropagation: function () {} });
  }
  function enCampo(t) { return !!(t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); }
  function enReproductor() { return typeof currentRoute !== "undefined" && currentRoute === "player"; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  /* píxeles de pantalla → píxeles del lienzo (el lienzo está escalado) */
  function escala() {
    var a = document.getElementById("app");
    var r = a ? a.getBoundingClientRect() : null;
    return r && a.offsetHeight ? r.height / a.offsetHeight : 1;
  }

  /* ---------- Página: desplazamiento a píxel ---------- */
  function maxPagina() { return Math.max(0, pageState.contentH - pageState.viewH + 80); } // el mismo tope que scrollPage del motor
  function irA(offset) {
    var t;
    if (!pageState.el) { return false; }
    t = clamp(Math.round(offset), 0, maxPagina());
    if (t === pageState.offset) { return false; }
    pageState.offset = t;
    pageState.el.style.transform = "translate3d(0," + (-t) + "px,0)";
    barra();
    return true;
  }

  /* ---------- Filas y listas: desplazamiento de la pista ---------- */
  function maxPista(a) { return Math.max(0, a.total + 40 - a.viewSize); } // el mismo tope que scrollTrack del motor
  function pistaA(a, px) {
    var t = clamp(Math.round(px), 0, maxPista(a));
    if ((a.track._hfOff || 0) === t) { return false; }
    setTrackOffset(a, t);
    botones(a);
    return true;
  }
  function areaDe(el, dir) {
    var i;
    for (i = 0; i < areas.length; i += 1) {
      if (areas[i].track && !areas[i].loop && areas[i].dir === dir && areas[i].track.parentNode.contains(el)) { return areas[i]; }
    }
    return null;
  }

  /* ---------- Rueda y trackpad ---------- */
  var ultimaRueda = 0;
  document.addEventListener("wheel", function (e) {
    var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1; // líneas / páginas → píxeles
    var s = escala();
    var dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k / s;
    var dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k / s;
    var a;
    var h;
    if (enCampo(e.target) || enReproductor() || e.ctrlKey) { return; }
    if (typeof areas === "undefined") { return; }
    e.preventDefault();
    if (Math.abs(dx) > Math.abs(dy)) {
      a = areaDe(e.target, "h");
      if (a) { pistaA(a, (a.track._hfOff || 0) + dx); }
      return;
    }
    /* apariencias (js/themes.js): el lobby de Wii pasa de página con la rueda */
    if (window.HFTheme && HFTheme.wheel && HFTheme.wheel(dx, dy)) { return; }
    /* búsqueda: la lista de resultados se desplaza a píxel (contenedor con scroll propio) */
    if (typeof currentRoute !== "undefined" && currentRoute === "search") {
      h = document.querySelector("#scrSearch .hf2-page");
      if (h) { h.scrollTop += dy; }
      return;
    }
    /* ficha: la rueda hace lo mismo que bajar con el control — la cabecera se recoge y suben «También de…» / los capítulos (y al revés) */
    if (typeof currentRoute !== "undefined" && currentRoute === "detail" && !document.getElementById("scrDetail").classList.contains("wii-detalle")) {
      if (Math.abs(dy) > 2 && Date.now() - ultimaRueda > 380) {
        ultimaRueda = Date.now();
        h = currentArea();
        if (dy > 0) { press(40); } else if (h && h.name !== "actions") { press(38); }
      }
      return;
    }
    a = areaDe(e.target, "v"); // una lista vertical con su propia pista (p. ej. los chats de Ajustes) se recorre sola
    if (a && !(dy < 0 && (a.track._hfOff || 0) <= 0) && !(dy > 0 && (a.track._hfOff || 0) >= maxPista(a))) { pistaA(a, (a.track._hfOff || 0) + dy); return; }
    irA(pageState.offset + dy);
  }, { passive: false });

  /* ---------- Búsqueda: con las flechas el resultado enfocado se mantiene a la vista (con el mouse, el hover no desplaza) ---------- */
  function sigueFoco() {
    var raiz = document.getElementById("scrSearch");
    if (!raiz || typeof MutationObserver === "undefined") { return; }
    new MutationObserver(function (lista) {
      var i;
      var el;
      if (quiet || currentRoute !== "search") { return; }
      for (i = 0; i < lista.length; i += 1) {
        el = lista[i].target;
        if (el.getAttribute && el.getAttribute("data-focused") === "true" && el.scrollIntoView && el.closest("#searchBody")) { el.scrollIntoView({ block: "nearest" }); }
      }
    }).observe(raiz, { attributes: true, attributeFilter: ["data-focused"], subtree: true });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", sigueFoco, false); } else { sigueFoco(); }

  /* ---------- Teclas de página ---------- */
  document.addEventListener("keydown", function (e) {
    var h;
    if (enCampo(e.target) || enReproductor() || e.ctrlKey || e.altKey || e.metaKey || !pageState.el) { return; }
    h = pageState.viewH * 0.85;
    if (e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); irA(pageState.offset + h); }
    else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) { e.preventDefault(); irA(pageState.offset - h); }
    else if (e.key === "Home") { e.preventDefault(); irA(0); }
    else if (e.key === "End") { e.preventDefault(); irA(maxPagina()); }
  }, true);

  /* ---------- Barra de desplazamiento ---------- */
  function crearBarra() {
    var drag = null;
    sb = document.createElement("div");
    sb.className = "hf-sb";
    sbThumb = document.createElement("div");
    sbThumb.className = "hf-sb-thumb";
    sb.appendChild(sbThumb);
    document.body.appendChild(sb);
    sbThumb.addEventListener("pointerdown", function (e) {
      drag = { y: e.clientY, off: pageState.offset };
      sbThumb.setPointerCapture(e.pointerId);
      sb.classList.add("on");
      if (pageState.el) { pageState.el.style.transition = "none"; }
      e.preventDefault();
    });
    sbThumb.addEventListener("pointermove", function (e) {
      var libre;
      if (!drag) { return; }
      libre = window.innerHeight - sbThumb.offsetHeight;
      if (libre > 0) { irA(drag.off + ((e.clientY - drag.y) / libre) * maxPagina()); }
    });
    function suelta() {
      drag = null;
      sb.classList.remove("on");
      if (pageState.el) { pageState.el.style.transition = ""; }
    }
    sbThumb.addEventListener("pointerup", suelta);
    sbThumb.addEventListener("pointercancel", suelta);
    /* clic en el carril: salta a esa altura */
    sb.addEventListener("pointerdown", function (e) {
      var libre;
      if (e.target !== sb) { return; }
      libre = window.innerHeight - sbThumb.offsetHeight;
      if (libre > 0) { irA(((e.clientY - sbThumb.offsetHeight / 2) / libre) * maxPagina()); }
    });
  }
  function barra() {
    var max;
    var alto;
    var h;
    if (!sb) { return; }
    max = maxPagina();
    if (!pageState.el || max <= 0 || (typeof currentRoute !== "undefined" && currentRoute === "player")) { sb.style.display = "none"; return; }
    alto = window.innerHeight;
    h = Math.max(48, Math.round(alto * pageState.viewH / (pageState.contentH + 80)));
    sb.style.display = "block";
    sbThumb.style.height = h + "px";
    sbThumb.style.transform = "translateY(" + Math.round((pageState.offset / max) * (alto - h)) + "px)";
  }

  /* ---------- Botones ‹ › en cada carrusel ---------- */
  function botones(a) {
    var v;
    var p;
    var n;
    if (!a || !a.track) { return; }
    v = a.track.parentNode;
    p = v.querySelector(".hf-car.prev");
    n = v.querySelector(".hf-car.next");
    if (p) { p.classList.toggle("off", (a.track._hfOff || 0) <= 2); }
    if (n) { n.classList.toggle("off", (a.track._hfOff || 0) >= maxPista(a) - 2); }
  }
  function ponBotones() {
    areas.forEach(function (a) {
      var v;
      if (!a.track || a.loop || a.dir !== "h" || maxPista(a) <= 0) { return; }
      v = a.track.parentNode;
      if (v.querySelector(".hf-car")) { botones(a); return; }
      ["prev", "next"].forEach(function (lado) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "hf-car " + lado;
        b.setAttribute("aria-label", lado === "prev" ? "Anterior" : "Siguiente");
        b.innerHTML = typeof IC !== "undefined" && IC.back ? IC.back : (lado === "prev" ? "‹" : "›");
        b.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          pistaA(a, (a.track._hfOff || 0) + (lado === "prev" ? -1 : 1) * a.viewSize * 0.85);
        });
        v.appendChild(b);
      });
      botones(a);
    });
  }

  /* ---------- Mouse sobre tarjetas: resaltar sin desplazar nada ---------- */
  document.addEventListener("mousemove", function (e) {
    var el;
    var r;
    if (Math.abs(e.screenX - lastX) < 2 && Math.abs(e.screenY - lastY) < 2) { return; }
    lastX = e.screenX;
    lastY = e.screenY;
    if (enCampo(e.target) || typeof findFocusableFromTarget !== "function" || typeof syncStateToElement !== "function") { return; }
    el = findFocusableFromTarget(e.target);
    if (!el || el.getAttribute("data-focused") === "true") { return; }
    r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) { return; }
    quiet = true;
    try { syncStateToElement(el); } finally { quiet = false; }
  }, { passive: true });

  /* tarjeta con el foco: se inclina en 3D hacia donde apunta el mouse y el brillo la sigue (css/app.css: --rx --ry --gx --gy) */
  var tiltEl = null;
  var tiltRaf = 0;
  var tiltEv = null;
  function tarjeta(t) {
    while (t && t !== document) {
      if (t.classList && (t.classList.contains("hf2-card") || t.classList.contains("hf2-ep"))) { return t; }
      t = t.parentNode;
    }
    return null;
  }
  function destilt(c) {
    if (!c) { return; }
    c.classList.remove("tilt");
    c.style.removeProperty("--rx");
    c.style.removeProperty("--ry");
    c.style.removeProperty("--gx");
    c.style.removeProperty("--gy");
  }
  function pintaTilt() {
    var e = tiltEv;
    var c;
    var art;
    var r;
    var px;
    var py;
    tiltRaf = 0;
    if (!e) { return; }
    c = tarjeta(e.target);
    if (tiltEl && tiltEl !== c) { destilt(tiltEl); tiltEl = null; }
    if (!c || c.getAttribute("data-focused") !== "true") { return; }
    art = c.querySelector(".hf2-card-art, .hf2-ep-art") || c;
    r = art.getBoundingClientRect();
    if (!r.width || !r.height) { return; }
    px = clamp((e.clientX - r.left) / r.width, 0, 1);
    py = clamp((e.clientY - r.top) / r.height, 0, 1);
    tiltEl = c;
    c.classList.add("tilt");
    c.style.setProperty("--ry", ((px - 0.5) * 12).toFixed(2) + "deg");
    c.style.setProperty("--rx", ((0.5 - py) * 9).toFixed(2) + "deg");
    c.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
    c.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
  }
  document.addEventListener("mousemove", function (e) {
    tiltEv = e;
    if (!tiltRaf) { tiltRaf = requestAnimationFrame(pintaTilt); }
  }, { passive: true });
  document.addEventListener("mouseout", function (e) {
    if (tiltEl && !(e.relatedTarget && tiltEl.contains(e.relatedTarget))) { destilt(tiltEl); tiltEl = null; }
  }, true);

  /* ---------- Reproductor nativo de computador ----------
   * En la TV las flechas mueven un foco entre los botones y OK pulsa; en un computador se espera lo de cualquier reproductor web: clic en el video =
   * pausa / reanuda, doble clic = pantalla completa, barra de progreso que se arrastra, volumen, y teclas Espacio, ← →, ↑ ↓, M, F, Esc. */
  function enPlayer() { return typeof currentRoute !== "undefined" && currentRoute === "player"; }
  function panelEnPlayer() { return !!(player.panel || player.nextVisible || player.error); }
  function video() { return document.getElementById("playerVideo"); }
  function aviso(txt) {
    if (typeof setPlayerCenter !== "function") { return; }
    setPlayerCenter(txt);
    clearTimeout(aviso.t);
    aviso.t = setTimeout(function () { setPlayerCenter(""); }, 800);
  }
  function pantallaCompleta() {
    var d = document;
    if (d.fullscreenElement) { d.exitFullscreen(); } else if (d.documentElement.requestFullscreen) { d.documentElement.requestFullscreen(); }
  }
  function volumen(delta) {
    var v = video();
    var n;
    if (!v) { return; }
    n = clamp(Math.round((v.muted ? 0 : v.volume) * 100) / 100 + delta, 0, 1);
    v.muted = n === 0;
    v.volume = n;
    guardaVol();
    pintaVol();
    aviso("Volumen " + Math.round(n * 100) + " %");
  }
  function silenciar() {
    var v = video();
    if (!v) { return; }
    v.muted = !v.muted;
    guardaVol();
    pintaVol();
    aviso(v.muted ? "Sin sonido" : "Volumen " + Math.round(v.volume * 100) + " %");
  }
  function guardaVol() {
    var v = video();
    try { if (v) { localStorage.setItem("hf.vol", JSON.stringify({ v: v.volume, m: v.muted })); } } catch (e) { /* sin guardar */ }
  }
  function leeVol() {
    var v = video();
    var g;
    try { g = JSON.parse(localStorage.getItem("hf.vol") || "null"); } catch (e) { g = null; }
    if (v && g && typeof g.v === "number") { v.volume = clamp(g.v, 0, 1); v.muted = !!g.m; }
  }
  function pintaVol() {
    var v = video();
    var r = document.getElementById("hfVolRange");
    var b = document.getElementById("hfVolBtn");
    if (!v || !r) { return; }
    r.value = v.muted ? 0 : Math.round(v.volume * 100);
    r.style.setProperty("--p", r.value + "%");
    if (b) { b.classList.toggle("mute", v.muted || v.volume === 0); }
  }
  /* se añade el control de volumen a la barra de botones cada vez que el reproductor la vuelve a armar */
  function ponVolumen() {
    var main = document.querySelector("#playerChrome .hf2-pl-main");
    var box;
    if (!main || main.querySelector(".hf-vol")) { return; }
    box = document.createElement("div");
    box.className = "hf-vol";
    box.innerHTML = '<span class="hf-vbtn" id="hfVolBtn" title="Silenciar (M)">' + (typeof IC !== "undefined" ? IC.audio : "🔊") + '<i></i></span><input id="hfVolRange" type="range" min="0" max="100" step="1" value="100" aria-label="Volumen">';
    main.appendChild(box);
    box.querySelector("#hfVolBtn").addEventListener("click", function (e) { e.stopPropagation(); silenciar(); });
    box.querySelector("#hfVolRange").addEventListener("input", function (e) {
      var v = video();
      var n = Number(e.target.value) / 100;
      if (!v) { return; }
      v.muted = n === 0;
      v.volume = n;
      guardaVol();
      pintaVol();
    });
    leeVol();
    pintaVol();
  }
  /* barra de progreso: clic y arrastre buscan ese punto; al pasar el mouse se ve la hora de ese punto */
  function ratioBarra(e) {
    var bar = document.getElementById("plBar");
    var r = bar.getBoundingClientRect();
    return clamp((e.clientX + (arrastre && arrastre.off ? arrastre.off : 0) - r.left) / r.width, 0, 1);
  }
  var arrastre = null; // mientras se arrastra: {d, p (0-100), t}
  var retenido = null; // al soltar: la bola se queda donde se soltó hasta que el video llegue ahí (si no, saltaba al minuto viejo y volvía)
  var hora = null;
  var hojas = {};

  /* Vista previa de la escena: las hojas de miniaturas que el preparador sube con cada película (un cuadro cada «every» s, en hojas de cols × filas).
   * Se piden a Telegram al pasar por primera vez sobre la barra y quedan en la caché de este navegador. */
  function hojasDe(it) { var th = it && it.thumbs; return th && th.sheets && th.sheets.length ? th : null; }
  function cargaHojas(it) {
    var th = hojasDe(it);
    var S;
    if (!th || typeof HFTelegram === "undefined" || !HFTelegram.fileUrl) { return null; }
    S = hojas[it.key];
    if (S) { return S; }
    S = hojas[it.key] = { urls: [] };
    th.sheets.forEach(function (key, i) {
      HFTelegram.fileUrl(key).then(function (u) { if (u) { S.urls[i] = u; } }, function () { /* sin esa hoja */ });
    });
    return S;
  }
  function estiloHoja(it, t, d) {
    var th = hojasDe(it);
    var S = cargaHojas(it);
    var per;
    var last;
    var idx;
    var sh;
    var cell;
    var u;
    var cx;
    var cy;
    if (!th || !S) { return ""; }
    per = th.cols * th.rows;
    last = d ? Math.max(0, Math.ceil(d / th.every) - 1) : 1e9; // la última hoja no viene llena
    idx = Math.max(0, Math.min(last, Math.round(t / th.every)));
    sh = Math.floor(idx / per);
    cell = idx % per;
    if (sh >= th.sheets.length) { sh = th.sheets.length - 1; cell = per - 1; }
    u = S.urls[sh];
    if (!u) { return ""; }
    cx = cell % th.cols;
    cy = Math.floor(cell / th.cols);
    return "url(" + u + ")|" + (th.cols * 100) + "% " + (th.rows * 100) + "%|" +
      (th.cols > 1 ? (cx / (th.cols - 1) * 100).toFixed(3) : 0) + "% " + (th.rows > 1 ? (cy / (th.rows - 1) * 100).toFixed(3) : 0) + "%";
  }

  function posBarra(p) {
    var fill = document.getElementById("plFill");
    var knob = document.getElementById("plKnob");
    if (fill) { fill.style.width = p + "%"; }
    if (knob) { knob.style.left = p + "%"; }
  }
  function textoTiempo(t, d) {
    var a1 = document.getElementById("plTime");
    var a2 = document.getElementById("plDur");
    if (a1) { a1.textContent = HFLibrary.formatClock(t); }
    if (a2) { a2.textContent = "-" + HFLibrary.formatClock(Math.max(0, d - t)); }
  }

  function pintaHora(e) {
    var bar = document.getElementById("plBar");
    var app = document.getElementById("app");
    var d;
    var t;
    var est;
    var partes;
    var th;
    var x;
    var mitad;
    var ancho;
    var ar;
    var esc;
    if (!bar || typeof HFPlayback === "undefined") { return; }
    d = HFPlayback.duration() || 0;
    t = ratioBarra(e) * d;
    if (!hora) {
      hora = document.createElement("div");
      hora.className = "hf-hora";
      hora.innerHTML = '<div class="hf-th"></div><b></b>';
      document.getElementById("playerChrome").appendChild(hora);
    }
    est = (typeof player !== "undefined" && player.item) ? estiloHoja(player.item, t, d) : "";
    th = hora.firstChild;
    if (est) {
      partes = est.split("|");
      th.style.backgroundImage = partes[0];
      th.style.backgroundSize = partes[1];
      th.style.backgroundPosition = partes[2];
      hora.classList.add("con");
    } else {
      hora.classList.remove("con");
    }
    hora.lastChild.textContent = HFLibrary.formatClock(t);
    ar = app.getBoundingClientRect();
    esc = escala();
    ancho = ar.width / esc;
    x = (e.clientX - ar.left) / esc;
    mitad = est ? 140 : 60;
    hora.style.left = Math.round(clamp(x, mitad + 24, ancho - mitad - 24)) + "px";
    hora.style.top = Math.round((bar.getBoundingClientRect().top - ar.top) / esc - 22) + "px";
    hora.style.display = "flex";
  }
  function quitaHora() { if (hora) { hora.style.display = "none"; } }

  function mueveArrastre(ev) {
    var p = ratioBarra(ev);
    arrastre.p = p * 100;
    arrastre.t = p * arrastre.d;
    posBarra(arrastre.p);
    textoTiempo(arrastre.t, arrastre.d);
    pintaHora(ev);
  }
  document.addEventListener("pointerdown", function (e) {
    var bar = enPlayer() && e.target.closest ? e.target.closest("#plBar") : null;
    var d;
    var kn;
    var kr;
    var kc;
    function mover(ev) { if (arrastre) { mueveArrastre(ev); } }
    function soltar(ev) {
      var p;
      bar.removeEventListener("pointermove", mover);
      bar.removeEventListener("pointerup", soltar);
      bar.removeEventListener("pointercancel", soltar);
      if (arrastre) {
        p = ratioBarra(ev);
        retenido = { d: arrastre.d, p: p * 100, t: p * arrastre.d, hasta: Date.now() + 3000 };
        HFPlayback.seek(p * arrastre.d);
      }
      arrastre = null;
      document.getElementById("scrPlayer").classList.remove("hf-seeking");
      showPlayerOverlay();
    }
    if (!bar || e.button !== 0) { return; }
    d = HFPlayback.duration() || 0;
    if (!d) { return; }
    arrastre = { d: d, p: 0, t: 0, off: 0 };
    retenido = null;
    /* si se agarra la bola por un lado, no salta: se conserva la distancia entre el cursor y su centro */
    kn = document.getElementById("plKnob");
    if (kn) {
      kr = kn.getBoundingClientRect();
      kc = kr.left + kr.width / 2;
      if (Math.abs(e.clientX - kc) <= 22) { arrastre.off = kc - e.clientX; }
    }
    bar.setPointerCapture(e.pointerId);
    document.getElementById("scrPlayer").classList.add("hf-seeking");
    mueveArrastre(e); // la bola salta al cursor desde el primer instante
    bar.addEventListener("pointermove", mover);
    bar.addEventListener("pointerup", soltar);
    bar.addEventListener("pointercancel", soltar);
    e.preventDefault();
  }, true);
  document.addEventListener("mousemove", function (e) {
    var bar;
    if (!enPlayer()) { return; }
    if (!player.overlay) { showPlayerOverlay(); } else { scheduleOverlayHide(); }
    bar = e.target.closest ? e.target.closest("#plBar") : null;
    if (bar) { pintaHora(e); } else if (!arrastre) { quitaHora(); }
  }, { passive: true });
  /* clic sobre el video (no sobre un botón, la barra ni un panel): pausa / reanuda. Doble clic: pantalla completa. */
  function esVideo(t) {
    return !!(t && t.closest && !t.closest("[data-focusable],.hf2-pl-back,.hf-vol,.hf2-tracks,.hf2-pl-eps,.hf2-next,#plBar") && (t.id === "playerChrome" || t.closest("#playerChrome,#scrPlayer,.hf2-pl-shade") ));
  }
  var tragaClick = false; // el clic que activó el sonido tras recargar no debe pausar el video
  document.addEventListener("click", function (e) {
    if (!enPlayer() || panelEnPlayer() || !esVideo(e.target)) { return; }
    e.stopPropagation();
    if (tragaClick) { tragaClick = false; return; }
    HFPlayback.toggle();
    showPlayerOverlay();
  }, true);
  document.addEventListener("dblclick", function (e) {
    if (!enPlayer() || !esVideo(e.target)) { return; }
    e.preventDefault();
    pantallaCompleta();
  }, true);
  /* teclado de reproductor web (antes que el del control remoto); con un panel abierto (audio, capítulos…) se deja el de la TV */
  document.addEventListener("keydown", function (e) {
    var k = e.key;
    var v;
    var paso;
    if (!enPlayer() || enCampo(e.target) || e.ctrlKey || e.altKey || e.metaKey || panelEnPlayer()) { return; }
    v = video();
    paso = e.shiftKey ? 30 : 10;
    if (k === " " || k === "k" || k === "K") { HFPlayback.toggle(); showPlayerOverlay(); }
    else if (k === "ArrowLeft" || k === "j" || k === "J") { HFPlayback.seek(Math.max(0, HFPlayback.time() - paso)); aviso("−" + paso + " s"); showPlayerOverlay(); }
    else if (k === "ArrowRight" || k === "l" || k === "L") { HFPlayback.seek(HFPlayback.time() + paso); aviso("+" + paso + " s"); showPlayerOverlay(); }
    else if (k === "ArrowUp") { volumen(0.05); showPlayerOverlay(); }
    else if (k === "ArrowDown") { volumen(-0.05); showPlayerOverlay(); }
    else if (k === "m" || k === "M") { silenciar(); showPlayerOverlay(); }
    else if (k === "f" || k === "F") { pantallaCompleta(); }
    else if (k === "Escape") { if (document.fullscreenElement) { return; } exitPlayer(); }
    else { return; }
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  /* botón «atrás» del mouse (algunos tienen) */
  document.addEventListener("mouseup", function (e) {
    if (e.button === 3) { e.preventDefault(); press(10009); }
  }, false);

  /* ---------- Instalación: se engancha a las funciones del motor cuando ya están cargadas ---------- */
  function instala() {
    var oTrack = window.scrollTrack;
    var oPage = window.scrollPage;
    var oSet = window.setAreas;
    var oTO = window.setTrackOffset;
    var oChrome = window.renderPlayerChrome;
    var oTime = window.onPlayerTime;
    /* mientras se arrastra (y hasta que el video llega al punto soltado) la barra y las horas siguen al cursor, no al video */
    if (oTime) {
      window.onPlayerTime = function (t) {
        var r = oTime.apply(this, arguments);
        var g = arrastre;
        if (!g && retenido) {
          if (Math.abs(t - retenido.t) < 4 || Date.now() > retenido.hasta) { retenido = null; } else { g = retenido; }
        }
        if (g) { posBarra(g.p); textoTiempo(g.t, g.d); }
        return r;
      };
    }
    /* el control de volumen se añade cada vez que el reproductor arma su barra de botones */
    if (oChrome) { window.renderPlayerChrome = function () { var r = oChrome.apply(this, arguments); try { ponVolumen(); } catch (err) { if (window.console) { console.error("web-pc volumen:", err && err.message); } } return r; }; }
    /* con el mouse el foco cambia sin desplazar: el motor no mueve ni la página ni la fila (con teclado y control, todo igual que siempre) */
    if (oTrack) { window.scrollTrack = function (a) { if (quiet) { return undefined; } return oTrack.apply(this, arguments); }; }
    if (oPage) { window.scrollPage = function (a) { var r; if (quiet) { return undefined; } r = oPage.apply(this, arguments); barra(); return r; }; }
    if (oSet) { window.setAreas = function () { var r = oSet.apply(this, arguments); try { ponBotones(); barra(); } catch (err) { /* sin botones */ } return r; }; }
    if (oTO) { window.setTrackOffset = function (a) { var r = oTO.apply(this, arguments); try { botones(a); } catch (err) { /* nada */ } return r; }; }
    crearBarra();
    window.addEventListener("resize", barra, false);
    setTimeout(barra, 300);
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", instala, false); } else { instala(); }

  /* ---------- Marcador de ruta: al recargar la página (F5) se vuelve a la pantalla donde se estaba ----------
   * Se guarda en sessionStorage (solo esa pestaña): cuenta, perfil, pantalla (inicio/sección, ficha, búsqueda o video) y el título. Al arrancar, en
   * lugar de «¿Quién está viendo?» se entra directo al perfil y se abre lo mismo que antes. Si falta algo (otra cuenta, un título que ya no está),
   * se muestra la selección de perfiles de siempre. Al volver a «¿Quién está viendo?» o cerrar sesión, el marcador se borra. */
  var RUTA_KEY = "hf.ruta";
  var rutaPendiente = null;
  var restaurando = false;
  var rutaTiempo = { k: "", t: 0 }; // último minuto conocido del video (si se recarga antes de que arranque, no se pierde)
  function rutaLeer() { try { var t = window.sessionStorage.getItem(RUTA_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function rutaEscribir(r) {
    try { if (r) { window.sessionStorage.setItem(RUTA_KEY, JSON.stringify(r)); } else { window.sessionStorage.removeItem(RUTA_KEY); } } catch (e) { /* sin almacenamiento */ }
  }
  function rutaTitulo(k) {
    if (!k) { return null; }
    return (window.library && library.titles && library.titles[k]) || (window.HFAnime && HFAnime.byKey ? HFAnime.byKey(k) : null) || null;
  }
  function rutaGuardar() {
    var r = currentRoute;
    var rec;
    var it;
    if (restaurando) { return; }
    if (r === "splash" || r === "login" || r === "profiles" || r === "accounts") { rutaEscribir(null); return; }
    if (!activeProfile || !(r === "browse" || r === "detail" || r === "search" || r === "player")) { return; } // otras pantallas (ajustes, PIN…): se deja la última
    rec = { acc: String(HFLibrary.accountId()), prof: activeProfile.id, route: r, section: browse.section || "home" };
    if (r === "detail" && detail.title) { rec.title = detail.title.titleKey || detail.title.key; rec.season = detail.season || 0; }
    if (r === "player" && player.item) {
      it = player.item;
      rec.title = it.seriesKey || it.titleKey || it.key;
      if (it.type === "episode") { rec.ep = it.key; }
      try { if (HFPlayback.time() > 1) { rutaTiempo = { k: it.key, t: Math.floor(HFPlayback.time()) }; } } catch (e) { /* sin tiempo */ }
      rec.t = rutaTiempo.k === it.key ? rutaTiempo.t : 0;
    }
    if (r === "search") { rec.q = byId("searchInput").value || ""; }
    rutaEscribir(rec);
  }
  var rutaTimer = null;
  function rutaProgramar() { if (rutaTimer) { clearTimeout(rutaTimer); } rutaTimer = setTimeout(function () { rutaTimer = null; try { rutaGuardar(); } catch (e) { /* nada */ } }, 0); }

  /* Tras recargar, el navegador no deja arrancar un video CON sonido hasta que la persona toque la página: el motor lo intenta y se queda en pausa.
   * Aquí, si pasa eso, se arranca SIN sonido y se avisa; con el primer clic o tecla se devuelve el sonido (el clic no pausa el video). */
  function rutaReanudar() {
    var n = 0;
    var listo = 0;
    var t = setInterval(function () {
      var v = video();
      n += 1;
      if (!enPlayer() || n > 120) { clearInterval(t); return; }
      if (!v || v.readyState < 2) { return; }
      if (!v.paused) { clearInterval(t); return; } // arrancó sola (el navegador lo permitió)
      listo += 1;
      if (listo < 3) { return; } // se le da un momento al motor para que lo intente primero
      clearInterval(t);
      v.muted = true;
      var pr = v.play();
      if (pr && pr.catch) { pr.catch(function () { /* sigue en pausa: se puede pulsar play */ }); }
      aviso("Sin sonido · haz clic o pulsa una tecla para activarlo");
      var dalSonido = function (e) {
        var g = null;
        document.removeEventListener("pointerdown", dalSonido, true);
        document.removeEventListener("keydown", dalSonido, true);
        try { g = JSON.parse(localStorage.getItem("hf.vol") || "null"); } catch (err) { g = null; }
        v.muted = !!(g && g.m);
        pintaVol();
        if (e.type === "pointerdown") { tragaClick = true; setTimeout(function () { tragaClick = false; }, 600); }
        if (e.type === "keydown" && (e.key === " " || e.key === "k" || e.key === "K")) { e.preventDefault(); e.stopImmediatePropagation(); }
      };
      document.addEventListener("pointerdown", dalSonido, true);
      document.addEventListener("keydown", dalSonido, true);
    }, 250);
  }

  window.HFWebPc = { reanudar: rutaReanudar }; // js/ui/cast.js lo llama al abrir un video que mandó el celular

  function rutaRestaurar(rec, abrirPerfiles) {
    var acc;
    var p;
    var t;
    var ep;
    if (!rec || !rec.prof || !rec.route) { return false; }
    restaurando = true;
    try {
      abrirPerfiles(""); // prepara los perfiles como siempre (perfil Anime, cuentas vacías…)
      acc = accountById(rec.acc);
      if (acc) { switchAccount(acc); }
      p = profileById(rec.prof);
      if (!p) { return false; }
      enterProfile(p.id);
      if (rec.section && rec.section !== browse.section) { openBrowse(rec.section); }
      if (rec.route === "search") {
        byId("searchInput").value = rec.q || "";
        openSearch();
      } else if (rec.route === "detail" || rec.route === "player") {
        t = rutaTitulo(rec.title);
        if (t) {
          openDetail(t, rec.ep ? { episodeKey: rec.ep } : {});
          /* estaba viendo el video: vuelve al reproductor en el mismo minuto (la ficha queda detrás, como al abrirlo normalmente) */
          if (rec.route === "player") {
            ep = rec.ep ? library.byKey[rec.ep] : (t.type === "movie" ? t : null);
            if (ep) {
              rutaTiempo = { k: ep.key, t: rec.t || 0 };
              openPlayer(ep, rec.t || 0, rec.ep ? t : null);
              rutaReanudar();
              return true;
            }
          }
          if (rec.route === "detail" && rec.season && t.type === "series" && rec.season !== detail.season && t.seasons && t.seasons[rec.season]) {
            detail.season = rec.season;
            renderDetail("actions", 0);
          }
        }
      }
      return true;
    } catch (e) {
      if (window.console) { console.error("web-pc ruta:", e && e.message); }
      return false;
    } finally {
      restaurando = false;
      rutaProgramar();
    }
  }

  function instalaRuta() {
    var oProf = window.openProfiles;
    var oShow = window.showRoute;
    var oBrowse = window.renderBrowse;
    var oDetail = window.renderDetail;
    var oSearch = window.renderSearchResults;
    var oProfFn = oProf;
    rutaPendiente = rutaLeer();
    if (rutaPendiente) { setTimeout(function () { rutaPendiente = null; }, 40000); } // si en 40 s no se llegó a los perfiles, ya no aplica
    if (oShow) { window.showRoute = function () { var r = oShow.apply(this, arguments); rutaProgramar(); return r; }; }
    if (oBrowse) { window.renderBrowse = function () { var r = oBrowse.apply(this, arguments); rutaProgramar(); return r; }; }
    if (oDetail) { window.renderDetail = function () { var r = oDetail.apply(this, arguments); rutaProgramar(); return r; }; }
    if (oSearch) { window.renderSearchResults = function () { var r = oSearch.apply(this, arguments); rutaProgramar(); return r; }; }
    if (oProf) {
      window.openProfiles = function () {
        var rec = rutaPendiente;
        var args = arguments;
        rutaPendiente = null;
        if (rec && !restaurando && rutaRestaurar(rec, function (m) { return oProfFn.call(window, m); })) { return undefined; }
        return oProfFn.apply(this, args);
      };
    }
    setInterval(function () { if (currentRoute === "player") { rutaProgramar(); } }, 5000); // el minuto del video se va anotando
    window.addEventListener("pagehide", function () { try { rutaGuardar(); } catch (e) { /* nada */ } }, false);
    document.addEventListener("input", function (e) { if (e.target && e.target.id === "searchInput") { rutaProgramar(); } }, false);
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", instalaRuta, false); } else { instalaRuta(); }

  /* la mano al pasar por lo que se puede pulsar */
  var st = document.createElement("style");
  st.textContent = 'html[data-web="pc"] [data-focusable="true"] { cursor: pointer; }';
  (document.head || document.documentElement).appendChild(st);
})();
