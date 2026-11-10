// Arranque del servidor de HomeFlix (contenedor «homeflix»).
import { createServer } from 'node:http';
import { crearApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || './data';
const adminToken = (process.env.ADMIN_TOKEN || '').trim();

const versionsDir = process.env.VERSIONS_DIR || '';
const { manejar, db } = crearApp({ dataDir, versionsDir, adminToken: adminToken.length >= 32 ? adminToken : '' });
const servidor = createServer(manejar);
servidor.listen(port, () => {
  console.log(`HomeFlix servidor en :${port} · datos en ${dataDir} · API interna ${adminToken.length >= 32 ? 'activa' : 'apagada (sin ADMIN_TOKEN)'}`);
});

const cerrar = () => { servidor.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', cerrar);
process.on('SIGINT', cerrar);
