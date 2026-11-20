import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  constructor() {
    this.textContent = '';
    this.children = [];
    this.handlers = {};
    this.disabled = false;
    this.classList = { toggle() {} };
  }
  append(child) { this.children.push(child); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
}

test('La page charge les options publiques puis compte seulement au clic', async () => {
  const elements = new Map();
  const calls = [];
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    createElement() { return new Element(); }
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/public/status') {
      return { ok: true, json: async () => ({
        status: 'ok', checks: { api: 'ok', sqlite: 'ok' },
        statistics: { totalUsers: 1, activeUsers: 1, connectedDrives: 1, registeredApplications: 2 }
      }) };
    }
    if (url === '/api/public/applications') {
      return { ok: true, json: async () => ({ applications: [
        { id: 'pecule', requiresDrive: true, multiple: true },
        { id: 'batch', requiresDrive: false, multiple: false }
      ] }) };
    }
    if (url.includes('/pecule/')) {
      return { ok: true, json: async () => ({ appId: 'pecule', legacy: 1, named: 2, total: 3 }) };
    }
    return { ok: false, json: async () => ({ error: { code: 'DRIVE_NOT_CONNECTED' } }) };
  };
  const script = readFileSync(new URL('../src/http/home/home.js', import.meta.url), 'utf8');
  runInNewContext(script, { document, fetch, Intl, Date });
  await new Promise(resolve => setImmediate(resolve));

  const rows = elements.get('#applications-list').children;
  assert.deepEqual(rows.map(row => row.children.map(child => child.textContent)), [
    ['pecule', 'Drive requis à la connexion', 'Multi-fichiers', 'Fichiers : non comptés'],
    ['batch', 'Drive facultatif', 'Fichier unique', 'Fichiers : non comptés']
  ]);
  assert.equal(calls.filter(call => call.options?.method === 'POST').length, 0);

  await elements.get('#count-files').handlers.click();
  assert.equal(rows[0].children[3].textContent, 'Fichiers : 3');
  assert.equal(rows[1].children[3].textContent, 'Drive non connecté');
  assert.equal(elements.get('#applications-message').textContent, 'Certains comptages sont indisponibles.');
  assert.equal(calls.filter(call => call.options?.method === 'POST').length, 2);
});
