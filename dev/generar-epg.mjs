// Genera dev/epg-prueba.xml con programas alrededor de «ahora» (solo para probar el diseño de TV en vivo).
// Uso: node dev/generar-epg.mjs   → luego usa dev/iptv-prueba.m3u (apunta a ese XML por url-tvg)
import { writeFileSync } from 'node:fs';
const fmt = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
const T = {
  prueba1: ['Ladrones debutantes', 'Leprechaun', 'Noche de cine'],
  prueba2: ['CSI: Miami', 'Blue Bloods', 'El Capo'],
  prueba3: ['Ink Master', 'Noticias de la tarde', 'Documental: la vida salvaje'],
  prueba4: ['Programa de prueba', 'Otro programa', 'Cierre'],
};
const P = ["AVENDGAME", "GMZ", "IM1", "AVINFWAR", "HPRS"];
let x = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';
const base = Date.now() - 40 * 60000;
let k = 0;
for (const [id, names] of Object.entries(T)) {
  x += `<channel id="${id}"><display-name>${id}</display-name></channel>\n`;
  let t = base - k * 17 * 60000;
  for (const n of names) {
    const len = (60 + k * 11) * 60000;
    x += `<programme start="${fmt(t)}" stop="${fmt(t + len)}" channel="${id}"><title lang="es">${n}</title><icon src="http://localhost:5173/images/portadas/${P[(k+names.indexOf(n))%P.length]}.jpg"/><desc lang="es">Descripción de ${n}: una emisión de prueba para ver cómo queda el diseño de la guía en la lista de canales.</desc></programme>\n`;
    t += len;
  }
  k += 1;
}
writeFileSync(new URL('./epg-prueba.xml', import.meta.url), x + '</tv>\n');
console.log('dev/epg-prueba.xml listo');
