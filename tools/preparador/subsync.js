/* HomeFlix · Preparador · ajustar los tiempos de un subtítulo a otro que ya está bien (por ejemplo, el inglés al
 * español verificado de la misma película). Solo cambian los tiempos; el texto queda igual.
 *
 * Se busca la transformación t' = t·velocidad + corrimiento que más hace coincidir los diálogos de los dos:
 *   - velocidad: 1, o el cambio entre 23,976 / 24 / 25 cuadros por segundo (un .srt hecho para otra copia),
 *   - corrimiento: hasta ±3 minutos, primero en pasos de 0,25 s y después afinado a 0,02 s.
 * Después, por tramos de 4 minutos, se afina el corrimiento local (±6 s) por si la otra copia tiene una escena de más
 * o de menos; se usa solo si mejora de verdad la coincidencia.
 * «Coincidencia» = qué parte de las líneas cae dentro de un diálogo del subtítulo de referencia.
 *
 *   HFSubSync.sync(refText, text) → {text, speed, offset, tramos, before, after, cues, igual?, dudoso?}
 *     igual: ya estaba bien (no se cambió nada) · dudoso: ni ajustado coincide (no se cambió nada; avisar)
 *   HFSubSync.decode(bytes)       → texto (UTF-8, o Windows-1252 si no lo es) */
