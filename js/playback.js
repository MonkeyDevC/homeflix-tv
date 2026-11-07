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

  /* ===================== Preferencias por video (audio y subtítulos elegidos) ===================== */

  function pref(name, value) {
    var k = "hf." + name + "." + videoKey;
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
        if (ev.onEnded) { ev.onEnded(); }
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

  function trackLabel(t, i, kind) {
    var parts = [];
    if (t.name) { parts.push(t.name); }
    if (langName(t.lang) && (!t.name || t.name.toLowerCase().indexOf(langName(t.lang).toLowerCase()) < 0)) { parts.push(langName(t.lang)); }
    if (kind === "audio" && t.channels) { parts.push(t.channels >= 6 ? "5.1" : t.channels === 2 ? "Estéreo" : t.channels + " canales"); }
    if (kind === "subs" && t.isForced) { parts.push("forzados"); }
    return parts.join(" · ") || (kind === "audio" ? "Audio " : "Subtítulos ") + (i + 1);
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
    tr.subs.forEach(function (t) {
      if (!emb[t.key]) {
        emb[t.key] = { info: t, track: Subs.track(t.codec, t.codecPrivate) };
        embOrder.push(t.key);
      }
    });
    trackInfo = {
      audio: tr.audio.map(function (a, i) { return { key: a.key, label: trackLabel(a, i, "audio") + (a.ok ? "" : " (no compatible)"), current: a.current, ok: a.ok, lang: a.lang }; }),
      subs: tr.subs.map(function (s, i) { return { key: s.key, label: trackLabel(s, i, "subs"), lang: s.lang, isForced: s.isForced }; })
    };
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
    Promise.all([HFTelegram.source(videoKey), getMoov(videoKey)]).then(function (r) {
      if (mySession !== session) {
        return null;
      }
      return engine.open(r[0], {
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
      if (mySession !== session) {
        return;
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
      d = engine.duration() || (item && item.video && item.video.duration) || 0;
      if (ev.onTime) {
        ev.onTime(t, d, bufferedEnd(t));
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
    api.simulated = !realAvailable() || /^demo:/.test(videoKey);
    if (api.simulated) {
      openSim(startAt);
    } else {
      openReal(startAt);
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
    var dur = api.duration();
    var target = Math.max(0, dur ? Math.min(dur - 1, to) : to);
    if (api.simulated) {
      sim.t = target;
      simEmitTime();
      return;
    }
    if (engine) {
      engine.seek(target, target > video.currentTime ? 1 : -1);
    }
  };

  api.time = function () {
    return api.simulated ? sim.t : (video ? video.currentTime : 0);
  };

  api.duration = function () {
    if (api.simulated) {
      return sim.dur;
    }
    return (engine && engine.duration()) || (item && item.video && item.video.duration) || 0;
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
    openReal(t, { reopen: true, audio: key });
  };

  api.setSub = function (key) {
    if (api.simulated) {
      return;
    }
    pref("sub", key || "off");
    setSubInternal(key);
  };

  api.close = function () {
    session += 1;
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
