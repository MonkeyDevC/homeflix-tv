/* HomeFlix · arranque, actualizaciones, OK/BACK por pantalla y el único manejador de teclado. */

/* ===================== Actualizaciones =====================
 * Pregunta a GitHub por el último release (como mucho cada 6 horas) y avisa si hay una versión más nueva.
 * La instala Apps2Samsung (el repo es la fuente que tiene configurada). */

var UPDATE_EVERY = 6 * 3600 * 1000;

function appVersion() {
  return typeof HF_VERSION !== "undefined" && HF_VERSION ? HF_VERSION : "";
}

function versionNewer(a, b) {
  var x = String(a).split(".").map(Number);
  var y = String(b).split(".").map(Number);
  var i;
  for (i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) {
      return (x[i] || 0) > (y[i] || 0);
    }
  }
  return false;
}

function updateInfo() {
  var info;
  try {
    info = JSON.parse(window.localStorage.getItem("hf.update") || "null");
  } catch (e) {
    info = null;
  }
  return info && appVersion() && versionNewer(info.version, appVersion()) ? info : null;
}

function checkUpdates(force) {
  var last = Number(window.localStorage.getItem("hf.update.checkedAt") || 0);
  var repo = typeof HF_UPDATE_REPO !== "undefined" ? HF_UPDATE_REPO : "";
  if (!appVersion() || !repo || typeof fetch === "undefined" || (!force && Date.now() - last < UPDATE_EVERY)) {
    return;
  }
  window.localStorage.setItem("hf.update.checkedAt", String(Date.now()));
  fetch("https://api.github.com/repos/" + repo + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.tag_name) {
        return;
      }
      window.localStorage.setItem("hf.update", JSON.stringify({
        version: String(j.tag_name).replace(/^v/i, ""),
        notes: String(j.body || "").replace(/[#*_`>]/g, "").replace(/\r/g, "").trim().slice(0, 600),
        date: j.published_at || ""
      }));
      if (currentRoute === "profiles") {
        renderUpdateBanner();
      }
      setSyncBadge();
    }, function () {
      /* sin internet o GitHub no responde: se intenta en la próxima apertura */
    });
}

function dismissUpdate() {
  var info = updateInfo();
  if (info) {
    window.localStorage.setItem("hf.update.dismissed", info.version);
  }
}

function renderUpdateBanner() {
  var el = byId("updateBanner");
  var info = updateInfo();
  var notes;
  if (!el) {
    return;
  }
  if (!info || window.localStorage.getItem("hf.update.dismissed") === info.version) {
    el.innerHTML = "";
    return;
  }
  notes = info.notes.split("\n").filter(function (l) { return l.trim(); }).slice(0, 2).join(" · ");
  el.innerHTML = '<div class="hf2-update"><div class="txt"><b>Hay una versión nueva: v' + esc(info.version) + "</b> (tienes v" + esc(appVersion()) + ")" +
    (notes ? "<small>" + esc(notes) + "</small>" : "") +
    "<small>Para instalarla: en el teléfono abre Apps2Samsung → Apps instaladas → HomeFlix → Actualizar.</small></div>" +
    '<span class="hf2-btn ghost small" data-focusable="true" data-action="hide-update" data-title="Ocultar aviso" data-description="Ocultar hasta la próxima versión" tabindex="0">Ocultar</span></div>';
}

/* ===================== OK, ◀ ▶ en opciones y BACK por pantalla ===================== */

function onAdjust(el, dir) {
  if (currentRoute === "tag-edit") {
    /* Solo «Serie» (sola en su fila) cambia con ◀ ▶; en la fila de año/temporada/capítulo/infantil ◀ ▶ mueven. */
    return el.getAttribute("data-adjust") === "series" ? adjustTagField(el, dir) : false;
  }
  /* «Perfil infantil» cambia solo con OK: ◀ ▶ mueven al campo del PIN que está a su lado */
  return false;
}

function onLeaveRoute(from, to) {
  if (from === "login" && to !== "login") {
    cancelLogin();
  }
  if (from === "player" && to !== "player") {
    closePlayer();
  }
}

