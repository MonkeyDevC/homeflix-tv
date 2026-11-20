/* Clave de la API de Telegram de HomeFlix, ofuscada. En el repo siempre está vacía:
 * tools/build-wgt.mjs (release) y tools/serve.mjs (local) la rellenan desde los secretos de GitHub o el .env. */
var HF_TG_API_PACKED = "";

/* Versión de esta app (la escriben tools/build-wgt.mjs y tools/serve.mjs desde config.xml) y repo donde buscar actualizaciones. */
var HF_VERSION = "";

/* Servidor de HomeFlix (sincronización, «Ver en la TV», actualizaciones y recomendaciones). Desde 2026-11 el VPS ya no existe:
 * corre en Docker en el Mac de la casa (local/README.md). Se cambia desde el celular (Ajustes → Servidor de HomeFlix); la TV lo
 * toma del archivo de la cuenta en Telegram (js/sync.js). Lo que se guarda en este aparato (hf.servidor) gana al de fábrica. */
var HF_SERVIDOR_DEFECTO = "http://192.168.1.12:4500/productos/HomeFlix";
function hfServidorValido(u) { return /^https?:\/\/[^\s\/?#]+(\/[^\s?#]*)?$/i.test(String(u || "")); }
function hfServidor() {
  var guardado = "";
  try { guardado = window.localStorage.getItem("hf.servidor") || ""; } catch (e) { guardado = ""; }
  return String(window.HF_SYNC_URL || (hfServidorValido(guardado) ? guardado : "") || HF_SERVIDOR_DEFECTO).replace(/\/+$/, "");
}
