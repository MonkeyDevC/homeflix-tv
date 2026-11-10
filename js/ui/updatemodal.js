/* HomeFlix · actualizaciones de la app (TV).
 *
 * El botón «Actualizar» de la barra de arriba (↻) busca títulos nuevos en los chats Y una versión nueva de la app
 * (el canal es el servidor de HomeFlix: js/update.js). Si hay versión nueva se abre un modal con sus novedades;
 * «Actualizar» baja la interfaz con una barra de progreso y, al terminar, el mismo modal muestra el check verde y
 * habilita «Reiniciar ahora». La interfaz nueva se usa al reiniciar la app (sin reinstalar); si la versión pide un
 * programa más nuevo (.wgt) el modal solo avisa que hay que reinstalar con Apps2Samsung.
 *
 * El modal vive fuera de las pantallas (dentro de #app) y toma el foco mientras está abierto: al cerrarlo se devuelve
 * el foco, la página y los carruseles exactamente como estaban. */

var UPD = { info: null, state: "", got: 0, total: 0, error: "" };
var UPM = { open: false, saved: null };

function appVersion() {
  return typeof HF_VERSION !== "undefined" && HF_VERSION ? HF_VERSION : "";
}

function updateInfo() {
  return UPD.info && UPD.info.hay ? UPD.info : null;
}

/* texto corto de la barra de arriba (junto a ↻) */
function updateBadgeText() {
  var info = updateInfo();
  if (!info) { return ""; }
  return UPD.state === "lista" ? "✓ Lista" : "⬆ v" + info.version;
}

/* Revisión silenciosa (al abrir la app): solo apunta si hay algo nuevo, para el aviso de la barra. */
function checkUpdates() {
  if (typeof HFUpdate === "undefined") {
    return;
  }
  HFUpdate.auto(function (info) {
    UPD.info = info;
    setSyncBadge();
  });
}

/* Revisión pedida con el botón ↻: devuelve una promesa con la info (o rechaza sin conexión). */
function checkUpdatesNow() {
  if (typeof HFUpdate === "undefined") {
    return Promise.reject(new Error("sin actualizaciones"));
  }
  return HFUpdate.check().then(function (info) {
    if (!(UPD.state === "bajando" || UPD.state === "lista")) {
      UPD.info = info;
    }
    setSyncBadge();
    return UPD.info || info;
  });
}

/* ===================== Modal ===================== */

function umFormatMb(n) {
  return (n / 1048576).toFixed(1).replace(".", ",");
}

function umFormatDate(iso) {
  var d = new Date(iso);
  var months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return isNaN(d.getTime()) ? "" : d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
}

function umPercent() {
  return UPD.total ? Math.max(0, Math.min(100, Math.round(UPD.got / UPD.total * 100))) : 0;
}

function umPhase() {
  var info = UPD.info || {};
  if (info.programa) { return "programa"; }
  if (UPD.state === "bajando") { return "bajando"; }
  if (UPD.state === "lista") { return "lista"; }
  if (UPD.error) { return "error"; }
  return "info";
}

var UM_ICON = {
  up: '<svg viewBox="0 0 48 48" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="19"/><path d="M24 33V16M16 23l8-8 8 8"/></svg>',
  spin: '<svg class="um-spin" viewBox="0 0 48 48" fill="none" stroke-width="4.4" stroke-linecap="round"><circle class="um-ring" cx="24" cy="24" r="19"/><circle class="um-arc" cx="24" cy="24" r="19"/></svg>',
  ok: '<svg class="um-check" viewBox="0 0 48 48" fill="none" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><circle class="um-circ" cx="24" cy="24" r="19"/><path class="um-tick" d="M14.5 25l6.5 6.5L33.5 18"/></svg>',
  warn: '<svg viewBox="0 0 48 48" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="19"/><path d="M24 14v13M24 33v.5"/></svg>'
};

function umBtn(cls, action, label, extra) {
  return '<div class="hf2-btn ' + cls + '" data-focusable="true" data-action="' + action + '" data-title="' + esc(label) + '" tabindex="0">' + (extra || "") + esc(label) + "</div>";
}

