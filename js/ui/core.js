/* HomeFlix · núcleo de la interfaz: utilidades, barra de ayuda, motor de foco del mando, portadas y piezas del diseño.
 * Reglas (.cursor/rules/homeflix-tizen-tv.mdc): un solo keydown, foco con data-focused, nada pesado en el camino de la tecla:
 * las medidas se toman al dibujar, y en cada tecla solo se cambia un atributo y un transform. */

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
  menuHome: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round"><path d="M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4z"/></svg>',
  menuFilm: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/></svg>',
  menuSeries: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M8.5 3l3.5 3 3.5-3"/></svg>',
  menuAnime: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3l1.9 5.4L19.5 9l-4.3 3.6 1.4 5.6L12 15.2 7.4 18.2l1.4-5.6L4.5 9l5.6-.6z"/></svg>',
  menuMy: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4.2L6 20V5a1 1 0 0 1 1-1z"/></svg>',
  menuLive: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M4.9 4.9a10 10 0 000 14.2M19.1 4.9a10 10 0 010 14.2"/></svg>',
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
    wrap: !!def.wrap,
    edge: def.edge || null,
    holdPage: !!def.holdPage,
    resume: def.resume || null,
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
  if (a.holdPage) {
    return; // p. ej. el menú de arriba: no mueve la página, se queda donde estaba
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
  if (typeof HFAreaHook === "function") {
    HFAreaHook(a.name); // p. ej. la vista previa del destacado (library.js): arranca al estar en el destacado y se corta al salir
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
  } else if (a && a.wrap && a.dir === "h" && a.count > 1) {
    rewindRow(a);
  } else if (a && a.edge) {
    a.edge(1);
  } else if (a && a.sideways) {
    changeArea(1);
  }
}

/* El carrusel regresa a su posición inicial: el foco pasa a la primera tarjeta y la pista se desliza de vuelta, un poco más
 * despacio que un paso normal (el recorrido es largo) pero con la misma curva suave. */
