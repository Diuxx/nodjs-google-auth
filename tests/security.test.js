import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createTokenCipher, hashToken, randomToken, safeHashEqual } from '../src/lib/crypto.js';
import { parseClientApps, requireAppOrigin, validateReturnUrl } from '../src/lib/client-apps.js';

test('AES-256-GCM chiffre, déchiffre et détecte une altération', () => {
  const cipher = createTokenCipher(randomBytes(32).toString('base64'));
  const encrypted = cipher.encrypt('refresh-token-fictif');
  assert.equal(cipher.decrypt(encrypted), 'refresh-token-fictif');
  assert.ok(!encrypted.includes('refresh-token-fictif'));
  const pieces = encrypted.split('.');
  pieces[3] = Buffer.from('attaque').toString('base64url');
  assert.throws(() => cipher.decrypt(pieces.join('.')));
});

test('Jetons opaques aléatoires et comparaison de hash', () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.equal(safeHashEqual(hashToken(a), hashToken(a)), true);
  assert.equal(safeHashEqual(hashToken(a), hashToken(b)), false);
  assert.equal(safeHashEqual('bad', hashToken(a)), false);
});

test('Origines déclarées : rejette les retours malveillants et les croisements entre applications', () => {
  const apps = parseClientApps(JSON.stringify([
    { id: 'todo', origins: ['https://todo.nicolabz.dev'] },
    { id: 'budget', origins: ['https://budget.nicolabz.dev'] }
  ]), true);
  assert.equal(validateReturnUrl(apps, 'todo', 'https://todo.nicolabz.dev/path?x=1'),
    'https://todo.nicolabz.dev/path?x=1');
  assert.throws(() => validateReturnUrl(apps, 'todo', 'https://todo.nicolabz.dev.evil.com'));
  assert.throws(() => validateReturnUrl(apps, 'todo', 'https://budget.nicolabz.dev'));
  assert.throws(() => validateReturnUrl(apps, 'todo', 'https://todo.nicolabz.dev@evil.com'));
  assert.throws(() => requireAppOrigin(apps, 'todo', 'https://budget.nicolabz.dev'));
  assert.doesNotThrow(() => requireAppOrigin(apps, 'todo', 'https://todo.nicolabz.dev'));
  assert.throws(() => parseClientApps('[{"id":"todo","origins":["http://evil.com"]}]', true));
});
