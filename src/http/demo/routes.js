import { readFileSync } from 'node:fs';

// Les ressources sont préchargées pour éviter des lectures disque par requête.
const assets = [
  { path: '/demo', file: 'index.html', contentType: 'text/html; charset=utf-8' },
  { path: '/demo/demo.css', file: 'demo.css', contentType: 'text/css; charset=utf-8' },
  { path: '/demo/demo.js', file: 'demo.js', contentType: 'text/javascript; charset=utf-8' }
].map(asset => ({
  ...asset,
  content: readFileSync(new URL(asset.file, import.meta.url))
}));

export function registerDemoRoutes(app) {
  for (const asset of assets) {
    app.get(asset.path, (_request, reply) => reply
      .header('Cache-Control', 'no-store')
      .type(asset.contentType)
      .send(asset.content));
  }
  app.get('/demo/', (_request, reply) => reply.redirect('/demo'));
}
