/* HomeFlix · núcleo de la interfaz: utilidades, barra de ayuda, motor de foco del mando, portadas y piezas del diseño.
 * Reglas (.cursor/rules/homeflix-tizen-tv.mdc): un solo keydown, foco con data-focused, nada pesado en el camino de la tecla:
 * las medidas se toman al dibujar, y en cada tecla solo se cambia un atributo y un transform. */

/* Versión web en computador (index.html?web=1, la pone index.html antes de cargar los scripts). En la TV es false. */
var WEB_PC = document.documentElement.getAttribute("data-web") === "pc";

/* ===================== Utilidades ===================== */

function byId(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function toArray(list) {
  return Array.prototype.slice.call(list || []);
}

/* Número estable a partir de un texto (para elegir ilustraciones de respaldo). */
function hashOf(s) {
  var h = 0;
  var i;
  s = String(s || "");
  for (i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

var appRootEl = null;
var statusMessageEl = null;
var statusHintsEl = null;
var currentRoute = "splash";

function updateStatus(message) {
  if (statusMessageEl && statusMessageEl.textContent !== message) {
    statusMessageEl.textContent = message;
  }
}

function setHints(text) {
  if (statusHintsEl && statusHintsEl.textContent !== text) {
    statusHintsEl.textContent = text;
  }
}

/* ===================== Íconos (SVG en línea) ===================== */

var IC = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><path d="M12 7.5h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 17l5-5-5-5"/><path d="M20 12H9"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4"/><path d="M12 17.3h.01"/></svg>',
  all: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12l3 3 5-6"/></svg>',
  none: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4.5" width="20" height="13" rx="2"/><path d="M8 21h8M12 17.5V21"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  subs: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M7 14h4M13 14h4M7 10.5h2M11 10.5h6"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 5v14l10-7z" fill="currentColor"/><rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor"/></svg>',
  back10: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/><text x="12" y="15.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="Arial">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/><text x="12" y="15.5" text-anchor="middle" font-size="7" font-weight="700" fill="currentColor" stroke="none" font-family="Arial">10</text></svg>'
};

/* ===================== Motor de foco =====================
 * Áreas: {name, items|selector, dir: "h"|"v", track, page, follow: "block"|"item", block, keepColumn, sideways, onFocus, loop}
 *  - dir "h": ◀ ▶ recorren el área; ▲ ▼ cambian de área.  dir "v": ▲ ▼ recorren y en los extremos pasan al área vecina.
 *  - track: elemento que se desplaza para que se vea el enfocado (fila o lista).
 *  - loop: {count}: carrusel en ciclo. items trae 3 copias (3 × count); el foco va por la copia del medio y al pasar
 *    del último al primero la pista sigue avanzando y luego se reacomoda sin animación (solo transform).
 *  - page: contenedor de la pantalla que se desplaza en vertical (follow "block" sigue al área, "item" al elemento). */

var areas = [];
var state = { areaIndex: 0, itemIndex: 0 };
var areaMemory = {};
var previousFocusedItem = null;
var activeBlockEl = null;
var pageState = { el: null, viewH: 0, contentH: 0, offset: 0 };
var LOOP_SLOT = 88;

function setAreas(defs, startArea, startItem) {
  var i;
  areas = [];
  for (i = 0; i < defs.length; i += 1) {
    if (defs[i]) {
      buildArea(defs[i]);
    }
  }
  measureAreas();
  clearPreviousFocus();
  state.areaIndex = 0;
  state.itemIndex = 0;
  if (typeof startArea === "string") {
    for (i = 0; i < areas.length; i += 1) {
      if (areas[i].name === startArea) {
        state.areaIndex = i;
        break;
      }
    }
  } else if (typeof startArea === "number") {
    state.areaIndex = Math.max(0, Math.min(areas.length - 1, startArea));
  }
  if (typeof startItem === "number") {
    state.itemIndex = startItem;
  } else if (areas[state.areaIndex]) {
    state.itemIndex = areaMemory[currentRoute + ":" + areas[state.areaIndex].name] || 0;
  }
  updateFocus();
}

function buildArea(def) {
  var items = def.items ? toArray(def.items) : toArray(document.querySelectorAll(def.selector));
  var loop = def.loop && def.loop.count ? def.loop.count : 0;
  if (!items.length) {
    return;
  }
  items.forEach(function (el) {
    el._hfTitle = el.getAttribute("data-title") || "";
    el._hfDescription = el.getAttribute("data-description") || "";
  });
  areas.push({
    name: def.name,
    dir: def.dir || "h",
    items: items,
    count: loop || items.length,
    loop: !!loop,
    domIndex: loop ? loop : 0,
    track: def.track || null,
    trackOffset: 0,
    page: def.page || null,
    follow: def.follow || "block",
    block: def.block || null,
    keepColumn: !!def.keepColumn,
    sideways: !!def.sideways,
    edge: def.edge || null,
    onFocus: def.onFocus || null
  });
}

function measureAreas() {
  var pageEl = null;
  areas.forEach(function (a) {
    var axisX = a.dir === "h";
    var viewport;
    if (a.track) {
      viewport = a.track.parentNode;
      a.viewSize = axisX ? viewport.clientWidth : viewport.clientHeight;
      a.pos = a.items.map(function (el) {
        return axisX ? [el.offsetLeft, el.offsetWidth] : [el.offsetTop, el.offsetHeight];
      });
      a.total = a.pos.length ? a.pos[a.pos.length - 1][0] + a.pos[a.pos.length - 1][1] : 0;
      a.trackOffset = null;
      a.track._hfOff = null;
      a.track.classList.remove("anim");
      if (a.loop) {
        setTrackOffset(a, a.pos[a.count][0] - LOOP_SLOT);
      } else {
        setTrackOffset(a, 0);
      }
    }
    if (a.page) {
      pageEl = a.page;
      a.blockTop = a.block ? offsetWithin(a.block, a.page.firstElementChild) : 0;
      a.itemTops = a.items.map(function (el) { return offsetWithin(el, a.page.firstElementChild); });
    }
  });
  /* activar la transición después de colocar las pistas */
  setTimeout(function () {
    areas.forEach(function (a) {
      if (a.track) {
        a.track.classList.add("anim");
      }
    });
  }, 30);
  if (pageEl) {
    pageState.el = pageEl.firstElementChild;
    pageState.viewH = pageEl.clientHeight;
    pageState.contentH = pageState.el.offsetHeight;
    pageState.offset = 0;
    pageState.el.style.transform = "translate3d(0,0,0)";
  } else {
    pageState.el = null;
  }
}

function offsetWithin(el, container) {
  var top = 0;
  while (el && el !== container) {
    top += el.offsetTop;
    el = el.offsetParent;
  }
  return top;
}

function setTrackOffset(a, px) {
  /* El desplazamiento vive en la pista: dos áreas pueden compartirla (p. ej. las 2 filas de avatares) y moverse juntas. */
  if (a.track._hfOff === px) {
    return;
  }
  a.track._hfOff = px;
  a.trackOffset = px;
  a.track.style.transform = a.dir === "h" ? "translate3d(" + (-px) + "px,0,0)" : "translate3d(0," + (-px) + "px,0)";
}

function clearPreviousFocus() {
  if (previousFocusedItem) {
    previousFocusedItem.removeAttribute("data-focused");
  }
  previousFocusedItem = null;
  if (activeBlockEl) {
    activeBlockEl.removeAttribute("data-area-on");
  }
  activeBlockEl = null;
}

function currentArea() {
  return areas[state.areaIndex] || null;
}

/* Elemento del DOM que corresponde al foco (en un carrusel en ciclo, la copia que se está mostrando). */
function getCurrentItem() {
  var a = currentArea();
  if (!a) {
    return null;
  }
  if (state.itemIndex > a.count - 1) {
    state.itemIndex = a.count - 1;
  }
  if (state.itemIndex < 0) {
    state.itemIndex = 0;
  }
  if (a.loop) {
    return a.items[a.domIndex] || a.items[a.count + state.itemIndex];
  }
  return a.items[state.itemIndex];
}

function scrollTrack(a) {
  var p;
  var next;
  var maxOffset;
  var pad = 40;
  if (!a.track || !a.pos) {
    return;
  }
  if (a.loop) {
    setTrackOffset(a, a.pos[a.domIndex][0] - LOOP_SLOT);
    return;
  }
  p = a.pos[state.itemIndex];
  next = a.track._hfOff || 0;
  if (p[0] + p[1] + pad > next + a.viewSize) {
    next = p[0] + p[1] + pad - a.viewSize;
  }
  if (p[0] - pad - (a.dir === "h" ? 48 : 0) < next) {
    next = p[0] - pad - (a.dir === "h" ? 48 : 0);
  }
  maxOffset = Math.max(0, a.total + pad - a.viewSize);
  next = Math.max(0, Math.min(maxOffset, next));
  setTrackOffset(a, next);
}

function scrollPage(a) {
  var target;
  var maxOffset;
  if (!pageState.el) {
    return;
  }
  if (!a.page) {
    target = 0;
  } else if (a.follow === "item") {
    target = a.itemTops[state.itemIndex] - Math.round(pageState.viewH * 0.35);
  } else if (a.follow === "top") {
    target = 0;
  } else {
    target = a.blockTop - 140;
  }
  maxOffset = Math.max(0, pageState.contentH - pageState.viewH + 80);
  target = Math.max(0, Math.min(maxOffset, target));
  if (target !== pageState.offset) {
    pageState.offset = target;
    pageState.el.style.transform = "translate3d(0," + (-target) + "px,0)";
  }
}

function updateFocus() {
  var a = currentArea();
  var el = getCurrentItem();
  if (!a || !el) {
    clearPreviousFocus();
    return;
  }
  areaMemory[currentRoute + ":" + a.name] = state.itemIndex;
  if (appRootEl && appRootEl.getAttribute("data-active-area") !== a.name) {
    appRootEl.setAttribute("data-active-area", a.name);
  }
  /* la fila (o bloque) donde está el foco se marca: las demás tarjetas de esa fila se atenúan */
  if (activeBlockEl !== (a.block || null)) {
    if (activeBlockEl) {
      activeBlockEl.removeAttribute("data-area-on");
    }
    activeBlockEl = a.block || null;
    if (activeBlockEl) {
      activeBlockEl.setAttribute("data-area-on", "true");
    }
  }
  if (previousFocusedItem !== el) {
    if (previousFocusedItem) {
      previousFocusedItem.removeAttribute("data-focused");
    }
    el.setAttribute("data-focused", "true");
    previousFocusedItem = el;
    if (el._hfDescription) {
      updateStatus(el._hfDescription);
    }
  }
  scrollTrack(a);
  scrollPage(a);
  if (a.onFocus) {
    a.onFocus(el, state.itemIndex);
  }
}

/* Carrusel en ciclo: después de pasar de un extremo al otro, volver en silencio a la copia del medio. */
var loopSnapTimer = null;

function scheduleLoopSnap(a) {
  if (loopSnapTimer) {
    clearTimeout(loopSnapTimer);
  }
  loopSnapTimer = setTimeout(function () {
    var middle;
    loopSnapTimer = null;
    if (areas.indexOf(a) < 0) {
      return;
    }
    middle = a.count + state.itemIndex;
    if (a.domIndex === middle || currentArea() !== a) {
      a.domIndex = a.count + (areaMemory[currentRoute + ":" + a.name] || 0);
      return;
    }
    a.track.classList.remove("anim");
    a.domIndex = middle;
    setTrackOffset(a, a.pos[middle][0] - LOOP_SLOT);
    if (previousFocusedItem) {
      previousFocusedItem.removeAttribute("data-focused");
    }
    previousFocusedItem = a.items[middle];
    previousFocusedItem.setAttribute("data-focused", "true");
    a.track.offsetWidth; // aplicar sin transición antes de volver a activarla
    a.track.classList.add("anim");
  }, 560); // después de que termine la transición de la pista (0,5 s)
}

function stepLoop(a, delta) {
  var next = state.itemIndex + delta;
  if (next < 0) {
    next = a.count - 1;
  } else if (next > a.count - 1) {
    next = 0;
  }
  a.domIndex = a.domIndex + delta;
  if (a.domIndex < 0 || a.domIndex > a.items.length - 1) {
    a.domIndex = a.count + next;
  }
  state.itemIndex = next;
  updateFocus();
  if (a.domIndex < a.count || a.domIndex >= 2 * a.count) {
    scheduleLoopSnap(a);
  }
}

function changeArea(delta) {
  var from = currentArea();
  var next = state.areaIndex + delta;
  var to;
  if (next < 0 || next >= areas.length) {
    return false;
  }
  to = areas[next];
  state.areaIndex = next;
  if (from && from.keepColumn && to.keepColumn) {
    state.itemIndex = Math.min(state.itemIndex, to.count - 1);
  } else {
    state.itemIndex = areaMemory[currentRoute + ":" + to.name] || 0;
  }
  if (to.loop) {
    to.domIndex = to.count + state.itemIndex;
  }
  updateFocus();
  return true;
}

function adjustCurrent(dir) {
  var el = getCurrentItem();
  if (!el || !el.getAttribute("data-adjust") || typeof onAdjust !== "function") {
    return false;
  }
  return onAdjust(el, dir);
}

function moveLeft() {
  var a = currentArea();
  if (adjustCurrent(-1)) {
    return;
  }
  if (a && a.dir === "h" && a.loop) {
    stepLoop(a, -1);
  } else if (a && a.dir === "h" && state.itemIndex > 0) {
    state.itemIndex -= 1;
    updateFocus();
  } else if (a && a.edge) {
    a.edge(-1);
  } else if (a && a.sideways) {
    changeArea(-1);
  }
}

function moveRight() {
  var a = currentArea();
  if (adjustCurrent(1)) {
    return;
  }
  if (a && a.dir === "h" && a.loop) {
    stepLoop(a, 1);
  } else if (a && a.dir === "h" && state.itemIndex < a.count - 1) {
    state.itemIndex += 1;
    updateFocus();
  } else if (a && a.edge) {
    a.edge(1);
  } else if (a && a.sideways) {
    changeArea(1);
  }
}

function moveUp() {
  var a = currentArea();
  if (a && a.dir === "v" && state.itemIndex > 0) {
    state.itemIndex -= 1;
    updateFocus();
    return;
  }
  changeArea(-1);
}

function moveDown() {
  var a = currentArea();
  if (a && a.dir === "v" && state.itemIndex < a.count - 1) {
    state.itemIndex += 1;
    updateFocus();
    return;
  }
  changeArea(1);
}

function focusAreaByName(name, itemIndex) {
  var i;
  for (i = 0; i < areas.length; i += 1) {
    if (areas[i].name === name) {
      state.areaIndex = i;
      state.itemIndex = typeof itemIndex === "number" ? itemIndex : (areaMemory[currentRoute + ":" + name] || 0);
      if (areas[i].loop) {
        areas[i].domIndex = areas[i].count + state.itemIndex;
      }
      updateFocus();
      return true;
    }
  }
  return false;
}

/* ===================== Portadas de Telegram =====================
 * Elementos .hf2-img con data-img="clave" y data-img-w="ancho": se cargan al entrar en pantalla, de a dos.
 * Mientras tanto se ve la ilustración de respaldo que trae dentro. */

var imageQueue = [];
var imagesLoading = 0;
var imageObserver = null;

function pumpImages() {
  var el;
  while (imagesLoading < 3 && imageQueue.length) {
    el = imageQueue.shift();
    imagesLoading += 1;
    (function (target) {
      HFTelegram.image(target.getAttribute("data-img"), Number(target.getAttribute("data-img-w")) || 480).then(function (url) {
        if (url) {
          target.style.backgroundImage = "url(" + url + ")";
          target.setAttribute("data-loaded", "true");
        }
      }, function () {
        /* sin portada: queda la ilustración */
      }).then(function () {
        imagesLoading -= 1;
        pumpImages();
      });
    })(el);
  }
}

function queueImage(el) {
  var ready;
  if (!el.getAttribute("data-img") || el.getAttribute("data-queued")) {
    return;
  }
  el.setAttribute("data-queued", "true");
  /* ya descargada en esta sesión: se pinta al instante, sin pasar por la cola */
  ready = HFTelegram.imageReady && HFTelegram.imageReady(el.getAttribute("data-img"), Number(el.getAttribute("data-img-w")) || 480);
  if (ready) {
    el.style.backgroundImage = "url(" + ready + ")";
    el.setAttribute("data-loaded", "true");
    return;
  }
  imageQueue.push(el);
  pumpImages();
}

function observeImages(root) {
  var els = toArray((root || document).querySelectorAll("[data-img]"));
  if (!els.length || typeof HFTelegram === "undefined" || !HFTelegram.available()) {
    return;
  }
  if (!imageObserver && typeof IntersectionObserver !== "undefined") {
    imageObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          imageObserver.unobserve(e.target);
          queueImage(e.target);
        }
      });
    }, { rootMargin: "200px 600px" });
  }
  els.forEach(function (el) {
    if (HFTelegram.imageReady && HFTelegram.imageReady(el.getAttribute("data-img"), Number(el.getAttribute("data-img-w")) || 480)) {
      queueImage(el);
    } else if (imageObserver) {
      imageObserver.observe(el);
    } else {
      queueImage(el);
    }
  });
}

