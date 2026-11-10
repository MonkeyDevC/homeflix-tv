/* HomeFlix · TV en vivo (IPTV): la lista M3U del usuario y su reproducción.
 *
 * HomeFlix es solo el reproductor: cada cuenta pone el enlace M3U de SU proveedor (Ajustes del celular o de la TV) y
 * se sincroniza entre dispositivos (HFLibrary.iptv / js/sync.js). No trae listas ni proveedores.
 *
 *   HFIptv.parse(texto)          → {channels: [...], groups: [{name, count}], epg}
 *   HFIptv.load({force})         → Promise<{channels, groups, at, url, fromCache}> (caché de 12 h en IndexedDB)
 *   HFIptv.byGroup(data, name)   → canales del grupo («Todos» / «Favoritos» incluidos)
 *
 * Cada canal: {key, num, name, logo, group, url, tvgId, ua, ref, kind: "live"|"movie"}
 * key = grupo|nombre normalizados: no cambia si el proveedor renueva los tokens de las URL (favoritos estables).
 *
 *   HFLive.play(canal, contenedor, alEstado)  reproduce: en la TV con AVPlay (el reproductor nativo de Samsung:
 *                                             HLS, MPEG-TS, HEVC, AC3… por hardware); fuera de la TV con <video> y,
 *                                             para HLS, hls.js (solo para probar en el navegador).
 *   HFLive.stop()                             corta y suelta el reproductor
 *   alEstado(estado, detalle): "cargando" | "reproduciendo" | "esperando" | "error" */
