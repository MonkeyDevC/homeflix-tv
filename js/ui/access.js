/* HomeFlix · acceso: pantalla inicial, login con Telegram, perfiles y editor de perfil. */

var telegramUser = null;
var activeProfile = null;

/* ===================== Pantalla inicial ===================== */

/* Mosaico: portadas reales de la biblioteca si hay suficientes; si no, carátulas ilustradas. */
function wallHtml(opts) {
  var keys = [];
  var COLS = 7;
  var PER = 4;
  opts = opts || {};
  if (telegramUser && library && library.recent) {
    library.recent.concat(library.unclassified || []).forEach(function (t) {
      var k = t.imageKey || t.key;
      if (k && keys.indexOf(k) < 0) {
        keys.push(k);
      }
    });
  }
  /* Prioridad: tus portadas de images/portadas/ → carátulas reales de la biblioteca → pósters de ejemplo. */
  var own = typeof HF_PORTADAS !== "undefined" && HF_PORTADAS && HF_PORTADAS.length ? HF_PORTADAS : null;
  var useReal = !own && keys.length >= 6;
  var cols = [];
  var c;
  var k;
  var tiles;
  var n;
  for (c = 0; c < COLS; c += 1) {
    tiles = "";
    for (k = 0; k < PER; k += 1) {
      /* 7 columnas × 4 = 28 tarjetas. Cada columna toma las 4 siguientes de la lista: con 14 portadas cada una
       * sale 2 veces, nunca dos veces en la misma columna ni en columnas vecinas (la 2.ª vez cae 3 columnas más allá). */
      n = c * PER + k;
      tiles += own
        ? '<div class="hf2-tile" style="background-image:url(\'' + esc(encodeURI(own[n % own.length])) + '\')"></div>'
        : useReal
        ?'<div class="hf2-tile hf2-img" data-img="' + esc(keys[n % keys.length]) + '" data-img-w="480">' + HFArt.poster(n % HFArt.POSTER_COUNT) + "</div>"
        : '<div class="hf2-tile">' + HFArt.poster(n % HFArt.POSTER_COUNT) + "</div>";
    }
    cols.push('<div class="hf2-col ' + (opts.still ? "" : (c % 2 ? "down" : "up")) + '"><div class="hf2-reel' + (opts.still ? " still" : "") + '"' +
      (opts.still ? ' style="transform:translate3d(0,-' + ((c * 137) % 400) + 'px,0)"' : "") + ">" + tiles + (opts.still ? "" : tiles) + "</div></div>");
  }
  return '<div class="hf2-wall' + (opts.dim ? " dim" : "") + '">' + cols.join("") + "</div>";
}

function renderSplash() {
  var root = byId("scrSplash");
  root.innerHTML = wallHtml() + '<div class="hf2-shade"></div>' + brandHtml() +
    '<div class="hf2-top-actions"><div class="hf2-round" data-focusable="true" data-action="setup" data-title="Ajustes" data-description="Configurar la conexión con Telegram" tabindex="0">' + IC.gear + "</div></div>" +
    '<div class="hf2-hero"><h1>Disfruta películas y<br>series sin límites.</h1>' +
    "<p>Contenido familiar, series y películas seleccionadas para ver desde tu televisor.</p>" +
    '<div class="hf2-ctas"><div class="hf2-btn primary" data-focusable="true" data-action="login" data-title="Iniciar sesión" data-description="' +
      (telegramUser ? "Continuar como " + esc(telegramUser.name) : "Pulsa OK para iniciar sesión con Telegram") + '" tabindex="0">' + (telegramUser ? "Continuar" : "Iniciar sesión") + "</div></div></div>";
  setAreas([
    { name: "top", items: root.querySelectorAll(".hf2-top-actions [data-focusable]"), dir: "h" },
    { name: "cta", items: root.querySelectorAll(".hf2-ctas [data-focusable]"), dir: "h" }
  ], "cta", 0);
  observeImages(root);
}