/* ===================== Rutas ===================== */

var routeHints = {
  splash: "OK Iniciar sesión · ▲ Ajustes",
  login: "▲ ▼ Navegar · OK Seleccionar · BACK Volver",
  profiles: "◀ ▶ Elegir · ▼ Opciones · OK Entrar",
  "profile-edit": "◀ ▶ ▲ ▼ Navegar · OK Seleccionar · BACK Cancelar",
  pin: "Números del control o ◀ ▶ ▲ ▼ y OK · BACK Cancelar",
  accounts: "▲ ▼ Elegir · OK Seleccionar · BACK Volver",
  settings: "OK Activar / desactivar · ▲ Herramientas · BACK Guardar y salir",
  guide: "◀ ▶ Navegar · OK Seleccionar · BACK Cerrar",
  browse: "◀ ▶ ▲ ▼ Navegar · OK Abrir · BACK Menú",
  detail: "◀ ▶ Botones · ▼ Más · OK Seleccionar · BACK Volver",
  "tag-edit": "◀ ▶ ▲ ▼ Moverse · OK Cambiar o escribir · BACK Cancelar",
  search: "▼ Resultados · OK Escribir · BACK Volver",
  player: ""
};

function showRoute(routeName) {
  if (typeof onLeaveRoute === "function" && currentRoute !== routeName) {
    onLeaveRoute(currentRoute, routeName);
  }
  blurActiveInput();
  currentRoute = routeName;
  if (appRootEl) {
    appRootEl.setAttribute("data-route", routeName);
    appRootEl.setAttribute("data-active-area", "");
  }
  setHints(routeHints[routeName] || "");
}

