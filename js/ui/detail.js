/* HomeFlix · fichas (película, serie, video sin clasificar) y editor de etiquetas. */

var detail = { title: null, season: 0, back: null, seasonTimer: null };

function openDetail(title, opts) {
  var a = currentArea();
  var from = currentRoute;
  var fromArea = a ? a.name : null;
  var fromIndex = state.itemIndex;
  opts = opts || {};
  if (!title) {
    return;
  }
  if (currentRoute !== "detail" && currentRoute !== "player" && currentRoute !== "tag-edit") {
    detail.back = function () {
      if (from === "search") {
        showRoute("search");
        renderSearchResults(fromArea, fromIndex);
      } else {
        showRoute("browse");
        renderBrowse(fromArea, fromIndex);
      }
    };
  }
  detail.title = title;
  detail.season = 0;
  if (title.type === "series") {
    detail.season = seasonIndexFor(title, opts.episodeKey || (HFLibrary.nextEpisode(title).episode || {}).key);
  }
  showRoute("detail");
  renderDetail(opts.focus || (opts.episodeKey ? "episodes" : "actions"), opts.episodeKey ? episodeIndexFor(title, opts.episodeKey) : 0);
}

function closeDetail() {
  if (detail.back) {
    detail.back();
  } else {
    openBrowse(browse.section);
  }
}

function seasonIndexFor(series, episodeKey) {
  var i;
  var j;
  for (i = 0; i < series.seasons.length; i += 1) {
    for (j = 0; j < series.seasons[i].episodes.length; j += 1) {
      if (series.seasons[i].episodes[j].key === episodeKey) {
        return i;
      }
    }
  }
  return 0;
}

function episodeIndexFor(series, episodeKey) {
  var season = series.seasons[seasonIndexFor(series, episodeKey)];
  var i;
  for (i = 0; season && i < season.episodes.length; i += 1) {
    if (season.episodes[i].key === episodeKey) {
      return i;
    }
  }
  return 0;
}

function dtButton(action, icon, label, primary, desc) {
  return '<span class="hf2-btn ' + (primary ? "primary" : "ghost") + ' small icon" data-focusable="true" data-action="' + action + '" data-title="' + esc(label) + '" data-description="' + esc(desc || label) + '" tabindex="0">' + icon + esc(label) + "</span>";
}

function sourceLine(t) {
  var chat = t.video ? t.video.chatTitle : (t.seasons && t.seasons[0] && t.seasons[0].episodes[0] ? t.seasons[0].episodes[0].video.chatTitle : "");
  return chat ? '<div class="hf2-dt-source">' + IC.chat + "De <b>" + esc(chat) + "</b></div>" : "";
}

function episodeCardHtml(ep) {
  var p = HFLibrary.progress(ep.key);
  var prog = progressInfo(ep.key);
  return '<div class="hf2-ep" data-focusable="true" data-ref="v:' + esc(ep.key) + '" data-title="' + esc(ep.title) + '" data-description="T' + ep.season + ":E" + ep.episode + " · " + esc(ep.title) + (p && p.done ? " · visto" : "") + (prog ? " · " + prog.left : "") + '" tabindex="0">' +
    '<div class="hf2-ep-art hf2-img" data-img="' + esc(ep.key) + '" data-img-w="480">' + fallbackArt(ep.key, "ep") + '<span class="hf2-ep-num">' + ep.episode + "</span>" +
      (p && p.done ? '<span class="hf2-ep-done">' + IC.check + "Visto</span>" : "") +
      (prog ? '<span class="hf2-card-progress"><i style="width:' + prog.pct + '%"></i></span>' : "") +
      '<span class="hf2-ep-play">' + IC.play + "</span></div>" +
    '<div class="hf2-ep-title"><b>' + esc(ep.title) + "</b><span>" + esc(HFLibrary.formatDuration(ep.video.duration)) + "</span></div>" +
    '<div class="hf2-ep-desc">' + esc(ep.description || "") + "</div></div>";
}

