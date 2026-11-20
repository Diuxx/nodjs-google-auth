import { readFileSync } from 'node:fs';

const assets = [
  { route: '/', filename: 'index.html', contentType: 'text/html; charset=utf-8' },
  { route: '/home/home.css', filename: 'home.css', contentType: 'text/css; charset=utf-8' },
  { route: '/home/home.js', filename: 'home.js', contentType: 'text/javascript; charset=utf-8' }
].map(asset => ({
  ...asset,
  content: readFileSync(new URL(asset.filename, import.meta.url))
}));

export function registerHomeRoutes(app, { repo, clientApps }) {
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
      statistics: { ...stats, registeredApplications: clientApps.apps.size - 1 }
    });
  });

  app.get('/api/public/applications', async (_request, reply) => {
    const applications = [...clientApps.apps.keys()]
      .filter(id => id !== 'demo')
      .map(id => ({
        id,
        requiresDrive: clientApps.driveRequiredApps.has(id),
        multiple: clientApps.multipleApps.has(id)
      }));
    return reply.header('Cache-Control', 'no-store').send({ applications });
  });
}
