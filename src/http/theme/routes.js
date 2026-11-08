import { readFileSync } from 'node:fs';

const assets = [
  { path: '/theme/theme.css', filename: 'theme.css', contentType: 'text/css; charset=utf-8' },
  { path: '/theme/theme.js', filename: 'theme.js', contentType: 'text/javascript; charset=utf-8' }
].map(asset => ({
  ...asset,
  content: readFileSync(new URL(asset.filename, import.meta.url))
}));

export function registerThemeRoutes(app) {
  for (const asset of assets) {
    app.get(asset.path, (_request, reply) => reply
      .header('Cache-Control', 'no-store')
      .type(asset.contentType)
      .send(asset.content));
  }
}
