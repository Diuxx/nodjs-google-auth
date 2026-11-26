import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { createRepositories } from '../src/db/repositories.js';

test('La déconnexion Drive conserve les index et documents de synchronisation', t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const repo = createRepositories(db);
  repo.users.upsert({ sub: 'google-sub', email: 'user@example.org' });
  repo.drive.saveEncryptedToken(1, 'encrypted-refresh');
  repo.sync.saveFileId(1, 'pecule', 'drive-file-id');

  repo.drive.disconnect(1);

  assert.equal(repo.drive.getEncryptedToken(1), undefined);
  assert.equal(repo.sync.getFileId(1, 'pecule'), 'drive-file-id');
});
