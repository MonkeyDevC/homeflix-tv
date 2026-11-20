/* HomeFlix · canal «Anime» (misma lógica para la TV de Samsung, la TV Android y el celular).
 *
 * Es un chat más de la biblioteca, siempre disponible en todas las cuentas: su id es «anime» (los videos tienen
 * clave «anime:<id de AniList>:<capítulo>», así que todo lo que filtra por chat —chats del perfil, progreso, Mi lista— lo
 * trata como cualquier otro). Su contenido no viene de Telegram sino de la anime-api, a la que SOLO llega el servidor de
 * HomeFlix: la app le pide todo a https://scalvache.shop/productos/HomeFlix/api/v1/anime/… con la llave de la cuenta
 * (la misma de la sincronización) y el servidor firma las direcciones del video (servidor/src/anime.js).
 *
 *   HFAnime.SOURCE / NAME                    id y nombre del chat fijo
 *   HFAnime.enabled()                        ¿lo tiene activo el perfil actual?
 *   HFAnime.mergeInto(lib)                   agrega los animes (lib.anime, lib.titles, lib.byKey) a la biblioteca armada
 *   HFAnime.rows()                           filas de la sección Anime [{id, name, titles}]
 *   HFAnime.refresh(onChange)                trae del servidor tendencias, populares, recientes… (cada 30 min)
 *   HFAnime.search(q) → Promise<títulos>     búsqueda en el catálogo completo
 *   HFAnime.ensure(t) → Promise<t>           carga los capítulos (y la ficha) de un anime
 *   HFAnime.stream(ep, audio) → Promise      {url, subs: [{key, label, lang, url, format, def}], servidor}
 *   HFAnime.tag(ep)                          «Cap. 7» (en vez de T1:E7)
 *
 * Todo se guarda en este dispositivo: la lista de inicio (hf.anime.feed), lo que el usuario ha tocado (hf.anime.known:
 * para que Mi lista y Continuar viendo sigan ahí sin red) y los capítulos de cada anime (hf.anime.eps.<id>). */