function renderDetail(focusName, focusIndex) {
  var root = byId("scrDetail");
  var t = detail.title;
  var kids = currentProfileIsKids();
  var html = "";
  var buttons = "";
  var p;
  var prog;
  var next;
  var inList;
  var defs = [];
  var art = t.type === "video" ? t.key : t.imageKey;

  root.className = "screen hf2 cat dt";
  html += '<div class="hf2-dt-art hf2-img' + (t.type === "video" ? " muted" : "") + '"' + (art ? ' data-img="' + esc(art) + '" data-img-w="1280"' : "") + ">" + fallbackArt(art || t.name, "dt") + "</div>" +
    '<div class="hf2-dt-shade"></div>' + brandHtml("small dt") + '<div class="hf2-back">' + IC.back + "Volver</div>";

  if (t.type === "movie" || t.type === "video") {
    p = HFLibrary.progress(entryVideoKey(t));
    prog = progressInfo(entryVideoKey(t));
  }

  if (t.type === "movie") {
    if (prog) {
      buttons += dtButton("play", IC.play, "Reanudar desde " + HFLibrary.formatClock(p.t), true) + dtButton("restart", IC.restart, "Desde el inicio");
    } else {
      buttons += dtButton("play", IC.play, p && p.done ? "Ver otra vez" : "Reproducir", true);
    }
    inList = HFLibrary.inMyList(t.titleKey);
    buttons += dtButton("mylist", inList ? IC.check : IC.plus, inList ? "En mi lista" : "Mi lista", false, inList ? "Quitar de Mi lista" : "Guardar en Mi lista");
    if (!kids) {
      buttons += dtButton("tag", IC.pencil, "Editar", false, "Cambiar nombre, año, descripción o si es infantil");
    }
    html += '<div class="hf2-dt-copy"><div class="hf2-bb-badges"><span class="hf2-chip gold">Película</span>' + (t.kids ? '<span class="hf2-chip kids">' + IC.star + "Infantil</span>" : "") + "</div>" +
      "<h1>" + esc(t.name) + '</h1><div class="hf2-bb-meta">' + (t.year ? "<b>" + t.year + "</b>" : "") + (t.video.duration ? "<span>" + HFLibrary.formatDuration(t.video.duration) + "</span>" : "") +
      (t.quality ? '<span class="hf2-q">' + t.quality + "</span>" : "") + (t.video.size ? "<span>" + HFLibrary.formatSize(t.video.size) + "</span>" : "") + "</div>" + sourceLine(t) +
      (prog ? '<div class="hf2-dt-progress"><span class="bar"><i style="width:' + prog.pct + '%"></i></span><span>Viste ' + HFLibrary.formatDuration(p.t) + " · " + prog.left.toLowerCase() + "</span></div>" : "") +
      (t.description ? "<p>" + esc(t.description) + "</p>" : "") +
      '<div class="hf2-bb-actions">' + buttons + "</div></div>";
    var others = library.movies.filter(function (m) { return m !== t && m.video.chatTitle === t.video.chatTitle; }).slice(0, 12);
    if (others.length < 4) {
      others = library.movies.filter(function (m) { return m !== t; }).slice(0, 12);
    }
    if (others.length) {
      html += '<div class="hf2-dt-more">' + rowHtml("more", others.length && others[0].video.chatTitle === t.video.chatTitle ? "También de " + t.video.chatTitle : "Más películas", others, { note: String(others.length) }) + "</div>";
    }
  } else if (t.type === "series") {
    next = HFLibrary.nextEpisode(t);
    if (next.episode) {
      if (next.started && next.resume > 0) {
        buttons += dtButton("play-next", IC.play, "Continuar T" + next.episode.season + ":E" + next.episode.episode, true, "Seguir con " + next.episode.title);
      } else if (next.finished) {
        buttons += dtButton("play-first", IC.restart, "Ver desde T1:E1", true, "Volver a empezar la serie");
      } else {
        buttons += dtButton("play-next", IC.play, "Ver T" + next.episode.season + ":E" + next.episode.episode, true, next.episode.title);
      }
      if (next.started && !next.finished) {
        buttons += dtButton("play-first", IC.restart, "Desde T1:E1");
      }
    }
    inList = HFLibrary.inMyList(t.titleKey);
    buttons += dtButton("mylist", inList ? IC.check : IC.plus, inList ? "En mi lista" : "Mi lista", false, inList ? "Quitar de Mi lista" : "Guardar en Mi lista");
    var season = t.seasons[detail.season] || t.seasons[0];
    var watched = season.episodes.filter(function (ep) { var x = HFLibrary.progress(ep.key); return x && x.done; }).length;
    html += '<div class="hf2-dt-copy"><div class="hf2-bb-badges"><span class="hf2-chip gold">Serie</span>' + (t.kids ? '<span class="hf2-chip kids">' + IC.star + "Infantil</span>" : "") + "</div>" +
      "<h1>" + esc(t.name) + '</h1><div class="hf2-bb-meta"><b>' + t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas") + "</b><span>" + t.episodeCount + " capítulos</span></div>" +
      '<div class="hf2-dt-full">' + sourceLine(t) + (t.description ? "<p>" + esc(t.description) + "</p>" : "") + '<div class="hf2-bb-actions">' + buttons + "</div></div></div>" +
      '<div class="hf2-dt-episodes"><div class="hf2-seasons">' + t.seasons.map(function (s, i) {
        return '<span class="hf2-pill' + (i === detail.season ? " on" : "") + '" data-focusable="true" data-season="' + i + '" data-title="Temporada ' + s.number + '" data-description="Temporada ' + s.number + " · " + s.episodes.length + ' capítulos" tabindex="0">Temporada ' + s.number + " <b>" + s.episodes.length + "</b></span>";
      }).join("") + '<span class="hf2-seasons-note">Viste ' + watched + " de " + season.episodes.length + " capítulos</span></div>" +
      '<div class="hf2-ep-viewport"><div class="hf2-ep-track" id="episodeTrack">' + season.episodes.map(episodeCardHtml).join("") + "</div></div></div>";
  } else {
    buttons = dtButton("tag", IC.tag, "Etiquetar", true, "Decir si es película o capítulo, sin tocar Telegram") +
      dtButton("play", IC.play, "Reproducir") + dtButton("guide", IC.help, "Cómo etiquetar");
    html += '<div class="hf2-dt-copy"><div class="hf2-bb-badges"><span class="hf2-chip warn">Sin clasificar</span></div><h1 class="smaller">' + esc(t.name) + "</h1>" +
      '<div class="hf2-bb-meta">' + (t.video.duration ? "<span>" + HFLibrary.formatDuration(t.video.duration) + "</span>" : "") + (t.quality ? '<span class="hf2-q">' + t.quality + "</span>" : "") + (t.video.size ? "<span>" + HFLibrary.formatSize(t.video.size) + "</span>" : "") + "</div>" +
      sourceLine(t) +
      '<div class="hf2-unclassified"><b>Este video todavía no dice qué es</b><p>Por eso no aparece en Películas ni en Series. Etiquétalo para darle nombre y ordenarlo.</p>' +
      (t.description ? '<div class="hf2-current-caption"><span>Comentario en Telegram</span><q>' + esc(t.description.slice(0, 120)) + "</q></div>" : '<div class="hf2-current-caption"><span>Comentario en Telegram</span><q>(vacío)</q></div>') + "</div>" +
      '<div class="hf2-bb-actions">' + (kids ? dtButton("play", IC.play, "Reproducir", true) : buttons) + "</div></div>";
  }
  root.innerHTML = html;

  defs.push({ name: "actions", items: root.querySelectorAll(".hf2-dt-copy .hf2-bb-actions [data-focusable]"), dir: "h", onFocus: function () { setDetailScrolled(false); } });
  if (t.type === "series") {
    defs.push({ name: "seasons", items: root.querySelectorAll(".hf2-seasons [data-focusable]"), dir: "h", onFocus: onSeasonFocus });
    defs.push({ name: "episodes", items: root.querySelectorAll(".hf2-ep"), dir: "h", track: byId("episodeTrack"), onFocus: function () { setDetailScrolled(true); } });
  }
  defs = defs.concat(rowAreas(root, null));
  setAreas(defs, focusName || "actions", focusIndex || 0);
  observeImages(root);
  updateStatus(t.name + " · " + titleMeta(t));
}

