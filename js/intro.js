/* HomeFlix · intro de marca al abrir la app (TV y celular), al estilo de la de Netflix pero con lo nuestro:
 * un destello dorado, el panda entra con un rebote, debajo «HomeFlix» se revela de izquierda a derecha y al final el logo
 * y las letras se acercan de golpe y se desvanecen sobre el resplandor dorado. Con un «ta-dum» sintetizado (sin archivos de audio).
 * Dura ~3,2 s; un toque o cualquier tecla la saltan. Medidas en vmin: se ve igual en la TV (1920×1080) y en el celular.
 * Solo se anima transform/opacity (GPU) y los efectos se ajustan a la potencia del equipo (tier()).
 *
 *   HFIntro.play({base})   → Promise que se cumple al terminar (base: carpeta raíz de la app, "" en la TV, "../" en mobile/)
 *   HFIntro.active()       → true mientras se ve
 *   HFIntro.skip()         la termina ya (p. ej. con el botón Atrás del celular) */
var HFIntro = (function () {
  "use strict";

  var DUR = 3200;
  var el = null;
  var finish = null;

  /* Todo lo que se mueve es transform u opacity: lo anima la GPU (el compositor) sin repintar, a la frecuencia del panel
   * (120 Hz en celulares que la tienen) y sin trabarse aunque el hilo principal esté ocupado arrancando Telegram.
   * Nada de clip-path, sombras, filtros ni background-position animados (obligan a repintar en cada cuadro). */
  var CSS =
    ".hfi{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;" +
    "contain:strict;will-change:opacity;animation:hfi-out .35s ease-in 2.85s forwards;font-family:'Segoe UI',Roboto,system-ui,-apple-system,Arial,sans-serif}" +
    ".hfi-glow{position:absolute;left:50%;top:50%;width:120vmin;height:120vmin;margin:-60vmin 0 0 -60vmin;border-radius:50%;" +
    "background:radial-gradient(circle,rgba(230,193,147,.5) 0%,rgba(201,154,102,.16) 35%,rgba(0,0,0,0) 65%);opacity:0;transform:scale3d(.3,.3,1);" +
    "will-change:transform,opacity;animation:hfi-glow 2.4s cubic-bezier(.2,.7,.3,1) .1s forwards}" +
    ".hfi-lock{position:relative;display:flex;flex-direction:column;align-items:center;will-change:transform,opacity;animation:hfi-zoom .8s cubic-bezier(.6,0,.9,.4) 2.15s forwards}" +
    ".hfi-mark{position:relative;width:34vmin;height:34vmin;margin-bottom:5vmin}" +
    ".hfi-halo{position:absolute;left:-40%;top:-40%;width:180%;height:180%;border-radius:50%;background:radial-gradient(circle,rgba(230,193,147,.55) 0%,rgba(230,193,147,.18) 38%,rgba(230,193,147,0) 62%);" +
    "opacity:0;will-change:opacity;animation:hfi-fade .7s ease-out .55s forwards}" +
    ".hfi-logo{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:50%;overflow:hidden;background:#121418 center/cover no-repeat;" +
    "box-sizing:border-box;opacity:0;transform:scale3d(.2,.2,1);will-change:transform,opacity;animation:hfi-pop .95s cubic-bezier(.2,.9,.3,1.25) .2s forwards}" +
    ".hfi-ring{position:absolute;left:-7%;top:-7%;width:114%;height:114%;border-radius:50%;border:.5vmin solid rgba(230,193,147,.9);box-sizing:border-box;" +
    "opacity:0;will-change:transform,opacity;animation:hfi-ring 1s ease-out .55s forwards}" +
    /* La palabra es UNA sola capa: se desliza desde la izquierda dentro de un marco que la recorta (barrido hecho por la GPU).
     * Una capa por letra parpadea en algunas GPU (MediaTek/Mali) y el texto con degradado desaparece al escalarse. */
    ".hfi-wwrap{overflow:hidden;padding:.6vmin 1.5vmin}" +
    ".hfi-word{font-size:15vmin;font-weight:800;letter-spacing:-.4vmin;color:#f4f4f2;white-space:nowrap;line-height:1.05;opacity:0;" +
    "transform:translate3d(-104%,0,0);will-change:transform,opacity;animation:hfi-wipe .85s cubic-bezier(.25,.8,.25,1) .9s forwards}" +
    ".hfi-word b{font-weight:800;color:#e3bd8c}" +
    /* extra para equipos potentes: un destello que cruza la marca y chispas doradas */
    /* (dentro del círculo del panda: un brillo que cruza el logo) */
    ".hfi-sheen{position:absolute;left:50%;top:-30%;width:35%;height:160%;margin-left:-17.5%;opacity:0;" +
    "background:linear-gradient(90deg,rgba(255,243,223,0) 0%,rgba(255,243,223,.55) 50%,rgba(255,243,223,0) 100%);will-change:transform,opacity;" +
    "transform:translate3d(-250%,0,0) rotate(20deg);animation:hfi-sheen .9s cubic-bezier(.4,0,.2,1) 1.45s forwards}" +
    ".hfi-spark{position:absolute;left:50%;top:50%;width:1vmin;height:1vmin;margin:-.5vmin 0 0 -.5vmin;border-radius:50%;background:#f6dcb4;opacity:0;will-change:transform,opacity}" +
    "@media (orientation:portrait){.hfi-mark{width:44vmin;height:44vmin;margin-bottom:6vmin}.hfi-word{font-size:16.5vmin;letter-spacing:-.5vmin}}" +
    "@keyframes hfi-glow{0%{opacity:0;transform:scale3d(.3,.3,1)}40%{opacity:1}100%{opacity:.4;transform:scale3d(1.15,1.15,1)}}" +
    "@keyframes hfi-pop{0%{opacity:0;transform:scale3d(.2,.2,1)}55%{opacity:1;transform:scale3d(1.12,1.12,1)}78%{transform:scale3d(.95,.95,1)}100%{opacity:1;transform:scale3d(1,1,1)}}" +
    "@keyframes hfi-fade{to{opacity:1}}" +
    "@keyframes hfi-ring{0%{opacity:.9;transform:scale3d(.85,.85,1)}100%{opacity:0;transform:scale3d(1.5,1.5,1)}}" +
    "@keyframes hfi-wipe{0%{opacity:0;transform:translate3d(-104%,0,0)}25%{opacity:1}100%{opacity:1;transform:translate3d(0,0,0)}}" +
    "@keyframes hfi-sheen{0%{opacity:0;transform:translate3d(-250%,0,0) rotate(20deg)}25%{opacity:1}100%{opacity:0;transform:translate3d(250%,0,0) rotate(20deg)}}" +
    "@keyframes hfi-zoom{0%{transform:scale3d(1,1,1);opacity:1}30%{transform:scale3d(1.06,1.06,1);opacity:1}100%{transform:scale3d(14,14,1);opacity:0}}" +
    "@keyframes hfi-out{to{opacity:0}}" +
    /* «reducir movimiento» del sistema: solo un fundido */
    ".hfi.min .hfi-logo,.hfi.min .hfi-word{transform:none;animation:hfi-fade .6s ease-out .2s forwards}.hfi.min .hfi-ring,.hfi.min .hfi-glow{display:none}.hfi.min .hfi-lock{animation:hfi-out .4s ease-in 2.4s forwards}" +
    /* TV (Tizen): GPU modesta y 60 Hz. Pocas capas y chicas: el resplandor más chico y solo con opacidad (escalar un degradado
     * enorme es lo más caro), sin anillo ni halo, y al final un acercamiento corto en lugar de llenar la pantalla. */
    ".hfi.tv .hfi-glow{width:76vmin;height:76vmin;margin:-38vmin 0 0 -38vmin;transform:none;animation:hfi-glowtv 1.2s ease-out .15s forwards}" +
    ".hfi.tv .hfi-lock{animation:hfi-zoomtv .55s cubic-bezier(.5,0,.8,.4) 2.25s forwards}" +
    "@keyframes hfi-glowtv{from{opacity:0}to{opacity:.8}}" +
    "@keyframes hfi-zoomtv{from{transform:scale3d(1,1,1);opacity:1}to{transform:scale3d(1.25,1.25,1);opacity:0}}";

  /* Cuánta animación aguanta este equipo: «high» (celulares potentes: destello y chispas), «mid» (lo normal), «tv» (TVs
   * Tizen: la versión liviana, ver CSS), «low» (equipos modestos: sin anillo ni resplandor) o «min» (reducir movimiento). */
  function tier() {
    try { if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { return "min"; } } catch (e) { /* nada */ }
    var cores = navigator.hardwareConcurrency || 2;
    var mem = navigator.deviceMemory || 2;
    if (window.tizen) { return "tv"; }
    return cores >= 6 && mem >= 4 ? "high" : cores >= 4 ? "mid" : "low";
  }

  /* Chispas: cada una sale del panda en otra dirección (sus propios keyframes, solo transform y opacity). */
  function sparks(n) {
    var css = "";
    var html = "";
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      var dist = 22 + Math.random() * 22;
      var x = Math.cos(ang) * dist;
      var y = Math.sin(ang) * dist - 9;
      var size = 0.6 + Math.random() * 0.9;
      var delay = 0.5 + Math.random() * 0.25;
      css += "@keyframes hfi-s" + i + "{0%{opacity:0;transform:translate3d(0,-9vmin,0) scale3d(.4,.4,1)}25%{opacity:1}100%{opacity:0;transform:translate3d(" +
        x.toFixed(1) + "vmin," + y.toFixed(1) + "vmin,0) scale3d(" + size.toFixed(2) + "," + size.toFixed(2) + ",1)}}";
      html += '<b class="hfi-spark" style="animation:hfi-s' + i + ' ' + (1 + Math.random() * 0.5).toFixed(2) + 's cubic-bezier(.1,.7,.3,1) ' + delay.toFixed(2) + 's forwards"></b>';
    }
    return { css: css, html: html };
  }

  /* «Ta-dum»: un golpe grave cuando aparece el panda y un acorde cálido que crece con la palabra. */
  function tadum(light) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx;
    if (!AC) { return; }
    try {
      ctx = new AC();
      if (ctx.state === "suspended" && ctx.resume) { ctx.resume(); }
      var t0 = ctx.currentTime + 0.05;
      var out = ctx.createGain();
      out.gain.value = 0.3;
      out.connect(ctx.destination);
      var thump = function (at, from, to, len, vol) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(from, at);
        o.frequency.exponentialRampToValueAtTime(to, at + len);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g);
        g.connect(out);
        o.start(at);
        o.stop(at + len + 0.05);
      };
      thump(t0 + 0.28, 120, 42, 0.42, 1);   // «ta»
      thump(t0 + 0.78, 95, 38, 0.6, 0.9);   // «dum»
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(380, t0 + 0.78);
      lp.frequency.exponentialRampToValueAtTime(1400, t0 + 1.6);
      lp.frequency.exponentialRampToValueAtTime(500, t0 + 3);
      var chord = ctx.createGain();
      chord.gain.setValueAtTime(0.0001, t0 + 0.78);
      chord.gain.exponentialRampToValueAtTime(0.22, t0 + 1.25);
      chord.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.1);
      lp.connect(chord);
      chord.connect(out);
      /* en la TV, menos voces (el mismo acorde, más liviano de calcular) */
      (light ? [55, 110, 164.81] : [55, 82.41, 110, 138.59, 164.81, 220]).forEach(function (f, i) {
        (light ? [0] : [-6, 6]).forEach(function (cents) {
          var o = ctx.createOscillator();
          o.type = i < 2 ? "triangle" : "sawtooth";
          o.frequency.value = f;
          o.detune.value = cents;
          o.connect(lp);
          o.start(t0 + 0.78);
          o.stop(t0 + 3.2);
        });
      });
      setTimeout(function () { try { ctx.close(); } catch (e) { /* nada */ } }, 4000);
    } catch (e) {
      /* sin audio: la intro sigue igual */
    }
  }

  function done() {
    var f = finish;
    finish = null;
    window.removeEventListener("keydown", onKey, true);
    if (el && el.parentNode) { el.parentNode.removeChild(el); }
    el = null;
    if (f) { f(); }
  }

  function onKey(e) {
    /* que la tecla no llegue a la app (en la TV, OK abriría el login) */
    e.preventDefault();
    e.stopPropagation();
    done();
  }

  function play(opts) {
    opts = opts || {};
    if (el) { return Promise.resolve(); }
    return new Promise(function (resolve) {
      finish = resolve;
      var t = tier();
      var sp = t === "high" ? sparks(16) : { css: "", html: "" };
      var st = document.getElementById("hfi-css");
      if (!st) {
        st = document.createElement("style");
        st.id = "hfi-css";
        document.head.appendChild(st);
      }
      st.textContent = CSS + sp.css;
      el = document.createElement("div");
      el.className = "hfi " + t;
      el.innerHTML = '<div class="hfi-glow"></div><div class="hfi-lock"><div class="hfi-mark">' +
        (t === "high" || t === "mid" ? '<div class="hfi-halo"></div><div class="hfi-ring"></div>' : "") +
        '<div class="hfi-logo">' + (t === "high" ? '<div class="hfi-sheen"></div>' : "") + "</div></div>" +
        '<div class="hfi-wwrap"><div class="hfi-word">Home<b>Flix</b></div></div></div>' +
        (t === "high" ? sp.html : "");
      el.querySelector(".hfi-logo").style.backgroundImage = "url(" + (opts.base || "") + "images/logo.png)";
      el.addEventListener("click", done, false);
      el.addEventListener("touchstart", done, { passive: true });
      window.addEventListener("keydown", onKey, true);
      document.body.appendChild(el);
      tadum(t === "tv" || t === "low");
      setTimeout(done, DUR);
    });
  }

  return {
    play: play,
    active: function () { return !!el; },
    skip: done
  };
})();