function updateModalHtml() {
  var info = UPD.info || {};
  var phase = umPhase();
  var notes = String(info.notas || "").split("\n").map(function (l) { return l.replace(/^\s+|\s+$/g, ""); }).filter(function (l) { return l; }).slice(0, 4);
  var date = umFormatDate(info.fecha);
  var title;
  var icon;
  var body = "";
  var actions;
  var pct = umPercent();

  if (phase === "programa") {
    title = "Hay una versión nueva que necesita reinstalar";
    icon = UM_ICON.up;
  } else if (phase === "bajando") {
    title = "Descargando la actualización";
    icon = UM_ICON.spin;
  } else if (phase === "lista") {
    title = "¡Actualización lista!";
    icon = UM_ICON.ok;
  } else if (phase === "error") {
    title = "No se pudo actualizar";
    icon = UM_ICON.warn;
  } else {
    title = "Hay una versión nueva de HomeFlix";
    icon = UM_ICON.up;
  }

  if (phase === "bajando" || phase === "lista") {
    body += '<div class="um-prog' + (phase === "lista" ? " done" : "") + '"><div class="um-bar"><i id="umBar" style="width:' + (phase === "lista" ? 100 : pct) + '%"></i></div>' +
      '<div class="um-prog-txt"><span id="umPct">' + (phase === "lista" ? "100 %" : pct + " %") + '</span><span id="umMb">' +
      (phase === "lista" ? "Se usa al reiniciar la app" : (UPD.total ? umFormatMb(UPD.got) + " de " + umFormatMb(UPD.total) + " MB" : "Descargando…")) + "</span></div></div>";
  }
  if (notes.length) {
    body += '<div class="um-notes"><span class="um-lbl">Novedades</span>' + notes.map(function (n) { return "<p>" + esc(n) + "</p>"; }).join("") + "</div>";
  }
  if (phase === "programa") {
    body += '<p class="um-warn">Esta versión necesita reinstalar la app: en el teléfono abre Apps2Samsung → Apps instaladas → HomeFlix → Actualizar.</p>';
  } else if (phase === "error") {
    body += '<p class="um-warn err">' + esc(UPD.error) + "</p>";
  }

  if (phase === "bajando") {
    actions = umBtn("primary off", "upd-wait", "Actualizando…") + umBtn("ghost off", "upd-wait", "Reiniciar ahora");
  } else if (phase === "lista") {
    actions = umBtn("primary", "upd-restart", "Reiniciar ahora", '<span class="um-btn-ic">' + UM_ICON.ok.replace("um-check", "um-check static") + "</span>") + umBtn("ghost", "upd-close", "Más tarde");
  } else if (phase === "programa") {
    actions = umBtn("primary", "upd-close", "Entendido");
  } else if (phase === "error") {
    actions = umBtn("primary", "upd-go", "Reintentar") + umBtn("ghost", "upd-close", "Cerrar");
  } else {
    actions = umBtn("primary", "upd-go", "Actualizar") + umBtn("ghost", "upd-close", "Más tarde");
  }

  return '<div class="hf2-modal-card um-' + phase + '">' +
    '<div class="um-head"><div class="um-ic">' + icon + '</div><div class="um-titles"><div class="um-title">' + esc(title) + "</div>" +
      '<div class="um-sub">v' + esc(info.version || "") + (appVersion() ? " · tienes v" + esc(appVersion()) : "") + (date ? " · " + esc(date) : "") + "</div></div></div>" +
    body + '<div class="um-actions">' + actions + "</div></div>";
}

/* Dibuja el modal y le da el foco (idx = botón que queda enfocado). */
function renderUpdateModal(idx) {
  var el = byId("updModal");
  if (!el) {
    return;
  }
  el.innerHTML = updateModalHtml();
  setAreas([{ name: "upd", items: el.querySelectorAll("[data-focusable]"), dir: "h" }], "upd", idx || 0);
  setHints("◀ ▶ Elegir · OK Seleccionar · BACK " + (UPD.state === "bajando" ? "Seguir en segundo plano" : "Cerrar"));
}

function umSnapshot() {
  return {
    areas: areas,
    state: { areaIndex: state.areaIndex, itemIndex: state.itemIndex },
    page: { el: pageState.el, viewH: pageState.viewH, contentH: pageState.contentH, offset: pageState.offset }
  };
}

function openUpdateModal() {
  var el;
  if (UPM.open || currentRoute !== "browse" || !appRootEl || !updateInfo()) {
    return;
  }
  el = document.createElement("div");
  el.id = "updModal";
  el.className = "hf2-modal";
  appRootEl.appendChild(el);
  UPM.saved = umSnapshot();
  UPM.open = true;
  renderUpdateModal(0);
}

function umRemove() {
  var el = byId("updModal");
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
  UPM.open = false;
}

/* Cierra el modal y devuelve el foco, la página y los carruseles a como estaban. */
function closeUpdateModal() {
  var s = UPM.saved;
  var first = s && s.areas.length && s.areas[0].items.length ? s.areas[0].items[0] : null;
  if (!UPM.open) {
    return;
  }
  umRemove();
  UPM.saved = null;
  setHints(routeHints[currentRoute] || "");
  if (currentRoute !== "browse") {
    return;
  }
  if (first && first.parentNode && document.body.contains(first)) {
    areas = s.areas;
    state.areaIndex = s.state.areaIndex;
    state.itemIndex = s.state.itemIndex;
    pageState.el = s.page.el;
    pageState.viewH = s.page.viewH;
    pageState.contentH = s.page.contentH;
    pageState.offset = s.page.offset;
    clearPreviousFocus();
    updateFocus();
  } else {
    renderBrowse("top", Math.max(0, MENU.map(function (m) { return m.id; }).indexOf(browse.section)));
  }
}