function selectCurrentItem() {
  var el = getCurrentItem();
  if (!el) {
    return;
  }
  if (currentRoute === "splash") { handleSplashSelect(el); }
  else if (currentRoute === "login") { handleLoginSelect(el); }
  else if (currentRoute === "profiles") { handleProfileSelect(el); }
  else if (currentRoute === "profile-edit") { handleProfileEditSelect(el); }
  else if (currentRoute === "pin") { handlePinSelect(el); }
  else if (currentRoute === "accounts") { handleAccountsSelect(el); }
  else if (currentRoute === "settings") { handleSettingsSelect(el); }
  else if (currentRoute === "guide") { handleGuideSelect(el); }
  else if (currentRoute === "browse") { handleBrowseSelect(el); }
  else if (currentRoute === "detail") { handleDetailSelect(el); }
  else if (currentRoute === "tag-edit") { handleTagEditSelect(el); }
  else if (currentRoute === "search") { handleSearchSelect(el); }
  else if (currentRoute === "player") { handlePlayerAction(el); }
}

function goBackByRoute() {
  if (currentRoute === "detail") { closeDetail(); return; }
  if (currentRoute === "tag-edit") { cancelTagEdit(); return; }
  if (currentRoute === "profile-edit") { openProfiles("", true); return; }
  if (currentRoute === "pin") { cancelPin(); return; }
  if (currentRoute === "guide") { closeGuide(); return; }
  if (currentRoute === "search") { openBrowse(browse.section); return; }
  if (currentRoute === "settings") {
    if (settings.helpOpen) {
      settings.helpOpen = false;
      renderSettings("top", 0);
      return;
    }
    finishSettings();
    return;
  }
  if (currentRoute === "browse") {
    /* Desde cualquier fila o el destacado, BACK sube al menú (sobre la sección actual) y la página vuelve arriba. */
    if (currentArea() && currentArea().name !== "top") {
      focusAreaByName("top", Math.max(0, MENU.map(function (m) { return m.id; }).indexOf(browse.section)));
      return;
    }
    if (browse.section !== "home") {
      browse.section = "home";
      renderBrowse("top", 0);
      return;
    }
    openProfiles("¿Quién está viendo?");
    return;
  }
  if (currentRoute === "profiles") {
    if (profilesEditMode) {
      renderProfiles(false);
      return;
    }
    openSplash("Pantalla inicial");
    return;
  }
  if (currentRoute === "login") {
    leaveLogin();
    return;
  }
  if (currentRoute === "accounts") {
    openProfiles("¿Quién está viendo?");
  }
}

/* ===================== Teclado y puntero ===================== */

function handleKeyDown(event) {
  var code = event.keyCode;
  if (code === 27) {
    code = 10009; // Esc en el navegador = BACK del mando
  }
  /* Escribiendo en un campo: Enter / «Listo» (65376) cierra el teclado y baja; «Cancelar» (65385) solo lo cierra. */
  if (isTypingInInput()) {
    if (code === 13 || code === 65376) {
      event.preventDefault();
      blurActiveInput();
      if (currentRoute === "login" && loginState === "password") {
        sendPasswordFromForm();
      } else if (currentRoute === "login" && loginState === "api" && document.activeElement !== byId("apiIdInput")) {
        moveDown();
      } else {
        moveDown();
      }
      return;
    }
    if (code === 65385) {
      blurActiveInput();
      return;
    }
    if (code !== 38 && code !== 40 && code !== 10009) {
      return;
    }
    blurActiveInput();
  }
  if (code === 37 || code === 38 || code === 39 || code === 40 || code === 13 || code === 10009) {
    event.preventDefault();
  }
  if (currentRoute === "player" && handlePlayerKey(code)) {
    return;
  }
  if (currentRoute === "tag-edit" && handleTagEditKey(code)) {
    return;
  }
  if (currentRoute === "pin" && handlePinKey(code)) {
    event.preventDefault();
    return;
  }
  switch (code) {
    case 37: moveLeft(); break;
    case 38: moveUp(); break;
    case 39: moveRight(); break;
    case 40: moveDown(); break;
    case 13: selectCurrentItem(); break;
    case 10009: goBackByRoute(); break;
    default: break;
  }
}

