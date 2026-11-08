/* Motor de reproducción detrás de la pantalla del reproductor.
 *
 * Contrato que usa la interfaz (main.js):
 *   HFPlayback.open(item, startAt, events)
 *       events: {onTime(t, dur, buffered), onState("loading"|"buffering"|"playing"|"paused"), onEnded(),
 *                onError(msg), onNote(msg), onTracks()}
 *   HFPlayback.play() / pause() / toggle() / seek(t) / time() / duration() / playing() / close()
 *   HFPlayback.tracks()          → {audio: [{key, label, current, ok}], subs: [{key, label, current}]}
 *   HFPlayback.setAudio(key)     cambia de pista de audio (reabre en el mismo punto)
 *   HFPlayback.setSub(key|null)  muestra una pista de subtítulos o ninguna
 *   HFPlayback.qualities()       → {auto, current: {q}, list: [{key, q}]} o null si el video tiene una sola versión
 *
 * Partes: una versión puede venir en varios archivos («parte 1 de 7»…, tools/preparador). Se reproducen seguidos como una
 * sola película: el tiempo, la duración y los saltos son los de la película entera; al terminar una parte se abre la
 * siguiente en el segundo 0, y saltar a otro punto abre la parte que corresponde.
 *   HFPlayback.setQuality(key|"auto")  elige una calidad a mano (se recuerda) o vuelve a la automática
 *   HFPlayback.simulated         true si este video usa el simulador (datos de demostración o sin motor)
 *
 * Motor real: js/engine/player.js de titlog/telegram-tizen (MIT): MediaSource + MP4/MKV propios, bytes desde Telegram.
 * Simulador: para la biblioteca de demostración y para diseñar sin Telegram. */
