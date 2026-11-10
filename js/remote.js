/* HomeFlix · «Ver en la TV»: mensajes en vivo entre los dispositivos de la misma cuenta (TV, celular, web).
 *
 * Usa el servidor de HomeFlix (servidor/src/remoto.js) con la misma llave de cuenta que la sincronización (js/sync.js).
 * Cada app abierta escucha un flujo de eventos; otra app de la cuenta ve quién está conectado y le manda mensajes.
 * Qué significa cada mensaje lo deciden la TV (js/ui/cast.js) y el celular (mobile/m.js):
 *   celular → TV   {t: "play", key, start, profile, audio, sub} · {t: "cmd", c: "toggle"|"play"|"pause"|"seek", v}
 *                  {t: "audio", k} · {t: "sub", k} · {t: "stop"} · {t: "get"}
 *   TV → celular   {t: "ok"} · {t: "error", m} · {t: "wait", m} (actualizando su catálogo antes de abrir) ·
 *                  {t: "state", …} · {t: "closed"}
 *
 *   HFRemote.start() / stop()     escuchar con la cuenta activa (después de iniciar sesión) / dejar de escuchar
 *   HFRemote.devices()            → Promise [{id, tipo, nombre}] conectados ahora (sin este)
 *   HFRemote.send(id, msg)        → Promise (rechaza si ese dispositivo ya no está conectado)
 *   HFRemote.onMessage(fn)        fn(msg, de) con de = {id, tipo, nombre}
 *   HFRemote.connected()          true mientras el flujo está abierto */
var HFRemote = (function () {
  "use strict";

  var on = false;
  var live = false;
  var open = false;
  var ctrl = null;
  var retry = 0;
  var timer = null;
  var gen = 0;
  var listeners = [];

  function url(path) { return HFSync.server + "/api/v1/remoto" + path; }

  function headers(key, extra) {
    var d = HFSync.device();
    return Object.assign({
      authorization: "Bearer " + key,
      "x-homeflix-dispositivo": d.id,
      "x-homeflix-tipo": d.tipo,
      "x-homeflix-nombre": encodeURIComponent(d.nombre)
    }, extra || {});
  }

  function emit(data) {
    var m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || !m.msg) { return; }
    listeners.slice().forEach(function (fn) {
      try { fn(m.msg, m.de || {}); } catch (e) { /* que un oyente no tumbe a los demás */ }
    });
  }

  /* Lee el flujo de eventos (SSE) a mano con fetch: EventSource no deja mandar la llave en una cabecera. */
  function read(res, mine) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    function pump() {
      return reader.read().then(function (r) {
        var i;
        var block;
        var data;
        if (r.done || mine !== gen) { return; }
        buf += dec.decode(r.value, { stream: true });
        while ((i = buf.indexOf("\n\n")) >= 0) {
          block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^event:/m.test(block)) { continue; } // «hola»
          data = block.split("\n").filter(function (l) { return l.indexOf("data:") === 0; }).map(function (l) { return l.slice(5).replace(/^ /, ""); }).join("\n");
          if (data) { emit(data); }
        }
        return pump();
      });
    }
    return pump();
  }

  function listen() {
    var mine;
    clearTimeout(timer);
    timer = null;
    if (!on || live) { return; }
    gen += 1;
    mine = gen;
    live = true;
    ctrl = window.AbortController ? new AbortController() : null;
    HFSync.key().then(function (key) {
      if (mine !== gen) { return null; }
      return fetch(url("/escuchar"), { headers: headers(key), cache: "no-store", signal: ctrl ? ctrl.signal : undefined });
    }).then(function (res) {
      if (!res) { return null; }
      if (!res.ok || !res.body) { throw new Error("HTTP " + res.status); }
      retry = 0;
      open = true;
      return read(res, mine);
    }).catch(function () { /* sin conexión: se reintenta */ }).then(function () {
      if (mine !== gen) { return; }
      live = false;
      open = false;
      if (on) {
        retry += 1;
        timer = setTimeout(listen, Math.min(30000, 1000 * Math.pow(2, Math.min(retry, 5))));
      }
    });
  }

  function abort() {
    gen += 1;
    live = false;
    open = false;
    clearTimeout(timer);
    timer = null;
    try { if (ctrl) { ctrl.abort(); } } catch (e) { /* nada */ }
    ctrl = null;
  }

  /* Al volver a la app (la TV o el celular la pausan en segundo plano y el flujo se corta): reconectar ya. */
  document.addEventListener("visibilitychange", function () {
    if (on && !document.hidden) {
      abort();
      retry = 0;
      listen();
    }
  }, false);

  function call(method, path, body) {
    return HFSync.key().then(function (key) {
      return fetch(url(path), {
        method: method,
        headers: headers(key, body ? { "content-type": "application/json" } : null),
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store"
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var e = new Error(res.status === 404 && data.error === "no_conectado" ? "Ese dispositivo ya no está conectado" : "El servidor de HomeFlix respondió " + res.status);
          e.status = res.status;
          throw e;
        }
        return data;
      });
    });
  }

  return {
    start: function () {
      on = true;
      abort();
      retry = 0;
      listen();
    },
    stop: function () {
      on = false;
      abort();
    },
    devices: function () {
      return call("GET", "/dispositivos").then(function (r) { return r.dispositivos || []; });
    },
    send: function (id, msg) {
      return call("POST", "/enviar", { a: id, msg: msg });
    },
    onMessage: function (fn) { listeners.push(fn); },
    connected: function () { return open; }
  };
})();
