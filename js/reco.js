/* Recomendaciones de HomeFlix («Para ti» y «Similares»), las mismas en la TV, el celular y la web.
 *
 * Las pide al servidor de HomeFlix (el mismo de js/sync.js, con la misma llave de cuenta) en /api/v1/reco/*; el servidor
 * se las pide al motor (recomendador/ en el VPS). El motor devuelve titleKeys (los de js/library.js) con su razón; aquí se
 * convierten en los títulos de la biblioteca de ESTE perfil (si un título no está en sus chats, no se muestra).
 * También le cuenta al motor qué fichas se abren y qué se busca (en lotes, con cola si no hay red). Las vistas y Mi lista
 * NO se mandan: el motor las toma de la sincronización.
 * Nada aquí bloquea: sin servidor, sin llave o sin respuesta, la fila simplemente no aparece. */
var HFReco = (function () {
  "use strict";

  var TTL = 30 * 60 * 1000;
  var ESPERA_REINTENTO = 2 * 60 * 1000;
  var COLA_MAX = 200;
  var LOTE = 20;
  var CADA = 10000;
  var memoria = {};      // "cuenta|perfil|ruta" → {at, recs}
  var pidiendo = {};
  var fallo = {};
  var oyentes = [];
  var timer = null;
  var enviando = false;

  function guardado(k) {
    try { return JSON.parse(window.localStorage.getItem(k) || "null"); } catch (e) { return null; }
  }
  function guardar(k, v) {
    try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno o privado: solo en memoria */ }
  }

  function perfil() {
    var p = HFLibrary.currentProfile ? HFLibrary.currentProfile() : null;
    return { id: (p && p.id) || "p1", kids: !!(p && p.kids) };
  }
  function cuenta() { return String(HFLibrary.accountId ? HFLibrary.accountId() || "" : ""); }
  function disponible() { return typeof HFSync !== "undefined" && !!HFSync.server && !!cuenta() && typeof fetch === "function"; }

  function pedir(metodo, ruta, cuerpo) {
    return HFSync.key().then(function (llave) {
      return fetch(HFSync.server + "/api/v1/reco" + ruta, {
        method: metodo,
        headers: Object.assign({ authorization: "Bearer " + llave }, cuerpo ? { "content-type": "application/json" } : {}),
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        cache: "no-store"
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    });
  }

  function avisar() { oyentes.forEach(function (fn) { try { fn(); } catch (e) { /* nada */ } }); }

  /* {movie_id, reasons} → {item: título de la biblioteca, sub: la razón} (solo lo que este perfil puede ver) */
  function aTitulos(recs, library) {
    var p = perfil();
    var vistos = {};
    return (recs || []).map(function (r) {
      var t = library && library.titles ? library.titles[r.movie_id] : null;
      if (!t || vistos[r.movie_id] || (p.kids && !t.kids)) { return null; }
      vistos[r.movie_id] = true;
      return { item: t, sub: (r.reasons && r.reasons[0] && r.reasons[0].label) || "", ref: r.movie_id };
    }).filter(Boolean);
  }

  /* Lo que haya (memoria → localStorage) y, si está viejo, lo pide en segundo plano; al llegar algo distinto avisa (repintar). */
  function obtener(ruta, clave) {
    var k = cuenta() + "|" + perfil().id + "|" + clave;
    var hit = memoria[k] || guardado("hf.reco." + k);
    if (hit && !memoria[k]) { memoria[k] = hit; }
    if (disponible() && (!hit || Date.now() - hit.at > TTL) && !pidiendo[k] && !(fallo[k] && Date.now() - fallo[k] < ESPERA_REINTENTO)) {
      pidiendo[k] = true;
      pedir("GET", ruta).then(function (r) {
        var recs = r.status === 200 && r.data && r.data.recommendations ? r.data.recommendations : null;
        if (!recs || r.data.degradado) { fallo[k] = Date.now(); return; }
        var antes = hit ? JSON.stringify(hit.recs) : "";
        memoria[k] = { at: Date.now(), recs: recs.map(function (x) { return { movie_id: x.movie_id, reasons: (x.reasons || []).slice(0, 2) }; }) };
        guardar("hf.reco." + k, memoria[k]);
        if (JSON.stringify(memoria[k].recs) !== antes) { avisar(); }
      }, function () { fallo[k] = Date.now(); }).then(function () { pidiendo[k] = false; });
    }
    return hit ? hit.recs : [];
  }

  /** «Para ti» del perfil actual, ya convertido a títulos: [{item, sub}] (vacío mientras no haya nada). */
  function paraTi(library, limite) {
    return aTitulos(obtener("/recomendaciones?perfil=" + encodeURIComponent(perfil().id) + "&limite=" + (limite || 24), "parati"), library);
  }

  /** «Similares» de una ficha: [{item, sub}]. */
  function similares(titleKey, library) {
    if (!titleKey || /^v:/.test(titleKey)) { return []; }
    var ruta = "/similares/" + encodeURIComponent(titleKey) + "?perfil=" + encodeURIComponent(perfil().id) + "&limite=12";
    return aTitulos(obtener(ruta, "sim:" + titleKey), library);
  }

  /** Huella para los repintados (browseSigNow / repaintCatalog). */
  function huella() {
    var k = cuenta() + "|" + perfil().id + "|parati";
    var hit = memoria[k];
    return hit ? hit.at + ":" + hit.recs.length : "";
  }

  /* ----- Eventos (clic en una ficha y búsquedas) ----- */
  function idAzar() {
    var s = "";
    var i;
    for (i = 0; i < 16; i += 1) { s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36)); }
    return s;
  }

  function encolar(ev) {
    if (!cuenta()) { return; }
    var cola = guardado("hf.reco.cola") || [];
    cola.push({ c: cuenta(), p: perfil().id, e: Object.assign({ id: idAzar(), at: Date.now() }, ev) });
    if (cola.length > COLA_MAX) { cola = cola.slice(-COLA_MAX); }
    guardar("hf.reco.cola", cola);
    if (cola.length >= LOTE) { enviar(); } else if (!timer) { timer = setTimeout(enviar, CADA); }
  }

  function enviar() {
    clearTimeout(timer);
    timer = null;
    if (enviando || !disponible()) { return; }
    var cola = guardado("hf.reco.cola") || [];
    var mios = cola.filter(function (x) { return x.c === cuenta(); });
    if (!mios.length) { return; }
    var p = mios[0].p;
    var lote = mios.filter(function (x) { return x.p === p; }).slice(0, 50);
    enviando = true;
    pedir("POST", "/eventos", { perfil: p, eventos: lote.map(function (x) { return x.e; }) }).then(function (r) {
      if (r.status < 300 || (r.status >= 400 && r.status < 500)) {
        /* aceptados (o rechazados para siempre): fuera de la cola */
        var ids = {};
        lote.forEach(function (x) { ids[x.e.id] = true; });
        guardar("hf.reco.cola", (guardado("hf.reco.cola") || []).filter(function (x) { return !ids[x.e.id]; }));
        if (r.status < 300) { memoria[cuenta() + "|" + p + "|parati"] = null; }
      }
    }, function () { /* sin red: se reintenta con el próximo evento */ }).then(function () {
      enviando = false;
      if ((guardado("hf.reco.cola") || []).length) { timer = setTimeout(enviar, CADA * 3); }
    });
  }

  function click(titleKey) {
    if (titleKey && /^[ms]:/.test(titleKey)) { encolar({ tipo: "click", title_key: titleKey }); }
  }

  function busqueda(texto, titleKey) {
    var q = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!q) { return; }
    encolar(titleKey && /^[ms]:/.test(titleKey) ? { tipo: "search", consulta: q, title_key: titleKey } : { tipo: "search", consulta: q });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", function () { if (document.hidden) { enviar(); } });
  }

  return {
    paraTi: paraTi,
    similares: similares,
    huella: huella,
    click: click,
    busqueda: busqueda,
    enviar: enviar,
    onChange: function (fn) { oyentes.push(fn); },
    _aTitulos: aTitulos
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = HFReco;
}
