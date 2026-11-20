// Arranque del servidor de HomeFlix (contenedor «homeflix»).
import { createServer } from 'node:http';
import { crearApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || './data';
const adminToken = (process.env.ADMIN_TOKEN || '').trim();

const versionsDir = process.env.VERSIONS_DIR || '';
/* Canal «Anime»: ANIME_URL = dirección interna de la anime-api (contenedor «anime-api» en la red privada «anime-interna»).
 * Sin ANIME_URL el canal no existe. ANIME_SECRETO (opcional) mantiene válidas las direcciones firmadas tras reiniciar. */
const animeUrl = (process.env.ANIME_URL || '').trim();
const animeSecreto = (process.env.ANIME_SECRETO || '').trim();
const animeClave = (process.env.ANIME_KEY || '').trim(); // solo si la anime-api aún pide X-Api-Key
/* Recomendaciones: RECO_URL = el motor Python (contenedor «reco-api», red «reco-interna»); RECO_TOKEN = secreto compartido
 * (32+ caracteres, el mismo del .env del recomendador). Sin los dos, las filas «Para ti» simplemente no aparecen. */
const recoUrl = (process.env.RECO_URL || '').trim();
const recoToken = (process.env.RECO_TOKEN || '').trim();
const { manejar, db, anime, reco } = crearApp({ dataDir, versionsDir, adminToken: adminToken.length >= 32 ? adminToken : '', animeUrl, animeClave, animeSecreto, animeRastreo: !!animeUrl, recoUrl, recoToken });
const servidor = createServer(manejar);
servidor.listen(port, () => {
  console.log(`HomeFlix servidor en :${port} · datos en ${dataDir} · API interna ${adminToken.length >= 32 ? 'activa' : 'apagada (sin ADMIN_TOKEN)'} · recomendaciones ${reco.activo ? 'activas' : 'apagadas'}`);
});

const cerrar = () => { anime.idiomas.parar(); servidor.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);
