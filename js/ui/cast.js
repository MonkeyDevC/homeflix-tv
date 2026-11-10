/* HomeFlix · TV: recibir lo que manda el celular («Ver en la TV») y obedecerle como control remoto.
 * El canal es HFRemote (js/remote.js); los mensajes están descritos allí. La TV:
 *   - al recibir «play» cambia al perfil del celular (sin PIN: viene del propio celular de la cuenta), abre el video
 *     en el mismo minuto, con el audio y los subtítulos que tenía el celular, y contesta «ok» (o «error»);
 *   - obedece pausa / seguir / saltar / audio / subtítulos / detener;
 *   - le cuenta al celular cómo va (estado, tiempo, pistas) cada vez que algo cambia y cada pocos segundos;
 *   - al salir del video le avisa «closed». */

var cast = { ctl: null, timer: null, notifyTimer: null };

function castReply(de, msg) {
  if (de && de.id) {
    HFRemote.send(de.id, msg).catch(function () { /* el celular se desconectó */ });
  }
}

/* El video y su serie (si es capítulo) en la biblioteca de la TV. Primero en la del perfil; si ahí no está (otro chat,
 * perfil infantil), en todo lo que la TV tiene leído. */
function castFind(key) {
  var lib = library;
  var e = lib.byKey[key] || fullLibrary.byKey[key];
  if (!e && libraryItems.length) {
    lib = HFLibrary.build(libraryItems, HFLibrary.tags());
    e = lib.byKey[key];
  }
  if (!e) {
    return null;
  }
  return { item: e, series: e.type === "episode" ? (library.titles[e.seriesKey] || fullLibrary.titles[e.seriesKey] || lib.titles[e.seriesKey] || null) : null };
}

function castUseProfile(pid) {
  var p = HFLibrary.profiles().filter(function (x) { return x.id === pid; })[0];
  if (!p || (activeProfile && activeProfile.id === pid)) {
    return;
  }
  activeProfile = p;
  HFLibrary.setProfile(p.id);
  rebuildLibrary();
}

function castState() {
  var it = player.item;
  var tt;
  if (currentRoute !== "player" || !it) {
    return { t: "closed" };
  }
  tt = playerTitles();
  return {
    t: "state",
    key: entryVideoKey(it),
    poster: it.type === "episode" || it.type === "video" ? it.key : (it.bannerKey || it.imageKey || entryVideoKey(it)),
    name: tt.title,
    sub: tt.sub,
    state: player.error ? "error" : player.state,
    error: player.error || "",
    time: HFPlayback.time(),
    dur: HFPlayback.duration(),
    at: Date.now(),
    tracks: HFPlayback.tracks()
  };
}

/* Avisar al celular que controla (agrupado: varios cambios seguidos van en un solo mensaje). */
function castNotify() {
  if (!cast.ctl || cast.notifyTimer) {
    return;
  }
  cast.notifyTimer = setTimeout(function () {
    cast.notifyTimer = null;
    if (cast.ctl) {
      castReply(cast.ctl, castState());
    }
  }, 250);
}

/* Se salió del video (Atrás, terminó, otro video): el celular deja de mostrar el control. */
function castClosed() {
  var ctl = cast.ctl;
  cast.ctl = null;
  clearInterval(cast.timer);
  cast.timer = null;
  if (ctl) {
    castReply(ctl, { t: "closed" });
  }
}

function castPlay(msg, de) {
  var found;
  if (!telegramUser || !HFLibrary.accountId()) {
    castReply(de, { t: "error", m: "La TV todavía no inició sesión en Telegram." });
    return;
  }
  if (msg.profile) {
    castUseProfile(msg.profile);
  }
  found = castFind(msg.key);
  if (found) {
    castStart(msg, de, found);
    return;
  }
  /* El catálogo guardado en la TV puede ser viejo (solo se actualiza al entrar a un perfil, y la app pudo abrirse
   * recién desde el celular): se revisan los chats del perfil y se busca otra vez. Mientras, el celular lo dice. */
  castReply(de, { t: "wait", m: "Actualizando el catálogo de la TV…" });
  updateStatus("Actualizando el catálogo para lo que mandó " + (de.nombre || "el celular") + "…");
  syncLibrary(function () {
    var again = castFind(msg.key);
    if (!again) {
      castReply(de, { t: "error", m: "La TV no encuentra ese video ni después de actualizar. Revisa que el perfil de la TV tenga ese chat elegido." });
      return;
    }
    castStart(msg, de, again);
  });
}

/* Abre en la TV lo que mandó el celular (ya encontrado en la biblioteca). */
function castStart(msg, de, found) {
  var vk;
  if (currentRoute === "player") {
    closePlayer(); // guarda el progreso de lo que estaba viendo la TV (y avisa «closed» a quien lo controlaba)
  }
  /* el audio y los subtítulos del celular: se guardan como la preferencia de ese video antes de abrirlo */
  vk = found.item.video ? found.item.video.key : found.item.key;
  try {
    if (msg.audio) { window.localStorage.setItem("hf.audio." + vk, msg.audio); }
    if (msg.sub !== undefined) { window.localStorage.setItem("hf.sub." + vk, msg.sub || "off"); }
  } catch (e) { /* sin almacenamiento */ }
  cast.ctl = { id: de.id, nombre: de.nombre || "" };
  openPlayer(found.item, Math.max(0, Number(msg.start) || 0), found.series);
  updateStatus("Reproduciendo desde " + (de.nombre || "el celular"));
  castReply(de, { t: "ok" });
  castNotify();
  clearInterval(cast.timer);
  cast.timer = setInterval(function () {
    if (!cast.ctl) { return; }
    if (currentRoute !== "player") { castClosed(); return; }
    castReply(cast.ctl, castState());
  }, 5000);
}

function onCastMessage(msg, de) {
  var playing = currentRoute === "player" && player.item;
  if (!msg || !de || de.tipo === "tv") {
    return; // las TVs no se mandan órdenes entre sí
  }
  if (msg.t === "play") {
    castPlay(msg, de);
    return;
  }
  if (msg.t === "live") {
    castLiveStart(msg, de);
    return;
  }
  if (msg.t === "get") {
    if (playing) { cast.ctl = { id: de.id, nombre: de.nombre || "" }; }
    castReply(de, castState());
    return;
  }
  if (!playing) {
    castReply(de, { t: "closed" });
    return;
  }
  cast.ctl = { id: de.id, nombre: de.nombre || "" };
  if (msg.t === "cmd") {
    if (msg.c === "toggle") { HFPlayback.toggle(); }
    else if (msg.c === "play") { HFPlayback.play(); }
    else if (msg.c === "pause") { HFPlayback.pause(); }
    else if (msg.c === "seek") { HFPlayback.seek(Math.max(0, Number(msg.v) || 0)); }
    showPlayerOverlay();
    scheduleOverlayHide();
  } else if (msg.t === "audio") {
    HFPlayback.setAudio(msg.k);
  } else if (msg.t === "sub") {
    HFPlayback.setSub(msg.k || null);
  } else if (msg.t === "stop") {
    exitPlayer("Detenido desde " + (de.nombre || "el celular"));
    return;
  }
  if (player.panel === "tracks") {
    renderTracksPanel();
  }
  castNotify();
}