function isTypingInInput() {
  return !!document.activeElement && document.activeElement.tagName === "INPUT";
}

function blurActiveInput() {
  if (isTypingInInput()) {
    document.activeElement.blur();
  }
}

function focusInput(inputEl) {
  if (!inputEl) {
    return;
  }
  inputEl.focus();
  if (inputEl.select) {
    inputEl.select();
  }
}

/* ===================== Piezas del diseño ===================== */

function brandHtml(cls) {
  return '<div class="hf2-brand' + (cls ? " " + cls : "") + '"><div class="hf2-logo"></div><div class="hf2-wordmark">Home<span>Flix</span></div></div>';
}

/* ===================== Avatares de perfil =====================
 * Si hay imágenes en images/avatares/ (lista HF_AVATARES de js/imagenes.js) se usan esas; si no, los dibujos SVG.
 * El id de un avatar propio es el nombre del archivo sin extensión. Un perfil guardado con un id que ya no existe
 * (p. ej. «panda» de antes) recibe una imagen propia fija según ese id, así nunca queda sin foto. */
function ownAvatars() {
  return typeof HF_AVATARES !== "undefined" && HF_AVATARES && HF_AVATARES.length ? HF_AVATARES : null;
}

function avatarIdOf(src) {
  return src.replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
}

