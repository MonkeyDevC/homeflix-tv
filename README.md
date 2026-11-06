# HomeFlix TV

App de películas y series para televisores Samsung (Tizen), hecha con HTML, CSS y JavaScript sin frameworks.

## Instalar en la TV con Apps2Samsung

1. En Apps2Samsung, agrega esta fuente: `github.com/MonkeyDevC/homeflix`
   (CLI: `apps2samsung-cli sources add github.com/MonkeyDevC/homeflix`).
2. Busca **HomeFlix** en el catálogo e instálala. Apps2Samsung la firma con tu certificado de Samsung.
3. Cuando salga una versión nueva, el gestor de apps instaladas ofrece actualizarla.

## Publicar una versión nueva

1. Sube `version="X.Y.Z"` en `config.xml` (tiene que ser mayor que la anterior).
2. Haz commit y crea la etiqueta:

   ```bash
   git tag vX.Y.Z && git push origin main vX.Y.Z
   ```

3. GitHub Actions arma `homeflix-X.Y.Z.wgt` y lo publica como release.

Para probar el paquete localmente: `node tools/build-wgt.mjs` → `dist/homeflix-<versión>.wgt`.

## Estructura

- `index.html`, `css/style.css`, `js/main.js`: la app.
- `config.xml`: manifiesto de Tizen (id del paquete, versión, perfil `tv-samsung`).
- `tools/build-wgt.mjs`: empaquetador sin dependencias.
- `.cursor/rules/`: reglas de ingeniería para TV (foco, rendimiento, APIs prohibidas).
