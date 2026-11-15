/* HomeFlix · Preparador · grupos con TEMAS (foros de Telegram).
 *
 * En un grupo con temas cada película (o serie) vive en SU tema: dentro van sus versiones, portada, banner, vertical, galería, miniaturas y
 * subtítulos, aislados de lo demás. Las apps (TV y celular) leen el grupo entero igual que antes: la búsqueda de Telegram atraviesa todos los
 * temas, así que no cambia nada para ellas.
 *
 *   PrepTopics.noteForum(chat)        recuerda si un chat es un grupo con temas (lo dice Telegram: chat.isForum)
 *   PrepTopics.patch(client)          el cliente de Telegram del preparador: todo lo que se envíe a un grupo con temas con el comentario de
 *                                     HomeFlix («pelicula#Nombre (2020)…», «serie(1/3)#Nombre…») va al tema de ese título, que se crea si no existe
 *   PrepTopics.topicFor(client, chat, caption)   crea (o encuentra) el tema de un título: lo usa el paso a paso al terminar
 *   PrepTopics.plan(items)            qué mensajes de un grupo van a cada tema (solo lo vigente: sin versiones viejas ni repetidas)
 *   PrepTopics.migrate(opts)          copia ese plan a un grupo con temas SIN volver a subir nada (Telegram reenvía sin autor)
 *
 * Los mensajes copiados tienen otro número en el grupo nuevo: migrate devuelve el mapa «chat:viejo → chat:nuevo». */
