/* HomeFlix · reproductor: controles, capítulos (sin salir del video), audio y subtítulos, siguiente capítulo.
 * El video lo maneja HFPlayback (js/playback.js: motor real de Telegram o simulador para la demostración). */

var player = {
  item: null, series: null, overlay: true, hideTimer: null, lastSave: 0, startAt: 0,
  nextVisible: false, nextCancelled: false, backArmed: false, backArmedAt: 0,
  seekStep: 10, lastSeekAt: 0, state: "loading", error: "", panel: "", epSeason: 0, nextAt: 0
};

function playerChrome() {
  return byId("playerChrome");
}

function openPlayer(item, startAt, series) {
  var poster = byId("playerPoster");
  if (!item) {
    return;
  }
  player.item = item;
  player.series = series || null;
  player.nextVisible = false;
  player.nextCancelled = false;
  player.backArmed = false;
  player.lastSave = 0;
  player.error = "";
  player.panel = "";
  player.startAt = startAt || 0;
  showRoute("player");
  byId("scrPlayer").setAttribute("data-next", "false");
  byId("scrPlayer").removeAttribute("data-panel");
  applySubSize();
  poster.style.backgroundImage = "";
  poster.removeAttribute("data-loaded");
  poster.setAttribute("data-hidden", "false");
  poster.setAttribute("data-img", item.type === "episode" || item.type === "video" ? item.key : (item.imageKey || entryVideoKey(item)));
  poster.innerHTML = fallbackArt(poster.getAttribute("data-img"), "pp");
  poster.setAttribute("data-img-w", "1280");
  poster.removeAttribute("data-queued");
  queueImage(poster);
  renderPlayerChrome();
  showPlayerOverlay();
  HFPlayback.open(item, startAt || 0, {
    onTime: onPlayerTime,
    onState: onPlayerState,
    onEnded: onPlayerEnded,
    onError: showPlayerError,
    onNote: function (msg) {
      var n = byId("plNotice");
      if (n) { n.textContent = msg; }
      updateStatus(msg);
    },
    onTracks: function () {
      if (player.panel === "tracks") {
        renderTracksPanel();
      }
    }
  });
  if (HFPlayback.simulated && byId("plNotice")) {
    byId("plNotice").textContent = "Video de demostración: se simula la reproducción.";
  }
}

function playerTitles() {
  var it = player.item;
  if (it.type === "episode") {
    return { title: it.seriesName, sub: "T" + it.season + ":E" + it.episode + " · " + it.title };
  }
  return { title: it.name, sub: titleMeta(it) };
}