var HFIptv = (function () {
  "use strict";

  var MAX_AGE = 12 * 3600 * 1000;
  var mem = null; // la última lista leída en esta sesión

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* atributos tvg-id="…" del #EXTINF; el nombre va después de la primera coma fuera de comillas */
  function parseExtinf(line) {
    var body = line.replace(/^#EXTINF:/i, "");
    var inQ = false;
    var cut = -1;
    var i;
    var attrs = {};
    var m;
    var re = /([A-Za-z0-9_-]+)="([^"]*)"/g;
    for (i = 0; i < body.length; i += 1) {
      if (body[i] === '"') { inQ = !inQ; }
      else if (body[i] === "," && !inQ) { cut = i; break; }
    }
    var head = cut >= 0 ? body.slice(0, cut) : body;
    while ((m = re.exec(head))) { attrs[m[1].toLowerCase()] = m[2]; }
    return { attrs: attrs, name: (cut >= 0 ? body.slice(cut + 1) : "").trim() };
  }

  function nameFromUrl(u) {
    var s = String(u || "").split(/[?#]/)[0].split("/").pop() || "Canal";
    try { s = decodeURIComponent(s); } catch (e) { /* tal cual */ }
    return s.replace(/\.[a-z0-9]{2,4}$/i, "");
  }

  function parse(text) {
    var lines = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
    var channels = [];
    var groups = [];
    var gIndex = {};
    var keys = {};
    var epg = "";
    var cur = null;
    var extgrp = "";
    var n = 0;
    lines.forEach(function (raw) {
      var l = raw.trim();
      var info;
      var kv;
      if (!l) { return; }
      if (/^#EXTM3U/i.test(l)) {
        info = parseExtinf("#EXTINF:" + l.replace(/^#EXTM3U/i, "") + ",");
        epg = info.attrs["url-tvg"] || info.attrs["x-tvg-url"] || epg;
        return;
      }
      if (/^#EXTINF/i.test(l)) {
        info = parseExtinf(l);
        cur = { attrs: info.attrs, name: info.name };
        return;
      }
      if (/^#EXTGRP:/i.test(l)) { extgrp = l.slice(8).trim(); return; }
      if (/^#EXTVLCOPT:/i.test(l)) {
        kv = l.slice(11).split("=");
        cur = cur || { attrs: {}, name: "" };
        if (/user-agent/i.test(kv[0])) { cur.ua = kv.slice(1).join("="); }
        if (/referr?er/i.test(kv[0])) { cur.ref = kv.slice(1).join("="); }
        return;
      }
      if (l.charAt(0) === "#") { return; }
      /* la URL cierra el canal */
      cur = cur || { attrs: {}, name: "" };
      var a = cur.attrs;
      var name = cur.name || a["tvg-name"] || nameFromUrl(l);
      var group = a["group-title"] || extgrp || "Sin grupo";
      var key = norm(group) + "|" + norm(name);
      n += 1;
      if (keys[key]) { keys[key] += 1; key += "#" + keys[key]; } else { keys[key] = 1; }
      channels.push({
        key: key,
        num: Number(a["tvg-chno"]) || n,
        name: name,
        logo: a["tvg-logo"] || "",
        group: group,
        url: l,
        tvgId: a["tvg-id"] || "",
        ua: cur.ua || a["user-agent"] || "",
        ref: cur.ref || a.referrer || "",
        kind: /\.(mp4|mkv|avi|mov|m4v|wmv)(\?|$)/i.test(l) ? "movie" : "live"
      });
      if (!gIndex.hasOwnProperty(group)) { gIndex[group] = groups.length; groups.push({ name: group, count: 0 }); }
      groups[gIndex[group]].count += 1;
      cur = null;
    });
    return { channels: channels, groups: groups, epg: epg };
  }

  /* ----- caché en IndexedDB (las listas pueden pesar varios MB) ----- */
  var dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise(function (resolve) {
        var r;
        try { r = window.indexedDB.open("hf-iptv", 1); } catch (e) { resolve(null); return; }
        r.onupgradeneeded = function () { r.result.createObjectStore("listas"); };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { resolve(null); };
      });
    }
    return dbp;
  }
  function cacheGet(url) {
    return db().then(function (d) {
      if (!d) { return null; }
      return new Promise(function (resolve) {
        var g;
        try { g = d.transaction("listas", "readonly").objectStore("listas").get(url); } catch (e) { resolve(null); return; }
        g.onsuccess = function () { resolve(g.result || null); };
        g.onerror = function () { resolve(null); };
      });
    });
  }
  function cachePut(url, value, keep) {
    return db().then(function (d) {
      if (!d) { return; }
      try {
        var t = d.transaction("listas", "readwrite");
        if (!keep) { t.objectStore("listas").clear(); }
        t.objectStore("listas").put(value, url);
      } catch (e) { /* sin caché: se vuelve a bajar la próxima vez */ }
    });
  }

  /* La TV (paquete Tizen con <access origin="*">) puede pedir la lista a cualquier servidor.
   * En el celular la página vive en https y el navegador bloquea (CORS / contenido mixto): m.js pone aquí un lector
   * nativo (HFIptv.setFetcher) que baja el texto desde Java. Sin él se intenta con XHR (sirve en la TV y en la PC). */
  var fetcher = null;
  function download(url) {
    if (fetcher) {
      return fetcher(url, "").then(function (t) {
        if (t == null) { throw new Error("No se pudo descargar la lista. Revisa el enlace o tu conexión."); }
        return t;
      });
    }
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.timeout = 90000;
      x.onload = function () {
        if (x.status && (x.status < 200 || x.status >= 300)) { reject(new Error("El proveedor respondió " + x.status + " al pedir la lista.")); return; }
        resolve(x.responseText || "");
      };
      x.onerror = function () { reject(new Error("No se pudo descargar la lista. Revisa el enlace o tu conexión.")); };
      x.ontimeout = function () { reject(new Error("La lista tardó demasiado en descargarse.")); };
      x.send();
    });
  }

  function config() {
    var c = typeof HFLibrary !== "undefined" && HFLibrary.iptv ? HFLibrary.iptv() : null;
    return c && c.url ? c : null;
  }

  function load(opts) {
    var c = config();
    var force = !!(opts && opts.force);
    if (!c) { return Promise.reject(new Error("Todavía no hay una lista de TV en vivo.")); }
    if (!force && mem && mem.url === c.url && Date.now() - mem.at < MAX_AGE) { return Promise.resolve(mem); }
    return (force ? Promise.resolve(null) : cacheGet(c.url)).then(function (hit) {
      if (hit && hit.channels && Date.now() - hit.at < MAX_AGE) {
        mem = Object.assign({ fromCache: true }, hit);
        return mem;
      }
      return download(c.url).then(function (text) {
        var p = parse(text);
        if (!p.channels.length) {
          throw new Error(/#EXTM3U|#EXTINF/i.test(text) ? "La lista no tiene canales." : "Ese enlace no devolvió una lista M3U.");
        }
        mem = { url: c.url, at: Date.now(), channels: p.channels, groups: p.groups, epg: p.epg, fromCache: false };
        cachePut(c.url, { url: mem.url, at: mem.at, channels: mem.channels, groups: mem.groups, epg: mem.epg });
        return mem;
      }, function (e) {
        /* sin internet o el proveedor caído: la copia vieja sirve mientras tanto */
        if (hit && hit.channels) { mem = Object.assign({ fromCache: true, stale: true }, hit); return mem; }
        throw e;
      });
    });
  }

  /* ----- Guía de programación (XMLTV): lo que pasa ahora en cada canal -----
   * La M3U trae la dirección en #EXTM3U url-tvg="…". Se baja una vez (3 h de caché), y solo se guardan los programas
   * de los canales de la lista que caen entre hace 1 h y dentro de 14 h (los XMLTV completos pesan decenas de MB). */
  var epgMap = {};   // tvgId → [{s, e, t, d, i}] ordenado por inicio (s y e en ms)
  var epgFor = "";   // la dirección de la que salen
  var epgAt = 0;
  var epgBusy = null;
  var EPG_AGE = 3 * 3600 * 1000;

  function xmlText(s) {
    return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  }
  function xmltvTime(s) {
    var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-]\d{4})?/.exec(String(s || "").trim());
    var t;
    if (!m) { return 0; }
    t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) { t -= ((m[7].charAt(0) === "-" ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5)))) * 60000; }
    return t;
  }
  function parseXmltv(xml, wanted) {
    var out = {};
    var now = Date.now();
    var lo = now - 3600000;
    var hi = now + 14 * 3600000;
    var re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    var m;
    while ((m = re.exec(xml))) {
      var head = m[1];
      var ch = /channel="([^"]*)"/.exec(head);
      var st = /start="([^"]*)"/.exec(head);
      var en = /stop="([^"]*)"/.exec(head);
      var id = ch && xmlText(ch[1]);
      var s, e, body, t, d, ic;
      if (!id || !wanted[id] || !st || !en) { continue; }
      s = xmltvTime(st[1]);
      e = xmltvTime(en[1]);
      if (e < lo || s > hi) { continue; }
      body = m[2];
      t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(body);
      d = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(body);
      ic = /<icon\b[^>]*src="([^"]*)"/.exec(body);
      (out[id] = out[id] || []).push({ s: s, e: e, t: t ? xmlText(t[1]) : "", d: d ? xmlText(d[1]) : "", i: ic ? xmlText(ic[1]) : "" });
    }
    Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.s - b.s; }); });
    return out;
  }
  function gunzipText(url) {
    /* .xml.gz: se descomprime con DecompressionStream si el navegador lo trae (si no, no hay guía) */
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true);
      x.responseType = "arraybuffer";
      x.timeout = 120000;
      x.onload = function () {
        var bytes = new Uint8Array(x.response || []);
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          if (typeof DecompressionStream === "undefined") { reject(new Error("sin gzip")); return; }
          new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text().then(resolve, reject);
        } else {
          resolve(new TextDecoder("utf-8").decode(bytes));
        }
      };
      x.onerror = function () { reject(new Error("sin guía")); };
      x.ontimeout = x.onerror;
      x.send();
    });
  }
  /* Devuelve una promesa que se cumple cuando la guía quedó lista (o no hay: nunca falla, la interfaz sigue sin ella). */
  function loadEpg(data) {
    var url = data && data.epg;
    var wanted = {};
    if (!url) { return Promise.resolve(false); }
    if (epgFor === url && Date.now() - epgAt < EPG_AGE) { return Promise.resolve(true); }
    if (epgBusy && epgBusy.url === url) { return epgBusy.p; }
    data.channels.forEach(function (c) { if (c.tvgId) { wanted[c.tvgId] = 1; } });
    var p = cacheGet("epg:" + url).then(function (hit) {
      if (hit && hit.map && Date.now() - hit.at < EPG_AGE) { epgMap = hit.map; epgFor = url; epgAt = hit.at; return true; }
      return (fetcher ? fetcher(url, "epg") : gunzipText(url)).then(function (xml) {
        epgMap = parseXmltv(xml || "", wanted);
        epgFor = url;
        epgAt = Date.now();
        cachePut("epg:" + url, { map: epgMap, at: epgAt }, true);
        return true;
      });
    }).then(function (ok) { epgBusy = null; return ok; }, function () { epgBusy = null; return false; });
    epgBusy = { url: url, p: p };
    return p;
  }
  /* Lo que se ve ahora en el canal: {title, desc, icon, start, end, left (min), pct, next} o null si no hay guía */
  function now(ch, at) {
    var list = ch && ch.tvgId ? epgMap[ch.tvgId] : null;
    var t = at || Date.now();
    var i;
    if (!list) { return null; }
    for (i = 0; i < list.length; i += 1) {
      if (list[i].s <= t && t < list[i].e) {
        return {
          title: list[i].t, desc: list[i].d, icon: list[i].i, start: list[i].s, end: list[i].e,
          left: Math.max(1, Math.ceil((list[i].e - t) / 60000)),
          pct: Math.max(0, Math.min(100, ((t - list[i].s) / (list[i].e - list[i].s)) * 100)),
          next: list[i + 1] ? { title: list[i + 1].t, start: list[i + 1].s } : null
        };
      }
    }
    return null;
  }
  /* «quedan 17 m» / «quedan 1 h 05 m» */
  function leftText(min) {
    return min >= 60 ? "quedan " + Math.floor(min / 60) + " h " + ("0" + (min % 60)).slice(-2) + " m" : "quedan " + min + " m";
  }

  function byGroup(data, group) {
    var favs;
    if (!data) { return []; }
    if (group === "__fav") {
      favs = typeof HFLibrary !== "undefined" && HFLibrary.iptvFavs ? HFLibrary.iptvFavs() : {};
      return data.channels.filter(function (c) { return favs[c.key]; });
    }
    if (group === "__all") { return data.channels; }
    return data.channels.filter(function (c) { return c.group === group; });
  }

  return {
    parse: parse, load: load, byGroup: byGroup, config: config, norm: norm,
    loadEpg: loadEpg, now: now, leftText: leftText, parseXmltv: parseXmltv,
    setFetcher: function (f) { fetcher = f; }
  };
}());

