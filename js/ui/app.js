/* HomeFlix · arranque, OK/BACK por pantalla y el único manejador de teclado. */

/* Las actualizaciones de la app (botón ↻, modal) están en js/ui/updatemodal.js. */

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
  if (from === "browse" && to !== "browse") {
    dropUpdateModal();
    heroPvCancel();
  }
  if (from === "detail" && to !== "detail" && typeof heroPvCancel === "function") {
    heroPvCancel(); // la vista previa de la ficha (js/ui/detail.js)
  }
  if (from === "login" && to !== "login") {
    cancelLogin();
  }
  if (from === "player" && to !== "player") {
    closePlayer();
  }
  if (from === "live" && to !== "live" && to !== "live-player") {
    stopLivePreview();
  }
  if (from === "live-player" && to !== "live-player" && to !== "live") {
    HFLive.stop();
  }
}

function selectCurrentItem() {
  var el = getCurrentItem();
  if (!el) {
    return;
  }
  if (NXM.open) { handleNextModalSelect(el); return; }
  if (CONF.open) { handleConfirmSelect(el); return; }
  if (UPM.open) { handleUpdateSelect(el); return; }
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
  else if (currentRoute === "live") { handleLiveSelect(el); }
  else if (currentRoute === "live-player") { handleLivePlayerSelect(el); }
}

