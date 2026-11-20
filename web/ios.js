/* HomeFlix web · adaptación para Safari de iPhone. Se carga ANTES del motor (web/index.html); la TV y el APK no la usan.
 *
 * El motor (js/engine/player.js) arma el video con «new MediaSource()» y lo conecta con «video.src = blob:…». Safari en iPhone no tiene
 * MediaSource: desde iOS 17.1 trae «ManagedMediaSource», que es casi igual pero (1) exige «disableRemotePlayback» y (2) solo se conecta
 * con un <source> dentro del <video> (así lo hace hls.js). Aquí se le dice al motor que «MediaSource» es esa y se redirige el «src».
 * iPad y Android/PC ya traen MediaSource: no se toca nada. Sin ninguna de las dos (iPhone con iOS anterior a 17.1) no hay video:
 * window.HF_NO_VIDEO deja el motivo para que la app lo avise. NO PROBADO en un iPhone real. */
(function () {
  "use strict";
  var W = window;
  if (W.MediaSource) { return; }
  if (!W.ManagedMediaSource) {
    W.HF_NO_VIDEO = "Este iPhone no puede reproducir aquí. Hace falta iOS 17.1 o más nuevo (Ajustes → General → Actualización de software).";
    return;
  }
  W.MediaSource = W.ManagedMediaSource;
  var proto = HTMLMediaElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, "src");
  var removeAttr = proto.removeAttribute;
  function quitarFuentes(v) {
    var s = v.querySelectorAll("source[data-hf]");
    var i;
    for (i = 0; i < s.length; i += 1) { s[i].parentNode.removeChild(s[i]); }
  }
  if (desc && desc.set) {
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (v) {
        if (this.tagName === "VIDEO" && typeof v === "string" && v.indexOf("blob:") === 0) {
          var s = document.createElement("source");
          this.disableRemotePlayback = true;
          quitarFuentes(this);
          removeAttr.call(this, "src");
          s.setAttribute("data-hf", "1");
          s.src = v;
          s.type = "video/mp4";
          this.appendChild(s);
          this.load();
          return;
        }
        desc.set.call(this, v);
      }
    });
  }
  proto.removeAttribute = function (name) {
    if (this.tagName === "VIDEO" && String(name).toLowerCase() === "src") { quitarFuentes(this); }
    return removeAttr.apply(this, arguments);
  };
})();
