/* Textos del motor de reproducción (player.js, mp4.js, mkv.js, subs.js de titlog/telegram-tizen) en español.
 * El motor llama I18n.t("frase original en chino", args...): se busca aquí y se rellenan {0}, {1}.
 * Tiene que cargarse ANTES que los archivos del motor (guardan la función al cargar). */
var I18n = (function () {
  "use strict";

  var ES = {
    "；": "; ",
    "、": ", ",
    "未知": "desconocido",
    "音频格式 {0} 放不了": "El formato de audio {0} no se puede reproducir",
    "视频格式 {0} 放不了": "El formato de video {0} no se puede reproducir",
    "视频 {0} 放不了": "El video {0} no se puede reproducir",
    "没有视频轨": "El archivo no tiene pista de video",
    "没有能放的音轨（{0}），没声音": "Ninguna pista de audio se puede reproducir en la TV ({0}): se verá sin sonido",
    "播放器出错": "Error del reproductor",
    "字幕格式 {0} 放不了": "El formato de subtítulos {0} no se puede mostrar",
    "{0} 电视放不了": "La TV no puede reproducir {0}",
    "Apple 无损（ALAC）音频电视解不了": "La TV no puede reproducir audio Apple Lossless (ALAC)",
    "这台电视解不了高度超过 1080 的 H.264 视频（这部是 {0}）": "Esta TV no puede reproducir video H.264 de más de 1080 de alto (este es {0}). Súbelo en 1080p o en H.265.",
    "读到文件尾也没找到 moov": "El MP4 está incompleto (no tiene índice moov)",
    "没读够（{0}/{1}）": "No llegaron todos los datos ({0}/{1})",
    "已经是分段 MP4（fragmented），还不支持": "Los MP4 fragmentados todavía no son compatibles",
    "压缩过的音频轨放不了": "La pista de audio comprimida no se puede reproducir",
    "压缩过的视频轨放不了": "La pista de video comprimida no se puede reproducir",
    "加密的轨道放不了": "Las pistas cifradas no se pueden reproducir",
    "不认识的文件格式（不是 MP4 也不是 MKV）": "Formato no reconocido: solo se pueden reproducir MP4 y MKV",
    "不是 MKV（没有 EBML 头）": "El archivo no es un MKV válido",
    "mdat 一直到文件尾，没有 moov": "El MP4 está incompleto (no tiene índice moov)",
    "Vorbis 音轨放不了": "La pista de audio Vorbis no se puede reproducir",
    "TrueHD 音轨电视放不了": "La TV no puede reproducir audio TrueHD",
    "PCM 音轨放不了": "La pista de audio PCM no se puede reproducir",
    "MKV 里没有 Tracks": "El MKV no tiene pistas",
    "MKV 里没有 Segment": "El MKV está dañado (sin Segment)",
    "MKV 里找不到 Cluster": "El MKV está dañado (sin Cluster)",
    "FLAC 音轨电视解不了": "La TV no puede reproducir audio FLAC",
    "FLAC 头不对": "La pista FLAC está dañada",
    "DVD 图形字幕（VobSub）放不了": "Los subtítulos de DVD (VobSub) no se pueden mostrar",
    "DTS 音轨电视放不了": "La TV no puede reproducir audio DTS",
    "90 秒没出画面": "El video no empezó después de 90 segundos. Revisa la conexión e inténtalo otra vez."
  };

  function t(s) {
    var args = arguments;
    var text = Object.prototype.hasOwnProperty.call(ES, s) ? ES[s] : s;
    return String(text).replace(/\{(\d)\}/g, function (m, i) { return args[+i + 1]; });
  }

  return { t: t };
})();
