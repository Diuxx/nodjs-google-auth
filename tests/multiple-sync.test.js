import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createGoogleDrive } from '../src/drive/google-drive.js';
import { createSyncService } from '../src/sync/sync-service.js';
import { createApp } from '../src/http/app.js';

async function setup() {
  const config = loadConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://auth.example.org',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 8).toString('base64'),
    CLIENT_APPS_JSON: JSON.stringify([
      { id: 'pecule', origins: ['https://pecule.example.org'], multiple: true },
      { id: 'batch', origins: ['https://batch.example.org'], multiple: true },
      { id: 'legacy', origins: ['https://legacy.example.org'] }
    ])
  });
  const files = [];
  let nextId = 0;
  const writes = [];
  const reads = [];
  const failures = new Map();
  const index = new Map();
  const repo = {
    sessions: {
      find: token => token === 'user1' ? { id: 1 } : token === 'user2' ? { id: 2 } : undefined
    },
    drive: { getEncryptedToken: userId => config.cipher.encrypt(`user-${userId}`) },
    sync: {
      getFileId: (userId, appId) => index.get(`${userId}:${appId}`),
      saveFileId: (userId, appId, id) => index.set(`${userId}:${appId}`, id),
      clearFileId: (userId, appId) => index.delete(`${userId}:${appId}`)
    }
  };
  const google = { oauthClientForDrive: token => ({
    getAccessToken: async () => ({ token })
  }) };
  const http = async (url, options) => {
    const parsed = new URL(url);
    const owner = options.headers.Authorization.slice('Bearer '.length);
    const { method, body } = options;
    if (failures.has(method)) {
      const status = failures.get(method);
      failures.delete(method);
      return new Response('', { status });
    }
    if (method === 'GET' && parsed.searchParams.has('q')) {
      const query = parsed.searchParams.get('q');
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const name = /name = '([^']+)'/.exec(query)?.[1];
      const mimeType = /mimeType = '([^']+)'/.exec(query)?.[1];
      const matches = files.filter(file => file.owner === owner &&
        file.parents.includes(parent) && (!name || file.name === name) &&
        (!mimeType || file.mimeType === mimeType));
      const offset = Number(parsed.searchParams.get('pageToken') || 0);
      const page = matches.slice(offset, offset + 1);
      return Response.json({
        files: page.map(({ id, name: fileName }) => ({ id, name: fileName })),
        ...(offset + 1 < matches.length ? { nextPageToken: String(offset + 1) } : {})
      });
    }
    if (method === 'GET') {
      reads.push(url);
      const id = parsed.pathname.split('/').pop();
      const file = files.find(item => item.id === id && item.owner === owner);
      return file ? Response.json(file.document) : new Response('', { status: 404 });
    }
    if (method === 'POST') {
      writes.push({ owner, method });
      if (parsed.pathname === '/drive/v3/files') {
        const metadata = JSON.parse(body);
        const id = `id-${++nextId}`;
        files.push({ ...metadata, id, owner });
        return Response.json({ id });
      }
      const metadataText = /\r\n\r\n([^\r]+)\r\n--/.exec(body)?.[1];
      const documentText = /Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{.*\})\r\n--[^\r]+--/.exec(body)?.[1];
      assert.ok(metadataText && documentText);
      const metadata = JSON.parse(metadataText);
      const id = `id-${++nextId}`;
      files.push({ ...metadata, id, owner, document: JSON.parse(documentText) });
      return Response.json({ id, name: metadata.name });
    }
    if (method === 'PATCH') {
      writes.push({ owner, method });
      const id = parsed.pathname.split('/').pop();
      const file = files.find(item => item.id === id && item.owner === owner);
      if (!file) return new Response('', { status: 404 });
      if (parsed.searchParams.get('uploadType') === 'multipart') {
        const metadataText = /\r\n\r\n([^\r]+)\r\n--/.exec(body)?.[1];
        const documentText = /Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{.*\})\r\n--[^\r]+--/.exec(body)?.[1];
        assert.ok(metadataText && documentText);
        file.name = JSON.parse(metadataText).name;
        file.document = JSON.parse(documentText);
      } else {
        file.document = JSON.parse(body);
      }
      return Response.json({ id });
    }
    if (method === 'DELETE') {
      writes.push({ owner, method });
      const id = parsed.pathname.split('/').pop();
      const position = files.findIndex(item => item.id === id && item.owner === owner);
      if (position === -1) return new Response('', { status: 404 });
      files.splice(position, 1);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Drive request: ${method} ${url}`);
  };
  const drive = createGoogleDrive({ config, repo, google, http });
  const sync = createSyncService({ drive, clock: () => new Date('2026-01-01T00:00:00Z') });
  const app = await createApp({
    config, repo, google, drive, sync, auth: {},
    database: { prepare: () => ({ get: () => ({ 1: 1 }) }) }
  });
  const request = (method, path, { origin = 'https://pecule.example.org', user = 'user1', payload } = {}) =>
    app.inject({
      method, url: path,
      headers: { origin, ...(user ? { cookie: `__Host-nicolabz_sid=${user}` } : {}) },
      ...(payload === undefined ? {} : { payload })
    });
  return { app, config, files, writes, reads, failures, request };
}

test('Multi-fichiers : création, pagination, lecture, versions et isolation', async t => {
  const { app, files, writes, request } = await setup();
  t.after(() => app.close());
  const listPath = '/api/sync/pecule/files';
  const firstPath = `${listPath}/comptes.json`;
  const secondPath = `${listPath}/budgets.json`;

  assert.deepEqual((await request('GET', listPath)).json(), { appId: 'pecule', files: [] });
  assert.equal((await request('GET', firstPath)).statusCode, 404);
  assert.equal(writes.length, 0);
  const first = await request('PUT', firstPath, { payload: { version: 0, data: { amount: 10 } } });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), {
    appId: 'pecule', name: 'comptes.json', version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z', data: { amount: 10 }
  });
  const second = await request('PUT', secondPath, { payload: { version: 0, data: [1, 2] } });
  assert.equal(second.statusCode, 200);
  assert.deepEqual((await request('GET', listPath)).json(), {
    appId: 'pecule', files: ['budgets.json', 'comptes.json']
  });
  assert.deepEqual((await request('GET', firstPath)).json(), first.json());
  const conflict = await request('PUT', firstPath, { payload: { version: 0, data: {} } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'SYNC_CONFLICT');
  const update = await request('PUT', firstPath, { payload: { version: 1, data: { amount: 11 } } });
  assert.equal(update.json().version, 2);
  assert.deepEqual((await request('GET', listPath, { user: 'user2' })).json().files, []);
  assert.equal((await request('GET', firstPath, { user: 'user2' })).statusCode, 404);
  assert.deepEqual((await request('GET', '/api/sync/batch/files', {
    origin: 'https://batch.example.org'
  })).json().files, []);
  assert.equal(files.filter(file => file.mimeType === 'application/vnd.google-apps.folder').length, 1);
  await request('PUT', firstPath, { user: 'user2', payload: { version: 0, data: { amount: 20 } } });
  await request('PUT', '/api/sync/batch/files/comptes.json', {
    origin: 'https://batch.example.org', payload: { version: 0, data: { amount: 30 } }
  });
  assert.deepEqual((await request('GET', firstPath)).json().data, { amount: 11 });
  assert.deepEqual((await request('GET', firstPath, { user: 'user2' })).json().data, { amount: 20 });
  assert.deepEqual((await request('GET', '/api/sync/batch/files/comptes.json', {
    origin: 'https://batch.example.org'
  })).json().data, { amount: 30 });
});

test('Multi-fichiers : permissions, noms, anciennes routes et absence de migration', async t => {
  const { app, files, request } = await setup();
  t.after(() => app.close());
  const legacy = await request('PUT', '/api/sync/pecule', { payload: { version: 0, data: { old: true } } });
  assert.equal(legacy.statusCode, 200);
  const denied = await request('GET', '/api/sync/pecule/files', { origin: 'https://batch.example.org' });
  assert.equal(denied.statusCode, 403);
  assert.equal((await request('GET', '/api/sync/pecule/files', { user: null })).statusCode, 401);
  const disabled = await request('GET', '/api/sync/legacy/files', { origin: 'https://legacy.example.org' });
  assert.equal(disabled.json().error.code, 'MULTIPLE_SYNC_DISABLED');
  assert.equal((await request('PUT', '/api/sync/pecule/files/bad%27name.json', {
    payload: { version: 0, data: {} }
  })).json().error.code, 'INVALID_SYNC_FILENAME');
  assert.deepEqual((await request('GET', '/api/sync/pecule/files')).json().files, []);
  assert.deepEqual((await request('GET', '/api/sync/pecule')).json().data, { old: true });
  assert.equal(files.length, 1);
});

test('Multi-fichiers : écritures concurrentes et doublons détectés', async t => {
  const { app, files, request } = await setup();
  t.after(() => app.close());
  const list = '/api/sync/pecule/files';
  const [first, second] = await Promise.all([
    request('PUT', `${list}/one.json`, { payload: { version: 0, data: { a: 1 } } }),
    request('PUT', `${list}/two.json`, { payload: { version: 0, data: { b: 2 } } })
  ]);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(files.filter(file => file.mimeType === 'application/vnd.google-apps.folder').length, 1);
  const outcomes = await Promise.all([
    request('PUT', `${list}/one.json`, { payload: { version: 1, data: { a: 2 } } }),
    request('PUT', `${list}/one.json`, { payload: { version: 1, data: { a: 3 } } })
  ]);
  assert.deepEqual(outcomes.map(result => result.statusCode).sort(), [200, 409]);
  const original = files.find(file => file.name === 'one.json');
  files.push({ ...original, id: 'duplicate' });
  assert.equal((await request('GET', list)).json().error.code, 'DUPLICATE_DRIVE_FILES');
  assert.equal((await request('PUT', `${list}/one.json`, {
    payload: { version: 2, data: {} }
  })).json().error.code, 'DUPLICATE_DRIVE_FILES');
});

test('Les dossiers en double empêchent les écritures au lieu de choisir arbitrairement', async t => {
  const { app, files, request, writes } = await setup();
  t.after(() => app.close());
  const path = '/api/sync/pecule/files/one.json';
  await request('PUT', path, { payload: { version: 0, data: {} } });
  const folder = files.find(file => file.mimeType === 'application/vnd.google-apps.folder');
  files.push({ ...folder, id: 'duplicate-folder' });
  const previousWrites = writes.length;
  const result = await request('PUT', path, { payload: { version: 1, data: {} } });
  assert.equal(result.json().error.code, 'DUPLICATE_DRIVE_FILES');
  assert.equal(writes.length, previousWrites);
});

test('Le comptage privé inclut les fichiers classiques et multiples sans écriture', async t => {
  const { app, config, files, request, writes, reads } = await setup();
  t.after(() => app.close());
  await request('PUT', '/api/sync/pecule', { payload: { version: 0, data: {} } });
  for (const name of ['one.json', 'two.json']) {
    await request('PUT', `/api/sync/pecule/files/${name}`, { payload: { version: 0, data: {} } });
  }
  await request('PUT', '/api/sync/pecule/files/other.json', {
    user: 'user2', payload: { version: 0, data: {} }
  });
  const path = '/api/home/applications/pecule/file-count';
  config.clientApps.multipleApps.delete('pecule');
  const previousWrites = writes.length;
  const previousReads = reads.length;
  const response = await request('POST', path, { origin: 'https://auth.example.org' });
  assert.deepEqual(response.json(), { appId: 'pecule', legacy: 1, named: 2, total: 3 });
  assert.equal(response.headers['cache-control'], 'no-store');
  const other = await request('POST', path, { origin: 'https://auth.example.org', user: 'user2' });
  assert.deepEqual(other.json(), { appId: 'pecule', legacy: 0, named: 1, total: 1 });
  assert.equal(writes.length, previousWrites);
  assert.equal(reads.length, previousReads);
  assert.equal((await request('POST', path)).statusCode, 403);
  assert.equal((await request('POST', path, { origin: 'https://auth.example.org', user: null })).statusCode, 401);
  assert.equal((await request('POST', '/api/home/applications/demo/file-count', {
    origin: 'https://auth.example.org'
  })).statusCode, 404);
  const folder = files.find(file => file.owner === 'user-1' && file.mimeType === 'application/vnd.google-apps.folder');
  files.push({ ...folder, id: 'duplicate-folder' });
  const duplicate = await request('POST', path, { origin: 'https://auth.example.org' });
  assert.equal(duplicate.json().error.code, 'DUPLICATE_DRIVE_FILES');
});

test('Renommage et suppression versionnés conservent les autres fichiers et comptes', async t => {
  const { app, request, writes } = await setup();
  t.after(() => app.close());
  const root = '/api/sync/pecule/files';
  const source = `${root}/one.json`;
  const target = `${root}/renamed.json`;
  await request('PUT', source, { payload: { version: 0, data: { amount: 10 } } });
  await request('PUT', `${root}/other.json`, { payload: { version: 0, data: { safe: true } } });
  await request('PUT', source, { user: 'user2', payload: { version: 0, data: { safe: true } } });

  const unchanged = await request('PATCH', source, { payload: { name: 'one.json', version: 1 } });
  assert.equal(unchanged.json().version, 1);
  const before = writes.length;
  assert.equal((await request('PATCH', source, { payload: { name: 'renamed.json', version: 0 } })).statusCode, 400);
  assert.equal((await request('PATCH', source, { payload: { name: 'renamed.json', version: 2 } })).json().error.code, 'SYNC_CONFLICT');
  assert.equal((await request('PATCH', source, { payload: { name: 'other.json', version: 1 } })).json().error.code, 'SYNC_FILENAME_EXISTS');
  assert.equal((await request('PATCH', source, { payload: { name: '../bad.json', version: 1 } })).json().error.code, 'INVALID_SYNC_FILENAME');
  assert.equal(writes.length, before);

  const renamed = await request('PATCH', source, { payload: { name: 'renamed.json', version: 1 } });
  assert.equal(renamed.statusCode, 200);
  assert.deepEqual(renamed.json(), {
    appId: 'pecule', name: 'renamed.json', version: 2,
    updatedAt: '2026-01-01T00:00:00.000Z', data: { amount: 10 }
  });
  assert.equal((await request('GET', source)).statusCode, 404);
  assert.deepEqual((await request('GET', target)).json(), renamed.json());
  assert.equal((await request('DELETE', `${target}?version=1`)).json().error.code, 'SYNC_CONFLICT');
  assert.equal((await request('DELETE', target)).statusCode, 400);
  assert.deepEqual((await request('DELETE', `${target}?version=2`)).json(), { ok: true });
  assert.equal((await request('GET', target)).statusCode, 404);
  assert.deepEqual((await request('GET', `${root}/other.json`)).json().data, { safe: true });
  assert.deepEqual((await request('GET', source, { user: 'user2' })).json().data, { safe: true });
  assert.equal((await request('DELETE', `${target}?version=2`)).statusCode, 404);
});

test('Mutations : autorisations, doublons, concurrence et erreurs Drive', async t => {
  const { app, request, files, writes, failures } = await setup();
  t.after(() => app.close());
  const source = '/api/sync/pecule/files/one.json';
  const rename = { name: 'new.json', version: 1 };
  await request('PUT', source, { payload: { version: 0, data: { safe: true } } });
  const before = writes.length;
  assert.equal((await request('PATCH', source, { user: null, payload: rename })).statusCode, 401);
  assert.equal((await request('DELETE', `${source}?version=1`, { origin: 'https://batch.example.org' })).statusCode, 403);
  assert.equal((await request('PATCH', '/api/sync/legacy/files/one.json', {
    origin: 'https://legacy.example.org', payload: rename
  })).json().error.code, 'MULTIPLE_SYNC_DISABLED');
  assert.equal((await request('DELETE', `${source}?version=1`, { user: 'user2' })).statusCode, 404);
  assert.equal(writes.length, before);

  const original = files.find(file => file.name === 'one.json');
  files.push({ ...original, id: 'duplicate' });
  assert.equal((await request('PATCH', source, { payload: rename })).json().error.code, 'DUPLICATE_DRIVE_FILES');
  files.pop();
  await request('PUT', '/api/sync/pecule/files/new.json', { payload: { version: 0, data: {} } });
  const target = files.find(file => file.name === 'new.json');
  files.push({ ...target, id: 'duplicate-target' });
  assert.equal((await request('PATCH', source, { payload: rename })).json().error.code, 'DUPLICATE_DRIVE_FILES');
  files.pop();
  await request('DELETE', '/api/sync/pecule/files/new.json?version=1');
  failures.set('PATCH', 404);
  assert.equal((await request('PATCH', source, { payload: rename })).json().error.code, 'DRIVE_FILE_REMOVED');
  failures.set('DELETE', 404);
  assert.equal((await request('DELETE', `${source}?version=1`)).json().error.code, 'DRIVE_FILE_REMOVED');
  failures.set('DELETE', 500);
  assert.equal((await request('DELETE', `${source}?version=1`)).json().error.code, 'DRIVE_API_FAILED');
  assert.deepEqual((await request('GET', source)).json().data, { safe: true });

  const outcomes = await Promise.all([
    request('PATCH', source, { payload: rename }),
    request('DELETE', `${source}?version=1`)
  ]);
  assert.deepEqual(outcomes.map(result => result.statusCode).sort(), [200, 404]);
  const after = await request('GET', '/api/sync/pecule/files/new.json');
  if (outcomes[0].statusCode === 200) assert.deepEqual(after.json().data, { safe: true });
  else assert.equal(after.statusCode, 404);
});
