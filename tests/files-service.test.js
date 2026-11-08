import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilesService } from '../src/files/files-service.js';

function fakeDrive() {
  const store = new Map(); // key: `${userId}:${appId}:${fileId}`
  let nextId = 1;

  function key(userId, appId, fileId) {
    return `${userId}:${appId}:${fileId}`;
  }

  return {
    async listJsonFiles(userId, appId, { pageSize = 20, pageToken } = {}) {
      const all = Array.from(store.values()).filter(entry => entry.userId === userId && entry.appId === appId);
      const start = pageToken ? Number(pageToken) : 0;
      const end = Math.min(start + pageSize, all.length);
      const slice = all.slice(start, end).map(entry => ({
        id: entry.id,
        filename: entry.filename,
        version: entry.version,
        updatedAt: entry.updatedAt
      }));
      const nextPageToken = end < all.length ? String(end) : null;
      return { files: slice, nextPageToken };
    },

    async findJsonFileByName(userId, appId, filename) {
      const found = Array.from(store.values()).find(entry =>
        entry.userId === userId && entry.appId === appId && entry.filename === filename);
      return found
        ? {
            id: found.id,
            filename: found.filename,
            version: found.version,
            updatedAt: found.updatedAt,
            appProperties: found.appProperties
          }
        : null;
    },

    async createJsonFile(userId, appId, filename, version, updatedAt, data) {
      const id = `id-${nextId++}`;
      const appProperties = { appId, kind: 'multi-json', revision: String(version), updatedAt };
      store.set(key(userId, appId, id), { userId, appId, id, filename, version, updatedAt, data, appProperties });
      return { id, filename, version, updatedAt, appProperties };
    },

    async getJsonFile(userId, appId, fileId) {
      const entry = store.get(key(userId, appId, fileId));
      if (!entry) return null;
      return {
        id: entry.id,
        filename: entry.filename,
        version: entry.version,
        updatedAt: entry.updatedAt,
        data: entry.data
      };
    },

    async getJsonFileMetadata(userId, appId, fileId) {
      const entry = store.get(key(userId, appId, fileId));
      if (!entry) return null;
      return {
        id: entry.id,
        filename: entry.filename,
        version: entry.version,
        updatedAt: entry.updatedAt,
        appProperties: entry.appProperties
      };
    },

    async updateJsonFile(userId, appId, fileId, version, updatedAt, data, currentAppProperties) {
      const entry = store.get(key(userId, appId, fileId));
      if (!entry) return null;
      const appProperties = { ...currentAppProperties, revision: String(version), updatedAt };
      const updated = { ...entry, version, updatedAt, data, appProperties };
      store.set(key(userId, appId, fileId), updated);
      return { id: updated.id, filename: updated.filename, version, updatedAt, appProperties };
    },

    async renameJsonFile(userId, appId, fileId, filename, version, updatedAt, currentAppProperties) {
      const entry = store.get(key(userId, appId, fileId));
      if (!entry) return null;
      const appProperties = { ...currentAppProperties, revision: String(version), updatedAt };
      const updated = { ...entry, filename, version, updatedAt, appProperties };
      store.set(key(userId, appId, fileId), updated);
      return { id: updated.id, filename: updated.filename, version, updatedAt, appProperties };
    },

    async deleteJsonFile(userId, appId, fileId) {
      return store.delete(key(userId, appId, fileId));
    }
  };
}

test('Crée, lit et liste plusieurs fichiers JSON par utilisateur/application', async () => {
  const drive = fakeDrive();
  const files = createFilesService({ drive, clock: () => new Date('2026-10-28T12:00:00Z') });

  const created1 = await files.create(1, 'todo', 'tasks.json', { tasks: [] });
  const created2 = await files.create(1, 'todo', 'notes.json', { notes: ['a'] });

  assert.equal(created1.version, 1);
  assert.equal(created2.version, 1);

  const read1 = await files.get(1, 'todo', created1.id);
  assert.deepEqual(read1.data, { tasks: [] });

  const page = await files.list(1, 'todo', { pageSize: 1 });
  assert.equal(page.files.length, 1);
  assert.ok(page.nextPageToken);
  const page2 = await files.list(1, 'todo', { pageSize: 10, pageToken: page.nextPageToken });
  assert.equal(page2.files.length, 1);
});

test('Mises à jour concurrentes : un succès, un conflit de version', async () => {
  const drive = fakeDrive();
  const files = createFilesService({ drive });

  const created = await files.create(1, 'todo', 'tasks.json', { tasks: [1] });

  const results = await Promise.allSettled([
    files.update(1, 'todo', created.id, 1, { tasks: [2] }),
    files.update(1, 'todo', created.id, 1, { tasks: [3] })
  ]);

  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected.reason.code, 'FILE_CONFLICT');

  const final = await files.get(1, 'todo', created.id);
  assert.equal(final.version, 2);
});

test('Renommage avec conflit sur le nom et suppression avec version invalide', async () => {
  const drive = fakeDrive();
  const files = createFilesService({ drive });

  const a = await files.create(1, 'todo', 'a.json', { v: 1 });
  await files.create(1, 'todo', 'b.json', { v: 2 });

  await assert.rejects(() => files.rename(1, 'todo', a.id, 1, 'b.json'), { code: 'FILENAME_CONFLICT' });
  await assert.rejects(() => files.delete(1, 'todo', a.id, 0.5), { code: 'INVALID_VERSION' });
});