var rewindTimer = null;
function rewindRow(a) {
  var track = a.track;
  state.itemIndex = 0;
  if (track) {
    track.style.transitionDuration = "0.95s";
    clearTimeout(rewindTimer);
    rewindTimer = setTimeout(function () { track.style.transitionDuration = ""; }, 1000);
  }
  updateFocus();
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
  var back;
  if (a && a.dir === "v" && state.itemIndex < a.count - 1) {
    state.itemIndex += 1;
    updateFocus();
    return;
  }
  /* Si se subió con BACK desde una fila, ▼ vuelve a esa misma fila y tarjeta */
  back = a && a.resume ? a.resume() : null;
  if (back && focusAreaByName(back.name, back.item)) {
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
  /* Lo que ya está guardado en este equipo (IndexedDB) se pinta enseguida y TODO a la vez: solo las que faltan esperan en la cola de
   * descargas de Telegram (de a 3, ~3,5 s cada una). Antes hasta las ya guardadas hacían fila detrás de las descargas. */
  if (HFTelegram.imageLocal) {
    HFTelegram.imageLocal(el.getAttribute("data-img"), Number(el.getAttribute("data-img-w")) || 480).then(function (url) {
      if (url) {
        el.style.backgroundImage = "url(" + url + ")";
        el.setAttribute("data-loaded", "true");
      } else {
        imageQueue.push(el);
        pumpImages();
      }
    }, function () {
      imageQueue.push(el);
      pumpImages();
    });
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
  live: "▲ ▼ Canales · ◀ ▶ Categorías · Números: ir a un canal · OK Pantalla completa · Amarillo Favorito · BACK Menú",
  "live-player": "",
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
  } else if (t.type === "series" && t.anime) {
    if (t.year) { parts.push(t.year); }
    if (t.format) { parts.push(t.format); }
    if (t.episodeCount) { parts.push(t.episodeCount + (t.episodeCount === 1 ? " capítulo" : " capítulos")); }
    if (t.es) { parts.push("Subt. ES"); }
  } else if (t.type === "series") {
    parts.push(t.seasons.length + (t.seasons.length === 1 ? " temporada" : " temporadas"));
    parts.push(t.episodeCount + (t.episodeCount === 1 ? " capítulo" : " capítulos"));
  } else if (t.type === "episode") {
    parts.push(epTag(t) + " · " + t.title);
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
/* Vista de las tarjetas de películas y series: «vertical» (póster, por defecto) u «horizontal». Se elige en Ajustes y se guarda en la TV, por perfil. */
/* Clave de las preferencias por perfil: cuenta + perfil (los ids de perfil, como «p1», se repiten entre cuentas). */
function prefId(pid) {
  var p = pid || (typeof activeProfile !== "undefined" && activeProfile ? activeProfile.id : "");
  var a = typeof HFLibrary !== "undefined" && HFLibrary.accountId ? HFLibrary.accountId() : "";
  return a + "." + p;
}

function cardView(pid) {
  var id = prefId(pid);
  try { return window.localStorage.getItem("hf.cardview." + id) === "horizontal" ? "horizontal" : "vertical"; } catch (e) { return "vertical"; }
}

function applyCardView() {
  var h = document.documentElement;
  if (cardView() === "vertical") { h.classList.add("hf-vcards"); } else { h.classList.remove("hf-vcards"); }
}

function setCardView(v, pid) {
  var id = prefId(pid);
  try { window.localStorage.setItem("hf.cardview." + id, v === "horizontal" ? "horizontal" : "vertical"); } catch (e) { /* nada */ }
  applyCardView();
}

/* Salto al siguiente capítulo, por perfil: cuántos segundos ANTES del final del capítulo pasa solo al siguiente (0 = al terminar, como
 * siempre; 5 o 10 = se salta parte de los créditos). El aviso «Siguiente capítulo» sigue saliendo a los 15 s. */
var NEXT_SKIPS = [0, 5, 10];

function nextSkip(pid) {
  var id = prefId(pid);
  var v = 0;
  try { v = Number(window.localStorage.getItem("hf.nextskip." + id)) || 0; } catch (e) { v = 0; }
  return NEXT_SKIPS.indexOf(v) >= 0 ? v : 0;
}

function nextSkipLabel(pid) {
  var v = nextSkip(pid);
  return v ? v + " s antes del final" : "Al terminar";
}

function setNextSkip(v, pid) {
  try { window.localStorage.setItem("hf.nextskip." + prefId(pid), String(v)); } catch (e) { /* nada */ }
}

/* Aspecto del aviso «Siguiente capítulo», por perfil: tamaño (s = pequeño, m = mediano, l = grande) y opacidad del fondo (100, 80, 60, 40). */
function nxPid(pid) {
  return prefId(pid);
}

function nxSize(pid) {
  var v = "l";
  try { v = window.localStorage.getItem("hf.nxsize." + nxPid(pid)) || "l"; } catch (e) { v = "l"; }
  return v === "s" || v === "m" ? v : "l";
}

function nxAlpha(pid) {
  var v = 100;
  try { v = Number(window.localStorage.getItem("hf.nxalpha." + nxPid(pid))) || 100; } catch (e) { v = 100; }
  return v === 80 || v === 60 || v === 40 ? v : 100;
}

function setNxPref(key, v, pid) {
  try { window.localStorage.setItem("hf.nx" + key + "." + nxPid(pid), String(v)); } catch (e) { /* nada */ }
}

function cycleNextSkip(pid) {
  var v = NEXT_SKIPS[(NEXT_SKIPS.indexOf(nextSkip(pid)) + 1) % NEXT_SKIPS.length];
  try { window.localStorage.setItem("hf.nextskip." + prefId(pid), String(v)); } catch (e) { /* nada */ }
  return v;
}

/* «Temporada 2» o, en el anime, «Cap. 1–25» */
function seasonLabel(s) {
  return s.label || "Temporada " + s.number;
}

/* «T1:E7» para lo de Telegram; «Cap. 7» para el anime (sus capítulos son seguidos, sin temporadas) */
function epTag(ep) {
  return ep.anime ? HFAnime.tag(ep) : "T" + ep.season + ":E" + ep.episode;
}

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
  sub = opts.sub || (t.type === "episode" ? epTag(t) + " · " + t.title : titleMeta(t));
  label = t.type === "movie" ? "Película" : t.type === "series" ? (t.anime ? "Anime" : "Serie") : t.type === "episode" ? epTag(t) : "Sin clasificar";
  imgKey = t.type === "episode" ? (t.coverKey || t.key) : t.type === "video" ? t.key : (t.verticalKey && cardView() === "vertical" ? t.verticalKey : t.imageKey);
  ref = t.type === "episode" || t.type === "video" ? "v:" + t.key : "t:" + t.titleKey;
  if (opts.progress) {
    prog = progressInfo(entryVideoKey(t));
  }
  return '<div class="hf2-card' + (t.type === "episode" || t.type === "video" ? " wide" : "") + '" data-focusable="true" data-ref="' + esc(ref) + '" data-title="' + esc(name) + '" data-description="' + esc(name + (sub ? " · " + sub : "")) + '" tabindex="0">' +
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
  cards = entries.map(function (e) { return cardHtml(e.item || e, { progress: !!opts.progress || !!e.progress, sub: e.sub || "" }); });
/* Sin bucle: la fila llega hasta la última tarjeta. Con 4 o más, ▶ en la última la «reinicia»: el carrusel se desliza de
   * vuelta a la primera (data-rewind, ver moveRight en este archivo). Un degradado a la derecha avisa que hay más. */
  loop = opts.loop !== false && cards.length >= 4;
  return '<div class="hf2-row" data-row="' + esc(id) + '"' + (loop ? ' data-rewind="1"' : "") + ">" +
    '<div class="hf2-row-head"><h3>' + esc(title) + "</h3>" + (opts.note ? "<span>" + esc(opts.note) + "</span>" : "") + "</div>" +
    '<div class="hf2-row-viewport plain"><div class="hf2-row-track">' + cards.join("") + "</div>" +
    (loop ? '<i class="hf2-fade right"></i>' : "") + "</div></div>";
}

/* Áreas del motor de foco para todas las filas de un contenedor. */
function rowAreas(container, page) {
  return toArray(container.querySelectorAll(".hf2-row")).map(function (row) {
    return {
      name: "row-" + row.getAttribute("data-row"),
      items: row.querySelectorAll(".hf2-card"),
      dir: "h",
      track: row.querySelector(".hf2-row-track"),
      page: page,
      block: row,
      wrap: row.hasAttribute("data-rewind")
    };
  });
}

/* ===================== Menú superior: deslizamiento FLIP =====================
 * El diseño final (nombre desplegado en el ítem con foco) se aplica de golpe y lo que se mueve (cada ítem, la píldora dorada, la
 * píldora tenue de la sección actual y el riel) parte de donde estaba y se desliza hasta su sitio con transform (WAAPI): sin
 * recalcular el diseño en cada cuadro, que era lo que trababa a la TV con la versión que animaba el ancho.
 * Se dispara con un MutationObserver (cambia data-focused / data-active-area o llega un menú nuevo). */
var MENU_EASE = "cubic-bezier(0.16, 0.84, 0.3, 1)";
var MENU_MS = 560;
var menuFx = { nav: null, rects: null, goldId: "", tintId: "", scheduled: false, obs: null };

function menuRectOf(el) {
  var b = el.getBoundingClientRect();
  return { l: b.left, t: b.top, w: b.width, h: b.height };
}

function menuPill(nav, cls) {
  var p = nav.querySelector("." + cls);
  if (!p) {
    p = document.createElement("i");
    p.className = cls;
    nav.insertBefore(p, nav.firstChild);
  }
  return p;
}

function menuPlace(p, item) {
  if (!item) { return; }
  p.style.left = item.offsetLeft + "px";
  p.style.top = item.offsetTop + "px";
  p.style.width = item.offsetWidth + "px";
  p.style.height = item.offsetHeight + "px";
}

function menuSlide(el, from, to) {
  var dx;
  var sx;
  if (!el || !from || !to || !el.animate) { return; }
  dx = from.l - to.l;
  sx = to.w ? from.w / to.w : 1;
  if (Math.abs(dx) < 0.5 && Math.abs(sx - 1) < 0.005) { return; }
  el.animate([
    { transform: "translate3d(" + dx + "px,0,0) scale3d(" + sx + ",1,1)" },
    { transform: "translate3d(0,0,0) scale3d(1,1,1)" }
  ], { duration: MENU_MS, easing: MENU_EASE });
}

/* Dónde se VE ahora un elemento del menú: su sitio de diseño anterior (prev) más lo que lleve a medias de la animación anterior (transform en vuelo).
 * Así, si el foco cambia otra vez antes de que termine el deslizamiento (pasar el mouse rápido por los íconos), el siguiente deslizamiento arranca
 * desde donde de verdad está y no desde un sitio falso. */
function menuVisual(el, prev) {
  var m;
  var ox;
  var t;
  if (!el || !prev) { return prev || null; }
  t = window.getComputedStyle(el).transform;
  if (!t || t === "none" || !window.DOMMatrix) { return prev; }
  try { m = new DOMMatrix(t); } catch (e) { return prev; }
  ox = parseFloat(window.getComputedStyle(el).transformOrigin) || 0;
  return { l: prev.l + ox * (1 - m.m11) + m.m41, t: prev.t, w: prev.w * m.m11, h: prev.h };
}

function menuLayout() {
  var navs = toArray(document.querySelectorAll("#app .hf2-menu"));
  var nav = null;
  var items;
  var foc;
  var on;
  var gold;
  var tint;
  var rail;
  var last = {};
  var vis = null;
  var goldItem;
  var tintItem;
  var i;
  for (i = 0; i < navs.length; i += 1) {
    if (navs[i].offsetWidth > 0) { nav = navs[i]; break; }
  }
  if (!nav) { menuFx.nav = null; menuFx.rects = null; return; }
  items = toArray(nav.querySelectorAll("span[data-menu]"));
  foc = items.filter(function (s) { return s.getAttribute("data-focused") === "true"; })[0] || null;
  on = items.filter(function (s) { return s.classList.contains("on"); })[0] || null;
  gold = menuPill(nav, "mp-gold");
  tint = menuPill(nav, "mp-tint");
  rail = menuPill(nav, "mp-rail");
  /* 1) dónde se ve cada cosa AHORA (antes de tocar nada) */
  if (menuFx.nav === nav && menuFx.rects) {
    vis = {};
    items.forEach(function (s) {
      var id = s.getAttribute("data-menu");
      vis[id] = menuVisual(s, menuFx.rects[id]);
    });
    vis.nav = menuVisual(rail, menuFx.rects.nav);
    vis.gold = menuFx.goldId ? menuVisual(gold, menuFx.rects[menuFx.goldId]) : null;
    vis.tint = menuFx.tintId ? menuVisual(tint, menuFx.rects[menuFx.tintId]) : null;
  }
  /* 2) sin animaciones a medias, para leer el diseño verdadero (si no, las medidas salían con el transform puesto y el deslizamiento siguiente
   *    se estiraba y se salía del menú) */
  items.concat([gold, tint, rail]).forEach(function (el) {
    if (el.getAnimations) { el.getAnimations().forEach(function (an) { an.cancel(); }); }
  });
  /* la píldora dorada sigue al ítem enfocado; sin foco se queda donde estaba (se apaga con opacidad) */
  goldItem = foc || items.filter(function (s) { return s.getAttribute("data-menu") === menuFx.goldId; })[0] || on || items[0];
  tintItem = on;
  menuPlace(gold, goldItem);
  menuPlace(tint, tintItem);
  last.nav = menuRectOf(nav);
  items.forEach(function (s) { last[s.getAttribute("data-menu")] = menuRectOf(s); });
  /* 3) deslizar desde donde se veía hasta el sitio nuevo */
  if (vis) {
    items.forEach(function (s) {
      var id = s.getAttribute("data-menu");
      menuSlide(s, vis[id], last[id]);
    });
    menuSlide(rail, vis.nav, last.nav);
    if (goldItem && vis.gold) { menuSlide(gold, vis.gold, last[goldItem.getAttribute("data-menu")]); }
    if (tintItem && vis.tint) { menuSlide(tint, vis.tint, last[tintItem.getAttribute("data-menu")]); }
  }
  menuFx.nav = nav;
  menuFx.rects = last;
  menuFx.goldId = goldItem ? goldItem.getAttribute("data-menu") : "";
  menuFx.tintId = tintItem ? tintItem.getAttribute("data-menu") : "";
}

function menuFxSchedule() {
  if (menuFx.scheduled) { return; }
  menuFx.scheduled = true;
  Promise.resolve().then(function () {
    menuFx.scheduled = false;
    menuLayout();
  });
}

function menuMutationRelevant(muts) {
  var i;
  var j;
  var m;
  var n;
  for (i = 0; i < muts.length; i += 1) {
    m = muts[i];
    if (m.type === "attributes") {
      if (m.target === appRootEl || (m.target.closest && m.target.closest(".hf2-menu"))) { return true; }
    } else {
      for (j = 0; j < m.addedNodes.length; j += 1) {
        n = m.addedNodes[j];
        if (n.nodeType === 1 && ((n.matches && n.matches(".hf2-menu")) || (n.querySelector && n.querySelector(".hf2-menu")))) { return true; }
      }
    }
  }
  return false;
}

function initMenuFx() {
  if (menuFx.obs || !window.MutationObserver || !appRootEl) { return; }
  menuFx.obs = new MutationObserver(function (muts) {
    if (menuMutationRelevant(muts)) { menuFxSchedule(); }
  });
  menuFx.obs.observe(appRootEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-focused", "data-active-area"] });
  menuFxSchedule();
}
