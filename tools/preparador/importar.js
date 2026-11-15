/* HomeFlix · Preparador · importar desde un grupo antiguo (diseño: docs/diseno-importar-grupo-antiguo.md).
 *
 * FASE 1 (solo lectura): lee un canal/grupo con el formato ANTIGUO y averigua qué series hay, cuántas temporadas y qué capítulos tiene cada una.
 * No copia, no edita y no borra nada. Formato antiguo:
 *   · ENCABEZADO: una foto con un texto «Título español / Título original · N temporadas · Tipo · Publicación · Géneros · Episodios · Duración ·
 *     Idioma · Formato» (los campos varían de un encabezado a otro);
 *   · CAPÍTULO: un video (o documento de video) con el comentario «Capítulo N» y lo que siga.
 *
 * FORMATO B (sin encabezado): cada video trae todo en su propio comentario, p. ej.
 *     «Star Wars: Tales of the Jedi - Star Wars: Historias de los Jedi - 2022 - Latino» y, en la línea de abajo, «S01 E01» (o «S01 E06 - Fin de temporada»).
 *   Se toman título (el que parece español queda como nombre), título original, año, idioma, temporada y capítulo de cada comentario; los videos del mismo
 *   título se juntan en una serie y, si el comentario trae el número de temporada, esa es la temporada. «Fin de temporada» cuenta como pista de corte.
 *   Una foto suelta (el póster) se asocia a la serie por el parecido del título o, si solo hay una serie y una foto, a esa.
 *
 * Cómo se decide dónde empieza una temporada (motor de evidencias: cada pista suma puntos entre un capítulo y el siguiente):
 *   +3 hay un encabezado nuevo de la misma serie entre ellos · +3 la numeración vuelve a 1 (+2 si baja a otro número) · +2 cambia el idioma
 *   +1 cambia la calidad declarada · +1 cambia el peso medio de los videos · +1 hay una pausa grande entre las fechas
 *   −2 el encabezado se repite igual y la numeración sigue de largo (no es corte, es un recordatorio).
 *   ≥ 3 = corte SEGURO · 2 = corte PROPUESTO (se confirma a mano) · menos = no hay corte.
 *   Si el encabezado dice «N temporadas» y no se halló ningún corte, se propone partir los capítulos en N partes iguales.
 *
 *   PrepImport.read(client, peer, {onProgress, signal})  → mensajes normalizados, de lo más viejo a lo más nuevo
 *   PrepImport.analyze(messages)                          → {series, loose, stats}
 *   PrepImport.report(analysis)                           → objeto de solo texto para descargar (sin claves ni archivos)
 *
 * FASE 2 · TMDB (match, pick): cada serie busca su ficha (título original y en español, año) y deja candidatos para elegir a mano.
 * FASE 3 · copia (copyAll): al grupo nuevo con temas, SIN volver a subir (client.sendCopy reutiliza el archivo de Telegram) y con el comentario de hoy:
 *     serie(T/C)#Nombre#descripción #Anime #tmdbtv<id>      (capítulos; la renumeración ya viene hecha)
 *     serie#Nombre #vertical · #portada · #banner           (la foto del encabezado es la vertical; portada y banner salen de TMDB)
 *   El tema de cada serie lo pone PrepTopics (temas.js) según el comentario; el avance se guarda (se reanuda) y se espera ante FLOOD_WAIT. */
