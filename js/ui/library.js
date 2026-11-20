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
  /* canal Anime (js/anime.js): sus títulos van en library.anime y en titles/byKey, no en Películas ni Series */
  if (!currentProfileIsKids() && typeof HFAnime !== "undefined") {
    library = HFAnime.mergeInto(Object.assign({}, library, { titles: Object.assign({}, library.titles), byKey: Object.assign({}, library.byKey) }));
  } else {
    library.anime = [];
  }
}

function currentProfileIsKids() {
  return !!(activeProfile && activeProfile.kids);
}

/* Los chats de Telegram activos del perfil (el canal fijo «Anime» no es de Telegram: ver animeOn). */
function enabledSourceIds() {
  return Object.keys(HFLibrary.enabledSources() || {}).filter(function (id) { return id !== HFAnime.SOURCE; });
}

function animeOn() {
  return !currentProfileIsKids() && HFAnime.enabled();
}

/* Última tecla pulsada: repintar las filas mientras alguien navega las reinicia (se perdía la fila y no dejaba bajar). */
var lastKeyAt = 0;
document.addEventListener("keydown", function () { lastKeyAt = Date.now(); }, true);

function animeRowsSig() {
  return HFAnime.rows().map(function (r) { return r.id + ":" + r.titles.length; }).join("|");
}

/* Huella de lo que muestra el catálogo (títulos, portadas, categorías, versiones, lo que se está viendo y Mi lista): si no cambió
 * nada, no hay por qué repintar. Es barata (un recorrido y un hash corto). */