function renderPlayerChrome() {
  var t = playerTitles();
  var it = player.item;
  var nextEp = it.type === "episode" && player.series ? HFLibrary.episodeAfter(player.series, it) : null;
  var pills = "";
  if (player.series) {
    pills += '<span class="hf2-pl-pill" data-focusable="true" data-action="episodes" data-title="Capítulos" data-description="Ver los capítulos sin salir del video" tabindex="0">' + IC.list + "Capítulos</span>";
  }
  pills += '<span class="hf2-pl-pill" data-focusable="true" data-action="tracks" data-title="Audio y subtítulos" tabindex="0">' + IC.subs + "Audio y subtítulos</span>";
  if (nextEp) {
    pills += '<span class="hf2-pl-pill" data-focusable="true" data-action="next" data-title="Siguiente" data-description="Siguiente: T' + nextEp.season + ":E" + nextEp.episode + " · " + esc(nextEp.title) + '" tabindex="0">' + IC.next + "Siguiente</span>";
  }
  if (!currentProfileIsKids()) {
    pills += '<span class="hf2-pl-pill" data-focusable="true" data-action="edit-tag" data-title="Editar" data-description="Cambiar nombre, temporada, capítulo o si es infantil" tabindex="0">' + IC.pencil + "Editar</span>";
  }
  playerChrome().innerHTML =
    '<div class="hf2-pl-shade"></div>' +
    '<div class="hf2-pl-top"><span class="hf2-pl-back">' + IC.back + '</span><div><div class="hf2-pl-title">' + esc(t.title) + '</div><div class="hf2-pl-sub">' + esc(t.sub) + '</div></div><div class="hf2-pl-brand"><div class="hf2-logo"></div></div></div>' +
    '<div class="hf2-pl-bottom">' +
      '<div class="hf2-pl-progress"><span class="t" id="plTime">' + HFLibrary.formatClock(player.startAt) + '</span>' +
        '<div class="hf2-pl-bar" id="plBar" data-focusable="true" data-title="Barra de progreso" data-description="◀ ▶ adelantar o retroceder · mantener pulsado acelera" tabindex="0"><i class="buf" id="plBuf"></i><i class="fill" id="plFill"></i><b id="plKnob" style="left:0%"></b></div>' +
        '<span class="t" id="plDur">0:00</span></div>' +
      '<div class="hf2-pl-controls"><div class="hf2-pl-main">' +
        '<span class="hf2-pl-btn" data-focusable="true" data-action="back10" data-title="Retroceder 10 segundos" tabindex="0">' + IC.back10 + "</span>" +
        '<span class="hf2-pl-btn big" id="plToggle" data-focusable="true" data-action="toggle" data-title="Pausa" tabindex="0">' + IC.pause + "</span>" +
        '<span class="hf2-pl-btn" data-focusable="true" data-action="fwd10" data-title="Adelantar 10 segundos" tabindex="0">' + IC.fwd10 + "</span>" +
      '</div><div class="hf2-pl-extra">' + pills + "</div></div>" +
      '<div class="hf2-pl-notice" id="plNotice"></div>' +
    "</div>" +
    '<div class="hf2-tracks" id="plTracks" data-visible="false"></div>' +
    '<div class="hf2-pl-eps" id="plEps" data-visible="false"></div>' +
    '<div class="hf2-next" id="plNext" data-visible="false"></div>';
  setPlayerAreas("controls", 1);
}

function setPlayerAreas(focusName, focusIndex) {
  var chrome = playerChrome();
  var defs = [];
  if (player.panel === "tracks") {
    defs.push({ name: "audio", items: chrome.querySelectorAll("#plTracks .tr-audio .hf2-track"), dir: "v", sideways: true });
    defs.push({ name: "subs", items: chrome.querySelectorAll("#plTracks .tr-subs .hf2-track"), dir: "v", sideways: true });
    defs.push({ name: "size", items: chrome.querySelectorAll("#plTracks .hf2-segment [data-focusable]"), dir: "h" });
  } else if (player.panel === "episodes") {
    defs.push({ name: "seasons", items: chrome.querySelectorAll("#plEps .hf2-seasons [data-focusable]"), dir: "h", onFocus: onPlayerSeasonFocus });
    defs.push({ name: "eps", items: chrome.querySelectorAll("#plEps .hf2-ep"), dir: "h", track: byId("plEpsTrack") });
  } else {
    if (player.nextVisible) {
      defs.push({ name: "next", items: chrome.querySelectorAll("#plNext [data-focusable]"), dir: "h" });
    }
    if (player.overlay) {
      defs.push({ name: "bar", items: [byId("plBar")], dir: "h" });
      defs.push({ name: "controls", items: chrome.querySelectorAll(".hf2-pl-controls [data-focusable]"), dir: "h" });
    }
  }
  if (!defs.length) {
    clearPreviousFocus();
    areas = [];
    return;
  }
  setAreas(defs, focusName, focusIndex);
}

function setPlayerCenter(text, kind) {
  var el = byId("playerCenter");
  el.textContent = text || "";
  el.setAttribute("data-visible", text ? "true" : "false");
  el.setAttribute("data-kind", kind || "");
}