function openSplash(message) {
  showRoute("splash");
  renderSplash();
  if (message) {
    updateStatus(message);
  }
}

function handleSplashSelect(el) {
  var action = el.getAttribute("data-action");
  if (action === "setup") {
    showRoute("login");
    cancelLogin();
    showApiForm("", true);
    return;
  }
  if (telegramUser) {
    onTelegramReady(telegramUser);
    return;
  }
  showRoute("login");
  runTelegramLogin();
}

/* ===================== Login con Telegram ===================== */

var loginState = "loading";
var loginRun = 0;
var loginAbort = null;
var passwordResolver = null;
var pendingPasswordError = "";
var loginMessage = "";
var apiFormFromSetup = false;

var REFRESH_ICON = IC.refresh;

function loginPanel(main, side, sideClass) {
  return wallHtml({ dim: true, still: true }) + '<div class="hf2-shade strong"></div>' + brandHtml() +
    '<div class="hf2-panel">' + '<div class="hf2-panel-main">' + main + "</div>" +
    (side ? '<div class="hf2-panel-side' + (sideClass ? " " + sideClass : "") + '">' + side + "</div>" : "") + "</div>";
}

function renderLogin() {
  var root = byId("scrLogin");
  var main;
  var side = "";
  var sideClass = "";
  var api = HFTelegram.credentials();
  if (loginState === "qr") {
    main = '<div class="hf2-kicker">Iniciar sesión</div><h1 class="hf2-title">Escanea el código<br>con Telegram</h1>' +
      '<ol class="hf2-steps"><li><span>1</span><div>Abre <b>Telegram</b> en tu teléfono.</div></li>' +
      "<li><span>2</span><div>Ve a <b>Ajustes → Dispositivos</b>.</div></li>" +
      "<li><span>3</span><div>Toca <b>Vincular un dispositivo</b> y apunta la cámara al código.</div></li></ol>" +
      '<div class="hf2-note" id="loginQrNote">' + REFRESH_ICON + "El código se renueva solo cada 30 segundos.</div>" +
      '<div class="hf2-actions"><div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Volver" data-description="Volver a la pantalla inicial" tabindex="0">Volver</div></div>';
    side = '<div class="hf2-qr" id="loginQrBox"><div id="loginQr" style="width:100%;height:100%"></div></div>' +
      '<div class="hf2-qr-caption">Tu cuenta de Telegram es tu biblioteca:<br>nada que crear ni contraseñas que recordar.</div>';
  } else if (loginState === "api") {
    main = '<div class="hf2-kicker">Configurar Telegram</div><h1 class="hf2-title small">' + (apiFormFromSetup ? "Clave de la app<br>de Telegram" : "Telegram pidió una<br>clave nueva") + "</h1>" +
      '<p class="hf2-text">' + (apiFormFromSetup ? "Solo hace falta si Telegram rechazó la clave incluida en HomeFlix." : "Pasa muy pocas veces. Escribe los dos valores de tu app de Telegram y seguimos.") + "</p>" +
      '<div class="hf2-field" data-focusable="true" data-input="apiIdInput" data-title="api_id" data-description="Número de la app de Telegram" tabindex="0"><label>api_id</label><div class="hf2-input"><input id="apiIdInput" type="text" inputmode="numeric" autocomplete="off" placeholder="1234567" value="' + esc(api && api.from !== "build" ? api.id : "") + '"/></div></div>' +
      '<div class="hf2-field" data-focusable="true" data-input="apiHashInput" data-title="api_hash" data-description="Clave de 32 caracteres de la app de Telegram" tabindex="0"><label>api_hash</label><div class="hf2-input"><input id="apiHashInput" type="text" autocomplete="off" spellcheck="false" placeholder="32 caracteres"/></div></div>' +
      '<div class="hf2-error" id="apiError">' + esc(loginMessage) + "</div>" +
      '<div class="hf2-actions"><div class="hf2-btn primary small" data-focusable="true" data-action="save-api" data-title="Guardar y continuar" tabindex="0">Guardar y continuar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Volver" tabindex="0">Volver</div></div>';
    side = '<div class="hf2-help-title">¿Dónde los consigo?</div><ol class="hf2-steps compact">' +
      "<li><span>1</span><div>Desde el teléfono entra a <b>my.telegram.org</b>.</div></li>" +
      "<li><span>2</span><div>Abre <b>API development tools</b>.</div></li>" +
      "<li><span>3</span><div>Crea una app y copia <b>api_id</b> y <b>api_hash</b>.</div></li></ol>" +
      '<div class="hf2-help-tip">Tip: con Apps2Samsung puedes escribir desde el teclado del teléfono.</div>';
    sideClass = "help";
  } else if (loginState === "password") {
    main = '<div class="hf2-kicker">Verificación en dos pasos</div><h1 class="hf2-title small">Escribe tu contraseña<br>de Telegram</h1>' +
      '<p class="hf2-text">Tu cuenta tiene una contraseña adicional. Escríbela para terminar de entrar.</p>' +
      '<div class="hf2-field" data-focusable="true" data-input="loginPasswordInput" data-title="Contraseña" data-description="Escribe la contraseña de verificación en dos pasos" tabindex="0"><label>Contraseña</label><div class="hf2-input"><input id="loginPasswordInput" type="password" autocomplete="current-password"/></div></div>' +
      '<div class="hf2-error" id="passwordError">' + esc(pendingPasswordError) + "</div>" +
      '<div class="hf2-actions"><div class="hf2-btn primary small" data-focusable="true" data-action="send-password" data-title="Continuar" tabindex="0">Continuar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="toggle-password" data-title="Mostrar contraseña" tabindex="0">Mostrar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Cancelar" tabindex="0">Cancelar</div></div>';
    pendingPasswordError = "";
  } else if (loginState === "error") {
    main = '<div class="hf2-kicker">Telegram</div><h1 class="hf2-title small">No se pudo conectar</h1>' +
      '<p class="hf2-text">' + esc(loginMessage) + "</p>" +
      '<div class="hf2-actions"><div class="hf2-btn primary small" data-focusable="true" data-action="retry" data-title="Reintentar" tabindex="0">Reintentar</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="change-api" data-title="Clave de API" tabindex="0">Clave de API</div>' +
      '<div class="hf2-btn ghost small" data-focusable="true" data-action="back" data-title="Volver" tabindex="0">Volver</div></div>';
  } else {
    main = '<div class="hf2-kicker">Telegram</div><h1 class="hf2-title small">Conectando…</h1><p class="hf2-text">Un momento. HomeFlix usa tu cuenta de Telegram como biblioteca de películas y series.</p>';
  }
  root.innerHTML = loginPanel(main, side, sideClass);
  setAreas([
    { name: "fields", items: root.querySelectorAll(".hf2-field[data-focusable]"), dir: "v" },
    { name: "actions", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" }
  ], 0, 0);
}

function setLoginState(nextState) {
  loginState = nextState;
  if (currentRoute === "login") {
    renderLogin();
  }
}

function cancelLogin() {
  loginRun += 1;
  if (loginAbort) {
    loginAbort.abort();
    loginAbort = null;
  }
  passwordResolver = null;
}

function showApiForm(message, fromSetup) {
  loginMessage = message || "";
  apiFormFromSetup = !!fromSetup;
  setLoginState("api");
  updateStatus(message || "Escribe el api_id y el api_hash de tu app de Telegram");
}

function showLoginError(message) {
  loginMessage = message;
  setLoginState("error");
  updateStatus("No se pudo conectar con Telegram");
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
      ? "Telegram ya no acepta la clave incluida en esta versión de HomeFlix. Escribe una propia o instala una versión más nueva."
      : "Telegram no aceptó ese api_id / api_hash. Revísalos en my.telegram.org.");
    return;
  }
  showLoginError(errorText(e));
}