/* En la serie, al bajar a temporadas/capítulos la cabecera se reduce y los capítulos suben. */
function setDetailScrolled(on) {
  var root = byId("scrDetail");
  var has = root.className.indexOf(" scrolled") >= 0;
  if (!detail.title || detail.title.type !== "series" || has === on) {
    return;
  }
  root.className = "screen hf2 cat dt" + (on ? " scrolled" : "");
  measureAreas();
  updateFocus();
}

function onSeasonFocus(el, index) {
  setDetailScrolled(true);
  if (detail.seasonTimer) {
    clearTimeout(detail.seasonTimer);
  }
  if (index === detail.season) {
    return;
  }
  detail.seasonTimer = setTimeout(function () {
    detail.seasonTimer = null;
    if (currentRoute === "detail" && currentArea() && currentArea().name === "seasons") {
      detail.season = index;
      renderDetail("seasons", index);
      setDetailScrolled(true);
    }
  }, 300);
}

function handleDetailSelect(el) {
  var t = detail.title;
  var action = el.getAttribute("data-action");
  var seasonIdx = el.getAttribute("data-season");
  var entry;
  var next;
  var p;
  var added;
  if (seasonIdx !== null) {
    detail.season = Number(seasonIdx);
    renderDetail("episodes", 0);
    setDetailScrolled(true);
    return;
  }
  if (action === "play") {
    p = HFLibrary.progress(entryVideoKey(t));
    openPlayer(t, p && !p.done ? p.t : 0, null);
  } else if (action === "restart") {
    openPlayer(t, 0, null);
  } else if (action === "play-next") {
    next = HFLibrary.nextEpisode(t);
    openPlayer(next.episode, next.resume || 0, t);
  } else if (action === "play-first") {
    openPlayer(t.seasons[0].episodes[0], 0, t);
  } else if (action === "mylist") {
    added = HFLibrary.toggleMyList(t.titleKey);
    el.innerHTML = (added ? IC.check : IC.plus) + (added ? "En mi lista" : "Mi lista");
    el._hfDescription = added ? "Quitar de Mi lista" : "Guardar en Mi lista";
    updateStatus(added ? "Agregada a Mi lista" : "Quitada de Mi lista");
  } else if (action === "tag") {
    openTagEditor(t, function () { openDetail(t); });
  } else if (action === "guide") {
    openGuide(function () { showRoute("detail"); renderDetail("actions", 2); });
  } else if (el.getAttribute("data-ref")) {
    entry = entryFromRef(el.getAttribute("data-ref"));
    if (!entry) {
      return;
    }
    if (entry.type === "episode") {
      p = HFLibrary.progress(entry.key);
      openPlayer(entry, p && !p.done ? p.t : 0, t);
    } else {
      openDetail(entry);
    }
  }
}

