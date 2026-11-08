import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHomeRoutes } from '../src/http/home/routes.js';
import { createRepositories } from '../src/db/repositories.js';

function registerRoutes(overrides = {}) {
  const routes = new Map();
  const app = { get(path, handler) { routes.set(path, handler); } };
  const repo = { statistics: { overview: () => ({ totalUsers: 12, activeUsers: 3, connectedDrives: 4 }) } };
  const clientApps = { apps: new Map([
    ['todo', new Set(['https://todo.example', 'https://todo-alt.example'])],
    ['budget', new Set(['https://budget.example'])],
    ['demo', new Set(['https://api.example'])]
  ]) };
  registerHomeRoutes(app, { repo: overrides.repo ?? repo, clientApps: overrides.clientApps ?? clientApps });
  return routes;
}

function reply() {
  return {
    headers: {},
    header(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test('La page accueil est servie par Node et présente le service sans script inline', () => {
  const routes = registerRoutes();
  const page = routes.get('/')({}, reply());
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-type'], /^text\/html/);
  const html = page.body.toString('utf8');
  assert.match(html, /Nicolabz Identity/);
  assert.match(html, /data-theme="light"/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /\/theme\/theme\.css/);
  assert.match(html, /\/theme\/theme\.js/);
  assert.match(html, /UTILISATEURS UNIQUES/i);
  assert.match(html, /Applications autorisées/);
  assert.match(html, /id="applications-list"/);
  assert.match(html, /href="\/demo"/);
  assert.match(html, /src="\/home\/home\.js"/);
  assert.match(html, /href="\/home\/home\.css"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/);

  for (const [path, expectedType] of [['/home/home.css', 'text/css'], ['/home/home.js', 'text/javascript']]) {
    const asset = routes.get(path)({}, reply());
    assert.match(asset.headers['content-type'], new RegExp(`^${expectedType}`));
    assert.ok(asset.body.length > 0);
  }
});

test('La liste publique contient les identifiants et toutes leurs origines, sans la démo', async () => {
  const routes = registerRoutes({
    repo: { statistics: { overview: () => { throw new Error('SQLite indisponible'); } } }
  });
  const response = await routes.get('/api/public/applications')({}, reply());
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {
    applications: [
      { id: 'todo', origins: ['https://todo.example', 'https://todo-alt.example'] },
      { id: 'budget', origins: ['https://budget.example'] }
    ]
  });
});

test('La liste publique peut être vide lorsqu’il ne reste que la démo', async () => {
  const clientApps = { apps: new Map([['demo', new Set(['https://api.example'])]]) };
  const response = await registerRoutes({ clientApps }).get('/api/public/applications')({}, reply());
  assert.deepEqual(response.body, { applications: [] });
});

test('Le statut public ne contient que les compteurs agrégés et une santé locale', async () => {
  const routes = registerRoutes();
  const response = await routes.get('/api/public/status')({}, reply());
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {
    status: 'ok',
    checks: { api: 'ok', sqlite: 'ok' },
    statistics: { totalUsers: 12, activeUsers: 3, connectedDrives: 4, registeredApplications: 2 }
  });
  assert.doesNotMatch(JSON.stringify(response.body), /email|googleSub|picture|refresh_token/i);
});

test('Le compteur SQLite compte les utilisateurs uniques et les sessions non expirées', () => {
  let readSql;
  let readParams;
  const db = {
    prepare(sql) {
      readSql = sql;
      return { get(params) { readParams = params; return { totalUsers: 8, activeUsers: 2, connectedDrives: 1 }; } };
    }
  };
  const repo = createRepositories(db, () => 123456);
  assert.deepEqual(repo.statistics.overview(), { totalUsers: 8, activeUsers: 2, connectedDrives: 1 });
  assert.match(readSql, /COUNT\(\*\) FROM users/);
  assert.match(readSql, /COUNT\(DISTINCT user_id\) FROM sessions WHERE expires_at > @now/);
  assert.match(readSql, /COUNT\(\*\) FROM drive_credentials/);
  assert.deepEqual(readParams, { now: 123456 });
});
