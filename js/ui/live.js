/* HomeFlix · TV en vivo (IPTV) en la TV: vista previa del canal, categorías, lista de canales y reproductor en vivo.
 *
 * Rutas: «live» (arriba a la izquierda el canal que suena en un recuadro, debajo lo que dan ahora; a la derecha las
 * categorías en pestañas y la lista de canales) y «live-player» (pantalla completa con AVPlay).
 * La lista es la M3U de la cuenta (js/iptv.js); se pone desde el celular (Ajustes → TV en vivo) o aquí mismo.
 * Al moverse por la lista, el canal enfocado suena en el recuadro (un instante después, por si se sigue bajando); OK lo
 * abre en pantalla completa SIN cortar la señal (AVPlay solo cambia de rectángulo). En el reproductor: ▲ ▼ o CH+ CH−
 * cambian de canal, los números saltan a un canal, OK abre las opciones (Reiniciar, Favorito, Canales), BACK vuelve. */

var LV = {
  data: null,        // {channels, groups, at, …} de HFIptv.load
  loading: false,
  error: "",
  group: "__all",
  list: [],          // canales del grupo elegido (lo que se ve)
  index: 0,          // canal elegido dentro de list
  editing: false,    // escribiendo el enlace
  playing: null,     // canal que suena en pantalla completa
  pvKey: "",         // canal de la vista previa
  pstate: "",        // estado del reproductor (el de la vista previa o el de pantalla completa)
  pdetail: "",
  panel: false,      // panel del reproductor abierto
  osdTimer: null,
  pvTimer: null,
  digits: "",
  digitTimer: null,
  groupTimer: null
};
var LV_MAX_ROWS = 400; // filas que se dibujan por grupo (las TVs se ponen lentas con miles)
var LV_PV = { x: 88, y: 152, w: 880, h: 495 };        // el recuadro de la vista previa (1920×1080)
var LV_FULL = { x: 0, y: 0, w: 1920, h: 1080 };

function liveAllowed() { return !currentProfileIsKids(); }

function openLive() {
  if (!liveAllowed()) { return; }
  showRoute("live");
  if (!HFIptv.config()) {
    LV.data = null;
    LV.error = "";
    LV.editing = false;
    renderLive();
    return;
  }
  if (!LV.data || LV.data.url !== HFIptv.config().url) {
    loadLive(false);
  } else {
    renderLive();
  }
}

function loadLive(force) {
  LV.loading = true;
  LV.error = "";
  renderLive();
  HFIptv.load({ force: !!force }).then(function (d) {
    LV.loading = false;
    LV.data = d;
    if (LV.group !== "__all" && LV.group !== "__fav" && !d.groups.some(function (g) { return g.name === LV.group; })) { LV.group = "__all"; }
    /* abrir donde quedó: el grupo y el canal que se vio por última vez */
    var last = HFLibrary.iptvLast();
    LV.list = HFIptv.byGroup(d, LV.group);
    LV.index = Math.max(0, LV.list.map(function (c) { return c.key; }).indexOf(last));
    if (currentRoute === "live") { renderLive(); }
    /* la guía de programación llega después y repinta lo que pasa ahora en cada canal */
    HFIptv.loadEpg(d).then(function (ok) {
      if (ok && currentRoute === "live" && LV.data === d && !LV.editing) {
        var a = currentArea();
        renderLive(a ? a.name : "channels", state.itemIndex);
      }
    });
  }, function (e) {
    LV.loading = false;
    LV.error = e.message || String(e);
    if (currentRoute === "live") { renderLive(); }
  });
}

function liveGroups() {
  var favN = Object.keys(HFLibrary.iptvFavs()).length;
  var out = [];
  if (favN) { out.push({ id: "__fav", label: "★ Favoritos", count: favN }); }
  out.push({ id: "__all", label: "Destacado", count: LV.data ? LV.data.channels.length : 0 });
  (LV.data ? LV.data.groups : []).forEach(function (g) { out.push({ id: g.name, label: g.name, count: g.count }); });
  return out;
}

