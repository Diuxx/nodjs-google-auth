import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const themeScript = readFileSync(new URL('../src/http/theme/theme.js', import.meta.url), 'utf8');

function createThemePage({ savedTheme = null, prefersDark = false } = {}) {
  const attributes = new Map();
  const listeners = new Map();
  const storage = new Map(savedTheme ? [['nicolabz-theme', savedTheme]] : []);
  const root = { dataset: { theme: 'light' } };
  const button = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    setAttribute: (name, value) => attributes.set(name, value)
  };
  const label = { textContent: '' };
  const icon = { textContent: '' };
  const themeColor = { setAttribute: (name, value) => attributes.set(`theme-color-${name}`, value) };
  const mediaListeners = new Map();
  const context = {
    document: {
      documentElement: root,
      querySelector: selector => ({
        '[data-theme-toggle]': button,
        '[data-theme-label]': label,
        '[data-theme-icon]': icon,
        'meta[name="theme-color"]': themeColor
      })[selector] ?? null
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    window: {
      matchMedia: () => ({
        matches: prefersDark,
        addEventListener: (type, listener) => mediaListeners.set(type, listener)
      })
    }
  };

  vm.runInNewContext(themeScript, context);

  return { root, button, label, icon, attributes, storage, listeners, mediaListeners };
}

test('Le thème suit les préférences système et permet de basculer puis mémoriser le choix', () => {
  const page = createThemePage({ prefersDark: true });

  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.attributes.get('aria-pressed'), 'true');
  assert.equal(page.label.textContent, 'Mode clair');
  assert.equal(page.icon.textContent, '☀');
  assert.equal(page.attributes.get('theme-color-content'), '#111513');

  page.listeners.get('click')();

  assert.equal(page.root.dataset.theme, 'light');
  assert.equal(page.attributes.get('aria-pressed'), 'false');
  assert.equal(page.label.textContent, 'Mode sombre');
  assert.equal(page.storage.get('nicolabz-theme'), 'light');
});

test('Un choix mémorisé prévaut sur le système et les changements système restent suivis sans choix', () => {
  const savedPage = createThemePage({ savedTheme: 'dark', prefersDark: false });
  assert.equal(savedPage.root.dataset.theme, 'dark');

  const systemPage = createThemePage({ prefersDark: false });
  systemPage.mediaListeners.get('change')({ matches: true });
  assert.equal(systemPage.root.dataset.theme, 'dark');

  systemPage.listeners.get('click')();
  systemPage.mediaListeners.get('change')({ matches: true });
  assert.equal(systemPage.root.dataset.theme, 'light');
});