function hashText(s) {
  var h = 5381;
  var i;
  for (i = 0; i < s.length; i += 1) { h = ((h * 33) ^ s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

function browseSigNow() {
  var parts = [];
  var cw = [];
  (library.recent || []).forEach(function (t) {
    parts.push(t.titleKey + "|" + (t.imageKey || "") + "|" + (t.bannerKey || "") + "|" + (t.verticalKey || "") + "|" + (HFTelegram.imageStamp ? HFTelegram.imageStamp(t.imageKey, t.bannerKey, t.verticalKey) : "") + "|" + (t.date || 0) + "|" + (t.kids ? 1 : 0) + "|" + (t.categories || []).join(",") + "|" +
      (t.episodeCount || 0) + "|" + ((t.versions && t.versions.length) || 0) + "|" + (t.description || "").length);
  });
  (library.unclassified || []).forEach(function (u) { parts.push(u.key + "|" + u.name); });
  continueWatching().forEach(function (e) { cw.push(e.key || e.titleKey); });
  return browse.section + "#" + (library.recent || []).length + "," + (library.unclassified || []).length + "#" + hashText(parts.join("\n")) + "#" + cw.join(",") + "#" +
    HFLibrary.myList().join(",") + "#" + (browse.section === "anime" ? animeRowsSig() : "") + "#" + (typeof HFReco !== "undefined" ? HFReco.huella() : "");
}

/* Llegaron recomendaciones nuevas: repintar el catálogo (si cambió algo) o la ficha que se está mirando. */
if (typeof HFReco !== "undefined") {
  HFReco.onChange(function () {
    var a;
    if (currentRoute === "browse") {
      browseRepaint();
    } else if (currentRoute === "detail" && detail.title && detail.title.type === "movie" && !detail.title.anime) {
      a = currentArea();
      if (a && a.name === "actions") { renderDetail("actions", state.itemIndex); }
    }
  });
}

var paintedSig = "";    // lo que está pintado ahora (la huella de renderBrowse)
var repaintTimer = null;

/* Repinta el catálogo con lo nuevo SOLO si cambió algo y el control lleva ≥3 s quieto; si no, espera (o no hace nada). Repintar a
 * ciegas reiniciaba la fila y no dejaba bajar mientras se navegaba. */
function browseRepaint() {
  var sig;
  var f;
  clearTimeout(repaintTimer);
  repaintTimer = null;
  if (currentRoute !== "browse") { return; }
  sig = browseSigNow();
  if (sig === paintedSig) { return; }
  if (paintedSig && Date.now() - lastKeyAt < 3000) {
    repaintTimer = setTimeout(browseRepaint, 1500);
    return;
  }
  f = browseFocus();
  renderBrowse(f.name, f.index, true);
}

function animePaint() { browseRepaint(); }

/* El canal Anime trae su catálogo del servidor (UNA petición); al llegar algo nuevo se rearma la biblioteca y se repinta si se está viendo. */
function animeRefresh(force) {
  if (!animeOn()) { return; }
  HFAnime.refresh(function () {
    rebuildLibrary();
    animePaint();
  }, force);
}

function setSyncBadge() {
  var el = byId("syncBadge");
  var upd = updateInfo();
  if (!el) {
    return;
  }
  el.innerHTML = upd ? esc(updateBadgeText()) : "";
  el.setAttribute("data-state", "idle");
}

/* Aviso de la sincronización del catálogo: una píldora abajo al centro. «Sincronizando…» con el aro girando y un brillo que
 * cruza; al terminar se vuelve verde, el aro se convierte en un check que se dibuja, el texto sube y se reemplaza por
 * «Catálogo actualizado», una onda sale de la píldora y a los pocos segundos se va sola. Con error: rojo y una X.
 * Solo transform y opacity (la hace la GPU). Estilos: css/app.css («Aviso de sincronización»). */
var SyncToast = (function () {
  var el = null;
  var hideTimer = null;
  var killTimer = null;
  var SPIN = '<svg class="st-spin" viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="78 40"/></svg>';
  var CHECK = '<svg class="st-check" viewBox="0 0 44 44"><path d="M10.5 23.5l8 8 15-17.5" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg>';
  var CROSS = '<svg class="st-cross" viewBox="0 0 44 44"><path d="M13 13l18 18M31 13L13 31" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" pathLength="1"/></svg>';

  function ensure() {
    clearTimeout(killTimer);
    if (el && el.parentNode) { return el; }
    el = document.createElement("div");
    el.id = "syncToast";
    el.innerHTML = '<div class="st-pill"><i class="st-ring"></i><span class="st-clip"><i class="st-bg ok"></i><i class="st-bg bad"></i><i class="st-shine"></i></span>' +
      '<span class="st-icon">' + SPIN + CHECK + CROSS + '</span><span class="st-text"><b class="st-busy"></b><b class="st-end"></b></span></div>';
    (byId("app") || document.body).appendChild(el);
    return el;
  }
  function reflow(node) { return node.offsetWidth; }

  function busy(text) {
    var e = ensure();
    clearTimeout(hideTimer);
    e.querySelector(".st-busy").textContent = text;
    if (!e.classList.contains("on") || e.classList.contains("out") || e.classList.contains("done") || e.classList.contains("fail")) {
      e.classList.remove("out", "done", "fail");
      reflow(e);
      e.classList.add("on");
    }
  }
  function finish(kind, text, wait) {
    var e = ensure();
    clearTimeout(hideTimer);
    e.querySelector(".st-end").textContent = text;
    if (!e.classList.contains("on")) {
      e.classList.remove("out");
      reflow(e);
      e.classList.add("on");
    }
    e.classList.remove("done", "fail");
    reflow(e);
    e.classList.add(kind);
    hideTimer = setTimeout(hide, wait);
  }
  function hide() {
    clearTimeout(hideTimer);
    if (!el) { return; }
    el.classList.add("out");
    el.classList.remove("on");
    killTimer = setTimeout(function () {
      if (el && el.parentNode) { el.parentNode.removeChild(el); }
      el = null;
    }, 600);
  }
  return {
    busy: busy,
    done: function (text) { finish("done", text || "Catálogo actualizado", 2300); },
    fail: function (text) { finish("fail", text || "No se pudo sincronizar", 3400); },
    hide: hide
  };
}());

function librarySyncDue() {
  var now = Date.now();
  var acc = HFLibrary.accountId();
  return enabledSourceIds().some(function (id) { var t = syncedAt[acc + ":" + id]; return !t || now - t > 10 * 60 * 1000; });
}

/* Revisa los chats activos del perfil y rearma la biblioteca. La caché guarda los videos por chat:
 * lo revisado reemplaza lo de ese chat, y lo de otros perfiles se conserva. */
var syncWaiters = []; // avisos de «terminé» (syncLibrary(onDone)), p. ej. para «Ver en la TV» (js/ui/cast.js)
function flushSyncWaiters() {
  var w = syncWaiters;
  syncWaiters = [];
  w.forEach(function (fn) { try { fn(); } catch (e) { /* un aviso roto no frena a los demás */ } });
}

/* onDone (opcional) se llama al terminar, también si ya había una revisión en curso (al terminar esa).
 * opts.manual: la pidió el usuario (↻): la lectura completa se repite si pasó más de 1 h (si no, 6 h; ver js/catalog.js). */
function syncLibrary(onDone, opts) {
  var ids = enabledSourceIds();
  var all = [];
  var done = {};
  var failed = 0;
  var acc = HFLibrary.accountId();
  var i = 0;
  if (onDone) {
    syncWaiters.push(onDone);
  }
  if (syncing) {
    return; // la revisión en curso avisa al terminar
  }
  if (!telegramUser || !HFTelegram.available()) {
    flushSyncWaiters();
    return;
  }
  syncing = true;
  syncError = "";
  if (ids.length) { SyncToast.busy("Sincronizando catálogo…"); }
  function next() {
    if (HFLibrary.accountId() !== acc) {
      /* se cambió de cuenta a mitad de camino: lo leído era de la otra cuenta y se descarta */
      syncing = false;
      SyncToast.hide();
      setSyncBadge();
      flushSyncWaiters();
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
      if (ids.length) { if (failed) { SyncToast.fail(syncError); } else { SyncToast.done("Catálogo actualizado"); } }
      if (currentRoute === "browse") {
        browseRepaint(); // solo si cambió algo y nadie está navegando (antes se repintaba siempre y reiniciaba la fila)
        updateStatus("Biblioteca actualizada: " + library.movies.length + " películas, " + library.series.length + " series");
      }
      flushSyncWaiters();
      return;
    }
    syncProgress = "Actualizando " + (i + 1) + "/" + ids.length + "…";
    if (ids.length > 1) { SyncToast.busy("Sincronizando " + (i + 1) + " de " + ids.length + "…"); }
    setSyncBadge();
    HFCatalog.scanChat(ids[i], libraryItems.filter(function (it) { return itemChat(it) === String(ids[i]); }), opts).then(function (r) {
      all = all.concat(r.items);
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

var KIND_LABEL = { saved: "Guardados", channel: "Canal", group: "Grupo", user: "Chat privado", bot: "Bot", anime: "Fijo · en línea" };

/* El canal «Anime» está siempre, en todas las cuentas y arriba de la lista: no es un chat de Telegram (js/anime.js). */
function withAnimeDialog(list) {
  return [{ id: HFAnime.SOURCE, title: HFAnime.NAME, kind: "anime" }].concat((list || []).filter(function (d) { return String(d.id) !== HFAnime.SOURCE; }));
}

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
      settings.dialogs = withAnimeDialog(list);
      settings.loading = false;
      if (currentRoute === "settings") {
        renderSettings();
        updateStatus(settings.firstTime ? "Primer paso: activa los chats donde están tus videos" : settingsSummary());
      }
    }, function (e) {
      settings.loading = false;
      settings.dialogs = withAnimeDialog([]); // el canal Anime no depende de Telegram
      updateStatus("No se pudieron cargar los chats: " + errorText(e));
      if (currentRoute === "settings") {
        renderSettings();
      }
    });
  }
}

function isGroupKind(k) {
  return k === "saved" || k === "channel" || k === "group" || k === "anime";
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
  if (id === HFAnime.SOURCE) { return "catálogo en línea"; }
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
      '<div class="hf2-btn ghost small top" data-focusable="true" data-action="cardview" data-title="Vista de tarjetas" data-description="Cambia las tarjetas de películas y series entre vertical (póster) y horizontal" tabindex="0">Tarjetas: ' + (cardView(settings.profile.id) === "vertical" ? "Vertical" : "Horizontal") + "</div>" +
      '<div class="hf2-btn ghost small top" data-focusable="true" data-action="nextskip" data-title="Siguiente capítulo" data-description="Cuándo pasa solo al siguiente capítulo, y el tamaño y la transparencia de su aviso (para este perfil)" tabindex="0">Siguiente capítulo</div>' +
      (document.documentElement.getAttribute("data-web") === "pc" && window.HFTheme ? '<div class="hf2-btn ghost small top" data-focusable="true" data-action="theme" data-title="Apariencia" data-description="Cambia el aspecto del inicio: Clásica, Plaza Celeste…" tabindex="0">Apariencia: ' + esc(HFTheme.nombre()) + "</div>" : "") +
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
    '<p class="dim">«Para ti» y «Similares» usan datos de TMDB. Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB.</p>' +
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
      .filter(function (id) { return settings.counts[id] === undefined && id !== HFAnime.SOURCE; });
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
  if (action === "cardview") {
    setCardView(cardView(settings.profile.id) === "vertical" ? "horizontal" : "vertical", settings.profile.id);
    renderSettings("top", 1);
    updateStatus("Perfil " + settings.profile.name + ": tarjetas en vista " + (cardView(settings.profile.id) === "vertical" ? "vertical (póster)" : "horizontal"));
    return;
  }
  if (action === "nextskip") {
    openNextModal(settings.profile);
    return;
  }
  if (action === "theme") { if (window.HFTheme) { HFTheme.abrirSelector(); } return; }
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
    animeRefresh();
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

var browse = { section: "home", hero: { home: 0, movies: 0, series: 0, anime: 0 } };

var MENU = [
  { id: "home", label: "Inicio" },
  { id: "movies", label: "Películas" },
  { id: "series", label: "Series" },
  { id: "anime", label: "Anime" },
  { id: "mylist", label: "Mi lista" },
  { id: "live", label: "TV" }
];

/* Los ítems del menú que este perfil ve: «TV» no está en el perfil infantil; «Anime», solo si el perfil tiene el canal
 * activo; y un perfil que solo tiene Anime (sin chats de Telegram) no ve Inicio, Películas ni Series vacíos. */
function visibleMenu() {
  var anime = animeOn();
  var onlyAnime = anime && !enabledSourceIds().length;
  return MENU.filter(function (m) {
    if (m.id === "live") { return !currentProfileIsKids(); }
    if (m.id === "anime") { return anime; }
    if (onlyAnime && (m.id === "home" || m.id === "movies" || m.id === "series")) { return false; }
    return true;
  });
}

function menuIndex(id) {
  return visibleMenu().map(function (m) { return m.id; }).indexOf(id);
}

function openBrowse(section, message) {
  browse.section = section || browse.section || "home";
  /* una sección que este perfil no tiene (p. ej. Inicio en un perfil solo de Anime) se cambia por la primera que sí */
  if (menuIndex(browse.section) < 0 && browse.section !== "mylist") {
    browse.section = visibleMenu()[0].id;
  }
  showRoute("browse");
  renderBrowse(null, 0);
  if (message) {
    updateStatus(message);
  }
  if (!syncing && librarySyncDue()) {
    syncLibrary();
  }
  animeRefresh();
  setSyncBadge();
}

/* Botón «Actualizar» de la barra: lee otra vez los chats del perfil (títulos nuevos) y revisa si hay una versión nueva
 * de la app; si la hay, abre el modal de actualización (js/ui/updatemodal.js). */
function refreshCatalog() {
  var before = Object.keys(library.titles || {}).length;
  var btn = document.querySelector(".hf2-refresh");
  var catText = null;
  var verText = null;
  function settle() {
    var b;
    if (catText === null || verText === null) {
      return;
    }
    b = document.querySelector(".hf2-refresh");
    if (b) {
      b.classList.remove("spinning");
    }
    updateStatus(catText + (verText ? " · " + verText : ""));
  }
  if (btn) {
    btn.classList.add("spinning");
  }
  animeRefresh(true);
  updateStatus("Buscando películas, series y versiones nuevas…");
  checkUpdatesNow().then(function (info) {
    if (info && info.hay) {
      verText = "hay una versión nueva (v" + info.version + ")";
      openUpdateModal();
    } else {
      verText = "HomeFlix" + (appVersion() ? " v" + appVersion() : "") + " está al día";
    }
    settle();
  }, function () {
    verText = "no se pudo buscar una versión nueva";
    settle();
  });
  if (syncing) {
    catText = "Ya se está actualizando el catálogo…";
    settle();
    return;
  }
  syncLibrary(function () {
    var added = Object.keys(library.titles || {}).length - before;
    catText = syncError ? "No se pudo actualizar todo: " + syncError
      : added > 0 ? (added === 1 ? "Hay 1 título nuevo" : "Hay " + added + " títulos nuevos") + " en el catálogo"
      : "El catálogo está al día";
    settle();
  }, { manual: true });
}

/* Icono de cada ítem del menú (los mismos del celular): solo el ítem con el foco, o la sección actual si el foco está fuera del menú, muestra su nombre */
var MENU_ICON = { home: IC.menuHome, movies: IC.menuFilm, series: IC.menuSeries, anime: IC.menuAnime, mylist: IC.menuMy, live: IC.menuLive };

function topbarHtml(active) {
  var p = activeProfile || { name: "Perfil", avatar: "panda" };
  return '<div class="hf2-topbar">' + brandHtml("small") +
    '<nav class="hf2-menu">' + visibleMenu().map(function (m) {
      return '<span class="' + (m.id === active ? "on" : "") + '" data-focusable="true" data-menu="' + m.id + '" data-title="' + m.label + '" data-description="' + m.label + '" tabindex="0">' + (MENU_ICON[m.id] || "") + '<b class="lbl">' + m.label + "</b></span>";
    }).join("") + "</nav>" +
    '<div class="hf2-top-right"><span class="hf2-sync-badge" id="syncBadge"></span>' +
      '<span class="hf2-round sm" data-focusable="true" data-menu="search" data-title="Buscar" data-description="Buscar películas y series" tabindex="0">' + IC.search + "</span>" +
      /* Actualizar: vuelve a leer los chats del perfil para traer lo recién publicado sin salir de la app */
      '<span class="hf2-round sm hf2-refresh' + (syncing ? " spinning" : "") + '" data-focusable="true" data-menu="refresh" data-title="Actualizar" data-description="Buscar películas y series nuevas en tus chats" tabindex="0">' + IC.refresh + "</span>" +
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

/* Línea de datos de un anime: año · formato · capítulos · estado · nota */
function animeMeta(t) {
  return (t.year ? "<b>" + t.year + "</b>" : "") + (t.format ? "<span>" + esc(t.format) + "</span>" : "") +
    (t.episodeCount ? "<span>" + t.episodeCount + (t.episodeCount === 1 ? " capítulo" : " capítulos") + "</span>" : "") +
    (t.statusText ? "<span>" + esc(t.statusText) + "</span>" : "") + (t.es ? '<span class="hf2-q">ES</span>' : "") + (t.score ? '<span class="hf2-q">★ ' + (t.score / 10).toFixed(1) + "</span>" : "");
}

function animeEmptyHtml() {
  var wait = !HFAnime.hasFeed();
  return '<div class="hf2-glow"></div><div class="hf2-empty"><div class="hf2-empty-art"><div class="hf2-logo big"></div></div><h2>' +
    (HFAnime.lastError() && wait ? "No se pudo cargar el catálogo de Anime" : "Cargando el catálogo de Anime…") + "</h2><p>" +
    (HFAnime.lastError() && wait ? esc(HFAnime.lastError()) + " Pulsa el botón Actualizar de arriba para intentarlo otra vez." : "Un momento: se está trayendo lo más visto, lo nuevo y por género.") + "</p></div>";
}

/* Destacado (billboard) de un título; buttons: [{action, label, icon, primary}] */
function billboardHtml(t, opts) {
  var badges = '<span class="hf2-chip gold">' + (t.type === "movie" ? "Película" : t.anime ? "Anime" : "Serie") + "</span>" +
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
  } else if (t.anime) {
    meta = animeMeta(t);
    next = t.loaded ? HFLibrary.nextEpisode(t) : { episode: null };
    buttons = '<span class="hf2-btn primary small icon" data-focusable="true" data-action="hero-play" data-title="Reproducir" tabindex="0">' + IC.play +
      (next.episode ? (next.started && next.resume > 0 ? "Continuar " : "Ver ") + HFAnime.tag(next.episode) : "Reproducir") + "</span>";
  } else {
    meta = "<b>" + t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas") + "</b><span>" + t.episodeCount + " capítulos</span>";
    next = HFLibrary.nextEpisode(t);
    buttons = '<span class="hf2-btn primary small icon" data-focusable="true" data-action="hero-play" data-title="Reproducir" tabindex="0">' + IC.play +
      (next.episode ? (next.started && next.resume > 0 ? "Continuar" : "Ver") + " T" + next.episode.season + ":E" + next.episode.episode : "Reproducir") + "</span>";
  }
  buttons += '<span class="hf2-btn ghost small icon" data-focusable="true" data-action="hero-info" data-title="Más info" tabindex="0">' + IC.info + (t.type === "series" ? "Capítulos" : "Más info") + "</span>" +
    '<span class="hf2-round" data-focusable="true" data-action="hero-list" data-title="Mi lista" data-description="' + (HFLibrary.inMyList(t.titleKey) ? "En tu lista · OK para quitarla" : "Agregar a Mi lista") + '" tabindex="0">' + (HFLibrary.inMyList(t.titleKey) ? IC.check : IC.plus) + "</span>";
  return '<div class="hf2-billboard' + (opts.compact ? " compact" : "") + '" id="billboard" data-ref="t:' + esc(t.titleKey) + '">' +
    '<div class="hf2-bb-media"><div class="hf2-bb-art hf2-img"' + (t.bannerKey || t.imageKey ? ' data-img="' + esc(t.bannerKey || t.imageKey) + '" data-img-w="1280"' : "") + ">" + fallbackArt() + "</div>" +
    '<div class="hf2-bb-shade"></div></div><div class="hf2-bb-copy"><div class="hf2-bb-badges">' + badges + "</div>" +
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
  var per = cardView() === "vertical" ? 7 : 5;
  for (i = 0; i < titles.length; i += per) {
    rows.push('<div class="hf2-grid-row" style="display:flex">' + titles.slice(i, i + per).map(function (t) { return cardHtml(t); }).join("") + "</div>");
  }
  return '<div class="hf2-grid">' + rows.join("") + "</div>";
}

/* Una fila por categoría (#Marvel, #Terror… en el comentario), y cada título en UNA sola: la de más prioridad del
 * catálogo (js/library.js primaryCategory: Marvel > Infantil > género). withKids: lo marcado #infantil va a «Infantil».
 * Las categorías con algo agregado hace poco van primero. titles ya viene del más nuevo al más viejo. */
function categoryRows(titles, prefix, withKids) {
  var groups = {};
  var order = [];
  titles.forEach(function (t) {
    var main = HFLibrary.primaryCategory(t, withKids);
    var cats = main ? [main] : [];
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
    var chrono = HFLibrary.isChronoCategory(g.name); // Marvel: en el orden de la historia (js/library.js)
    return [prefix + "-" + id, g.name, HFLibrary.sortForCategory(g.name, g.items),
      { note: (g.items.length === 1 ? "1 título" : g.items.length + " títulos") + (chrono ? " · en orden cronológico" : "") }];
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
    /* «Para ti» (js/reco.js): del motor de recomendaciones; con menos de 4 no vale la pena la fila */
    var forYou = typeof HFReco !== "undefined" ? HFReco.paraTi(library, 20) : [];
    if (forYou.length >= 4) { rows.push(["foryou", "Para ti", forYou, { loop: false, note: "según lo que ves" }]); }
    if (library.recent.length) { rows.push(["recent", "Agregados recientemente", library.recent.slice(0, 10), { loop: false, note: "los últimos 10" }]); }
    rows = rows.concat(categoryRows(movies.concat(series).sort(byDateDesc), "c", !currentProfileIsKids()));
    if (library.movies.length) { rows.push(["movies", "Todas las películas", movies, { note: String(movies.length) }]); }
    if (library.series.length) { rows.push(["series", "Series", series, { note: String(series.length) }]); }
    if (myListTitles().length) { rows.push(["mylist", "Mi lista", myListTitles()]); }
    if (library.unclassified.length) { rows.push(["unclassified", "Sin clasificar", library.unclassified.slice(0, 40), { loop: false, note: "Videos sin nombre: ábrelos y usa Etiquetar" }]); }
  } else if (section === "anime") {
    var arows = HFAnime.rows();
    var cwAnime = continueWatching().filter(function (e) { return e.anime; });
    heroList = arows.length ? arows[0].titles.slice(0, 6) : [];
    if (cwAnime.length) { rows.push(["a-continue", "Continuar viendo", cwAnime, { loop: false, progress: true }]); }
    arows.forEach(function (r) { rows.push(["a-" + r.id, r.name, r.titles, { note: r.note || String(r.titles.length) }]); });
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

function renderBrowse(focusName, focusIndex, keepView) {
  var root = byId("scrBrowse");
  paintedSig = browseSigNow(); // la huella de lo que se va a pintar (browseRepaint)
  heroPvCancel();
  var section = browse.section;
  var html = "";
  var content;
  var hero = null;
  var heroIdx;
  var defs = [];
  var scroll;

  var kept = keepView ? captureBrowseView() : null;

  if (focusName !== "top") {
    browse.resume = null; // el «volver a la fila donde estaba» solo vale mientras se está en el menú
  }
  if (section === "mylist") {
    var titles = myListTitles();
    html = '<div class="hf2-page" style="top:120px"><div class="hf2-grid-head"><h2>Mi lista <span>' + titles.length + " títulos</span></h2></div>" +
      (titles.length ? gridHtml(titles) : '<p class="hf2-text" style="margin-left:88px">En la ficha de una película o serie pulsa «+ Mi lista» para guardarla aquí.</p>') + "</div>";
  } else if (section === "anime" && !HFAnime.hasFeed()) {
    html = animeEmptyHtml();
  } else if (section !== "anime" && !library.recent.length && !library.unclassified.length) {
    html = emptyHtml();
  } else {
    content = sectionContent(section);
    if (content.heroList.length) {
      heroIdx = (browse.hero[section] || 0) % content.heroList.length;
      hero = content.heroList[heroIdx];
      browse.heroList = content.heroList;
      browse.heroListFor = section;
      html += billboardHtml(hero, { compact: section !== "home", isNew: section === "home", dots: dotsHtml(content.heroList.length, heroIdx), index: heroIdx, count: content.heroList.length });
    }
    html += '<div class="hf2-rows" style="margin-top:' + (hero ? 28 : 150) + 'px">' +
      content.rows.map(function (r) { return rowHtml(r[0], r[1], r[2], r[3]); }).join("") + '<div style="height:120px"></div></div>';
    html = '<div class="hf2-scroll" id="browseScroll"><div class="hf2-scroll-inner">' + html + "</div></div>";
  }
  root.innerHTML = html + topbarHtml(section);
  setSyncBadge();

  /* BACK desde una fila sube al menú sin mover la página ni las filas; ▼ vuelve a donde se estaba (browse.resume) */
  defs.push({
    name: "top", items: root.querySelectorAll(".hf2-topbar [data-focusable]"), dir: "h", holdPage: true,
    resume: function () { var r = browse.resume; browse.resume = null; return r; }
  });
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
  restoreBrowseView(kept);
  observeImages(root);
  shapeHeroSwitch(root.querySelector(".hf2-bb-dots"));
  reattachUpdateModal(); // si el modal de actualización está abierto, conserva el foco
  if (hero) {
    if (browse.heroDir) {
      animateHero(byId("billboard"), browse.heroDir);
      browse.heroDir = 0;
    }
    updateStatus(hero.name + " · " + titleMeta(hero));
    if (content.heroList.length > 1) { preloadHeroNeighbors(content.heroList, heroIdx); heroPreSchedule(1); }
  }
}

/* Contorno del selector de destacados: una sola figura, ancha arriba (flechas y puntos) y con una pestaña
 * más angosta abajo (contador), unidas con curvas hacia adentro. Se dibuja en SVG con las medidas reales. */
var shapeCache = {};

function shapeHeroSwitch(el) {
  var sel = el && el.querySelector(".sel");
  var tab = el && el.querySelector("small");
  var W, H1, H, w2, x0, R, c, rb, d, key, svg, simple;
  if (!sel || !tab) {
    return;
  }
  /* Medir (offsetWidth) obliga a calcular el layout de TODA la página en pleno cambio de destacado: en la TV eran ~20 ms más un segundo layout.
   * El contorno solo depende de cuántos destacados hay y de cuántos dígitos tiene el número, así que se mide una vez por combinación y se reutiliza. */
  /* Web en computador: sin el contador «1 de 6» (css/app.css lo oculta): el contorno es una sola píldora, sin la pestaña de abajo */
  simple = document.documentElement.getAttribute("data-web") === "pc";
  key = sel.querySelectorAll(".pts i").length + ":" + tab.textContent.length + (simple ? ":s" : "");
  svg = shapeCache[key];
  if (!svg) {
    W = sel.offsetWidth;
    H1 = sel.offsetHeight;
    H = simple ? H1 : H1 + tab.offsetHeight;
    R = simple ? (H1 - 2) / 2 : Math.min(20, Math.floor(H1 / 2));
    c = 10;
    rb = 14;
    w2 = Math.min(tab.offsetWidth, W - 2 * (R + c));
    x0 = Math.round((W - w2) / 2);
    d = simple ?
      "M" + (1 + R) + " 1H" + (W - 1 - R) + "A" + R + " " + R + " 0 0 1 " + (W - 1 - R) + " " + (H1 - 1) + "H" + (1 + R) + "A" + R + " " + R + " 0 0 1 " + (1 + R) + " 1Z" :
      "M" + (1 + R) + " 1H" + (W - 1 - R) + "A" + R + " " + R + " 0 0 1 " + (W - 1) + " " + (1 + R) +
      "V" + (H1 - 1 - R) + "A" + R + " " + R + " 0 0 1 " + (W - 1 - R) + " " + (H1 - 1) +
      "H" + (x0 + w2 + c) + "A" + c + " " + c + " 0 0 0 " + (x0 + w2) + " " + (H1 - 1 + c) +
      "V" + (H - 1 - rb) + "A" + rb + " " + rb + " 0 0 1 " + (x0 + w2 - rb) + " " + (H - 1) +
      "H" + (x0 + rb) + "A" + rb + " " + rb + " 0 0 1 " + x0 + " " + (H - 1 - rb) +
      "V" + (H1 - 1 + c) + "A" + c + " " + c + " 0 0 0 " + (x0 - c) + " " + (H1 - 1) +
      "H" + (1 + R) + "A" + R + " " + R + " 0 0 1 1 " + (H1 - 1 - R) +
      "V" + (1 + R) + "A" + R + " " + R + " 0 0 1 " + (1 + R) + " 1Z";
    svg = '<svg class="shape" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '"><path d="' + d + '"/></svg>';
    if (W > 0) { shapeCache[key] = svg; }
  }
  el.insertAdjacentHTML("afterbegin", svg);
}

/* Cambia el destacado de la sección actual (dir: 1 siguiente, -1 anterior) y deja el foco en los puntos.
 * Antes se volvía a pintar TODA la pantalla (todas las filas y sus imágenes) en cada cambio: eso era el lag en la TV.
 * Ahora solo se cambia el destacado en su sitio: el nuevo entra con un fundido cruzado sobre el anterior (que queda como
 * «fantasma» unos instantes) y solo se animan transform y opacity (los hace la GPU sin repintar). Las imágenes de los
 * dos vecinos se precargan para que el cambio sea inmediato. */
/* ===================== Vista previa del destacado =====================
 * Si el foco se queda ~0,4 s en el destacado del inicio (botones o selector), empieza a sonar un fragmento de la película
 * sobre la imagen (fundido suave) durante ~45 s; en cuanto el foco sale, el título cambia, se abre otra pantalla o se da a
 * «Reproducir», se corta con un fundido. Usa el mismo motor del reproductor (Player: MediaSource + bytes de Telegram) con un
 * <video> propio, la versión más liviana (720p o menos) y arranca a ~30 % de la película. Solo con Telegram real. */
var HERO_PV_DELAY = 400;
var HERO_PV_LEN = 45000;
var HERO_PV_MUTED = false;
var HERO_PV_VOLUME = 0.7;
var HeroPv = { timer: null, end: null, el: null, wrap: null, engine: null, ref: "", token: 0 };

function heroPvSupported() {
  return typeof Player !== "undefined" && typeof window.MediaSource !== "undefined" && typeof HFTelegram !== "undefined" &&
    HFTelegram.available() && typeof HFTelegram.source === "function";
}

function heroPvCancel() {
  var el = HeroPv.el;
  var wrap = HeroPv.wrap;
  var eng = HeroPv.engine;
  HeroPv.token += 1;
  clearTimeout(HeroPv.timer);
  clearTimeout(HeroPv.end);
  HeroPv.timer = null;
  HeroPv.end = null;
  HeroPv.el = null;
  HeroPv.wrap = null;
  HeroPv.engine = null;
  HeroPv.ref = "";
  if (wrap) { wrap.classList.remove("on"); }
  if (wrap || eng) {
    setTimeout(function () {
      try { if (eng) { eng.close(); } } catch (e) { /* ya estaba cerrado */ }
      if (wrap && wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
    }, 900);
  }
}

function heroPvArm() {
  var bb = byId("billboard");
  var ref;
  if (!bb || currentRoute !== "browse" || (typeof UPM !== "undefined" && UPM.open) || !heroPvSupported()) {
    return;
  }
  ref = bb.getAttribute("data-ref");
  if (HeroPv.ref === ref && (HeroPv.timer || HeroPv.engine)) {
    return; // ya armado (o sonando) para este título: moverse entre los botones no lo reinicia
  }
  heroPvCancel();
  HeroPv.ref = ref;
  HeroPv.timer = setTimeout(function () {
    HeroPv.timer = null;
    heroPvStart();
  }, HERO_PV_DELAY);
}

function heroPvPick(t) {
  var it = t.type === "series" ? HFLibrary.nextEpisode(t).episode : t;
  var list;
  var low;
  var v;
  var part;
  var total;
  if (!it || !it.video) { return null; }
  list = (it.versions || []).filter(function (x) { return x && x.key; });
  low = list.filter(function (x) { return x.h <= 720; }).sort(function (a, b) { return b.h - a.h; })[0] || list.sort(function (a, b) { return a.h - b.h; })[0];
  v = low || { key: it.video.key, parts: [{ key: it.video.key, dur: it.video.duration }] };
  part = (v.parts && v.parts[0]) || { key: v.key, dur: it.video.duration };
  total = part.dur || it.video.duration || 0;
  if (!part.key || total < 240) { return null; }
  return { key: part.key, startAt: Math.max(30, Math.min(total * 0.3, total - 150)) };
}

/* La vista previa solo suena mientras el foco está en el destacado, o sea con la página arriba del todo: su borde inferior queda a una
 * altura conocida y el fondo ahí es un color conocido (el fondo de la pantalla es un degradado vertical fijo de #131518 a #0d0e10).
 * El video termina en un degradado hacia ESE color: sin línea divisoria. (Una máscara sobre un contenedor con el video hacía que la TV
 * no lo dibujara; por eso el video va fuera de la máscara del banner y la mezcla con el fondo es un degradado encima.) */
function heroPvFadeGradient(bb) {
  var app = byId("app");
  var ab = app.getBoundingClientRect();
  var sc = ab.width / 1920 || 1;
  var y = Math.max(0, Math.min(1080, (bb.getBoundingClientRect().bottom - ab.top) / sc));
  var k = y / 1080;
  var c = Math.round(19 - 6 * k) + "," + Math.round(21 - 7 * k) + "," + Math.round(24 - 8 * k);
  var stops = [[46, 0], [53, 0.07], [60, 0.18], [67, 0.34], [74, 0.53], [81, 0.72], [88, 0.87], [94, 0.96], [100, 1]];
  return "linear-gradient(180deg," + stops.map(function (p) { return "rgba(" + c + "," + p[1] + ") " + p[0] + "%"; }).join(",") + ")";
}

function heroPvStart() {
  var bb = byId("billboard");
  var a = currentArea();
  var t;
  var pick;
  var my;
  var video;
  var shade;
  var fade;
  var wrap;
  var engine;
  if (!bb || bb.getAttribute("data-ref") !== HeroPv.ref || currentRoute !== "browse" || !a || (a.name !== "hero" && a.name !== "hero-dots")) {
    return;
  }
  t = entryFromRef(HeroPv.ref);
  pick = t && heroPvPick(t);
  if (!pick) { return; }
  my = HeroPv.token;
  video = document.createElement("video");
  video.className = "hf2-bb-pv";
  /* en el navegador el sonido solo arranca si la persona ya tocó la página (clic o tecla); antes de eso la vista previa va sin sonido, si no Chrome/Safari la bloquean */
  video.muted = HERO_PV_MUTED || (richFx() && !(navigator.userActivation && navigator.userActivation.hasBeenActive));
  video.volume = HERO_PV_VOLUME;
  video.setAttribute("playsinline", "");
  /* el video ocupa TODO el ancho del destacado; un degradado más suave (el original, sólido a la izquierda, lo taparía) deja leer el texto */
  shade = document.createElement("div");
  shade.className = "hf2-bb-shade pv";
  fade = document.createElement("div");
  fade.className = "hf2-bb-vfade";
  fade.style.backgroundImage = heroPvFadeGradient(bb);
  wrap = document.createElement("div");
  wrap.className = "hf2-bb-vmedia";
  wrap.appendChild(video);
  wrap.appendChild(shade);
  wrap.appendChild(fade);
  bb.insertBefore(wrap, bb.querySelector(".hf2-bb-copy"));
  HeroPv.el = video;
  HeroPv.wrap = wrap;
  engine = Player.create(video, function () { /* registro interno: no se muestra */ }, function (phase) {
    if (my !== HeroPv.token) { return; }
    if (phase === "playing") {
      wrap.classList.add("on");
      if (!HeroPv.end) { HeroPv.end = setTimeout(heroPvCancel, HERO_PV_LEN); }
    } else if (phase === "error") {
      heroPvCancel();
    }
  });
  HeroPv.engine = engine;
  HFTelegram.source(pick.key).then(function (src) {
    if (my !== HeroPv.token) { return null; }
    return engine.open(src, { startAt: pick.startAt, onTracks: function () {}, onSub: function () {} });
  }).then(function () {
    if (my !== HeroPv.token) { return; }
    try { video.play(); } catch (e) { /* el motor ya la inicia */ }
  }, function () {
    if (my === HeroPv.token) { heroPvCancel(); }
  });
}

/* core.js avisa cada vez que cambia el área con el foco */
function HFAreaHook(name) {
  if (currentRoute === "detail") {
    /* ficha: la vista previa sigue mientras el foco esté en los botones; si baja a temporadas, capítulos o filas, se corta (y vuelve al regresar) */
    if (name === "actions" || byId("scrDetail").classList.contains("wii-detalle")) {
      if (typeof detailPvArm === "function") { detailPvArm(); }
    } else if (HeroPv.timer || HeroPv.engine) {
      heroPvCancel();
    }
    return;
  }
  if (name === "hero" || name === "hero-dots") {
    heroPvArm();
  } else if (HeroPv.timer || HeroPv.engine) {
    heroPvCancel();
  }
}

document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") { heroPvCancel(); }
}, false);

var heroGhostTimer = null;

function dropHeroGhost() {
  var g = document.querySelector("#billboard > .hf2-billboard.ghost");
  var all = document.querySelectorAll(".hf2-billboard.ghost2");
  var i;
  clearTimeout(heroGhostTimer);
  if (g && g.parentNode) { g.parentNode.removeChild(g); }
  for (i = 0; i < all.length; i += 1) { if (all[i].parentNode) { all[i].parentNode.removeChild(all[i]); } }
  var fb = byId("billboard");
  if (fb) { fb.style.position = ""; fb.style.zIndex = ""; }
}

/* Efectos completos (versión web en un computador, ?web=1): hay GPU de sobra, así que el destacado usa el mismo «Circle blur» del celular. */
function richFx() {
  return document.documentElement.getAttribute("data-web") === "pc";
}

/* Revela el destacado nuevo. En la TV: un fundido (solo opacidad: lo hace la GPU sin repintar). Se probó «Circle blur» (recorte circular + desenfoque,
 * beui.dev/components/motion/theme-toggle) en la TV real (Samsung Q65B, Tizen 6.5) y daba 15-23 cuadros/s con cuadros de hasta 260 ms: animar
 * clip-path y filter obliga a repintar todo el destacado en cada cuadro. Con el fundido salen 40-46 cuadros en el mismo cambio (igual que sin efecto).
 * En la web de computador (richFx) se queda el círculo con desenfoque: un círculo que crece desde el selector de destacados (0 % → 150 %) mientras
 * el desenfoque baja de 8 px a 0, en 700 ms con la curva estándar de Material (la misma del celular, mobile/m.js heroReveal). */
function revealHero(el, dots) {
  var an;
  var r;
  var d;
  var k;
  var o = "50% 100%";
  if (!el || !el.animate || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) { return; }
  try {
    /* mientras se revela, el destacado nuevo lleva fondo opaco (css/app.css .revealing): si no, donde no tiene nada (alrededor de las letras) se sigue viendo
     * el anterior a través y, al quitarlo, sus letras desaparecen de golpe */
    el.classList.add("revealing");
    if (richFx()) {
      r = el.getBoundingClientRect();
      d = dots && dots.getBoundingClientRect();
      k = r.width && el.offsetWidth ? r.width / el.offsetWidth : 1; // el lienzo está escalado: el recorte va en píxeles sin escalar
      if (d && d.width) { o = Math.round((d.left + d.width / 2 - r.left) / k) + "px " + Math.round((d.top + d.height / 2 - r.top) / k) + "px"; }
      an = el.animate(
        [{ clipPath: "circle(0% at " + o + ")", filter: "blur(8px)" }, { clipPath: "circle(150% at " + o + ")", filter: "blur(0px)" }],
        { duration: 700, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
      );
      an.onfinish = an.oncancel = function () { terminaRevelado(el); };
      return;
    }
    el.style.willChange = "opacity"; // solo durante el fundido: la capa se promueve a la GPU y se libera al terminar
    an = el.animate([{ opacity: 0.01 }, { opacity: 1 }], { duration: 450, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    an.onfinish = an.oncancel = function () { el.style.willChange = ""; terminaRevelado(el); };
  } catch (e) { terminaRevelado(el); /* sin animación */ }
}

/* Al terminar el revelado: primero se quita el destacado anterior (fantasma) y recién después el fondo opaco del nuevo. Al revés, el fondo se iba
 * ~80 ms antes que el fantasma y el texto viejo parpadeaba un instante a través del nuevo, en cada cambio. Solo si este sigue siendo el
 * destacado actual (con pulsaciones seguidas, el fantasma que queda ya es de otro cambio). */
function terminaRevelado(el) {
  if (el.id === "billboard") { dropHeroGhost(); }
  el.classList.remove("revealing");
}

function preloadHeroNeighbors(list, idx) {
  [idx - 1, idx + 1].forEach(function (i) {
    var t = list[(i + list.length) % list.length];
    var key = t && (t.bannerKey || t.imageKey);
    var d;
    if (!key || (HFTelegram.imageReady && HFTelegram.imageReady(key, 1280))) { return; }
    d = document.createElement("div");
    d.setAttribute("data-img", key);
    d.setAttribute("data-img-w", "1280");
    queueImage(d);
  });
}

/* Clic o toque en el selector de destacados: la flecha izquierda retrocede, la derecha avanza y un punto salta a ese destacado
 * (los puntos son una ventana de 6: el punto k es el destacado k de la ventana donde está el actual). */
function heroPointerPick(el) {
  var section = browse.section;
  var list = browse.heroListFor === section && browse.heroList ? browse.heroList : sectionContent(section).heroList;
  var dots = el.closest(".hf2-bb-dots");
  var cur = (browse.hero[section] || 0) % (list.length || 1);
  var k;
  var target;
  if (!list || list.length < 2 || !dots) { return; }
  if (syncStateToElement(dots)) { /* el foco pasa al selector, como al navegar con el control */ }
  if (el.tagName === "I") {
    k = toArray(el.parentNode.children).indexOf(el);
    target = Math.floor(cur / 6) * 6 + k;
    if (target >= list.length || target === cur) { return; }
    switchHero(target - cur);
  } else if (el.classList.contains("next")) {
    switchHero(1);
  } else {
    switchHero(-1);
  }
}

var heroWait = null;     // esperando la imagen del destacado nuevo
var heroWaitDir = 0;

function switchHero(dir) {
  var section = browse.section;
  var list = browse.heroListFor === section && browse.heroList ? browse.heroList : sectionContent(section).heroList;
  var idx;
  var t;
  var key;
  var probe;
  var until;
  if (list.length < 2) {
    return;
  }
  idx = ((browse.hero[section] || 0) % list.length + dir + list.length) % list.length;
  browse.hero[section] = idx;
  heroWaitDir = dir;
  if (heroWait) { return; } // ya se espera la imagen: el cambio usará el título más reciente
  t = list[idx];
  key = t && (t.bannerKey || t.imageKey);
  if (!key || (HFTelegram.imageReady && HFTelegram.imageReady(key, 1280)) || !byId("billboard")) {
    swapHero(dir);
    return;
  }
  /* la imagen nueva aún no llegó: se pide y el cambio espera (máx. 400 ms) para no mostrar un cuadro vacío */
  probe = document.createElement("div");
  probe.setAttribute("data-img", key);
  probe.setAttribute("data-img-w", "1280");
  queueImage(probe);
  until = Date.now() + 400;
  heroWait = setInterval(function () {
    var l = browse.heroListFor === browse.section && browse.heroList ? browse.heroList : null;
    var cur = l && l[(browse.hero[browse.section] || 0) % l.length];
    var k = cur && (cur.bannerKey || cur.imageKey);
    if (!k || (HFTelegram.imageReady && HFTelegram.imageReady(k, 1280)) || Date.now() > until) {
      clearInterval(heroWait);
      heroWait = null;
      swapHero(heroWaitDir);
    }
  }, 30);
}

/* ----- Destacado vecino precreado -----
 * Medido en la TV real (Samsung Q65B): el cambio en sí gastaba solo ~5 ms de JavaScript, pero los dos primeros cuadros tras insertar el destacado nuevo
 * tardaban ~200 y ~150 ms (la TV pinta y rasteriza ahí la capa de 1920 × 780). Por eso el siguiente destacado se arma de antemano, 0,7 s después de cada
 * cambio, en una capa casi invisible (opacidad 0,01, se pinta pero no se nota) encima del actual; al pulsar ◀ ▶ solo se intercambian sus papeles. Si se
 * pulsa más rápido de lo que tarda en estar listo, se arma en el momento (como antes). */
var heroPre = null;
var heroPreTimer = null;

function heroListOf(section) {
  return browse.heroListFor === section && browse.heroList ? browse.heroList : sectionContent(section).heroList;
}

function heroBuild(list, idx, section) {
  var tmp = document.createElement("div");
  tmp.innerHTML = billboardHtml(list[idx], { compact: section !== "home", isNew: section === "home", dots: dotsHtml(list.length, idx), index: idx, count: list.length });
  return tmp.firstChild;
}

function heroPreDrop() {
  clearTimeout(heroPreTimer);
  heroPreTimer = null;
  if (heroPre && heroPre.parentNode) { heroPre.parentNode.removeChild(heroPre); }
  heroPre = null;
}

function heroPrebuild(dir) {
  var section = browse.section;
  var old = byId("billboard");
  var list;
  var idx;
  var el;
  heroPreTimer = null;
  if (!old || currentRoute !== "browse") { return; }
  list = heroListOf(section);
  if (list.length < 2) { return; }
  idx = ((browse.hero[section] || 0) % list.length + dir + list.length) % list.length;
  if (heroPre && heroPre._idx === idx && heroPre._section === section && heroPre.isConnected) { return; }
  heroPreDrop();
  el = heroBuild(list, idx, section);
  el.removeAttribute("id"); // los selectores de foco y la vista previa buscan #billboard: este todavía no es el destacado
  el._idx = idx;
  el._section = section;
  el.classList.add("pre"); // css/app.css: sin texto ni selector mientras espera; solo la imagen se pinta de antemano
  el.style.cssText = "position:absolute;left:" + old.offsetLeft + "px;top:" + old.offsetTop + "px;width:" + old.offsetWidth + "px;height:" + old.offsetHeight +
    "px;z-index:0;opacity:0.004;pointer-events:none;will-change:opacity;";
  old.parentNode.insertBefore(el, old.nextSibling);
  shapeHeroSwitch(el.querySelector(".hf2-bb-dots"));
  observeImages(el);
  heroPre = el;
}

function heroPreSchedule(dir) {
  clearTimeout(heroPreTimer);
  heroPreTimer = setTimeout(function () { heroPrebuild(dir); }, 700);
}

/* El cambio en sí: el destacado nuevo se pone encima y el anterior queda debajo (fantasma) mientras el nuevo aparece con un fundido. */
function swapHero(dir) {
  var section = browse.section;
  var list = heroListOf(section);
  var old = byId("billboard");
  var idx = (browse.hero[section] || 0) % list.length;
  var hero = list[idx];
  var fresh;
  var freshButtons;
  var freshDots;
  var gx;
  var gy;
  var gw;
  var gh;
  var ready;
  if (!old) {
    browse.heroDir = dir;
    renderBrowse("hero-dots", 0);
    return;
  }
  heroPvCancel();
  dropHeroGhost(); // si todavía se desvanecía el anterior, se quita ya (pulsaciones seguidas)
  ready = heroPre && heroPre._idx === idx && heroPre._section === section && heroPre.isConnected;
  gx = old.offsetLeft;
  gy = old.offsetTop;
  gw = old.offsetWidth;
  gh = old.offsetHeight;
  if (ready) {
    /* ya está armado y pintado: solo cambian los papeles (el anterior sale del flujo, el nuevo entra) */
    fresh = heroPre;
    heroPre = null;
    freshButtons = toArray(fresh.querySelectorAll(".hf2-bb-actions [data-focusable]"));
    freshDots = fresh.querySelector(".hf2-bb-dots");
    old.removeAttribute("id");
    old.classList.add("ghost2");
    old.style.cssText = "position:absolute;left:" + gx + "px;top:" + gy + "px;width:" + gw + "px;height:" + gh + "px;z-index:0;pointer-events:none;";
    fresh.setAttribute("id", "billboard");
    fresh.classList.remove("pre");
    fresh.style.cssText = "position:relative;z-index:1;will-change:opacity;";
  } else {
    heroPreDrop();
    fresh = heroBuild(list, idx, section);
    /* los botones y el selector del destacado NUEVO se toman antes de meter el anterior al lado (si no, también se contarían los del anterior) */
    freshButtons = toArray(fresh.querySelectorAll(".hf2-bb-actions [data-focusable]"));
    freshDots = fresh.querySelector(".hf2-bb-dots");
    old.removeAttribute("id");
    old.classList.add("ghost2");
    old.parentNode.replaceChild(fresh, old);
    old.style.cssText = "position:absolute;left:" + gx + "px;top:" + gy + "px;width:" + gw + "px;height:" + gh + "px;z-index:0;pointer-events:none;";
    fresh.parentNode.insertBefore(old, fresh);
    fresh.style.position = "relative";
    fresh.style.zIndex = "1";
    shapeHeroSwitch(freshDots);
    observeImages(fresh);
  }
  /* las áreas de foco apuntan ahora a los botones y puntos del destacado nuevo */
  areas.forEach(function (a) {
    var els = a.name === "hero" ? freshButtons : a.name === "hero-dots" ? (freshDots ? [freshDots] : []) : null;
    if (els && els.length) {
      els.forEach(function (el) { el._hfTitle = el.getAttribute("data-title") || ""; el._hfDescription = el.getAttribute("data-description") || ""; });
      a.items = els;
      a.count = els.length;
    }
  });
  revealHero(fresh, freshDots);
  updateFocus();
  updateStatus(hero.name + " · " + titleMeta(hero));
  heroGhostTimer = setTimeout(dropHeroGhost, richFx() ? 780 : 520);
  preloadHeroNeighbors(list, idx);
  heroPreSchedule(dir);
}

/* Entrada del destacado nuevo: la imagen llega deslizándose un poco desde el lado del cambio con un fundido, y el texto
 * se reparte detrás, en cascada (css/app.css). */
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
    return library.titles[ref.slice(2)] || HFAnime.byKey(ref.slice(2)) || null;
  }
  return library.byKey[ref.slice(2)] || null;
}

function playTitle(t) {
  var next;
  var p;
  heroPvCancel(); // el motor del reproductor necesita el MediaSource libre
  if (t.anime && !t.loaded && !HFAnime.quick(t)) {
    /* anime sin cuenta de capítulos conocida: se espera la lista del servidor (puede tardar) */
    updateStatus("Cargando los capítulos de " + t.name + "…");
    HFAnime.touch(t);
    HFAnime.ensure(t).then(function () {
      if (t.loaded) { playTitle(t); } else { updateStatus("Este anime todavía no tiene capítulos disponibles."); }
    }, function (e) { updateStatus(String((e && e.message) || e)); });
    return;
  }
  if (t.anime) { HFAnime.touch(t); HFAnime.ensure(t); } // la lista real (con títulos) llega mientras se ve
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
    if (menu === "refresh") { refreshCatalog(); return; }
    if (menu === "profiles") { openProfiles("¿Quién está viendo?"); return; }
    if (menu === "live") { openLive(); return; }
    browse.section = menu;
    browse.resume = null;
    renderBrowse("top", menuIndex(menu));
    if (menu === "anime") { animeRefresh(); }
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
  /* Toda tarjeta (también «Continuar viendo» y «Series que empezaste») abre primero la ficha del título; ahí está «Continuar» / «Reanudar».
   * Solo el botón «Reproducir» del destacado va directo al video. Lo mismo hacen el celular y la web (mobile/m.js card()). */
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
    /* canal Anime: lo que ya conoce la app + lo que devolvió la búsqueda en el catálogo completo */
    if (animeOn()) {
      var seenAnime = {};
      var fromApi = HFAnime.cachedSearch(raw);
      results = results.concat(fromApi.concat((library.anime || []).filter(function (t) { return normText(t.name).indexOf(q) >= 0; })).filter(function (t) {
        if (seenAnime[t.titleKey]) { return false; }
        seenAnime[t.titleKey] = true;
        return true;
      }));
    }
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
    html += '<div class="hf2-grid-head small"><h2>' + results.length + (results.length === 1 ? " resultado" : " resultados") + " para «" + esc(raw) + "»</h2></div>" + gridHtml(results.slice(0, richFx() ? 60 : 15));
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

/* Busca también en el catálogo completo del canal Anime (en el servidor) y repinta si la escritura sigue igual. */
function searchAnimeOnline(raw) {
  var q = String(raw || "").trim();
  if (!animeOn() || q.length < 2 || HFAnime.cachedSearch(q).length) { return; }
  HFAnime.search(q).then(function (list) {
    var input = byId("searchInput");
    if (list.length && currentRoute === "search" && input && input.value.trim() === q) {
      renderSearchResults("input", 0);
    }
  }, function () { /* sin red: quedan los resultados que ya conoce la app */ });
}

function onSearchInput() {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(function () {
    searchTimer = null;
    if (currentRoute === "search") {
      renderSearchResults("input", 0);
      searchAnimeOnline(byId("searchInput").value);
    }
  }, 300);
}

function handleSearchSelect(el) {
  var entry;
  var recent = el.getAttribute("data-recent");
  var menu = el.getAttribute("data-menu");
  if (menu) {
    if (/^(search|settings|refresh|profiles|live)$/.test(menu)) { handleBrowseSelect(el); return; }
    /* Inicio, Películas, Series, Mi lista…: se vuelve a la pantalla de exploración en esa sección (renderBrowse solo no cambia de pantalla) */
    browse.section = menu;
    browse.resume = null;
    showRoute("browse");
    renderBrowse("top", menuIndex(menu));
    if (menu === "anime") { animeRefresh(); }
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
      if (typeof HFReco !== "undefined") { HFReco.busqueda(byId("searchInput").value.trim(), entry.titleKey || entry.seriesKey || ""); }
    }
    openDetail(entry);
  }
}