var HFSubSync = (function () {
  "use strict";

  var TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

  function decode(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var t = new TextDecoder("utf-8").decode(u8);
    if (t.indexOf("�") >= 0) { t = new TextDecoder("windows-1252").decode(u8); }
    return t.replace(/^﻿/, "");
  }

  function sec(h, m, s, ms) { return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number((ms + "00").slice(0, 3)) / 1000; }

  function parse(text) {
    var lines = text.split(/\r?\n/);
    var cues = [];
    lines.forEach(function (l, i) {
      var m = TIME.exec(l);
      if (m) { cues.push({ s: sec(m[1], m[2], m[3], m[4]), e: sec(m[5], m[6], m[7], m[8]), line: i }); }
    });
    return { lines: lines, cues: cues };
  }

  function fmt(t) {
    t = Math.max(0, t);
    var ms = Math.round(t * 1000);
    var h = Math.floor(ms / 3600000);
    var m = Math.floor(ms % 3600000 / 60000);
    var s = Math.floor(ms % 60000 / 1000);
    var x = ms % 1000;
    var p = function (n, w) { return String(n).padStart(w, "0"); };
    return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(x, 3);
  }

  /* qué parte de los centros de las líneas cae dentro de un diálogo de la referencia (con 0,3 s de margen) */
  function scorer(ref) {
    var st = ref.map(function (c) { return c.s - 0.3; });
    var en = ref.map(function (c) { return c.e + 0.3; });
    return function (mids) {
      var hit = 0;
      var j = 0;
      for (var i = 0; i < mids.length; i += 1) {
        var x = mids[i];
        while (j < en.length && en[j] < x) { j += 1; }
        if (j < st.length && st[j] <= x) { hit += 1; }
      }
      return mids.length ? hit / mids.length : 0;
    };
  }

  function mids(cues, speed, offset) {
    return cues.map(function (c) { return (c.s + c.e) / 2 * speed + offset; }).sort(function (a, b) { return a - b; });
  }

  /* el mejor corrimiento; si varios empatan (una meseta), el del medio: es el más centrado */
  function best(cues, score, speed, from, to, step) {
    var b = { offset: 0, score: -1 };
    var lo = 0;
    var hi = 0;
    for (var o = from; o <= to + 1e-9; o += step) {
      var sc = score(mids(cues, speed, o));
      if (sc > b.score + 1e-9) { b = { offset: o, score: sc }; lo = o; hi = o; }
      else if (Math.abs(sc - b.score) <= 1e-9 && Math.abs(o - hi - step) < step / 2) { hi = o; }
    }
    b.offset = (lo + hi) / 2;
    return b;
  }

  var FPS = [23.976, 24, 25];
  function speeds() {
    var out = [1];
    FPS.forEach(function (a) { FPS.forEach(function (b) { if (a !== b) { out.push(a / b); } }); });
    return out;
  }

  function sync(refText, text) {
    var ref = parse(refText).cues.slice().sort(function (a, b) { return a.s - b.s; });
    var src = parse(text);
    var cues = src.cues;
    if (ref.length < 20 || cues.length < 20) { throw new Error("Uno de los dos subtítulos tiene muy pocas líneas para comparar"); }
    var score = scorer(ref);
    var before = score(mids(cues, 1, 0));
    /* 1) velocidad y corrimiento de toda la película */
    var g = { speed: 1, offset: 0, score: -1 };
    speeds().forEach(function (sp) {
      var c = best(cues, score, sp, -180, 180, 0.25);
      if (c.score > g.score + 1e-6) { g = { speed: sp, offset: c.offset, score: c.score }; }
    });
    var fine = best(cues, score, g.speed, g.offset - 0.5, g.offset + 0.5, 0.02);
    g.offset = fine.offset;
    g.score = fine.score;
    /* 2) por tramos de 4 minutos, por si una copia tiene escenas de más o de menos */
    var span = 240;
    var last = cues.length ? cues[cues.length - 1].e * g.speed + g.offset : 0;
    var points = [];
    for (var a = 0; a < last; a += span) {
      var inWin = cues.filter(function (c) { var m = (c.s + c.e) / 2 * g.speed + g.offset; return m >= a && m < a + span; });
      if (inWin.length < 10) { continue; }
      var l = best(inWin, score, g.speed, g.offset - 6, g.offset + 6, 0.1);
      l = best(inWin, score, g.speed, l.offset - 0.15, l.offset + 0.15, 0.02);
      points.push({ t: a + span / 2, offset: l.offset, score: l.score });
    }
    /* mediana de 3 para que un tramo raro no mueva todo */
    var smooth = points.map(function (p, i) {
      var v = points.slice(Math.max(0, i - 1), i + 2).map(function (x) { return x.offset; }).sort(function (x, y) { return x - y; });
      return { t: p.t, offset: v[Math.floor(v.length / 2)] };
    });
    /* cada línea toma el corrimiento de su tramo; entre dos tramos distintos, el que mejor le calza a esa línea
     * (así un corte queda como un salto limpio y no repartido en 4 minutos) */
    function offsetAt(t) {
      if (!smooth.length) { return g.offset; }
      var i = 0;
      while (i < smooth.length - 1 && Math.abs(smooth[i + 1].t - t) < Math.abs(smooth[i].t - t)) { i += 1; }
      return smooth[i].offset;
    }
    var localMids = cues.map(function (c) { var m = (c.s + c.e) / 2 * g.speed; return m + offsetAt(m + g.offset); }).sort(function (x, y) { return x - y; });
    var localScore = score(localMids);
    var useLocal = smooth.length >= 3 && localScore > g.score + 0.02;
    var map = function (t) { var x = t * g.speed; return x + (useLocal ? offsetAt(x + g.offset) : g.offset); };
    var after = useLocal ? localScore : g.score;
    /* si ni ajustado coincide (otra película, otro corte o un archivo incompleto), no se toca y se avisa */
    if (after < 0.7) {
      return { text: text, speed: 1, offset: 0, tramos: null, before: before, after: before, cues: cues.length, dudoso: true, mejor: after };
    }
    /* si ya estaba bien, no se toca */
    if (after - before < 0.015) {
      return { text: text, speed: 1, offset: 0, tramos: null, before: before, after: before, cues: cues.length, igual: true };
    }
    /* 3) reescribir solo las líneas de tiempo */
    var lines = src.lines.slice();
    cues.forEach(function (c) {
      var s = map(c.s);
      var e = Math.max(s + 0.2, map(c.e));
      lines[c.line] = lines[c.line].replace(TIME, fmt(s) + " --> " + fmt(e));
    });
    var offs = useLocal ? smooth.map(function (p) { return p.offset; }) : [g.offset];
    return {
      text: lines.join("\r\n"),
      speed: g.speed,
      offset: g.offset,
      tramos: useLocal ? { min: Math.min.apply(null, offs), max: Math.max.apply(null, offs), n: smooth.length } : null,
      before: before,
      after: useLocal ? localScore : g.score,
      cues: cues.length
    };
  }

  /* coincidencia tal cual, sin mover nada (rápido: para saber si ya va al compás) */
  function score(refText, text) {
    var ref = parse(refText).cues.slice().sort(function (a, b) { return a.s - b.s; });
    var cues = parse(text).cues;
    if (ref.length < 20 || cues.length < 20) { return null; }
    return scorer(ref)(mids(cues, 1, 0));
  }

  return { sync: sync, decode: decode, parse: parse, score: score };
})();
if (typeof module !== "undefined") { module.exports = HFSubSync; }
