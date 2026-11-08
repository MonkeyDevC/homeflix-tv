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
  /* «ciencia_ficción» → «Ciencia ficción»; «MARVEL» se respeta tal cual */
  function categoryName(word) {
    var w = String(word).replace(/[_-]+/g, " ").trim();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  /* Junta categorías sin repetir (sin importar mayúsculas ni tildes) */
  function mergeCategories(into, more) {
    (more || []).forEach(function (c) {
      if (!into.some(function (x) { return norm(x) === norm(c); })) {
        into.push(c);
      }
    });
    return into;
  }

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
    var image = "";
    var categories = [];
    var mark;
    var cat;
    if (!raw) {
      return null;
    }
    /* Marcas al final, en cualquier orden:
     *   "#infantil" (o #kids / #niños): contenido para el perfil Kids.
     *   "#portada" (o #poster) y "#banner" (o #fondo): en una FOTO, es la imagen de la tarjeta o el fondo grande del título.
     *   "#Marvel", "#Terror", "#Ciencia_ficción"…: cualquier otra palabra es una CATEGORÍA y tiene su propia fila
     *   (el guion bajo se muestra como espacio). Las categorías van separadas por un espacio de lo anterior. */
    for (;;) {
      mark = /\s*#\s*(infantil|kids|ni[ñn]os|portada|poster|banner|fondo)\s*$/i.exec(raw);
      if (mark) {
        if (/^(portada|poster)$/i.test(mark[1])) {
          image = image || "portada";
        } else if (/^(banner|fondo)$/i.test(mark[1])) {
          image = image || "banner";
        } else {
          kids = true;
        }
        raw = raw.slice(0, mark.index).replace(/\s+$/, "");
        continue;
      }
      mark = /\s+#([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ_\-]{0,30})\s*$/.exec(raw);
      /* solo si antes queda el formato completo (tipo#nombre…): «pelicula #Marvel» no es una categoría */
      if (!mark || raw.slice(0, mark.index).indexOf("#") < 0) {
        break;
      }
      cat = categoryName(mark[1]);
      if (!categories.some(function (c) { return norm(c) === norm(cat); })) {
        categories.unshift(cat);
      }
      raw = raw.slice(0, mark.index).replace(/\s+$/, "");
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
    /* Falta el # después del año («pelicula#Nombre (2026) De qué trata…»): lo que sigue al año es la descripción. */
    if (!named.year && MOVIE_WORDS.test(word)) {
      mark = /^(.+?)\s*[\(\[](\d{4})[\)\]]\s+(\S[\s\S]*)$/.exec(fields[0]);
      if (mark) {
        named = { name: mark[1], year: Number(mark[2]) };
        fields = [fields[0], mark[3] + (fields.length > 1 ? "#" + fields.slice(1).join("#") : "")];
      }
    }
    out = {
      type: MOVIE_WORDS.test(word) ? "movie" : "series",
      name: named.name,
      year: named.year,
      season: 0,
      episode: 0,
      episodeTitle: "",
      description: "",
      kids: kids,
      image: image,
      categories: categories
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

  /* Líneas «de la calidad»: una película ancha de 1920×804 es 1080p (cabe en 1920×1080).
   * Un MKV enviado como archivo no trae medidas: se toman de «[1080p]» o «4K» en el nombre (así nombra tools/preparar-video.mjs). */
  function rungOf(v) {
    var h = Math.max(v.height || 0, Math.round((v.width || 0) * 9 / 16));
    var m;
    if (!h) {
      m = /\b(2160|1440|1080|720|576|480|360|240)p\b|\b(4k|uhd)\b/i.exec(v.fileName || "");
      h = m ? (m[1] ? Number(m[1]) : 2160) : 0;
    }
    return h;
  }

  function quality(v) {
    var h = rungOf(v);
    if (h >= 2000) { return "4K"; }
    if (h >= 1000) { return "1080p"; }
    if (h >= 700) { return "720p"; }
    if (h > 0) { return h + "p"; }
    return "";
  }

  /* «… [2160p] parte 2 de 7.mp4» (así nombra las partes tools/preparador) → {i: 2, n: 7} */
  function partOf(v) {
    var m = /\b(?:parte|part|pt)\s*(\d+)\s*(?:de|of|\/)\s*(\d+)\b/i.exec(v.fileName || "");
    return m && Number(m[2]) > 1 && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2]) ? { i: Number(m[1]), n: Number(m[2]) } : null;
  }

  /* Varias versiones del mismo video (mismo comentario, distinta calidad); una calidad puede venir en partes.
   * Se juntan por calidad (y número de partes); si una pieza se repite, gana la más nueva. */
  function addVersion(t, it) {
    var q = quality(it);
    var part = partOf(it);
    var slot = q + (part ? "/" + part.n : "");
    var v = null;
    var i;
    t.versions = t.versions || [];
    for (i = 0; i < t.versions.length; i += 1) {
      if (t.versions[i].slot === slot) {
        v = t.versions[i];
      }
    }
    if (!v) {
      v = { slot: slot, q: q, h: rungOf(it), n: part ? part.n : 1, pieces: {}, date: 0 };
      t.versions.push(v);
    }
    i = part ? part.i : 1;
    if (!v.pieces[i] || it.date >= v.pieces[i].date) {
      v.pieces[i] = it;
    }
    v.date = Math.max(v.date, it.date);
  }

  /* Cierra las versiones: parts = [{key, dur, size}] en orden; una versión en partes a la que le falta alguna no se usa
   * (todavía se están subiendo). La mejor primero; de cada calidad, la más nueva.
   * El video «de identidad» (progreso, Mi lista, etiquetas) es el de la versión más antigua, preferentemente de un solo
   * archivo: así subir después otra calidad no cambia la clave. Su duración y tamaño son los del título completo. */
  function finishVersions(t) {
    var id = null;
    var seen = {};
    var list = [];
    t.versions.forEach(function (v) {
      var parts = [];
      var k;
      for (k = 1; k <= v.n; k += 1) {
        if (!v.pieces[k]) {
          return;
        }
        parts.push({ key: v.pieces[k].key, dur: v.pieces[k].duration || 0, size: v.pieces[k].size || 0 });
      }
      v.parts = parts;
      v.key = parts[0].key;
      v.video = v.pieces[1];
      v.dur = parts.reduce(function (n, x) { return n + x.dur; }, 0);
      v.size = parts.reduce(function (n, x) { return n + x.size; }, 0);
      v.bps = v.dur ? Math.round(v.size * 8 / v.dur) : 0;
      list.push(v);
    });
    if (!list.length) {
      /* solo hay partes sueltas: se muestra igual con la primera que haya (no se podrá ver entera hasta que lleguen todas) */
      list = t.versions.map(function (v) {
        var first = v.pieces[Object.keys(v.pieces).sort(function (a, b) { return a - b; })[0]];
        return { slot: v.slot, q: v.q, h: v.h, n: 1, key: first.key, video: first, parts: [{ key: first.key, dur: first.duration || 0, size: first.size || 0 }],
          dur: first.duration || 0, size: first.size || 0, bps: 0, date: v.date, incomplete: true };
      }).slice(0, 1);
    }
    list.sort(function (a, b) { return b.h - a.h || b.date - a.date; });
    t.versions = list.filter(function (v) {
      if (seen[v.q]) {
        return false;
      }
      seen[v.q] = true;
      return true;
    });
    t.versions.forEach(function (v) {
      if (!id || (v.n === 1 && id.n > 1) || (v.n === id.n && v.date < id.date) || (v.n > 1 && id.n > 1 && v.date < id.date)) {
        id = v;
      }
    });
    t.video = Object.assign({}, id.video, { duration: id.dur || id.video.duration, size: id.size || id.video.size });
    t.quality = t.versions[0].q;
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
          /* una película sin año en la foto también vale para la película con año (se resuelve en applyInfo) */
          key = (p.type === "movie" ? "m:" + norm(p.name) + (p.year ? ":" + p.year : "") : "s:" + norm(p.name));
          addInfo(key, p, it);
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
        if (!movies[key] || it.date >= movies[key].date) {
          movies[key] = {
            type: "movie", titleKey: key, name: p.name, year: p.year, description: p.description, kids: p.kids, tagged: tagged,
            video: it, quality: quality(it), date: it.date, imageKey: it.key, versions: movies[key] ? movies[key].versions : [],
            categories: movies[key] ? movies[key].categories : []
          };
        }
        /* las categorías de todas las versiones se suman */
        mergeCategories(movies[key].categories, p.categories);
        addVersion(movies[key], it);
        return;
      }
      key = "s:" + norm(p.name);
      s = series[key];
      if (!s) {
        s = series[key] = { type: "series", titleKey: key, name: p.name, year: p.year, description: "", seasons: {}, loose: [], date: 0, imageKey: "", kids: false, categories: [] };
      }
      mergeCategories(s.categories, p.categories);
      if (p.kids) {
        s.kids = true;
      }
      ep = {
        type: "episode", key: it.key, seriesKey: key, seriesName: p.name, season: p.season, episode: p.episode,
        title: p.episodeTitle, description: p.description, video: it, quality: quality(it), date: it.date, tagged: tagged, kids: p.kids, versions: []
      };
      if (!p.season || !p.episode) {
        addVersion(ep, it);
        s.loose.push(ep);
      } else {
        seasonKey = String(p.season);
        s.seasons[seasonKey] = s.seasons[seasonKey] || {};
        if (s.seasons[seasonKey][p.episode]) {
          /* otra calidad (u otra subida) del mismo capítulo */
          if (it.date >= s.seasons[seasonKey][p.episode].date) {
            ep.versions = s.seasons[seasonKey][p.episode].versions;
            s.seasons[seasonKey][p.episode] = ep;
          }
          addVersion(s.seasons[seasonKey][p.episode], it);
        } else {
          addVersion(ep, it);
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
          finishVersions(ep);
          ep.key = ep.video.key;
          ep.versions.forEach(function (v) { v.parts.forEach(function (x) { byKey[x.key] = ep; }); });
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

    /* Fotos del título. Cada foto es:
     *   portada (#portada): imagen de la tarjeta;  banner (#banner): fondo grande del destacado, la ficha y el reproductor;
     *   ficha (sin marca, como antes): sirve de portada y de banner si faltan, y su texto es la descripción.
     * Si hay varias del mismo tipo, gana la más nueva. */
    function addInfo(key, p, it) {
      var info = infos[key] || (infos[key] = {});
      var slotName = p.image === "portada" ? "poster" : p.image === "banner" ? "banner" : "photo";
      if (!info[slotName] || it.date >= info[slotName].date) {
        info[slotName] = { key: it.key, date: it.date };
      }
      if (p.kids) {
        info.kids = true;
      }
      info.categories = mergeCategories(info.categories || [], p.categories);
      if (p.description && (!info.descDate || it.date >= info.descDate)) {
        info.description = p.description;
        info.descDate = it.date;
      }
    }

    function applyInfo(t) {
      var info = infos[t.titleKey] || (t.type === "movie" && t.year ? infos["m:" + norm(t.name)] : null);
      var poster;
      var banner;
      if (info) {
        poster = info.poster || info.photo || null;
        banner = info.banner || info.photo || info.poster || null;
        if (poster) {
          t.imageKey = poster.key;
          t.posterIsPhoto = true;
        }
        if (banner) {
          t.bannerKey = banner.key;
        }
        if (info.kids) {
          t.kids = true;
        }
        mergeCategories(t.categories, info.categories);
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
      finishVersions(m);
      m.imageKey = m.video.key;
      applyInfo(m);
      m.versions.forEach(function (v) { v.parts.forEach(function (x) { byKey[x.key] = m; }); });
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

  /* ----- Avisos de cambio (para sincronizar entre dispositivos: js/sync.js) -----
   * kind: "profiles" | "sources" | "tags" | "progress" | "mylist". Mientras se combina lo que llegó de otro
   * dispositivo (mergeSync) no se avisa, para no devolverlo de inmediato. */
  var changeListeners = [];
  var muted = false;
  function onChange(fn) { changeListeners.push(fn); }
  function changed(kind) {
    if (muted) {
      return;
    }
    changeListeners.forEach(function (fn) {
      try { fn(kind); } catch (e) { /* un oyente roto no frena a los demás */ }
    });
  }

  /* ----- Perfiles ----- */
  var COLORS = ["amarillo", "azul", "verde", "cafe", "rojo", "morado"];
  var DEFAULT_AVATARS = ["panda", "zorro", "dino", "buho", "robot", "gato"];
  var MAX_PROFILES = 5;

  /* ----- Cuentas de Telegram conectadas en esta TV -----
   * [{slot, id, name, username}], la principal primero. Cada cuenta tiene sus propios perfiles, chats, caché y etiquetas
   * (todo se guarda con el id de la cuenta). slot = dónde guarda Telegram la sesión de esa cuenta. */
  var MAX_TOTAL_PROFILES = 6;

  function accounts() {
    var list = readJson("hf.accounts");
    return list && list.length ? list : [];
  }

  function saveAccounts(list) {
    try {
      window.localStorage.setItem("hf.accounts", JSON.stringify(list));
    } catch (e) {
      /* nada */
    }
  }

  /* Agrega o actualiza una cuenta (por su slot). La del slot principal siempre va primero. */
  function rememberAccount(acc, mainSlot) {
    var list = accounts();
    var entry = { slot: acc.slot, id: String(acc.id), name: acc.name || "", username: acc.username || "" };
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].slot === acc.slot) {
        list[i] = entry;
        saveAccounts(list);
        return;
      }
    }
    list = list.filter(function (a) { return String(a.id) !== entry.id; });
    if (acc.slot === mainSlot) {
      list.unshift(entry);
    } else {
      list.push(entry);
    }
    saveAccounts(list);
  }

  function forgetAccount(slotName) {
    saveAccounts(accounts().filter(function (a) { return a.slot !== slotName; }));
  }

  function forgetAllAccounts() {
    saveAccounts([]);
  }

  function isMainAccount() {
    var list = accounts();
    return !list.length || String(list[0].id) === accountId;
  }

  /* Perfiles de otra cuenta sin cambiar la cuenta activa. */
  function profilesOf(accId) {
    var a = accountId;
    var pid = profileId;
    var list;
    accountId = String(accId);
    list = profiles();
    accountId = a;
    profileId = pid;
    return list;
  }

  function totalProfiles() {
    var list = accounts();
    if (!list.length) {
      return profiles().length;
    }
    return list.reduce(function (n, acc) { return n + profilesOf(acc.id).length; }, 0);
  }

  function profiles() {
    var list = load("profiles", null);
    if ((!list || !list.length) && !isMainAccount()) {
      /* una cuenta agregada empieza sin perfiles: el primero es el que se crea al conectarla */
      return [];
    }
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
      if (totalProfiles() >= MAX_TOTAL_PROFILES) {
        return { error: "En esta TV caben hasta " + MAX_TOTAL_PROFILES + " perfiles entre todas las cuentas." };
      }
      p.id = "p" + Date.now().toString(36);
      setEnabledSources({}, p.id);
      list.push(withPin({ id: p.id, name: name, color: p.color || COLORS[0], avatar: p.avatar || DEFAULT_AVATARS[list.length % DEFAULT_AVATARS.length], kids: !!p.kids, at: Date.now() }, p.pin));
    } else {
      for (i = 0; i < list.length; i += 1) {
        if (list[i].id === p.id) {
          list[i] = withPin({ id: p.id, name: name, color: p.color || list[i].color, avatar: p.avatar || list[i].avatar, kids: !!p.kids, at: Date.now() }, p.pin === undefined ? list[i].pin : p.pin);
        }
      }
    }
    save("profiles", list);
    save("profilesAt", Date.now());
    changed("profiles");
    return { profile: p };
  }

  /* PIN de acceso del perfil: 4 dígitos, o sin PIN ("" / null). */
  function withPin(obj, pin) {
    if (pin && /^[0-9]{4}$/.test(String(pin))) {
      obj.pin = String(pin);
    }
    return obj;
  }

  function checkPin(id, pin) {
    var p = profiles().filter(function (x) { return x.id === id; })[0];
    return !!p && (!p.pin || p.pin === String(pin));
  }

  /* Borra el perfil y su progreso y Mi lista. Siempre queda al menos uno. */
  function deleteProfile(id) {
    var list = profiles();
    var keep = list.filter(function (p) { return p.id !== id; });
    var old = profileId;
    /* la cuenta principal siempre conserva al menos un perfil; una cuenta agregada puede quedarse sin ninguno */
    if (keep.length === list.length || (!keep.length && isMainAccount())) {
      return false;
    }
    profileId = id === list[0].id ? "" : id;
    try {
      window.localStorage.removeItem(storageKey("progress", true));
      window.localStorage.removeItem(storageKey("mylist", true));
      if (profileId) {
        window.localStorage.removeItem(sourcesKey(id));
      }
    } catch (e) {
      /* nada */
    }
    profileId = old;
    save("profiles", keep);
    save("profilesAt", Date.now());
    var del = load("profilesDel", {});
    del[id] = Date.now();
    save("profilesDel", del);
    changed("profiles");
    return true;
  }

  /* El primer perfil de la lista guarda en las claves sin sufijo (así no se pierde el progreso que ya existía). */
  function setProfile(id) {
    var list = profiles();
    profileId = !id || !list[0] || id === list[0].id ? "" : String(id);
  }

  function currentProfile() {
    var list = profiles();
    var id = profileId || (list[0] && list[0].id);
    var i;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        return list[i];
      }
    }
    return list[0] || null;
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
    var at = load("tagsAt", {});
    at[videoKey] = Date.now();
    save("tagsAt", at);
    changed("tags");
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
    return out + (f.categories || []).map(function (c) { return " #" + String(c).replace(/\s+/g, "_"); }).join("") + (f.kids ? " #infantil" : "");
  }

  /* Lo que ve el perfil Kids: solo películas y series marcadas #infantil; nada sin clasificar. */
  function filterKids(lib) {
    var movies = lib.movies.filter(function (m) { return m.kids; });
    var series = lib.series.filter(function (s) { return s.kids; });
    var titles = {};
    var byKey = {};
    movies.forEach(function (m) {
      titles[m.titleKey] = m;
      (m.versions || []).forEach(function (v) { (v.parts || [v]).forEach(function (x) { byKey[x.key] = m; }); });
      byKey[m.video.key] = m;
    });
    series.forEach(function (s) {
      titles[s.titleKey] = s;
      s.seasons.forEach(function (season) {
        season.episodes.forEach(function (ep) {
          (ep.versions || []).forEach(function (v) { (v.parts || [v]).forEach(function (x) { byKey[x.key] = ep; }); });
          byKey[ep.key] = ep;
        });
      });
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

  /* Chats activos de cada perfil: {id: título}. Cada perfil ve los videos de sus propios chats.
   * El primer perfil usa la clave de antes (sin sufijo); un perfil que nunca eligió chats usa los del primero. */
  function sourcesKey(pid) {
    var list = profiles();
    return "hf.sources." + accountId + (pid && list[0] && pid !== list[0].id ? "." + pid : "");
  }
  function readJson(key) {
    try {
      var v = window.localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }
  function enabledSources(pid) {
    var first = profiles()[0];
    var id = pid === undefined ? (profileId || (first && first.id)) : pid;
    var own = readJson(sourcesKey(id));
    return own || readJson(sourcesKey(""));
  }
  function setEnabledSources(map, pid) {
    var first = profiles()[0];
    var id = pid === undefined ? (profileId || (first && first.id)) : pid;
    var at = load("sourcesAt", {});
    try {
      window.localStorage.setItem(sourcesKey(id), JSON.stringify(map || {}));
    } catch (e) {
      /* nada */
    }
    at[id] = Date.now();
    save("sourcesAt", at);
    changed("sources");
  }
  /* Todos los chats que usa algún perfil (para no guardar en caché videos de chats que nadie ve). */
  function allEnabledSources() {
    var all = {};
    profiles().forEach(function (p) {
      var m = enabledSources(p.id) || {};
      Object.keys(m).forEach(function (k) { all[k] = m[k]; });
    });
    return all;
  }

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
    changed("progress");
  }
  function allProgress() { return load("progress", {}, true); }

  /* Mi lista: [titleKey] */
  function myList() { return load("mylist", [], true); }
  function inMyList(titleKey) { return myList().indexOf(titleKey) >= 0; }
  function toggleMyList(titleKey) {
    var l = myList();
    var i = l.indexOf(titleKey);
    var log = mylistLog();
    if (i >= 0) {
      l.splice(i, 1);
    } else {
      l.unshift(titleKey);
    }
    log[titleKey] = { on: i < 0, at: Date.now() };
    save("mylist", l, true);
    save("mylistlog", log, true);
    changed("mylist");
    return i < 0;
  }

  /* Registro de Mi lista: {titleKey: {on, at}}. Recuerda también lo quitado, para que al combinar con otro
   * dispositivo no vuelva a aparecer. Si todavía no existe, se arma con la lista de antes (fechas antiguas). */
  function mylistLog() {
    var log = load("mylistlog", null, true);
    var l;
    if (log) {
      return log;
    }
    log = {};
    l = myList();
    l.forEach(function (k, i) { log[k] = { on: true, at: 1000 + l.length - i }; });
    return log;
  }
  function listFromLog(log) {
    return Object.keys(log).filter(function (k) { return log[k] && log[k].on; })
      .sort(function (a, b) { return (log[b].at || 0) - (log[a].at || 0); });
  }

  /* ===== Sincronizar entre dispositivos (TV, celular, web) =====
   * exportSync() arma un documento con todo lo de la cuenta activa; mergeSync(doc) combina uno recibido
   * quedándose con lo más reciente de cada cosa (perfiles: la lista entera; chats: por perfil; etiquetas,
   * progreso y Mi lista: por video o título). Devuelve true si cambió algo aquí. */
  function withProfile(pid, fn) {
    var old = profileId;
    var list = profiles();
    profileId = list[0] && pid === list[0].id ? "" : String(pid);
    try {
      return fn();
    } finally {
      profileId = old;
    }
  }

  function exportSync() {
    var list = profiles();
    var sAt = load("sourcesAt", {});
    var t = tags();
    var tAt = load("tagsAt", {});
    var doc = { app: "homeflix", v: 2, at: Date.now(), profiles: { at: load("profilesAt", 0), list: list.map(function (p) { return Object.assign({}, p, { at: profileAt(p) }); }), deleted: load("profilesDel", {}) }, sources: {}, tags: {}, p: {} };
    list.forEach(function (p) {
      var map = readJson(sourcesKey(p.id));
      doc.sources[p.id] = { at: sAt[p.id] || (map && Object.keys(map).length ? 1 : 0), map: map };
      withProfile(p.id, function () {
        doc.p[p.id] = { progress: load("progress", {}, true), mylist: mylistLog() };
      });
    });
    Object.keys(t).forEach(function (k) { doc.tags[k] = { at: tAt[k] || 0, c: t[k] }; });
    Object.keys(tAt).forEach(function (k) { if (!doc.tags[k]) { doc.tags[k] = { at: tAt[k], c: null }; } });
    return doc;
  }

  function isNewer(a, b) { return !!a && (!b || (a.at || 0) > (b.at || 0)); }

  /* Fecha de un perfil para combinar. Los que se crearon o editaron antes de sincronizar no tienen fecha:
   * uno personalizado (otro nombre, avatar propio, PIN, infantil cambiado) vale 1 y le gana al de fábrica (0). */
  var FACTORY = { p1: ["Familia", "panda", false], p2: ["Santiago", "zorro", false], p3: ["Kids", "dino", true], p4: ["Invitado", "buho", false] };
  function profileAt(p) {
    var f = FACTORY[p.id];
    if (p.at) {
      return p.at;
    }
    return f && f[0] === p.name && f[1] === p.avatar && f[2] === !!p.kids && !p.pin ? 0 : 1;
  }

  /* Mueve los datos de un perfil (progreso, Mi lista, chats) a otro id: cuando un perfil de fábrica de este
   * dispositivo resulta ser el mismo que uno de otro dispositivo (mismo nombre, otro id). El primer perfil de la
   * lista guarda sin sufijo, así que si ocupa ese lugar no hay nada que mover. */
  function moveProfileData(fromId, toId, first) {
    if (fromId === first) {
      return;
    }
    ["progress", "mylist", "mylistlog"].forEach(function (name) {
      var from = "hf." + name + "." + accountId + "." + fromId;
      var to = "hf." + name + "." + accountId + "." + toId;
      try {
        var v = window.localStorage.getItem(from);
        if (v !== null && window.localStorage.getItem(to) === null) {
          window.localStorage.setItem(to, v);
        }
        window.localStorage.removeItem(from);
      } catch (e) { /* nada */ }
    });
    try {
      var src = window.localStorage.getItem("hf.sources." + accountId + "." + fromId);
      if (src !== null) {
        window.localStorage.setItem("hf.sources." + accountId + "." + toId, src);
        window.localStorage.removeItem("hf.sources." + accountId + "." + fromId);
      }
    } catch (e) { /* nada */ }
  }

  /* Junta los perfiles de otro dispositivo con los de aquí, perfil por perfil (gana la versión más reciente de
   * cada uno). Un perfil que llega con otro id pero con el mismo nombre que uno de fábrica de aquí es el mismo:
   * toma su lugar (y sus datos). El orden de aquí se conserva. Devuelve true si cambió algo. */
  function mergeProfiles(remote, deleted) {
    var local = profiles();
    var first = local[0] && local[0].id;
    var byId = {};
    var order = [];
    var del = load("profilesDel", {});
    var remoteIds = {};
    var dirty = false;
    local.forEach(function (p) { byId[p.id] = p; order.push(p.id); });
    remote.forEach(function (p) { if (p && p.id) { remoteIds[p.id] = true; } });
    remote.forEach(function (p) {
      var mine;
      var twin;
      if (!p || !p.id) {
        return;
      }
      mine = byId[p.id];
      if (!mine) {
        if ((del[p.id] || 0) >= profileAt(p)) {
          return; // se borró aquí después de su último cambio
        }
        twin = order.filter(function (id) {
          var q = byId[id];
          return q && !remoteIds[id] && norm(q.name) === norm(p.name) && profileAt(q) === 0;
        })[0];
        if (twin) {
          moveProfileData(twin, p.id, first);
          order[order.indexOf(twin)] = p.id;
          delete byId[twin];
        } else {
          order.push(p.id);
        }
        byId[p.id] = p;
        dirty = true;
      } else if (profileAt(p) > profileAt(mine)) {
        byId[p.id] = p;
        dirty = true;
      }
    });
    Object.keys(deleted || {}).forEach(function (id) {
      if (deleted[id] > (del[id] || 0)) {
        del[id] = deleted[id];
      }
      if (byId[id] && deleted[id] >= profileAt(byId[id])) {
        delete byId[id];
        dirty = true;
      }
    });
    order = order.filter(function (id) { return !!byId[id]; });
    if (!dirty || !order.length) {
      return false; // nunca quedarse sin perfiles
    }
    /* perfiles de fábrica que sobran (el otro dispositivo ya tiene los suyos con esos nombres) se quitan */
    save("profiles", order.map(function (id) { return byId[id]; }));
    save("profilesDel", del);
    return true;
  }

  function mergeSync(doc) {
    var any = false;
    var list;
    var has;
    var sAt;
    var sc = false;
    var t;
    var tAt;
    var tc = false;
    if (!doc || doc.app !== "homeflix") {
      return false;
    }
    muted = true;
    try {
      /* perfiles: uno por uno, gana la versión más reciente de cada uno; los borrados no reaparecen */
      if (doc.profiles && doc.profiles.list && mergeProfiles(doc.profiles.list, doc.profiles.deleted || {})) {
        any = true;
      }
      list = profiles();
      has = function (pid) { return list.some(function (p) { return p.id === pid; }); };
      /* chats de cada perfil */
      sAt = load("sourcesAt", {});
      Object.keys(doc.sources || {}).forEach(function (pid) {
        var r = doc.sources[pid];
        var mine = readJson(sourcesKey(pid));
        var myAt = sAt[pid] || (mine && Object.keys(mine).length ? 1 : 0);
        if (has(pid) && r && (r.at || 0) > myAt) {
          try {
            if (r.map) {
              window.localStorage.setItem(sourcesKey(pid), JSON.stringify(r.map));
            } else {
              window.localStorage.removeItem(sourcesKey(pid));
            }
          } catch (e) { /* nada */ }
          sAt[pid] = r.at;
          sc = true;
        }
      });
      if (sc) {
        save("sourcesAt", sAt);
        any = true;
      }
      /* etiquetas puestas desde la TV */
      t = tags();
      tAt = load("tagsAt", {});
      Object.keys(doc.tags || {}).forEach(function (k) {
        var r = doc.tags[k];
        if (r && (r.at || 0) > (tAt[k] || 0)) {
          if (r.c === null || r.c === undefined) {
            delete t[k];
          } else {
            t[k] = r.c;
          }
          tAt[k] = r.at;
          tc = true;
        }
      });
      if (tc) {
        save("tags", t);
        save("tagsAt", tAt);
        any = true;
      }
      /* progreso y Mi lista de cada perfil */
      Object.keys(doc.p || {}).forEach(function (pid) {
        var r = doc.p[pid] || {};
        if (!has(pid)) {
          return;
        }
        withProfile(pid, function () {
          var pr = load("progress", {}, true);
          var log = mylistLog();
          var pc = false;
          var lc = false;
          Object.keys(r.progress || {}).forEach(function (k) {
            if (isNewer(r.progress[k], pr[k])) {
              pr[k] = r.progress[k];
              pc = true;
            }
          });
          Object.keys(r.mylist || {}).forEach(function (k) {
            if (isNewer(r.mylist[k], log[k])) {
              log[k] = r.mylist[k];
              lc = true;
            }
          });
          if (pc) {
            save("progress", pr, true);
            any = true;
          }
          if (lc) {
            save("mylistlog", log, true);
            save("mylist", listFromLog(log), true);
            any = true;
          }
        });
      });
    } finally {
      muted = false;
    }
    return any;
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
    accountId: function () { return accountId; },
    accounts: accounts,
    rememberAccount: rememberAccount,
    forgetAccount: forgetAccount,
    forgetAllAccounts: forgetAllAccounts,
    isMainAccount: isMainAccount,
    profilesOf: profilesOf,
    totalProfiles: totalProfiles,
    MAX_TOTAL_PROFILES: MAX_TOTAL_PROFILES,
    profiles: profiles,
    saveProfile: saveProfile,
    deleteProfile: deleteProfile,
    setProfile: setProfile,
    checkPin: checkPin,
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
    allEnabledSources: allEnabledSources,
    cachedItems: cachedItems,
    setCachedItems: setCachedItems,
    progress: progress,
    setProgress: setProgress,
    allProgress: allProgress,
    myList: myList,
    inMyList: inMyList,
    toggleMyList: toggleMyList,
    onChange: onChange,
    exportSync: exportSync,
    mergeSync: mergeSync,
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
