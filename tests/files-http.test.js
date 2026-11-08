import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/app.js';

function fixture({ user } = {}) {
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.nicolabz.dev',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    CLIENT_APPS_JSON: '[{"id":"todo","origins":["https://todo.nicolabz.dev"]}]'
  });
  const repo = {
    sessions: {
      find: token => (token === 'session-token' ? user : null),
      remove: () => {}
    },
    drive: { getEncryptedToken: id => (user && id === user.id ? 'encrypted' : null) },
    statistics: { overview: () => ({ totalUsers: 0, activeUsers: 0, connectedDrives: 0 }) }
  };
  const auth = {
    start: () => ({ browserToken: 'x', redirectUrl: 'https://accounts.google.com' })
  };
  const drive = {};
  const calls = { list: [], create: [], get: [], update: [], rename: [], delete: [] };
  const files = {
    async list(userId, appId, options) {
      calls.list.push({ userId, appId, options });
      return { files: [], nextPageToken: null };
    },
    async create(userId, appId, filename, data) {
      calls.create.push({ userId, appId, filename, data });
      return { id: 'file-1', filename, version: 1, updatedAt: '2026-10-28T12:00:00Z' };
    },
    async get(userId, appId, fileId) {
      calls.get.push({ userId, appId, fileId });
      return { id: fileId, filename: 'tasks.json', version: 2, updatedAt: '2026-10-28T12:00:00Z', data: { ok: true } };
    },
    async update(userId, appId, fileId, version, data) {
      calls.update.push({ userId, appId, fileId, version, data });
      return { id: fileId, filename: 'tasks.json', version: version + 1, updatedAt: '2026-10-28T13:00:00Z', data };
    },
    async rename(userId, appId, fileId, version, filename) {
      calls.rename.push({ userId, appId, fileId, version, filename });
      return { id: fileId, filename, version: version + 1, updatedAt: '2026-10-28T13:10:00Z' };
    },
    async delete(userId, appId, fileId, version) {
      calls.delete.push({ userId, appId, fileId, version });
      return { ok: true };
    }
  };

  const app = createApp({
    config,
    repo,
    auth,
    google: { revoke: async () => {} },
    sync: {},
    drive,
    files,
    database: { prepare: () => ({ get: () => ({ 1: 1 }) }) }
  });

  return { app, calls };
}

test('Protection d’accès et création de fichier JSON', async t => {
  const user = { id: 1, googleSub: 'sub', email: 'u@example.org', name: 'U' };
  const { app, calls } = fixture({ user });
  const instance = await app;
  t.after(() => instance.close());

  const payload = { filename: 'tasks.json', data: { tasks: [] } };
  const cookies = { cookie: '__Host-nicolabz_sid=session-token' };

  const ok = await instance.inject({
    method: 'POST',
    url: '/api/files/todo',
    headers: { origin: 'https://todo.nicolabz.dev', ...cookies },
    payload
  });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().filename, 'tasks.json');
  assert.deepEqual(calls.create[0], { userId: 1, appId: 'todo', filename: 'tasks.json', data: { tasks: [] } });

  const invalid = await instance.inject({
    method: 'POST',
    url: '/api/files/todo',
    headers: { origin: 'https://todo.nicolabz.dev', ...cookies },
    payload: { filename: '../secret.json', data: {} }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_FILENAME');
});

test('Lecture, mise à jour, renommage et suppression passent par le service', async t => {
  const user = { id: 2, googleSub: 'sub2', email: 'u2@example.org', name: 'U2' };
  const { app, calls } = fixture({ user });
  const instance = await app;
  t.after(() => instance.close());

  const headers = { origin: 'https://todo.nicolabz.dev', cookie: '__Host-nicolabz_sid=session-token' };

  const listed = await instance.inject({ method: 'GET', url: '/api/files/todo?pageSize=10', headers });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(calls.list[0], { userId: 2, appId: 'todo', options: { pageSize: 10, pageToken: undefined } });

  const read = await instance.inject({ method: 'GET', url: '/api/files/todo/abc123', headers });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().data.ok, true);
  assert.deepEqual(calls.get[0], { userId: 2, appId: 'todo', fileId: 'abc123' });

  const updated = await instance.inject({
    method: 'PUT',
    url: '/api/files/todo/abc123',
    headers,
    payload: { version: 2, data: { tasks: [1] } }
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().version, 3);
  assert.deepEqual(calls.update[0], {
    userId: 2,
    appId: 'todo',
    fileId: 'abc123',
    version: 2,
    data: { tasks: [1] }
  });

  const renamed = await instance.inject({
    method: 'PATCH',
    url: '/api/files/todo/abc123',
    headers,
    payload: { version: 3, filename: 'renamed.json' }
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().filename, 'renamed.json');
  assert.deepEqual(calls.rename[0], {
    userId: 2,
    appId: 'todo',
    fileId: 'abc123',
    version: 3,
    filename: 'renamed.json'
  });

  const deleted = await instance.inject({
    method: 'DELETE',
    url: '/api/files/todo/abc123?version=4',
    headers
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(calls.delete[0], {
    userId: 2,
    appId: 'todo',
    fileId: 'abc123',
    version: 4
  });
});