function showPlayerError(msg) {
  player.error = msg || "Error del reproductor";
  setPlayerCenter("⚠ " + player.error, "error");
  var main = playerChrome().querySelector(".hf2-pl-controls");
  if (main) {
    main.innerHTML = '<div class="hf2-pl-main"><span class="hf2-btn primary small icon" data-focusable="true" data-action="retry" data-title="Reintentar" tabindex="0">' + IC.refresh + "Reintentar</span>" +
      '<span class="hf2-btn ghost small" data-focusable="true" data-action="exit" data-title="Volver" tabindex="0" style="margin-left:16px">Volver</span></div>';
  }
  if (player.hideTimer) {
    clearTimeout(player.hideTimer);
    player.hideTimer = null;
  }
  player.overlay = true;
  playerChrome().setAttribute("data-visible", "true");
  byId("scrPlayer").setAttribute("data-overlay", "true");
  setPlayerAreas("controls", 0);
  updateStatus(player.error);
}

function onPlayerState(s) {
  var toggle = byId("plToggle");
  player.state = s;
  if (player.error) {
    return;
  }
  if (s === "loading" || s === "buffering") {
    setPlayerCenter(s === "loading" ? "Abriendo…" : "Cargando…");
  } else if (s === "paused") {
    setPlayerCenter("");
    showPlayerOverlay();
  } else {
    setPlayerCenter("");
    byId("playerPoster").setAttribute("data-hidden", HFPlayback.simulated ? "false" : "true");
    scheduleOverlayHide();
  }
  if (toggle) {
    toggle.innerHTML = s === "paused" ? IC.play : IC.pause;
    toggle._hfDescription = s === "paused" ? "Reproducir" : "Pausa";
  }
}

function onPlayerTime(t, dur, buffered) {
  var pct = dur ? (t / dur) * 100 : 0;
  var remaining = dur - t;
  var tEl = byId("plTime");
  if (!tEl) {
    return;
  }
  tEl.textContent = HFLibrary.formatClock(t);
  byId("plDur").textContent = "-" + HFLibrary.formatClock(Math.max(0, remaining));
  byId("plFill").style.width = pct + "%";
  byId("plKnob").style.left = pct + "%";
  byId("plBuf").style.width = (dur ? (buffered / dur) * 100 : 0) + "%";
  if (Date.now() - player.lastSave > 10000 && t > 5) {
    player.lastSave = Date.now();
    HFLibrary.setProgress(entryVideoKey(player.item), t, dur);
  }
  if (player.series && player.item.type === "episode" && remaining <= 15 && !player.nextCancelled && !player.panel) {
    showNextCard(Math.ceil(remaining));
  }
}

function showNextCard(seconds) {
  var nextEp = HFLibrary.episodeAfter(player.series, player.item);
  var el = byId("plNext");
  if (!nextEp || !el) {
    return;
  }
  if (!player.nextVisible) {
    player.nextVisible = true;
    el.innerHTML = '<div class="hf2-next-art hf2-img" data-img="' + esc(nextEp.key) + '" data-img-w="480">' + fallbackArt(nextEp.key, "nx") + '<span class="hf2-ep-num">' + nextEp.episode + "</span></div>" +
      '<div class="hf2-next-body"><div class="hf2-kicker">Siguiente capítulo</div>' +
      '<div class="hf2-next-title">T' + nextEp.season + ":E" + nextEp.episode + " · " + esc(nextEp.title) + "</div>" +
      (nextEp.description ? '<div class="hf2-next-desc">' + esc(nextEp.description.slice(0, 110)) + "</div>" : "") +
      '<div class="hf2-next-count"><span class="bar"><i id="plNextBar" style="width:0%"></i></span><span id="plNextCount"></span></div>' +
      '<div class="hf2-next-actions"><span class="hf2-btn primary small icon" data-focusable="true" data-action="next-now" data-title="Ver ahora" tabindex="0">' + IC.play + "Ver ahora</span>" +
      '<span class="hf2-btn ghost small" data-focusable="true" data-action="next-cancel" data-title="Ver créditos" data-description="Seguir viendo este capítulo hasta el final" tabindex="0">Ver créditos</span></div></div>';
    el.setAttribute("data-visible", "true");
    byId("scrPlayer").setAttribute("data-next", "true");
    queueImage(el.querySelector("[data-img]"));
    setPlayerAreas("next", 0);
  }
  byId("plNextCount").textContent = "Empieza en " + seconds + " s";
  byId("plNextBar").style.width = Math.min(100, Math.round(((15 - seconds) / 15) * 100)) + "%";
}

