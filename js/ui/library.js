/* HomeFlix · biblioteca: sincronización, chats de la biblioteca, guía, catálogo (Inicio / Películas / Series / Mi lista) y buscar. */

/* ===================== Estado de la biblioteca ===================== */

var fullLibrary = HFLibrary.build([]);
var library = fullLibrary;       // lo que ve el perfil activo (filtrado si es infantil)
var libraryItems = [];
var syncing = false;
var syncProgress = "";
var syncError = "";
var syncedAt = {};               // chatId → cuándo se revisó por última vez en esta sesión

function loadLibraryFromCache() {
  setLibraryItems(HFLibrary.cachedItems());
}

function setLibraryItems(items) {
  libraryItems = items || [];
  rebuildLibrary();
}

function itemChat(it) {
  return String(it.chatId || String(it.key || "").split(":")[0]);
}

/* La biblioteca del perfil activo: solo los videos de sus chats (y si es infantil, solo lo marcado #infantil). */
function rebuildLibrary() {
  var src = HFLibrary.enabledSources() || {};
  fullLibrary = HFLibrary.build(libraryItems.filter(function (it) { return !!src[itemChat(it)]; }), HFLibrary.tags());
  applyProfileView();
}

function applyProfileView() {
  library = currentProfileIsKids() ? HFLibrary.filterKids(fullLibrary) : fullLibrary;
}

function currentProfileIsKids() {
  return !!(activeProfile && activeProfile.kids);
}

function enabledSourceIds() {
  return Object.keys(HFLibrary.enabledSources() || {});
}

function setSyncBadge() {
  var el = byId("syncBadge");
  var upd = updateInfo();
  if (!el) {
    return;
  }
  el.innerHTML = syncing ? IC.clock + esc(syncProgress) : (syncError ? "⚠ " + esc(syncError) : (upd ? "⬆ Nueva versión v" + esc(upd.version) : ""));
  el.setAttribute("data-state", syncing ? "busy" : (syncError ? "error" : "idle"));
}

function librarySyncDue() {
  var now = Date.now();
  var acc = HFLibrary.accountId();
  return enabledSourceIds().some(function (id) { var t = syncedAt[acc + ":" + id]; return !t || now - t > 10 * 60 * 1000; });
}

/* Revisa los chats activos del perfil y rearma la biblioteca. La caché guarda los videos por chat:
 * lo revisado reemplaza lo de ese chat, y lo de otros perfiles se conserva. */
function syncLibrary() {
  var ids = enabledSourceIds();
  var all = [];
  var done = {};
  var failed = 0;
  var acc = HFLibrary.accountId();
  var i = 0;
  if (syncing || !telegramUser || !HFTelegram.available()) {
    return;
  }
  syncing = true;
  syncError = "";
  function next() {
    if (HFLibrary.accountId() !== acc) {
      /* se cambió de cuenta a mitad de camino: lo leído era de la otra cuenta y se descarta */
      syncing = false;
      setSyncBadge();
      return;
    }
    if (i >= ids.length) {
      var keep = HFLibrary.allEnabledSources();
      var merged;
      syncing = false;
      syncError = failed ? failed + " chat(s) no se pudieron leer" : "";
      merged = libraryItems.filter(function (it) {
        var c = itemChat(it);
        return !done[c] && !!keep[c];
      }).concat(all.map(function (it) {
        if (it.caption && it.caption.length > 800) {
          it.caption = it.caption.slice(0, 800);
        }
        return it;
      }));
      HFLibrary.setCachedItems(merged);
      setLibraryItems(merged);
      setSyncBadge();
      if (currentRoute === "browse") {
        var a = currentArea();
        renderBrowse(a ? a.name : null, state.itemIndex);
        updateStatus("Biblioteca actualizada: " + library.movies.length + " películas, " + library.series.length + " series");
      }
      return;
    }
    syncProgress = "Actualizando " + (i + 1) + "/" + ids.length + "…";
    setSyncBadge();
    HFTelegram.scan(ids[i]).then(function (items) {
      all = all.concat(items);
      done[String(ids[i])] = true;
      syncedAt[acc + ":" + String(ids[i])] = Date.now();
    }, function () {
      failed += 1;
    }).then(function () {
      i += 1;
      next();
    });
  }
  next();
}

/* ===================== Chats de la biblioteca ===================== */

var settings = {
  dialogs: null, typeTab: "groups", filter: "all", query: "", selected: {}, counts: {},
  returnTo: "browse", firstTime: false, loading: false, countTimer: null, helpOpen: false
};

var KIND_LABEL = { saved: "Guardados", channel: "Canal", group: "Grupo", user: "Chat privado", bot: "Bot" };

function openSettings(opts) {
  opts = opts || {};
  settings.returnTo = opts.returnTo || (currentRoute === "browse" ? "browse" : "profiles");
  settings.profile = opts.profile || activeProfile || HFLibrary.profiles()[0];
  settings.firstTime = !!opts.firstTime;
  settings.helpOpen = false;
  settings.filter = "all";
  settings.query = "";
  settings.selected = {};
  (function (map) {
    Object.keys(map || {}).forEach(function (k) { settings.selected[k] = map[k]; });
  })(HFLibrary.enabledSources(settings.profile.id));
  showRoute("settings");
  renderSettings();
  if (!settings.dialogs && !settings.loading) {
    settings.loading = true;
    updateStatus("Cargando tus chats de Telegram…");
    HFTelegram.dialogs(300).then(function (list) {
      settings.dialogs = list;
      settings.loading = false;
      if (currentRoute === "settings") {
        renderSettings();
        updateStatus(settings.firstTime ? "Primer paso: activa los chats donde están tus videos" : settingsSummary());
      }
    }, function (e) {
      settings.loading = false;
      updateStatus("No se pudieron cargar los chats: " + errorText(e));
      if (currentRoute === "settings") {
        renderSettings();
      }
    });
  }
}

function isGroupKind(k) {
  return k === "saved" || k === "channel" || k === "group";
}

