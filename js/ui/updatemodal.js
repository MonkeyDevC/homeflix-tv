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

function umBtn(cls, action, label, icon) {
  return '<div class="hf2-btn icon ' + cls + '" data-focusable="true" data-action="' + action + '" data-title="' + esc(label) + '" tabindex="0"><span class="um-btn-ic">' + (icon || "") + "</span>" + esc(label) + "</div>";
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
    body += '<div class="um-prog' + (phase === "lista" ? " done" : "") + '"><div class="um-bar"><i class="um-fill" id="umBar" style="transform:scaleX(' + ((phase === "lista" ? 100 : umShown(pct)) / 100) + ')"></i><i class="um-fill ok" id="umBarOk" style="transform:scaleX(' + ((phase === "lista" ? 100 : umShown(pct)) / 100) + ')"></i><i class="um-shine"></i></div>' +
      '<div class="um-prog-txt"><span id="umPct">' + (phase === "lista" ? "100 %" : Math.round(umShown(pct)) + " %") + '</span><span id="umMb">' +
      (phase === "lista" ? "Se usa al reiniciar la app" : (UPD.total ? umFormatMb(UPD.got) + " de " + umFormatMb(UPD.total) + " MB" : "Descargando…")) + "</span></div></div>";
  }
  if (notes.length) {
    body += '<div class="um-notes"><span class="um-lbl">Novedades</span>' + notes.map(function (n) { return "<p>" + esc(n) + "</p>"; }).join("") + "</div>";
  }
  if (phase === "programa") {
    body += window.HF_TV ?
      '<p class="um-warn">Esta versión necesita instalar la app de nuevo. Pulsa «Instalar» y confirma en la pantalla que se abre; si pide permiso para instalar apps, actívalo para HomeFlix y vuelve a intentarlo.</p>' :
      '<p class="um-warn">Esta versión necesita reinstalar la app: en el teléfono abre Apps2Samsung → Apps instaladas → HomeFlix → Actualizar.</p>';
  } else if (phase === "error") {
    body += '<p class="um-warn err">' + esc(UPD.error) + "</p>";
  }

  if (phase === "bajando") {
    actions = umBtn("primary off", "upd-wait", "Actualizando…", UM_ICON.spin) + umBtn("ghost off", "upd-wait", "Reiniciar ahora", IC.restart);
  } else if (phase === "lista") {
    actions = umBtn("primary", "upd-restart", "Reiniciar ahora", UM_ICON.ok.replace("um-check", "um-check static")) + umBtn("ghost", "upd-close", "Más tarde", IC.clock);
  } else if (phase === "programa") {
    actions = window.HF_TV ?
      umBtn("primary", "upd-apk", "Instalar", IC.refresh) + umBtn("ghost", "upd-close", "Más tarde", IC.clock) :
      umBtn("primary", "upd-close", "Entendido", IC.check);
  } else if (phase === "error") {
    actions = umBtn("primary", "upd-go", "Reintentar", IC.refresh) + umBtn("ghost", "upd-close", "Cerrar", IC.back);
  } else {
    actions = umBtn("primary", "upd-go", "Actualizar", IC.refresh) + umBtn("ghost", "upd-close", "Más tarde", IC.clock);
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
  el.className = "hf2-modal first";
  setTimeout(function () { el.classList.remove("first"); }, 800);
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
    renderBrowse("top", Math.max(0, menuIndex(browse.section)));
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

/* La barra no salta con cada trozo que llega: el valor mostrado se acerca al real un poco en cada cuadro (la barra se mueve con
 * transform, que lo hace la GPU, y el número sube con ella). */
var UM_SHOW = { v: 0, raf: 0 };

function umShown(pct) {
  return UPD.state === "lista" ? 100 : Math.min(UM_SHOW.v, pct);
}

function umTick() {
  var target = umPercent();
  var bar = byId("umBar");
  var ok = byId("umBarOk");
  var pct = byId("umPct");
  var diff = target - UM_SHOW.v;
  UM_SHOW.raf = 0;
  if (Math.abs(diff) < 0.08) {
    UM_SHOW.v = target;
  } else {
    UM_SHOW.v += diff * 0.1 + (diff > 0 ? 0.03 : -0.03);
    UM_SHOW.raf = window.requestAnimationFrame(umTick);
  }
  if (bar) { bar.style.transform = "scaleX(" + (UM_SHOW.v / 100) + ")"; }
  if (ok) { ok.style.transform = "scaleX(" + (UM_SHOW.v / 100) + ")"; }
  if (pct && UPD.state !== "lista") { pct.textContent = Math.round(UM_SHOW.v) + " %"; }
}

function paintUpdateProgress() {
  var mb = byId("umMb");
  if (mb) { mb.textContent = UPD.total ? umFormatMb(UPD.got) + " de " + umFormatMb(UPD.total) + " MB" : "Descargando…"; }
  if (!UM_SHOW.raf) { UM_SHOW.raf = window.requestAnimationFrame(umTick); }
}

function startUpdate() {
  var info = updateInfo();
  if (!info || !info.web || UPD.state === "bajando") {
    return;
  }
  UPD.state = "bajando";
  UPD.error = "";
  UPD.got = 0;
  UM_SHOW.v = 0;
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
      UM_SHOW.v = 100;
      setSyncBadge();
      renderUpdateModal(0);
    }, 900);
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
  else if (action === "upd-apk") {
    /* Android TV: baja el APK nuevo y abre el instalador del sistema */
    if (!HFUpdate.installNative((UPD.info || {}).manifest || {})) {
      UPD.error = "No se pudo abrir el instalador. Vuelve a instalar HomeFlix desde el enlace de descarga.";
      renderUpdateModal(0);
    }
  }
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


