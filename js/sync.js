/* HomeFlix · sincronizar entre dispositivos (TV, celular, web).
 *
 * Mi lista, el progreso, los perfiles (con su PIN), los chats de cada perfil y las etiquetas puestas desde la TV
 * viven en cada dispositivo (HFLibrary). Para que sean los mismos en todos, cada app guarda una copia en los
 * Mensajes guardados de la cuenta de Telegram (HFTelegram.syncRead / syncWrite: homeflix-sync.json) y la combina
 * con la suya quedándose con lo más reciente de cada cosa (HFLibrary.mergeSync).
 *
 * Cuándo:
 *   - al iniciar sesión y al volver a la app (como mucho una vez por minuto),
 *   - después de un cambio: Mi lista, perfiles o chats a los 4 s; el progreso, cada 60 s como mucho,
 *   - al salir o pasar a segundo plano, si quedó algo pendiente.
 * Cada escritura lee primero lo que hay y lo combina: dos dispositivos a la vez no se pisan.
 *
 *   HFSync.start()            empezar con la cuenta activa (después de iniciar sesión)
 *   HFSync.stop()             al cerrar sesión o cambiar de cuenta
 *   HFSync.now()              forzar (botón «Actualizar»)
 *   HFSync.onRemote(fn)       fn() cuando llegaron cambios de otro dispositivo (para volver a pintar)
 *   HFSync.status()           {state: "off"|"idle"|"busy"|"error", at, error} */
var HFSync = (function () {
  "use strict";

  var on = false;
  var account = "";
  var msgId = null;
  var busy = false;
  var again = false;
  var timer = null;
  var due = 0;
  var lastPull = 0;
  var lastOk = 0;
  var lastError = "";
  var listeners = [];
  var hooked = false;

  var FAST = 4000;
  var SLOW = 60000;
  var PULL_EVERY = 60000;

  function same(a, b) {
    /* lo mismo salvo la fecha del documento */
    var x = Object.assign({}, a, { at: 0 });
    var y = Object.assign({}, b || {}, { at: 0 });
    return JSON.stringify(x) === JSON.stringify(y);
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { /* nada */ }
    });
  }

  /* Leer, combinar y, si este dispositivo tiene algo más nuevo, escribir. */
  function run() {
    var acc = HFLibrary.accountId();
    if (!on || acc !== account) {
      return Promise.resolve();
    }
    if (busy) {
      again = true;
      return Promise.resolve();
    }
    busy = true;
    lastPull = Date.now();
    return HFTelegram.syncRead().then(function (r) {
      var changed = false;
      var local;
      if (HFLibrary.accountId() !== acc) {
        return null;
      }
      if (r) {
        msgId = r.id;
        changed = r.data ? HFLibrary.mergeSync(r.data) : false;
      }
      local = HFLibrary.exportSync();
      if (changed) {
        notify();
      }
      if (r && r.data && same(local, r.data)) {
        return null;
      }
      return HFTelegram.syncWrite(local, msgId).then(function (id) {
        if (HFLibrary.accountId() === acc) {
          msgId = id;
        }
      });
    }).then(function () {
      lastOk = Date.now();
      lastError = "";
    }, function (e) {
      lastError = (e && (e.text || e.message)) || String(e);
    }).then(function () {
      busy = false;
      if (again) {
        again = false;
        schedule(FAST);
      }
    });
  }

  function schedule(delay) {
    var at = Date.now() + delay;
    if (!on) {
      return;
    }
    if (timer && due <= at) {
      return; // ya hay una más pronto
    }
    clearTimeout(timer);
    due = at;
    timer = setTimeout(function () {
      timer = null;
      due = 0;
      run();
    }, delay);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      due = 0;
      run();
    }
  }

  function hook() {
    if (hooked) {
      return;
    }
    hooked = true;
    HFLibrary.onChange(function (kind) {
      schedule(kind === "progress" ? SLOW : FAST);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        flush();
      } else if (on && Date.now() - lastPull > PULL_EVERY) {
        run();
      }
    }, false);
    window.addEventListener("pagehide", flush, false);
  }

  function start() {
    hook();
    if (on && account === HFLibrary.accountId()) {
      if (Date.now() - lastPull > PULL_EVERY) {
        run();
      }
      return;
    }
    on = true;
    account = HFLibrary.accountId();
    msgId = null;
    lastPull = 0;
    run();
  }

  /* Deja de sincronizar; si quedaba algo por guardar, lo guarda antes (esperar la promesa antes de cerrar sesión). */
  function stop() {
    var last = timer ? (clearTimeout(timer), timer = null, run()) : Promise.resolve();
    return last.then(function () {
      on = false;
      account = "";
      msgId = null;
    });
  }

  return {
    start: start,
    stop: stop,
    now: function () { return run(); },
    onRemote: function (fn) { listeners.push(fn); },
    status: function () {
      return { state: !on ? "off" : busy ? "busy" : lastError ? "error" : "idle", at: lastOk, error: lastError };
    }
  };
})();