function goBackByRoute() {
  if (NXM.open) { closeNextModal(); return; }
  if (CONF.open) { closeConfirm(false); return; }
  if (UPM.open) { closeUpdateModal(); return; }
  if (currentRoute === "detail") { closeDetail(); return; }
  if (currentRoute === "tag-edit") { cancelTagEdit(); return; }
  if (currentRoute === "profile-edit") { openProfiles("", true); return; }
  if (currentRoute === "pin") { cancelPin(); return; }
  if (currentRoute === "guide") { closeGuide(); return; }
  if (currentRoute === "search") { openBrowse(browse.section); return; }
  if (currentRoute === "live") { goBackLive(); return; }
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
    /* Desde cualquier fila o el destacado, BACK sube al menú (sobre la sección actual) sin mover la página ni las
     * filas: se anota dónde se estaba para que ▼ vuelva ahí. */
    if (currentArea() && currentArea().name !== "top") {
      browse.resume = { name: currentArea().name, item: state.itemIndex };
      focusAreaByName("top", Math.max(0, menuIndex(browse.section)));
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
  if (currentRoute === "live-player" && handleLivePlayerKey(code)) {
    event.preventDefault();
    return;
  }
  if (currentRoute === "live" && handleLiveKey(code)) {
    event.preventDefault();
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
  var element;
  /* el botón de atrás del reproductor (‹, arriba a la izquierda) no es parte del foco del control, pero con puntero (mouse, Magic Remote) se pulsa */
  if (currentRoute === "player" && event.target && event.target.closest && event.target.closest(".hf2-pl-back")) { exitPlayer(player.error); return; }
  /* ✕ de los paneles del reproductor (audio y subtítulos, capítulos): equivale a BACK */
  if (currentRoute === "player" && player.panel && event.target && event.target.closest && event.target.closest(".hf2-pl-close")) { closePanel(); return; }
  /* web PC: un clic fuera del panel abierto (audio y subtítulos, capítulos) lo cierra */
  if (currentRoute === "player" && player.panel && document.documentElement.getAttribute("data-web") === "pc" && event.target && event.target.closest &&
      !event.target.closest("#plTracks,#plEps")) { closePanel(); return; }
  /* con puntero (mouse o Magic Remote): «Inicio», «Volver» y el logo de la ficha llevan donde dicen (en la TV el control usa BACK) */
  if (event.target && event.target.closest && /^(detail|search|guide|browse|live)$/.test(currentRoute) && !(event.target.closest("[data-focusable]"))) {
    if (event.target.closest(".hf2-home") || event.target.closest(".hf2-brand")) { openBrowse("home"); return; }
    if (event.target.closest(".hf2-back")) { goBackByRoute(); return; }
  }
  /* búsqueda (web PC): ‹ vuelve a la sección de donde se vino y ✕ borra lo escrito */
  if (currentRoute === "search" && event.target && event.target.closest) {
    if (event.target.closest(".hf2-s-back")) { openBrowse(browse.section); return; }
    if (event.target.closest(".hf2-s-clear")) {
      byId("searchInput").value = "";
      renderSearchResults("input", 0);
      focusInput(byId("searchInput"));
      return;
    }
  }
  /* selector de destacados: ‹ retrocede, › avanza y cada punto va a su destacado (todo el selector es un solo elemento enfocable y antes cualquier clic avanzaba) */
  if (currentRoute === "browse" && event.target && event.target.closest) {
    var pick = event.target.closest("#billboard .hf2-bb-dots .arr, #billboard .hf2-bb-dots .pts i");
    if (pick) {
      heroPointerPick(pick);
      return;
    }
  }
  element = findFocusableFromTarget(event.target);
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
    browseRepaint(); // llegó progreso / Mi lista de otro dispositivo: solo se repinta si cambió lo que se ve y nadie está navegando
  } else if (currentRoute === "profiles") {
    renderProfiles(false);
  } else if (currentRoute === "live" && !LV.editing) {
    /* llegó (o se quitó) la lista desde el celular: volver a abrir «TV en vivo» con la nueva */
    var cfg = HFIptv.config();
    if (!cfg || !LV.data || LV.data.url !== cfg.url) { LV.data = null; openLive(); }
  }
}

/* Tizen: las teclas multimedia del mando solo llegan si se registran. */
function registerTvKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ["MediaPlay", "MediaPause", "MediaPlayPause", "MediaFastForward", "MediaRewind", "MediaStop", "ChannelUp", "ChannelDown", "Info", "ColorF1Green", "ColorF2Yellow", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach(function (k) {
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
  /* Versión web en un computador (?web=1, js/web-pc.js): en una ventana más ancha que 16:9 el lienzo se ENSANCHA en vez de dejar franjas
   * negras a los lados. La altura manda (1080 de diseño), y el ancho de diseño pasa a ser --W (css/app.css y hf2.css lo usan, con 1920 por
   * defecto, o sea: en la TV no cambia nada). Si la ventana es más angosta que 16:9 queda como siempre (franjas arriba y abajo). */
  if (document.documentElement.getAttribute("data-web") === "pc" && w / h > 1920 / 1080) {
    s = h / 1080;
    appRootEl.style.setProperty("--W", Math.round(w / s) + "px");
    appRootEl.style.transform = "scale(" + s + ")";
    return;
  }
  appRootEl.style.removeProperty("--W");
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
  applyCardView();
  initMenuFx();
  window.addEventListener("resize", fitToWindow, false);
  registerTvKeys();
  showRoute("splash"); // la portada se pinta al terminar la intro (abajo)
  document.addEventListener("keydown", handleKeyDown, false);
  document.addEventListener("click", handlePointerSelect, false);
  byId("searchInput").addEventListener("input", onSearchInput, false);
  /* Solo desarrollo: tablero de diseño (design/). La carpeta no va en el .wgt, así que en la TV nunca entra aquí. */
  if (/[?&]design=/.test(window.location.search)) {
    openSplash("Pulsa OK para iniciar sesión con Telegram");
    var ds = document.createElement("script");
    ds.src = "design/tv-views.js";
    document.head.appendChild(ds);
    return;
  }
  HFSync.onRemote(onSyncRemote);
  HFRemote.onMessage(onCastMessage); // «Ver en la TV» desde el celular (js/ui/cast.js)
  /* Intro de marca (js/intro.js) mientras se revisa la sesión; con sesión se entra directo a «¿Quién está viendo?».
   * Si en ese rato el celular ya mandó un video (la app se abrió desde «Ver en la TV»), no se toca la pantalla. */
  /* La portada (decenas de pósters) se pinta DESPUÉS de la intro y solo si hace falta: decodificar esas imágenes mientras
   * corre la animación la traba en las TVs más modestas. */
  var session = warmUpTelegram();
  /* En la TV la intro sostiene su final hasta que la sesión esté lista (si no, quedaba una pantalla vacía antes de los perfiles). */
  HFIntro.play({ base: "", ready: session.then(function () {}, function () {}) }).then(function () {
    if (currentRoute !== "splash") {
      return null; // ya se abrió otra cosa (p. ej. un video mandado desde el celular)
    }
    if (telegramUser) {
      onTelegramReady(telegramUser);
      return null;
    }
    openSplash("Pulsa OK para iniciar sesión con Telegram");
    return Promise.race([session, new Promise(function (r) { setTimeout(function () { r(null); }, 8000); })]).then(function () {
      if (currentRoute === "splash" && telegramUser) {
        onTelegramReady(telegramUser);
      }
    });
  });
  setTimeout(function () { checkUpdates(); }, 9000);
  /* llegó hasta aquí: esta interfaz arranca bien (js/arranque.js no vuelve atrás) */
  setTimeout(function () { if (typeof HFUpdate !== "undefined") { HFUpdate.ok(); } }, 6000);
};