var PrepTopics = (function () {
  "use strict";

  var LS_FOROS = "hf.preparador.foros";
  var LOOSE = "Sin clasificar";
  var forums = {};  // chatId → true | false
  var tops = {};    // chatId → { list: [{id, title, base, year, series}] }
  var making = {};  // llave del título → Promise<id> (para no crear dos veces el mismo tema)

  try { forums = JSON.parse(window.localStorage.getItem(LS_FOROS) || "{}") || {}; } catch (e) { forums = {}; }
  function saveForums() { try { window.localStorage.setItem(LS_FOROS, JSON.stringify(forums)); } catch (e) { /* se vuelve a saber al leer los chats */ } }

  function norm(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    if (t.normalize) { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    return t.replace(/[^a-z0-9]+/g, " ").trim();
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function chatId(c) {
    if (c === null || c === undefined) { return ""; }
    if (typeof c === "object") { return c.id !== undefined && c.id !== null ? String(c.id) : (c.chat && c.chat.id !== undefined ? String(c.chat.id) : ""); }
    return String(c);
  }

  /* ---------- ¿es un grupo con temas? ---------- */
  function noteForum(chat) {
    var id = chatId(chat);
    if (!id || !chat || typeof chat !== "object" || typeof chat.isForum !== "boolean") { return; }
    if (forums[id] !== chat.isForum) { forums[id] = chat.isForum; saveForums(); }
  }
  function isForum(chat) {
    noteForum(chat);
    return forums[chatId(chat)] === true;
  }

  /* ---------- nombres de los temas ---------- */
  /* «Nombre (2020)» para una película, «Nombre (serie)» para una serie. Telegram admite hasta 128 letras. */
  function topicName(p) {
    var n = String(p.name || "").replace(/\s+/g, " ").trim().slice(0, 100);
    return p.type === "series" ? n + " (serie)" : n + (p.year ? " (" + p.year + ")" : "");
  }
  function parseTopic(title) {
    var t = String(title || "").trim();
    var m = /^(.*)\s\(serie\)$/i.exec(t);
    if (m) { return { base: norm(m[1]), year: 0, series: true }; }
    m = /^(.*)\s\((\d{4})\)$/.exec(t);
    return m ? { base: norm(m[1]), year: Number(m[2]), series: false } : { base: norm(t), year: 0, series: false };
  }
  /* el tema que ya tiene este título (mismo nombre y año; sin año en el comentario sirve el único tema con ese nombre) */
  function findTopic(list, p) {
    var base = norm(p.name);
    var same = list.filter(function (t) { return t.base === base && t.series === (p.type === "series"); });
    var exact;
    if (p.type === "series") { return same[0] || null; }
    exact = same.filter(function (t) { return t.year === (p.year || 0); })[0];
    if (exact) { return exact; }
    if (!p.year) { return same.length === 1 ? same[0] : (same.filter(function (t) { return !t.year; })[0] || null); }
    /* con año y sin tema con ese año: sirve el único tema del mismo nombre que no lleva año (creado a mano o antes de saber el año), en vez de duplicarlo */
    exact = same.filter(function (t) { return !t.year; });
    return exact.length === 1 ? exact[0] : null;
  }

  /* ---------- los temas que ya hay ---------- */
  async function loadTopics(client, chat, force) {
    var id = chatId(chat);
    var list = [];
    var it;
    var page;
    if (tops[id] && !force) { return tops[id].list; }
    if (client.iterForumTopics) {
      for await (it of client.iterForumTopics(chat, { limit: 100 })) {
        list.push(Object.assign({ id: it.id, title: it.title }, parseTopic(it.title)));
      }
    } else {
      page = await client.getForumTopics(chat, { limit: 100 });
      (page || []).forEach(function (t) { list.push(Object.assign({ id: t.id, title: t.title }, parseTopic(t.title))); });
    }
    tops[id] = { list: list };
    return list;
  }

  async function createTopic(client, chat, title) {
    var msg = await client.createForumTopic({ chatId: chat, title: title });
    var id = msg && msg.id;
    var list;
    if (!id) {
      list = await loadTopics(client, chat, true);
      id = (list.filter(function (t) { return t.title === title; })[0] || {}).id;
    }
    if (!id) { throw new Error("Telegram no dijo el número del tema «" + title + "»."); }
    return id;
  }

  /* El tema de un título: el que ya existe o uno nuevo. Varias subidas a la vez del mismo título comparten la misma creación. */
  function ensureTopic(client, chat, p) {
    var key = chatId(chat) + "|" + p.type + "|" + norm(p.name) + "|" + (p.year || 0);
    if (making[key]) { return making[key]; }
    making[key] = (async function () {
      var list = await loadTopics(client, chat);
      var found = findTopic(list, p);
      var title;
      var id;
      if (found) { return found.id; }
      title = topicName(p);
      id = await createTopic(client, chat, title);
      list.push(Object.assign({ id: id, title: title }, parseTopic(title)));
      return id;
    })();
    making[key].then(null, function () { delete making[key]; });
    return making[key];
  }
  /* ¿Ya tiene tema este título? (solo mira, no crea) → {id, title} o null */
  async function find(client, chat, p) {
    if (!isForum(chat)) { return null; }
    return findTopic(await loadTopics(client, chat), p);
  }
  /* olvida los temas que se habían leído de un chat (para volver a leerlos de Telegram) */
  function refresh(chat) { delete tops[chatId(chat)]; }
  /* Un tema con nombre propio («Sin clasificar») */
  function ensureNamed(client, chat, title) {
    var key = chatId(chat) + "|named|" + norm(title);
    if (making[key]) { return making[key]; }
    making[key] = (async function () {
      var list = await loadTopics(client, chat);
      var found = list.filter(function (t) { return norm(t.title) === norm(title); })[0];
      var id;
      if (found) { return found.id; }
      id = await createTopic(client, chat, title);
      list.push(Object.assign({ id: id, title: title }, parseTopic(title)));
      return id;
    })();
    making[key].then(null, function () { delete making[key]; });
    return making[key];
  }

  /* ---------- publicar dentro del tema ---------- */
  function captionInfo(caption) {
    var p = window.HFLibrary && caption ? HFLibrary.parseCaption(caption) : null;
    return p && p.name ? p : null;
  }
  /* El número del tema para un comentario, o 0 si el chat no tiene temas o el comentario no es de HomeFlix. */
  async function topicFor(client, chat, caption) {
    var p;
    if (!isForum(chat)) { return 0; }
    p = captionInfo(caption);
    return p ? ensureTopic(client, chat, p) : 0;
  }
  async function withThread(client, chat, caption, params) {
    var id;
    if (params && params.threadId) { return params; }
    id = await topicFor(client, chat, caption);
    return id ? Object.assign({}, params || {}, { threadId: id }) : params;
  }
  /* Envuelve el cliente: sendMedia, sendMediaGroup y sendCopy mandan al tema del título cuando el chat tiene temas. */
  function patch(client) {
    var media;
    var group;
    var copy;
    if (!client || client.__temas) { return client; }
    client.__temas = true;
    media = client.sendMedia.bind(client);
    group = client.sendMediaGroup.bind(client);
    copy = client.sendCopy ? client.sendCopy.bind(client) : null;
    client.sendMedia = async function (chat, m, params) {
      return media(chat, m, await withThread(client, chat, m && m.caption, params));
    };
    client.sendMediaGroup = async function (chat, medias, params) {
      var first = medias && medias[0];
      return group(chat, medias, await withThread(client, chat, first && first.caption, params));
    };
    if (copy) {
      client.sendCopy = async function (params) {
        var thread = await topicFor(client, params.toChatId, params.caption);
        return copy(thread ? Object.assign({}, params, { threadId: thread }) : params);
      };
    }
    return client;
  }

  /* ---------- qué va a cada tema ---------- */
  var ORDER = { photo: 0, video: 1, sub: 2, thumbs: 3 };
  function groupKey(type, name, year) { return type === "series" ? "s:" + norm(name) : "m:" + norm(name) + ":" + (year || 0); }

  /* items: lo que lee el preparador del grupo [{key, chatId, msgId, kind: video|photo|sub|thumbs, caption, fileName, size, date…}].
   * Los videos que cuentan son los que la app muestra (la versión vigente de cada calidad, con todas sus partes); las fotos, subtítulos y
   * hojas de miniaturas, el más nuevo de cada lugar (portada, banner, vertical, cada escena, cada idioma, cada hoja). */
  function plan(items) {
    var lib = HFLibrary.build(items, {});
    var groups = {};
    var byKey = {};
    var picked = {};
    var loose = { gid: "loose", loose: true, topic: LOOSE, type: "loose", name: LOOSE, year: 0, items: [] };
    var slots = {};
    var out;
    var skipped = [];

    items.forEach(function (it) { byKey[it.key] = it; });
    function group(type, name, year) {
      var gid = groupKey(type, name, year);
      if (!groups[gid]) { groups[gid] = { gid: gid, loose: false, topic: topicName({ type: type, name: name, year: year }), type: type, name: name, year: year || 0, items: [] }; }
      return groups[gid];
    }
    function take(g, key) {
      if (byKey[key] && !picked[key]) { picked[key] = true; g.items.push(byKey[key]); }
    }
    function versionsOf(g, t) { (t.versions || []).forEach(function (v) { (v.parts || []).forEach(function (x) { take(g, x.key); }); }); }

    lib.movies.forEach(function (m) { versionsOf(group("movie", m.name, m.year), m); });
    lib.series.forEach(function (s) {
      var g = group("series", s.name, 0);
      (s.seasons || []).forEach(function (se) { (se.episodes || []).forEach(function (ep) { versionsOf(g, ep); }); });
    });
    lib.unclassified.forEach(function (u) { take(loose, u.key); });

    /* fotos, subtítulos y miniaturas: al título que dice su comentario, quedándose con el más nuevo de cada lugar */
    items.forEach(function (it) {
      var p;
      var g;
      var cand;
      var slot;
      var cur;
      if (it.kind === "video" || picked[it.key]) { return; }
      p = HFLibrary.parseCaption(it.caption);
      if (!p || !p.name) { slot = "loose|" + it.key; g = loose; }
      else if (p.type === "series") { g = group("series", p.name, 0); }
      else if (p.year) { g = group("movie", p.name, p.year); }
      else {
        cand = Object.keys(groups).filter(function (k) { return groups[k].type === "movie" && norm(groups[k].name) === norm(p.name); });
        g = cand.length === 1 ? groups[cand[0]] : group("movie", p.name, 0);
      }
      slot = g.gid + "|" + it.kind + "|" + (it.kind === "photo" ? [p ? p.image : "", p ? p.galleryN : 0, p ? p.season : 0, p ? p.episode : 0].join(":") : String(it.fileName || it.key).toLowerCase());
      if (g.loose) { slot = "loose|" + it.key; }
      cur = slots[slot];
      if (!cur || (it.date || 0) > (cur.item.date || 0) || ((it.date || 0) === (cur.item.date || 0) && it.msgId > cur.item.msgId)) {
        if (cur) { skipped.push(cur.item); cur.group.items = cur.group.items.filter(function (x) { return x !== cur.item; }); picked[cur.item.key] = false; }
        slots[slot] = { item: it, group: g };
        picked[it.key] = true;
        g.items.push(it);
      } else {
        skipped.push(it);
      }
    });
    items.forEach(function (it) { if (!picked[it.key] && skipped.indexOf(it) < 0) { skipped.push(it); } });

    out = Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.items.length; });
    if (loose.items.length) { out.push(loose); }
    out.sort(function (a, b) { return (a.loose ? 1 : 0) - (b.loose ? 1 : 0) || a.topic.localeCompare(b.topic, "es"); });
    out.forEach(function (g) {
      g.items.sort(function (a, b) { return (ORDER[a.kind] || 0) - (ORDER[b.kind] || 0) || a.msgId - b.msgId; });
      g.counts = { video: 0, photo: 0, sub: 0, thumbs: 0 };
      g.bytes = 0;
      g.items.forEach(function (it) { g.counts[it.kind] = (g.counts[it.kind] || 0) + 1; g.bytes += it.size || 0; });
    });
    return {
      groups: out,
      skipped: skipped,
      total: out.reduce(function (n, g) { return n + g.items.length; }, 0),
      bytes: out.reduce(function (n, g) { return n + g.bytes; }, 0)
    };
  }

  /* ---------- copiar a un grupo con temas, sin volver a subir ---------- */
  function floodSeconds(e) {
    var t = String((e && (e.text || e.message)) || e);
    var m = /FLOOD_WAIT_?(\d+)/i.exec(t);
    if (m) { return Number(m[1]); }
    if (e && typeof e.seconds === "number") { return e.seconds; }
    return /FLOOD|SLOWMODE/i.test(t) ? 20 : 0;
  }

  /* opts: {client, to (chat destino), plan, state, save(state), onProgress(info), signal, chunk, pause}
   * state: {topics: {gid: númeroDelTema}, sent: {"chat:viejo": "chat:nuevo"}, done: {gid: true}} (se guarda tras cada envío: si se corta, sigue donde iba) */
  async function migrate(opts) {
    var client = opts.client;
    var to = opts.to;
    var state = opts.state || {};
    var groups = opts.plan.groups;
    var chunk = opts.chunk || 40;
    var pause = opts.pause === undefined ? 1200 : opts.pause;
    var i;
    var g;
    var pending;
    var topic;
    var runs;
    var r;
    var k;
    var res;
    var tries;
    var waitS;
    var copied = 0;
    var totalLeft = 0;
    state.topics = state.topics || {};
    state.sent = state.sent || {};
    state.done = state.done || {};
    groups.forEach(function (x) { x.items.forEach(function (it) { if (!state.sent[it.key]) { totalLeft += 1; } }); });
    function report(extra) { if (opts.onProgress) { opts.onProgress(Object.assign({ copied: copied, left: totalLeft - copied, groupsDone: Object.keys(state.done).length, groups: groups.length }, extra)); } }
    function persist() { if (opts.save) { opts.save(state); } }

    for (i = 0; i < groups.length; i += 1) {
      g = groups[i];
      if (state.done[g.gid]) { continue; }
      if (opts.signal && opts.signal.aborted) { throw new Error("Detenido."); }
      report({ title: g.topic, step: "tema" });
      if (!state.topics[g.gid]) {
        state.topics[g.gid] = await (g.loose ? ensureNamed(client, to, g.topic) : ensureTopic(client, to, { type: g.type, name: g.name, year: g.year }));
        persist();
      }
      topic = state.topics[g.gid];
      pending = g.items.filter(function (it) { return !state.sent[it.key]; });
      /* de un mismo grupo de origen a la vez (Telegram reenvía de un chat por llamada), en el orden del plan */
      runs = [];
      pending.forEach(function (it) {
        var last = runs[runs.length - 1];
        if (last && last.chat === String(it.chatId) && last.items.length < chunk) { last.items.push(it); } else { runs.push({ chat: String(it.chatId), items: [it] }); }
      });
      for (k = 0; k < runs.length; k += 1) {
        r = runs[k];
        tries = 0;
        for (;;) {
          if (opts.signal && opts.signal.aborted) { throw new Error("Detenido."); }
          try {
            res = await (client.forwardMessagesById || client.forwardMessages).call(client, {
              messages: r.items.map(function (it) { return it.msgId; }),
              fromChatId: Number(r.chat),
              toChatId: to,
              noAuthor: true,
              toThreadId: topic
            });
            break;
          } catch (e) {
            waitS = floodSeconds(e);
            tries += 1;
            if (!waitS || tries > 5) { throw e; }
            report({ title: g.topic, step: "espera", wait: waitS });
            await sleep(waitS * 1000 + 500);
          }
        }
        r.items.forEach(function (it, n) {
          var m = res && res[n];
          state.sent[it.key] = m && m.id ? chatId(to) + ":" + m.id : "?";
          copied += 1;
        });
        persist();
        report({ title: g.topic, step: "copiando" });
        if (pause) { await sleep(pause); }
      }
      state.done[g.gid] = true;
      persist();
      report({ title: g.topic, step: "listo" });
    }
    return state;
  }

  return {
    noteForum: noteForum, isForum: isForum, patch: patch, topicFor: topicFor, ensureTopic: ensureTopic, loadTopics: loadTopics, find: find, refresh: refresh,
    plan: plan, migrate: migrate, topicName: topicName, LOOSE: LOOSE,
    _: { norm: norm, parseTopic: parseTopic, findTopic: findTopic, reset: function () { tops = {}; making = {}; } }
  };
}());
