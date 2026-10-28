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

/**
 * La connexion part toujours de PUBLIC_BASE_URL. Elle ne dépend jamais du
 * domaine, de l’adresse IP ou du port utilisés pour afficher /demo.
 * Le cookie OAuth est ainsi créé sur le même hôte que le callback Google.
 */
export function registerDemoRoutes(app, publicBaseUrl) {
  app.get('/demo/login', (_request, reply) => {
    const url = new URL('/auth/google/start', publicBaseUrl);
    url.searchParams.set('app', 'demo');
    url.searchParams.set('return_to', new URL('/demo', publicBaseUrl).href);
    return reply.redirect(url.href);
  });

  app.get('/demo/drive', (_request, reply) => {
    const url = new URL('/auth/drive/start', publicBaseUrl);
    url.searchParams.set('app', 'demo');
    url.searchParams.set('return_to', new URL('/demo', publicBaseUrl).href);
    return reply.redirect(url.href);
  });

  for (const asset of assets) {
    app.get(asset.path, (_request, reply) => reply
      .header('Cache-Control', 'no-store')
      .type(asset.contentType)
      .send(asset.content));
  }
  app.get('/demo/', (_request, reply) => reply.redirect('/demo'));
}