function normText(s) {
  var t = String(s || "").toLowerCase();
  if (t.normalize) {
    t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  return t;
}

function settingsVisibleDialogs() {
  var q = normText(settings.query).trim();
  return (settings.dialogs || []).filter(function (d) {
    if (settings.typeTab === "groups" ? !isGroupKind(d.kind) : isGroupKind(d.kind)) { return false; }
    if (settings.filter === "selected" && !settings.selected[d.id]) { return false; }
    if (q && normText(d.title).indexOf(q) < 0) { return false; }
    return true;
  });
}

function settingsCountText(id) {
  var n = settings.counts[id];
  if (n === undefined) { return ""; }
  if (n === -1) { return "sin acceso"; }
  return n === 0 ? "sin videos" : n + (n === 1 ? " video" : " videos");
}

function settingsSummary() {
  var names = Object.keys(settings.selected).map(function (k) { return settings.selected[k]; });
  return names.length ? names.length + (names.length === 1 ? " chat activo · " : " chats activos · ") + names.slice(0, 3).join(", ") + (names.length > 3 ? "…" : "") : "Ningún chat activo todavía";
}

function renderSettings(focusName, focusIndex) {
  var root = byId("scrSettings");
  var list = settings.dialogs || [];
  var groups = list.filter(function (d) { return isGroupKind(d.kind); }).length;
  var privates = list.length - groups;
  var active = Object.keys(settings.selected).length;
  var visible = settingsVisibleDialogs();
  var rows;
  if (settings.loading || !settings.dialogs) {
    rows = '<div class="hf2-text">' + (settings.loading ? "Cargando tus chats de Telegram…" : "No se pudieron cargar los chats. Pulsa Listo y vuelve a intentarlo.") + "</div>";
  } else if (!visible.length) {
    rows = '<div class="hf2-text">' + (settings.filter === "selected" ? "No hay chats seleccionados en esta pestaña." : settings.query ? "Ningún chat coincide con «" + esc(settings.query) + "»." : "No hay chats en esta lista.") + "</div>";
  } else {
    rows = visible.map(function (d) {
      var on = !!settings.selected[d.id];
      return '<div class="hf2-chat' + (on ? " on" : "") + '" data-focusable="true" data-id="' + esc(d.id) + '" data-title="' + esc(d.title) + '" data-description="' + (on ? "Activo · OK para quitarlo" : "OK para usarlo en la biblioteca") + '" tabindex="0">' +
        '<span class="hf2-check">' + (on ? IC.check : "") + '</span><span class="hf2-chat-name">' + esc(d.title) + "</span>" +
        '<span class="hf2-chat-kind">' + esc(KIND_LABEL[d.kind] || "") + '</span><span class="hf2-chat-count" data-count-for="' + esc(d.id) + '">' + esc(settingsCountText(d.id)) + "</span></div>";
    }).join("");
  }
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-top-actions">' +
      '<div class="hf2-round" data-focusable="true" data-action="help" data-title="Ayuda" data-description="Cómo ordena HomeFlix tus videos" tabindex="0">' + IC.help + "</div>" +
      '<div class="hf2-btn primary small top" data-focusable="true" data-action="done" data-title="Listo" data-description="Guardar y ' + (settings.firstTime ? "continuar" : "volver") + '" tabindex="0">' + (settings.firstTime ? "Continuar" : "Listo") + "</div>" +
    "</div>" +
    '<div class="hf2-settings">' +
      '<div class="hf2-kicker">Ajustes · perfil ' + esc(settings.profile.name) + '</div><h1 class="hf2-title">¿De qué chats sale la biblioteca de ' + esc(settings.profile.name) + '?</h1>' +
      '<p class="hf2-text wide">Activa los grupos, canales o chats donde subes tus películas y series. Cada perfil tiene los suyos.</p>' +
      '<div class="hf2-toolbar">' +
        '<div class="hf2-pills">' +
          '<span class="hf2-pill' + (settings.typeTab === "groups" ? " on" : "") + '" data-focusable="true" data-tab="groups" data-title="Canales y grupos" tabindex="0">Canales y grupos <b>' + groups + "</b></span>" +
          '<span class="hf2-pill' + (settings.typeTab === "private" ? " on" : "") + '" data-focusable="true" data-tab="private" data-title="Chats privados" tabindex="0">Chats privados <b>' + privates + "</b></span>" +
        "</div>" +
        '<div class="hf2-segment">' +
          '<span class="' + (settings.filter === "all" ? "on" : "") + '" data-focusable="true" data-filter="all" data-title="Todos" data-description="Ver todos los chats" tabindex="0">Todos</span>' +
          '<span class="' + (settings.filter === "selected" ? "on" : "") + '" data-focusable="true" data-filter="selected" data-title="Seleccionados" data-description="Ver solo los chats activos" tabindex="0">Seleccionados <b>' + active + "</b></span>" +
        "</div>" +
        '<div class="hf2-tools">' +
          '<span class="hf2-tool" data-focusable="true" data-input="chatSearchInput" data-title="Buscar chat" data-description="OK para escribir el nombre de un chat" tabindex="0">' + IC.search + '<input id="chatSearchInput" class="hf2-tool-input" type="text" autocomplete="off" placeholder="Buscar chat" value="' + esc(settings.query) + '"/></span>' +
          '<span class="hf2-tool" data-focusable="true" data-action="select-all" data-title="Seleccionar todo" data-description="Activar todos los chats de esta lista" tabindex="0">' + IC.all + "Seleccionar todo</span>" +
          '<span class="hf2-tool" data-focusable="true" data-action="select-none" data-title="Desmarcar todo" data-description="Desactivar todos los chats de esta lista" tabindex="0">' + IC.none + "Desmarcar todo</span>" +
        "</div>" +
      "</div>" +
      '<div class="hf2-chat-viewport"><div class="hf2-chatlist" id="settingsList">' + rows + "</div></div>" +
    "</div>" +
    (settings.helpOpen ? helpPopoverHtml() : "");
  byId("chatSearchInput").addEventListener("input", onChatSearchInput, false);
  if (settings.helpOpen) {
    setAreas([{ name: "help", items: root.querySelectorAll(".hf2-help-pop [data-focusable]"), dir: "h" }], 0, 0);
  } else {
    setAreas([
      { name: "top", items: root.querySelectorAll(".hf2-top-actions [data-focusable]"), dir: "h" },
      { name: "tools", items: root.querySelectorAll(".hf2-toolbar [data-focusable]"), dir: "h" },
      { name: "list", items: root.querySelectorAll(".hf2-chat"), dir: "v", track: byId("settingsList"), onFocus: scheduleSettingsCounts }
    ], focusName || (visible.length ? "list" : "tools"), focusIndex || 0);
  }
  updateStatus(settingsSummary());
}

function helpPopoverHtml() {
  return '<div class="hf2-help-pop">' +
    '<div class="hf2-help-title">Cómo ordena HomeFlix tus videos</div>' +
    "<p>Escribe esto en el comentario de cada video al subirlo a Telegram:</p>" +
    '<div class="hf2-help-row"><span class="hf2-help-tag">Película</span><code>pelicula#Coco (2017)#Un niño viaja…</code></div>' +
    '<div class="hf2-help-row"><span class="hf2-help-tag">Capítulo</span><code>serie(1/3)#Bluey#Juegan a los médicos</code></div>' +
    '<div class="hf2-help-row"><span class="hf2-help-tag">Infantil</span><code>… #infantil</code><span class="hf2-help-note">al final, para los perfiles infantiles</span></div>' +
    '<div class="hf2-help-row"><span class="hf2-help-tag">Categoría</span><code>… #Marvel</code><span class="hf2-help-note">al final: cada categoría tiene su fila</span></div>' +
    '<p class="dim">¿Ya los subiste sin comentario? Ábrelos en «Sin clasificar» y usa <b>Etiquetar</b> desde la TV.</p>' +
    '<div class="hf2-btn ghost small" data-focusable="true" data-action="help-close" data-title="Entendido" tabindex="0">Entendido</div> ' +
    '<div class="hf2-btn ghost small" data-focusable="true" data-action="help-guide" data-title="Ver la guía completa" tabindex="0">Ver la guía completa</div>' +
  "</div>";
}

var chatSearchTimer = null;

function onChatSearchInput() {
  if (chatSearchTimer) {
    clearTimeout(chatSearchTimer);
  }
  chatSearchTimer = setTimeout(function () {
    var input = byId("chatSearchInput");
    var keepFocus = document.activeElement === input;
    chatSearchTimer = null;
    settings.query = input ? input.value : "";
    if (currentRoute !== "settings") {
      return;
    }
    renderSettings("tools", 3);
    if (keepFocus) {
      input = byId("chatSearchInput");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, 350);
}

/* Cuenta los videos de las filas cerca del foco, cuando el foco se queda quieto (no en cada tecla). */
function scheduleSettingsCounts() {
  if (settings.countTimer) {
    clearTimeout(settings.countTimer);
  }
  settings.countTimer = setTimeout(function () {
    var a = currentArea();
    var ids;
    settings.countTimer = null;
    if (currentRoute !== "settings" || !a || a.name !== "list") {
      return;
    }
    ids = a.items.slice(Math.max(0, state.itemIndex - 3), state.itemIndex + 8).map(function (el) { return el.getAttribute("data-id"); })
      .filter(function (id) { return settings.counts[id] === undefined; });
    (function nextCount() {
      var id = ids.shift();
      if (!id || currentRoute !== "settings") {
        return;
      }
      HFTelegram.videoCount(id).then(function (n) { settings.counts[id] = n; }, function () { settings.counts[id] = -1; }).then(function () {
        var el = document.querySelector('[data-count-for="' + id + '"]');
        if (el) {
          el.textContent = settingsCountText(id);
        }
        nextCount();
      });
    })();
  }, 350);
}

function handleSettingsSelect(el) {
  var tab = el.getAttribute("data-tab");
  var filter = el.getAttribute("data-filter");
  var action = el.getAttribute("data-action");
  var id = el.getAttribute("data-id");
  var on;
  var a = currentArea();
  var idx = state.itemIndex;
  if (el.getAttribute("data-input")) {
    focusInput(byId(el.getAttribute("data-input")));
    return;
  }
  if (tab) { settings.typeTab = tab; renderSettings("tools", idx); return; }
  if (filter) { settings.filter = filter; renderSettings("tools", idx); return; }
  if (action === "done") { finishSettings(); return; }
  if (action === "help") { settings.helpOpen = true; renderSettings(); return; }
  if (action === "help-close") { settings.helpOpen = false; renderSettings("top", 0); return; }
  if (action === "help-guide") { settings.helpOpen = false; openGuide(function () { showRoute("settings"); renderSettings("top", 0); }); return; }
  if (action === "select-all" || action === "select-none") {
    settingsVisibleDialogs().forEach(function (d) {
      if (action === "select-all") { settings.selected[d.id] = d.title; } else { delete settings.selected[d.id]; }
    });
    renderSettings("tools", idx);
    updateStatus(action === "select-all" ? "Se activaron todos los chats de esta lista" : "Se desactivaron todos los chats de esta lista");
    return;
  }
  if (id) {
    on = !settings.selected[id];
    if (on) { settings.selected[id] = el.getAttribute("data-title"); } else { delete settings.selected[id]; }
    if (settings.filter === "selected" && !on) {
      renderSettings("list", Math.max(0, idx - 1));
    } else {
      el.className = "hf2-chat" + (on ? " on" : "");
      el.querySelector(".hf2-check").innerHTML = on ? IC.check : "";
      el._hfDescription = on ? "Activo · OK para quitarlo" : "OK para usarlo en la biblioteca";
      var segCount = document.querySelector('#scrSettings [data-filter="selected"] b');
      if (segCount) { segCount.textContent = Object.keys(settings.selected).length; }
    }
    updateStatus((on ? "Activado: " : "Desactivado: ") + el.getAttribute("data-title") + " · " + settingsSummary());
  }
}

function finishSettings() {
  var pid = settings.profile.id;
  var before = Object.keys(HFLibrary.enabledSources(pid) || {}).sort().join(",");
  var after = Object.keys(settings.selected).sort().join(",");
  var isActive = activeProfile && activeProfile.id === pid;
  HFLibrary.setEnabledSources(settings.selected, pid);
  if (isActive) {
    rebuildLibrary();
  }
  if (settings.returnTo === "profile-edit") {
    returnToProfileEditor("Chats de " + settings.profile.name + " guardados");
  } else if (settings.firstTime || settings.returnTo === "profiles" || !activeProfile) {
    openProfiles(after ? "Chats guardados. ¿Quién está viendo?" : "Sin chats activos: puedes elegirlos luego en Ajustes");
  } else {
    openBrowse(browse.section, "Chats guardados");
  }
  if (before !== after && isActive) {
    syncLibrary();
  }
}

/* ===================== Guía «Cómo etiquetar» ===================== */

var guideBack = null;

function openGuide(back) {
  guideBack = back || null;
  showRoute("guide");
  var root = byId("scrGuide");
  var formats = [
    ["Película", "pelicula#<b>Coco (2017)</b>#<i>Un niño viaja…</i>", "El año entre paréntesis es opcional"],
    ["Capítulo", "serie(<b>1/3</b>)#<b>Bluey</b>#<i>Juegan a los médicos</i>", "Temporada 1, capítulo 3"],
    ["Con título", "serie(1/3)#Bluey#<b>El hospital</b>#<i>…</i>", "Un campo más para el título del capítulo"],
    ["Portada", "<b>Foto</b> con serie#<b>Bluey</b>#<i>Resumen</i>", "Una foto con ese comentario pone portada y resumen"],
    ["Infantil", "… <b>#infantil</b>", "Al final del comentario: lo ven los perfiles infantiles"],
    ["Categoría", "… <b>#Marvel #Acción</b>", "Al final: cada categoría tiene su fila en Inicio"]
  ];
  var hasUnclassified = library.unclassified && library.unclassified.length;
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-top-actions">' +
      (hasUnclassified ? '<span class="hf2-btn ghost small icon top" data-focusable="true" data-action="go-unclassified" data-title="Ir a Sin clasificar" tabindex="0">' + IC.tag + "Ir a Sin clasificar</span>" : "") +
      '<span class="hf2-btn primary small top" data-focusable="true" data-action="close" data-title="Entendido" tabindex="0">Entendido</span>' +
    "</div>" +
    '<div class="hf2-guide"><div class="hf2-kicker">Guía</div><h1 class="hf2-title">Cómo ordena HomeFlix tus videos</h1>' +
    '<p class="hf2-text wide">Cada video necesita decir si es una película o un capítulo de una serie. Hay dos formas: usa la que te quede más cómoda.</p>' +
    '<div class="hf2-guide-cols">' +
      '<div class="hf2-guide-card"><div class="hf2-guide-head"><span class="hf2-guide-ic">' + IC.phone + '</span><div><b>Desde Telegram</b><small>Al subir el video, escribe su comentario así</small></div><span class="hf2-chip gold">Recomendado</span></div>' +
        '<div class="hf2-tg"><div class="hf2-tg-bubble"><div class="hf2-tg-video">' + HFArt.art(2, "guide") + '<span class="hf2-tg-play">' + IC.play + '</span><span class="hf2-tg-dur">7:12</span></div>' +
          '<div class="hf2-tg-caption"><span class="k">serie(1/3)</span>#<span class="n">Reino del océano</span>#<span class="d">Los delfines encuentran un mapa antiguo.</span> <span class="k">#infantil</span></div><div class="hf2-tg-time">21:04 ✓✓</div></div>' +
          '<div class="hf2-tg-arrow">→</div><div class="hf2-tg-result"><div class="hf2-tg-result-art">' + HFArt.art(2, "guide2") + '<span class="hf2-card-type">T1:E3</span><span class="hf2-card-kids">' + IC.star + "</span></div><b>Reino del océano</b><small>Temporada 1 · Capítulo 3</small></div></div>" +
        '<div class="hf2-formats">' + formats.map(function (f) { return '<div class="hf2-format"><span class="hf2-format-k">' + f[0] + "</span><code>" + f[1] + '</code><span class="hf2-format-n">' + f[2] + "</span></div>"; }).join("") + "</div></div>" +
      '<div class="hf2-guide-card side"><div class="hf2-guide-head"><span class="hf2-guide-ic">' + IC.tv + '</span><div><b>Desde la TV</b><small>Para los videos que ya subiste sin comentario</small></div></div>' +
        '<ol class="hf2-steps compact"><li><span>1</span><div>Abre la fila <b>Sin clasificar</b> en Inicio.</div></li><li><span>2</span><div>Elige el video y pulsa <b>Etiquetar</b>.</div></li><li><span>3</span><div>Con ◀ ▶ dices si es película o capítulo, la serie, la temporada y el capítulo.</div></li></ol>' +
        '<div class="hf2-mini-editor"><div class="hf2-mini-row"><span>Tipo</span><b>◀ Capítulo de serie ▶</b></div><div class="hf2-mini-row on"><span>Serie</span><b>◀ Reino del océano ▶</b></div><div class="hf2-mini-row"><span>Temporada · Capítulo</span><b>1 · 3</b></div><div class="hf2-mini-row"><span>Infantil</span><b>' + IC.star + " Sí</b></div></div>" +
        '<div class="hf2-guide-note">' + IC.tag + "La etiqueta se guarda en esta TV y no cambia nada en Telegram.</div></div>" +
    "</div></div>";
  setAreas([{ name: "top", items: root.querySelectorAll(".hf2-top-actions [data-focusable]"), dir: "h" }], 0, hasUnclassified ? 1 : 0);
  updateStatus("Puedes volver a esta guía desde la ayuda (?) en Ajustes");
}

function closeGuide() {
  if (guideBack) {
    guideBack();
  } else if (activeProfile) {
    openBrowse(browse.section);
  } else {
    openProfiles();
  }
}

function handleGuideSelect(el) {
  var action = el.getAttribute("data-action");
  if (action === "go-unclassified") {
    browse.section = "home";
    showRoute("browse");
    renderBrowse("row-unclassified", 0);
    return;
  }
  closeGuide();
}

/* ===================== Catálogo ===================== */

var browse = { section: "home", hero: { home: 0, movies: 0, series: 0 } };

var MENU = [
  { id: "home", label: "Inicio" },
  { id: "movies", label: "Películas" },
  { id: "series", label: "Series" },
  { id: "mylist", label: "Mi lista" }
];

function openBrowse(section, message) {
  browse.section = section || browse.section || "home";
  showRoute("browse");
  renderBrowse(null, 0);
  if (message) {
    updateStatus(message);
  }
  if (!syncing && librarySyncDue()) {
    syncLibrary();
  }
  setSyncBadge();
}

function topbarHtml(active) {
  var p = activeProfile || { name: "Perfil", avatar: "panda" };
  return '<div class="hf2-topbar">' + brandHtml("small") +
    '<nav class="hf2-menu">' + MENU.map(function (m) {
      return '<span class="' + (m.id === active ? "on" : "") + '" data-focusable="true" data-menu="' + m.id + '" data-title="' + m.label + '" data-description="' + m.label + '" tabindex="0">' + m.label + "</span>";
    }).join("") + "</nav>" +
    '<div class="hf2-top-right"><span class="hf2-sync-badge" id="syncBadge"></span>' +
      '<span class="hf2-round sm" data-focusable="true" data-menu="search" data-title="Buscar" data-description="Buscar películas y series" tabindex="0">' + IC.search + "</span>" +
      (currentProfileIsKids() ? "" : '<span class="hf2-round sm" data-focusable="true" data-menu="settings" data-title="Ajustes" data-description="Chats de la biblioteca" tabindex="0">' + IC.gear + "</span>") +
      '<span class="hf2-me" data-focusable="true" data-menu="profiles" data-title="' + esc(p.name) + '" data-description="Cambiar de perfil" tabindex="0"><span class="hf2-me-avatar">' + avatarSvg(p.avatar) + "</span>" + esc(p.name) + "</span>" +
    "</div></div>";
}

function continueWatching() {
  var all = HFLibrary.allProgress();
  var seenSeries = {};
  return Object.keys(all).filter(function (k) { return !all[k].done && all[k].t > 0 && library.byKey[k]; })
    .sort(function (a, b) { return all[b].at - all[a].at; })
    .map(function (k) { return library.byKey[k]; })
    .filter(function (e) {
      if (e.type !== "episode") { return true; }
      if (seenSeries[e.seriesKey]) { return false; }
      seenSeries[e.seriesKey] = true;
      return true;
    })
    .slice(0, 20);
}

function myListTitles() {
  return HFLibrary.myList().map(function (k) { return library.titles[k]; }).filter(Boolean);
}

function byDateDesc(a, b) {
  return (b.date || 0) - (a.date || 0);
}

/* Destacado (billboard) de un título; buttons: [{action, label, icon, primary}] */
function billboardHtml(t, opts) {
  var badges = '<span class="hf2-chip gold">' + (t.type === "movie" ? "Película" : "Serie") + "</span>" +
    (opts.isNew ? '<span class="hf2-chip">Nuevo</span>' : "") +
    (t.kids ? '<span class="hf2-chip kids">' + IC.star + "Infantil</span>" : "");
  var meta;
  var buttons;
  var next;
  var p;
  if (t.type === "movie") {
    meta = (t.year ? "<b>" + t.year + "</b>" : "") + (t.video.duration ? "<span>" + HFLibrary.formatDuration(t.video.duration) + "</span>" : "") + (t.quality ? '<span class="hf2-q">' + t.quality + "</span>" : "");
    p = HFLibrary.progress(t.video.key);
    buttons = '<span class="hf2-btn primary small icon" data-focusable="true" data-action="hero-play" data-title="Reproducir" tabindex="0">' + IC.play + (p && !p.done && p.t > 0 ? "Reanudar" : "Reproducir") + "</span>";
  } else {
    meta = "<b>" + t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas") + "</b><span>" + t.episodeCount + " capítulos</span>";
    next = HFLibrary.nextEpisode(t);
    buttons = '<span class="hf2-btn primary small icon" data-focusable="true" data-action="hero-play" data-title="Reproducir" tabindex="0">' + IC.play +
      (next.episode ? (next.started && next.resume > 0 ? "Continuar" : "Ver") + " T" + next.episode.season + ":E" + next.episode.episode : "Reproducir") + "</span>";
  }
  buttons += '<span class="hf2-btn ghost small icon" data-focusable="true" data-action="hero-info" data-title="Más info" tabindex="0">' + IC.info + (t.type === "series" ? "Capítulos" : "Más info") + "</span>" +
    '<span class="hf2-round" data-focusable="true" data-action="hero-list" data-title="Mi lista" data-description="' + (HFLibrary.inMyList(t.titleKey) ? "En tu lista · OK para quitarla" : "Agregar a Mi lista") + '" tabindex="0">' + (HFLibrary.inMyList(t.titleKey) ? IC.check : IC.plus) + "</span>";
  return '<div class="hf2-billboard' + (opts.compact ? " compact" : "") + '" id="billboard" data-ref="t:' + esc(t.titleKey) + '">' +
    '<div class="hf2-bb-art hf2-img"' + (t.bannerKey || t.imageKey ? ' data-img="' + esc(t.bannerKey || t.imageKey) + '" data-img-w="1280"' : "") + ">" + fallbackArt() + "</div>" +
    '<div class="hf2-bb-shade"></div><div class="hf2-bb-copy"><div class="hf2-bb-badges">' + badges + "</div>" +
    "<h1" + (t.name.length > 20 ? ' class="long"' : "") + ">" + esc(t.name) + "</h1>" +
    '<div class="hf2-bb-meta">' + meta + "</div>" + (t.description ? "<p>" + esc(t.description) + "</p>" : "") +
    '<div class="hf2-bb-actions">' + buttons + "</div>" +
    (opts.count > 1 ? '<div class="hf2-bb-switch"><span class="hf2-bb-dots" data-focusable="true" data-action="hero-next" data-title="Otros destacados" data-description="◀ ▶ para cambiar de título" tabindex="0">' +
      '<span class="sel"><b class="arr">' + IC.back + '</b><span class="pts">' + opts.dots + '</span><b class="arr next">' + IC.back + "</b></span>" +
      "<small>" + (opts.index + 1) + " de " + opts.count + "</small></span></div>" : "") +
    "</div></div>";
}

function dotsHtml(count, index) {
  var s = "";
  var i;
  for (i = 0; i < Math.min(count, 6); i += 1) {
    s += "<i" + (i === index % 6 ? ' class="on"' : "") + "></i>";
  }
  return s;
}

/* Películas o Series sin nada todavía (el resto de la biblioteca sí tiene): un aviso en vez de la pantalla en blanco. */
function sectionEmptyHtml(section) {
  var isSeries = section === "series";
  var other = isSeries ? "movies" : "series";
  var otherCount = isSeries ? library.movies.length : library.series.length;
  return '<div class="hf2-glow"></div><div class="hf2-empty"><div class="hf2-empty-art"><div class="hf2-logo big"></div></div>' +
    "<h2>" + (isSeries ? "Todavía no hay series" : "Todavía no hay películas") + "</h2>" +
    "<p>Nada por aquí todavía. Cuando se publique " + (isSeries ? "una serie" : "una película") + " en tus chats, aparecerá en esta sección." +
    (isSeries ? " Cada capítulo se publica con <b>serie(1/1)#Nombre#Título</b>." : " Se publica con <b>pelicula#Nombre (año)#descripción</b>.") + "</p>" +
    '<div class="hf2-actions center">' +
      (otherCount ? '<span class="hf2-btn primary small icon" data-focusable="true" data-menu="' + other + '" data-title="' + (isSeries ? "Ver películas" : "Ver series") + '" tabindex="0">' +
        (isSeries ? IC.play : IC.list) + (isSeries ? "Ver películas" : "Ver series") + "</span>" : "") +
      (currentProfileIsKids() ? "" : '<span class="hf2-btn ' + (otherCount ? "ghost" : "primary") + ' small icon" data-focusable="true" data-action="guide" data-title="Cómo publicar" tabindex="0">' + IC.tag + "Cómo publicar</span>") +
    "</div></div>";
}

function emptyHtml() {
  if (currentProfileIsKids()) {
    return '<div class="hf2-glow"></div><div class="hf2-empty"><div class="hf2-empty-art"><div class="hf2-logo big"></div></div><h2>Todavía no hay contenido infantil</h2>' +
      "<p>Desde un perfil de adulto, abre una película o serie y pulsa «Editar» → Infantil: Sí. También sirve agregar <b>#infantil</b> al final del comentario en Telegram.</p></div>";
  }
  var noSources = !enabledSourceIds().length;
  return '<div class="hf2-glow"></div><div class="hf2-empty"><div class="hf2-empty-art"><div class="hf2-logo big"></div></div>' +
    "<h2>" + (syncing ? "Buscando videos en tus chats…" : noSources ? "Tu biblioteca está vacía" : "No encontramos videos") + "</h2>" +
    "<p>" + (syncing ? esc(syncProgress) : noSources ? "HomeFlix muestra los videos de los chats de Telegram que elijas. Elige dónde subes tus películas y series, y aparecerán aquí." : "Los chats activos no tienen videos todavía. Al subir cada video, escribe su comentario con el formato, o etiquétalo desde la TV.") + "</p>" +
    '<div class="hf2-empty-steps"><div><span>1</span><b>Elige tus chats</b><small>Grupos o canales donde subes los videos</small></div>' +
    "<div><span>2</span><b>Pon nombre a cada video</b><small>En su comentario de Telegram, o desde la TV</small></div>" +
    "<div><span>3</span><b>Disfruta</b><small>Películas y series ordenadas, con portada</small></div></div>" +
    '<div class="hf2-actions center"><span class="hf2-btn primary small icon" data-focusable="true" data-action="settings" data-title="Elegir chats" tabindex="0">' + IC.chat + "Elegir chats</span>" +
    '<span class="hf2-btn ghost small icon" data-focusable="true" data-action="guide" data-title="Cómo etiquetar" tabindex="0">' + IC.tag + "Cómo etiquetar</span></div></div>";
}

function gridHtml(titles) {
  var rows = [];
  var i;
  for (i = 0; i < titles.length; i += 5) {
    rows.push('<div class="hf2-grid-row" style="display:flex">' + titles.slice(i, i + 5).map(function (t) { return cardHtml(t); }).join("") + "</div>");
  }
  return '<div class="hf2-grid">' + rows.join("") + "</div>";
}

/* Una fila por categoría (#Marvel, #Terror… en el comentario). withKids agrega «Infantil» con lo marcado #infantil.
 * Las categorías con algo agregado hace poco van primero. titles ya viene del más nuevo al más viejo. */
function categoryRows(titles, prefix, withKids) {
  var groups = {};
  var order = [];
  titles.forEach(function (t) {
    var cats = (t.categories || []).slice();
    if (withKids && t.kids) {
      cats.push("Infantil");
    }
    cats.forEach(function (c) {
      var id = normText(c).replace(/[^a-z0-9]+/g, "-");
      if (!groups[id]) {
        groups[id] = { name: c, items: [] };
        order.push(id);
      }
      if (groups[id].items.indexOf(t) < 0) {
        groups[id].items.push(t);
      }
    });
  });
  return order.map(function (id) {
    var g = groups[id];
    return [prefix + "-" + id, g.name, g.items, { note: g.items.length === 1 ? "1 título" : g.items.length + " títulos" }];
  });
}

/* Contenido de cada sección: {hero: título destacado | null, rows: [[id, título, entradas, opts]], empty} */
function sectionContent(section) {
  var movies = library.movies.slice().sort(byDateDesc);
  var series = library.series.slice().sort(byDateDesc);
  var rows = [];
  var heroList;
  var started;
  if (section === "home") {
    heroList = library.recent.slice(0, 6);
    var cw = continueWatching();
    if (cw.length) { rows.push(["continue", "Continuar viendo", cw, { loop: false, progress: true }]); }
    if (library.recent.length) { rows.push(["recent", "Agregados recientemente", library.recent.slice(0, 5), { loop: false, note: "los últimos 5" }]); }
    rows = rows.concat(categoryRows(movies.concat(series).sort(byDateDesc), "c", !currentProfileIsKids()));
    if (library.movies.length) { rows.push(["movies", "Todas las películas", movies, { note: String(movies.length) }]); }
    if (library.series.length) { rows.push(["series", "Series", series, { note: String(series.length) }]); }
    if (myListTitles().length) { rows.push(["mylist", "Mi lista", myListTitles()]); }
    if (library.unclassified.length) { rows.push(["unclassified", "Sin clasificar", library.unclassified.slice(0, 40), { loop: false, note: "Videos sin nombre: ábrelos y usa Etiquetar" }]); }
  } else if (section === "movies") {
    heroList = movies.slice(0, 6);
    if (movies.length) { rows.push(["m-recent", "Recién agregadas", movies.slice(0, 20), { note: String(movies.length) }]); }
    var kidsMovies = movies.filter(function (m) { return m.kids; });
    if (kidsMovies.length && !currentProfileIsKids()) { rows.push(["m-kids", "Para niños", kidsMovies, { note: kidsMovies.length + " infantiles" }]); }
    rows = rows.concat(categoryRows(movies, "mc", false));
    var longMovies = movies.filter(function (m) { return m.video.duration >= 100 * 60; });
    if (longMovies.length) { rows.push(["m-long", "Para una noche de cine", longMovies, { note: "más de 1 h 40 min" }]); }
    if (movies.length) { rows.push(["m-all", "Todas de la A a la Z", library.movies]); }
  } else if (section === "series") {
    started = series.filter(function (s) { var n = HFLibrary.nextEpisode(s); return n.started && !n.finished; });
    heroList = (started.length ? started : series).slice(0, 6);
    if (started.length) {
      rows.push(["s-started", "Series que empezaste", started.map(function (s) { return HFLibrary.nextEpisode(s).episode; }), { loop: false, progress: true }]);
    }
    if (series.length) { rows.push(["s-recent", "Recién agregadas", series.slice(0, 20), { note: String(series.length) }]); }
    var kidsSeries = series.filter(function (s) { return s.kids; });
    if (kidsSeries.length && !currentProfileIsKids()) { rows.push(["s-kids", "Para niños", kidsSeries, { note: kidsSeries.length + " infantiles" }]); }
    rows = rows.concat(categoryRows(series, "sc", false));
    if (series.length) { rows.push(["s-all", "Todas de la A a la Z", library.series]); }
  }
  return { heroList: heroList || [], rows: rows };
}

function renderBrowse(focusName, focusIndex) {
  var root = byId("scrBrowse");
  var section = browse.section;
  var html = "";
  var content;
  var hero = null;
  var heroIdx;
  var defs = [];
  var scroll;

  if (section === "mylist") {
    var titles = myListTitles();
    html = '<div class="hf2-page" style="top:120px"><div class="hf2-grid-head"><h2>Mi lista <span>' + titles.length + " títulos</span></h2></div>" +
      (titles.length ? gridHtml(titles) : '<p class="hf2-text" style="margin-left:88px">En la ficha de una película o serie pulsa «+ Mi lista» para guardarla aquí.</p>') + "</div>";
  } else if (!library.recent.length && !library.unclassified.length) {
    html = emptyHtml();
  } else if ((section === "series" && !library.series.length) || (section === "movies" && !library.movies.length)) {
    html = sectionEmptyHtml(section);
  } else {
    content = sectionContent(section);
    if (content.heroList.length) {
      heroIdx = (browse.hero[section] || 0) % content.heroList.length;
      hero = content.heroList[heroIdx];
      html += billboardHtml(hero, { compact: section !== "home", isNew: section === "home", dots: dotsHtml(content.heroList.length, heroIdx), index: heroIdx, count: content.heroList.length });
    }
    html += '<div class="hf2-rows" style="margin-top:' + (hero ? 28 : 150) + 'px">' +
      content.rows.map(function (r) { return rowHtml(r[0], r[1], r[2], r[3]); }).join("") + '<div style="height:120px"></div></div>';
    html = '<div class="hf2-scroll" id="browseScroll"><div class="hf2-scroll-inner">' + html + "</div></div>";
  }
  root.innerHTML = html + topbarHtml(section);
  setSyncBadge();

  defs.push({ name: "top", items: root.querySelectorAll(".hf2-topbar [data-focusable]"), dir: "h" });
  scroll = byId("browseScroll");
  if (hero) {
    defs.push({ name: "hero", items: root.querySelectorAll("#billboard .hf2-bb-actions [data-focusable]"), dir: "h", page: scroll, follow: "top" });
    if (content.heroList.length > 1) {
      /* Fila propia bajo los botones: ◀ ▶ cambian de título sin tener que cruzar los botones */
      defs.push({ name: "hero-dots", items: root.querySelectorAll("#billboard .hf2-bb-dots"), dir: "h", page: scroll, follow: "top", edge: switchHero });
    }
  }
  if (scroll) {
    defs = defs.concat(rowAreas(root, scroll));
  }
  toArray(root.querySelectorAll(".hf2-grid-row")).forEach(function (row, i) {
    defs.push({ name: "grid-" + i, items: row.querySelectorAll(".hf2-card"), dir: "h", keepColumn: true });
  });
  if (root.querySelector(".hf2-empty [data-focusable]")) {
    defs.push({ name: "empty", items: root.querySelectorAll(".hf2-empty [data-focusable]"), dir: "h" });
  }
  if (focusName) {
    setAreas(defs, focusName, focusIndex);
    if (!currentArea() || currentArea().name !== focusName) {
      setAreas(defs, defs.length > 1 ? 1 : 0, 0);
    }
  } else {
    setAreas(defs, defs.length > 1 ? 1 : 0, 0);
  }
  observeImages(root);
  shapeHeroSwitch(root.querySelector(".hf2-bb-dots"));
  if (hero) {
    if (browse.heroDir) {
      animateHero(byId("billboard"), browse.heroDir);
      browse.heroDir = 0;
    }
    updateStatus(hero.name + " · " + titleMeta(hero));
  }
}

/* Contorno del selector de destacados: una sola figura, ancha arriba (flechas y puntos) y con una pestaña
 * más angosta abajo (contador), unidas con curvas hacia adentro. Se dibuja en SVG con las medidas reales. */
function shapeHeroSwitch(el) {
  var sel = el && el.querySelector(".sel");
  var tab = el && el.querySelector("small");
  var W, H1, H, w2, x0, R, c, rb, d;
  if (!sel || !tab) {
    return;
  }
  W = sel.offsetWidth;
  H1 = sel.offsetHeight;
  H = H1 + tab.offsetHeight;
  R = Math.min(20, Math.floor(H1 / 2));
  c = 10;
  rb = 14;
  w2 = Math.min(tab.offsetWidth, W - 2 * (R + c));
  x0 = Math.round((W - w2) / 2);
  d = "M" + (1 + R) + " 1H" + (W - 1 - R) + "A" + R + " " + R + " 0 0 1 " + (W - 1) + " " + (1 + R) +
    "V" + (H1 - 1 - R) + "A" + R + " " + R + " 0 0 1 " + (W - 1 - R) + " " + (H1 - 1) +
    "H" + (x0 + w2 + c) + "A" + c + " " + c + " 0 0 0 " + (x0 + w2) + " " + (H1 - 1 + c) +
    "V" + (H - 1 - rb) + "A" + rb + " " + rb + " 0 0 1 " + (x0 + w2 - rb) + " " + (H - 1) +
    "H" + (x0 + rb) + "A" + rb + " " + rb + " 0 0 1 " + x0 + " " + (H - 1 - rb) +
    "V" + (H1 - 1 + c) + "A" + c + " " + c + " 0 0 0 " + (x0 - c) + " " + (H1 - 1) +
    "H" + (1 + R) + "A" + R + " " + R + " 0 0 1 1 " + (H1 - 1 - R) +
    "V" + (1 + R) + "A" + R + " " + R + " 0 0 1 " + (1 + R) + " 1Z";
  el.insertAdjacentHTML("afterbegin", '<svg class="shape" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '"><path d="' + d + '"/></svg>');
}

/* Cambia el destacado de la sección actual (dir: 1 siguiente, -1 anterior) y deja el foco en los puntos. */
function switchHero(dir) {
  var list = sectionContent(browse.section).heroList;
  var section = browse.section;
  if (list.length < 2) {
    return;
  }
  browse.hero[section] = ((browse.hero[section] || 0) % list.length + dir + list.length) % list.length;
  browse.heroDir = dir;
  renderBrowse("hero-dots", 0);
}

/* Entrada del título nuevo: la imagen llega desde el lado del cambio con un pequeño rebote y el texto se reparte detrás, en cascada. */
function animateHero(el, dir) {
  if (!el) {
    return;
  }
  el.classList.add(dir > 0 ? "enter-next" : "enter-prev");
  setTimeout(function () {
    el.classList.remove("enter-next");
    el.classList.remove("enter-prev");
  }, 900);
}

function entryFromRef(ref) {
  if (!ref) {
    return null;
  }
  if (ref.indexOf("t:") === 0) {
    return library.titles[ref.slice(2)] || null;
  }
  return library.byKey[ref.slice(2)] || null;
}

function playTitle(t) {
  var next;
  var p;
  if (t.type === "series") {
    next = HFLibrary.nextEpisode(t);
    if (next.episode) {
      openPlayer(next.episode, next.resume || 0, t);
    }
    return;
  }
  p = HFLibrary.progress(entryVideoKey(t));
  openPlayer(t, p && !p.done ? p.t : 0, null);
}

function handleBrowseSelect(el) {
  var menu = el.getAttribute("data-menu");
  var action = el.getAttribute("data-action");
  var a = currentArea();
  var entry;
  var hero;
  var added;
  if (menu) {
    if (menu === "search") { openSearch(); return; }
    if (menu === "settings") { openSettings({ returnTo: "browse" }); return; }
    if (menu === "profiles") { openProfiles("¿Quién está viendo?"); return; }
    browse.section = menu;
    renderBrowse("top", MENU.map(function (m) { return m.id; }).indexOf(menu));
    return;
  }
  if (action === "settings") { openSettings({ returnTo: "browse" }); return; }
  if (action === "guide") { openGuide(); return; }
  if (action === "hero-next") { switchHero(1); return; }
  if (action && action.indexOf("hero-") === 0) {
    hero = entryFromRef(byId("billboard").getAttribute("data-ref"));
    if (!hero) { return; }
    if (action === "hero-play") { playTitle(hero); }
    else if (action === "hero-info") { openDetail(hero); }
    else if (action === "hero-list") {
      added = HFLibrary.toggleMyList(hero.titleKey);
      el.innerHTML = added ? IC.check : IC.plus;
      el._hfDescription = added ? "En tu lista · OK para quitarla" : "Agregar a Mi lista";
      updateStatus(added ? "Agregada a Mi lista" : "Quitada de Mi lista");
    }
    return;
  }
  entry = entryFromRef(el.getAttribute("data-ref"));
  if (!entry) {
    return;
  }
  /* «Continuar viendo» y «Series que empezaste»: se reanuda directo */
  if (a && (a.name === "row-continue" || a.name === "row-s-started")) {
    if (entry.type === "episode") {
      openPlayer(entry, (HFLibrary.progress(entry.key) || {}).t || 0, library.titles[entry.seriesKey]);
    } else {
      openPlayer(entry, (HFLibrary.progress(entryVideoKey(entry)) || {}).t || 0, null);
    }
    return;
  }
  if (entry.type === "episode") {
    openDetail(library.titles[entry.seriesKey], { episodeKey: entry.key });
    return;
  }
  openDetail(entry);
}

/* ===================== Buscar ===================== */

var searchTimer = null;

function recentSearches() {
  try {
    return JSON.parse(window.localStorage.getItem("hf.recentSearch") || "[]");
  } catch (e) {
    return [];
  }
}

function rememberSearch(q) {
  var list = recentSearches().filter(function (x) { return normText(x) !== normText(q); });
  list.unshift(q);
  try {
    window.localStorage.setItem("hf.recentSearch", JSON.stringify(list.slice(0, 6)));
  } catch (e) {
    /* nada */
  }
}

function openSearch() {
  showRoute("search");
  byId("searchTopbar").innerHTML = topbarHtml("");
  var searchBtn = document.querySelector('#searchTopbar [data-menu="search"]');
  if (searchBtn) {
    searchBtn.style.background = "linear-gradient(180deg,#f0d2a8,#c99a66)";
  }
  renderSearchResults("input", 0);
  focusInput(byId("searchInput"));
}

function renderSearchResults(focusName, focusIndex) {
  var raw = byId("searchInput").value;
  var q = normText(raw).trim();
  var results = [];
  var body = byId("searchBody");
  var recent = recentSearches();
  var html = "";
  if (q) {
    results = library.movies.concat(library.series).filter(function (t) {
      return normText(t.name).indexOf(q) >= 0 || normText(t.description).indexOf(q) >= 0;
    }).concat(library.unclassified.filter(function (u) { return normText(u.name).indexOf(q) >= 0; }).slice(0, 10));
  }
  if (recent.length) {
    html += '<div class="hf2-recent"><span class="lbl">Recientes</span>' + recent.map(function (r) {
      return '<span class="hf2-chip" data-focusable="true" data-recent="' + esc(r) + '" data-title="' + esc(r) + '" data-description="Buscar «' + esc(r) + '»" tabindex="0">' + esc(r) + "</span>";
    }).join("") + "</div>";
  } else {
    html += '<div style="height:44px"></div>';
  }
  if (!q) {
    html += '<div class="hf2-grid-head small"><h2>' + library.movies.length + " películas y " + library.series.length + " series en tu biblioteca</h2></div>";
  } else if (!results.length) {
    html += '<div class="hf2-grid-head small"><h2>Sin resultados para «' + esc(raw) + "»</h2></div>";
  } else {
    html += '<div class="hf2-grid-head small"><h2>' + results.length + (results.length === 1 ? " resultado" : " resultados") + " para «" + esc(raw) + "»</h2></div>" + gridHtml(results.slice(0, 15));
  }
  body.innerHTML = html;
  var defs = [
    { name: "top", items: document.querySelectorAll("#searchTopbar [data-focusable]"), dir: "h" },
    { name: "input", items: document.querySelectorAll("#scrSearch .hf2-searchbox"), dir: "h" },
    { name: "recent", items: body.querySelectorAll(".hf2-recent [data-focusable]"), dir: "h" }
  ];
  toArray(body.querySelectorAll(".hf2-grid-row")).forEach(function (row, i) {
    defs.push({ name: "grid-" + i, items: row.querySelectorAll(".hf2-card"), dir: "h", keepColumn: true });
  });
  setAreas(defs, focusName || "input", focusIndex || 0);
  observeImages(body);
}

function onSearchInput() {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(function () {
    searchTimer = null;
    if (currentRoute === "search") {
      renderSearchResults("input", 0);
    }
  }, 300);
}

function handleSearchSelect(el) {
  var entry;
  var recent = el.getAttribute("data-recent");
  if (el.getAttribute("data-menu")) {
    handleBrowseSelect(el);
    return;
  }
  if (el.getAttribute("data-input")) {
    focusInput(byId("searchInput"));
    return;
  }
  if (recent) {
    byId("searchInput").value = recent;
    renderSearchResults("grid-0", 0);
    return;
  }
  entry = entryFromRef(el.getAttribute("data-ref"));
  if (entry) {
    if (byId("searchInput").value.trim()) {
      rememberSearch(byId("searchInput").value.trim());
    }
    openDetail(entry);
  }
}