var HFLive = (function () {
  "use strict";

  var session = 0;
  var watchdog = null;
  var hls = null;
  var hlsLoading = null;
  var current = null;   // {av|native|video, ch, state}
  var layerEl = null;
  var curRect = null;
  var stateCb = null;

  function avplay() {
    try { return window.webapis && window.webapis.avplay ? window.webapis.avplay : null; } catch (e) { return null; }
  }
  function usesAv() { return !!avplay(); }
  /* Celular: el APK nuevo trae ExoPlayer (HFAndroid.liveOpen); el viejo no, y entonces se prueba con <video> + hls.js */
  function nativeLive() {
    try { return window.HFAndroid && typeof window.HFAndroid.liveOpen === "function" ? window.HFAndroid : null; } catch (e) { return null; }
  }

  /* hls.js solo para probar en el navegador de la PC (la TV usa AVPlay, el celular nuevo ExoPlayer) */
  function loadHls() {
    if (window.Hls) { return Promise.resolve(window.Hls); }
    if (!hlsLoading) {
      hlsLoading = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
        s.onload = function () { resolve(window.Hls); };
        s.onerror = function () { hlsLoading = null; reject(new Error("No pude cargar el reproductor HLS.")); };
        document.head.appendChild(s);
      });
    }
    return hlsLoading;
  }

  function avErrorText(t) {
    var s = String(t || "");
    if (/CONNECTION_FAILED|NETWORK/i.test(s)) { return "No hay conexión con el canal."; }
    if (/NOT_SUPPORTED|UNSUPPORTED/i.test(s)) { return "La TV no puede reproducir este formato."; }
    if (/INVALID_URI|NOT_FOUND|404/i.test(s)) { return "El canal ya no está disponible en ese enlace."; }
    return "El canal no se pudo reproducir" + (s ? " (" + s + ")" : "") + ".";
  }

  /* La capa del video: un solo contenedor que se mueve (vista previa chica ↔ pantalla completa) sin cortar el canal.
   * En la TV va como primer hijo de #app (AVPlay dibuja detrás de la página y las pantallas quedan transparentes
   * donde se ve el video); en el celular la pone m.js con HFLive.attach(). */
  function layer() {
    if (!layerEl) {
      layerEl = document.createElement("div");
      layerEl.id = "lvMedia";
      layerEl.className = "lv-media";
      var app = document.getElementById("app");
      if (app) { app.insertBefore(layerEl, app.firstChild); } else { document.body.appendChild(layerEl); }
    }
    return layerEl;
  }
  function attach(el) { layerEl = el; return el; }

  /* rect: {x, y, w, h} en píxeles de la página (en la TV, de 1920×1080) */
  function place(rect) {
    var av = avplay();
    var nat = nativeLive();
    var el = layerEl;
    curRect = rect || curRect;
    if (!curRect) { return; }
    if (el && el.id === "lvMedia") {
      el.style.left = curRect.x + "px";
      el.style.top = curRect.y + "px";
      el.style.width = curRect.w + "px";
      el.style.height = curRect.h + "px";
    }
    if (av && current && current.av) {
      try { av.setDisplayRect(Math.round(curRect.x), Math.round(curRect.y), Math.round(curRect.w), Math.round(curRect.h)); } catch (e) { /* sin imagen aún */ }
    }
    if (nat && current && current.native) {
      try { nat.liveRect(curRect.x, curRect.y, curRect.w, curRect.h); } catch (e2) { /* nada */ }
    }
  }

  function stop() {
    var av = avplay();
    var nat = nativeLive();
    session += 1;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (av && current && current.av) {
      try { av.stop(); } catch (e) { /* ya estaba parado */ }
      try { av.close(); } catch (e2) { /* ya estaba cerrado */ }
    }
    if (nat && current && current.native) { try { nat.liveStop(); } catch (e5) { /* nada */ } }
    if (hls) { try { hls.destroy(); } catch (e3) { /* nada */ } hls = null; }
    if (current && current.video) {
      try { current.video.pause(); current.video.removeAttribute("src"); current.video.load(); } catch (e4) { /* nada */ }
    }
    document.documentElement.classList.remove("hf-live-av");
    document.documentElement.classList.remove("hf-live-on");
    current = null;
    stateCb = null;
  }

  /* ExoPlayer avisa con HFNative.live(estado, detalle) (lo define m.js y llama a HFLive.nativeEvent) */
  function nativeEvent(st, detail) {
    if (!current || !current.native || !stateCb) { return; }
    if (st === "reproduciendo" && watchdog) { clearTimeout(watchdog); watchdog = null; }
    current.state = st;
    stateCb(st, detail || "");
  }

  function play(ch, container, onState, rect) {
    var my;
    var av;
    var nat;
    /* el mismo canal ya suena: solo se reubica (vista previa ↔ pantalla completa) */
    if (current && current.ch && current.ch.key === ch.key && current.ch.url === ch.url && current.state !== "error") {
      if (rect) { place(rect); }
      stateCb = onState || null;
      if (onState) { onState(current.state || "cargando", ""); }
      return;
    }
    stop();
    session += 1;
    my = session;
    stateCb = onState || null;
    var say = function (st, detail) { if (my !== session) { return; } if (current) { current.state = st; } if (onState) { onState(st, detail || ""); } };
    var fail = function (msg) { if (my !== session) { return; } if (watchdog) { clearTimeout(watchdog); watchdog = null; } say("error", msg); };
    av = avplay();
    nat = nativeLive();
    container = container || layer();
    if (rect) { curRect = rect; }
    document.documentElement.classList.add("hf-live-on");
    watchdog = setTimeout(function () { fail("El canal no respondió. Puede estar caído o tu conexión es lenta."); }, 25000);
    var ok = function () { if (my !== session) { return; } if (watchdog) { clearTimeout(watchdog); watchdog = null; } say("reproduciendo"); };

    if (av) {
      /* AVPlay dibuja el video DETRÁS de la página: el <object> marca dónde, y el fondo de la app queda transparente */
      var obj = container.querySelector("object.hf-live-av");
      if (!obj) {
        obj = document.createElement("object");
        obj.className = "hf-live-av";
        obj.setAttribute("type", "application/avplayer");
        container.insertBefore(obj, container.firstChild);
      }
      document.documentElement.classList.add("hf-live-av");
      current = { av: true, ch: ch, state: "cargando" };
      say("cargando");
      try {
        av.open(ch.url);
        if (ch.ua) { try { av.setStreamingProperty("USER_AGENT", ch.ua); } catch (e) { /* algunas TVs no lo aceptan */ } }
        av.setListener({
          onbufferingstart: function () { say("esperando"); },
          onbufferingprogress: function () {},
          onbufferingcomplete: function () { ok(); },
          oncurrentplaytime: function () {},
          onstreamcompleted: function () { fail(ch.kind === "live" ? "La transmisión del canal terminó." : "Terminó."); },
          onerror: function (t) { fail(avErrorText(t)); },
          onevent: function () {},
          onsubtitlechange: function () {},
          ondrmevent: function () {}
        });
        var r = curRect || { x: 0, y: 0, w: 1920, h: 1080 };
        av.setDisplayRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
        try { av.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX"); } catch (e2) { /* modelos viejos */ }
        av.prepareAsync(function () {
          if (my !== session) { return; }
          try { av.play(); ok(); } catch (e) { fail(avErrorText(e && e.name)); }
        }, function (e) { fail(avErrorText(e && (e.name || e.message))); });
      } catch (e) {
        fail(avErrorText(e && (e.name || e.message)));
      }
      return;
    }

    if (nat) {
      /* celular con el APK nuevo: ExoPlayer sobre el WebView, en el rectángulo de la página */
      current = { native: true, ch: ch, state: "cargando" };
      say("cargando");
      var rr = curRect || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
      try { nat.liveOpen(ch.url, ch.ua || "", ch.ref || "", rr.x, rr.y, rr.w, rr.h); } catch (e3) { fail("No se pudo abrir el reproductor del celular."); }
      return;
    }

    /* Fuera de la TV (para probar): <video>, con hls.js si el navegador no reproduce HLS solo */
    var video = container.querySelector("video.hf-live-video");
    if (!video) {
      video = document.createElement("video");
      video.className = "hf-live-video";
      video.setAttribute("playsinline", "");
      container.insertBefore(video, container.firstChild);
    }
    current = { video: video, ch: ch, state: "cargando" };
    say("cargando");
    video.onplaying = ok;
    video.onwaiting = function () { say("esperando"); };
    video.onerror = function () { fail("El canal no se pudo reproducir en este navegador."); };
    var isHls = /\.m3u8(\?|$)/i.test(ch.url) || /m3u8|hls/i.test(ch.url);
    if (isHls && !video.canPlayType("application/vnd.apple.mpegurl")) {
      loadHls().then(function (Hls) {
        if (my !== session) { return; }
        if (!Hls || !Hls.isSupported()) { fail("Este navegador no reproduce HLS."); return; }
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, function (ev, d) { if (d && d.fatal) { fail("El canal no se pudo reproducir (" + (d.details || d.type) + ")."); } });
        hls.loadSource(ch.url);
        hls.attachMedia(video);
        video.play().catch(function () { /* se reintenta al estar listo */ });
      }, function (e) { fail(e.message); });
    } else {
      video.src = ch.url;
      video.play().catch(function () { /* el error llega por onerror */ });
    }
  }

  return {
    play: play, stop: stop, place: place, layer: layer, attach: attach, usesAv: usesAv, nativeEvent: nativeEvent,
    native: function () { return !!nativeLive(); },
    video: function () { return current && current.video || null; },
    current: function () { return current && current.ch; },
    state: function () { return current ? current.state : ""; }
  };
}());