function hideNextCard() {
  player.nextVisible = false;
  player.nextCancelled = true;
  byId("plNext").setAttribute("data-visible", "false");
  byId("scrPlayer").setAttribute("data-next", "false");
  setPlayerAreas("controls", 1);
}

function onPlayerEnded() {
  var nextEp;
  HFLibrary.setProgress(entryVideoKey(player.item), HFPlayback.duration(), HFPlayback.duration());
  if (player.series && player.item.type === "episode" && !player.nextCancelled) {
    nextEp = HFLibrary.episodeAfter(player.series, player.item);
    if (nextEp) {
      openPlayer(nextEp, 0, player.series);
      return;
    }
  }
  exitPlayer("Terminó: " + playerTitles().title);
}

function playNextEpisode() {
  var nextEp = HFLibrary.episodeAfter(player.series, player.item);
  if (nextEp) {
    HFLibrary.setProgress(entryVideoKey(player.item), HFPlayback.duration(), HFPlayback.duration());
    openPlayer(nextEp, 0, player.series);
  }
}

function savePlayerProgress() {
  if (player.item && HFPlayback.time() > 5) {
    HFLibrary.setProgress(entryVideoKey(player.item), HFPlayback.time(), HFPlayback.duration());
  }
}

function closePlayer() {
  savePlayerProgress();
  HFPlayback.close();
  if (player.hideTimer) {
    clearTimeout(player.hideTimer);
    player.hideTimer = null;
  }
}

function exitPlayer(message) {
  var series = player.series;
  var item = player.item;
  closePlayer();
  if (series) {
    detail.title = series;
    showRoute("detail");
    detail.season = seasonIndexFor(series, item.key);
    renderDetail("episodes", episodeIndexFor(series, item.key));
    setDetailScrolled(true);
  } else if (item) {
    detail.title = item;
    showRoute("detail");
    renderDetail("actions", 0);
  } else {
    openBrowse(browse.section);
  }
  updateStatus(message || "Progreso guardado");
}

function showPlayerOverlay() {
  if (!player.overlay) {
    player.overlay = true;
    playerChrome().setAttribute("data-visible", "true");
    byId("scrPlayer").setAttribute("data-overlay", "true");
    setPlayerAreas("controls", 1);
  }
  scheduleOverlayHide();
}

function hidePlayerOverlay() {
  if (player.overlay && HFPlayback.playing() && !player.panel) {
    player.overlay = false;
    playerChrome().setAttribute("data-visible", "false");
    byId("scrPlayer").setAttribute("data-overlay", "false");
    setPlayerAreas(player.nextVisible ? "next" : null, 0);
  }
}

function scheduleOverlayHide() {
  if (player.hideTimer) {
    clearTimeout(player.hideTimer);
  }
  player.hideTimer = setTimeout(function () {
    player.hideTimer = null;
    hidePlayerOverlay();
  }, 5000);
}

function seekBy(delta) {
  var now = Date.now();
  if (now - player.lastSeekAt < 600) {
    player.seekStep = Math.min(60, player.seekStep < 30 ? 30 : 60);
  } else {
    player.seekStep = 10;
  }
  player.lastSeekAt = now;
  HFPlayback.seek(HFPlayback.time() + (delta > 0 ? player.seekStep : -player.seekStep));
  setPlayerCenter((delta > 0 ? "+" : "−") + player.seekStep + " s");
  setTimeout(function () {
    if (byId("playerCenter").textContent.indexOf(" s") > 0) {
      setPlayerCenter("");
    }
  }, 700);
}

/* ----- Panel: audio y subtítulos ----- */

function subSize() {
  try {
    return window.localStorage.getItem("hf.subsize") || "medium";
  } catch (e) {
    return "medium";
  }
}

function applySubSize() {
  byId("scrPlayer").setAttribute("data-subsize", subSize());
}