/* Al salir de la pantalla (p. ej. se abrió un video mandado desde el celular) el modal se quita sin tocar el foco. */
function dropUpdateModal() {
  if (UPM.open) {
    umRemove();
    UPM.saved = null;
  }
}

/* renderBrowse volvió a dibujar la pantalla de fondo (llegó el catálogo o un cambio de otro aparato): el modal se
 * queda con el foco y lo que se guarda para devolverlo es la pantalla nueva. */
function reattachUpdateModal() {
  var cur;
  if (!UPM.open) {
    return;
  }
  cur = currentArea();
  UPM.saved = umSnapshot();
  renderUpdateModal(cur && cur.name === "upd" ? state.itemIndex : 0);
}

function paintUpdateProgress() {
  var bar = byId("umBar");
  var pct = byId("umPct");
  var mb = byId("umMb");
  if (bar) { bar.style.width = umPercent() + "%"; }
  if (pct) { pct.textContent = umPercent() + " %"; }
  if (mb) { mb.textContent = UPD.total ? umFormatMb(UPD.got) + " de " + umFormatMb(UPD.total) + " MB" : "Descargando…"; }
}

function startUpdate() {
  var info = updateInfo();
  if (!info || !info.web || UPD.state === "bajando") {
    return;
  }
  UPD.state = "bajando";
  UPD.error = "";
  UPD.got = 0;
  UPD.total = (info.manifest && info.manifest.web && info.manifest.web.bytes) || 0;
  renderUpdateModal(0);
  setSyncBadge();
  HFUpdate.install(info.manifest, function (p) {
    UPD.got = p.got;
    UPD.total = p.total || UPD.total;
    paintUpdateProgress();
  }).then(function () {
    UPD.got = UPD.total || UPD.got;
    paintUpdateProgress();
    /* un instante con la barra llena y verde; luego el check y el botón «Reiniciar ahora» */
    var bar = document.querySelector("#updModal .um-prog");
    if (bar) { bar.classList.add("done"); }
    setTimeout(function () {
      UPD.state = "lista";
      setSyncBadge();
      renderUpdateModal(0);
    }, 450);
  }, function (e) {
    UPD.state = "";
    UPD.error = (e && e.message) || String(e);
    setSyncBadge();
    renderUpdateModal(0);
  });
}

function handleUpdateSelect(el) {
  var action = el.getAttribute("data-action");
  if (action === "upd-go") { startUpdate(); }
  else if (action === "upd-restart") { HFUpdate.restart(); }
  else if (action === "upd-close") { closeUpdateModal(); }
}

/* Dónde está el foco de la pantalla de fondo (con el modal abierto, el foco real es el del modal). */
function browseFocus() {
  var s = UPM.open && UPM.saved ? UPM.saved : null;
  var a = s ? s.areas[s.state.areaIndex] : currentArea();
  return { name: a ? a.name : null, index: s ? s.state.itemIndex : state.itemIndex };
}

/* Antes de redibujar la pantalla por un cambio de fondo (llegó el catálogo, otro aparato guardó algo): lo que se ve
 * (página y carruseles) para devolverlo igual, en vez de mandar todo al principio. */
function captureBrowseView() {
  var s = UPM.open && UPM.saved ? UPM.saved : umSnapshot();
  return {
    section: browse.section,
    page: s.page.offset,
    rows: s.areas.filter(function (a) { return a.track; }).map(function (a) {
      return { name: a.name, off: a.track._hfOff, dom: a.domIndex, count: a.count };
    })
  };
}

function restoreBrowseView(k) {
  var cur = currentArea();
  if (!k || k.section !== browse.section) {
    return;
  }
  areas.forEach(function (a) {
    var r;
    var i;
    if (!a.track || a === cur) {
      return; // la fila enfocada ya queda donde le toca (updateFocus)
    }
    for (i = 0; i < k.rows.length; i += 1) {
      if (k.rows[i].name === a.name) { r = k.rows[i]; break; }
    }
    if (r && r.count === a.count && r.off !== null) {
      if (a.loop) { a.domIndex = r.dom; }
      setTrackOffset(a, r.off);
    }
  });
  if (cur && cur.holdPage && pageState.el && pageState.offset !== k.page) {
    pageState.offset = k.page; // en el menú de arriba la página no se mueve sola
    pageState.el.style.transform = "translate3d(0," + (-k.page) + "px,0)";
  }
}