/* [{id, name}] en el orden en que se ofrecen en el editor. */
function avatarList() {
  var own = ownAvatars();
  if (own) {
    return own.map(function (src) { return { id: avatarIdOf(src), name: avatarName(avatarIdOf(src)) }; });
  }
  return HFArt.AVATAR_IDS.map(function (id) { return { id: id, name: HFArt.AVATAR_NAMES[id] }; });
}

/* «03-gato_negro» → «Gato negro» (el guion bajo es espacio; el guion normal se conserva: «Spider-Man») */
function avatarName(id) {
  var own = ownAvatars();
  var name;
  if (!own) {
    return HFArt.AVATAR_NAMES[id] || "";
  }
  name = String(id || "").replace(/^[0-9]+[ ._-]*/, "").replace(/_+/g, " ").trim() || String(id || "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function avatarSrc(id) {
  var own = ownAvatars();
  var i;
  var svgIdx;
  for (i = 0; i < own.length; i += 1) {
    if (avatarIdOf(own[i]) === id) {
      return own[i];
    }
  }
  svgIdx = HFArt.AVATAR_IDS.indexOf(id);
  return own[(svgIdx >= 0 ? svgIdx : hashOf(String(id || ""))) % own.length];
}

/* id efectivo (el que se ve): sirve para marcar en el editor cuál está elegido. */
function avatarEffectiveId(id) {
  return ownAvatars() ? avatarIdOf(avatarSrc(id)) : (HFArt.AVATAR_IDS.indexOf(id) >= 0 ? id : "panda");
}

function avatarHtml(id) {
  if (ownAvatars()) {
    return '<img class="hf2-avimg" src="' + esc(encodeURI(avatarSrc(id))) + '" alt="">';
  }
  return HFArt.avatar(HFArt.AVATAR_IDS.indexOf(id) >= 0 ? id : "panda");
}

var avatarSvg = avatarHtml;

/* Respaldo mientras llega la portada real (o si no hay): el logo y el nombre de HomeFlix. */
function fallbackArt() {
  return '<div class="hf2-ph"><div class="hf2-ph-logo"></div><div class="hf2-ph-name">Home<span>Flix</span></div></div>';
}

function titleMeta(t) {
  var parts = [];
  if (t.type === "movie") {
    if (t.year) { parts.push(t.year); }
    if (t.video && t.video.duration) { parts.push(HFLibrary.formatDuration(t.video.duration)); }
    if (t.quality) { parts.push(t.quality); }
  } else if (t.type === "series") {
    parts.push(t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas"));
    parts.push(t.episodeCount + (t.episodeCount === 1 ? " capítulo" : " capítulos"));
  } else if (t.type === "episode") {
    parts.push("T" + t.season + ":E" + t.episode + " · " + t.title);
  } else {
    if (t.video && t.video.duration) { parts.push(HFLibrary.formatDuration(t.video.duration)); }
    if (t.quality) { parts.push(t.quality); }
    if (t.video && t.video.chatTitle) { parts.push(t.video.chatTitle); }
  }
  return parts.join(" · ");
}

function progressInfo(videoKey) {
  var p = HFLibrary.progress(videoKey);
  if (!p || p.done || !p.d || !p.t) {
    return null;
  }
  return {
    pct: Math.max(2, Math.min(98, Math.round((p.t / p.d) * 100))),
    left: "Quedan " + HFLibrary.formatDuration(Math.max(60, p.d - p.t))
  };
}

function entryVideoKey(entry) {
  return entry.video ? entry.video.key : entry.key;
}

/* Tarjeta 16:9 de un título, capítulo o video sin clasificar.
 * opts: {ref, progress: bool, noKids, title, sub} */
function cardHtml(entry, opts) {
  var t = entry;
  var name;
  var sub;
  var label;
  var imgKey;
  var prog = null;
  var ref;
  opts = opts || {};
  name = opts.title || (t.type === "episode" ? t.seriesName : t.name);
  sub = opts.sub || (t.type === "episode" ? "T" + t.season + ":E" + t.episode + " · " + t.title : titleMeta(t));
  label = t.type === "movie" ? "Película" : t.type === "series" ? "Serie" : t.type === "episode" ? "T" + t.season + ":E" + t.episode : "Sin clasificar";
  imgKey = t.type === "episode" || t.type === "video" ? t.key : t.imageKey;
  ref = t.type === "episode" || t.type === "video" ? "v:" + t.key : "t:" + t.titleKey;
  if (opts.progress) {
    prog = progressInfo(entryVideoKey(t));
  }
  return '<div class="hf2-card" data-focusable="true" data-ref="' + esc(ref) + '" data-title="' + esc(name) + '" data-description="' + esc(name + (sub ? " · " + sub : "")) + '" tabindex="0">' +
    '<div class="hf2-card-art hf2-img"' + (imgKey ? ' data-img="' + esc(imgKey) + '" data-img-w="480"' : "") + ">" + fallbackArt(imgKey || name, "c") +
      '<span class="hf2-card-type">' + esc(label) + "</span>" +
      (t.kids && !opts.noKids ? '<span class="hf2-card-kids">' + IC.star + "</span>" : "") +
      (prog ? '<span class="hf2-card-progress"><i style="width:' + prog.pct + '%"></i></span><span class="hf2-card-left">' + esc(prog.left) + "</span>" : "") +
    "</div>" +
    '<div class="hf2-card-title">' + esc(name) + '</div><div class="hf2-card-sub">' + esc(sub) + "</div>" +
  "</div>";
}

/* Fila de tarjetas. loop: carrusel en ciclo (3 copias, difuminado en los bordes). */
function rowHtml(id, title, entries, opts) {
  var cards;
  var loop;
  opts = opts || {};
  cards = entries.map(function (e) { return cardHtml(e.item || e, { progress: !!opts.progress || !!e.progress }); });
  loop = opts.loop !== false && cards.length >= 4;
  return '<div class="hf2-row' + (loop ? " loop" : "") + '" data-row="' + esc(id) + '"' + (loop ? ' data-count="' + cards.length + '"' : "") + ">" +
    '<div class="hf2-row-head"><h3>' + esc(title) + "</h3>" + (opts.note ? "<span>" + esc(opts.note) + "</span>" : "") + "</div>" +
    '<div class="hf2-row-viewport' + (loop ? "" : " plain") + '"><div class="hf2-row-track">' + (loop ? cards.join("") + cards.join("") + cards.join("") : cards.join("")) + "</div>" +
    (loop ? '<i class="hf2-fade left"></i><i class="hf2-fade right"></i>' : "") + "</div></div>";
}

/* Áreas del motor de foco para todas las filas de un contenedor. */
function rowAreas(container, page) {
  return toArray(container.querySelectorAll(".hf2-row")).map(function (row) {
    var count = Number(row.getAttribute("data-count")) || 0;
    return {
      name: "row-" + row.getAttribute("data-row"),
      items: row.querySelectorAll(".hf2-card"),
      dir: "h",
      track: row.querySelector(".hf2-row-track"),
      page: page,
      block: row,
      loop: count ? { count: count } : null
    };
  });
}