function liveInitial(c) { return esc((c.name || "?").replace(/^[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+/, "").slice(0, 2).toUpperCase()); }

/* una fila: logo del canal · miniatura del programa · título, «quedan Xm» y barra · ⓘ */
function channelRowHtml(c, i, favs) {
  var n = HFIptv.now(c);
  var thumb = n && n.icon ? n.icon : c.logo;
  return '<div class="lv-ch' + (LV.pvKey === c.key ? " live" : "") + '" data-focusable="true" data-lv-ch="' + i + '" data-title="' + esc(c.name) + '" data-description="' + esc(n ? n.title : c.group) + '" tabindex="0">' +
    '<span class="lv-logo"' + (c.logo ? ' data-logo="' + esc(c.logo) + '"' : "") + "><i>" + liveInitial(c) + "</i></span>" +
    '<span class="lv-thumb' + (n && n.icon ? "" : " plain") + '"' + (thumb ? ' data-logo="' + esc(thumb) + '"' : "") + '><em class="lv-eq"><u></u><u></u><u></u></em></span>' +
    '<span class="lv-name"><b>' + esc(n ? n.title || c.name : c.name) + "</b>" +
    "<small>" + (n ? HFIptv.leftText(n.left) : "<i class=\"lv-dot sm\"></i>En vivo · " + esc(c.group)) + (c.kind === "movie" ? " · película" : "") + "</small>" +
    (n ? '<span class="lv-bar"><i style="width:' + Math.round(n.pct) + '%"></i></span>' : "") + "</span>" +
    (favs[c.key] ? '<span class="lv-fav">★</span>' : "") +
    '<span class="lv-i">' + IC.info + "</span></div>";
}

/* lo que dan ahora en el canal enfocado (debajo del recuadro) */
function liveInfoHtml(c) {
  var n;
  var fav;
  if (!c) { return ""; }
  n = HFIptv.now(c);
  fav = !!HFLibrary.iptvFavs()[c.key];
  return '<div class="lv-i-ch"><span class="lv-i-logo"' + (c.logo ? " style=\"background-image:url('" + esc(c.logo).replace(/'/g, "%27") + "')\"" : "") + ">" + (c.logo ? "" : liveInitial(c)) + "</span>" +
    '<span class="lv-i-num">' + c.num + "</span><b>" + esc(c.name) + (fav ? ' <span class="lv-fav">★</span>' : "") + "</b></div>" +
    "<h3>" + esc(n && n.title ? n.title : c.name) + "</h3>" +
    (n && n.desc ? '<p class="lv-i-desc">' + esc(n.desc) + "</p>" : '<p class="lv-i-desc dim">' + esc(c.group) + (n ? "" : " · sin guía de programación") + "</p>") +
    (n ? '<div class="lv-prog"><span>' + esc(clockHM(n.start)) + '</span><div class="lv-bar big"><i style="width:' + Math.round(n.pct) + '%"></i></div><span>' + esc(HFIptv.leftText(n.left)) + "</span></div>" +
      (n.next ? '<small class="lv-i-next">Sigue · ' + esc(clockHM(n.next.start)) + " " + esc(n.next.title) + "</small>" : "") : "") +
    '<div class="lv-i-keys"><b>OK</b> Pantalla completa</div>';
}

function clockHM(ms) {
  var d = new Date(ms);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
}

function renderLive(focusName, focusIndex) {
  var scr = byId("scrLive");
  var cfg = HFIptv.config();
  var html;
  var areasDef;
  /* el recuadro de la vista previa es un «agujero»: AVPlay dibuja detrás de la página y solo se ve ahí */
  var hole = '<div class="lv-hole" style="left:' + LV_PV.x + "px;top:" + LV_PV.y + "px;width:" + LV_PV.w + "px;height:" + LV_PV.h + 'px"></div>';
  if (!cfg || LV.editing || !LV.data) { stopLivePreview(); }
  html = '<div id="liveTopbar">' + topbarHtml("live") + "</div>";
  areasDef = [{ name: "top", selector: "#liveTopbar [data-focusable]", dir: "h" }];
  if (!cfg || LV.editing) {
    html += '<div class="lv-empty"><div class="lv-card"><h1>TV en vivo</h1>' +
      "<p>Pon el enlace M3U de <b>tu proveedor de IPTV</b>. HomeFlix solo reproduce la lista que tú contratas; no incluye canales.</p>" +
      '<div class="hf2-field lv-field" data-focusable="true" data-lv="url" data-title="Enlace de la lista" data-description="Escribe el enlace M3U (http://…)" tabindex="0">' +
      '<input id="lvUrl" class="lv-input" type="text" autocomplete="off" spellcheck="false" placeholder="http://… (enlace M3U)" value="' + esc(cfg ? cfg.url : "") + '"/></div>' +
      '<div class="lv-btns"><span class="hf2-btn primary" data-focusable="true" data-lv="save" tabindex="0">Guardar</span>' +
      (cfg ? '<span class="hf2-btn ghost" data-focusable="true" data-lv="cancel" tabindex="0">Cancelar</span>' : "") + "</div>" +
      '<p class="lv-tip">Más fácil desde el celular: <b>Ajustes → TV en vivo</b>. Llega sola a esta TV.</p>' +
      (LV.error ? '<div class="hf2-error">' + esc(LV.error) + "</div>" : "") + "</div></div>";
    scr.innerHTML = html;
    areasDef.push({ name: "form", selector: "#scrLive .lv-field", dir: "v" });
    areasDef.push({ name: "formBtns", selector: "#scrLive .lv-btns [data-focusable]", dir: "h" });
    setAreas(areasDef, focusName || "form", focusIndex || 0);
    return;
  }
  if (LV.loading && !LV.data) {
    html += '<div class="lv-empty"><div class="lv-spin"></div><p>Descargando tu lista de canales…</p></div>';
    scr.innerHTML = html;
    setAreas(areasDef, "top", 0);
    return;
  }
  if (LV.error && !LV.data) {
    html += '<div class="lv-empty"><div class="lv-card"><h1>No se pudo cargar la lista</h1><div class="hf2-error">' + esc(LV.error) + "</div>" +
      '<p class="lv-tip">Pulsa «Actualizar lista» para reintentar o «Cambiar enlace» para poner otro.</p>' +
      '<div class="lv-btns"><span class="hf2-btn primary" data-focusable="true" data-lv="refresh" tabindex="0">Actualizar lista</span>' +
      '<span class="hf2-btn ghost" data-focusable="true" data-lv="edit" tabindex="0">Cambiar enlace</span></div></div></div>';
    scr.innerHTML = html;
    areasDef.push({ name: "formBtns", selector: "#scrLive .lv-btns [data-focusable]", dir: "h" });
    setAreas(areasDef, "formBtns", 0);
    return;
  }

  var favs = HFLibrary.iptvFavs();
  var groups = liveGroups();
  var shown = LV.list.slice(0, LV_MAX_ROWS);
  var gName = (groups.filter(function (g) { return g.id === LV.group; })[0] || {}).label || "";
  var cur = LV.list[LV.index] || null;
  html = hole + html;
  html += '<div class="lv-pv"><span class="lv-pv-badge" id="lvPvBadge"></span><div class="lv-pv-state" id="lvPvState"></div></div>' +
    '<div class="lv-info" id="lvInfo">' + liveInfoHtml(cur) + "</div>" +
    '<div class="lv-tools"><span class="hf2-chip" data-focusable="true" data-lv="refresh" data-title="Actualizar lista" data-description="Volver a descargar la lista del proveedor" tabindex="0">' + IC.refresh + " Actualizar lista</span>" +
    '<span class="hf2-chip" data-focusable="true" data-lv="edit" data-title="Cambiar enlace" data-description="Poner otro enlace M3U" tabindex="0">' + IC.pencil + " Cambiar enlace</span>" +
    '<span class="lv-status">' + (LV.loading ? "Cargando la lista…" : LV.data.channels.length + " canales" + (LV.data.stale ? " · copia guardada (sin conexión con el proveedor)" : "")) + "</span></div>" +
    '<div class="lv-right"><div class="lv-tabs"><div class="lv-ttrack" id="lvTabTrack">' + groups.map(function (g) {
      return '<span class="lv-tab' + (g.id === LV.group ? " on" : "") + '" data-focusable="true" data-lv-group="' + esc(g.id) + '" data-title="' + esc(g.label) + '" data-description="' + g.count + ' canales" tabindex="0">' + esc(g.label) + "</span>";
    }).join("") + "</div></div>" +
    '<div class="lv-head"><h2>' + esc(gName) + "</h2><span>" + LV.list.length + " canales" + (LV.list.length > shown.length ? " · se ven los primeros " + shown.length : "") + "</span></div>" +
    '<div class="lv-cview"><div class="lv-ctrack" id="lvChanTrack">' +
    (shown.length ? shown.map(function (c, i) { return channelRowHtml(c, i, favs); }).join("") :
      '<div class="lv-none">' + (LV.group === "__fav" ? "Aún no tienes favoritos. Mientras ves un canal, pulsa OK y elige «Favorito»." : "Este grupo no tiene canales.") + "</div>") +
    "</div></div></div>";
  scr.innerHTML = html;
  areasDef.push({ name: "tabs", selector: "#scrLive .lv-tab", dir: "h", track: byId("lvTabTrack"), onFocus: onLiveGroupFocus });
  areasDef.push({ name: "channels", selector: "#scrLive .lv-ch", dir: "v", track: byId("lvChanTrack"), onFocus: onLiveChanFocus });
  areasDef.push({ name: "tools", selector: "#scrLive .lv-tools [data-focusable]", dir: "h" });
  var startName = focusName || (LV.list.length ? "channels" : "tabs");
  var startIndex = typeof focusIndex === "number" ? focusIndex : startName === "channels" ? Math.min(LV.index, LV_MAX_ROWS - 1) : startName === "tabs" ? Math.max(0, groups.map(function (g) { return g.id; }).indexOf(LV.group)) : 0;
  setAreas(areasDef, startName, startIndex);
  loadLiveLogos(startName === "channels" ? startIndex : 0);
  paintLivePv();
  if (startName === "channels" && cur) { previewSchedule(cur, LV.pvKey === cur.key ? 0 : 500); }
}

/* logos y miniaturas: solo los de las filas cercanas al foco (pocas imágenes a la vez para no trabar la TV) */
function loadLiveLogos(center) {
  var rows = toArray(document.querySelectorAll("#scrLive .lv-ch"));
  var from = Math.max(0, (center || 0) - 5);
  rows.slice(from, from + 18).forEach(function (row) {
    toArray(row.querySelectorAll("[data-logo]")).forEach(function (el) {
      var url = el.getAttribute("data-logo");
      var img = new Image();
      el.removeAttribute("data-logo");
      img.onload = function () { el.style.backgroundImage = "url('" + url.replace(/'/g, "%27") + "')"; el.classList.add("has"); };
      img.src = url;
    });
  });
}

/* Al moverse por las categorías, la lista cambia sola (un instante después, por si se sigue pasando). */
function onLiveGroupFocus(el) {
  var id = el && el.getAttribute("data-lv-group");
  if (!id || id === LV.group) { return; }
  clearTimeout(LV.groupTimer);
  LV.groupTimer = setTimeout(function () {
    if (currentRoute !== "live" || !currentArea() || currentArea().name !== "tabs") { return; }
    LV.group = id;
    LV.list = HFIptv.byGroup(LV.data, id);
    LV.index = 0;
    renderLive("tabs", state.itemIndex);
  }, 260);
}

/* Al enfocar un canal: lo que dan ahora cambia al instante y el canal suena en el recuadro medio segundo después. */
function onLiveChanFocus(el) {
  var i = el ? Number(el.getAttribute("data-lv-ch")) : -1;
  var c = LV.list[i];
  var info = byId("lvInfo");
  if (!c) { return; }
  LV.index = i;
  if (info) { info.innerHTML = liveInfoHtml(c); }
  loadLiveLogos(i);
  previewSchedule(c, 650);
}

function previewSchedule(c, wait) {
  clearTimeout(LV.pvTimer);
  if (LV.pvKey === c.key && HFLive.current() && HFLive.current().key === c.key) { paintLivePv(); return; }
  LV.pstate = "cargando";
  LV.pdetail = "";
  LV.pvKey = "";
  paintLivePv(c);
  LV.pvTimer = setTimeout(function () {
    if (currentRoute !== "live") { return; }
    LV.pvKey = c.key;
    HFLive.play(c, HFLive.layer(), function (st, detail) {
      if (LV.pvKey !== c.key || currentRoute !== "live") { return; }
      LV.pstate = st;
      LV.pdetail = detail;
      paintLivePv(c);
    }, LV_PV);
    HFLive.place(LV_PV);
    toArray(document.querySelectorAll("#scrLive .lv-ch.live")).forEach(function (r) { r.classList.remove("live"); });
    var row = document.querySelector('#scrLive .lv-ch[data-lv-ch="' + LV.index + '"]');
    if (row) { row.classList.add("live"); }
  }, wait);
}

/* el estado del recuadro: «Conectando…», el motivo del error o la insignia EN VIVO */
function paintLivePv(c) {
  var badge = byId("lvPvBadge");
  var box = byId("lvPvState");
  var ch = c || LV.list[LV.index];
  var st = LV.pstate;
  if (!badge || !box) { return; }
  badge.className = "lv-pv-badge" + (st === "reproduciendo" ? " on" : "");
  badge.innerHTML = st === "reproduciendo" ? '<i class="lv-dot"></i>EN VIVO' : "";
  if (st === "error") {
    box.className = "lv-pv-state err";
    box.innerHTML = "<b>No se pudo reproducir</b><small>" + esc(LV.pdetail || "") + "</small>";
  } else if (st !== "reproduciendo") {
    box.className = "lv-pv-state";
    box.innerHTML = (ch && ch.logo ? '<span class="lv-pv-logo" style="background-image:url(\'' + esc(ch.logo).replace(/'/g, "%27") + "')\"></span>" : "") + '<span><i class="lv-spin sm"></i>' + (st === "esperando" ? "Cargando…" : "Conectando…") + "</span>";
  } else {
    box.className = "lv-pv-state hide";
    box.innerHTML = "";
  }
}

function stopLivePreview() {
  clearTimeout(LV.pvTimer);
  LV.pvKey = "";
  LV.pstate = "";
  if (currentRoute !== "live-player") { HFLive.stop(); }
}

function handleLiveSelect(el) {
  var act = el.getAttribute("data-lv");
  var g = el.getAttribute("data-lv-group");
  var ch = el.getAttribute("data-lv-ch");
  if (el.getAttribute("data-menu")) { liveMenu(el.getAttribute("data-menu")); return; }
  if (act === "url") { focusInput(byId("lvUrl")); return; }
  if (act === "save") {
    var url = (byId("lvUrl").value || "").trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { LV.error = "Escribe un enlace que empiece con http:// o https://"; renderLive("form", 0); return; }
    HFLibrary.setIptv(url);
    LV.editing = false;
    LV.data = null;
    loadLive(true);
    return;
  }
  if (act === "cancel") { LV.editing = false; LV.error = ""; renderLive(); return; }
  if (act === "edit") { stopLivePreview(); LV.editing = true; LV.error = ""; renderLive("form", 0); return; }
  if (act === "refresh") { LV.data = LV.data; loadLive(true); return; }
  if (g) {
    LV.group = g;
    LV.list = HFIptv.byGroup(LV.data, g);
    LV.index = 0;
    renderLive(LV.list.length ? "channels" : "tabs", LV.list.length ? 0 : state.itemIndex);
    return;
  }
  if (ch !== null) { LV.index = Number(ch); playLiveIndex(LV.index); }
}

/* el menú superior desde «TV en vivo» */
function liveMenu(menu) {
  if (menu === "live") { return; }
  stopLivePreview();
  if (menu === "search") { openSearch(); return; }
  if (menu === "settings") { openSettings({ returnTo: "browse" }); return; }
  if (menu === "refresh") { loadLive(true); return; }
  if (menu === "profiles") { openProfiles("¿Quién está viendo?"); return; }
  browse.section = menu;
  browse.resume = null;
  showRoute("browse");
  renderBrowse("top", MENU.map(function (m) { return m.id; }).indexOf(menu));
}

/* ▲ en el primer canal sube a las pestañas; ◀ lleva a las herramientas; ▶ vuelve a la lista */
function handleLiveKey(code) {
  var a = currentArea();
  if (code === 37 && a && a.name === "channels") { focusAreaByName("tools", 0); return true; }
  if (code === 39 && a && a.name === "tools") {
    if (state.itemIndex >= a.count - 1 && LV.list.length) { focusAreaByName("channels", Math.min(LV.index, LV_MAX_ROWS - 1)); return true; }
    return false;
  }
  if (code === 40 && a && a.name === "channels" && state.itemIndex >= a.count - 1) { return true; } // no pasar a las herramientas
  if (code === 38 && a && a.name === "tools") { focusAreaByName("tabs", Math.max(0, liveGroups().map(function (g) { return g.id; }).indexOf(LV.group))); return true; }
  if (code === 40 && a && a.name === "tools") { return true; }
  if (code >= 48 && code <= 57 && LV.data && !isTypingInInput()) { typeChannelDigit(code - 48); return true; }
  return false;
}

function goBackLive() {
  if (LV.editing && HFIptv.config()) { LV.editing = false; LV.error = ""; renderLive(); return; }
  var a = currentArea();
  if (a && a.name !== "top") { focusAreaByName("top", Math.max(0, MENU.map(function (m) { return m.id; }).indexOf("live"))); return; }
  stopLivePreview();
  browse.section = "home";
  showRoute("browse");
  renderBrowse("top", 0);
}

/* ===================== Reproductor en vivo ===================== */

function playLiveIndex(i) {
  if (!LV.list.length) { return; }
  LV.index = (i + LV.list.length) % LV.list.length;
  var ch = LV.list[LV.index];
  clearTimeout(LV.pvTimer);
  LV.playing = ch;
  LV.panel = false;
  HFLibrary.setIptvLast(ch.key);
  if (currentRoute !== "live-player") { showRoute("live-player"); }
  renderLivePlayer();
  /* si ya sonaba en la vista previa, no se corta: solo crece el recuadro */
  LV.pstate = HFLive.current() && HFLive.current().key === ch.key ? HFLive.state() : "cargando";
  LV.pdetail = "";
  HFLive.play(ch, HFLive.layer(), function (st, detail) {
    LV.pstate = st;
    LV.pdetail = detail;
    renderLiveOsd(st !== "reproduciendo");
  }, LV_FULL);
  HFLive.place(LV_FULL);
}

/* Número de canal con el control: se juntan las cifras y a los 1,4 s se salta a ese número (de toda la lista) */
function typeChannelDigit(d) {
  clearTimeout(LV.digitTimer);
  LV.digits = (LV.digits + d).slice(-4);
  var box = byId(currentRoute === "live-player" ? "lvDigits" : "lvDigitsList");
  if (!box) {
    box = document.createElement("div");
    box.id = currentRoute === "live-player" ? "lvDigits" : "lvDigitsList";
    box.className = "lv-digits";
    (currentRoute === "live-player" ? byId("scrLivePlayer") : byId("scrLive")).appendChild(box);
  }
  box.textContent = LV.digits;
  box.style.display = "block";
  LV.digitTimer = setTimeout(function () {
    var n = Number(LV.digits);
    var all = LV.data ? LV.data.channels : [];
    var hit = all.filter(function (c) { return c.num === n; })[0];
    LV.digits = "";
    box.style.display = "none";
    if (!hit) { updateStatus("No hay canal " + n); return; }
    LV.group = "__all";
    LV.list = all;
    playLiveIndex(all.indexOf(hit));
  }, 1400);
}

function renderLivePlayer() {
  var scr = byId("scrLivePlayer");
  if (!byId("lvOsd")) {
    scr.innerHTML = '<div id="lvOsd" class="lv-osd"></div><div id="lvPanel" class="lv-panel"></div>';
  }
  renderLiveOsd(true);
}

function renderLiveOsd(keep) {
  var ch = LV.playing;
  var osd = byId("lvOsd");
  var n;
  if (!osd || !ch) { return; }
  n = HFIptv.now(ch);
  var fav = !!HFLibrary.iptvFavs()[ch.key];
  var stTxt = { cargando: "Conectando…", esperando: "Cargando…", reproduciendo: "", error: LV.pdetail || "No se pudo reproducir" }[LV.pstate] || "";
  osd.innerHTML = '<div class="lv-osd-top"><span class="lv-osd-logo"' + (ch.logo ? " style=\"background-image:url('" + esc(ch.logo).replace(/'/g, "%27") + "')\"" : "") + "></span>" +
    '<div class="lv-osd-t"><small>' + ch.num + " · " + esc(ch.name) + (fav ? ' <span class="lv-fav">★</span>' : "") + "</small><b>" + esc(n && n.title ? n.title : ch.name) + "</b>" +
    "<small>" + esc(ch.group) + (n && n.next ? " · Sigue: " + esc(n.next.title) : "") + "</small></div>" +
    '<span class="lv-osd-st ' + esc(LV.pstate) + '">' + (LV.pstate === "reproduciendo" ? '<i class="lv-dot"></i>EN VIVO' : LV.pstate === "error" ? "" : '<i class="lv-spin sm"></i>') + esc(stTxt) + "</span></div>" +
    (n ? '<div class="lv-prog big"><span>' + esc(clockHM(n.start)) + '</span><div class="lv-bar big"><i style="width:' + Math.round(n.pct) + '%"></i></div><span>-' + esc(HFIptv.leftText(n.left).replace("quedan ", "")) + "</span></div>" : "") +
    '<div class="lv-osd-keys">▲ ▼ Cambiar canal · Números: ir a un canal · OK Opciones · BACK Lista</div>';
  osd.classList.add("show");
  clearTimeout(LV.osdTimer);
  if (!keep && !LV.panel) { LV.osdTimer = setTimeout(function () { osd.classList.remove("show"); }, 5000); }
}

function openLivePanel() {
  var ch = LV.playing;
  var fav = ch && HFLibrary.iptvFavs()[ch.key];
  LV.panel = true;
  byId("lvPanel").innerHTML = '<div class="lv-panel-in">' +
    '<span class="lv-pbtn" data-focusable="true" data-lvp="retry" tabindex="0">' + IC.refresh + "Reiniciar</span>" +
    '<span class="lv-pbtn" data-focusable="true" data-lvp="fav" tabindex="0">' + (fav ? "★ Quitar de favoritos" : "☆ Favorito") + "</span>" +
    '<span class="lv-pbtn" data-focusable="true" data-lvp="list" tabindex="0">' + IC.list + "Canales</span></div>";
  byId("lvPanel").classList.add("show");
  renderLiveOsd(true);
  setAreas([{ name: "lvp", selector: "#lvPanel [data-focusable]", dir: "h" }], "lvp", fav ? 1 : 1);
}

function closeLivePanel() {
  LV.panel = false;
  byId("lvPanel").classList.remove("show");
  setAreas([], 0, 0);
  renderLiveOsd(false);
}

function handleLivePlayerSelect(el) {
  var act = el.getAttribute("data-lvp");
  if (act === "fav" && LV.playing) {
    HFLibrary.toggleIptvFav(LV.playing.key);
    closeLivePanel();
    return;
  }
  if (act === "retry") { closeLivePanel(); HFLive.stop(); playLiveIndex(LV.index); return; }
  if (act === "list") { closeLivePlayer(); }
}

function handleLivePlayerKey(code) {
  if (LV.panel) {
    if (code === 10009 || code === 27) { closeLivePanel(); return true; }
    return false; // ◀ ▶ y OK los maneja el motor de foco
  }
  if (code === 38 || code === 427) { playLiveIndex(LV.index + 1); return true; }   // ▲ / CH+
  if (code === 40 || code === 428) { playLiveIndex(LV.index - 1); return true; }   // ▼ / CH−
  if (code >= 48 && code <= 57) { typeChannelDigit(code - 48); return true; }
  if (code === 13) { openLivePanel(); return true; }
  if (code === 457 || code === 37 || code === 39) { renderLiveOsd(false); return true; } // INFO / ◀ ▶: mostrar el canal
  if (code === 10009 || code === 413) { closeLivePlayer(); return true; }           // BACK / ■
  return true;
}

/* Volver a la lista: el canal sigue sonando, ahora en el recuadro */
function closeLivePlayer() {
  LV.panel = false;
  clearTimeout(LV.osdTimer);
  LV.pvKey = LV.playing ? LV.playing.key : "";
  showRoute("live");
  HFLive.place(LV_PV);
  renderLive("channels", Math.min(LV.index, LV_MAX_ROWS - 1));
}

/* Al salir de la app (otra app o el menú de la TV) se corta; al volver, se retoma el mismo canal */
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") {
    if (currentRoute === "live-player" || currentRoute === "live") { HFLive.stop(); LV.pvKey = ""; }
  } else if (currentRoute === "live-player" && LV.playing && !LV.panel) {
    playLiveIndex(LV.index);
  } else if (currentRoute === "live" && LV.data && LV.list[LV.index]) {
    previewSchedule(LV.list[LV.index], 300);
  }
}, false);

/* El celular manda un canal a la TV (js/ui/cast.js): se abre en pantalla completa */
function castLiveStart(msg, de) {
  if (!liveAllowed()) { castReply(de, { t: "error", m: "Este perfil no tiene TV en vivo." }); return; }
  if (!HFIptv.config()) { castReply(de, { t: "error", m: "La TV no tiene la lista de canales todavía." }); return; }
  HFIptv.load({}).then(function (d) {
    var hit = d.channels.filter(function (c) { return c.key === msg.key; })[0];
    if (!hit) { castReply(de, { t: "error", m: "La TV no encuentra ese canal en su lista." }); return; }
    if (currentRoute === "player" && typeof closePlayer === "function") { closePlayer(); }
    LV.data = d;
    LV.group = "__all";
    LV.list = d.channels;
    LV.index = d.channels.indexOf(hit);
    playLiveIndex(LV.index);
    updateStatus("Mostrando " + hit.name + " desde " + (de.nombre || "el celular"));
    castReply(de, { t: "ok" });
  }, function (e) { castReply(de, { t: "error", m: (e && e.message) || "No se pudo leer la lista de la TV." }); });
}