var PrepImport = (function () {
  "use strict";
  var VIDEO = { _: "inputMessagesFilterVideo" };
  var DOCS = { _: "inputMessagesFilterDocument" };
  var PHOTOS = { _: "inputMessagesFilterPhotos" };
  var VIDEO_EXT = /\.(mkv|webm|mp4|m4v|mov|avi)$/i;
  var MAX_PER_FILTER = 8000;

  function norm(s) {
    var t = String(s == null ? "" : s).toLowerCase();
    if (t.normalize) { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    return t.replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  /* ===================== Lectura del canal ===================== */
  function isVideoMsg(m) { var d = m.media; return !!d && d.type === "video" && !d.isRound && !d.isAnimation; }
  function isVideoDoc(m) { var d = m.media; return !!d && d.type === "document" && (VIDEO_EXT.test(d.fileName || "") || /^video\//i.test(d.mimeType || "")); }
  function isPhotoMsg(m) { return !!m.media && m.media.type === "photo"; }

  function describe(m, kind) {
    var d = m.media || {};
    return { id: m.id, kind: kind, text: m.text || "", fileName: d.fileName || "", duration: d.duration || 0, size: d.fileSize || 0, width: d.width || 0, height: d.height || 0,
      uid: d.fileUniqueId || d.uniqueFileId || "", date: m.date ? (m.date.getTime ? m.date.getTime() : Number(m.date)) : 0 };
  }

  async function page(client, peer, filter, offset) {
    for (var n = 0; ; n += 1) {
      try {
        return await client.searchMessages({ chatId: peer, filter: filter, limit: 100, offset: offset });
      } catch (e) {
        var t = String((e && (e.text || e.message)) || e);
        if (!/FLOOD/i.test(t) || n >= 4) { throw e; }
        await sleep(6000 * (n + 1));
      }
    }
  }
  async function collect(client, peer, filter, keep, kind, out, signal, onTick) {
    var offset;
    var res;
    var n = 0;
    do {
      if (signal && signal.aborted) { throw new Error("Detenido"); }
      res = await page(client, peer, filter, offset);
      res.forEach(function (m) { if (keep(m)) { out.push(describe(m, kind)); } });
      n += res.length;
      offset = res.next;
      if (onTick) { onTick(); }
    } while (res.length && offset !== undefined && n < MAX_PER_FILTER);
  }

  /* Videos, documentos de video y fotos, los tres filtros a la vez (si Telegram protesta, uno por uno); se juntan por número de mensaje, que en un chat
   * crece con el tiempo: así queda el orden real del canal (lo que no es ni foto ni video, como un texto suelto, no aparece). */
  async function read(client, peer, opts) {
    opts = opts || {};
    var a = [];
    var b = [];
    var c = [];
    var tick = function () { if (opts.onProgress) { opts.onProgress(a.length + b.length + c.length); } };
    try {
      await Promise.all([
        collect(client, peer, VIDEO, isVideoMsg, "video", a, opts.signal, tick),
        collect(client, peer, DOCS, isVideoDoc, "video", b, opts.signal, tick),
        collect(client, peer, PHOTOS, isPhotoMsg, "photo", c, opts.signal, tick)
      ]);
    } catch (e) {
      if (/Detenido/.test(String(e && e.message))) { throw e; }
      a = []; b = []; c = [];
      await collect(client, peer, VIDEO, isVideoMsg, "video", a, opts.signal, tick);
      await collect(client, peer, DOCS, isVideoDoc, "video", b, opts.signal, tick);
      await collect(client, peer, PHOTOS, isPhotoMsg, "photo", c, opts.signal, tick);
    }
    var seen = {};
    return a.concat(b, c).filter(function (m) { if (seen[m.id]) { return false; } seen[m.id] = true; return true; }).sort(function (x, y) { return x.id - y.id; });
  }

  /* ===================== Interpretar el encabezado ===================== */
  var FIELD = /^\s*(t[ií]tulo|nombre|cap[ií]tulos?|tipo|publicaci[oó]n|a[nñ]o|g[eé]neros?|episodios?|duraci[oó]n|idioma|audio|formato|calidad|estado|estudio|temporadas?)\s*[:：]\s*(.*)$/i;

  function cleanLine(s) { var t = String(s || ""); if (t.normalize) { t = t.normalize("NFKC"); } return t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim(); }
  /* quita lo que acompaña al número de un capítulo sin ser su título («Audio Latino», «720p», «Final»…) */
  function stripNoise(t) {
    return cleanLine(t).replace(/\b(audio|latino|latam|castellano|espa[nñ]ol|japon[eé]s|jap|ingl[eé]s|subtitulad[oa]s?|subs?|dual|hd|full ?hd|\d{3,4}p|final|fin de (la )?temporada)\b/gi, " ").replace(/[\/|+.,:;\-–—]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function langInfo(raw) {
    var t = norm(raw);
    var key = "";
    if (!t) { return { raw: "", key: "", label: "" }; }
    if (/latino|latam|espanol latino/.test(t)) { key = "latino"; }
    else if (/castellano|espana/.test(t)) { key = "castellano"; }
    else if (/jap|jpn|japones/.test(t)) { key = /sub/.test(t) ? "japones+subs" : "japones"; }
    else if (/ingles|english|\beng\b/.test(t)) { key = /sub/.test(t) ? "ingles+subs" : "ingles"; }
    else if (/espanol|\bspa\b|\bes\b/.test(t)) { key = "espanol"; }
    else { key = t; }
    return { raw: cleanLine(raw), key: key, label: { latino: "Latino", castellano: "Castellano", "japones+subs": "Japonés con subtítulos", japones: "Japonés", "ingles+subs": "Inglés con subtítulos", ingles: "Inglés", espanol: "Español" }[key] || cleanLine(raw) };
  }

  function genresOf(v) {
    var tags = String(v || "").match(/#[^\s#,]+/g);
    var list = tags ? tags.map(function (x) { return x.slice(1).replace(/_/g, " "); }) : String(v || "").split(/[,;·|]/);
    return list.map(function (x) { return cleanLine(x); }).filter(Boolean);
  }

  /* Devuelve null si el texto no parece un encabezado (hacen falta al menos 2 datos conocidos). */
  function parseHeader(text) {
    var lines = String(text || "").split(/\r?\n/);
    var f = {};
    var titleLines = [];
    var seasons = 0;
    var known = 0;
    var seenField = false;
    var lastKey = "";
    var m;
    var s;
    lines.forEach(function (raw) {
      var line = cleanLine(raw);
      var fm;
      var sm;
      if (!line) { return; }
      fm = FIELD.exec(line) || FIELD.exec(line.replace(/^[\u3000-\u9fff\uff00-\uffef]+\s*/, ""));
      if (!fm && /^(sinopsis|sipnosis|resumen|descripci[oó]n|parte)\s*[:：]/i.test(line)) { lastKey = ""; return; } // datos que no usamos: no se pegan al campo anterior
      if (fm) {
        seenField = true;
        lastKey = norm(fm[1]).replace(/s$/, "");
        f[lastKey] = fm[2];
        known += 1;
        return;
      }
      sm = /^(\d{1,2})\s*temporadas?$/i.exec(line);
      if (sm) { seasons = Number(sm[1]); known += 1; return; }
      if (!seenField) { titleLines.push(line); } else if (lastKey) { f[lastKey] += " " + line; } // el valor sigue en la línea de abajo (p. ej. más géneros)
    });
    if (known < 2) { return null; }
    var names = (f.titulo || f.nombre || titleLines[0] || "").split(/\s+\/\s+|\s+\|\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
    var tipo = norm(f.tipo || "");
    var eps = (/(\d+)/.exec(f.episodio || f.capitulo || "") || [])[1];
    var dur = (/(\d+)/.exec(f.duracion || "") || [])[1];
    var year = (/(\d{4})/.exec(f.publicacion || f.ano || "") || [])[1];
    var lang = langInfo(f.idioma || f.audio || "");
    var quality = cleanLine(f.formato || f.calidad || "");
    m = /(\d{3,4})\s*p/i.exec(quality);
    return {
      title: names[0] || "", original: names[1] || "", altTitles: titleLines.slice(1),
      seasons: seasons || (/(\d+)\s*temporadas?/i.exec(titleLines.join(" ")) || [])[1] * 1 || 0,
      type: /pelicula|movie|film/.test(tipo) ? "pelicula" : "serie", typeRaw: cleanLine(f.tipo || ""),
      year: year ? Number(year) : 0, genres: genresOf(f.genero || ""), episodes: eps ? Number(eps) : 0, minutes: dur ? Number(dur) : 0,
      lang: lang.key, langLabel: lang.label, langRaw: lang.raw, quality: quality, height: m ? Number(m[1]) : 0,
      text: norm(lines.map(cleanLine).join(" ")), fields: known
    };
  }

  /* ===================== Interpretar un capítulo ===================== */
  /* «Capítulo 3», «Capitulo 3 - El nombre», «Cap. 3», «Episodio 3», «Ep 3», «S01E03», «1x03»; también del nombre del archivo. */
  function parseEpisode(msg) {
    var srcs = [msg.text || "", msg.fileName || ""];
    var i;
    var t;
    var m;
    var rest;
    var tm;
    for (i = 0; i < srcs.length; i += 1) {
      t = cleanLine(srcs[i]);
      if (i === 1) { t = t.replace(/_/g, " ").replace(/\s+/g, " ").trim(); } // nombre de archivo: «Art_Attack_S02E01_Episode_27_1080p…»
      if (!t) { continue; }
      m = /cap[ií]tulo\s*[:#.\-]?\s*(\d{1,4})\s*(?:[-–—:.]\s*)?(.*)$/i.exec(t) || /\bcap\.?\s*(\d{1,4})\s*(?:[-–—:.]\s*)?(.*)$/i.exec(t) || /episodio\s*[:#.\-]?\s*(\d{1,4})\s*(?:[-–—:.]\s*)?(.*)$/i.exec(t) || /\bep\.?\s*(\d{1,4})\s*(?:[-–—:.]\s*)?(.*)$/i.exec(t);
      if (m) {
        rest = String(m[2] || "").replace(/^\s*\/\s*\d+\s*/, "");
        tm = /\btemp(?:orada)?\.?\s*(\d{1,2})\b/i.exec(t);
        return { num: Number(m[1]), title: rest && stripNoise(rest) ? rest.trim() : "", season: tm ? Number(tm[1]) : 0 };
      }
      m = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(t) || /\b(\d{1,2})x(\d{1,3})\b/i.exec(t);
      if (m) { return { num: Number(m[2]), title: "", season: Number(m[1]) }; }
      m = /\((\d{1,3})\s*\/\s*(\d{1,3})\)/.exec(t); // «The Mentalist (12/13)»: capítulo 12 de 13 de esa temporada
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= Number(m[2])) {
        tm = /\btemp(?:orada)?\.?\s*(\d{1,2})\b/i.exec(t);
        return { num: Number(m[1]), title: "", season: tm ? Number(tm[1]) : 0, total: Number(m[2]) };
      }
      m = /^\s*(\d{1,4})\s*$/.exec(t);
      if (m) { return { num: Number(m[1]), title: "", season: 0 }; }
    }
    return null;
  }

  /* ===================== ¿Es la misma serie? ===================== */
  var STOP = { de: 1, del: 1, la: 1, las: 1, el: 1, los: 1, y: 1, en: 1, un: 1, una: 1, the: 1, of: 1, and: 1, a: 1 };
  function tokens(h) {
    var seen = {};
    var out = [];
    norm([h.title, h.original].join(" ")).split(" ").forEach(function (w) { if (w.length > 2 && !STOP[w] && !seen[w]) { seen[w] = true; out.push(w); } });
    return out;
  }
  function overlap(a, b) {
    var inter = a.filter(function (w) { return b.indexOf(w) >= 0; }).length;
    var small = Math.min(a.length, b.length);
    return small ? inter / small : 0;
  }
  /* Puntos de parecido entre dos encabezados; ≥ 5 se toman como la misma serie (puede cambiar el idioma o el nombre en español). */
  function sameScore(a, b) {
    var s = 0;
    var ov = overlap(tokens(a), tokens(b));
    var ga = a.genres.map(norm).sort().join("|");
    var gb = b.genres.map(norm).sort().join("|");
    if (a.photoUid && a.photoUid === b.photoUid) { s += 4; }
    else if (a.photoSize && a.photoSize === b.photoSize && a.photoW === b.photoW && a.photoH === b.photoH) { s += 3; }
    if (norm(a.title) && norm(a.title) === norm(b.title)) { s += 4; }
    else if (norm(a.original) && norm(a.original) === norm(b.original)) { s += 4; }
    else if (ov >= 0.5) { s += 3; }
    else if (ov >= 0.3) { s += 1; }
    if (a.year && a.year === b.year) { s += 2; } else if (a.year && b.year) { s -= 2; }
    if (a.typeRaw && norm(a.typeRaw) === norm(b.typeRaw)) { s += 1; }
    if (ga && ga === gb) { s += 1; }
    if (a.episodes && a.episodes === b.episodes) { s += 1; }
    if (a.minutes && a.minutes === b.minutes) { s += 1; }
    return s;
  }

  /* ===================== Formato B: datos en el comentario de cada video ===================== */
  var KNOWN_LANG = { latino: 1, castellano: 1, "japones+subs": 1, japones: 1, "ingles+subs": 1, ingles: 1, espanol: 1 };
  function knownLang(tok) { var l = langInfo(tok); return KNOWN_LANG[l.key] ? l : (/^(dual|multi|vose|lat)$/i.test(String(tok).trim()) ? { raw: String(tok).trim(), key: norm(tok), label: String(tok).trim() } : null); }
  function spanishness(t) {
    var n = 0;
    norm(t).split(" ").forEach(function (w) { if (/^(de|del|los|las|la|el|y|en|un|una|con|para|por|sus|su|al)$/.test(w)) { n += 1; } });
    if (/[áéíóúñ¿¡]/i.test(String(t))) { n += 1; }
    return n;
  }
  var FINALE = /fin de (la )?temporada|final de (la )?temporada|season finale|(^|\n)\s*(el )?fin\s*$/i;

  var EP_MARK = /cap[ií]tulo\s*[:#.\-]?\s*\d{1,4}|\bcap\.?\s*\d{1,4}|episodio\s*[:#.\-]?\s*\d{1,4}|\bep\.?\s*\d{1,4}|\bS\d{1,2}\s*E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b|\(\d{1,3}\s*\/\s*\d{1,3}\)/i;
  /* «🇲🇽» (o cualquier país de Latinoamérica) = latino, «🇪🇸» = castellano, «🇯🇵» = japonés, «🇺🇸/🇬🇧» = inglés */
  var FLAG_LATINO = /^(MX|AR|CO|CL|PE|VE|EC|UY|PY|BO|CR|PA|GT|HN|SV|NI|DO|CU|PR)$/;
  function flagLang(t) {
    var m = String(t || "").match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [];
    var i;
    var code;
    var name;
    for (i = 0; i < m.length; i += 1) {
      code = String.fromCharCode(m[i].codePointAt(0) - 0x1F1E6 + 65, m[i].codePointAt(2) - 0x1F1E6 + 65);
      name = FLAG_LATINO.test(code) ? "Latino" : code === "ES" ? "Castellano" : code === "JP" ? "Japonés" : (code === "US" || code === "GB") ? "Inglés" : "";
      if (name) { return langInfo(name); }
    }
    return null;
  }
  function langIn(t) { var l = langInfo(t); return KNOWN_LANG[l.key] ? l : null; }

  /* Lee «Título {Original} - Capítulo 01 Audio Latino» o «Título - Original - 2022 - Latino» (+ «S01 E01») del comentario de un video. Devuelve null si no parece uno. */
  function parseInline(m) {
    var text = String(m.text || "");
    var lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    var toks;
    var names = [];
    var year = 0;
    var lang = null;
    var ep = null;
    var brace = "";
    var raw;
    var rest = "";
    var epTitle = "";
    var a;
    var b;
    var em;
    var pre;
    var ym;
    var glued = false;
    if (!lines.length) { return null; }
    ep = parseEpisode({ text: text, fileName: "" }) || parseEpisode({ text: "", fileName: m.fileName || "" });
    raw = lines[0].replace(/\s*[{\[]([^{}\[\]]{2,80})[}\]]\s*/g, function (all, x) { brace = brace || x.trim(); return " "; }); // «Los super campeones {Captain Tsubasa}»: lo de las llaves es el título original
    toks = raw.split(/\s+[-–—|]\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
    toks.forEach(function (t) {
      var l;
      if (/^(19|20)\d{2}$/.test(t)) { year = year || Number(t); return; }
      if (parseEpisode({ text: t, fileName: "" }) || EP_MARK.test(t)) { // el token del capítulo: de él salen el idioma y, a veces, el título del capítulo
        l = langIn(t);
        if (l) { lang = lang || l; }
        em = EP_MARK.exec(t);
        pre = em ? t.slice(0, em.index) : "";
        if (!names.length && /[A-Za-zÁ-ÿ]{2}/.test(pre.replace(/\(?\b(?:19|20)\d{2}\b\)?/g, ""))) { // «CHERNOBYL (2019) Episodio 1 Castellano»: el título va pegado al capítulo, sin guiones
          ym = /\b((?:19|20)\d{2})\b/.exec(pre);
          if (ym) { year = year || Number(ym[1]); }
          pre = cleanLine(pre.replace(/\(?\b(?:19|20)\d{2}\b\)?/g, " "));
          if (pre) { names.push(pre); glued = true; }
          rest += " " + t.slice(em.index).replace(EP_MARK, " ");
          return;
        }
        rest += " " + t.replace(EP_MARK, " ");
        return;
      }
      l = knownLang(t);
      if (l) { lang = lang || l; return; }
      names.push(t);
    });
    if (!lang) { lang = flagLang(text); }
    lines.slice(1).forEach(function (l) { var k = l.replace(/[.\s]+$/, ""); if (!lang && k.length < 30 && knownLang(k)) { lang = knownLang(k); } });
    if (!names.length || !(year || (names.length >= 2 && ep) || (lang && ep) || (brace && ep) || (ep && ep.season) || (ep && glued))) { return null; }
    a = cleanName(names[0]); b = cleanName(brace || names[1] || "");
    if (!brace && b && spanishness(b) > spanishness(a)) { var tmp = a; a = b; b = tmp; }
    rest += " " + lines.slice(1).filter(function (l) { return !/^temp(orada)?\.?\s*\d{1,2}\.?$/i.test(l) && !(l.replace(/[.\s]+$/, "").length < 30 && knownLang(l.replace(/[.\s]+$/, ""))); }).join(" ").replace(EP_MARK, " ");
    rest = rest.replace(/^[\s\-–—:|.]+/, "").trim();
    if (rest && !FINALE.test(rest) && stripNoise(rest)) { epTitle = stripNoise(rest); }
    return { title: a, original: b, year: year, lang: lang ? lang.key : "", langLabel: lang ? lang.label : "", langRaw: lang ? lang.raw : "", season: ep ? ep.season : 0, num: ep ? ep.num : null,
      epTitle: epTitle || "", finale: FINALE.test(text), isSeries: !!ep };
  }
  function cleanName(x) { return String(x || "").replace(/^[^\p{L}\d¿¡]+/u, "").replace(/[\s,.:;\-–—]+$/, "").trim(); }
  /* ¿es casi el mismo nombre en español y en inglés («Estación 19» / «Station 19»)? Los números tienen que ser los mismos. */
  function lev(a, b) {
    var d = [];
    var i;
    var j;
    for (i = 0; i <= a.length; i += 1) { d[i] = [i]; }
    for (j = 1; j <= b.length; j += 1) { d[0][j] = j; }
    for (i = 1; i <= a.length; i += 1) { for (j = 1; j <= b.length; j += 1) { d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)); } }
    return d[a.length][b.length];
  }
  function titleNear(x, y) {
    var a = norm(x);
    var b = norm(y);
    if (!a || !b || a.length < 6 || b.length < 6) { return false; }
    if ((a.match(/\d+/g) || []).join(",") !== (b.match(/\d+/g) || []).join(",")) { return false; }
    return lev(a, b) <= Math.max(2, Math.round(Math.max(a.length, b.length) * 0.25));
  }
  function pseudoHeader(i) {
    return { title: i.title, original: i.original, altTitles: [], seasons: 0, type: i.isSeries ? "serie" : "pelicula", typeRaw: "", year: i.year, genres: [], episodes: 0, minutes: 0,
      lang: i.lang, langLabel: i.langLabel, langRaw: i.langRaw, quality: "", height: 0, text: norm([i.title, i.year, i.lang].join(" ")), fields: 2 };
  }
  /* título y año de una foto suelta: «SUPER CAMPEONES / CAPTAIN TSUBASA J (1983)» (puede ocupar dos renglones; lo de «Idioma: …» ya no es título) */
  function photoInfo(text) {
    var raw = String(text || "").split(/\r?\n/).map(function (l) { return cleanLine(l).replace(/^[:：\s·]+/, ""); });
    var title = [];
    var i;
    var y;
    var yl = 0;
    var joined;
    for (i = 0; i < raw.length; i += 1) {
      if (!raw[i]) { if (title.length) { break; } continue; } // el título acaba en la primera línea en blanco
      if (FIELD.test(raw[i]) || /^(idioma|audio)\b/i.test(raw[i]) || /^(#|temporada\b|temp\b)/i.test(raw[i]) || /^\d{1,2}\s*temp/i.test(raw[i])) { break; }
      if (/^(19|20)\d{2}$/.test(raw[i])) { yl = yl || Number(raw[i]); continue; } // renglón con solo el año
      title.push(raw[i]);
    }
    joined = title.join(" ");
    y = /\(((?:19|20)\d{2})\)/.exec(joined) || /[-–—]\s*((?:19|20)\d{2})\b/.exec(joined) || (yl ? [0, yl] : null);
    return { names: joined.replace(/\(((?:19|20)\d{2})\)/g, " ").split(/\s+[\/|]\s+|\s+[-–—]\s+/).map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(function (t) { return t && !/^(19|20)\d{2}$/.test(t) && !knownLang(t) && !/^(dual|multi)\b/i.test(t); }), year: y ? Number(y[1]) : 0, lines: title };
  }
  /* segunda línea de la foto («CAN THIS LOVE BE TRANSLATED»), si es otro título distinto del de los comentarios */
  function photoOriginal(text, title) {
    var lines = photoInfo(text).lines
      .map(function (l) { return l.replace(/\(((?:19|20)\d{2})\)/g, " ").replace(/\s+/g, " ").trim(); }).filter(function (l) { return l && !knownLang(l); });
    var o = lines.length >= 2 ? lines[1] : "";
    if (!o || norm(o) === norm(title) || overlap(tokens({ title: o, original: "" }), tokens({ title: title, original: "" })) >= 0.6) { return ""; }
    return o === o.toUpperCase() ? o.toLowerCase().replace(/(^|\s)(\S)/g, function (all, a, b) { return a + b.toUpperCase(); }) : o;
  }
  /* «Idioma: Latino» en cualquier renglón de la foto (aunque venga en letras especiales: «𝐈𝐝𝐢𝐨𝐦𝐚: 𝐋𝐚𝐭𝐢𝐧𝐨») */
  function idiomaLine(text) {
    var out = null;
    String(text || "").split(/\r?\n/).forEach(function (l) { var m = /^\s*(?:idioma|audio)\s*[:：]?\s*(.+)$/i.exec(cleanLine(l).replace(/^[:：\s]+/, "")); if (m && !out) { out = langIn(m[1]); } });
    return out;
  }
  function photoNames(text) { return photoInfo(text).names; }

  /* Número al final del comentario o del nombre de archivo («One Piece - 772», «» 770», «One Piece 1153»); no cuenta si es decimal («1015.5», un especial). */
  function trailingNum(m) {
    var srcs = [cleanLine(m.text), cleanLine(String(m.fileName || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/_/g, " "))];
    var i;
    var x;
    for (i = 0; i < srcs.length; i += 1) {
      if (/\b(movie|film|pel[ií]cula)\b/i.test(srcs[i])) { continue; } // «One Piece Movie 1»: el 1 es de la película, no un capítulo
      x = /(?:^|[^\d.])(\d{1,4})\s*$/.exec(srcs[i]);
      if (x && Number(x[1]) > 0) { return { num: Number(x[1]), title: "", season: 0 }; }
    }
    return null;
  }
  /* Foto de «One Piece / Temporada 01 / Arco East Blue»: abre (o continúa) la serie y marca la temporada. null si no es de ese tipo. */
  function seasonPhoto(text) {
    var lines = String(text || "").split(/\r?\n/).map(cleanLine).filter(Boolean);
    var sm;
    var i;
    if (lines.length < 2 || FIELD.test(lines[0]) || /^(temp|temporada)\b/i.test(lines[0])) { return null; }
    for (i = 1; i < lines.length; i += 1) {
      sm = /^(?:temporada|temp\.?)\s*(\d{1,2})\b/i.exec(lines[i]);
      if (sm) { return { title: lines[0].replace(/\(((?:19|20)\d{2})\)/g, " ").replace(/\s+/g, " ").trim(), season: Number(sm[1]), year: (/\(((?:19|20)\d{2})\)/.exec(lines[0]) || [])[1] * 1 || 0 }; }
    }
    return null;
  }

  /* ===================== Análisis ===================== */
  function analyze(messages, opts) {
    var msgs = (messages || []).slice().sort(function (x, y) { return x.id - y.id; });
    var blocks = [];
    var cur = null;
    var loose = { videosSinEncabezado: [], fotosSinDatos: 0, fotos: [], fotosAsignadas: 0 };
    var series = [];
    var loosePhotos = [];
    var inlineCount = 0;
    var lastInl = null;
    var sp;

    function inlineBlock(inl, m) {
      var ph = pseudoHeader(inl);
      var i;
      var b;
      for (i = 0; i < blocks.length; i += 1) { if (blocks[i].inline && sameScore(blocks[i].header, ph) >= 4) { return blocks[i]; } }
      b = { header: ph, msgId: m.id, date: m.date, chapters: [], inline: true, hasPhoto: false };
      blocks.push(b);
      return b;
    }

    msgs.forEach(function (m) {
      var h;
      var e;
      var inl;
      var ib;
      if (m.kind === "photo") {
        h = parseHeader(m.text);
        if (h) {
          h.photoUid = m.uid; h.photoSize = m.size; h.photoW = m.width; h.photoH = m.height;
          cur = { header: h, msgId: m.id, date: m.date, chapters: [], hasPhoto: true };
          blocks.push(cur);
        } else if (cur && (sp = seasonPhoto(m.text))) { // solo después de un encabezado (en el formato B, la foto de cada temporada es un póster suelto)
          if (cur && cur.fromSeasonPhoto && norm(cur.header.title) === norm(sp.title)) { cur.divider = { empty: true }; cur.seasonNext = sp.season; } // otra temporada de la misma serie
          else {
            h = pseudoHeader({ title: sp.title, original: "", year: sp.year, lang: "", langLabel: "", langRaw: "", isSeries: true });
            h.photoUid = m.uid; h.photoSize = m.size; h.photoW = m.width; h.photoH = m.height;
            cur = { header: h, msgId: m.id, date: m.date, chapters: [], hasPhoto: true, fromSeasonPhoto: true, seasonNext: sp.season };
            blocks.push(cur);
          }
        } else {
          loosePhotos.push({ id: m.id, text: m.text, width: m.width, height: m.height, size: m.size, uid: m.uid });
          if (cur && cur.chapters.length) { cur.divider = { empty: !cleanLine(m.text) }; } // en el formato viejo, una foto entre los capítulos abre otra temporada
        }
        return;
      }
      e = parseEpisode(m);
      if (!e && cur) { e = trailingNum(m); }
      inl = parseInline(m);
      if (!inl && !cur && lastInl && e && e.season) { // «7x1\nSub»: sin título, va con la serie del video anterior
        var tl = String(m.text || "").split(/\r?\n/).map(cleanLine).filter(Boolean).slice(1).join(" ");
        var lg = langIn(tl) || (/^sub/i.test(tl) ? { raw: "Subtitulado", key: "subtitulado", label: "Subtitulado" } : null);
        inl = { title: lastInl.title, original: lastInl.original, year: lastInl.year, lang: lg ? lg.key : lastInl.lang, langLabel: lg ? lg.label : lastInl.langLabel, langRaw: lg ? lg.raw : lastInl.langRaw, season: e.season, num: e.num, epTitle: "", finale: false, isSeries: true };
      }
      /* comentario propio con título y año/idioma: es el formato B (sin encabezado). Si hay un encabezado de arriba, solo cuenta cuando trae año y es otro título. */
      if (inl && (!cur || (inl.year && sameScore(pseudoHeader(inl), cur.header) < 3))) {
        ib = inlineBlock(inl, m);
        if (inl.isSeries) { ib.header.type = "serie"; }
        ib.chapters.push({ id: m.id, num: inl.num, epTitle: inl.epTitle, seasonHint: inl.season, finale: inl.finale, hdrOverride: pseudoHeader(inl), size: m.size, duration: m.duration, date: m.date, text: m.text, fileName: m.fileName, block: blocks.indexOf(ib) });
        inlineCount += 1;
        lastInl = inl;
        return;
      }
      if (!cur) { loose.videosSinEncabezado.push({ id: m.id, text: m.text, fileName: m.fileName }); return; }
      cur.chapters.push({ id: m.id, num: e ? e.num : null, epTitle: e ? e.title : "", seasonHint: (e && e.season) || cur.seasonNext || 0, size: m.size, duration: m.duration, date: m.date, text: m.text, fileName: m.fileName, block: blocks.length - 1, photoBefore: cur.divider || null });
      cur.divider = null;
    });

    /* Canal sin ningún dato en los mensajes (ni encabezado ni comentarios) pero con «1x01», «ML 2x1», «S02E03»… en los nombres de archivo:
     * es una sola serie y el nombre es el del propio canal. Los capítulos se ordenan por temporada y número. */
    if (!blocks.length && opts && opts.chatTitle && loose.videosSinEncabezado.length) {
      var lv = loose.videosSinEncabezado.map(function (v) { return { v: v, m: msgs.filter(function (x) { return x.id === v.id; })[0], e: parseEpisode({ text: "", fileName: v.fileName }) }; });
      if (lv.filter(function (x) { return x.e && x.e.season; }).length >= Math.max(2, lv.length * 0.6)) {
        lv.sort(function (a, b) { return ((a.e && a.e.season) || 0) - ((b.e && b.e.season) || 0) || ((a.e && a.e.num) || 0) - ((b.e && b.e.num) || 0) || a.v.id - b.v.id; });
        cur = { header: pseudoHeader({ title: cleanLine(opts.chatTitle), original: "", year: 0, lang: "", langLabel: "", langRaw: "", isSeries: true }), msgId: lv[0].v.id, date: lv[0].m ? lv[0].m.date : 0, chapters: [], hasPhoto: false };
        lv.forEach(function (x) {
          cur.chapters.push({ id: x.v.id, num: x.e ? x.e.num : null, epTitle: "", seasonHint: x.e ? x.e.season : 0, size: x.m ? x.m.size : 0, duration: x.m ? x.m.duration : 0, date: x.m ? x.m.date : 0, text: "", fileName: x.v.fileName, block: 0 });
        });
        blocks.push(cur);
        loose.videosSinEncabezado = lv.filter(function (x) { return !(x.e && x.e.season); }).map(function (x) { return x.v; });
      }
    }

    /* bloques → series (el mismo título/póster/datos = la misma serie, aunque cambie el idioma o el nombre en español) */
    blocks.forEach(function (b, bi) {
      var best = null;
      var bestScore = 0;
      series.forEach(function (s) {
        var sc = Math.max.apply(null, s.blocks.map(function (x) {
          var v = sameScore(x.header, b.header);
          /* mismo título exacto, sin años que se contradigan (p. ej. «One Piece» en Sub y en Latino, con o sin foto de temporada): es la misma serie */
          if (v < 5 && x.header.type !== "pelicula" && b.header.type !== "pelicula" && !/\b(movie|film|pel[ií]cula)\b/i.test(b.header.title) && !(x.header.year && b.header.year && x.header.year !== b.header.year) &&
            ((v === 4 && norm(x.header.title) && norm(x.header.title) === norm(b.header.title)) || (x.inline && b.inline && titleNear(x.header.title, b.header.title)))) { v = 5; }
          return v;
        }));
        if (sc > bestScore) { bestScore = sc; best = s; }
      });
      b.index = bi;
      if (best && bestScore >= 5) { best.blocks.push(b); b.matchScore = bestScore; } else { series.push({ blocks: [b] }); b.matchScore = 0; }
    });

    /* fotos sueltas (el póster del formato B), en este orden de pistas: 1) el título de su comentario se parece al de una serie; 2) está justo antes del primer
     * capítulo de una serie sin foto; 3) es la única foto y hay una sola serie */
    function attach(sr, ph) {
      var b0 = sr.blocks[0];
      b0.msgId = ph.id; b0.hasPhoto = true;
      b0.header.photoW = ph.width; b0.header.photoH = ph.height; b0.header.photoSize = ph.size; b0.header.photoUid = ph.uid;
      if (!b0.header.year) { b0.header.year = photoInfo(ph.text).year; } // el año de la foto ayuda a emparejar con TMDB
      if (!b0.header.original) { b0.header.original = photoOriginal(ph.text, b0.header.title); }
      if (!b0.header.lang) { var pl = /\bdual\b/i.test(ph.text || "") ? knownLang("dual") : (langIn(String(ph.text || "").split(/\r?\n/)[0]) || flagLang(String(ph.text || "").split(/\r?\n/)[0]) || idiomaLine(ph.text) || flagLang(ph.text)); if (pl) { b0.header.lang = pl.key; b0.header.langLabel = pl.label; b0.header.langRaw = pl.raw; } }
      loose.fotosAsignadas += 1;
    }
    function firstId(sr) { var c = sr.blocks[0].chapters[0]; return c ? c.id : 0; }
    var pending = [];
    loosePhotos.forEach(function (ph) {
      var names = photoNames(ph.text);
      var best = null;
      var bestOv = 0;
      series.forEach(function (sr) {
        var ov;
        if (sr.blocks[0].hasPhoto) { return; }
        ov = names.length ? overlap(tokens({ title: names[0], original: names[1] || "" }), tokens(sr.blocks[0].header)) : 0;
        if (ov > bestOv) { bestOv = ov; best = sr; }
      });
      if (best && bestOv >= 0.5) { attach(best, ph); } else { pending.push(ph); }
    });
    pending.slice().reverse().forEach(function (ph) { // de la más cercana al capítulo hacia atrás: gana la que está justo antes
      var next = msgs.filter(function (m) { return m.kind === "video" && m.id > ph.id; })[0];
      var sr = next ? series.filter(function (x) { return !x.blocks[0].hasPhoto && firstId(x) === next.id; })[0] : null;
      if (sr) { attach(sr, ph); pending.splice(pending.indexOf(ph), 1); }
    });
    pending.slice().forEach(function (ph) {
      if (series.length === 1 && loosePhotos.length === 1 && !series[0].blocks[0].hasPhoto) { attach(series[0], ph); pending.splice(pending.indexOf(ph), 1); }
    });
    pending.forEach(function (ph) { loose.fotosSinDatos += 1; loose.fotos.push({ id: ph.id, text: String(ph.text || "").slice(0, 200), w: ph.width, h: ph.height }); });

    var out = series.map(function (s, si) { return buildSeries(s, si); });
    var chapters = out.reduce(function (n, s) { return n + s.chapters; }, 0);
    return {
      series: out, loose: loose,
      stats: { messages: msgs.length, headers: blocks.filter(function (b) { return !b.inline; }).length, comentariosPorVideo: inlineCount, series: out.length, chapters: chapters, videosSinEncabezado: loose.videosSinEncabezado.length, fotosSinDatos: loose.fotosSinDatos, fotosAsignadas: loose.fotosAsignadas }
    };
  }

  function buildSeries(s, si) {
    var first = s.blocks[0].header;
    var flat = [];
    var declaredSeasons = 0;
    var notes = [];
    var cuts = [];
    var segments;
    var seasons = [];
    var sizes;
    var gaps = [];
    var gapMedian;

    s.blocks.forEach(function (b) {
      declaredSeasons = Math.max(declaredSeasons, b.header.seasons || 0);
      b.chapters.forEach(function (c) { c.hdr = c.hdrOverride || b.header; c.blockMsg = b.msgId; flat.push(c); });
    });
    flat.forEach(function (c, i) { if (i) { gaps.push(Math.max(0, c.date - flat[i - 1].date)); } });
    gapMedian = median(gaps.filter(function (g) { return g > 0; }));

    /* puntaje de corte entre cada par de capítulos consecutivos */
    flat.forEach(function (c, i) {
      var p;
      var ev = [];
      var score = 0;
      var repeated;
      var win;
      var before;
      var after;
      var gap;
      if (!i) { return; }
      p = flat[i - 1];
      if (c.block !== p.block) {
        score += 3; ev.push({ pts: 3, text: "Hay un encabezado nuevo entre los capítulos" });
        repeated = c.hdr.text === p.hdr.text;
        if (repeated && c.num != null && p.num != null && c.num === p.num + 1) { score -= 2; ev.push({ pts: -2, text: "El encabezado se repite igual y la numeración sigue de largo" }); }
        if (c.hdr.height && p.hdr.height && c.hdr.height !== p.hdr.height) { score += 1; ev.push({ pts: 1, text: "Cambia la calidad declarada (" + p.hdr.height + "p → " + c.hdr.height + "p)" }); }
      }
      if (c.hdr.lang && p.hdr.lang && c.hdr.lang !== p.hdr.lang && !(c.seasonHint && c.seasonHint === p.seasonHint)) { score += 2; ev.push({ pts: 2, text: "El idioma cambia de " + (p.hdr.langLabel || p.hdr.lang) + " a " + (c.hdr.langLabel || c.hdr.lang) }); }
      if (c.photoBefore) { score += c.photoBefore.empty ? 3 : 2; ev.push({ pts: c.photoBefore.empty ? 3 : 2, text: "Hay una foto (portada de temporada) entre los capítulos" }); }
      if (p.finale) { score += 3; ev.push({ pts: 3, text: "El capítulo anterior dice «fin de temporada»" }); }
      if (c.num != null && p.num != null && c.num < p.num) {
        if (c.num <= 1) { score += 3; ev.push({ pts: 3, text: "La numeración vuelve a 1 (venía en el " + p.num + ")" }); }
        else { score += 2; ev.push({ pts: 2, text: "La numeración baja del " + p.num + " al " + c.num }); }
      }
      if (c.seasonHint && p.seasonHint && c.seasonHint !== p.seasonHint) { score += 3; ev.push({ pts: 3, text: "El comentario marca otra temporada (T" + p.seasonHint + " → T" + c.seasonHint + ")" }); }
      before = flat.slice(Math.max(0, i - 3), i).map(function (x) { return x.size; }).filter(Boolean);
      after = flat.slice(i, i + 3).map(function (x) { return x.size; }).filter(Boolean);
      if (before.length && after.length) {
        win = avg(after) / avg(before);
        if (win >= 1.6 || win <= 0.62) { score += 1; ev.push({ pts: 1, text: "Cambia el peso medio de los videos (" + Math.round(avg(before) / 1048576) + " MB → " + Math.round(avg(after) / 1048576) + " MB)" }); }
      }
      gap = c.date - p.date;
      if (gapMedian && gap > Math.max(6 * 3600 * 1000, 8 * gapMedian)) { score += 1; ev.push({ pts: 1, text: "Pausa larga entre las fechas de publicación" }); }
      if (score >= 2) { cuts.push({ at: i, score: score, certainty: score >= 3 ? "seguro" : "propuesto", evidence: ev }); }
    });

    /* el encabezado dice «N temporadas» y no se halló ningún corte: se propone partir en partes iguales */
    if (declaredSeasons > 1 && !cuts.length && flat.length >= declaredSeasons * 2) {
      for (var k = 1; k < declaredSeasons; k += 1) {
        cuts.push({ at: Math.round(k * flat.length / declaredSeasons), score: 1, certainty: "propuesto", evidence: [{ pts: 1, text: "El encabezado dice " + declaredSeasons + " temporadas y no hay otra pista: se reparten " + flat.length + " capítulos en partes iguales" }] });
      }
    }
    if (declaredSeasons > 1 && cuts.length + 1 < declaredSeasons && cuts.length) { notes.push("El encabezado dice " + declaredSeasons + " temporadas y se encontraron " + (cuts.length + 1) + "."); }

    segments = [];
    var start = 0;
    cuts.forEach(function (c) { segments.push({ from: start, to: c.at, cut: segments.length ? cuts[segments.length - 1] : null }); start = c.at; });
    segments.push({ from: start, to: flat.length, cut: cuts.length ? cuts[cuts.length - 1] : null });

    var prevMax = 0;
    segments.forEach(function (seg, n) {
      var chs = flat.slice(seg.from, seg.to);
      var hdr = chs.length ? chs[0].hdr : first;
      var nums = chs.map(function (c) { return c.num; }).filter(function (x) { return x != null; });
      var min = nums.length ? Math.min.apply(null, nums) : 1;
      var max = nums.length ? Math.max.apply(null, nums) : 0;
      var hints = chs.map(function (c) { return c.seasonHint; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var renumber = n > 0 && min > 1 && (!hints.length || min === prevMax + 1); // si el comentario trae el número de temporada, los capítulos ya van por temporada (salvo que sigan la cuenta de la anterior: 22 → 23)
      prevMax = max;
      var warnings = [];
      var seen = {};
      var dup = [];
      var missing = [];
      var last = 0;
      var j;
      var episodes = chs.map(function (c) {
        var num = c.num == null ? null : (renumber ? c.num - (min - 1) : c.num);
        if (num == null) { num = last + 1; warnings.push("«" + (c.text || c.fileName || c.id) + "» no trae número: se le puso el " + num); }
        last = num;
        if (seen[num]) { dup.push(num); }
        seen[num] = true;
        return { id: c.id, num: c.num, newNum: num, title: c.epTitle, size: c.size, duration: c.duration, date: c.date, text: c.text || "", fileName: c.fileName || "" };
      });
      for (j = 1; j <= episodes.reduce(function (mx, e) { return Math.max(mx, e.newNum); }, 0); j += 1) { if (!seen[j]) { missing.push(j); } }
      if (dup.length) { warnings.push("Capítulos repetidos: " + dup.filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ")); }
      if (missing.length) { warnings.push("Faltan los capítulos: " + (missing.length > 12 ? missing.slice(0, 12).join(", ") + "…" : missing.join(", "))); }
      if (renumber) { warnings.push("La numeración seguía de largo (" + min + " a " + max + "): se renumera desde 1."); }
      if (hdr.episodes && chs.length && hdr.episodes !== chs.length && segments.length === 1) { warnings.push("El encabezado declara " + hdr.episodes + " episodios y hay " + chs.length + "."); }
      seasons.push({
        n: hints.length === 1 && !seasons.some(function (x) { return x.n === hints[0]; }) ? hints[0] : n + 1, hint: hints.length === 1 ? hints[0] : 0, lang: hdr.lang, langLabel: hdr.langLabel, quality: hdr.quality, count: chs.length, firstId: chs.length ? chs[0].id : 0, lastId: chs.length ? chs[chs.length - 1].id : 0,
        cut: n ? (seg.cut || null) : null, renumbered: renumber, warnings: warnings, episodes: episodes,
        avgMB: Math.round(avg(episodes.map(function (e) { return e.size; }).filter(Boolean)) / 1048576), minutes: Math.round(avg(episodes.map(function (e) { return e.duration; }).filter(Boolean)) / 60)
      });
    });
    /* cada temporada guarda el corte que la abrió (el de antes), no el siguiente */
    seasons.forEach(function (se, n) { se.cut = n ? cuts[n - 1] : null; });

    var isMovie = first.type === "pelicula" || (!first.typeRaw && flat.length <= 3 && /\b(movie|film|pel[ií]cula)\b/i.test(first.title));
    if (isMovie) { seasons.forEach(function (se) { se.warnings = se.warnings.filter(function (w) { return !/no trae n/.test(w); }); }); }
    var warn = seasons.some(function (se) { return se.warnings.length; }) || notes.length || cuts.some(function (c) { return c.certainty === "propuesto"; });
    return {
      id: "s" + (si + 1), title: first.title, original: first.original, year: first.year, type: isMovie ? "pelicula" : first.type, typeRaw: first.typeRaw, genres: first.genres,
      declaredSeasons: declaredSeasons, declaredEpisodes: first.episodes, minutes: first.minutes,
      source: s.blocks[0].inline ? "comentario" : "encabezado",
      headers: s.blocks.map(function (b) { return { msgId: b.msgId, title: b.header.title, lang: b.header.langLabel || b.header.lang, quality: b.header.quality, chapters: b.chapters.length, matchScore: b.matchScore, photoW: b.header.photoW || 0, photoH: b.header.photoH || 0, hasPhoto: !!b.hasPhoto, inline: !!b.inline }; }),
      chapters: flat.length, seasons: seasons, notes: notes,
      status: !flat.length ? "sin capitulos" : warn ? "revisar" : "seguro"
    };
  }

  /* ===================== FASE 2 · emparejar con TMDB ===================== */
  function queriesFor(s) {
    var out = [];
    function add(q) { q = String(q || "").replace(/\s+/g, " ").trim(); if (q && out.indexOf(q) < 0) { out.push(q); } }
    add(s.original); add(s.title);
    [s.original, s.title].forEach(function (x) { var p = String(x || "").split(/\s*[:\-–—]\s*/)[0]; if (p && p.length > 3) { add(p); } });
    return out.slice(0, 4);
  }
  function candScore(s, r) {
    var ov = overlap(tokens({ title: s.title, original: s.original }), tokens({ title: r.title, original: r.original }));
    var sc = ov * 5;
    var d;
    if (s.year && r.year) { d = Math.abs(s.year - r.year); sc += d <= 1 ? 3 : d <= 3 ? 1 : -2; }
    sc += Math.min(r.pop || 0, 60) / 60;
    return Math.round(sc * 100) / 100;
  }
  /* Busca la ficha de una serie en TMDB. api = {buscar({media, q, year}) → {results}, ficha({media, id}) → ficha}. Deja s.match = {state, candidates, pick, ficha}. */
  async function matchOne(s, api) {
    var media = s.type === "pelicula" ? "movie" : "tv";
    var seen = {};
    var cands = [];
    var qs = queriesFor(s);
    var i;
    var res;
    for (i = 0; i < qs.length; i += 1) {
      try { res = await api.buscar({ media: media, q: qs[i], year: s.year }); } catch (e) { res = { results: [] }; }
      ((res && res.results) || []).forEach(function (r) { if (!seen[r.id]) { seen[r.id] = true; cands.push({ id: r.id, media: media, title: r.title, original: r.original, year: r.year, poster: r.poster, overview: r.overview, pop: r.pop, score: candScore(s, r) }); } });
      if (cands.length && cands.some(function (c) { return c.score >= 7; })) { break; } // ya hay uno claro: no se piden más búsquedas
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    cands = cands.slice(0, 6);
    s.match = { state: !cands.length ? "sin" : cands[0].score >= 6.5 ? "alta" : cands[0].score >= 4 ? "media" : "baja", candidates: cands, pick: cands.length ? cands[0].id : 0, media: media, ficha: null, error: "" };
    if (s.match.pick) { await pick(s, s.match.pick, api, true); }
    return s.match;
  }
  /* Elige otro candidato (o el primero) y trae su ficha: descripción, géneros, portada, banner y póster vertical. */
  /* El nombre de la serie en el grupo siempre va en español: el título que TMDB da en español (es-MX), salvo que TMDB no lo traduzca (queda el del canal)
   * o que el usuario ya lo haya escrito a mano (s.nameEdited). Un emparejado dudoso («baja») no cambia el nombre solo; si el usuario elige el candidato, sí. */
  function nameFromTmdb(s, auto) {
    var m = s.match;
    var f = m && m.ficha;
    var t = f ? plain(f.title) : "";
    if (s.nameEdited || !t) { return; }
    if (auto && m.state === "baja") { return; }
    if (f.original && norm(t) === norm(f.original) && norm(t) !== norm(s.title)) { return; } // sin traducción: el nombre del canal (probablemente en español) se queda
    s.name = t;
  }
  async function pick(s, id, api, auto) {
    var m = s.match;
    m.pick = Number(id) || 0;
    m.ficha = null; m.error = "";
    if (!m.pick) { return null; }
    try { m.ficha = await api.ficha({ media: m.media, id: m.pick }); } catch (e) { m.error = String((e && (e.message || e.text)) || e); }
    nameFromTmdb(s, !!auto);
    if (m.ficha && m.media === "tv" && api.temporada && m.ficha.seasons && m.ficha.seasons.length) { // título y descripción de cada capítulo
      m.ficha.eps = {};
      await Promise.all(m.ficha.seasons.map(function (se) {
        return api.temporada({ id: m.pick, season: se.n }).then(function (r) {
          var by = {};
          ((r && r.episodes) || []).forEach(function (e) { by[e.n] = { name: e.name || "", overview: e.overview || "", still: e.still || "" }; });
          m.ficha.eps[se.n] = by;
        }).catch(function () {});
      }));
    }
    return m.ficha;
  }
  async function matchAll(an, api, opts) {
    opts = opts || {};
    var i;
    for (i = 0; i < an.series.length; i += 1) {
      if (opts.signal && opts.signal.aborted) { throw new Error("Detenido"); }
      if (opts.onProgress) { opts.onProgress({ done: i, total: an.series.length, title: an.series[i].title }); }
      if (!an.series[i].match || opts.force) { await matchOne(an.series[i], api); }
    }
    if (opts.onProgress) { opts.onProgress({ done: an.series.length, total: an.series.length, title: "" }); }
    return an;
  }

  /* ===================== FASE 3 · copiar con el comentario de hoy ===================== */
  function plain(x) { return String(x == null ? "" : x).replace(/#/g, "").replace(/\s+/g, " ").trim(); }
  function nameOf(s) { return plain(s.name || s.title); }
  function descOf(s) { var f = s.match && s.match.ficha; return plain((f && f.overview) || ""); }
  function tagsOf(s, opts) {
    var cat = plain(opts.category == null ? "Anime" : opts.category).replace(/\s+/g, "_");
    return (cat ? " #" + cat : "") + (s.match && s.match.pick ? " #tmdb" + (s.type === "pelicula" ? "" : "tv") + s.match.pick : "");
  }
  /* Datos de un capítulo según TMDB: solo si la serie está emparejada con confianza y las temporadas del canal siguen a las de TMDB
   * (no si se partieron a mano o en partes iguales, ni si el canal tiene más o muchos menos capítulos que TMDB en esa temporada). */
  function epInfo(s, se, e) {
    var m = s.match;
    var f = m && m.ficha;
    var ts;
    var tm;
    if (!f || !f.eps || m.state === "baja" || m.state === "sin") { return null; }
    if (s.split && s.split.how !== "Según TMDB") { return null; }
    ts = (f.seasons || []).filter(function (x) { return x.n === se.n; })[0];
    tm = f.eps[se.n] && f.eps[se.n][e.newNum];
    if (!ts || !tm || Math.abs(ts.episodes - se.count) > Math.max(2, Math.round(ts.episodes * 0.25))) { return null; }
    return tm;
  }
  /* Telegram no deja comentarios de más de 1024 caracteres (MEDIA_CAPTION_TOO_LONG): si se pasa, se acorta la descripción (lo último que importa) y se conserva el resto */
  function captionOf(s, kind, o, opts) {
    var full = captionBuild(s, kind, o, opts, null);
    var desc;
    var over = full.length - 1000;
    if (over <= 0) { return full; }
    desc = descOf(s);
    if (kind === "episode" && o && o.info && o.info.overview) { desc = plain(o.info.overview); }
    return captionBuild(s, kind, o, opts, desc.length > over + 1 ? desc.slice(0, desc.length - over - 1).replace(/\s+\S*$/, "") + "…" : "");
  }
  function captionBuild(s, kind, o, opts, descOver) {
    var name = nameOf(s);
    var desc = descOf(s);
    if (kind === "episode" && o && o.info) {
      if (o.info.overview) { desc = plain(o.info.overview); }
      if (o.info.name) { o = { season: o.season, num: o.num, title: o.info.name }; }
    }
    if (descOver !== null && descOver !== undefined) { desc = descOver; }
    if (kind === "episode") {
      if (s.type === "pelicula") { return "pelicula#" + name + (s.year ? " (" + s.year + ")" : "") + (desc ? "#" + desc : "") + tagsOf(s, opts); }
      return "serie(" + o.season + "/" + o.num + ")#" + name + (o.title && desc ? "#" + plain(o.title) + "#" + desc : desc ? "#" + desc : "") + tagsOf(s, opts);
    }
    /* la portada lleva la descripción: así la serie o película la muestra en su ficha (formato «ficha con portada»); el banner y la vertical, solo el nombre */
    return (s.type === "pelicula" ? "pelicula#" + name + (s.year ? " (" + s.year + ")" : "") : "serie#" + name) + (kind === "portada" && desc ? "#" + desc : "") + " #" + kind;
  }

  /* Qué se copia, por serie: imágenes primero (vertical del encabezado, portada y banner de TMDB) y luego los capítulos por temporada.
   * opts: {only: {sid: true}, maxEpisodes: N por temporada (prueba), category} */
  function planCopy(an, opts) {
    opts = opts || {};
    var groups = [];
    var total = 0;
    an.series.forEach(function (s) {
      var items = [];
      var h0 = s.headers[0];
      var f = s.match && s.match.ficha;
      var vert = h0 && h0.photoH && h0.photoH >= h0.photoW * 1.2;
      if (opts.only && !opts.only[s.id]) { return; }
      if (h0 && h0.msgId && h0.hasPhoto) { items.push({ key: s.id + ":hdr", type: "copy", msgId: h0.msgId, label: "Encabezado como " + (vert ? "vertical" : "portada"), caption: captionOf(s, vert ? "vertical" : "portada", null, opts) }); }
      if (f && f.poster && !(h0 && h0.hasPhoto && h0.photoH && !vert)) { items.push({ key: s.id + ":portada", type: "tmdb", kind: "portada", url: f.poster.url, label: "Portada de TMDB", caption: captionOf(s, "portada", null, opts) }); }
      if (f && f.backdrop) { items.push({ key: s.id + ":banner", type: "tmdb", kind: "banner", url: f.backdrop.url, label: "Banner de TMDB", caption: captionOf(s, "banner", null, opts) }); }
      if (f && f.vertical && !vert) { items.push({ key: s.id + ":vertical", type: "tmdb", kind: "vertical", url: f.vertical.url, label: "Vertical de TMDB", caption: captionOf(s, "vertical", null, opts) }); }
      /* imagen COMÚN de los capítulos (la horizontal de la serie): la usan todos los que no tengan la suya (#capitulo sin números) */
      if (f && s.type !== "pelicula" && (f.backdrop || f.poster)) { items.push({ key: s.id + ":cap-comun", type: "tmdb", kind: "capitulo", url: (f.backdrop || f.poster).url, label: "Imagen común de los capítulos", caption: captionOf(s, "capitulo", null, opts) }); }
      s.seasons.forEach(function (se) {
        se.episodes.slice(0, opts.maxEpisodes || 100000).forEach(function (e) {
          var info = epInfo(s, se, e);
          if (info && info.still) { items.push({ key: s.id + ":still:" + e.id, type: "tmdb", kind: "capitulo", url: info.still, label: "Imagen de T" + se.n + ":E" + e.newNum, caption: "serie(" + se.n + "/" + e.newNum + ")#" + nameOf(s) + " #capitulo" }); } // la de ese capítulo manda sobre la común
          items.push({ key: s.id + ":e:" + e.id, type: "copy", msgId: e.id, label: "T" + se.n + ":E" + e.newNum, caption: captionOf(s, "episode", { season: se.n, num: e.newNum, title: e.title, info: epInfo(s, se, e) }, opts) });
        });
      });
      groups.push({ sid: s.id, name: nameOf(s), items: items });
      total += items.length;
    });
    return { groups: groups, total: total };
  }

  function floodSecs(e) {
    var m = /FLOOD_WAIT_(\d+)|wait of (\d+) seconds/i.exec(String((e && (e.text || e.message)) || e));
    return m ? Number(m[1] || m[2]) : (e && e.seconds ? Number(e.seconds) : 0);
  }
  async function sendWithWait(fn, o, label) {
    for (var n = 0; ; n += 1) {
      try { return await fn(); } catch (e) {
        var w = floodSecs(e);
        if (!w || n >= 6) { throw e; }
        if (o.onProgress) { o.onProgress({ step: "espera", wait: w + 1, title: label }); }
        await sleep((w + 1) * 1000);
      }
    }
  }

  /* o: {client, from (id del canal antiguo), to (chat del grupo con temas), analysis, state, save, signal, onProgress, api: {imagen({url, kind}) → {id}, bytes(id) → Uint8Array},
   *     category, only, maxEpisodes, pause (ms entre mensajes)} · state: {sent: {clave: true}}; lo ya enviado se salta, así se reanuda */
  async function copyAll(o) {
    var plan = planCopy(o.analysis, o);
    var st = o.state || (o.state = { sent: {} });
    var done = 0;
    var pause = o.pause == null ? 1100 : o.pause;
    var gi;
    var ii;
    var it;
    var g;
    var bytes;
    var info;
    var tries;
    st.sent = st.sent || {};
    /* los fallos anteriores (imágenes omitidas) se vuelven a intentar: la lista de errores se rehace y solo conserva los que siguen fallando */
    st.errors = [];
    plan.groups.forEach(function (gr) { gr.items.forEach(function (x) { if (st.sent[x.key] && st.sent[x.key] !== "omitida") { done += 1; } }); });
    function report(extra) { if (o.onProgress) { o.onProgress(Object.assign({ done: done, total: plan.total, step: "copiando" }, extra || {})); } }
    report({});
    for (gi = 0; gi < plan.groups.length; gi += 1) {
      g = plan.groups[gi];
      for (ii = 0; ii < g.items.length; ii += 1) {
        it = g.items[ii];
        if (st.sent[it.key] && st.sent[it.key] !== "omitida") { continue; } // las omitidas se reintentan al continuar
        if (o.signal && o.signal.aborted) { throw new Error("Detenido"); }
        report({ title: g.name, label: it.label });
        if (it.type === "copy") {
          await sendWithWait(function () { return o.client.sendCopy({ fromChatId: o.from, toChatId: o.to, message: it.msgId, caption: it.caption }); }, o, g.name);
        } else {
          try {
            for (tries = 0; ; tries += 1) { // reintenta (hasta 3 veces): un corte momentáneo del preparador no debe dejar el capítulo sin imagen
              try {
                info = await o.api.imagen({ url: it.url, kind: it.kind });
                bytes = await o.api.bytes(info.id);
                break;
              } catch (e2) {
                /* «Failed to fetch» = el preparador no contestó (se reinició o se cerró un momento): espera a que vuelva (hasta ~2 min) en vez de dar la imagen por perdida */
                var caido = /failed to fetch|networkerror|load failed/i.test(String((e2 && (e2.message || e2.text)) || e2));
                if (tries >= (caido ? 14 : 2)) { throw e2; }
                if (caido) { report({ title: g.name, label: "Esperando al preparador…" }); }
                if (o.signal && o.signal.aborted) { throw new Error("Detenido"); }
                await sleep(caido ? Math.min(2000 + tries * 1500, 12000) : 1500);
              }
            }
          } catch (e) {
            st.sent[it.key] = "omitida"; // la imagen de TMDB no se pudo bajar: se sigue con lo demás (se puede agregar luego en «Imágenes por revisar»)
            st.errors = (st.errors || []).concat([g.name + " · " + it.label + ": " + String((e && (e.message || e.text)) || e)]);
            done += 1; if (o.save) { o.save(st); }
            continue;
          }
          await sendWithWait(function () { return o.client.sendMedia(o.to, { type: "photo", file: bytes, fileName: it.kind + ".jpg", caption: it.caption }); }, o, g.name);
        }
        st.sent[it.key] = true;
        done += 1;
        if (o.save) { o.save(st); }
        report({ title: g.name, label: it.label });
        if (pause) { await sleep(pause); }
      }
    }
    report({ step: "listo" });
    return { done: done, total: plan.total, errors: st.errors || [] };
  }

  /* ===================== Partir en temporadas una numeración continua (1…128) ===================== */
  /* Dónde empieza cada temporada según TMDB (las temporadas de la ficha, con sus episodios), p. ej. 26,26,26,26,24 → 1,27,53,79,105 */
  function tmdbStarts(ficha) {
    var cs = ficha && ficha.seasons;
    var out = [];
    var acc = 0;
    if (!cs || cs.length < 2) { return null; }
    cs.forEach(function (x) { out.push(acc + 1); acc += x.episodes; });
    return out;
  }
  function equalStarts(total, n) {
    var per = Math.ceil(total / Math.max(1, n));
    var out = [];
    var i;
    for (i = 0; i < n; i += 1) { if (i * per + 1 <= total) { out.push(i * per + 1); } }
    return out;
  }
  /* «1, 33, 65 y 97» → [1, 33, 65, 97] (siempre empieza en 1) */
  function parseStarts(text) {
    var n = (String(text || "").match(/\d+/g) || []).map(Number).filter(function (x) { return x > 0; });
    var out = n.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
    if (out.length && out[0] !== 1) { out.unshift(1); }
    return out;
  }
  function maxNum(s) {
    var mx = 0;
    var abs = [];
    var seasons = s._orig ? s._orig.seasons : s.seasons;
    seasons.forEach(function (se) { se.episodes.forEach(function (e) { abs.push(e.num); mx = Math.max(mx, e.num != null ? e.num : e.newNum); }); });
    // si el canal no numera todo seguido (cada temporada vuelve a 1, o hay capítulos sin número) se cuenta por posición, igual que al partir
    if (!abs.every(function (v, i) { return v != null && (i === 0 || v > abs[i - 1]); })) { mx = abs.length; }
    return mx;
  }
  /* Vuelve a repartir los capítulos de una serie en temporadas que empiezan en los capítulos «starts» (numeración continua del canal).
   * how: de dónde sale el corte (texto para mostrar); expected: capítulos que debería tener cada temporada (TMDB) para avisar si falta alguno. */
  function resplit(s, starts, how, expected) {
    var flat = [];
    var abs;
    var seasons = [];
    var k;
    if (!s._orig) { s._orig = { seasons: s.seasons, notes: s.notes, status: s.status }; }
    s._orig.seasons.forEach(function (se) { se.episodes.forEach(function (e) { flat.push({ e: e, lang: se.lang, langLabel: se.langLabel, quality: se.quality }); }); });
    abs = flat.map(function (x) { return x.e.num; });
    if (!abs.every(function (v, i) { return v != null && (i === 0 || v > abs[i - 1]); })) { abs = flat.map(function (x, i) { return i + 1; }); } // sin numeración continua: se usa la posición
    starts = (starts && starts.length ? starts : [1]).slice();
    for (k = 0; k < starts.length; k += 1) {
      (function (kk) {
        var lo = starts[kk];
        var hi = kk + 1 < starts.length ? starts[kk + 1] - 1 : Infinity;
        var part = flat.filter(function (x, i) { return abs[i] >= lo && abs[i] <= hi; });
        var warnings = [];
        var seen = {};
        var dup = [];
        var miss = [];
        var eps;
        var mx;
        var j;
        var n;
        if (!part.length) { return; }
        n = seasons.length + 1;
        eps = part.map(function (x) {
          var i = flat.indexOf(x);
          var num = abs[i] - lo + 1;
          if (seen[num]) { dup.push(num); }
          seen[num] = true;
          return { id: x.e.id, num: x.e.num, newNum: num, title: x.e.title, size: x.e.size, duration: x.e.duration, date: x.e.date };
        });
        mx = eps.reduce(function (m, e) { return Math.max(m, e.newNum); }, 0);
        for (j = 1; j <= mx; j += 1) { if (!seen[j]) { miss.push(j); } }
        if (miss.length) { warnings.push("Faltan los capítulos: " + (miss.length > 12 ? miss.slice(0, 12).join(", ") + "…" : miss.join(", ")) + " (del " + (lo + miss[0] - 1) + " del canal" + (miss.length > 1 ? ", …" : "") + ")"); }
        if (dup.length) { warnings.push("Capítulos repetidos: " + dup.join(", ")); }
        if (expected && expected[kk] && expected[kk] !== eps.length) { warnings.push("TMDB dice que esta temporada tiene " + expected[kk] + " capítulos y hay " + eps.length + "."); }
        if (lo > 1) { warnings.push("Los capítulos del canal " + lo + "–" + (hi === Infinity ? abs[abs.length - 1] : hi) + " pasan a ser el 1–" + mx + " de esta temporada."); }
        seasons.push({
          n: n, hint: 0, lang: part[0].lang, langLabel: part[0].langLabel, quality: part[0].quality, count: eps.length, firstId: eps[0].id, lastId: eps[eps.length - 1].id,
          cut: n > 1 ? { at: 0, score: 0, certainty: "manual", evidence: [{ pts: 0, text: how + ": la temporada " + n + " empieza en el capítulo " + lo + " del canal" }] } : null,
          renumbered: lo > 1, warnings: warnings, episodes: eps,
          avgMB: Math.round(avg(eps.map(function (e) { return e.size; }).filter(Boolean)) / 1048576), minutes: Math.round(avg(eps.map(function (e) { return e.duration; }).filter(Boolean)) / 60)
        });
      })(k);
    }
    s.seasons = seasons;
    s.split = { how: how, starts: starts };
    s.notes = [];
    s.status = seasons.some(function (se) { return se.warnings.some(function (w) { return !/^Los capítulos del canal/.test(w); }); }) ? "revisar" : "seguro";
    return s;
  }
  function restoreSeasons(s) {
    if (!s._orig) { return s; }
    s.seasons = s._orig.seasons; s.notes = s._orig.notes; s.status = s._orig.status;
    delete s.split; delete s._orig;
    return s;
  }

  /* ===================== Informe para descargar (solo texto) ===================== */
  function report(a) {
    return {
      generado: new Date().toISOString(), version: 1, stats: a.stats,
      series: a.series.map(function (s) {
        return {
          titulo: s.title, original: s.original, anio: s.year, tipo: s.typeRaw || s.type, generos: s.genres, temporadasDeclaradas: s.declaredSeasons, episodiosDeclarados: s.declaredEpisodes,
          estado: s.status, fuente: s.source, avisos: s.notes,
          encabezados: s.headers,
          temporadas: s.seasons.map(function (se) {
            return {
              numero: se.n, idioma: se.langLabel || se.lang, calidad: se.quality, capitulos: se.count, desdeMensaje: se.firstId, hastaMensaje: se.lastId, renumerada: se.renumbered, avisos: se.warnings,
              corte: se.cut ? { certeza: se.cut.certainty, puntos: se.cut.score, pruebas: se.cut.evidence.map(function (e) { return (e.pts > 0 ? "+" : "") + e.pts + " " + e.text; }) } : null,
              numeros: se.episodes.map(function (e) { return e.num + (e.num !== e.newNum ? "→" + e.newNum : ""); }).join(",")
            };
          })
        };
      }),
      sueltos: { videosSinEncabezado: a.loose.videosSinEncabezado.slice(0, 50), fotosSinDatos: a.loose.fotosSinDatos, fotos: (a.loose.fotos || []).slice(0, 30), fotosAsignadas: a.loose.fotosAsignadas || 0 }
    };
  }

  return { read: read, analyze: analyze, report: report, parseHeader: parseHeader, parseEpisode: parseEpisode, sameScore: sameScore, langInfo: langInfo,
    match: matchOne, matchAll: matchAll, pick: pick, planCopy: planCopy, copyAll: copyAll, captionOf: captionOf,
    parseInline: parseInline, tmdbStarts: tmdbStarts, equalStarts: equalStarts, parseStarts: parseStarts, maxNum: maxNum, resplit: resplit, restoreSeasons: restoreSeasons };
})();