function openTracksPanel() {
  player.panel = "tracks";
  byId("scrPlayer").setAttribute("data-panel", "tracks");
  if (player.hideTimer) {
    clearTimeout(player.hideTimer);
    player.hideTimer = null;
  }
  renderTracksPanel();
  updateStatus("Audio y subtítulos · ◀ ▶ cambia de columna · BACK cierra");
}

function renderTracksPanel() {
  var tr = HFPlayback.tracks();
  var el = byId("plTracks");
  var size = subSize();
  var audio;
  var subs;
  if (HFPlayback.simulated) {
    audio = '<div class="hf2-text" style="font-size:20px">El video de demostración no tiene pistas.</div>';
    subs = "";
  } else {
    audio = tr.audio.length ? tr.audio.map(function (a) {
      return '<div class="hf2-track' + (a.current ? " on" : "") + '" data-focusable="true" data-track-kind="audio" data-track-key="' + esc(a.key) + '" data-title="' + esc(a.label) + '" tabindex="0"><span class="ck">' + (a.current ? IC.check : "") + "</span><b>" + esc(a.label) + "</b></div>";
    }).join("") : '<div class="hf2-text" style="font-size:20px">' + (player.state === "loading" ? "Cargando pistas…" : "Una sola pista de audio") + "</div>";
    subs = '<div class="hf2-track' + (tr.subsOff ? " on" : "") + '" data-focusable="true" data-track-kind="sub" data-track-key="" data-title="Desactivados" tabindex="0"><span class="ck">' + (tr.subsOff ? IC.check : "") + "</span><b>Desactivados</b></div>" +
      tr.subs.map(function (s) {
        return '<div class="hf2-track' + (s.current ? " on" : "") + '" data-focusable="true" data-track-kind="sub" data-track-key="' + esc(s.key) + '" data-title="' + esc(s.label) + '" tabindex="0"><span class="ck">' + (s.current ? IC.check : "") + "</span><b>" + esc(s.label) + "</b></div>";
      }).join("") + (tr.subs.length ? "" : '<div class="hf2-text" style="font-size:19px">Este video no trae subtítulos</div>');
  }
  el.innerHTML = "<h2>Audio y subtítulos</h2>" +
    '<div class="hf2-tracks-cols"><div class="tr-audio"><div class="hf2-tracks-h">' + IC.audio + "Audio</div>" + audio + "</div>" +
    '<div class="tr-subs"><div class="hf2-tracks-h">' + IC.subs + "Subtítulos</div>" + subs +
    '<div class="hf2-tracks-h small">Tamaño</div><div class="hf2-segment">' +
      [["small", "Pequeño"], ["medium", "Mediano"], ["large", "Grande"]].map(function (s) {
        return '<span class="' + (size === s[0] ? "on" : "") + '" data-focusable="true" data-subsize="' + s[0] + '" data-title="' + s[1] + '" data-description="Tamaño de subtítulos: ' + s[1].toLowerCase() + '" tabindex="0">' + s[1] + "</span>";
      }).join("") + "</div></div></div>" +
    '<div class="hf2-tracks-note">Se recuerda para este video · BACK cerrar</div>';
  el.setAttribute("data-visible", "true");
  setPlayerAreas(tr.audio.length > 1 ? "audio" : "subs", 0);
}

function closePanel() {
  player.panel = "";
  byId("scrPlayer").removeAttribute("data-panel");
  byId("plTracks").setAttribute("data-visible", "false");
  byId("plEps").setAttribute("data-visible", "false");
  setPlayerAreas("controls", 1);
  scheduleOverlayHide();
}

function handleTrackSelect(el) {
  var kind = el.getAttribute("data-track-kind");
  var key = el.getAttribute("data-track-key");
  var a = currentArea();
  var idx = state.itemIndex;
  if (kind === "audio") {
    if (!el.classList.contains("on")) {
      HFPlayback.setAudio(key);
      updateStatus("Audio: " + el.getAttribute("data-title"));
    }
  } else {
    HFPlayback.setSub(key || null);
    updateStatus(key ? "Subtítulos: " + el.getAttribute("data-title") : "Subtítulos desactivados");
  }
  renderTracksPanel();
  focusAreaByName(a ? a.name : "subs", idx);
}

