/* Biblioteca de HomeFlix: lee los comentarios de los videos (docs/formato-comentarios.md), arma películas y series,
 * y guarda en este dispositivo lo que es de cada cuenta: chats activos, catálogo en caché, progreso y "Mi lista".
 * Sin dependencias del DOM ni de Telegram: se puede probar con node (tools/test-library.mjs). */
var HFLibrary = (function () {
  "use strict";

  var MOVIE_WORDS = /^(pel[ií]cula|peli|movie|film)$/i;
  var SERIES_WORDS = /^(series?|show)$/i;

  function clean(s) {
    return String(s == null ? "" : s).replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  }

  /* Clave para agrupar: sin tildes, minúsculas, solo letras y números. */
  function norm(s) {
    var t = clean(s).toLowerCase();
    if (t.normalize) {
      t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    }
    return t.replace(/[^a-z0-9]+/g, " ").trim();
  }

  /* "(1/3)", "(T1/E3)", "(T1E3)", "(1x03)", "(S01E03)", "(T1 C3)", "(1-3)" → {season, episode} */
  function parseSeasonEpisode(inside) {
    var m = /^\s*[ts]?\s*(\d{1,3})\s*(?:[\/x\-]|\s)?\s*[ecx]?\s*(\d{1,4})\s*$/i.exec(inside || "");
    if (!m) {
      return null;
    }
    return { season: Number(m[1]), episode: Number(m[2]) };
  }

  /* "El Rey León (1994)" → {name: "El Rey León", year: 1994} */
  function splitYear(name) {
    var m = /^(.*?)\s*[\(\[](\d{4})[\)\]]\s*$/.exec(name);
    if (m && m[1]) {
      return { name: m[1], year: Number(m[2]) };
    }
    return { name: name, year: 0 };
  }

  /* Lee el comentario. Devuelve null si no sigue el formato.
   * {type: "movie"|"series", name, year, season, episode, episodeTitle, description} */
  function parseCaption(text) {
    var raw = String(text == null ? "" : text).replace(/\r/g, "").trim();
    var head;
    var word;
    var paren;
    var rest;
    var fields;
    var se;
    var named;
    var out;
    var nl;
    var kids = false;
    var kidsMark;
    if (!raw) {
      return null;
    }
    /* "#infantil" (o #kids / #niños) al final: contenido para el perfil Kids. */
    kidsMark = /\s*#\s*(infantil|kids|ni[ñn]os)\s*$/i.exec(raw);
    if (kidsMark) {
      kids = true;
      raw = raw.slice(0, kidsMark.index).replace(/\s+$/, "");
    }
    head = /^#?\s*([a-zA-ZíÍ]+)\s*(\(([^)]*)\))?\s*#([\s\S]*)$/.exec(raw);
    if (!head) {
      return null;
    }
    word = head[1];
    paren = head[3];
    rest = head[4];
    if (!MOVIE_WORDS.test(word) && !SERIES_WORDS.test(word)) {
      return null;
    }
    /* Solo se cortan los campos necesarios: lo que queda es la descripción tal cual (puede llevar # o varias líneas). */
    fields = takeFields(rest, MOVIE_WORDS.test(word) ? 1 : 2);
    /* El nombre no lleva saltos de línea: lo que siga en otra línea es descripción. */
    nl = fields[0].indexOf("\n");
    if (nl >= 0) {
      fields = [fields[0].slice(0, nl), fields[0].slice(nl + 1) + (fields.length > 1 ? "#" + fields.slice(1).join("#") : "")];
    }
    fields[0] = clean(fields[0]);
    if (!fields[0]) {
      return null;
    }
    named = splitYear(fields[0]);
    out = {
      type: MOVIE_WORDS.test(word) ? "movie" : "series",
      name: named.name,
      year: named.year,
      season: 0,
      episode: 0,
      episodeTitle: "",
      description: "",
      kids: kids
    };
    if (out.type === "movie") {
      out.description = (fields[1] || "").trim();
      return out;
    }
    se = paren ? parseSeasonEpisode(paren) : null;
    if (se) {
      out.season = se.season;
      out.episode = se.episode;
    }
    if (fields.length >= 3) {
      out.episodeTitle = clean(fields[1]);
      out.description = fields[2].trim();
    } else {
      out.description = (fields[1] || "").trim();
    }
    return out;
  }

  /* "a#b#c#d" con n=2 → ["a", "b", "c#d"]: n campos y el resto sin tocar. */
  function takeFields(text, n) {
    var out = [];
    var pos = 0;
    var i;
    var at;
    for (i = 0; i < n; i += 1) {
      at = text.indexOf("#", pos);
      if (at < 0) {
        break;
      }
      out.push(text.slice(pos, at));
      pos = at + 1;
    }
    out.push(text.slice(pos));
    return out;
  }

  /* "The.Last.Emperor.1987.1080p.BluRay.x264.mkv" → "The Last Emperor 1987" */
  function titleFromFile(fileName) {
    var base = String(fileName || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/\[[^\]]*\]/g, " ");
    var cut = /(^|[\s._\-])(2160p|1080p|720p|480p|4k|bluray|brrip|web[\s._\-]?dl|webrip|hdtv|x26[45]|h\.?26[45]|hevc|dvdrip)/i.exec(base);
    if (cut) {
      base = base.slice(0, cut.index);
    }
    base = base.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
    return base || "Video sin nombre";
  }

  function quality(v) {
    var h = v.height || 0;
    if (h >= 2000) { return "4K"; }
    if (h >= 1000) { return "1080p"; }
    if (h >= 700) { return "720p"; }
    if (h > 0) { return h + "p"; }
    return "";
  }

  function newer(a, b) {
    return (a.date || 0) >= (b.date || 0) ? a : b;
  }

  /* items: [{key, chatId, chatTitle, msgId, kind: "video"|"photo", caption, fileName, duration, size, width, height, date}]
   * tags: {videoKey: comentario} etiquetas puestas desde la TV; reemplazan el comentario de Telegram de ese video.
   * → {movies, series, unclassified, recent, byKey, titles} */
  function build(items, tags) {
    var movies = {};
    var series = {};
    var infos = {};
    var unclassified = [];
    var byKey = {};
    var all = [];
    var list;

    (items || []).forEach(function (it) {
      var tagged = !!(tags && Object.prototype.hasOwnProperty.call(tags, it.key));
      var p = parseCaption(tagged ? tags[it.key] : it.caption);
      var key;
      var s;
      var ep;
      var seasonKey;
      if (it.kind === "photo") {
        if (p) {
          key = (p.type === "movie" ? "m:" + norm(p.name) + (p.year ? ":" + p.year : "") : "s:" + norm(p.name));
          infos[key] = infos[key] ? newer(infos[key], { photoKey: it.key, description: p.description, date: it.date, kids: p.kids }) : { photoKey: it.key, description: p.description, date: it.date, kids: p.kids };
        }
        return;
      }
      if (!p) {
        unclassified.push({
          type: "video", key: it.key, titleKey: "v:" + it.key, name: titleFromFile(it.fileName) || "Video", description: clean(it.caption),
          video: it, quality: quality(it), date: it.date
        });
        return;
      }
      if (p.type === "movie") {
        key = "m:" + norm(p.name) + (p.year ? ":" + p.year : "");
        if (!movies[key] || it.date >= movies[key].video.date) {
          movies[key] = {
            type: "movie", titleKey: key, name: p.name, year: p.year, description: p.description, kids: p.kids, tagged: tagged,
            video: it, quality: quality(it), date: it.date, imageKey: it.key
          };
        }
        return;
      }
      key = "s:" + norm(p.name);
      s = series[key];
      if (!s) {
        s = series[key] = { type: "series", titleKey: key, name: p.name, year: p.year, description: "", seasons: {}, loose: [], date: 0, imageKey: "", kids: false };
      }
      if (p.kids) {
        s.kids = true;
      }
      ep = {
        type: "episode", key: it.key, seriesKey: key, seriesName: p.name, season: p.season, episode: p.episode,
        title: p.episodeTitle, description: p.description, video: it, quality: quality(it), date: it.date, tagged: tagged, kids: p.kids
      };
      if (!p.season || !p.episode) {
        s.loose.push(ep);
      } else {
        seasonKey = String(p.season);
        s.seasons[seasonKey] = s.seasons[seasonKey] || {};
        if (!s.seasons[seasonKey][p.episode] || it.date >= s.seasons[seasonKey][p.episode].date) {
          s.seasons[seasonKey][p.episode] = ep;
        }
      }
      if (it.date > s.date) {
        s.date = it.date;
      }
    });

    /* Series: ordenar temporadas y capítulos; los capítulos sin (T/E) van al final de la temporada 1 por fecha. */
    list = Object.keys(series).map(function (k) {
      var s = series[k];
      var seasonNums = Object.keys(s.seasons).map(Number).sort(function (a, b) { return a - b; });
      var seasons = seasonNums.map(function (n) {
        var eps = s.seasons[n];
        return { number: n, episodes: Object.keys(eps).map(Number).sort(function (a, b) { return a - b; }).map(function (e) { return eps[e]; }) };
      });
      var last;
      var next;
      if (s.loose.length) {
        s.loose.sort(function (a, b) { return a.date - b.date; });
        if (!seasons.length || seasons[0].number !== 1) {
          seasons.unshift({ number: 1, episodes: [] });
        }
        last = seasons[0].episodes.length ? seasons[0].episodes[seasons[0].episodes.length - 1].episode : 0;
        s.loose.forEach(function (ep) {
          next = (last += 1);
          ep.season = 1;
          ep.episode = next;
          seasons[0].episodes.push(ep);
        });
      }
      seasons.forEach(function (season) {
        season.episodes.forEach(function (ep) {
          if (!ep.title) {
            ep.title = "Capítulo " + ep.episode;
          }
          byKey[ep.key] = ep;
          all.push(ep);
        });
      });
      s.seasons = seasons;
      s.episodeCount = seasons.reduce(function (n, x) { return n + x.episodes.length; }, 0);
      s.imageKey = seasons.length && seasons[0].episodes.length ? seasons[0].episodes[0].key : "";
      delete s.loose;
      return s;
    });

    /* Fichas (fotos): portada y descripción. */
    function applyInfo(t) {
      var info = infos[t.titleKey];
      if (info) {
        t.imageKey = info.photoKey;
        t.posterIsPhoto = true;
        if (info.kids) {
          t.kids = true;
        }
        if (info.description) {
          t.description = info.description;
        }
      }
      if (t.type === "series" && !t.description) {
        t.description = t.seasons.length && t.seasons[0].episodes.length ? "" : "";
      }
    }

    var movieList = Object.keys(movies).map(function (k) { return movies[k]; });
    movieList.forEach(function (m) {
      applyInfo(m);
      byKey[m.video.key] = m;
      all.push(m);
    });
    list.forEach(applyInfo);
    unclassified.forEach(function (u) { byKey[u.key] = u; });

    movieList.sort(function (a, b) { return a.name.localeCompare(b.name); });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    unclassified.sort(function (a, b) { return b.date - a.date; });

    return {
      movies: movieList,
      series: list,
      unclassified: unclassified,
      recent: movieList.concat(list).sort(function (a, b) { return b.date - a.date; }),
      byKey: byKey,
      titles: movieList.concat(list).reduce(function (o, t) { o[t.titleKey] = t; return o; }, {})
    };
  }

  /* ===== Datos de este dispositivo =====
   * Por cuenta de Telegram: chats activos, catálogo en caché, etiquetas puestas desde la TV y la lista de perfiles.
   * Por perfil (dentro de la cuenta): progreso y Mi lista. El primer perfil usa las claves de antes (sin sufijo). */
  var accountId = "anon";
  var profileId = "";

  function setAccount(id) {
    accountId = String(id || "anon");
    profileId = "";
  }

  function storageKey(name, perProfile) {
    return "hf." + name + "." + accountId + (perProfile && profileId ? "." + profileId : "");
  }

  function load(name, fallback, perProfile) {
    try {
      var v = window.localStorage.getItem(storageKey(name, perProfile));
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(name, value, perProfile) {
    try {
      window.localStorage.setItem(storageKey(name, perProfile), JSON.stringify(value));
    } catch (e) {
      /* almacenamiento lleno: se pierde solo la caché */
    }
  }

  /* ----- Perfiles ----- */
  var COLORS = ["amarillo", "azul", "verde", "cafe", "rojo", "morado"];
  var DEFAULT_AVATARS = ["panda", "zorro", "dino", "buho", "robot", "gato"];
  var MAX_PROFILES = 5;

  function profiles() {
    var list = load("profiles", null);
    if (!list || !list.length) {
      list = [
        { id: "p1", name: "Familia", color: "amarillo", avatar: "panda", kids: false },
        { id: "p2", name: "Santiago", color: "azul", avatar: "zorro", kids: false },
        { id: "p3", name: "Kids", color: "verde", avatar: "dino", kids: true },
        { id: "p4", name: "Invitado", color: "cafe", avatar: "buho", kids: false }
      ];
      save("profiles", list);
    }
    /* perfiles creados antes de los avatares */
    list.forEach(function (p, i) {
      if (!p.avatar) {
        p.avatar = DEFAULT_AVATARS[i % DEFAULT_AVATARS.length];
      }
    });
    return list;
  }

  function saveProfile(p) {
    var list = profiles();
    var i;
    var name = clean(p.name).slice(0, 20);
    if (!name) {
      return { error: "Escribe un nombre para el perfil." };
    }
    for (i = 0; i < list.length; i += 1) {
      if (list[i].id !== p.id && norm(list[i].name) === norm(name)) {
        return { error: "Ya existe un perfil con ese nombre." };
      }
    }
    if (!p.id) {
      if (list.length >= MAX_PROFILES) {
        return { error: "Puedes tener hasta " + MAX_PROFILES + " perfiles." };
      }
      p.id = "p" + Date.now().toString(36);
      list.push({ id: p.id, name: name, color: p.color || COLORS[0], avatar: p.avatar || DEFAULT_AVATARS[list.length % DEFAULT_AVATARS.length], kids: !!p.kids });
    } else {
      for (i = 0; i < list.length; i += 1) {
        if (list[i].id === p.id) {
          list[i] = { id: p.id, name: name, color: p.color || list[i].color, avatar: p.avatar || list[i].avatar, kids: !!p.kids };
        }
      }
    }
    save("profiles", list);
    return { profile: p };
  }

  /* Borra el perfil y su progreso y Mi lista. Siempre queda al menos uno. */
  function deleteProfile(id) {
    var list = profiles();
    var keep = list.filter(function (p) { return p.id !== id; });
    var old = profileId;
    if (keep.length === list.length || !keep.length) {
      return false;
    }
    profileId = id === list[0].id ? "" : id;
    try {
      window.localStorage.removeItem(storageKey("progress", true));
      window.localStorage.removeItem(storageKey("mylist", true));
    } catch (e) {
      /* nada */
    }
    profileId = old;
    save("profiles", keep);
    return true;
  }

  /* El primer perfil de la lista guarda en las claves sin sufijo (así no se pierde el progreso que ya existía). */
  function setProfile(id) {
    var list = profiles();
    profileId = !id || id === list[0].id ? "" : String(id);
  }

  function currentProfile() {
    var list = profiles();
    var id = profileId || list[0].id;
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        return list[i];
      }
    }
    return list[0];
  }

  /* ----- Etiquetas puestas desde la TV: {videoKey: comentario con el formato} ----- */
  function tags() { return load("tags", {}); }

  function setTag(videoKey, caption) {
    var all = tags();
    if (caption === null || caption === undefined) {
      delete all[videoKey];
    } else {
      all[videoKey] = caption;
    }
    save("tags", all);
  }

  /* Arma el comentario a partir de los campos del editor de la TV (el mismo formato que en Telegram). */
  function composeCaption(f) {
    var name = clean(f.name).replace(/#/g, "");
    var desc = String(f.description || "").replace(/#/g, "").trim();
    var title = clean(f.episodeTitle).replace(/#/g, "");
    var out;
    if (f.year) {
      name += " (" + f.year + ")";
    }
    if (f.type === "movie") {
      out = "pelicula#" + name + (desc ? "#" + desc : "");
    } else {
      /* con título del capítulo hacen falta los dos campos (título#descripción), aunque la descripción esté vacía */
      out = "serie(" + (f.season || 1) + "/" + (f.episode || 1) + ")#" + name + (title ? "#" + title + "#" + desc : (desc ? "#" + desc : ""));
    }
    return out + (f.kids ? " #infantil" : "");
  }

  /* Lo que ve el perfil Kids: solo películas y series marcadas #infantil; nada sin clasificar. */
  function filterKids(lib) {
    var movies = lib.movies.filter(function (m) { return m.kids; });
    var series = lib.series.filter(function (s) { return s.kids; });
    var titles = {};
    var byKey = {};
    movies.forEach(function (m) { titles[m.titleKey] = m; byKey[m.video.key] = m; });
    series.forEach(function (s) {
      titles[s.titleKey] = s;
      s.seasons.forEach(function (season) { season.episodes.forEach(function (ep) { byKey[ep.key] = ep; }); });
    });
    return {
      movies: movies,
      series: series,
      unclassified: [],
      recent: lib.recent.filter(function (t) { return !!titles[t.titleKey]; }),
      byKey: byKey,
      titles: titles
    };
  }

  /* Chats activos: {id: título} */
  function enabledSources() { return load("sources", null); }
  function setEnabledSources(map) { save("sources", map); }

  /* Catálogo en caché (los items de Telegram, sin los mensajes): se muestra al abrir mientras se actualiza. */
  function cachedItems() { return load("items", []); }
  function setCachedItems(items) { save("items", items); }

  /* Progreso: {videoKey: {t: segundos, d: duración, at: fecha}} */
  function progress(videoKey) {
    var all = load("progress", {}, true);
    return all[videoKey] || null;
  }
  function setProgress(videoKey, t, d) {
    var all = load("progress", {}, true);
    if (d && t >= d - 30) {
      all[videoKey] = { t: 0, d: d, at: Date.now(), done: true };
    } else {
      all[videoKey] = { t: Math.floor(t), d: Math.floor(d || 0), at: Date.now() };
    }
    save("progress", all, true);
  }
  function allProgress() { return load("progress", {}, true); }

  /* Mi lista: [titleKey] */
  function myList() { return load("mylist", [], true); }
  function inMyList(titleKey) { return myList().indexOf(titleKey) >= 0; }
  function toggleMyList(titleKey) {
    var l = myList();
    var i = l.indexOf(titleKey);
    if (i >= 0) {
      l.splice(i, 1);
    } else {
      l.unshift(titleKey);
    }
    save("mylist", l, true);
    return i < 0;
  }

  /* Siguiente capítulo de una serie a partir del progreso: el último empezado sin terminar, o el siguiente al último terminado. */
  function nextEpisode(series) {
    var eps = [];
    var best = null;
    var bestAt = -1;
    var i;
    var p;
    series.seasons.forEach(function (s) { eps = eps.concat(s.episodes); });
    for (i = 0; i < eps.length; i += 1) {
      p = progress(eps[i].key);
      if (p && p.at >= bestAt) {
        bestAt = p.at;
        best = i;
      }
    }
    if (best === null) {
      return { episode: eps[0] || null, resume: 0, started: false };
    }
    p = progress(eps[best].key);
    if (p.done) {
      return { episode: eps[best + 1] || eps[best], resume: 0, started: true, finished: !eps[best + 1] };
    }
    return { episode: eps[best], resume: p.t, started: true };
  }

  function episodeAfter(series, ep) {
    var eps = [];
    var i;
    series.seasons.forEach(function (s) { eps = eps.concat(s.episodes); });
    for (i = 0; i < eps.length; i += 1) {
      if (eps[i].key === ep.key) {
        return eps[i + 1] || null;
      }
    }
    return null;
  }

  function formatDuration(sec) {
    var h;
    var m;
    sec = Math.round(sec || 0);
    if (!sec) {
      return "";
    }
    h = Math.floor(sec / 3600);
    m = Math.round((sec % 3600) / 60);
    if (h) {
      return h + " h " + (m < 10 ? "0" : "") + m + " min";
    }
    return Math.max(1, m) + " min";
  }

  function formatClock(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }

  function formatSize(bytes) {
    if (!bytes) {
      return "";
    }
    if (bytes >= 1073741824) {
      return (bytes / 1073741824).toFixed(1) + " GB";
    }
    return Math.round(bytes / 1048576) + " MB";
  }

  return {
    parseCaption: parseCaption,
    parseSeasonEpisode: parseSeasonEpisode,
    titleFromFile: titleFromFile,
    build: build,
    setAccount: setAccount,
    profiles: profiles,
    saveProfile: saveProfile,
    deleteProfile: deleteProfile,
    setProfile: setProfile,
    currentProfile: currentProfile,
    COLORS: COLORS,
    DEFAULT_AVATARS: DEFAULT_AVATARS,
    MAX_PROFILES: MAX_PROFILES,
    tags: tags,
    setTag: setTag,
    composeCaption: composeCaption,
    filterKids: filterKids,
    enabledSources: enabledSources,
    setEnabledSources: setEnabledSources,
    cachedItems: cachedItems,
    setCachedItems: setCachedItems,
    progress: progress,
    setProgress: setProgress,
    allProgress: allProgress,
    myList: myList,
    inMyList: inMyList,
    toggleMyList: toggleMyList,
    nextEpisode: nextEpisode,
    episodeAfter: episodeAfter,
    formatDuration: formatDuration,
    formatClock: formatClock,
    formatSize: formatSize
  };
})();

if (typeof module !== "undefined") {
  module.exports = HFLibrary;
}