/* ===================== Etiquetar desde la TV ===================== */

var tagEdit = { key: "", f: null, tagged: false, raw: null, seriesNames: [], back: null, newSeries: false };

function openTagEditor(entry, back) {
  var raw = entry.video || entry;
  var f;
  tagEdit.key = raw.key;
  tagEdit.raw = raw;
  tagEdit.tagged = Object.prototype.hasOwnProperty.call(HFLibrary.tags(), raw.key);
  tagEdit.back = back || null;
  tagEdit.seriesNames = fullLibrary.series.map(function (s) { return s.name; });
  if (entry.type === "movie") {
    f = { type: "movie", name: entry.name, year: entry.year || 0, description: entry.description || "", kids: !!entry.kids };
  } else if (entry.type === "episode") {
    f = { type: "series", name: entry.seriesName, season: entry.season, episode: entry.episode,
      episodeTitle: /^Capítulo \d+$/.test(entry.title) ? "" : entry.title, description: entry.description || "", kids: !!entry.kids };
  } else {
    f = { type: "movie", name: entry.name || "", year: 0, description: "", kids: false };
  }
  f.season = f.season || 1;
  f.episode = f.episode || 1;
  f.episodeTitle = f.episodeTitle || "";
  tagEdit.f = f;
  tagEdit.newSeries = f.type === "series" && tagEdit.seriesNames.indexOf(f.name) < 0;
  showRoute("tag-edit");
  renderTagEditor("type", f.type === "movie" ? 0 : 1);
  updateStatus("◀ ▶ cambian las opciones · OK escribe en los campos de texto");
}

