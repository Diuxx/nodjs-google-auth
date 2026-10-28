import { AppError, requireCondition } from '../lib/errors.js';
import { createKeyedMutex } from './keyed-mutex.js';

const emptyDocument = (appId) => ({ appId, version: 0, updatedAt: null, data: null });

export function createSyncService({ drive, mutex = createKeyedMutex(), clock = () => new Date() }) {
  return {
    async get(userId, appId) {
      const { document } = await drive.read(userId, appId);
      return document ? {
        appId, version: document.version, updatedAt: document.updatedAt, data: document.data
      } : emptyDocument(appId);
    },
    async put(userId, appId, expectedVersion, data) {
      requireCondition(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0,
        400, 'INVALID_VERSION', 'Version attendue invalide.');
      requireCondition(data !== null && typeof data === 'object',
        400, 'INVALID_DATA', 'Les données doivent être un objet ou un tableau JSON.');

      return mutex.run(`${userId}:${appId}`, async () => {
        const { fileId, document: remote } = await drive.read(userId, appId);
        const currentVersion = remote?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          throw new AppError(409, 'SYNC_CONFLICT', `Version distante ${currentVersion} (version envoyée ${expectedVersion}). Recharge avant de fusionner.`);
        }
        const document = {
          schemaVersion: 1,
          appId,
          version: currentVersion + 1,
          updatedAt: clock().toISOString(),
          data
        };
        await drive.write(userId, appId, fileId, document);
        return { appId, version: document.version, updatedAt: document.updatedAt, data: document.data };
      });
    }
  };
}
