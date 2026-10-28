import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleDrive } from '../src/drive/google-drive.js';
import { createTokenCipher } from '../src/lib/crypto.js';

function setup() {
  const files = new Map();
  const fileIndex = new Map();
  const cipher = createTokenCipher(Buffer.alloc(32, 3).toString('base64'));
  const config = { cipher };
  const ids = new Map();
  const repo = {
    drive: { getEncryptedToken: userId => userId === 10 ? cipher.encrypt('fake-refresh-token') : null },
    sync: {
      getFileId: (userId, appId) => ids.get(`${userId}:${appId}`),
      saveFileId: (userId, appId, id) => ids.set(`${userId}:${appId}`, id),
      clearFileId: (userId, appId) => ids.delete(`${userId}:${appId}`)
    }
  };
  const google = { oauthClientForDrive: () => ({ getAccessToken: async () => ({ token: 'fake-access-token' }) }) };
  const http = async (url, { method, body }) => {
    const parsed = new URL(url);
    if (method === 'GET' && parsed.searchParams.has('q')) {
      const match = parsed.searchParams.get('q').match(/name = '([^']+)'/);
      const id = fileIndex.get(match[1]);
      return new Response(JSON.stringify({ files: id ? [{ id }] : [] }), { status: 200 });
    }
    if (method === 'GET') {
      const id = parsed.pathname.split('/').pop();
      if (!files.has(id)) return new Response('', { status: 404 });
      return new Response(JSON.stringify(files.get(id)), { status: 200 });
    }
    if (method === 'POST') {
      const metadata = /\r\n\r\n([^\r]+)\r\n--/.exec(body)?.[1];
      const docText = /Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{.*\})\r\n--[^\r]+--/.exec(body)?.[1];
      assert.ok(metadata && docText, 'Upload multipart conforme');
      const name = JSON.parse(metadata).name;
      const id = 'id-100';
      fileIndex.set(name, id);
      files.set(id, JSON.parse(docText));
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    if (method === 'PATCH') {
      const id = parsed.pathname.split('/').pop();
      if (!files.has(id)) return new Response('', { status: 404 });
      files.set(id, JSON.parse(body));
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    throw new Error(`Appel inattendu : ${method} ${url}`);
  };
  return { drive: createGoogleDrive({ config, repo, google, http }), files };
}

test('Crée un document dans appDataFolder et met à jour le même ID', async () => {
  const { drive, files } = setup();
  assert.deepEqual(await drive.read(10, 'todo'), { fileId: null, document: null });
  const first = { schemaVersion: 1, appId: 'todo', version: 1, updatedAt: '2026-10-28T12:00:00Z', data: { tasks: [] } };
  const createdId = await drive.write(10, 'todo', null, first);
  assert.equal(createdId, 'id-100');
  assert.deepEqual((await drive.read(10, 'todo')).document, first);
  const second = { ...first, version: 2, data: { tasks: ['test'] } };
  await drive.write(10, 'todo', createdId, second);
  assert.equal(files.size, 1);
  assert.deepEqual((await drive.read(10, 'todo')).document, second);
});

test('Refuse un accès Drive tant que le compte n’est pas connecté', async () => {
  const { drive } = setup();
  await assert.rejects(() => drive.read(11, 'todo'), { code: 'DRIVE_NOT_CONNECTED' });
});
