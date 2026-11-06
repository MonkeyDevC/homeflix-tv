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
    { name: "login", selector: '[data-area="login"]' }
  ],
  profiles: [
    { name: "profiles", selector: '[data-area="profiles"]' }
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
var loginUsernameInputEl = null;
var loginPasswordInputEl = null;
var passwordToggleEl = null;
var rememberOptionEl = null;
var passwordVisible = false;

function setRouteFocusProfile(routeName) {
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
  loginUsernameInputEl = document.getElementById("loginUsernameInput");
  loginPasswordInputEl = document.getElementById("loginPasswordInput");
  passwordToggleEl = document.getElementById("passwordToggle");
  rememberOptionEl = document.querySelector(".login-option");
}

function blurActiveLoginInput() {
  if (document.activeElement === loginUsernameInputEl || document.activeElement === loginPasswordInputEl) {
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

function toggleRememberMe() {
  var checked;
  blurActiveLoginInput();
  if (!rememberOptionEl) {
    return;
  }
  checked = rememberOptionEl.getAttribute("data-checked") !== "true";
  rememberOptionEl.setAttribute("data-checked", checked ? "true" : "false");
  updateStatus(checked ? "Recordar sesión activado" : "Recordar sesión desactivado");
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
    updateStatus("Creación de cuenta preparada para fase futura");
    return;
  }
  navigateTo("login", "Ingresa para continuar");
}

function handleLoginSelect(current) {
  var title = current ? (current._hfTitle || current.getAttribute("data-title") || "") : "";
  if (title === "Ingresar") {
    blurActiveLoginInput();
    navigateTo("profiles", "Selecciona un perfil");
    return;
  }
  if (title === "Olvidé mi contraseña") {
    blurActiveLoginInput();
    updateStatus("Recuperación de contraseña preparada para fase futura");
    return;
  }
  if (title === "Usuario") {
    focusLoginInput(loginUsernameInputEl);
    updateStatus("Escribe tu usuario con el teclado del TV");
    return;
  }
  if (title === "Contraseña") {
    focusLoginInput(loginPasswordInputEl);
    updateStatus("Escribe tu contraseña con el teclado del TV");
    return;
  }
  if (title === "Mostrar contraseña" || title === "Ocultar contraseña") {
    togglePasswordVisibility();
    return;
  }
  if (title === "Recordarme") {
    toggleRememberMe();
    return;
  }
  updateStatus("Campo seleccionado: " + title);
}

function handleProfileSelect(current) {
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
    navigateTo("login", "Volviste al login");
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
  if (currentRoute === "login" && event.target !== loginUsernameInputEl && event.target !== loginPasswordInputEl) {
    blurActiveLoginInput();
  }
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
};
