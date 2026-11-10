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
    return canonicalCategory(w.charAt(0).toUpperCase() + w.slice(1));
  }

  /* ===== Catálogo de categorías =====
   * Cada título sale en UNA sola fila de categoría (no repartido en tres). Las capas, como en las plataformas grandes:
   * franquicia (Marvel) > público (Infantil, la marca #infantil) > un género principal. El orden de la lista es la
   * prioridad: si un comentario trae varias, gana la que está más arriba. Los géneros salen de la lista oficial de TMDB,
   * agrupados para que ninguna fila quede de un solo título. Los alias leen lo que ya está publicado («Accion»,
   * «CienciaFiccion», «Animadas», «MCU»…) como la categoría correcta. Lo que no está aquí se respeta, al final. */
  var CATEGORY_CATALOG = [
    ["Marvel", "mcu|universo marvel|marvel studios|universo cinematografico de marvel"],
    ["Anime", "anime"],
    ["Terror", "horror|miedo"],
    ["Ciencia ficción y fantasía", "ciencia ficcion|cienciaficcion|ciencia ficcion y fantasia|sci fi|scifi|fantasia|fantasy|fantastica"],
    ["Acción y aventura", "accion|action|aventura|aventuras|accion y aventura|deporte|deportes|artes marciales|belica|guerra|western"],
    ["Suspenso", "suspense|thriller|misterio|crimen|policial|policiaca|policiaco"],
    ["Comedia", "comedias|romance|romantica|romanticas|comedia romantica|humor"],
    ["Drama", "historia|biografia|biografica|musical|musica"],
    ["Documental", "documentales"],
    ["Animadas", "animacion|animado|animados|animada|peliculas animadas|dibujos|dibujos animados|familia|familiar"]
  ];
  var CATEGORY_NAMES = CATEGORY_CATALOG.map(function (c) { return c[0]; });
  var categoryAlias = null;
  function catKey(s) { return norm(s).replace(/ /g, ""); }
  /* «Accion» → «Acción y aventura»; algo fuera del catálogo queda como vino */
  function canonicalCategory(name) {
    var k = catKey(name);
    if (!categoryAlias) {
      categoryAlias = {};
      CATEGORY_CATALOG.forEach(function (c) {
        [c[0]].concat(c[1].split("|")).forEach(function (a) { categoryAlias[catKey(a)] = c[0]; });
      });
    }
    return categoryAlias[k] || String(name || "");
  }
  /* ===== Desde TMDB (preparador) =====
   * La categoría que le toca a una película según su ficha, con la misma prioridad del catálogo:
   * Marvel (Marvel Studios, la palabra clave «marvel cinematic universe» o la cronología) > Anime (animación japonesa) >
   * el PRIMER género de TMDB que tenga fila. Animación y Familia solo cuentan si no hay otro (lo infantil va además a
   * «Infantil» por la marca). info: {name, year, genres: [nombres en español], lang, companies: [], keywords: []} */
  var TMDB_GENRE = {
    "terror": "Terror", "horror": "Terror",
    "ciencia ficcion": "Ciencia ficción y fantasía", "fantasia": "Ciencia ficción y fantasía", "sci fi fantasy": "Ciencia ficción y fantasía",
    "accion": "Acción y aventura", "aventura": "Acción y aventura", "belica": "Acción y aventura", "western": "Acción y aventura",
    "action adventure": "Acción y aventura", "war politics": "Acción y aventura",
    "suspense": "Suspenso", "misterio": "Suspenso", "crimen": "Suspenso",
    "comedia": "Comedia", "romance": "Comedia",
    "drama": "Drama", "historia": "Drama", "musica": "Drama",
    "documental": "Documental",
    "animacion": "Animadas", "familia": "Animadas", "kids": "Animadas"
  };
  function categoryFromTmdb(info) {
    var genres = (info && info.genres) || [];
    var marvel = ((info && info.companies) || []).some(function (c) { return /^marvel studios$/i.test(c); }) ||
      ((info && info.keywords) || []).some(function (k) { return /marvel cinematic universe|\bmcu\b/i.test(k); }) ||
      (info && info.name && chronoIndex(info) >= 0);
    var anim = genres.some(function (g) { return norm(g) === "animacion"; });
    var main = "";
    if (marvel) { return "Marvel"; }
    if (anim && info.lang === "ja") { return "Anime"; }
    /* animada y familiar (o marcada infantil): «Animadas», como las demás películas animadas para niños */
    if (anim && (info.kids || genres.some(function (g) { return /familia|kids/.test(norm(g)); }))) { return "Animadas"; }
    genres.some(function (g) {
      var c = TMDB_GENRE[norm(g).replace(/ y | & /g, " ")] || TMDB_GENRE[norm(g)];
      if (c && c !== "Animadas") { main = c; return true; }
      return false;
    });
    return main || (anim || genres.some(function (g) { return /familia|kids/i.test(norm(g)); }) ? "Animadas" : "");
  }
  /* ¿Es para el perfil infantil? Por la clasificación por edad: México AA/A, EE. UU. G (o PG si es animada o familiar). */
  function kidsFromTmdb(info) {
    var mx = String((info && info.cert && info.cert.MX) || "").toUpperCase();
    var us = String((info && info.cert && info.cert.US) || "").toUpperCase();
    var family = ((info && info.genres) || []).some(function (g) { return /animacion|familia|kids/.test(norm(g)); });
    if (mx === "AA" || us === "G" || us === "TV-Y" || us === "TV-G" || us === "TV-Y7") { return true; }
    if (mx === "A" || us === "PG" || us === "TV-PG") { return family; }
    return false;
  }

  /* La única categoría en la que se muestra un título. withKids: los infantiles van a «Infantil» (perfiles de adultos);
   * en el perfil Kids (withKids false) se agrupan por su género. Marvel gana siempre, también si el título está en la
   * historia del Universo Marvel aunque no lo diga el comentario. */
  function primaryCategory(t, withKids) {
    var cats = ((t && t.categories) || []).map(canonicalCategory);
    var best = "";
    var bestRank = Infinity;
    if (cats.indexOf("Marvel") >= 0 || (t && t.name && chronoIndex(t) >= 0)) {
      return "Marvel";
    }
    if (withKids && t && t.kids) {
      return "Infantil";
    }
    cats.forEach(function (c, i) {
      var r = CATEGORY_NAMES.indexOf(c);
      r = r >= 0 ? r : 100 + i; // fuera del catálogo: después de todas, en el orden en que vienen
      if (r < bestRank) { bestRank = r; best = c; }
    });
    return best;
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
    var tmdb = null;
    var langs = null;
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
      /* «#audio-spa-eng» / «#subs-spa»: idioma correcto de cada pista, en orden (x = dejar el suyo); la pone el preparador */
      mark = /\s+#\s*(audio|subs)-((?:[a-z]{1,3}-)*[a-z]{1,3})\s*$/i.exec(raw);
      if (mark && raw.slice(0, mark.index).indexOf("#") >= 0) {
        langs = langs || {};
        langs[mark[1].toLowerCase()] = langs[mark[1].toLowerCase()] || mark[2].toLowerCase().split("-");
        raw = raw.slice(0, mark.index).replace(/\s+$/, "");
        continue;
      }
      /* «#tmdb603» (película) o «#tmdbtv1399» (serie): su ficha en TMDB; la pone el preparador */
      mark = /\s+#\s*tmdb(tv)?[_:-]?(\d{1,9})\s*$/i.exec(raw);
      if (mark && raw.slice(0, mark.index).indexOf("#") >= 0) {
        tmdb = tmdb || { type: mark[1] ? "tv" : "movie", id: Number(mark[2]) };
        raw = raw.slice(0, mark.index).replace(/\s+$/, "");
        continue;
      }
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
      categories: categories,
      tmdb: tmdb,
      langs: langs
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
    if (guessedParts[v.key]) { return guessedParts[v.key]; }
    var m =/\b(?:parte|part|pt)\s*(\d+)\s*(?:de|of|\/)\s*(\d+)\b/i.exec(v.fileName || "");
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
        parts.push({ key: v.pieces[k].key, dur: v.pieces[k].duration || 0, size: v.pieces[k].size || 0, langs: v.pieces[k].langs || null });
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
        return { slot: v.slot, q: v.q, h: v.h, n: 1, key: first.key, video: first, parts: [{ key: first.key, dur: first.duration || 0, size: first.size || 0, langs: first.langs || null }],
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
  var THUMBS_RE = /miniaturas[\s_]+(\d+)s[\s_]+(\d+)x(\d+)[\s_]+(\d+)x(\d+)[\s_]+hoja[\s_]+(\d+)[\s_]+de[\s_]+(\d+)\.jpe?g$/i;
  /* Hojas a las que Telegram les cortó el nombre («Titulo_largo_2025_miniaturas.jpg», antes de que el preparador acortara
   * los nombres): se toman las del último envío (mensajes seguidos, en orden de hoja) con las medidas fijas del
   * preparador (tools/preparador/publish.mjs THUMB). Solo si ese título no tiene hojas con el nombre completo. */
  var THUMBS_CUT = /[\s_]miniaturas\.jpe?g$/i;
  var THUMB_STD = { every: 10, w: 160, h: 90, cols: 10, rows: 10 };
  function cutThumbsOf(list) {
    var desc = list.slice().sort(function (a, b) { return b.msgId - a.msgId; });
    var run = [];
    var i;
    for (i = 0; i < desc.length; i += 1) {
      if (run.length && run[run.length - 1].msgId - desc[i].msgId !== 1) { break; } // hueco: ahí empieza un envío anterior
      run.push(desc[i]);
    }
    run.reverse();
    var th = { every: THUMB_STD.every, w: THUMB_STD.w, h: THUMB_STD.h, cols: THUMB_STD.cols, rows: THUMB_STD.rows, n: run.length, sheets: {}, date: run.length ? run[0].date : 0 };
    run.forEach(function (it, i) { th.sheets[i + 1] = { key: it.key, date: it.date }; });
    return th;
  }

  /* Las hojas de miniaturas de un título, listas para usar: {every, w, h, cols, rows, sheets: [key…]} o null si faltan hojas. */
  function thumbsOf(th) {
    var keys = [];
    var i;
    if (!th) { return null; }
    for (i = 1; i <= th.n; i += 1) {
      if (!th.sheets[i]) { return null; }
      keys.push(th.sheets[i].key);
    }
    return { every: th.every, w: th.w, h: th.h, cols: th.cols, rows: th.rows, sheets: keys };
  }

  /* Partes con el nombre cortado por Telegram: a los nombres largos Telegram los pasa a «palabras_con_guion» y les corta
   * el final, y «… [1080p] parte 1 de 2.mp4» llega como «…_1080p_parte.mp4» en las dos partes (pasó con lo publicado
   * antes de que el preparador acortara los nombres). Si un mismo comentario y calidad tiene varios videos así, con
   * tamaños distintos, son sus partes en el orden en que se publicaron (el preparador las sube en orden). */
  var guessedParts = {};
  var CUT_PART = /[\s_](?:parte?|pt)(?:[\s_]+\d+)?(?:[\s_]+de)?\.[a-z0-9]{2,4}$/i;
  function guessParts(items, tags) {
    var groups = {};
    var out = {};
    (items || []).forEach(function (it) {
      if (it.kind !== "video" || !CUT_PART.test(it.fileName || "") || /(?:parte|part|pt)\s*\d+\s*(?:de|of|\/)\s*\d+/i.test(it.fileName)) { return; }
      var cap = tags && Object.prototype.hasOwnProperty.call(tags, it.key) ? tags[it.key] : it.caption;
      var g = String(it.chatId) + "|" + String(cap || "").trim() + "|" + quality(it) + "|" + it.fileName;
      (groups[g] = groups[g] || []).push(it);
    });
    Object.keys(groups).forEach(function (g) {
      var bySize = {};
      groups[g].forEach(function (it) { if (!bySize[it.size] || it.msgId > bySize[it.size].msgId) { bySize[it.size] = it; } });
      var list = Object.keys(bySize).map(function (k) { return bySize[k]; }).sort(function (a, b) { return a.msgId - b.msgId; });
      if (list.length < 2) { return; }
      list.forEach(function (it, i) { out[it.key] = { i: i + 1, n: list.length }; });
    });
    return out;
  }

  function build(items, tags) {
    guessedParts = guessParts(items, tags);
    var cutThumbs = {};
    var thumbs = {};
    var movies = {};
    var series = {};
    var infos = {};
    var unclassified = [];
    var byKey = {};
    var all = [];
    var list;

    var subFiles = {};
    /* de cada idioma, el más nuevo */
    /* de cada idioma (y forzados, y 2.º del mismo idioma), el más nuevo; español primero */
    function subsFor(k) {
      var by = {};
      (subFiles[k] || []).forEach(function (x) {
        var l = (x.lang || x.key) + (x.forced ? ":f" : "") + (x.n > 1 ? ":" + x.n : "");
        if (!by[l] || x.date >= by[l].date) { by[l] = x; }
      });
      return Object.keys(by).map(function (l) { return by[l]; }).sort(function (a, b) {
        return (a.lang === "spa" ? 0 : 1) - (b.lang === "spa" ? 0 : 1) || (a.forced ? 1 : 0) - (b.forced ? 1 : 0) || (a.n || 1) - (b.n || 1) || a.date - b.date;
      });
    }

    (items || []).forEach(function (it) {
      var tagged = !!(tags && Object.prototype.hasOwnProperty.call(tags, it.key));
      var p = parseCaption(tagged ? tags[it.key] : it.caption);
      var key;
      /* el idioma corregido es de ESTE archivo: cada calidad puede traer otras pistas */
      it.langs = p && p.langs ? p.langs : null;
      var s;
      var ep;
      var seasonKey;
      if (it.kind === "thumbs") {
        /* hojas de miniaturas (tools/preparador): «… miniaturas 10s 160x90 10x10 hoja 2 de 8.jpg» → para «Recortar» */
        var tm = THUMBS_RE.exec(it.fileName || "");
        if (p && !tm && THUMBS_CUT.test(it.fileName || "")) {
          key = p.type === "movie" ? "m:" + norm(p.name) + (p.year ? ":" + p.year : "") : "s:" + norm(p.name) + ":" + (p.season || 0) + ":" + (p.episode || 0);
          (cutThumbs[key] = cutThumbs[key] || []).push(it);
          return;
        }
        if (p && tm) {
          key = p.type === "movie" ? "m:" + norm(p.name) + (p.year ? ":" + p.year : "") : "s:" + norm(p.name) + ":" + (p.season || 0) + ":" + (p.episode || 0);
          var th = thumbs[key];
          if (!th || (th.n !== Number(tm[7]) || th.every !== Number(tm[1])) && it.date > th.date) {
            th = thumbs[key] = { every: Number(tm[1]), w: Number(tm[2]), h: Number(tm[3]), cols: Number(tm[4]), rows: Number(tm[5]), n: Number(tm[7]), sheets: {}, date: it.date };
          }
          if (!th.sheets[tm[6]] || it.date >= th.sheets[tm[6]].date) { th.sheets[tm[6]] = { key: it.key, date: it.date }; }
        }
        return;
      }
      if (it.kind === "sub") {
        /* subtítulos aparte: idioma de la marca (#subs-eng) o del nombre del archivo («Nombre.eng.srt») */
        if (p) {
          key = p.type === "movie" ? "m:" + norm(p.name) + (p.year ? ":" + p.year : "") : "s:" + norm(p.name) + ":" + (p.season || 1) + ":" + (p.episode || 1);
          (subFiles[key] = subFiles[key] || []).push({
            key: it.key, date: it.date, name: it.fileName,
            lang: (p.langs && p.langs.subs && p.langs.subs[0] && p.langs.subs[0] !== "x" ? p.langs.subs[0] : "") || subFileLang(it.fileName),
            forced: /forzad|forced/i.test(it.fileName || "") || !!(p.langs && p.langs.subs && p.langs.subs[1] === "f"),
            n: Number((/\.(\d)\.(srt|vtt|ass|ssa)$/i.exec(it.fileName || "") || [])[1] || 1)
          });
        }
        return;
      }
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
            categories: movies[key] ? movies[key].categories : [],
            tmdb: movies[key] ? movies[key].tmdb : null,
            langs: movies[key] ? movies[key].langs : null
          };
        }
        if (p.tmdb && !movies[key].tmdb) { movies[key].tmdb = p.tmdb; }
        if (p.langs && !movies[key].langs) { movies[key].langs = p.langs; }
        /* las categorías de todas las versiones se suman */
        mergeCategories(movies[key].categories, p.categories);
        addVersion(movies[key], it);
        return;
      }
      key = "s:" + norm(p.name);
      s = series[key];
      if (!s) {
        s = series[key] = { type: "series", titleKey: key, name: p.name, year: p.year, description: "", seasons: {}, loose: [], date: 0, imageKey: "", kids: false, categories: [], tmdb: null };
      }
      mergeCategories(s.categories, p.categories);
      if (p.kids) {
        s.kids = true;
      }
      ep = {
        type: "episode", key: it.key, seriesKey: key, seriesName: p.name, season: p.season, episode: p.episode,
        title: p.episodeTitle, description: p.description, video: it, quality: quality(it), date: it.date, tagged: tagged, kids: p.kids, versions: [], langs: p.langs
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
            ep.langs = ep.langs || s.seasons[seasonKey][p.episode].langs;
            s.seasons[seasonKey][p.episode] = ep;
          } else if (p.langs && !s.seasons[seasonKey][p.episode].langs) {
            s.seasons[seasonKey][p.episode].langs = p.langs;
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

    Object.keys(cutThumbs).forEach(function (k) { if (!thumbs[k]) { thumbs[k] = cutThumbsOf(cutThumbs[k]); } });

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
          ep.thumbs = thumbsOf(thumbs[k + ":" + ep.season + ":" + ep.episode]);
          ep.subFiles = subsFor(k + ":" + ep.season + ":" + ep.episode);
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
      m.thumbs = thumbsOf(thumbs[m.titleKey]);
      m.subFiles = subsFor(m.titleKey).concat(m.year ? subsFor("m:" + norm(m.name)) : []);
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

  /* Perfiles con los que arranca una cuenta que nunca usó HomeFlix: uno con el nombre de esa cuenta de Telegram y
   * «Kids». Antes todas las cuentas arrancaban con los mismos cuatro (Familia, Santiago, Kids, Invitado) y una cuenta
   * nueva parecía tener los perfiles de otra. «factory» = sin tocar: al sincronizar, los perfiles reales de la cuenta
   * (de otro dispositivo) les ganan (profileAt = 0). */
  function starterProfiles() {
    var acc = accounts().filter(function (a) { return String(a.id) === accountId; })[0];
    var first = clean((acc && acc.name) || "").split(" ")[0] || "Principal";
    var own = (typeof HF_AVATARES !== "undefined" && HF_AVATARES && HF_AVATARES.length ? HF_AVATARES : [])
      .map(function (src) { return String(src).replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, ""); });
    var h = 0;
    var i;
    for (i = 0; i < accountId.length; i += 1) { h = (h * 31 + accountId.charCodeAt(i)) | 0; }
    var mine = own.length ? own[Math.abs(h) % own.length] : "zorro";
    var kids = own.filter(function (id) { return /groot/i.test(id); })[0] || (own.length ? own[(Math.abs(h) + 7) % own.length] : "dino");
    return [
      { id: "p1", name: first.slice(0, 20), color: "amarillo", avatar: mine, kids: false, factory: true },
      { id: "p2", name: "Kids", color: "verde", avatar: kids, kids: true, factory: true }
    ];
  }

  function profiles() {
    var list = load("profiles", null);
    if ((!list || !list.length) && !isMainAccount()) {
      /* una cuenta agregada empieza sin perfiles: el primero es el que se crea al conectarla */
      return [];
    }
    /* Cuentas que ya arrancaron con los 4 de fábrica de antes (Familia, Santiago, Kids, Invitado) sin tocar ninguno:
     * pasan a los perfiles iniciales de la cuenta. Si se editó alguno, se dejan como están. */
    if (list && list.length === 4 && list.every(function (p) { return !p.at && !p.factory && FACTORY[p.id] && profileAt(p) === 0; })) {
      list = null;
    }
    if (!list || !list.length) {
      list = starterProfiles();
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
  function tmdbTag(t) {
    return t && t.id ? " #tmdb" + (t.type === "tv" ? "tv" : "") + t.id : "";
  }

  /* ===== Nombre de las pistas de audio y subtítulos (reproductor de la TV y del celular, y el preparador) =====
   * list: [{lang, name, channels, isForced}] → ["Español", "Inglés"…] */
  function langName(code) {
    var c = String(code || "").toLowerCase();
    var map = { spa: "Español", es: "Español", eng: "Inglés", en: "Inglés", por: "Portugués", pt: "Portugués", fre: "Francés", fra: "Francés", fr: "Francés",
      ita: "Italiano", it: "Italiano", ger: "Alemán", deu: "Alemán", de: "Alemán", jpn: "Japonés", ja: "Japonés", kor: "Coreano", ko: "Coreano",
      chi: "Chino", zho: "Chino", zh: "Chino", rus: "Ruso", ru: "Ruso", lat: "Español latino", und: "" };
    return map.hasOwnProperty(c) ? map[c] : (c ? c.toUpperCase() : "");
  }

  /* El título de la pista suele ser el nombre del archivo con que se armó el video («Avengers…_fixed850.aac»):
   * no se muestra. Se muestra el idioma; del título solo se toma si es latino o de España, o el idioma cuando la
   * pista no lo trae. */
  function langFromName(name) {
    /* gana el último que nombra: «…dual-lat…_track2_eng.aac» es la pista en inglés */
    /* «dual-lat» es del archivo entero (audio dual, doblaje latino), no de esta pista */
    var n = String(name || "").toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/dual[\s._-]*(latino|lat|spa|esp|castellano|eng|english)/g, "dual");
    var es = n.search(/(espa[ñn]ol|spanish|latino|castellano|(^|[^a-z])(spa|esp|lat)([^a-z]|$))(?!.*(espa[ñn]ol|spanish|latino|castellano|(^|[^a-z])(spa|esp|lat)([^a-z]|$)))/);
    var en = n.search(/(english|ingl[eé]s|(^|[^a-z])eng([^a-z]|$))(?!.*(english|ingl[eé]s|(^|[^a-z])eng([^a-z]|$)))/);
    return es < 0 && en < 0 ? "" : es > en ? "spa" : "eng";
  }

  function trackLabel(t, i, kind) {
    var lang = t.lang && !/^und$/i.test(t.lang) ? t.lang : langFromName(t.name);
    var label = langName(lang);
    var n = String(t.name || "").toLowerCase();
    if (label === "Español" && /latin|mexic|(^|[^a-z])lat([^a-z]|$)/.test(n)) { label = "Español latino"; }
    else if (label === "Español" && /castellan|espa[ñn]a([^a-z]|$)|(^|[^a-z])cast([^a-z]|$)/.test(n)) { label = "Español de España"; }
    if (!label) { label = (kind === "audio" ? "Audio " : "Subtítulos ") + (i + 1); }
    if (kind === "subs" && t.isForced) { label += " (forzados)"; }
    return label;
  }

  /* Etiquetas de una lista: si dos pistas quedan iguales, se distinguen por canales o por número */
  function trackLabels(list, kind) {
    var labels = list.map(function (t, i) { return trackLabel(t, i, kind); });
    var count = {};
    labels.forEach(function (l) { count[l] = (count[l] || 0) + 1; });
    return labels.map(function (l, i) {
      var t = list[i];
      var ch;
      if (count[l] < 2) { return l; }
      ch = kind === "audio" && t.channels ? (t.channels >= 6 ? "5.1" : t.channels === 2 ? "Estéreo" : t.channels + " canales") : "";
      return l + " · " + (ch || (list.slice(0, i + 1).filter(function (x, j) { return labels[j] === l; }).length));
    });
  }

  /* «Avengers.Age.of.Ultron.eng.srt» → "eng"; «… (Español).srt» → "spa" */
  function subFileLang(name) {
    var n = String(name || "").toLowerCase().replace(/\.(srt|vtt|ass|ssa)$/, "").replace(/\.(forzados|forced|\d)$/, "");
    var m = /[._ -]([a-z]{2,3})$/.exec(n);
    var iso = { es: "spa", esp: "spa", spa: "spa", lat: "spa", en: "eng", eng: "eng", pt: "por", por: "por", fr: "fre", fre: "fre", fra: "fre", it: "ita", ita: "ita", de: "ger", ger: "ger", deu: "ger", ja: "jpn", jpn: "jpn" };
    if (m && iso[m[1]]) { return iso[m[1]]; }
    return langFromName(n);
  }

  /* {audio:["spa","eng"], subs:["spa"]} → " #audio-spa-eng #subs-spa" */
  function langsTag(l) {
    return ["audio", "subs"].map(function (k) {
      return l && l[k] && l[k].length ? " #" + k + "-" + l[k].join("-") : "";
    }).join("");
  }

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
    return out + (f.categories || []).map(function (c) { return " #" + String(c).replace(/\s+/g, "_"); }).join("") + (f.kids ? " #infantil" : "") + tmdbTag(f.tmdb) + langsTag(f.langs);
  }

  /* ===== Fila «Marvel» en orden cronológico =====
   * Las filas de la categoría Marvel (#Marvel o #MCU en el comentario) no van por fecha de publicación sino en el orden
   * de la historia del Universo Cinematográfico de Marvel (el «Orden cronológico» de Disney+). Así, lo que se suba
   * después cae en su lugar: si hoy se sube Iron Man y mañana Capitana Marvel, Capitana Marvel queda antes.
   * Cada título se reconoce por su nombre en español latino, de España o en inglés, y por el año (±1) para no
   * confundir. Lo que no está en la lista (otro universo, algo nuevo) va al final, por año de estreno.
   * Para agregar uno nuevo: ponerlo en su lugar de la historia con [año, nombres…]. */
  var MCU_TIMELINE = [
    [2011, "Capitán América: El primer vengador", "Captain America: The First Avenger"],
    [2019, "Capitana Marvel", "Captain Marvel"],
    [2008, "Iron Man", "Iron Man 1", "Iron Man: El hombre de hierro"],
    [2010, "Iron Man 2"],
    [2008, "El increíble Hulk", "The Incredible Hulk", "Increíble Hulk"],
    [2011, "Thor"],
    [2012, "Los Vengadores", "Vengadores", "The Avengers", "Avengers", "Marvel's The Avengers", "Los Vengadores 1", "Avengers 1"],
    [2013, "Thor: Un mundo oscuro", "Thor: El mundo oscuro", "Thor: The Dark World", "Thor 2"],
    [2013, "Iron Man 3"],
    [2014, "Capitán América: El soldado del invierno", "Capitán América y el soldado del invierno", "Captain America: The Winter Soldier", "Capitán América 2"],
    [2014, "Guardianes de la Galaxia", "Guardians of the Galaxy"],
    [2017, "Guardianes de la Galaxia Vol. 2", "Guardianes de la Galaxia 2", "Guardians of the Galaxy Vol. 2"],
    [2015, "Avengers: Era de Ultrón", "Vengadores: La era de Ultrón", "Avengers: Age of Ultron"],
    [2015, "Ant-Man: El hombre hormiga", "Ant-Man", "Ant Man"],
    [2016, "Capitán América: Civil War", "Capitán América: Guerra civil", "Captain America: Civil War", "Capitán América 3"],
    [2021, "Viuda Negra", "Black Widow"],
    [2018, "Pantera Negra", "Black Panther"],
    [2017, "Spider-Man: De regreso a casa", "Spider-Man: Homecoming"],
    [2016, "Doctor Strange: Hechicero supremo", "Doctor Strange", "Doctor Extraño"],
    [2017, "Thor: Ragnarok", "Thor 3"],
    [2018, "Ant-Man y la Avispa", "Ant-Man and the Wasp"],
    [2018, "Avengers: Infinity War", "Vengadores: Infinity War", "Avengers: Guerra del Infinito"],
    [2019, "Avengers: Endgame", "Vengadores: Endgame", "Avengers: Fin del juego"],
    [2021, "Loki"],
    [2021, "¿Qué pasaría si...?", "What If...?", "Que pasaria si"],
    [2021, "WandaVision"],
    [2021, "Falcon y el Soldado del Invierno", "The Falcon and the Winter Soldier", "Falcon y el Soldado de Invierno"],
    [2021, "Shang-Chi y la leyenda de los Diez Anillos", "Shang-Chi and the Legend of the Ten Rings", "Shang-Chi"],
    [2021, "Eternos", "Eternals"],
    [2019, "Spider-Man: Lejos de casa", "Spider-Man: Far From Home"],
    [2021, "Spider-Man: Sin camino a casa", "Spider-Man: No Way Home", "Spider-Man: No hay camino a casa"],
    [2022, "Doctor Strange en el multiverso de la locura", "Doctor Strange in the Multiverse of Madness", "Doctor Strange 2"],
    [2021, "Ojo de Halcón", "Hawkeye"],
    [2022, "Moon Knight", "Caballero Luna"],
    [2022, "Pantera Negra: Wakanda por siempre", "Black Panther: Wakanda Forever", "Pantera Negra 2"],
    [2024, "Echo"],
    [2022, "She-Hulk: Abogada Hulka", "She-Hulk: Attorney at Law", "She-Hulk"],
    [2022, "Ms. Marvel"],
    [2022, "Thor: Amor y trueno", "Thor: Love and Thunder", "Thor 4"],
    [2022, "La maldición del hombre lobo", "Werewolf by Night", "Hombre lobo por la noche"],
    [2022, "Guardianes de la Galaxia: Especial felices fiestas", "The Guardians of the Galaxy Holiday Special"],
    [2023, "Ant-Man y la Avispa: Quantumanía", "Ant-Man and the Wasp: Quantumania"],
    [2023, "Guardianes de la Galaxia Vol. 3", "Guardianes de la Galaxia 3", "Guardians of the Galaxy Vol. 3"],
    [2023, "Invasión secreta", "Secret Invasion"],
    [2023, "Las Marvels", "The Marvels"],
    [2024, "Deadpool & Wolverine", "Deadpool y Wolverine", "Deadpool 3"],
    [2024, "Agatha: ¿Quién si no?", "Agatha All Along", "Agatha"],
    [2025, "Daredevil: Born Again", "Daredevil: Renace"],
    [2025, "Capitán América: Un nuevo mundo", "Captain America: Brave New World", "Capitán América 4"],
    [2025, "Thunderbolts*", "Thunderbolts"],
    [2025, "Ironheart"],
    [2025, "Los 4 Fantásticos: Primeros pasos", "Los Cuatro Fantásticos: Primeros pasos", "The Fantastic Four: First Steps"],
    [2026, "Spider-Man: Un nuevo día", "Spider-Man: Brand New Day"],
    [2026, "Avengers: Doomsday", "Vengadores: Doomsday"]
  ];
  var mcuIndex = null;
  function mcuKey(s) {
    return norm(String(s || "").replace(/&/g, " y ").replace(/\bvol\.?\s*/gi, "vol "));
  }
  function chronoIndex(t) {
    var e;
    if (!mcuIndex) {
      mcuIndex = {};
      MCU_TIMELINE.forEach(function (row, i) {
        row.slice(1).forEach(function (name) { (mcuIndex[mcuKey(name)] = mcuIndex[mcuKey(name)] || []).push({ i: i, y: row[0] }); });
      });
    }
    e = (mcuIndex[mcuKey(t && t.name)] || []).filter(function (x) { return !t.year || Math.abs(Number(t.year) - x.y) <= 1; })[0];
    return e ? e.i : -1;
  }
  function isChronoCategory(name) {
    return /^(marvel|mcu|universo marvel|universo cinematografico de marvel|marvel studios)$/.test(norm(name));
  }
  /* Los títulos de una categoría en el orden en que se muestran: Marvel por la historia; las demás, tal cual. */
  function sortForCategory(name, titles) {
    if (!isChronoCategory(name)) {
      return titles;
    }
    return titles.slice().sort(function (a, b) {
      var ia = chronoIndex(a);
      var ib = chronoIndex(b);
      if (ia >= 0 && ib >= 0) { return ia - ib; }
      if (ia >= 0) { return -1; }
      if (ib >= 0) { return 1; }
      return (Number(a.year) || 9999) - (Number(b.year) || 9999) || String(a.name).localeCompare(String(b.name));
    });
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
    doc.iptv = load("iptv", null);
    list.forEach(function (p) { withProfile(p.id, function () { doc.p[p.id].iptvfav = iptvFavLog(); }); });
    return doc;
  }

  function isNewer(a, b) { return !!a && (!b || (a.at || 0) > (b.at || 0)); }

  /* ----- TV en vivo (IPTV, js/iptv.js) -----
   * La lista M3U es de la cuenta (la misma en la TV y el celular): {url, name, at}. Favoritos y último canal, de cada
   * perfil. Todo viaja con la sincronización (exportSync / mergeSync). */
  function iptv() { var c = load("iptv", null); return c && c.url ? c : null; }
  function setIptv(url, name) {
    var clean = String(url || "").trim();
    save("iptv", clean ? { url: clean, name: String(name || "").trim(), at: Date.now() } : { url: "", name: "", at: Date.now() });
    changed("iptv");
  }
  function iptvFavLog() { return load("iptvfav", {}, true); }
  function iptvFavs() {
    var log = iptvFavLog();
    var out = {};
    Object.keys(log).forEach(function (k) { if (log[k] && log[k].on) { out[k] = true; } });
    return out;
  }
  function toggleIptvFav(key) {
    var log = iptvFavLog();
    var on = !(log[key] && log[key].on);
    log[key] = { on: on, at: Date.now() };
    save("iptvfav", log, true);
    changed("iptv");
    return on;
  }
  function iptvLast() { return load("iptvlast", "", true); }
  function setIptvLast(key) { save("iptvlast", key || "", true); }

  /* Videos copiados de un grupo a otro (js/telegram.js dedupeCopies): {claveVieja: claveNueva}. En cada perfil de la
   * cuenta, el progreso y Mi lista (los videos sin clasificar se guardan como «v:<clave>») pasan a la clave nueva sin pisar
   * algo más reciente; las etiquetas puestas desde la TV se copian a la nueva. Devuelve true si cambió algo. */
  function aliasKeys(map) {
    var olds = Object.keys(map || {});
    var any = { progress: false, mylist: false, tags: false };
    var t;
    var tAt;
    if (!olds.length) {
      return false;
    }
    profiles().forEach(function (p) {
      withProfile(p.id, function () {
        var pr = load("progress", {}, true);
        var log = mylistLog();
        var pc = false;
        var lc = false;
        olds.forEach(function (o) {
          var n = map[o];
          if (pr[o]) {
            if (isNewer(pr[o], pr[n])) { pr[n] = pr[o]; }
            delete pr[o];
            pc = true;
          }
          if (log["v:" + o]) {
            if (isNewer(log["v:" + o], log["v:" + n])) { log["v:" + n] = log["v:" + o]; }
            delete log["v:" + o];
            lc = true;
          }
        });
        if (pc) { save("progress", pr, true); any.progress = true; }
        if (lc) { save("mylistlog", log, true); save("mylist", listFromLog(log), true); any.mylist = true; }
      });
    });
    t = tags();
    tAt = load("tagsAt", {});
    olds.forEach(function (o) {
      var n = map[o];
      if (t[o] !== undefined && t[n] === undefined) { t[n] = t[o]; tAt[n] = Date.now(); any.tags = true; }
    });
    if (any.tags) { save("tags", t); save("tagsAt", tAt); }
    Object.keys(any).forEach(function (k) { if (any[k]) { changed(k); } });
    return any.progress || any.mylist || any.tags;
  }

  /* Fecha de un perfil para combinar. Los que se crearon o editaron antes de sincronizar no tienen fecha:
   * uno personalizado (otro nombre, avatar propio, PIN, infantil cambiado) vale 1 y le gana al de fábrica (0). */
  var FACTORY = { p1: ["Familia", "panda", false], p2: ["Santiago", "zorro", false], p3: ["Kids", "dino", true], p4: ["Invitado", "buho", false] };
  function profileAt(p) {
    var f = FACTORY[p.id];
    if (p.at) {
      return p.at;
    }
    if (p.factory) {
      return 0; // perfil inicial sin tocar (starterProfiles)
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
      /* TV en vivo: la lista de la cuenta */
      if (doc.iptv && (doc.iptv.at || 0) > ((load("iptv", null) || {}).at || 0)) {
        save("iptv", doc.iptv);
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
          if (r.iptvfav) {
            var fav = iptvFavLog();
            var fc = false;
            Object.keys(r.iptvfav).forEach(function (k) { if (isNewer(r.iptvfav[k], fav[k])) { fav[k] = r.iptvfav[k]; fc = true; } });
            if (fc) { save("iptvfav", fav, true); any = true; }
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
    isChronoCategory: isChronoCategory,
    sortForCategory: sortForCategory,
    CATEGORIES: CATEGORY_NAMES,
    categoryFromTmdb: categoryFromTmdb,
    kidsFromTmdb: kidsFromTmdb,
    tmdbTag: tmdbTag,
    langsTag: langsTag,
    langName: langName,
    subFileLang: subFileLang,
    trackLabels: trackLabels,
    canonicalCategory: canonicalCategory,
    primaryCategory: primaryCategory,
    chronoIndex: chronoIndex,
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
    iptv: iptv,
    setIptv: setIptv,
    iptvFavs: iptvFavs,
    toggleIptvFav: toggleIptvFav,
    iptvLast: iptvLast,
    setIptvLast: setIptvLast,
    aliasKeys: aliasKeys,
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