/* ----- Panel: capítulos sin salir del video ----- */

function openEpisodesPanel() {
  if (!player.series) {
    return;
  }
  player.panel = "episodes";
  player.epSeason = seasonIndexFor(player.series, player.item.key);
  byId("scrPlayer").setAttribute("data-panel", "episodes");
  if (player.hideTimer) {
    clearTimeout(player.hideTimer);
    player.hideTimer = null;
  }
  renderEpisodesPanel("eps", null);
  updateStatus("OK reproduce el capítulo · BACK vuelve al video");
}

function renderEpisodesPanel(focusName, focusIndex) {
  var s = player.series;
  var season = s.seasons[player.epSeason] || s.seasons[0];
  var currentIdx = -1;
  var watched = 0;
  var cards = season.episodes.map(function (ep, i) {
    var p = HFLibrary.progress(ep.key);
    var now = ep.key === player.item.key;
    var prog = progressInfo(ep.key);
    if (now) { currentIdx = i; }
    if (p && p.done) { watched += 1; }
    return '<div class="hf2-ep' + (now ? " now" : "") + '" data-focusable="true" data-ref="v:' + esc(ep.key) + '" data-title="' + esc(ep.title) + '" data-description="T' + ep.season + ":E" + ep.episode + " · " + esc(ep.title) + " · " + esc(HFLibrary.formatDuration(ep.video.duration)) + '" tabindex="0">' +
      '<div class="hf2-ep-art hf2-img" data-img="' + esc(ep.key) + '" data-img-w="480">' + fallbackArt(ep.key, "pe") + '<span class="hf2-ep-num">' + ep.episode + "</span>" +
      (p && p.done && !now ? '<span class="hf2-ep-done">' + IC.check + "Visto</span>" : "") +
      (now ? '<span class="hf2-ep-now">' + IC.play + "Viendo ahora</span>" : "") +
      (prog ? '<span class="hf2-card-progress"><i style="width:' + prog.pct + '%"></i></span>' : "") +
      '<span class="hf2-ep-play">' + IC.play + "</span></div>" +
      '<div class="hf2-ep-title"><b>' + esc(ep.title) + "</b><span>" + esc(HFLibrary.formatDuration(ep.video.duration)) + "</span></div>" +
      '<div class="hf2-ep-desc">' + esc(ep.description || "") + "</div></div>";
  });
  var el = byId("plEps");
  el.innerHTML = '<div class="hf2-pl-eps-head"><h2>Capítulos</h2><div class="hf2-seasons">' + s.seasons.map(function (x, i) {
    return '<span class="hf2-pill' + (i === player.epSeason ? " on" : "") + '" data-focusable="true" data-ep-season="' + i + '" data-title="Temporada ' + x.number + '" tabindex="0">Temporada ' + x.number + " <b>" + x.episodes.length + "</b></span>";
  }).join("") + '<span class="hf2-seasons-note">Viste ' + watched + " de " + season.episodes.length + (currentIdx >= 0 ? " · estás en el " + (currentIdx + 1) : "") + "</span></div></div>" +
    '<div class="hf2-ep-viewport"><div class="hf2-ep-track pl" id="plEpsTrack">' + cards.join("") + "</div></div>";
  el.setAttribute("data-visible", "true");
  setPlayerAreas(focusName, typeof focusIndex === "number" ? focusIndex : Math.min(season.episodes.length - 1, Math.max(0, currentIdx + 1)));
  observeImages(el);
}

var playerSeasonTimer = null;

function onPlayerSeasonFocus(el, index) {
  if (playerSeasonTimer) {
    clearTimeout(playerSeasonTimer);
  }
  if (index === player.epSeason) {
    return;
  }
  playerSeasonTimer = setTimeout(function () {
    playerSeasonTimer = null;
    if (player.panel === "episodes" && currentArea() && currentArea().name === "seasons") {
      player.epSeason = index;
      renderEpisodesPanel("seasons", index);
    }
  }, 300);
}

