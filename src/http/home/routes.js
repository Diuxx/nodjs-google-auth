import { readFileSync } from 'node:fs';

const assets = [
  { route: '/', filename: 'index.html', contentType: 'text/html; charset=utf-8' },
  { route: '/home/home.css', filename: 'home.css', contentType: 'text/css; charset=utf-8' },
  { route: '/home/home.js', filename: 'home.js', contentType: 'text/javascript; charset=utf-8' }
].map(asset => ({
  ...asset,
  content: readFileSync(new URL(asset.filename, import.meta.url))
}));

/** Présentation publique : seuls des comptes agrégés sont exposés. */
export function registerHomeRoutes(app, { repo, registeredApplications }) {
  for (const asset of assets) {
    app.get(asset.route, (_request, reply) => reply
      .header('Cache-Control', 'no-store')
      .type(asset.contentType)
      .send(asset.content));
  }

  app.get('/api/public/status', async (_request, reply) => {
    const stats = repo.statistics.overview();
    return reply.header('Cache-Control', 'no-store').send({
      status: 'ok',
      checks: { api: 'ok', sqlite: 'ok' },
      statistics: { ...stats, registeredApplications }
    });
  });
}
