/* HomeFlix · lectura rápida del catálogo de Telegram (TV, celular y TV Android).
 *
 * Antes cada vez que se abría la biblioteca (o se pulsaba ↻) se recorría el chat ENTERO: tres filtros (videos, documentos y fotos),
 * cien mensajes por petición y ~3,5 s por petición en esta ruta; un chat con cientos de videos eran decenas de segundos y, al
 * terminar, la pantalla se repintaba (perdiendo la fila donde se estaba). Ahora:
 *   · lo ya leído se guarda por chat (hf.scan.<cuenta>: el mensaje más nuevo, cuántos items y cuándo fue la última lectura completa);
 *   · cada lectura normal pide solo lo NUEVO (HFTelegram.scan con since): 1–3 peticiones, a la vez;
 *   · una lectura COMPLETA (la única que ve comentarios editados o mensajes borrados) se hace al menos cada 6 h (1 h si se pulsa ↻),
 *     la primera vez que se lee un chat, si cambió a supergrupo, o si lo guardado no cuadra (p. ej. se vació la caché).
 *
 *   HFCatalog.scanChat(chatId, itemsDeEseChat, {manual, full}) → Promise<{items, incremental, nuevos}>
 *       items = lo de ese chat ya mezclado (nuevo + lo que se tenía), listo para reemplazar lo anterior. */
var HFCatalog = (function () {
  "use strict";

  var FULL_AUTO = 6 * 3600 * 1000;
  var FULL_MANUAL = 3600 * 1000;
  var CHECK_EVERY = 15 * 60 * 1000; // cada cuánto revisar si se editó alguna foto ya conocida (sin contar ↻, que siempre revisa)

  function key() { return "hf.scan." + HFLibrary.accountId(); }

  function load() {
    try {
      return JSON.parse(window.localStorage.getItem(key()) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function save(st) {
    try {
      window.localStorage.setItem(key(), JSON.stringify(st));
    } catch (e) {
      /* sin almacenamiento: la próxima vez será una lectura completa */
    }
  }

  /* ¿Se puede leer solo lo nuevo? (lo guardado cuadra con lo que hay en caché) */
  function canSkip(s, cached, opts) {
    var limit = opts.manual ? FULL_MANUAL : FULL_AUTO;
    return !opts.full && !!s && !!s.max && !s.mig && !!s.full && s.kv === 2 && // kv: lo guardado por versiones sin la cuenta de lo borrado (1.1.94 incluida) se lee completo una vez
       Date.now() - s.full < limit && !!cached && cached.length >= (s.n || 1) * 0.98 && cached.length > 0;
  }

  function scanChat(chatId, cached, opts) {
    var id = String(chatId);
    var st = load();
    var s = st[id];
    var inc;
    opts = opts || {};
    var now0 = Date.now();
    var photos = null;
    inc = canSkip(s, cached, opts);
    /* En una lectura de solo lo nuevo, de vez en cuando (siempre al pulsar ↻) se revisa si alguna foto ya conocida se editó:
     * cambiar una portada o un banner en el mismo mensaje no mueve su número, y si no no se vería. 1 petición por cada 100 fotos. */
    if (inc && (opts.manual || now0 - (s.chk || 0) > CHECK_EVERY)) {
      photos = cached.filter(function (it) { return it.kind === "photo" && it.msgId && String(it.chatId) === id; })
        .map(function (it) { return { msgId: it.msgId, edit: it.edit || 0 }; });
    }
    /* Además se cuenta lo que hay en el chat (3 peticiones de 1 mensaje, a la vez que la lectura): si no cuadra con lo que se tiene, se BORRÓ algo
     * (p. ej. se eliminó un tema y se volvió a copiar) y una lectura de solo lo nuevo no lo vería: se hace una completa. */
    var countP = HFTelegram.countMedia ? HFTelegram.countMedia(id).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([HFTelegram.scan(id, inc ? { since: s.max, photos: photos } : {}), countP]).then(function (both) {
      var fresh = both[0];
      var total = both[1];
      var seen = {};
      var items;
      var max = 0;
      var now;
      var cur;
      if (inc) {
        fresh.forEach(function (it) { seen[it.key] = true; });
        items = fresh.concat(cached.filter(function (it) { return !seen[it.key]; }));
      } else {
        items = fresh.slice();
      }
      items.forEach(function (it) {
        if (String(it.chatId) === id && (it.msgId || 0) > max) { max = it.msgId; }
      });
      if (inc && total != null && s.k != null && items.length !== total - s.k && !opts.noRecheck) {
        return scanChat(chatId, cached, Object.assign({}, opts, { full: true, noRecheck: true })); // algo se borró: lectura completa
      }
      now = Date.now();
      cur = load();
      /* k = lo que el chat tiene aparte de los items (fotos sin comentario, hilos…): total − items; si cambia sin que cambie lo demás, algo se borró o se agregó */
      cur[id] = { max: max, n: items.length, full: inc ? s.full : now, mig: inc ? false : !!fresh.migrated, chk: photos || !inc ? now : (s && s.chk) || 0, kv: 2, k: total != null ? (inc && s.k != null ? s.k : total - items.length) : undefined };
      save(cur);
      return { items: items, incremental: inc, nuevos: fresh.length };
    });
  }

  /* Olvidar lo guardado (cerrar sesión, cambiar de cuenta de Telegram): la próxima lectura es completa */
  function reset() {
    try { window.localStorage.removeItem(key()); } catch (e) { /* nada */ }
  }

  return { scanChat: scanChat, reset: reset, _: { canSkip: canSkip, load: load } };
}());