function rememberUser(user) {
  telegramUser = user;
  HFLibrary.setAccount(user.id);
  loadLibraryFromCache();
}

function onTelegramReady(user) {
  rememberUser(user);
  if (!HFLibrary.enabledSources()) {
    openSettings({ firstTime: true });
    return;
  }
  openProfiles("Hola, " + user.name + ". ¿Quién está viendo?");
}

function startQrLogin(run) {
  loginAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  HFTelegram.loginQr({
    onUrl: function (url) {
      if (run !== loginRun) {
        return;
      }
      if (loginState !== "qr") {
        setLoginState("qr");
        updateStatus("Esperando que escanees el código…");
      }
      var box = byId("loginQrBox");
      byId("loginQr").innerHTML = HFTelegram.qrSvg(url, 8);
      if (box) {
        box.removeAttribute("data-scanned");
      }
    },
    onScanned: function () {
      if (run !== loginRun) {
        return;
      }
      updateStatus("Código escaneado, entrando…");
      if (byId("loginQrNote")) {
        byId("loginQrNote").innerHTML = IC.check + "Código escaneado, entrando…";
      }
    },
    askPassword: function () {
      return new Promise(function (resolve) {
        if (run !== loginRun) {
          return;
        }
        passwordResolver = resolve;
        setLoginState("password");
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
  var idEl = byId("apiIdInput");
  var hashEl = byId("apiHashInput");
  var problem = HFTelegram.validateCredentials(idEl.value, hashEl.value);
  if (problem) {
    byId("apiError").textContent = problem;
    updateStatus(problem);
    return;
  }
  HFTelegram.saveCredentials(idEl.value, hashEl.value);
  runTelegramLogin();
}

function sendPasswordFromForm() {
  var input = byId("loginPasswordInput");
  var value = input ? input.value : "";
  var resolve = passwordResolver;
  if (!value) {
    byId("passwordError").textContent = "Escribe la contraseña.";
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

function handleLoginSelect(el) {
  var action = el.getAttribute("data-action");
  var inputId = el.getAttribute("data-input");
  var input;
  if (inputId) {
    focusInput(byId(inputId));
    updateStatus("Escribe con el teclado de la TV y pulsa Listo");
    return;
  }
  if (action === "save-api") {
    saveApiFromForm();
  } else if (action === "send-password") {
    sendPasswordFromForm();
  } else if (action === "toggle-password") {
    input = byId("loginPasswordInput");
    input.setAttribute("type", input.getAttribute("type") === "password" ? "text" : "password");
    el.textContent = input.getAttribute("type") === "password" ? "Mostrar" : "Ocultar";
  } else if (action === "change-api") {
    cancelLogin();
    showApiForm("", true);
  } else if (action === "retry") {
    runTelegramLogin();
  } else if (action === "back") {
    cancelLogin();
    openSplash("Pantalla inicial");
  }
}

function logoutTelegram() {
  updateStatus("Cerrando sesión de Telegram…");
  HFTelegram.logout().then(function () {
    telegramUser = null;
    activeProfile = null;
    setLibraryItems([]);
    openSplash("Sesión de Telegram cerrada");
  });
}

/* Al abrir la app: si ya hay sesión, el botón principal dice «Continuar». */
function warmUpTelegram() {
  if (!HFTelegram.available() || !HFTelegram.credentials()) {
    return;
  }
  HFTelegram.me().then(function (user) {
    if (user && !telegramUser) {
      rememberUser(user);
      if (currentRoute === "splash") {
        renderSplash();
      }
    }
  }, function () {
    /* se mostrará el error al entrar al login */
  });
}

/* ===================== Perfiles ===================== */

var profilesEditMode = false;
var logoutArmed = false;

function profileAvatarHtml(p, cls) {
  return '<div class="hf2-avatar pic' + (cls ? " " + cls : "") + '">' + avatarSvg(p.avatar) +
    (p.kids ? '<em class="hf2-kids">' + IC.star + "Infantil</em>" : "") + "</div>";
}

function openProfiles(message, editMode) {
  showRoute("profiles");
  renderProfiles(!!editMode);
  if (message) {
    updateStatus(message);
  }
}

function renderProfiles(editMode, focusName, focusIndex) {
  var root = byId("scrProfiles");
  var list = HFLibrary.profiles();
  var cards;
  profilesEditMode = !!editMode;
  logoutArmed = false;
  cards = list.map(function (p) {
    var desc = profilesEditMode ? "Editar " + p.name : (p.kids ? p.name + " · perfil infantil" : "Entrar como " + p.name);
    return '<div class="hf2-profile" data-focusable="true" data-profile="' + esc(p.id) + '" data-title="' + esc(p.name) + '" data-description="' + esc(desc) + '" tabindex="0">' +
      profileAvatarHtml(p, profilesEditMode ? "editing" : "") + '<div class="hf2-pname">' + esc(p.name) + "</div></div>";
  });
  if (list.length < HFLibrary.MAX_PROFILES) {
    cards.push('<div class="hf2-profile" data-focusable="true" data-action="add-profile" data-title="Agregar perfil" data-description="Crear un perfil nuevo" tabindex="0"><div class="hf2-avatar add">+</div><div class="hf2-pname">Agregar</div></div>');
  }
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-top-actions">' +
      '<div class="hf2-round" data-focusable="true" data-action="logout" data-title="Cerrar sesión" data-description="Cerrar la sesión de Telegram en esta TV" tabindex="0">' + IC.logout + "</div>" +
      '<div class="hf2-round" data-focusable="true" data-action="settings" data-title="Ajustes" data-description="Elegir de qué chats sale la biblioteca" tabindex="0">' + IC.gear + "</div>" +
    "</div>" +
    '<h1 class="hf2-who">' + (profilesEditMode ? "Elige el perfil que quieres editar" : "¿Quién está viendo?") + "</h1>" +
    '<div class="hf2-profiles">' + cards.join("") + "</div>" +
    '<div class="hf2-center-actions"><div class="hf2-btn ghost small icon" data-focusable="true" data-action="edit-profiles" data-title="Editar perfiles" tabindex="0">' +
      (profilesEditMode ? IC.check + "Listo" : IC.pencil + "Editar perfiles") + "</div></div>" +
    '<div class="hf2-account">' + IC.plane + "Conectado con Telegram como <b>" + esc(telegramUser ? telegramUser.name : "") + "</b>" + (telegramUser && telegramUser.username ? " · @" + esc(telegramUser.username) : "") + "</div>" +
    '<div class="hf2-version">' + esc(appVersion() ? "HomeFlix v" + appVersion() : "HomeFlix") + "</div>" +
    '<div id="updateBanner" style="position:absolute;left:0;right:0;top:920px;z-index:6"></div>';
  renderUpdateBanner();
  setAreas([
    { name: "top", items: root.querySelectorAll(".hf2-top-actions [data-focusable]"), dir: "h" },
    { name: "profiles", items: root.querySelectorAll(".hf2-profiles [data-focusable]"), dir: "h" },
    { name: "actions", items: root.querySelectorAll(".hf2-center-actions [data-focusable]"), dir: "h" },
    { name: "update", items: root.querySelectorAll("#updateBanner [data-focusable]"), dir: "h" }
  ], focusName || "profiles", focusIndex || 0);
}

function handleProfileSelect(el) {
  var action = el.getAttribute("data-action");
  var id = el.getAttribute("data-profile");
  if (action === "logout") {
    if (!logoutArmed) {
      logoutArmed = true;
      updateStatus("Pulsa OK otra vez para cerrar la sesión de Telegram en esta TV");
      return;
    }
    logoutTelegram();
    return;
  }
  logoutArmed = false;
  if (action === "settings") { openSettings({ returnTo: "profiles" }); return; }
  if (action === "edit-profiles") { renderProfiles(!profilesEditMode, "actions", 0); return; }
  if (action === "add-profile") { openProfileEditor(null); return; }
  if (action === "hide-update") { dismissUpdate(); renderProfiles(profilesEditMode); return; }
  if (!id) { return; }
  if (profilesEditMode) { openProfileEditor(id); return; }
  selectProfile(id);
}

function selectProfile(id) {
  HFLibrary.profiles().forEach(function (p) {
    if (p.id === id) {
      activeProfile = p;
    }
  });
  HFLibrary.setProfile(activeProfile.id);
  applyProfileView();
  openBrowse("home", "Perfil: " + activeProfile.name + (activeProfile.kids ? " (infantil)" : ""));
}

/* ----- Editor de perfil ----- */

var profileEdit = { id: null, name: "", avatar: "panda", kids: false };

function openProfileEditor(id) {
  var list = HFLibrary.profiles();
  var p = null;
  var used = {};
  list.forEach(function (x) {
    used[x.avatar] = true;
    if (x.id === id) {
      p = x;
    }
  });
  profileEdit = p ? { id: p.id, name: p.name, avatar: p.avatar, kids: !!p.kids }
    : { id: null, name: "", avatar: HFArt.AVATAR_IDS.filter(function (a) { return !used[a]; })[0] || "panda", kids: false };
  showRoute("profile-edit");
  renderProfileEditor("name", 0);
  updateStatus(p ? "Editando " + p.name : "Escribe el nombre del perfil nuevo");
}

function renderProfileEditor(focusName, focusIndex, error) {
  var root = byId("scrProfileEdit");
  var canDelete = profileEdit.id && HFLibrary.profiles().length > 1;
  var ids = HFArt.AVATAR_IDS;
  var gridRow = function (from) {
    return ids.slice(from, from + 6).map(function (a) {
      return '<span class="hf2-avatar-opt' + (a === profileEdit.avatar ? " on" : "") + '" data-focusable="true" data-avatar="' + a + '" data-title="' + esc(HFArt.AVATAR_NAMES[a]) + '" data-description="Imagen: ' + esc(HFArt.AVATAR_NAMES[a]) + ' · OK para elegirla" tabindex="0">' + HFArt.avatar(a) + "</span>";
    }).join("");
  };
  root.innerHTML = '<div class="hf2-glow"></div>' + brandHtml() +
    '<div class="hf2-panel edit">' +
      '<div class="hf2-edit-preview">' + profileAvatarHtml({ avatar: profileEdit.avatar, kids: profileEdit.kids }, "big") +
        '<div class="hf2-pname">' + esc(profileEdit.name || "Nuevo perfil") + "</div>" +
        '<div class="hf2-preview-note">Así se verá en «¿Quién está viendo?»</div></div>' +
      '<div class="hf2-panel-main">' +
        '<div class="hf2-kicker">Perfil</div><h1 class="hf2-title small">' + (profileEdit.id ? "Editar perfil" : "Nuevo perfil") + "</h1>" +
        '<div class="hf2-field" data-focusable="true" data-input="profileNameInput" data-title="Nombre" data-description="OK para escribir el nombre" tabindex="0"><label>Nombre</label><div class="hf2-input"><input id="profileNameInput" type="text" maxlength="20" autocomplete="off" value="' + esc(profileEdit.name) + '" placeholder="Nombre del perfil"/></div></div>' +
        '<div class="hf2-field"><label>Imagen de perfil <span class="hf2-label-hint">' + esc(HFArt.AVATAR_NAMES[profileEdit.avatar] || "") + "</span></label>" +
          '<div class="hf2-avatar-grid"><div class="av-row" style="display:flex">' + gridRow(0) + '</div><div class="av-row" style="display:flex">' + gridRow(6) + "</div></div></div>" +
        '<div class="hf2-field" data-focusable="true" data-adjust="kids" data-title="Perfil infantil" data-description="OK: un perfil infantil solo ve lo marcado como infantil" tabindex="0"><label>Perfil infantil</label>' +
          '<div class="hf2-toggle-row"><span class="hf2-toggle' + (profileEdit.kids ? " on" : "") + '"><i></i></span><span>' + (profileEdit.kids ? "Solo ve películas y series marcadas como <b>infantiles</b>" : "Ve toda la biblioteca") + "</span></div></div>" +
        '<div class="hf2-error">' + esc(error || "") + "</div>" +
        '<div class="hf2-actions">' +
          '<div class="hf2-btn primary small" data-focusable="true" data-action="save" data-title="Guardar" tabindex="0">Guardar</div>' +
          (canDelete ? '<div class="hf2-btn ghost small danger" data-focusable="true" data-action="delete" data-title="Borrar perfil" data-description="Borra el perfil, su progreso y Mi lista" tabindex="0">Borrar perfil</div>' : "") +
          '<div class="hf2-btn ghost small" data-focusable="true" data-action="cancel" data-title="Cancelar" tabindex="0">Cancelar</div>' +
        "</div>" +
      "</div>" +
    "</div>";
  byId("profileNameInput").addEventListener("input", function () {
    profileEdit.name = byId("profileNameInput").value;
  });
  var rows = root.querySelectorAll(".av-row");
  setAreas([
    { name: "name", items: root.querySelectorAll('[data-input="profileNameInput"]'), dir: "h" },
    { name: "av-0", items: rows[0].children, dir: "h", keepColumn: true },
    { name: "av-1", items: rows[1].children, dir: "h", keepColumn: true },
    { name: "kids", items: root.querySelectorAll('[data-adjust="kids"]'), dir: "h" },
    { name: "actions", items: root.querySelectorAll(".hf2-actions [data-focusable]"), dir: "h" }
  ], focusName || "name", focusIndex || 0);
}

function profileEditRefocus() {
  var a = currentArea();
  return { name: a ? a.name : "name", index: state.itemIndex };
}

function handleProfileEditSelect(el) {
  var action = el.getAttribute("data-action");
  var avatarId = el.getAttribute("data-avatar");
  var res;
  var f;
  if (el.getAttribute("data-input")) { focusInput(byId(el.getAttribute("data-input"))); return; }
  if (avatarId) {
    profileEdit.avatar = avatarId;
    f = profileEditRefocus();
    renderProfileEditor(f.name, f.index);
    updateStatus("Imagen: " + HFArt.AVATAR_NAMES[avatarId]);
    return;
  }
  if (el.getAttribute("data-adjust") === "kids") {
    profileEdit.kids = !profileEdit.kids;
    renderProfileEditor("kids", 0);
    return;
  }
  if (action === "save") {
    profileEdit.name = byId("profileNameInput").value;
    res = HFLibrary.saveProfile({ id: profileEdit.id, name: profileEdit.name, avatar: profileEdit.avatar, kids: profileEdit.kids });
    if (res.error) {
      renderProfileEditor("name", 0, res.error);
      updateStatus(res.error);
      return;
    }
    if (activeProfile && activeProfile.id === profileEdit.id) {
      activeProfile = { id: profileEdit.id, name: profileEdit.name, avatar: profileEdit.avatar, kids: profileEdit.kids };
      applyProfileView();
    }
    openProfiles("Perfil guardado", true);
  } else if (action === "delete") {
    if (el.getAttribute("data-confirm") !== "true") {
      el.setAttribute("data-confirm", "true");
      el.textContent = "¿Seguro? OK otra vez";
      updateStatus("Pulsa OK otra vez para borrar el perfil con su progreso y Mi lista");
      return;
    }
    HFLibrary.deleteProfile(profileEdit.id);
    if (activeProfile && activeProfile.id === profileEdit.id) {
      activeProfile = null;
    }
    openProfiles("Perfil borrado", true);
  } else if (action === "cancel") {
    openProfiles("", true);
  }
}