/* ===================== Modal de confirmación =====================
 * askConfirm({title, text, okLabel, cancelLabel, danger, onOk, onCancel}): una tarjeta centrada, con el mismo estilo del cuadro de
 * actualización, para confirmar algo que no se puede deshacer (p. ej. borrar un perfil). El foco empieza en «Cancelar» (lo seguro);
 * BACK también cancela. Al cerrarse el foco, la página y los carruseles quedan como estaban. */
var CONF = { open: false, saved: null, opts: null };

var CF_ICON = {
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

function confirmHtml() {
  var o = CONF.opts;
  return '<div class="hf2-modal-card cf' + (o.danger ? " danger" : "") + '">' +
    '<div class="um-head"><div class="um-ic">' + UM_ICON.warn + '</div><div class="um-titles"><div class="um-title">' + esc(o.title) + "</div></div></div>" +
    '<p class="cf-text">' + esc(o.text) + "</p>" +
    '<div class="um-actions">' +
      umBtn((o.danger ? "danger" : "primary"), "conf-ok", o.okLabel || "Aceptar", o.danger ? CF_ICON.trash : IC.check) +
      umBtn("ghost", "conf-cancel", o.cancelLabel || "Cancelar", CF_ICON.x) +
    "</div></div>";
}

function askConfirm(opts) {
  var el;
  if (CONF.open || !appRootEl) { return; }
  el = document.createElement("div");
  el.id = "confModal";
  el.className = "hf2-modal first";
  appRootEl.appendChild(el);
  setTimeout(function () { el.classList.remove("first"); }, 800);
  CONF.opts = opts;
  CONF.saved = umSnapshot();
  CONF.open = true;
  el.innerHTML = confirmHtml();
  setAreas([{ name: "conf", items: el.querySelectorAll("[data-focusable]"), dir: "h" }], "conf", 1);
  setHints("◀ ▶ Elegir · OK Seleccionar · BACK Cancelar");
}

/* Cierra el modal y devuelve el foco, la página y los carruseles a como estaban; luego corre lo que se haya elegido. */
function closeConfirm(ok) {
  var s = CONF.saved;
  var o = CONF.opts;
  var el = byId("confModal");
  if (!CONF.open) { return; }
  if (el && el.parentNode) { el.parentNode.removeChild(el); }
  CONF.open = false;
  CONF.saved = null;
  CONF.opts = null;
  setHints(routeHints[currentRoute] || "");
  if (s && s.areas.length) {
    areas = s.areas;
    state.areaIndex = s.state.areaIndex;
    state.itemIndex = s.state.itemIndex;
    pageState.el = s.page.el;
    pageState.viewH = s.page.viewH;
    pageState.contentH = s.page.contentH;
    pageState.offset = s.page.offset;
    clearPreviousFocus();
    updateFocus();
  }
  if (o) {
    if (ok && o.onOk) { o.onOk(); }
    else if (!ok && o.onCancel) { o.onCancel(); }
  }
}

function handleConfirmSelect(el) {
  var action = el.getAttribute("data-action");
  if (action === "conf-ok") { closeConfirm(true); }
  else { closeConfirm(false); }
}


/* ===================== Modal «Siguiente capítulo» (por perfil) =====================
 * Cuándo pasa solo al siguiente capítulo, tamaño del aviso y transparencia de su fondo. Con una vista previa de la pantalla (1920×1080 a
 * escala) donde se ve el aviso tal como quedará en la esquina inferior derecha. */
var NXM = { open: false, saved: null, profile: null };

var NX_ROWS = [
  { key: "skip", label: "Pasar al siguiente", opts: [[0, "Al terminar"], [5, "5 s antes"], [10, "10 s antes"]] },
  { key: "size", label: "Tamaño del aviso", opts: [["s", "Pequeño"], ["m", "Mediano"], ["l", "Grande"]] },
  { key: "alpha", label: "Transparencia", opts: [[100, "Sólido"], [80, "80 %"], [60, "60 %"], [40, "40 %"]] }
];

function nxValue(key) {
  var pid = NXM.profile.id;
  return key === "skip" ? nextSkip(pid) : key === "size" ? nxSize(pid) : nxAlpha(pid);
}

function nxPreviewHtml() {
  var pid = NXM.profile.id;
  return '<div class="nx-stage"><div class="nx-screen"><div class="nx-film"></div>' +
    '<div class="hf2-next nx-fake" id="nxFake" data-size="' + nxSize(pid) + '" style="--nx-a:' + (nxAlpha(pid) / 100) + '">' +
    '<div class="hf2-next-art">' + fallbackArt() + '<span class="hf2-ep-num">2</span></div>' +
    '<div class="hf2-next-body"><div class="hf2-kicker">Siguiente capítulo</div><div class="hf2-next-title">T1:E2 · Título del capítulo</div>' +
    '<div class="hf2-next-desc">Así se verá el aviso sobre la imagen mientras terminan los créditos.</div>' +
    '<div class="hf2-next-count"><span class="bar"><i style="width:60%"></i></span><span>Empieza en 6 s</span></div>' +
    '<div class="hf2-next-actions"><span class="nx-fb primary">Ver ahora</span><span class="nx-fb">Ver créditos</span></div></div></div></div></div>';
}

function nextModalHtml() {
  var rows = NX_ROWS.map(function (r) {
    return '<div class="nx-row"><div class="nx-lab">' + r.label + '</div><div class="nx-chips">' + r.opts.map(function (o) {
      return '<div class="nx-chip' + (String(nxValue(r.key)) === String(o[0]) ? " on" : "") + '" data-focusable="true" data-nx="' + r.key + '" data-val="' + o[0] + '" data-title="' + esc(r.label + ": " + o[1]) + '" tabindex="0">' + o[1] + "</div>";
    }).join("") + "</div></div>";
  }).join("");
  return '<div class="hf2-modal-card nx">' +
    '<div class="um-head"><div class="um-ic">' + IC.next + '</div><div class="um-titles"><div class="um-title">Siguiente capítulo</div><div class="um-sub">Solo para el perfil ' + esc(NXM.profile.name) + "</div></div></div>" +
    '<div class="nx-body"><div class="nx-cols">' + rows + "</div>" + nxPreviewHtml() + "</div>" +
    '<div class="um-actions">' + umBtn("primary", "nx-done", "Listo", IC.check) + "</div></div>";
}

function openNextModal(profile) {
  var el;
  var rows;
  var defs;
  if (NXM.open || !appRootEl) { return; }
  el = document.createElement("div");
  el.id = "nxModal";
  el.className = "hf2-modal first";
  appRootEl.appendChild(el);
  setTimeout(function () { el.classList.remove("first"); }, 800);
  NXM.profile = profile;
  NXM.saved = umSnapshot();
  NXM.open = true;
  el.innerHTML = nextModalHtml();
  rows = el.querySelectorAll(".nx-chips");
  defs = [].slice.call(rows).map(function (r, i) {
    return { name: "nx" + i, items: r.querySelectorAll("[data-focusable]"), dir: "h" };
  });
  defs.push({ name: "nxdone", items: el.querySelectorAll(".um-actions [data-focusable]"), dir: "h" });
  setAreas(defs, "nx0", Math.max(0, [].slice.call(rows[0].children).map(function (c) { return c.className.indexOf(" on") >= 0; }).indexOf(true)));
  setHints("◀ ▶ Elegir · ▲ ▼ Cambiar de ajuste · OK Aplicar · BACK Listo");
}

function closeNextModal() {
  var s = NXM.saved;
  var el = byId("nxModal");
  if (!NXM.open) { return; }
  if (el && el.parentNode) { el.parentNode.removeChild(el); }
  NXM.open = false;
  NXM.saved = null;
  NXM.profile = null;
  setHints(routeHints[currentRoute] || "");
  if (s && s.areas.length) {
    areas = s.areas;
    state.areaIndex = s.state.areaIndex;
    state.itemIndex = s.state.itemIndex;
    pageState.el = s.page.el;
    pageState.viewH = s.page.viewH;
    pageState.contentH = s.page.contentH;
    pageState.offset = s.page.offset;
    clearPreviousFocus();
    updateFocus();
  }
}

function handleNextModalSelect(el) {
  var key = el.getAttribute("data-nx");
  var val = el.getAttribute("data-val");
  var pid;
  var fake;
  var kids;
  var i;
  if (!key) { closeNextModal(); return; }
  pid = NXM.profile.id;
  if (key === "skip") { setNextSkip(Number(val), pid); }
  else if (key === "size") { setNxPref("size", val, pid); }
  else { setNxPref("alpha", Number(val), pid); }
  kids = el.parentNode.children;
  for (i = 0; i < kids.length; i += 1) {
    kids[i].className = "nx-chip" + (kids[i] === el ? " on" : "");
  }
  el.setAttribute("data-focused", "true");
  fake = byId("nxFake");
  if (fake) {
    fake.setAttribute("data-size", nxSize(pid));
    fake.style.setProperty("--nx-a", String(nxAlpha(pid) / 100));
  }
}
