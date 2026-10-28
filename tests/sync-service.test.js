import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncService } from '../src/sync/sync-service.js';

function fakeDrive() {
  const documents = new Map();
  return {
    async read(userId, appId) {
      const key = `${userId}:${appId}`;
      return { fileId: documents.has(key) ? key : null, document: documents.get(key) ?? null };
    },
    async write(userId, appId, fileId, document) {
      documents.set(`${userId}:${appId}`, document);
      return fileId || `${userId}:${appId}`;
    }
  };
}

test('Première synchronisation et lecture isolée par utilisateur/application', async () => {
  const sync = createSyncService({ drive: fakeDrive(), clock: () => new Date('2026-10-28T12:00:00Z') });
  assert.deepEqual(await sync.get(1, 'todo'), { appId: 'todo', version: 0, updatedAt: null, data: null });
  const result = await sync.put(1, 'todo', 0, { tasks: ['réviser'] });
  assert.equal(result.version, 1);
  assert.equal((await sync.get(1, 'todo')).data.tasks[0], 'réviser');
  assert.equal((await sync.get(2, 'todo')).version, 0);
  assert.equal((await sync.get(1, 'budget')).version, 0);
});

test('Conflit de versions : aucune écriture perdue', async () => {
  const sync = createSyncService({ drive: fakeDrive() });
  await sync.put(1, 'todo', 0, { tasks: [1] });
  const results = await Promise.allSettled([
    sync.put(1, 'todo', 1, { tasks: [2] }),
    sync.put(1, 'todo', 1, { tasks: [3] })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'SYNC_CONFLICT');
  assert.equal((await sync.get(1, 'todo')).version, 2);
});

test('N’accepte pas un JSON primitif ou une version fractionnaire', async () => {
  const sync = createSyncService({ drive: fakeDrive() });
  await assert.rejects(() => sync.put(1, 'todo', 0, 'texte'), { code: 'INVALID_DATA' });
  await assert.rejects(() => sync.put(1, 'todo', 0.5, {}), { code: 'INVALID_VERSION' });
});