var HFAnime = (function () {
  "use strict";

  var SOURCE = "anime";
  var NAME = "Anime";
  var FEED_TTL = 30 * 60 * 1000;
  var EPS_TTL = 6 * 3600 * 1000;
  var CHUNK = 50; // los animes largos se parten en bloques de 50 capítulos (en pantalla serían «temporadas»)
  var MAX_KNOWN = 60;

  var ROWS = [
    { id: "trending", name: "En tendencia", path: "/trending", q: { per_page: 24 } },
    { id: "popular", name: "Los más populares", path: "/popular", q: { per_page: 24 } },
    { id: "recent", name: "Recién salidos", path: "/recent", q: { per_page: 24 } },
    { id: "upcoming", name: "Próximamente", path: "/upcoming", q: { per_page: 24 } },
    { id: "g-accion", name: "Acción", path: "/filter", q: { genre: "Action", sort: "POPULARITY_DESC", per_page: 24 } },
    { id: "g-aventura", name: "Aventura", path: "/filter", q: { genre: "Adventure", sort: "POPULARITY_DESC", per_page: 24 } },
    { id: "g-comedia", name: "Comedia", path: "/filter", q: { genre: "Comedy", sort: "POPULARITY_DESC", per_page: 24 } },
    { id: "g-fantasia", name: "Fantasía", path: "/filter", q: { genre: "Fantasy", sort: "POPULARITY_DESC", per_page: 24 } },
    { id: "g-romance", name: "Romance", path: "/filter", q: { genre: "Romance", sort: "POPULARITY_DESC", per_page: 24 } },
    { id: "g-scifi", name: "Ciencia ficción", path: "/filter", q: { genre: "Sci-Fi", sort: "POPULARITY_DESC", per_page: 24 } }
  ];

  /* Filas por idioma: el servidor va sondeando el catálogo (capítulo 1) y lleva el índice de qué trae subtítulos en español,
   * doblaje en inglés, o solo japonés con subtítulos en inglés (servidor/src/anime-idiomas.js). Llega en feed.idiomas. */
  var LANG_ROWS = [
    { id: "l-es", name: "Con subtítulos en español", key: "es", after: "trending" },
    { id: "l-dub", name: "Doblados al inglés", key: "dub", after: "l-es" },
    { id: "l-en", name: "Japonés con subtítulos en inglés", key: "en", after: "" }
  ];
  var esIds = {};         // id → true si el índice dice que trae subtítulos en español
  var objs = {};          // id → objeto de título (siempre el mismo, para que los capítulos cargados no se pierdan)
  var feed = readJson("hf.anime.feed") || { at: 0, rows: {} };
  var known = readJson("hf.anime.known") || { list: [] }; // list: [{...compacto}] el más reciente primero
  var epsLoading = {};
  var searchCache = {};
  var refreshing = false;
  var lastTry = 0;        // cuándo se intentó traer la lista por última vez (con o sin éxito)
  var RETRY = 90 * 1000;  // sin «forzar», no se vuelve a intentar antes de esto: un fallo NO debe provocar un bucle de pedidos
  var lastError = "";
  var keyPromise = null;
  var keyAccount = "";

  /* ===================== Almacenamiento ===================== */

  function readJson(k) {
    try {
      var v = window.localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJson(k, v) {
    try {
      window.localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* almacenamiento lleno: se pierde solo la caché */
    }
  }

  /* ===================== Servidor ===================== */

  function origin() {
    return String((typeof HFSync !== "undefined" && HFSync.server) || "https://scalvache.shop/productos/HomeFlix").replace(/^(https?:\/\/[^/]+).*$/, "$1");
  }

  function accountKey() {
    var acc = typeof HFLibrary !== "undefined" ? HFLibrary.accountId() : "";
    if (!keyPromise || keyAccount !== acc) {
      keyAccount = acc;
      keyPromise = HFSync.key();
      keyPromise.catch(function () { keyPromise = null; });
    }
    return keyPromise;
  }

  function query(q) {
    var out = [];
    Object.keys(q || {}).forEach(function (k) {
      if (q[k] !== undefined && q[k] !== null && q[k] !== "") { out.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k])); }
    });
    return out.length ? "?" + out.join("&") : "";
  }

  /* GET al servidor de HomeFlix con la llave de la cuenta. Si el servidor aún no conoce la cuenta (primera vez, antes de
   * la primera sincronización), sincroniza y reintenta una vez. */
  function call(path, q, retried) {
    return accountKey().then(function (key) {
      return fetch(HFSync.server + "/api/v1/anime" + path + query(q), { headers: { authorization: "Bearer " + key } });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 404 && data && data.error === "sin_cuenta" && !retried && typeof HFSync.now === "function") {
          return Promise.resolve(HFSync.now()).catch(function () { /* se reintenta igual */ }).then(function () { return call(path, q, true); });
        }
        if (!res.ok) {
          if (res.status === 429) { throw new Error("Demasiadas peticiones seguidas: espera un momento e inténtalo de nuevo."); }
          throw new Error(data && data.error === "anime_apagado" ? "El canal Anime no está disponible todavía." : data && data.error === "bloqueada" ? "Esta cuenta está bloqueada." : "No se pudo hablar con el servidor de anime (" + res.status + ").");
        }
        return data;
      });
    });
  }

  /* ===================== Títulos ===================== */

  /* Las portadas vienen envueltas en un proxy («serveproxy.com/url?url=…»): se usa la dirección de AniList directa. */
  function cleanImg(u) {
    var m;
    u = String(u || "");
    m = /[?&]url=([^&]+)/.exec(u);
    if (/serveproxy\.com\//.test(u) && m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return u; }
    }
    return u;
  }

  function plain(html) {
    return String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* Lo mínimo de cada anime (lo que se guarda): {i, n, r, m, b, y, f, s, a, g, e, t, d} */
  function compact(a) {
    var t = a.title || {};
    var date = a.startDate || {};
    return {
      i: Number(a.id),
      n: t.english || t.romaji || t.native || "Sin título",
      r: t.romaji || "",
      m: cleanImg((a.coverImage || {}).large || (a.coverImage || {}).extraLarge),
      b: cleanImg(a.bannerImage),
      y: a.seasonYear || date.year || 0,
      f: a.format || "",
      s: a.status || "",
      a: a.averageScore || 0,
      g: (a.genres || []).slice(0, 4),
      e: a.episodes || (a.nextAiringEpisode && a.nextAiringEpisode.episode ? a.nextAiringEpisode.episode - 1 : 0) || 0,
      t: a.duration || 0,
      d: plain(a.description || "")
    };
  }

  var FORMATS = { TV: "Serie", TV_SHORT: "Serie corta", MOVIE: "Película", OVA: "OVA", ONA: "ONA", SPECIAL: "Especial", MUSIC: "Música" };
  var STATUS = { RELEASING: "En emisión", FINISHED: "Terminado", NOT_YET_RELEASED: "Próximamente", CANCELLED: "Cancelado", HIATUS: "En pausa" };

  /* El objeto que entiende la biblioteca (igual a una serie de Telegram) */
  function title(c) {
    var o = objs[c.i];
    if (!o) {
      o = objs[c.i] = {
        type: "series", anime: true, anilistId: c.i, titleKey: "a:" + c.i, seasons: [], episodeCount: 0, loaded: false,
        kids: false, categories: ["Anime"], date: 0, tagged: false
      };
    }
    o.name = c.n;
    o.year = c.y || "";
    o.imageKey = c.m || o.imageKey || "";
    o.bannerKey = c.b || c.m || o.bannerKey || "";
    o.description = c.d || o.description || "";
    o.format = FORMATS[c.f] || c.f || "";
    o.statusText = STATUS[c.s] || "";
    o.score = c.a || 0;
    o.es = !!esIds[c.i];
    o.genres = c.g || [];
    o.minutes = c.t || 0;
    if (!o.loaded) { o.episodeCount = c.e || o.episodeCount || 0; }
    if (!o.cached) {
      o.cached = true;
      fillFromCache(o);
    }
    return o;
  }

  function remember(c) {
    var list = known.list.filter(function (x) { return x.i !== c.i; });
    list.unshift(c);
    known.list = list.slice(0, MAX_KNOWN);
    writeJson("hf.anime.known", known);
  }

  /* ===================== Capítulos ===================== */

  function epsKey(id) { return "hf.anime.eps." + id; }

  function buildSeasons(o, data) {
    var eps = (data.episodios || []).slice().sort(function (a, b) { return a.n - b.n; });
    var dubs = {};
    var seasons = [];
    var i;
    (data.doblados || []).forEach(function (n) { dubs[n] = true; });
    eps.forEach(function (e, idx) {
      var n = e.n;
      var s = Math.floor(idx / CHUNK);
      var ep = {
        type: "episode", anime: true, anilistId: o.anilistId, key: "anime:" + o.anilistId + ":" + n, seriesKey: o.titleKey, seriesName: o.name,
        season: s + 1, episode: n, title: e.titulo || "Capítulo " + n, description: "", filler: !!e.relleno, dub: !!dubs[n], date: 0,
        quality: "HD", versions: [], tagged: false, kids: false, coverKey: (e.imagen ? cleanImg(e.imagen) : "") || o.bannerKey || o.imageKey || "", air: e.fecha || "",
        video: { key: "anime:" + o.anilistId + ":" + n, chatId: SOURCE, chatTitle: NAME, duration: (e.minutos || o.minutes || 24) * 60, size: 0 }
      };
      if (!seasons[s]) { seasons[s] = { number: s + 1, episodes: [] }; }
      seasons[s].episodes.push(ep);
    });
    seasons.forEach(function (s) {
      var first = s.episodes[0].episode;
      var last = s.episodes[s.episodes.length - 1].episode;
      s.label = seasons.length === 1 ? "Capítulos" : "Cap. " + first + "–" + last;
    });
    for (i = 0; i < seasons.length; i += 1) { seasons[i].anime = true; }
    o.seasons = seasons;
    o.episodeCount = eps.length;
    o.loaded = eps.length > 0;
  }

  function fillFromCache(o) {
    var c = readJson(epsKey(o.anilistId));
    if (c && c.data) { buildSeasons(o, c.data); }
  }

  /* Carga (o recarga si pasó mucho) los capítulos y la ficha; si no hay red, usa lo guardado. */
  /* Capítulos al INSTANTE: la lista real (/episodes) tarda hasta 20 s en la anime-api, pero para ver un capítulo solo hace falta su
   * número. Si ya se sabe cuántos hay (AniList), se arma una lista provisional 1…N sin títulos ni miniaturas y la ficha y el
   * botón «Reproducir» funcionan ya; ensure() la reemplaza por la real cuando llega. Devuelve true si hay capítulos para mostrar. */
  function quick(t) {
    var eps = [];
    var n;
    if (t.loaded) { return true; }
    n = Math.min(t.episodeCount || 0, 3000);
    if (n < 1) { return false; }
    for (var i = 1; i <= n; i += 1) { eps.push({ n: i, titulo: "", imagen: "", minutos: t.minutes || 24, relleno: false, fecha: "" }); }
    buildSeasons(t, { episodios: eps, doblados: [] });
    t.provisional = true;
    return true;
  }

  /* La ficha (descripción…) es rápida (~0,3 s): va aparte de los capítulos */
  function info(t) {
    if (t.descFull) { return Promise.resolve(t); }
    return call("/info/" + t.anilistId).then(function (i) {
      var c;
      if (i && i.id) {
        c = compact(i);
        t.descFull = true;
        title(c);
        remember(c);
      }
      return t;
    }, function () { return t; });
  }

  /* Trae (o renueva) la lista real de capítulos; mientras, la provisional sirve. */
  function ensure(t) {
    var id = t.anilistId;
    var saved = readJson(epsKey(id));
    var fresh = saved && saved.at && Date.now() - saved.at < EPS_TTL;
    if (t.loaded && !t.provisional && fresh) { return Promise.resolve(t); }
    if (epsLoading[id]) { return epsLoading[id]; }
    epsLoading[id] = call("/episodes/" + id).then(function (data) {
      delete epsLoading[id];
      remember(compactOf(t));
      writeJson(epsKey(id), { at: Date.now(), data: data });
      buildSeasons(t, data);
      t.provisional = false;
      return t;
    }, function (e) {
      delete epsLoading[id];
      if (t.loaded) { return t; } // sin red (o lenta): se sigue con lo que ya había
      throw e;
    });
    if (!t.descFull) { info(t); }
    return epsLoading[id];
  }

  /* Adelantar la búsqueda de la fuente de un capítulo (el servidor la guarda 30 min y no repite el trabajo si luego se pide). */
  var prefetched = {};
  function prefetch(ep, audio) {
    var k;
    if (!ep || !ep.anime) { return; }
    audio = audio || (readPref("audio", ep.anilistId) === "dub" ? "dub" : "sub");
    k = ep.key + ":" + audio;
    if (prefetched[k]) { return; }
    prefetched[k] = true;
    call("/reproducir", { id: ep.anilistId, e: ep.episode, type: audio }).catch(function () { delete prefetched[k]; });
  }

  function readPref(name, id) {
    try { return window.localStorage.getItem("hf." + name + ".anime:" + id); } catch (e) { return null; }
  }

  function nextOf(ep) {
    var t = objs[ep.anilistId];
    var all = [];
    var i;
    if (!t) { return null; }
    t.seasons.forEach(function (s) { all = all.concat(s.episodes); });
    for (i = 0; i < all.length; i += 1) { if (all[i].key === ep.key) { return all[i + 1] || null; } }
    return null;
  }

  function prefetchNext(ep) { prefetch(nextOf(ep)); }

  function compactOf(t) {
    return { i: t.anilistId, n: t.name, r: "", m: t.imageKey, b: t.bannerKey, y: Number(t.year) || 0, f: "", s: "", a: t.score, g: t.genres, e: t.episodeCount, t: t.minutes, d: t.description };
  }

  /* Apuntar un anime como «tocado» (Mi lista, Continuar viendo): sigue ahí sin red y sobrevive a la lista de inicio. */
  function touch(t) {
    if (t && t.anime) { remember(compactOf(t)); }
  }

  /* ===================== Lista de inicio ===================== */

  function enabled() {
    var m = typeof HFLibrary !== "undefined" ? HFLibrary.enabledSources() : null;
    return !!(m && m[SOURCE]);
  }

  function allTitles() {
    var seen = {};
    var out = [];
    function add(c) {
      if (c && !seen[c.i]) { seen[c.i] = 1; out.push(title(c)); }
    }
    ROWS.forEach(function (r) { ((feed.rows || {})[r.id] || []).forEach(add); });
    LANG_ROWS.forEach(function (r) { ((feed.idiomas || {})[r.key] || []).forEach(add); });
    known.list.forEach(add);
    return out;
  }

  function indexEs() {
    esIds = {};
    ((feed.idiomas || {}).es || []).forEach(function (c) { esIds[c.i] = true; });
    Object.keys(objs).forEach(function (id) { objs[id].es = !!esIds[id]; });
  }
  indexEs();

  function mergeInto(lib) {
    var list;
    if (!enabled()) { lib.anime = []; return lib; }
    list = allTitles();
    list.forEach(function (t) {
      lib.titles[t.titleKey] = t;
      t.seasons.forEach(function (s) { s.episodes.forEach(function (ep) { lib.byKey[ep.key] = ep; }); });
    });
    lib.anime = list;
    return lib;
  }

  function rows() {
    var out = [];
    var idi = feed.idiomas || {};
    var note = idi.total ? idi.sondeados + " de " + idi.total + " revisados" : "";
    ROWS.forEach(function (r) {
      var list = ((feed.rows || {})[r.id] || []).map(title);
      if (list.length) { out.push({ id: r.id, name: r.name, titles: list }); }
    });
    /* las filas por idioma van junto a las de siempre: español y doblaje después de «En tendencia», inglés al final */
    LANG_ROWS.forEach(function (r) {
      var list = (idi[r.key] || []).slice(0, 100).map(title);
      var hay = (idi.cuantos || {})[r.key] || list.length;
      var at = -1;
      var i;
      if (!list.length) { return; }
      for (i = 0; i < out.length; i += 1) { if (out[i].id === r.after) { at = i; } }
      out.splice(r.after && at >= 0 ? at + 1 : out.length, 0, { id: r.id, name: r.name, titles: list, note: (hay > list.length ? list.length + " de " + hay : String(list.length)) + (note ? " · " + note : "") });
    });
    return out;
  }

  function hasFeed() {
    return rows().length > 0;
  }

  function refresh(onChange, force) {
    if (refreshing || !enabled()) { return Promise.resolve(false); }
    if (!force && feed.at && Date.now() - feed.at < FEED_TTL && hasFeed()) { return Promise.resolve(false); }
    if (!force && lastTry && Date.now() - lastTry < RETRY) { return Promise.resolve(false); }
    lastTry = Date.now();
    refreshing = true;
    return call("/inicio").then(function (d) {
      var map = function (l) { return (l || []).filter(function (a) { return a && a.id && !a.isAdult; }).map(compact); };
      var idi;
      if (!d || !d.filas || !Object.keys(d.filas).length) { return refreshLegacy(onChange); }
      idi = d.idiomas || {};
      Object.keys(d.filas || {}).forEach(function (id) { var l = map(d.filas[id]); if (l.length) { feed.rows[id] = l; } });
      feed.idiomas = { es: map(idi.es), dub: map(idi.dub), en: map(idi.en), cuantos: idi.cuantos || {}, total: idi.total || 0, sondeados: idi.sondeados || 0 };
      indexEs();
      lastError = "";
      feed.at = Date.now();
      writeJson("hf.anime.feed", feed);
      refreshing = false;
      if (onChange) { onChange(); }
      return true;
    }, function () {
      /* servidor sin /inicio (versión vieja) o caído: se piden las listas una por una, como antes */
      return refreshLegacy(onChange);
    });
  }

  function refreshLegacy(onChange) {
    var pending;
    var failed = 0;
    pending = [call("/idiomas").then(function (d) {
      var map = function (l) { return (l || []).filter(function (a) { return a && a.id && !a.isAdult; }).map(compact); };
      feed.idiomas = { es: map(d.es), dub: map(d.dub), en: map(d.en), total: d.total || 0, sondeados: d.sondeados || 0 };
      indexEs();
      if (onChange) { onChange(); }
    }, function () { /* sin el índice quedan las filas de siempre */ })].concat(ROWS.map(function (r) {
      return call(r.path, r.q).then(function (d) {
        var list = (d.results || d.data || []).filter(function (a) { return a && a.id && !a.isAdult; }).map(compact);
        if (list.length) {
          feed.rows[r.id] = list;
          if (onChange) { onChange(); }
        }
      }, function (e) { failed += 1; lastError = String((e && e.message) || e || ""); });
    }));
    return Promise.all(pending).then(function () {
      refreshing = false;
      if (failed < ROWS.length) {
        lastError = "";
        feed.at = Date.now();
        writeJson("hf.anime.feed", feed);
      }
      if (onChange) { onChange(); }
      return failed < ROWS.length;
    });
  }

  function search(q) {
    var key = String(q || "").trim().toLowerCase();
    if (key.length < 2) { return Promise.resolve([]); }
    if (searchCache[key]) { return Promise.resolve(searchCache[key]); }
    return call("/search", { query: q, per_page: 20 }).then(function (d) {
      var list = (d.results || []).filter(function (a) { return a && a.id && !a.isAdult; }).map(function (a) { return title(compact(a)); });
      searchCache[key] = list;
      return list;
    });
  }

  function cachedSearch(q) {
    return searchCache[String(q || "").trim().toLowerCase()] || [];
  }

  /* ===================== Video ===================== */

  function absolute(u) {
    return /^https?:/i.test(u) ? u : origin() + u;
  }

  function subLabel(raw, used) {
    var base = String(raw || "").replace(/\s*\(.*$/, "").trim() || "Subtítulos";
    var low = base.toLowerCase();
    var label = /^(english|inglés|ingles)$/.test(low) ? "Inglés" : /^(spanish|español|espanol)/.test(low) ? "Español" : /latin|latam/.test(low) ? "Español latino" : /portugu/.test(low) ? "Portugués" : /japan/.test(low) ? "Japonés" : /french|fran/.test(low) ? "Francés" : /german|deutsch/.test(low) ? "Alemán" : /italian/.test(low) ? "Italiano" : /arab/.test(low) ? "Árabe" : /russian/.test(low) ? "Ruso" : base;
    used[label] = (used[label] || 0) + 1;
    return used[label] > 1 ? label + " · " + used[label] : label;
  }

  var CODES = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian", ja: "Japanese", ar: "Arabic", ru: "Russian" };

  function isSpanish(label) { return /^español/i.test(label); }

  /* audio: "sub" (japonés con subtítulos) o "dub" (doblaje en inglés) */
  function stream(ep, audio) {
    return call("/reproducir", { id: ep.anilistId, e: ep.episode, type: audio === "dub" ? "dub" : "sub" }).then(function (d) {
      var s = (d.streams || [])[0];
      var used = {};
      if (!s) { throw new Error("No encontré una fuente para este capítulo. Prueba en un rato."); }
      return {
        url: absolute(s.url),
        servidor: s.servidor || "",
        tipo: s.tipo || "hls",
        audio: s.audio || audio || "sub",
        subs: (s.subtitulos || []).map(function (x, i) {
          var label = subLabel(x.idioma || CODES[x.codigo] || "", used);
          return { key: "w:" + i, label: label, lang: isSpanish(label) ? "spa" : /^inglés/i.test(label) ? "eng" : "", url: absolute(x.url), format: x.formato || "", def: !!x.defecto, raw: x.idioma };
        })
      };
    });
  }

  /* El capítulo n de un anime, aunque la app no lo conozca todavía (p. ej. lo manda el celular a la TV): {item, series} */
  function resolve(id, n) {
    var first = objs[id] ? Promise.resolve(objs[id]) : call("/info/" + id).then(function (info) { return title(compact(info)); });
    return first.then(ensure).then(function (t) {
      var found = null;
      t.seasons.forEach(function (s) { s.episodes.forEach(function (e) { if (e.episode === n) { found = e; } }); });
      if (!found) { throw new Error("La TV no encontró ese capítulo."); }
      return { item: found, series: t };
    });
  }

  /* Un anime ya visto en esta sesión (p. ej. un resultado de búsqueda) por su titleKey «a:<id>» */
  function byKey(titleKey) {
    var m = /^a:(\d+)$/.exec(String(titleKey || ""));
    return m ? objs[m[1]] || null : null;
  }

  function tag(ep) {
    return "Cap. " + ep.episode;
  }

  function resetAccount() {
    keyPromise = null;
    keyAccount = "";
  }

  return {
    SOURCE: SOURCE, NAME: NAME,
    enabled: enabled, mergeInto: mergeInto, rows: rows, hasFeed: hasFeed, refresh: refresh,
    search: search, cachedSearch: cachedSearch, ensure: ensure, touch: touch, stream: stream, tag: tag, byKey: byKey, resolve: resolve, quick: quick, info: info, prefetch: prefetch, prefetchNext: prefetchNext,
    resetAccount: resetAccount,
    _retry: function (ms) { RETRY = ms; lastTry = 0; }, lastError: function () { return lastError; }
  };
}());
