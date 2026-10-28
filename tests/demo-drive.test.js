import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDemoTextRoutes } from '../src/http/demo/text-routes.js';
import { AppError } from '../src/lib/errors.js';

function setup() {
  let uploaded;
  let handler;
  const app = { post: (path, options, action) => {
    assert.equal(path, '/api/demo/text-file');
    assert.equal(options.bodyLimit, 32 * 1024);
    handler = action;
  } };
  registerDemoTextRoutes(app, {
    config: { publicBaseUrl: 'https://auth.nicolabz.dev' },
    requireUser(request) {
      if (!request.user) throw new AppError(401, 'UNAUTHENTICATED', 'Connecte-toi avec Google.');
      return request.user;
    },
    drive: {
      async createTextFile(userId, name, content) {
        uploaded = { userId, name, content };
        return { id: 'f1', name, url: 'https://drive.google.com/file/d/f1/view' };
      }
    }
  });
  const reply = { code(status) { this.status = status; return this; }, send(body) { this.body = body; return this; } };
  return { handler, reply, uploaded: () => uploaded };
}

const request = (overrides = {}) => ({
  headers: { origin: 'https://auth.nicolabz.dev' },
  user: { id: 42 },
  body: { filename: 'test-écriture.txt', content: 'Un exemple' },
  ...overrides
});

test('Un compte connecté peut créer un TXT uniquement sur l’origine du serveur', async () => {
  const { handler, reply, uploaded } = setup();
  await handler(request(), reply);
  assert.equal(reply.status, 201);
  assert.deepEqual(uploaded(), { userId: 42, name: 'test-écriture.txt', content: 'Un exemple' });
  assert.equal(reply.body.url, 'https://drive.google.com/file/d/f1/view');
});

test('Refuse une application tierce même si elle est configurée pour le SSO', async () => {
  const { handler, reply } = setup();
  await assert.rejects(() => handler(request({
    headers: { origin: 'https://todo.nicolabz.dev' }
  }), reply), { code: 'ORIGIN_FORBIDDEN' });
});

test('Refuse les requêtes anonymes', async () => {
  const { handler, reply } = setup();
  await assert.rejects(() => handler(request({ user: undefined }), reply), { code: 'UNAUTHENTICATED' });
});

test('Valide le nom .txt et la taille UTF-8 du contenu', async () => {
  const { handler, reply } = setup();
  for (const filename of ['private.pdf', '../escape.txt', 'a/b.txt', '.hidden.txt', 'a..b.txt']) {
    await assert.rejects(() => handler(request({ body: { filename, content: 'ok' } }), reply),
      { code: 'INVALID_FILENAME' });
  }
  await assert.rejects(() => handler(request({
    body: { filename: 'test.txt', content: 'é'.repeat(9000) }
  }), reply), { code: 'TEXT_FILE_TOO_LARGE' });
});
