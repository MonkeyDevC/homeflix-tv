var currentRoute = "splash";

var state = {
  areaIndex: 0,
  itemIndex: 0
};

var browseInitialState = {
  areaIndex: 2,
  itemIndex: 0
};

var routeFocusProfiles = {
  splash: [
    { name: "splash", selector: '[data-area="splash"]' }
  ],
  login: [
    { name: "login", selector: '[data-area="login-loading"]' }
  ],
  profiles: [
    { name: "profiles", selector: '[data-area="profiles"]' },
    { name: "profiles-actions", selector: '[data-area="profiles-actions"]' }
  ],
  browse: [
    { name: "topnav", selector: '[data-area="topnav"]' },
    { name: "hero", selector: '[data-area="hero"]' },
    { name: "row-0", selector: '[data-area="row-0"]' },
    { name: "row-1", selector: '[data-area="row-1"]' }
  ]
};

var focusAreas = [];
var focusCache = [];
var rowScrollCache = {};
var rowOffsets = { 2: 0, 3: 0 };
var previousFocusedItem = null;
var statusMessageEl = null;
var appRootEl = null;
var heroTrackEl = null;
var rowIndicatorEls = {};
var detailOverlayEl = null;
var detailTitleEl = null;
var detailDescriptionEl = null;
var detailBadgeEl = null;
var detailPrimaryActionEl = null;
var detailActionEls = [];
var detailActionIndex = 0;
var isDetailOpen = false;
var USE_NATIVE_FOCUS = false;
var selectedProfileName = "";
var loginPasswordInputEl = null;
var passwordToggleEl = null;
var passwordVisible = false;

/* Login con Telegram */
var loginShellEl = null;
var loginState = "loading";
var loginRun = 0;
var loginAbort = null;
var passwordResolver = null;
var pendingPasswordError = "";
var telegramUser = null;
var apiIdInputEl = null;
var apiHashInputEl = null;
var apiErrorEl = null;
var passwordErrorEl = null;
var loginErrorTextEl = null;
var loginQrEl = null;
var loginQrBoxEl = null;
var profilesAccountEl = null;
var splashPrimaryEl = null;

function setRouteFocusProfile(routeName) {
  if (routeName === "login") {
    focusAreas = [{ name: "login", selector: '[data-area="login-' + loginState + '"]' }];
    return;
  }
  focusAreas = routeFocusProfiles[routeName] || [];
}

function buildFocusCache() {
  var i;
  focusCache = [];
  for (i = 0; i < focusAreas.length; i += 1) {
    focusCache[i] = document.querySelectorAll(focusAreas[i].selector);
  }
}

function buildTitleCache() {
  var areaIndex;
  var items;
  var i;
  var item;
  for (areaIndex = 0; areaIndex < focusCache.length; areaIndex += 1) {
    items = focusCache[areaIndex];
    for (i = 0; i < items.length; i += 1) {
      item = items[i];
      item._hfTitle = item.getAttribute("data-title") || "Sin titulo";
      item._hfDescription = item.getAttribute("data-description") || "Contenido destacado de HomeFlix para ver en familia.";
      item._hfType = item.getAttribute("data-type") || "movie";
      item._hfKindLabel = item.getAttribute("data-kind-label") || (item._hfType === "series" ? "SERIE" : "PELÍCULA");
    }
  }
}

function getAreaItems(areaIndex) {
  if (areaIndex < 0 || areaIndex >= focusCache.length) {
    return [];
  }
  return focusCache[areaIndex];
}

function buildRowMeasurements(areaIndex, track, viewport) {
  var items = getAreaItems(areaIndex);
  var positions = [];
  var i;
  var item;
  var itemLeft;
  var itemRight;
  var totalWidth = 0;

  for (i = 0; i < items.length; i += 1) {
    item = items[i];
    itemLeft = item.offsetLeft;
    itemRight = itemLeft + item.offsetWidth;
    positions[i] = { left: itemLeft, right: itemRight };
    if (itemRight > totalWidth) {
      totalWidth = itemRight;
    }
  }

  return {
    track: track,
    viewportWidth: viewport ? viewport.clientWidth : 1800,
    positions: positions,
    totalWidth: totalWidth
  };
}