function nextFreeEpisode(name, season) {
  var max = 0;
  fullLibrary.series.forEach(function (s) {
    if (s.name.toLowerCase() !== String(name).toLowerCase()) {
      return;
    }
    s.seasons.forEach(function (se) {
      if (se.number === season) {
        se.episodes.forEach(function (ep) {
          if (ep.episode > max && ep.key !== tagEdit.key) {
            max = ep.episode;
          }
        });
      }
    });
  });
  return max + 1;
}

function tagInput(id, label, value, placeholder) {
  return '<div class="hf2-frow" data-focusable="true" data-input="' + id + '" data-title="' + esc(label) + '" data-description="OK para escribir" tabindex="0"><label>' + esc(label) + '</label><div class="hf2-input"><input id="' + id + '" type="text" autocomplete="off" spellcheck="false" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"/></div></div>';
}

function tagStepper(what, label, value, extra) {
  return '<div class="hf2-frow" data-focusable="true" data-adjust="' + what + '" data-title="' + esc(label) + '" data-description="◀ ▶ para cambiar" tabindex="0"><label>' + esc(label) + '</label><div class="hf2-stepper"><i>' + IC.minus + "</i><b>" + esc(value) + "</b><i>" + IC.plus + "</i>" + (extra ? "<small>" + esc(extra) + "</small>" : "") + "</div></div>";
}

function tagToggle(label, on, text) {
  return '<div class="hf2-frow" data-focusable="true" data-adjust="kids" data-title="Infantil" data-description="OK o ◀ ▶: si es contenido para niños" tabindex="0"><label>' + esc(label) + '</label><div class="hf2-toggle-row"><span class="hf2-toggle' + (on ? " on" : "") + '"><i></i></span><span>' + esc(text) + "</span></div></div>";
}

