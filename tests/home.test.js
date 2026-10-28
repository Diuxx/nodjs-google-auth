import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHomeRoutes } from '../src/http/home/routes.js';
import { createRepositories } from '../src/db/repositories.js';

function registerRoutes(overrides = {}) {
  const routes = new Map();
  const app = { get(path, handler) { routes.set(path, handler); } };
  const repo = { statistics: { overview: () => ({ totalUsers: 12, activeUsers: 3, connectedDrives: 4 }) } };
  registerHomeRoutes(app, { repo: overrides.repo ?? repo, registeredApplications: 2 });
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
  assert.match(html, /Utilisateurs uniques/);
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