function buildRowScrollCache() {
  var row0Track = document.querySelector('[data-track="row-0"]');
  var row1Track = document.querySelector('[data-track="row-1"]');
  var row0Viewport = row0Track ? row0Track.parentNode : null;
  var row1Viewport = row1Track ? row1Track.parentNode : null;

  if (currentRoute !== "browse") {
    rowScrollCache = {};
    return;
  }

  rowScrollCache = {
    2: buildRowMeasurements(2, row0Track, row0Viewport),
    3: buildRowMeasurements(3, row1Track, row1Viewport)
  };
  rowOffsets[2] = 0;
  rowOffsets[3] = 0;
  if (row0Track) {
    row0Track.style.transform = "translateX(0px)";
  }
  if (row1Track) {
    row1Track.style.transform = "translateX(0px)";
  }
}

function buildRowIndicators() {
  rowIndicatorEls[2] = document.getElementById("indicator-row-0");
  rowIndicatorEls[3] = document.getElementById("indicator-row-1");
}

function buildDetailRefs() {
  detailOverlayEl = document.getElementById("detailOverlay");
  detailTitleEl = document.getElementById("detailTitle");
  detailDescriptionEl = document.getElementById("detailDescription");
  detailBadgeEl = document.getElementById("detailBadge");
  detailPrimaryActionEl = document.getElementById("detailPrimaryAction");
  detailActionEls = document.querySelectorAll(".detail-action");
}

function buildLoginRefs() {
  loginShellEl = document.getElementById("loginShell");
  loginPasswordInputEl = document.getElementById("loginPasswordInput");
  passwordToggleEl = document.getElementById("passwordToggle");
  apiIdInputEl = document.getElementById("apiIdInput");
  apiHashInputEl = document.getElementById("apiHashInput");
  apiErrorEl = document.getElementById("apiError");
  passwordErrorEl = document.getElementById("passwordError");
  loginErrorTextEl = document.getElementById("loginErrorText");
  loginQrEl = document.getElementById("loginQr");
  loginQrBoxEl = document.getElementById("loginQrBox");
  profilesAccountEl = document.getElementById("profilesAccountName");
  splashPrimaryEl = document.querySelector(".prelogin-cta.primary");
}

function isTypingInInput() {
  return !!document.activeElement && document.activeElement.tagName === "INPUT";
}

function blurActiveLoginInput() {
  if (isTypingInInput()) {
    document.activeElement.blur();
  }
}

function focusLoginInput(inputEl) {
  if (!inputEl) {
    return;
  }
  if (document.activeElement && document.activeElement !== inputEl && document.activeElement.blur) {
    document.activeElement.blur();
  }
  inputEl.focus();
  if (inputEl.select) {
    inputEl.select();
  }
}

