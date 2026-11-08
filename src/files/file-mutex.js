import { createHash } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../lib/errors.js';
import { createKeyedMutex } from '../sync/keyed-mutex.js';

export function createFileMutex(directory) {
  const local = createKeyedMutex();
  return {
    run(key, operation) {
      return local.run(key, async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const lockPath = path.join(directory, createHash('sha256').update(key).digest('hex'));
        try {
          await mkdir(lockPath, { mode: 0o700 });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          throw new AppError(409, 'FILE_BUSY', 'Une opération est en cours ou nécessite une vérification serveur. Réessaie plus tard.');
        }
        let uncertain = false;
        try {
          return await operation();
        } catch (error) {
          uncertain = !(error instanceof AppError && error.statusCode < 500);
          throw error;
        } finally {
          if (!uncertain) await rmdir(lockPath);
        }
      });
    }
  };
}