function syncStateToElement(element) {
  var ai;
  var ii;
  var a;
  for (ai = 0; ai < areas.length; ai += 1) {
    a = areas[ai];
    ii = a.items.indexOf(element);
    if (ii >= 0) {
      state.areaIndex = ai;
      if (a.loop) {
        a.domIndex = ii;
        state.itemIndex = ii % a.count;
      } else {
        state.itemIndex = ii;
      }
      updateFocus();
      return true;
    }
  }
  return false;
}

function findFocusableFromTarget(target) {
  while (target && target !== document) {
    if (target.getAttribute && target.getAttribute("data-focusable") === "true") {
      return target;
    }
    target = target.parentNode;
  }
  return null;
}

function handlePointerSelect(event) {
  var element = findFocusableFromTarget(event.target);
  if (event.target && event.target.tagName === "INPUT") {
    if (element) {
      syncStateToElement(element);
    }
    return;
  }
  blurActiveInput();
  if (element && syncStateToElement(element)) {
    selectCurrentItem();
  }
}

/* Llegaron cambios de otro dispositivo (Mi lista, progreso, perfiles, chats): volver a armar y pintar lo que se ve.
 * No toca el reproductor ni pantallas con campos de texto (no se interrumpe lo que se está escribiendo). */
function onSyncRemote() {
  var a;
  if (activeProfile) {
    activeProfile = HFLibrary.profiles().filter(function (p) { return p.id === activeProfile.id; })[0] || activeProfile;
  }
  rebuildLibrary();
  if (currentRoute === "browse") {
    a = currentArea();
    renderBrowse(a ? a.name : null, state.itemIndex);
  } else if (currentRoute === "profiles") {
    renderProfiles(false);
  }
}

/* Tizen: las teclas multimedia del mando solo llegan si se registran. */
function registerTvKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaFastForward", "MediaRewind", "MediaStop", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach(function (k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* no disponible en este modelo */ }
      });
    }
  } catch (e) {
    /* fuera de la TV */
  }
}

/* La app se diseña a 1920×1080 (la TV). En un navegador con otra medida (p. ej. Windows al 125 %)
 * se escala entera y se centra; en la TV la escala es 1 y no se toca nada. Solo al cargar y al cambiar la ventana. */
function fitToWindow() {
  var w = window.innerWidth;
  var h = window.innerHeight;
  var s = Math.min(w / 1920, h / 1080);
  if (!appRootEl || !w || !h) {
    return;
  }
  if (Math.abs(s - 1) < 0.01) {
    appRootEl.style.transform = "";
    return;
  }
  appRootEl.style.transform = "translate(" + Math.round((w - 1920 * s) / 2) + "px," + Math.round((h - 1080 * s) / 2) + "px) scale(" + s + ")";
}

window.onload = function () {
  appRootEl = byId("app");
  statusMessageEl = byId("statusMessage");
  statusHintsEl = byId("statusHints");
  fitToWindow();
  window.addEventListener("resize", fitToWindow, false);
  registerTvKeys();
  openSplash("Pulsa OK para iniciar sesión con Telegram");
  document.addEventListener("keydown", handleKeyDown, false);
  document.addEventListener("click", handlePointerSelect, false);
  byId("searchInput").addEventListener("input", onSearchInput, false);
  /* Solo desarrollo: tablero de diseño (design/). La carpeta no va en el .wgt, así que en la TV nunca entra aquí. */
  if (/[?&]design=/.test(window.location.search)) {
    var ds = document.createElement("script");
    ds.src = "design/tv-views.js";
    document.head.appendChild(ds);
    return;
  }
  HFSync.onRemote(onSyncRemote);
  warmUpTelegram();
  setTimeout(function () { checkUpdates(false); }, 4000);
};