function togglePasswordVisibility() {
  var iconEl;
  if (!loginPasswordInputEl || !passwordToggleEl) {
    return;
  }
  blurActiveLoginInput();
  passwordVisible = !passwordVisible;
  loginPasswordInputEl.setAttribute("type", passwordVisible ? "text" : "password");
  passwordToggleEl.setAttribute("data-password-visible", passwordVisible ? "true" : "false");
  passwordToggleEl.setAttribute("data-title", passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordToggleEl._hfTitle = passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña";
  iconEl = passwordToggleEl.querySelector(".eye-icon");
  if (iconEl) {
    iconEl.setAttribute("data-eye-state", passwordVisible ? "open" : "closed");
  }
  updateStatus(passwordVisible ? "Contraseña visible" : "Contraseña oculta");
}

/* ===== Login con Telegram ===== */

function setLoginState(nextState) {
  loginState = nextState;
  if (loginShellEl) {
    loginShellEl.setAttribute("data-login-state", nextState);
  }
  if (currentRoute !== "login") {
    return;
  }
  blurActiveLoginInput();
  clearPreviousFocus();
  state.areaIndex = 0;
  state.itemIndex = 0;
  rebuildRouteFocus("login");
  updateFocus();
}

function cancelLogin() {
  loginRun += 1;
  if (loginAbort) {
    loginAbort.abort();
    loginAbort = null;
  }
  passwordResolver = null;
}

function showApiForm(message) {
  var api = HFTelegram.credentials();
  if (apiIdInputEl && api && !apiIdInputEl.value) {
    apiIdInputEl.value = String(api.id);
  }
  if (apiErrorEl) {
    apiErrorEl.textContent = message || "";
  }
  setLoginState("api");
  updateStatus("Configura la clave de API de Telegram");
}

function showLoginError(message) {
  if (loginErrorTextEl) {
    loginErrorTextEl.textContent = message;
  }
  setLoginState("error");
  updateStatus("No se pudo conectar con Telegram");
}

function showPasswordForm() {
  if (loginPasswordInputEl) {
    loginPasswordInputEl.value = "";
  }
  if (passwordErrorEl) {
    passwordErrorEl.textContent = pendingPasswordError;
  }
  pendingPasswordError = "";
  setLoginState("password");
}

function errorText(e) {
  var message = String((e && e.message) || e || "Error desconocido");
  if (/network|fetch|websocket|sin respuesta/i.test(message)) {
    return "No hay conexión con Telegram. Revisa el internet de la TV y vuelve a intentarlo. (" + message + ")";
  }
  return message;
}

function handleLoginFailure(e) {
  var api;
  if (HFTelegram.rejectedApi(e)) {
    api = HFTelegram.credentials();
    HFTelegram.forgetCredentials();
    showApiForm(api && api.from === "build"
      ? "Telegram ya no acepta la clave incluida en esta versión de HomeFlix. Escribe una propia de my.telegram.org o instala una versión más nueva."
      : "Telegram no aceptó ese api_id / api_hash. Revísalos en my.telegram.org.");
    return;
  }
  showLoginError(errorText(e));
}

function onTelegramReady(user) {
  telegramUser = user;
  if (profilesAccountEl) {
    profilesAccountEl.textContent = "Telegram: " + user.name + (user.username ? " (@" + user.username + ")" : "");
  }
  if (splashPrimaryEl) {
    splashPrimaryEl.textContent = "CONTINUAR";
  }
  navigateTo("profiles", "Hola, " + user.name + ". Selecciona un perfil");
}

function startQrLogin(run) {
  loginAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  HFTelegram.loginQr({
    onUrl: function (url) {
      if (run !== loginRun) {
        return;
      }
      loginQrEl.innerHTML = HFTelegram.qrSvg(url, 8);
      loginQrBoxEl.setAttribute("data-scanned", "false");
      if (loginState !== "qr") {
        setLoginState("qr");
        updateStatus("Escanea el código con Telegram");
      }
    },
    onScanned: function () {
      if (run !== loginRun) {
        return;
      }
      loginQrBoxEl.setAttribute("data-scanned", "true");
      updateStatus("Código escaneado, entrando…");
    },
    askPassword: function () {
      return new Promise(function (resolve) {
        if (run !== loginRun) {
          return;
        }
        passwordResolver = resolve;
        showPasswordForm();
      });
    },
    onBadPassword: function () {
      pendingPasswordError = "Contraseña incorrecta. Inténtalo de nuevo.";
    },
    signal: loginAbort ? loginAbort.signal : undefined
  }).then(function (user) {
    if (run === loginRun) {
      onTelegramReady(user);
    }
  }, function (e) {
    if (run === loginRun) {
      handleLoginFailure(e);
    }
  });
}

function runTelegramLogin() {
  var run;
  cancelLogin();
  run = loginRun;
  if (!HFTelegram.available()) {
    showLoginError("No se cargó el motor de Telegram (js/tg.bundle.js).");
    return;
  }
  if (!HFTelegram.credentials()) {
    showApiForm("");
    return;
  }
  setLoginState("loading");
  updateStatus("Conectando con Telegram…");
  HFTelegram.me().then(function (user) {
    if (run !== loginRun) {
      return;
    }
    if (user) {
      onTelegramReady(user);
      return;
    }
    startQrLogin(run);
  }, function (e) {
    if (run === loginRun) {
      handleLoginFailure(e);
    }
  });
}

function saveApiFromForm() {
  var problem = HFTelegram.validateCredentials(apiIdInputEl.value, apiHashInputEl.value);
  if (problem) {
    apiErrorEl.textContent = problem;
    updateStatus(problem);
    return;
  }
  HFTelegram.saveCredentials(apiIdInputEl.value, apiHashInputEl.value);
  apiHashInputEl.value = "";
  runTelegramLogin();
}

function sendPasswordFromForm() {
  var value = loginPasswordInputEl ? loginPasswordInputEl.value : "";
  var resolve = passwordResolver;
  if (!value) {
    passwordErrorEl.textContent = "Escribe la contraseña.";
    return;
  }
  if (!resolve) {
    runTelegramLogin();
    return;
  }
  passwordResolver = null;
  setLoginState("loading");
  updateStatus("Verificando contraseña…");
  resolve(value);
}

function logoutTelegram() {
  updateStatus("Cerrando sesión de Telegram…");
  HFTelegram.logout().then(function () {
    telegramUser = null;
    if (splashPrimaryEl) {
      splashPrimaryEl.textContent = "INICIAR SESIÓN";
    }
    navigateTo("splash", "Sesión de Telegram cerrada");
  });
}

/* Al abrir la app: si ya hay sesión, el botón principal dice CONTINUAR y entra directo. */
function warmUpTelegram() {
  if (!HFTelegram.available() || !HFTelegram.credentials()) {
    return;
  }
  HFTelegram.me().then(function (user) {
    if (user && !telegramUser) {
      telegramUser = user;
      if (splashPrimaryEl) {
        splashPrimaryEl.textContent = "CONTINUAR";
      }
      if (profilesAccountEl) {
        profilesAccountEl.textContent = "Telegram: " + user.name + (user.username ? " (@" + user.username + ")" : "");
      }
    }
  }, function () {
    /* se mostrará el error al entrar al login */
  });
}

function clampItemIndexToArea() {
  var items = getAreaItems(state.areaIndex);
  if (!items.length) {
    state.itemIndex = 0;
    return;
  }
  if (state.itemIndex > items.length - 1) {
    state.itemIndex = items.length - 1;
  }
  if (state.itemIndex < 0) {
    state.itemIndex = 0;
  }
}

function getCurrentItem() {
  var items;
  clampItemIndexToArea();
  items = getAreaItems(state.areaIndex);
  if (!items.length) {
    return null;
  }
  return items[state.itemIndex];
}

function clearPreviousFocus() {
  if (previousFocusedItem) {
    previousFocusedItem.removeAttribute("data-focused");
  }
  previousFocusedItem = null;
}

function applyRowOffset(areaIndex, offset) {
  var config = rowScrollCache[areaIndex];
  if (!config || !config.track) {
    return;
  }
  if (rowOffsets[areaIndex] === offset) {
    return;
  }
  rowOffsets[areaIndex] = offset;
  config.track.style.transform = "translateX(-" + offset + "px)";
}

function ensureCurrentRowItemVisible() {
  var areaIndex = state.areaIndex;
  var config = rowScrollCache[areaIndex];
  var items = getAreaItems(areaIndex);
  var itemBounds;
  var itemWidth;
  var idealLeft;
  var maxOffset;
  var nextOffset;

  if (currentRoute !== "browse") {
    return;
  }
  if (!config || !config.track || !items.length || !config.positions) {
    return;
  }

  itemBounds = config.positions[state.itemIndex];
  if (!itemBounds) {
    return;
  }

  itemWidth = itemBounds.right - itemBounds.left;
  idealLeft = Math.floor((config.viewportWidth - itemWidth) / 2);
  nextOffset = itemBounds.left - idealLeft;
  maxOffset = config.totalWidth - config.viewportWidth;

  if (maxOffset < 0) {
    maxOffset = 0;
  }
  if (nextOffset < 0) {
    nextOffset = 0;
  }
  if (nextOffset > maxOffset) {
    nextOffset = maxOffset;
  }
  applyRowOffset(areaIndex, nextOffset);
}

function updateActiveAreaView() {
  var area = focusAreas[state.areaIndex];
  if (!appRootEl || !area) {
    return;
  }
  if (appRootEl.getAttribute("data-active-area") !== area.name) {
    appRootEl.setAttribute("data-active-area", area.name);
  }
}

function updateHeroCarousel() {
  var offset;
  if (currentRoute !== "browse" || state.areaIndex !== 1 || !heroTrackEl) {
    return;
  }
  offset = state.itemIndex * 100;
  heroTrackEl.style.transform = "translateX(-" + offset + "%)";
  if (appRootEl) {
    appRootEl.setAttribute("data-hero-index", String(state.itemIndex));
  }
}

function updateRowIndicators() {
  var areaIndex;
  var el;
  var items;
  if (currentRoute !== "browse") {
    return;
  }
  for (areaIndex = 2; areaIndex <= 3; areaIndex += 1) {
    el = rowIndicatorEls[areaIndex];
    if (!el) {
      continue;
    }
    items = getAreaItems(areaIndex);
    if (!items.length) {
      el.textContent = "0 / 0";
      continue;
    }
    if (state.areaIndex === areaIndex) {
      el.textContent = (state.itemIndex + 1) + " / " + items.length;
    } else {
      el.textContent = "1 / " + items.length;
    }
  }
}

function updateFocus() {
  var newItem = getCurrentItem();
  updateActiveAreaView();
  updateHeroCarousel();
  updateRowIndicators();
  if (!newItem || previousFocusedItem === newItem) {
    ensureCurrentRowItemVisible();
    return;
  }
  if (previousFocusedItem) {
    previousFocusedItem.removeAttribute("data-focused");
  }
  newItem.setAttribute("data-focused", "true");
  if (USE_NATIVE_FOCUS && document.activeElement !== newItem) {
    newItem.focus();
  }
  previousFocusedItem = newItem;
  if (currentRoute === "login") {
    updateStatus(newItem._hfDescription || newItem.getAttribute("data-description") || newItem._hfTitle || "Login");
  }
  ensureCurrentRowItemVisible();
}

function moveLeft() {
  if (state.itemIndex > 0) {
    state.itemIndex -= 1;
    updateFocus();
  }
}

function moveRight() {
  var items = getAreaItems(state.areaIndex);
  if (state.itemIndex < items.length - 1) {
    state.itemIndex += 1;
    updateFocus();
  }
}

function moveUp() {
  if (currentRoute === "login" && state.itemIndex > 0) {
    state.itemIndex -= 1;
    updateFocus();
    return;
  }
  if (state.areaIndex > 0) {
    state.areaIndex -= 1;
    clampItemIndexToArea();
    updateFocus();
  }
}

function moveDown() {
  var items;
  if (currentRoute === "login") {
    items = getAreaItems(state.areaIndex);
    if (state.itemIndex < items.length - 1) {
      state.itemIndex += 1;
      updateFocus();
    }
    return;
  }
  if (state.areaIndex < focusAreas.length - 1) {
    state.areaIndex += 1;
    clampItemIndexToArea();
    updateFocus();
  }
}

function updateDetailFocus() {
  var i;
  for (i = 0; i < detailActionEls.length; i += 1) {
    if (i === detailActionIndex) {
      detailActionEls[i].setAttribute("data-focused", "true");
    } else {
      detailActionEls[i].removeAttribute("data-focused");
    }
  }
}

function openDetail(current) {
  var title;
  var description;
  var type;
  var kindLabel;

  if (!current || !detailOverlayEl) {
    return;
  }

  title = current._hfTitle || current.getAttribute("data-title") || "Sin titulo";
  description = current._hfDescription || current.getAttribute("data-description") || "Contenido destacado de HomeFlix para ver en familia.";
  type = current._hfType || current.getAttribute("data-type") || "movie";
  kindLabel = current._hfKindLabel || current.getAttribute("data-kind-label") || (type === "series" ? "SERIE" : "PELÍCULA");

  detailTitleEl.textContent = title;
  detailDescriptionEl.textContent = description;

  if (detailBadgeEl) {
    detailBadgeEl.textContent = kindLabel;
    detailBadgeEl.setAttribute("data-content-type", type);
  }

  if (detailPrimaryActionEl) {
    detailPrimaryActionEl.textContent = type === "series" ? "Ver temporadas" : "▶ Reproducir";
    detailPrimaryActionEl.setAttribute("data-content-type", type);
  }

  detailActionIndex = 0;
  detailOverlayEl.setAttribute("data-open", "true");
  detailOverlayEl.setAttribute("data-content-type", type);
  isDetailOpen = true;

  if (previousFocusedItem) {
    previousFocusedItem.removeAttribute("data-focused");
  }

  updateDetailFocus();
  updateStatus((type === "series" ? "Serie: " : "Película: ") + title);
}

function closeDetail() {
  var i;
  if (!detailOverlayEl) {
    return;
  }
  detailOverlayEl.setAttribute("data-open", "false");
  isDetailOpen = false;
  for (i = 0; i < detailActionEls.length; i += 1) {
    detailActionEls[i].removeAttribute("data-focused");
  }
  previousFocusedItem = null;
  updateFocus();
  updateStatus("Detalle cerrado");
}

function handleDetailKey(code) {
  if (code === 37 && detailActionIndex > 0) {
    detailActionIndex -= 1;
    updateDetailFocus();
    return;
  }
  if (code === 39 && detailActionIndex < detailActionEls.length - 1) {
    detailActionIndex += 1;
    updateDetailFocus();
    return;
  }
  if (code === 13) {
    if (detailActionIndex === 0) {
      if (detailOverlayEl && detailOverlayEl.getAttribute("data-content-type") === "series") {
        updateStatus("Temporadas preparadas para Fase 4.2B");
      } else {
        updateStatus("Reproducir aun no implementado");
      }
    } else {
      closeDetail();
    }
    return;
  }
  if (code === 10009) {
    closeDetail();
  }
}

function configureRouteState(routeName) {
  if (routeName === "browse") {
    state.areaIndex = browseInitialState.areaIndex;
    state.itemIndex = browseInitialState.itemIndex;
    return;
  }
  state.areaIndex = 0;
  state.itemIndex = 0;
}

function rebuildRouteFocus(routeName) {
  setRouteFocusProfile(routeName);
  buildFocusCache();
  buildTitleCache();
  if (routeName === "browse") {
    buildRowScrollCache();
  }
}

function navigateTo(routeName, message) {
  if (currentRoute === "login" && routeName !== "login") {
    cancelLogin();
    blurActiveLoginInput();
  }
  currentRoute = routeName;
  if (appRootEl) {
    appRootEl.setAttribute("data-route", routeName);
    appRootEl.setAttribute("data-active-area", "");
  }
  if (isDetailOpen) {
    closeDetail();
  }
  clearPreviousFocus();
  configureRouteState(routeName);
  rebuildRouteFocus(routeName);
  updateFocus();
  updateStatus(message || "Vista: " + routeName);
}

function handleSplashSelect(current) {
  var title = current ? (current._hfTitle || current.getAttribute("data-title") || "") : "";
  if (title === "Crear cuenta") {
    updateStatus("HomeFlix entra con tu cuenta de Telegram: elige Iniciar sesión");
    return;
  }
  if (telegramUser) {
    onTelegramReady(telegramUser);
    return;
  }
  navigateTo("login", "Conectando con Telegram…");
  runTelegramLogin();
}

function handleLoginSelect(current) {
  var action = current ? current.getAttribute("data-action") : "";
  var inputId = current ? current.getAttribute("data-input") : "";
  if (inputId) {
    focusLoginInput(document.getElementById(inputId));
    updateStatus("Escribe con el teclado de la TV y pulsa Listo");
    return;
  }
  blurActiveLoginInput();
  if (action === "save-api") {
    saveApiFromForm();
    return;
  }
  if (action === "send-password") {
    sendPasswordFromForm();
    return;
  }
  if (action === "toggle-password") {
    togglePasswordVisibility();
    return;
  }
  if (action === "change-api") {
    cancelLogin();
    showApiForm("");
    return;
  }
  if (action === "retry") {
    runTelegramLogin();
    return;
  }
  if (action === "back") {
    navigateTo("splash", "Pantalla inicial");
  }
}

function handleProfileSelect(current) {
  if (current && current.getAttribute("data-action") === "logout") {
    logoutTelegram();
    return;
  }
  selectedProfileName = current ? (current._hfTitle || current.getAttribute("data-title") || "Perfil") : "Perfil";
  browseInitialState.areaIndex = 2;
  browseInitialState.itemIndex = 0;
  navigateTo("browse", "Perfil activo: " + selectedProfileName);
}

function handleBrowseTopnavSelect(current) {
  var title = current ? (current._hfTitle || current.getAttribute("data-title") || "") : "";
  if (title === "Perfil") {
    navigateTo("profiles", "Cambiar perfil");
    return;
  }
  if (title === "Buscar") {
    updateStatus("Buscar aun no implementado");
    return;
  }
  updateStatus("Vista " + title + " preparada para fase siguiente");
}

function selectCurrentItem() {
  var current = getCurrentItem();
  var title;
  if (!current) {
    updateStatus("No hay elemento seleccionado");
    return;
  }
  title = current._hfTitle || current.getAttribute("data-title") || "Sin titulo";

  if (currentRoute === "splash") {
    handleSplashSelect(current);
    return;
  }
  if (currentRoute === "login") {
    handleLoginSelect(current);
    return;
  }
  if (currentRoute === "profiles") {
    handleProfileSelect(current);
    return;
  }
  if (currentRoute === "browse") {
    if (state.areaIndex === 0) {
      handleBrowseTopnavSelect(current);
      return;
    }
    if (state.areaIndex === 1 || state.areaIndex === 2 || state.areaIndex === 3) {
      openDetail(current);
      return;
    }
  }
  updateStatus("Seleccionaste: " + title);
}

function goBackByRoute() {
  if (currentRoute === "browse") {
    navigateTo("profiles", "Volviste a perfiles");
    return;
  }
  if (currentRoute === "profiles") {
    navigateTo("splash", "Pantalla inicial");
    return;
  }
  if (currentRoute === "login") {
    navigateTo("splash", "Pantalla inicial");
    return;
  }
  updateStatus("Back presionado");
}

function updateStatus(message) {
  if (statusMessageEl && statusMessageEl.textContent !== message) {
    statusMessageEl.textContent = message;
  }
}

function handleKeyDown(event) {
  var code = event.keyCode;
  if (code === 27) {
    code = 10009; // Esc en el navegador de escritorio = Back del mando
  }
  /* Escribiendo en un campo: Enter / "Listo" (65376) del teclado de la TV cierra el teclado y baja al siguiente;
   * "Cancelar" (65385) solo cierra el teclado. Las demás teclas son del campo. */
  if (isTypingInInput()) {
    if (code === 13 || code === 65376) {
      event.preventDefault();
      blurActiveLoginInput();
      if (currentRoute === "login" && loginState === "password") {
        sendPasswordFromForm();
      } else {
        moveDown();
      }
      return;
    }
    if (code === 65385) {
      blurActiveLoginInput();
      return;
    }
    if (code !== 38 && code !== 40 && code !== 10009) {
      return;
    }
  }
  if (code === 37 || code === 38 || code === 39 || code === 40 || code === 13 || code === 10009) {
    event.preventDefault();
  }
  if (currentRoute === "login" && (code === 37 || code === 38 || code === 39 || code === 40)) {
    blurActiveLoginInput();
  }
  if (isDetailOpen) {
    handleDetailKey(code);
    return;
  }
  switch (code) {
    case 37:
      moveLeft();
      break;
    case 38:
      moveUp();
      break;
    case 39:
      moveRight();
      break;
    case 40:
      moveDown();
      break;
    case 13:
      selectCurrentItem();
      break;
    case 10009:
      goBackByRoute();
      break;
    default:
      break;
  }
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

function syncStateToElement(element) {
  var areaIndex;
  var items;
  var itemIndex;
  for (areaIndex = 0; areaIndex < focusCache.length; areaIndex += 1) {
    items = focusCache[areaIndex];
    for (itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      if (items[itemIndex] === element) {
        state.areaIndex = areaIndex;
        state.itemIndex = itemIndex;
        updateFocus();
        return true;
      }
    }
  }
  return false;
}

function handlePointerSelect(event) {
  var element = findFocusableFromTarget(event.target);
  if (event.target && event.target.tagName === "INPUT") {
    if (element) {
      syncStateToElement(element);
    }
    return;
  }
  blurActiveLoginInput();
  if (!element) {
    return;
  }
  if (syncStateToElement(element)) {
    selectCurrentItem();
  }
}

window.onload = function () {
  statusMessageEl = document.getElementById("statusMessage");
  appRootEl = document.getElementById("app");
  heroTrackEl = document.getElementById("heroTrack");
  buildRowIndicators();
  buildDetailRefs();
  buildLoginRefs();
  appRootEl.setAttribute("data-hero-index", "0");
  navigateTo("splash", "Selecciona una opción para continuar");
  document.addEventListener("keydown", handleKeyDown, false);
  document.addEventListener("click", handlePointerSelect, false);
  warmUpTelegram();
};
