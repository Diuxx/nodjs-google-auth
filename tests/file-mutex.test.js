import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createFileMutex } from '../src/files/file-mutex.js';
import { AppError } from '../src/lib/errors.js';
import { createFilesService } from '../src/files/files-service.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'identity-lock-test-'));
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('Un autre processus ne peut pas entrer dans le même verrou', async t => {
  const directory = await fixture(t);
  const mutex = createFileMutex(directory);
  const moduleUrl = new URL('../src/files/file-mutex.js', import.meta.url).href;
  await mutex.run('1:todo', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import { createFileMutex } from ${JSON.stringify(moduleUrl)};
      try {
        await createFileMutex(process.argv[1]).run('1:todo', async () => {});
        process.exitCode = 1;
      } catch (error) {
        if (error.code !== 'FILE_BUSY') throw error;
        console.log(error.code);
      }
    `, directory]);
    assert.equal(stdout.trim(), 'FILE_BUSY');
    await createFileMutex(directory).run('2:todo', async () => {});
  });
  await createFileMutex(directory).run('1:todo', async () => {});
});

test('Un échec Drive ambigu conserve le verrou, même pour une nouvelle instance', async t => {
  const directory = await fixture(t);
  await assert.rejects(() => createFileMutex(directory).run('1:todo', async () => {
    throw new AppError(502, 'GOOGLE_NETWORK_FAILED', 'Test');
  }), { code: 'GOOGLE_NETWORK_FAILED' });
  await assert.rejects(() => createFileMutex(directory).run('1:todo', async () => {
    assert.fail('Aucune nouvelle opération ne doit être envoyée');
  }), { code: 'FILE_BUSY' });
});

test('Un conflit connu libère le verrou', async t => {
  const directory = await fixture(t);
  const mutex = createFileMutex(directory);
  await assert.rejects(() => mutex.run('1:todo', async () => {
    throw new AppError(409, 'FILE_CONFLICT', 'Test');
  }), { code: 'FILE_CONFLICT' });
  assert.equal(await mutex.run('1:todo', async () => 'ok'), 'ok');
});

test('Deux services avec des verrous distincts protègent le même document', async t => {
  const directory = await fixture(t);
  let version = 1;
  let writes = 0;
  let releaseWrite;
  let signalWrite;
  const writing = new Promise(resolve => { signalWrite = resolve; });
  const release = new Promise(resolve => { releaseWrite = resolve; });
  const drive = {
    getJsonFileMetadata: async () => ({ id: 'file-1', filename: 'tasks.json', version }),
    updateJsonFile: async (_user, _app, id, nextVersion) => {
      signalWrite();
      await release;
      writes += 1;
      version = nextVersion;
      return { id, filename: 'tasks.json' };
    }
  };
  const first = createFilesService({ drive, mutex: createFileMutex(directory) });
  const second = createFilesService({ drive, mutex: createFileMutex(directory) });
  const pending = first.update(1, 'todo', 'file-1', 1, {});
  await writing;
  try {
    await assert.rejects(() => second.update(1, 'todo', 'file-1', 1, {}), { code: 'FILE_BUSY' });
  } finally {
    releaseWrite();
    await pending;
  }
  await assert.rejects(() => second.update(1, 'todo', 'file-1', 1, {}), { code: 'FILE_CONFLICT' });
  await assert.rejects(() => second.rename(1, 'todo', 'file-1', 1, 'other.json'), { code: 'FILE_CONFLICT' });
  await assert.rejects(() => second.delete(1, 'todo', 'file-1', 1), { code: 'FILE_CONFLICT' });
  assert.equal(writes, 1);
  assert.equal(version, 2);
});
