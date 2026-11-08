import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../src/http/home/home.js', import.meta.url), 'utf8');

function createElement() {
  return {
    textContent: '',
    children: [],
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener(_type, listener) { this.listener = listener; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }
  };
}

async function loadPage(applicationsResponse) {
  const elements = new Map();
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElement());
      return elements.get(selector);
    },
    createElement
  };
  const fetch = async url => url === '/api/public/applications' ? applicationsResponse : {
    ok: true,
    json: async () => ({
      status: 'ok', checks: { api: 'ok', sqlite: 'ok' },
      statistics: { totalUsers: 1, activeUsers: 1, connectedDrives: 0, registeredApplications: 1 }
    })
  };
  vm.runInNewContext(script, { document, fetch, Intl, Date });
  await new Promise(resolve => setImmediate(resolve));
  return elements;
}

test('La liste affiche chaque identifiant et toutes ses origines comme texte', async () => {
  const elements = await loadPage({
    ok: true,
    json: async () => ({ applications: [{ id: 'todo', origins: ['https://a.example', 'https://b.example'] }] })
  });
  const list = elements.get('#applications-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'todo');
  assert.deepEqual(list.children[0].children[1].children.map(item => item.textContent),
    ['https://a.example', 'https://b.example']);
  assert.equal(elements.get('#applications-status').textContent, '');
});

test('Une liste vide ou invalide est signalée sans altérer le statut du service', async () => {
  const empty = await loadPage({ ok: true, json: async () => ({ applications: [] }) });
  assert.equal(empty.get('#applications-status').textContent, 'Aucune application configurée.');

  for (const response of [
    { ok: false, status: 500 },
    { ok: true, json: async () => ({ applications: [{ id: 'todo', origins: 'invalid' }] }) }
  ]) {
    const elements = await loadPage(response);
    assert.equal(elements.get('#applications-status').textContent, 'Impossible de charger les applications autorisées.');
    assert.equal(elements.get('#applications-list').children.length, 0);
    assert.equal(elements.get('#service-status').textContent, 'API opérationnelle');
  }
});