var HFPlayback = (function () {
  "use strict";

  var api = { simulated: true };
  var ev = null;
  var item = null;
  var videoKey = "";
  var prefKey = "";

  /* ===================== Preferencias por video (audio y subtítulos elegidos) ===================== */

  function pref(name, value) {
    /* prefKey: el video «de identidad» del título (igual en todas sus calidades) */
    var k = "hf." + name + "." + (prefKey || videoKey);
    try {
      if (value === undefined) {
        return window.localStorage.getItem(k);
      }
      if (value === null) {
        window.localStorage.removeItem(k);
      } else {
        window.localStorage.setItem(k, value);
      }
    } catch (e) {
      /* sin almacenamiento */
    }
    return null;
  }

  /* ===================== Caché del índice (moov / cabecera MKV) en IndexedDB =====================
   * Reanudar un video de 2 GB sin caché vuelve a bajar varios MB de índice; con caché arranca en ~2 s. Se guardan 12. */

  var dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve) {
        var req;
        try {
          req = window.indexedDB.open("hf-cache", 1);
        } catch (e) {
          resolve(null);
          return;
        }
        req.onupgradeneeded = function () {
          req.result.createObjectStore("moov");
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      });
    }
    return dbPromise;
  }

  function getMoov(key) {
    return db().then(function (d) {
      if (!d) {
        return null;
      }
      return new Promise(function (resolve) {
        var req = d.transaction("moov", "readonly").objectStore("moov").get(key);
        req.onsuccess = function () { resolve(req.result ? req.result.m : null); };
        req.onerror = function () { resolve(null); };
      });
    }, function () { return null; });
  }

  function putMoov(key, m) {
    db().then(function (d) {
      var store;
      if (!d) {
        return;
      }
      try {
        store = d.transaction("moov", "readwrite").objectStore("moov");
        store.put({ m: m, at: Date.now() }, key);
        /* dejar solo los 12 más recientes */
        var all = [];
        store.openCursor().onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) {
            all.push({ k: cur.key, at: cur.value.at });
            cur.continue();
            return;
          }
          all.sort(function (a, b) { return b.at - a.at; }).slice(12).forEach(function (x) { store.delete(x.k); });
        };
      } catch (e) {
        /* caché llena o no disponible: no importa */
      }
    });
  }

  /* ===================== Calidad automática (como YouTube) =====================
   * Un título puede tener varias versiones en Telegram (tools/preparar-video.mjs: 4K, 1080p, 720p, 360p).
   * Se mide la velocidad real a la que llegan los bytes de Telegram (sin contar el tiempo en que el motor frena la
   * descarga porque ya tiene suficiente) y se elige la mejor versión que la red aguanta con margen.
   * Si el video se queda esperando datos, baja de calidad; si sobra velocidad un buen rato, sube. Cambiar de versión
   * = reabrir en el mismo segundo (igual que al cambiar de audio). La última velocidad medida se recuerda para el
   * próximo video. Se puede fijar una calidad a mano desde el reproductor. */

  var NET_KEY = "hf.net.bps";
  var QUALITY_KEY = "hf.quality";
  var NOMINAL = { "4K": 16e6, "1080p": 5e6, "720p": 2.6e6 };
  var meter = { bytes: 0, idle: 0, from: 0 };
  var abr = { versions: null, cur: null, auto: true, est: 0, openedAt: 0, lastSwitch: 0, stall: 0, stallFrom: 0, lastUp: 0, timer: null };

  function storedBps() {
    try {
      return Number(window.localStorage.getItem(NET_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function storeBps(b) {
    try {
      window.localStorage.setItem(NET_KEY, String(Math.round(b)));
    } catch (e) {
      /* nada */
    }
  }

  function manualQuality() {
    try {
      return window.localStorage.getItem(QUALITY_KEY) || "auto";
    } catch (e) {
      return "auto";
    }
  }

  function vbps(v) {
    return v.bps || NOMINAL[v.q] || Math.max(4e5, v.h * v.h * 2);
  }

  /* 4K en H.265: solo si la TV lo reproduce (y en las TVs viejas, H.264 de más de 1088 líneas no va). */
  function playable(v) {
    if (v.h <= 1088) {
      return true;
    }
    try {
      return window.MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L153.B0"');
    } catch (e) {
      return false;
    }
  }

  /* La mejor versión que cabe en bps con margen (o la más baja si ninguna cabe). */
  function pickFor(bps, margin) {
    var list = abr.versions;
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (vbps(list[i]) * (margin || 1.4) <= bps) {
        return list[i];
      }
    }
    return list[list.length - 1];
  }

  function firstVersion() {
    var m = manualQuality();
    var est = storedBps();
    var i;
    abr.auto = m === "auto";
    if (!abr.auto) {
      for (i = 0; i < abr.versions.length; i += 1) {
        if (abr.versions[i].q === m || abr.versions[i].h <= Number(String(m).replace(/\D/g, "") || 0)) {
          return abr.versions[i];
        }
      }
      return abr.versions[abr.versions.length - 1];
    }
    if (est) {
      return pickFor(est, 1.4);
    }
    /* sin medidas todavía: empezar en 720p (o la más cercana por debajo) y subir si sobra */
    for (i = 0; i < abr.versions.length; i += 1) {
      if (abr.versions[i].h <= 720) {
        return abr.versions[i];
      }
    }
    return abr.versions[abr.versions.length - 1];
  }

  function meterReset() {
    meter.bytes = 0;
    meter.idle = 0;
    meter.from = performance.now();
  }

  /* Envuelve la fuente de Telegram para contar bytes y el tiempo que el motor la tiene frenada. */
  function metered(src) {
    async function* count(it) {
      for await (var c of it) {
        meter.bytes += c.length;
        yield c;
      }
    }
    return {
      size: src.size,
      stream: function (offset, signal, throttle) {
        var st = src.stream(offset, signal, function () {
          var t0 = performance.now();
          return Promise.resolve(throttle()).then(function () {
            var w = performance.now() - t0;
            if (w > 30) {
              meter.idle += w;
            }
          });
        });
        return { start: st.start, iter: count(st.iter) };
      }
    };
  }

  /* Cada 2 s: una muestra de velocidad (si hubo descarga de verdad) y la decisión de subir o bajar. */
  function abrTick(mySession) {
    var now = performance.now();
    var span = now - meter.from;
    var active = span - Math.min(span, meter.idle);
    var sample;
    var t;
    var ahead;
    var cur = abr.cur;
    var target = null;
    var lower;
    var higher;
    var i;
    if (mySession !== session || !video) {
      return;
    }
    if (span >= 2000) {
      /* solo cuenta si descargó la mayor parte del rato: con el búfer lleno la descarga va a tirones y mide de menos */
      if (active > 400 && meter.bytes > 262144 && meter.idle < span * 0.5) {
        sample = meter.bytes * 8 / (active / 1000);
        abr.est = abr.est ? abr.est * 0.7 + sample * 0.3 : sample;
        abr.last = sample;
        storeBps(abr.est);
      }
      meterReset();
    }
    if (lastState === "buffering" && abr.stallFrom === 0 && now - abr.openedAt > 6000) {
      abr.stallFrom = now;
    } else if (lastState !== "buffering" && abr.stallFrom) {
      abr.stall += now - abr.stallFrom;
      abr.stallFrom = 0;
      abr.stallEnd = now;
    }
    /* las trabas viejas se olvidan: solo cuentan las de los últimos 20 s */
    if (!abr.stallFrom && abr.stall && now - (abr.stallEnd || 0) > 20000) {
      abr.stall = 0;
    }
    if (!abr.versions || !abr.auto || lastState === "loading" || now - abr.openedAt < 6000) {
      return;
    }
    t = video.currentTime || 0;
    ahead = bufferedEnd(t) - t;
    for (i = 0; i < abr.versions.length; i += 1) {
      if (abr.versions[i] === cur) {
        higher = abr.versions[i - 1] || null;
        lower = abr.versions[i + 1] || null;
      }
    }
    var stalled = abr.stall + (abr.stallFrom ? now - abr.stallFrom : 0);
    /* bajar: se trabó más de 2,5 s, o se está quedando sin colchón */
    if (lower && now - abr.lastSwitch > 8000 && (stalled > 2500 || (ahead < 4 && lastState === "playing" && now - abr.openedAt > 20000))) {
      /* con la red cayendo vale más la última medida que el promedio: así baja de una vez a la calidad que aguanta */
      target = abr.est ? pickFor(Math.min(abr.est, abr.last || abr.est), 1.2) : lower;
      if (target.h >= cur.h) {
        target = lower;
      }
      switchVersion(target, "Tu internet va más lento: bajando a " + target.q);
      return;
    }
    /* subir: colchón lleno y la velocidad medida sobra para la siguiente, con espera entre subidas */
    if (higher && ahead > 40 && now - abr.lastSwitch > 30000 && now - abr.lastUp > 120000 && abr.est >= vbps(higher) * 1.6) {
      target = pickFor(abr.est, 1.6);
      if (target.h > cur.h) {
        abr.lastUp = now;
        switchVersion(target, "Tu internet va bien: subiendo a " + target.q);
      }
    }
  }

  function switchVersion(v, note) {
    var t;
    if (!v || v === abr.cur) {
      return;
    }
    t = globalTime();
    abr.cur = v;
    abr.lastSwitch = performance.now();
    abr.stall = 0;
    abr.stallFrom = 0;
    setParts(v);
    if (note && ev && ev.onNote) {
      ev.onNote(note);
    }
    openAt(t, { reopen: true, audio: currentAudio(), fileChanged: true });
  }

  /* ===================== Partes de la versión actual ===================== */

  var vparts = [];      // [{key, dur, off}] de la versión que se está viendo (una sola si no viene en partes)
  var partIdx = 0;
  var pendingSub;       // subtítulo elegido, para volver a ponerlo al abrir otro archivo

  function setParts(v) {
    var off = 0;
    vparts = (v && v.parts && v.parts.length ? v.parts : [{ key: videoKey, dur: (item && item.video && item.video.duration) || 0 }]).map(function (x) {
      var o = { key: x.key, dur: x.dur || 0, off: off };
      off += o.dur;
      return o;
    });
  }

  function reoffset() {
    var off = 0;
    vparts.forEach(function (x) { x.off = off; off += x.dur; });
  }

  function partAt(t) {
    var i;
    for (i = vparts.length - 1; i > 0; i -= 1) {
      if (t >= vparts[i].off - 0.05) {
        return i;
      }
    }
    return 0;
  }

  function partOff() {
    return vparts[partIdx] ? vparts[partIdx].off : 0;
  }

  /* tiempo de la película entera (no del archivo abierto) */
  function globalTime() {
    return partOff() + ((video && video.currentTime) || 0);
  }

  function totalDuration() {
    if (vparts.length > 1) {
      return vparts.reduce(function (n, x) { return n + x.dur; }, 0);
    }
    return (engine && engine.duration()) || (item && item.video && item.video.duration) || 0;
  }

  function currentAudio() {
    var a = null;
    trackInfo.audio.forEach(function (x) { if (x.current) { a = x.key; } });
    return a || undefined;
  }

  /* Abre el punto t (de la película entera): la parte que corresponde, en su segundo local. */
  function openAt(t, opts) {
    var i = partAt(t);
    opts = opts || {};
    if (i !== partIdx || opts.fileChanged) {
      opts.fileChanged = true;
    }
    partIdx = i;
    videoKey = vparts[i].key;
    openReal(Math.max(0, t - vparts[i].off), opts);
  }

  /* ===================== Motor real ===================== */

  var video = null;
  var engine = null;
  var session = 0;
  var timeTimer = null;
  var subTimer = null;
  var renderer = null;
  var emb = {};
  var embOrder = [];
  var subOn = null;
  var subDecided = false;
  var trackInfo = { audio: [], subs: [] };
  var lastState = "";

  function realAvailable() {
    return typeof Player !== "undefined" && typeof window.MediaSource !== "undefined" &&
      typeof HFTelegram !== "undefined" && HFTelegram.available();
  }

  function emitState(s) {
    if (s === lastState) {
      return;
    }
    lastState = s;
    if (ev && ev.onState) {
      ev.onState(s);
    }
  }

  function ensureEngine() {
    if (engine) {
      return;
    }
    video = document.getElementById("playerVideo");
    renderer = Subs.renderer(document.getElementById("playerSub"), document.getElementById("playerSubTop"), document.getElementById("playerSubPic"));
    engine = Player.create(video, function () {
      /* registro interno del motor: no se muestra */
    }, function (phase, msg) {
      if (!ev) {
        return;
      }
      if (phase === "loading" || phase === "buffering") {
        emitState(phase);
      } else if (phase === "playing") {
        emitState(video.paused ? "paused" : "playing");
      } else if (phase === "ended") {
        if (partIdx < vparts.length - 1) {
          /* terminó una parte: sigue la siguiente desde su comienzo */
          openAt(vparts[partIdx + 1].off + 0.01, { reopen: true, audio: currentAudio(), fileChanged: true });
        } else if (ev.onEnded) {
          ev.onEnded();
        }
      } else if (phase === "note") {
        if (ev.onNote) { ev.onNote(msg); }
      } else if (phase === "error") {
        if (ev.onError) { ev.onError(msg || "Error del reproductor"); }
      }
    });
    video.addEventListener("pause", function () {
      if (ev && lastState !== "loading" && lastState !== "buffering") { emitState("paused"); }
    });
    video.addEventListener("playing", function () {
      if (ev) { emitState("playing"); }
    });
  }

  function bufferedEnd(t) {
    var b = video.buffered;
    var i;
    for (i = 0; i < b.length; i += 1) {
      if (t >= b.start(i) - 0.5 && t <= b.end(i) + 0.5) {
        return b.end(i);
      }
    }
    return t;
  }

  function langName(code) {
    var c = String(code || "").toLowerCase();
    var map = { spa: "Español", es: "Español", eng: "Inglés", en: "Inglés", por: "Portugués", pt: "Portugués", fre: "Francés", fra: "Francés", fr: "Francés",
      ita: "Italiano", it: "Italiano", ger: "Alemán", deu: "Alemán", de: "Alemán", jpn: "Japonés", ja: "Japonés", kor: "Coreano", ko: "Coreano",
      chi: "Chino", zho: "Chino", zh: "Chino", rus: "Ruso", ru: "Ruso", lat: "Latino", und: "" };
    return map.hasOwnProperty(c) ? map[c] : (c ? c.toUpperCase() : "");
  }

  /* Etiqueta corta de una pista: el idioma y, si sirve para elegir, 5.1 / forzados / CC. Nunca el nombre del archivo
   * («spider-man-lat.aac», «…RARBG_track2-1.aac»): de ese nombre solo se toma el idioma si la pista no lo trae. */
  var NAME_LANG = [
    [/(^|[^a-z])(lat|latino|latam|latinoamericano)([^a-z]|$)/, "Español latino"],
    [/(^|[^a-z])(castellano|espana|spain|cast)([^a-z]|$)/, "Español (España)"],
    [/(^|[^a-z])(spa|esp|espanol|spanish)([^a-z]|$)/, "Español"],
    [/(^|[^a-z])(eng|english|ingles)([^a-z]|$)/, "Inglés"],
    [/(^|[^a-z])(por|portugues|portuguese|ptbr|brasil)([^a-z]|$)/, "Portugués"],
    [/(^|[^a-z])(fre|fra|francais|frances|french)([^a-z]|$)/, "Francés"],
    [/(^|[^a-z])(ita|italian|italiano)([^a-z]|$)/, "Italiano"],
    [/(^|[^a-z])(ger|deu|german|aleman|deutsch)([^a-z]|$)/, "Alemán"],
    [/(^|[^a-z])(jpn|japanese|japones)([^a-z]|$)/, "Japonés"]
  ];
  function plain(s) {
    s = String(s || "").toLowerCase();
    return s.normalize ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : s;
  }
  function trackLabel(t, i, kind) {
    var name = plain(t.name);
    var code = String(t.lang || "").toLowerCase();
    var lang = code === "lat" ? "Español latino" : langName(code);
    var k;
    var extra = [];
    if (code === "und") { lang = ""; }
    /* El nombre puede precisar el idioma (español → latino / España) o darlo si la pista no lo trae */
    for (k = 0; k < NAME_LANG.length; k += 1) {
      if (NAME_LANG[k][0].test(name)) {
        if (!lang || (lang === "Español" && NAME_LANG[k][1].indexOf("Español") === 0)) { lang = NAME_LANG[k][1]; }
        break;
      }
    }
    if (lang && lang.length <= 3) { lang = lang.toUpperCase(); } /* código raro sin nombre conocido */
    if (kind === "audio") {
      if (t.channels >= 6) { extra.push("5.1"); }
      if (/(^|[^a-z])(ad|descripcion|audiodescripcion|described)([^a-z]|$)/.test(name)) { extra.push("descripción"); }
      if (/comentario|commentary/.test(name)) { extra.push("comentarios"); }
    } else {
      if (t.isForced || /forz|forced/.test(name)) { extra.push("forzados"); }
      if (/(^|[^a-z])(sdh|cc|hi)([^a-z]|$)|sordos|closed.?caption/.test(name)) { extra.push("CC"); }
    }
    if (!lang) { lang = (kind === "audio" ? "Audio " : "Subtítulos ") + (i + 1); }
    if (!extra.length) { return lang; }
    return kind === "audio" && extra[0] === "5.1" ? lang + " · " + extra.join(" · ") : lang + " (" + extra.join(", ") + ")";
  }
  /* Si dos pistas quedan con el mismo nombre («Inglés» e «Inglés»), se numeran: «Inglés», «Inglés 2». */
  function numberRepeated(list) {
    var seen = {};
    list.forEach(function (x) {
      seen[x.label] = (seen[x.label] || 0) + 1;
      if (seen[x.label] > 1) { x.label += " " + seen[x.label]; }
    });
    return list;
  }

  function isSpanish(lang) {
    return /^(spa|es|lat)/i.test(String(lang || ""));
  }

  /* Qué subtítulo mostrar al empezar: el que elegiste para este video → forzados → español si el audio no está en español → ninguno. */
  function decideSubs(tr) {
    var saved = pref("sub");
    var audioLang = "";
    var pick = null;
    if (subDecided) {
      return;
    }
    subDecided = true;
    tr.audio.forEach(function (a) { if (a.current) { audioLang = a.lang; } });
    if (saved !== null) {
      pick = saved === "off" ? null : (emb[saved] ? saved : null);
    } else {
      tr.subs.forEach(function (s) { if (!pick && s.isForced) { pick = s.key; } });
      if (!pick && !isSpanish(audioLang)) {
        tr.subs.forEach(function (s) { if (!pick && isSpanish(s.lang)) { pick = s.key; } });
      }
    }
    setSubInternal(pick);
  }

  function setSubInternal(key) {
    subOn = key && emb[key] ? key : null;
    renderer.set(subOn ? emb[subOn].track : null);
  }

  function onEngineTracks(tr, mySession) {
    if (mySession !== session) {
      return;
    }
    if (pendingSub !== undefined) {
      tr.subs.forEach(function (t) {
        if (!emb[t.key]) {
          emb[t.key] = { info: t, track: Subs.track(t.codec, t.codecPrivate) };
          embOrder.push(t.key);
        }
      });
      setSubInternal(pendingSub);
      pendingSub = undefined;
    }
    tr.subs.forEach(function (t) {
      if (!emb[t.key]) {
        emb[t.key] = { info: t, track: Subs.track(t.codec, t.codecPrivate) };
        embOrder.push(t.key);
      }
    });
    trackInfo = {
      audio: numberRepeated(tr.audio.map(function (a, i) { return { key: a.key, label: trackLabel(a, i, "audio"), current: a.current, ok: a.ok, lang: a.lang }; })),
      subs: numberRepeated(tr.subs.map(function (s, i) { return { key: s.key, label: trackLabel(s, i, "subs"), lang: s.lang, isForced: s.isForced }; }))
    };
    trackInfo.audio.forEach(function (a) { if (!a.ok) { a.label += " (no compatible)"; } });
    decideSubs({ audio: trackInfo.audio, subs: tr.subs });
    if (ev && ev.onTracks) {
      ev.onTracks();
    }
  }

  function openReal(startAt, opts) {
    var mySession;
    var audioPref = (opts && opts.audio) || pref("audio") || undefined;
    ensureEngine();
    session += 1;
    mySession = session;
    if (opts && opts.reopen && opts.fileChanged) {
      /* otro archivo (otra parte u otra calidad): sus subtítulos tienen otros tiempos; se conserva cuál estaba elegido */
      pendingSub = subOn;
      emb = {};
      embOrder = [];
      subOn = null;
      renderer.set(null);
    }
    if (!opts || !opts.reopen) {
      emb = {};
      embOrder = [];
      subOn = null;
      subDecided = false;
      trackInfo = { audio: [], subs: [] };
      renderer.set(null);
    }
    lastState = "";
    emitState("loading");
    abr.openedAt = performance.now();
    meterReset();
    clearInterval(abr.timer);
    abr.timer = setInterval(function () { abrTick(mySession); }, 2000);
    Promise.all([HFTelegram.source(videoKey), getMoov(videoKey)]).then(function (r) {
      if (mySession !== session) {
        return null;
      }
      return engine.open(metered(r[0]), {
        startAt: startAt || 0,
        exact: !!(opts && opts.reopen),
        moov: r[1] || undefined,
        audio: audioPref,
        onMoov: function (m) { putMoov(videoKey, m); },
        onTracks: function (tr) { onEngineTracks(tr, mySession); },
        onSub: function (key, pts, dur, data, extra) {
          var e = emb[key];
          /* Subtítulos en imagen (PGS) pesan mucho: solo se guarda la pista elegida una vez decidido. */
          if (mySession === session && e && (e.track.kind !== "image" || !subDecided || subOn === key)) {
            e.track.add(pts, dur, data, extra);
          }
        }
      });
    }).then(function () {
      var d;
      if (mySession !== session) {
        return;
      }
      /* Telegram guarda la duración en segundos enteros: al abrir cada parte se corrige con la exacta */
      d = engine.duration();
      if (vparts.length > 1 && d && vparts[partIdx] && Math.abs(vparts[partIdx].dur - d) > 0.05) {
        vparts[partIdx].dur = d;
        reoffset();
      }
      emitState(video.paused ? "paused" : "playing");
    }, function (e) {
      if (mySession === session && ev && ev.onError) {
        ev.onError(String((e && e.message) || e || "Error del reproductor"));
      }
    });

    clearInterval(timeTimer);
    timeTimer = setInterval(function () {
      var t;
      var d;
      if (!ev || mySession !== session) {
        return;
      }
      t = video.currentTime || 0;
      d = totalDuration();
      if (ev.onTime) {
        ev.onTime(partOff() + t, d, partOff() + bufferedEnd(t));
      }
    }, 250);
    clearInterval(subTimer);
    subTimer = setInterval(function () {
      if (renderer && mySession === session) {
        renderer.tick(video.currentTime);
      }
    }, 100);
  }

  /* ===================== Simulador ===================== */

  var sim = { timer: null, loading: null, t: 0, dur: 0, playing: false };

  function simEmitTime() {
    if (ev && ev.onTime) {
      ev.onTime(sim.t, sim.dur, Math.min(sim.dur, sim.t + 60));
    }
  }

  function simTick() {
    if (!sim.playing) {
      return;
    }
    sim.t += 1;
    if (sim.t >= sim.dur) {
      sim.t = sim.dur;
      simEmitTime();
      simPause();
      if (ev && ev.onEnded) {
        ev.onEnded();
      }
      return;
    }
    simEmitTime();
  }

  function simPlay() {
    if (sim.playing || !ev) {
      return;
    }
    sim.playing = true;
    sim.timer = setInterval(simTick, 1000);
    emitState("playing");
  }

  function simPause() {
    if (!sim.playing) {
      return;
    }
    sim.playing = false;
    clearInterval(sim.timer);
    sim.timer = null;
    emitState("paused");
  }

  function openSim(startAt) {
    sim.dur = Math.max(30, Math.round((item && item.video && item.video.duration) || 1500));
    sim.t = Math.max(0, Math.min(sim.dur - 5, startAt || 0));
    lastState = "";
    emitState("loading");
    simEmitTime();
    sim.loading = setTimeout(function () {
      sim.loading = null;
      simPlay();
    }, 1500);
  }

  function closeSim() {
    if (sim.loading) {
      clearTimeout(sim.loading);
      sim.loading = null;
    }
    clearInterval(sim.timer);
    sim.timer = null;
    sim.playing = false;
  }

  /* ===================== Contrato público ===================== */

  api.open = function (it, startAt, events) {
    api.close();
    ev = events || {};
    item = it;
    videoKey = it.video ? it.video.key : it.key;
    prefKey = videoKey;
    abr.versions = null;
    abr.cur = null;
    abr.est = storedBps();
    abr.stall = 0;
    abr.stallFrom = 0;
    abr.last = 0;
    abr.lastSwitch = -1e9;
    abr.lastUp = -1e9;
    api.simulated = !realAvailable() || /^demo:/.test(videoKey);
    var single = null;
    if (!api.simulated && it.versions && it.versions.length) {
      abr.versions = it.versions.filter(playable);
      if (abr.versions.length > 1) {
        abr.cur = firstVersion();
        videoKey = abr.cur.key;
      } else {
        single = abr.versions[0] || it.versions[it.versions.length - 1];
        videoKey = single.key;
        abr.versions = null;
      }
    }
    partIdx = 0;
    pendingSub = undefined;
    setParts(abr.cur || single);
    if (api.simulated) {
      openSim(startAt);
    } else {
      openAt(startAt || 0);
    }
  };

  api.play = function () {
    if (api.simulated) { simPlay(); return; }
    if (video && video.paused) { video.play().catch(function () {}); }
  };

  api.pause = function () {
    if (api.simulated) { simPause(); return; }
    if (video && !video.paused) { video.pause(); }
  };

  api.toggle = function () {
    if (api.playing()) { api.pause(); } else { api.play(); }
  };

  api.seek = function (to) {
    /* cargar después de un salto no es que la red vaya lenta */
    abr.stall = 0;
    abr.stallFrom = 0;
    abr.openedAt = performance.now();
    var dur = api.duration();
    var target = Math.max(0, dur ? Math.min(dur - 1, to) : to);
    if (api.simulated) {
      sim.t = target;
      simEmitTime();
      return;
    }
    if (engine) {
      if (partAt(target) !== partIdx) {
        openAt(target, { reopen: true, audio: currentAudio(), fileChanged: true });
      } else {
        engine.seek(target - partOff(), target > globalTime() ? 1 : -1);
      }
    }
  };

  api.time = function () {
    return api.simulated ? sim.t : (video ? globalTime() : 0);
  };

  api.duration = function () {
    if (api.simulated) {
      return sim.dur;
    }
    return totalDuration();
  };

  api.playing = function () {
    return api.simulated ? sim.playing : !!(video && !video.paused && lastState === "playing");
  };

  api.tracks = function () {
    return {
      audio: trackInfo.audio,
      subs: trackInfo.subs.map(function (s) { return { key: s.key, label: s.label, current: s.key === subOn }; }),
      subsOff: !subOn
    };
  };

  api.setAudio = function (key) {
    var t;
    if (api.simulated || !engine) {
      return;
    }
    pref("audio", key);
    t = video.currentTime;
    trackInfo.audio.forEach(function (a) { a.current = a.key === key; });
    openReal(t, { reopen: true, audio: key }); // mismo archivo: tiempo local
  };

  api.setSub = function (key) {
    if (api.simulated) {
      return;
    }
    pref("sub", key || "off");
    setSubInternal(key);
  };

  api.qualities = function () {
    if (!abr.versions) {
      return null;
    }
    return {
      auto: abr.auto,
      current: { key: abr.cur.key, q: abr.cur.q },
      speed: abr.est,
      list: abr.versions.map(function (v) { return { key: v.key, q: v.q, mbps: vbps(v) / 1e6, parts: v.parts ? v.parts.length : 1 }; })
    };
  };

  api.setQuality = function (key) {
    var v = null;
    if (!abr.versions) {
      return;
    }
    if (key === "auto") {
      abr.auto = true;
      try { window.localStorage.setItem(QUALITY_KEY, "auto"); } catch (e) { /* nada */ }
      v = abr.est ? pickFor(abr.est, 1.4) : abr.cur;
    } else {
      abr.versions.forEach(function (x) { if (x.key === key) { v = x; } });
      if (!v) {
        return;
      }
      abr.auto = false;
      try { window.localStorage.setItem(QUALITY_KEY, v.q); } catch (e) { /* nada */ }
    }
    switchVersion(v, "Calidad: " + (abr.auto ? "automática (" + v.q + ")" : v.q));
  };

  api.close = function () {
    session += 1;
    clearInterval(abr.timer);
    abr.timer = null;
    closeSim();
    clearInterval(timeTimer);
    clearInterval(subTimer);
    timeTimer = null;
    subTimer = null;
    if (engine) {
      engine.close();
    }
    if (renderer) {
      renderer.set(null);
    }
    ev = null;
    lastState = "";
  };

  return api;
})();