/* ----- Acciones y teclas ----- */

function handlePlayerAction(el) {
  var action = el.getAttribute("data-action");
  var ref = el.getAttribute("data-ref");
  var size = el.getAttribute("data-subsize");
  var seasonIdx = el.getAttribute("data-ep-season");
  var entry;
  var editing;
  var series;
  if (el.getAttribute("data-track-kind")) { handleTrackSelect(el); return; }
  if (size) {
    try { window.localStorage.setItem("hf.subsize", size); } catch (e) { /* nada */ }
    applySubSize();
    renderTracksPanel();
    focusAreaByName("size", ["small", "medium", "large"].indexOf(size));
    return;
  }
  if (seasonIdx !== null) {
    player.epSeason = Number(seasonIdx);
    renderEpisodesPanel("eps", 0);
    return;
  }
  if (ref) {
    entry = entryFromRef(ref) || fullLibrary.byKey[ref.slice(2)];
    if (entry && entry.key === player.item.key) {
      closePanel();
      return;
    }
    if (entry) {
      savePlayerProgress();
      var p = HFLibrary.progress(entry.key);
      openPlayer(entry, p && !p.done ? p.t : 0, player.series);
    }
    return;
  }
  if (action === "retry") { openPlayer(player.item, Math.max(player.startAt || 0, HFPlayback.time() || 0), player.series); return; }
  if (action === "exit") { exitPlayer(player.error); return; }
  if (action === "toggle") { HFPlayback.toggle(); }
  else if (action === "back10") { seekBy(-1); }
  else if (action === "fwd10") { seekBy(1); }
  else if (action === "next" || action === "next-now") { playNextEpisode(); }
  else if (action === "next-cancel") { hideNextCard(); }
  else if (action === "episodes") { openEpisodesPanel(); }
  else if (action === "tracks") { openTracksPanel(); }
  else if (action === "edit-tag") {
    editing = player.item;
    series = player.series;
    closePlayer();
    openTagEditor(editing, function () {
      if (series) { openDetail(series, { episodeKey: editing.key }); } else { openDetail(editing); }
    });
  }
}

/* Teclas del reproductor. Devuelve true si la tecla se usó. */
function handlePlayerKey(code) {
  var a = currentArea();
  if (code === 415) { HFPlayback.play(); showPlayerOverlay(); return true; }
  if (code === 19) { HFPlayback.pause(); return true; }
  if (code === 10252) { HFPlayback.toggle(); showPlayerOverlay(); return true; }
  if (code === 417) { seekBy(1); showPlayerOverlay(); return true; }
  if (code === 412) { seekBy(-1); showPlayerOverlay(); return true; }
  if (code === 413) { exitPlayer(); return true; }

  if (player.panel) {
    if (code === 10009) { closePanel(); return true; }
    return false;
  }
  if (code === 10009) {
    if (player.nextVisible) { hideNextCard(); return true; }
    if (player.error) { exitPlayer(player.error); return true; }
    if (!player.overlay && !(player.backArmed && Date.now() - player.backArmedAt < 5000)) {
      player.backArmed = true;
      player.backArmedAt = Date.now();
      showPlayerOverlay();
      updateStatus("Pulsa BACK otra vez para salir");
      return true;
    }
    exitPlayer();
    return true;
  }
  player.backArmed = false;
  if (!player.overlay && !player.nextVisible) {
    if (code === 13) { HFPlayback.toggle(); showPlayerOverlay(); return true; }
    if (code === 37) { seekBy(-1); showPlayerOverlay(); focusAreaByName("bar", 0); return true; }
    if (code === 39) { seekBy(1); showPlayerOverlay(); focusAreaByName("bar", 0); return true; }
    showPlayerOverlay();
    return true;
  }
  scheduleOverlayHide();
  if (a && a.name === "bar") {
    if (code === 37) { seekBy(-1); return true; }
    if (code === 39) { seekBy(1); return true; }
    if (code === 13) { HFPlayback.toggle(); return true; }
  }
  return false;
}