function renderTagEditor(focusName, focusIndex) {
  var root = byId("scrTagEdit");
  var f = tagEdit.f;
  var raw = tagEdit.raw;
  var names = tagEdit.seriesNames;
  var seriesIdx = names.indexOf(f.name);
  var previewTitle = f.name || (f.type === "movie" ? "Película sin nombre" : "Serie sin nombre");
  var previewSub = f.type === "movie" ? (f.year ? f.year + " · " : "") + "Película" : "T" + f.season + ":E" + f.episode + (f.episodeTitle ? " · " + f.episodeTitle : "");
  var top = "";
  var split = "";
  var bottom = "";
  if (f.type === "series") {
    top += '<div class="hf2-frow" data-focusable="true" data-adjust="series" data-title="Serie" data-description="◀ ▶ para elegir una serie que ya tienes o «Nueva serie»" tabindex="0"><label>Serie</label><div class="hf2-choice">◀ <b>' +
      esc(tagEdit.newSeries ? "Nueva serie" : f.name) + "</b> ▶<small>" + (names.length ? (tagEdit.newSeries ? "o elige una de tus " + names.length + " series" : (seriesIdx + 1) + " de " + names.length + " · o «Nueva serie»") : "Escribe el nombre abajo") + "</small></div></div>";
    if (tagEdit.newSeries) {
      top += tagInput("tagNameInput", "Nombre de la serie nueva", f.name, "Ej.: Bluey");
    }
    split = tagStepper("season", "Temporada", f.season) + tagStepper("episode", "Capítulo", f.episode, f.name ? "siguiente libre: " + nextFreeEpisode(f.name, f.season) : "") + tagToggle("Infantil", f.kids, f.kids ? "Sí" : "No");
    bottom = tagInput("tagEpisodeTitleInput", "Título del capítulo", f.episodeTitle, "Opcional") + tagInput("tagDescInput", "Descripción", f.description, "Opcional");
  } else {
    top = tagInput("tagNameInput", "Nombre", f.name, "Ej.: El Rey León");
    split = tagStepper("year", "Año", f.year ? String(f.year) : "—") + tagToggle("Infantil", f.kids, f.kids ? "Sí" : "No");
    bottom = tagInput("tagDescInput", "Descripción", f.description, "Opcional");
  }
  root.className = "screen hf2 cat";
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml("small dt") +
    '<div class="hf2-panel tagger">' +
      '<div class="hf2-tag-preview"><div class="hf2-kicker">Vista previa</div>' +
        '<div class="hf2-card big"><div class="hf2-card-art hf2-img" data-img="' + esc(raw.key) + '" data-img-w="480">' + fallbackArt(raw.key, "tg") +
          '<span class="hf2-card-type">' + (f.type === "movie" ? "Película" : "T" + f.season + ":E" + f.episode) + "</span>" + (f.kids ? '<span class="hf2-card-kids">' + IC.star + "</span>" : "") + "</div>" +
          '<div class="hf2-card-title">' + esc(previewTitle) + '</div><div class="hf2-card-sub">' + esc(previewSub) + "</div></div>" +
        '<div class="hf2-tag-file"><span>Archivo</span>' + esc(raw.fileName || "Video sin nombre") + (raw.duration ? " · " + esc(HFLibrary.formatDuration(raw.duration)) : "") + "<br><span>Chat</span>" + esc(raw.chatTitle || "") +
        (tagEdit.tagged ? "<br><span>Estado</span>Etiquetado desde la TV" : "") + "</div></div>" +
      '<div class="hf2-panel-main tagger"><div class="hf2-kicker">Etiquetar video</div><h1 class="hf2-title small">¿Qué es este video?</h1>' +
        '<div class="hf2-tag-type"><span class="' + (f.type === "movie" ? "on" : "") + '" data-focusable="true" data-type="movie" data-title="Película" tabindex="0">Película</span>' +
        '<span class="' + (f.type === "series" ? "on" : "") + '" data-focusable="true" data-type="series" data-title="Capítulo de serie" tabindex="0">Capítulo de serie</span></div>' +
        '<div class="hf2-form"><div class="tag-top">' + top + '</div><div class="hf2-frow split tag-split">' + split + '</div><div class="tag-bottom">' + bottom + "</div></div>" +
        '<div class="hf2-tag-code"><span>En Telegram sería:</span><code id="tagCode">' + esc(HFLibrary.composeCaption(f)) + "</code></div>" +
        '<div class="hf2-error" id="tagError"></div>' +
        '<div class="hf2-actions">' +
          '<span class="hf2-btn primary small" data-focusable="true" data-action="save" data-title="Guardar" tabindex="0">Guardar</span>' +
          (tagEdit.tagged ? '<span class="hf2-btn ghost small" data-focusable="true" data-action="untag" data-title="Quitar etiqueta" data-description="Volver a usar el comentario de Telegram" tabindex="0">Quitar etiqueta</span>' : "") +
          '<span class="hf2-btn ghost small" data-focusable="true" data-action="cancel" data-title="Cancelar" tabindex="0">Cancelar</span>' +
        "</div></div></div>";
  [["tagNameInput", "name"], ["tagEpisodeTitleInput", "episodeTitle"], ["tagDescInput", "description"]].forEach(function (pair) {
    var el = byId(pair[0]);
    if (el) {
      el.addEventListener("input", function () {
        tagEdit.f[pair[1]] = el.value;
        byId("tagCode").textContent = HFLibrary.composeCaption(tagEdit.f);
      });
    }
  });
  setAreas([
    { name: "type", items: root.querySelectorAll(".hf2-tag-type [data-focusable]"), dir: "h" },
    { name: "top", items: root.querySelectorAll(".tag-top > [data-focusable]"), dir: "v" },
    { name: "split", items: root.querySelectorAll(".tag-split > [data-focusable]"), dir: "h" },
    { name: "bottom", items: root.querySelectorAll(".tag-bottom > [data-focusable]"), dir: "v" },
    { name: "actions", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" }
  ], focusName || "type", focusIndex || 0);
  observeImages(root);
}

function tagRefocus() {
  var a = currentArea();
  return [a ? a.name : "type", state.itemIndex];
}

function adjustTagField(el, dir) {
  var f = tagEdit.f;
  var what = el.getAttribute("data-adjust");
  var names = tagEdit.seriesNames;
  var i;
  var focus = tagRefocus();
  if (what === "series") {
    i = tagEdit.newSeries ? (dir > 0 ? 0 : names.length - 1) : names.indexOf(f.name) + dir;
    if (i < 0 || i >= names.length || !names.length) {
      tagEdit.newSeries = true;
      f.name = "";
    } else {
      tagEdit.newSeries = false;
      f.name = names[i];
      f.episode = nextFreeEpisode(f.name, f.season);
    }
  } else if (what === "year") {
    f.year = f.year ? f.year + dir : new Date().getFullYear();
    if (f.year < 1900 || f.year > new Date().getFullYear() + 1) {
      f.year = 0;
    }
  } else if (what === "season") {
    f.season = Math.max(1, f.season + dir);
    if (f.name) {
      f.episode = nextFreeEpisode(f.name, f.season);
    }
  } else if (what === "episode") {
    f.episode = Math.max(1, f.episode + dir);
  } else if (what === "kids") {
    f.kids = !f.kids;
  }
  renderTagEditor(focus[0], focus[1]);
  return true;
}

function finishTagEdit(message) {
  var entry = library.byKey[tagEdit.key] || fullLibrary.byKey[tagEdit.key];
  if (!entry) {
    openBrowse(browse.section, message);
    return;
  }
  if (entry.type === "episode") {
    openDetail(fullLibrary.titles[entry.seriesKey], { episodeKey: entry.key });
  } else {
    openDetail(entry);
  }
  updateStatus(message);
}

function handleTagEditSelect(el) {
  var action = el.getAttribute("data-action");
  var type = el.getAttribute("data-type");
  var f = tagEdit.f;
  var nameEl;
  if (el.getAttribute("data-input")) { focusInput(byId(el.getAttribute("data-input"))); return; }
  if (el.getAttribute("data-adjust")) {
    if (el.getAttribute("data-adjust") === "series" && tagEdit.newSeries) {
      focusAreaByName("top", 1);
      focusInput(byId("tagNameInput"));
      return;
    }
    adjustTagField(el, 1);
    return;
  }
  if (type) {
    f.type = type;
    if (type === "series" && tagEdit.seriesNames.indexOf(f.name) < 0) {
      tagEdit.newSeries = true;
    }
    renderTagEditor("type", type === "movie" ? 0 : 1);
    return;
  }
  if (action === "save") {
    nameEl = byId("tagNameInput");
    if (nameEl) {
      f.name = (nameEl.value || "").trim();
    }
    if (!f.name) {
      byId("tagError").textContent = "Escribe el nombre.";
      updateStatus("Escribe el nombre");
      return;
    }
    HFLibrary.setTag(tagEdit.key, HFLibrary.composeCaption(f));
    setLibraryItems(libraryItems);
    finishTagEdit(f.type === "movie" ? "Guardado como película: " + f.name : "Guardado: " + f.name + " T" + f.season + ":E" + f.episode);
  } else if (action === "untag") {
    HFLibrary.setTag(tagEdit.key, null);
    setLibraryItems(libraryItems);
    finishTagEdit("Se volvió a usar el comentario de Telegram");
  } else if (action === "cancel") {
    cancelTagEdit();
  }
}

function cancelTagEdit() {
  if (tagEdit.back) {
    tagEdit.back();
  } else {
    openBrowse(browse.section);
  }
}
