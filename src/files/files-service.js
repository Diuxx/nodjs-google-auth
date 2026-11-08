import { AppError, requireCondition } from '../lib/errors.js';
import { createKeyedMutex } from '../sync/keyed-mutex.js';

export function createFilesService({ drive, mutex = createKeyedMutex(), clock = () => new Date() }) {
  const nowIso = () => clock().toISOString();

  return {
    async list(userId, appId, options = {}) {
      return drive.listJsonFiles(userId, appId, options);
    },

    async create(userId, appId, filename, data) {
      requireCondition(data !== null && typeof data === 'object',
        400, 'INVALID_DATA', 'Les donn\u00e9es doivent \u00eatre un objet ou un tableau JSON.');

      const existing = await drive.findJsonFileByName(userId, appId, filename);
      if (existing) {
        throw new AppError(409, 'FILENAME_CONFLICT', 'Un fichier porte d\u00e9j\u00e0 ce nom pour cette application.');
      }

      const version = 1;
      const updatedAt = nowIso();
      const created = await drive.createJsonFile(userId, appId, filename, version, updatedAt, data);
      return { id: created.id, filename: created.filename, version, updatedAt };
    },

    async get(userId, appId, fileId) {
      const file = await drive.getJsonFile(userId, appId, fileId);
      if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'Fichier introuvable.');
      return {
        id: file.id,
        filename: file.filename,
        version: file.version,
        updatedAt: file.updatedAt,
        data: file.data
      };
    },

    async update(userId, appId, fileId, expectedVersion, data) {
      requireCondition(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0,
        400, 'INVALID_VERSION', 'Version attendue invalide.');
      requireCondition(data !== null && typeof data === 'object',
        400, 'INVALID_DATA', 'Les donn\u00e9es doivent \u00eatre un objet ou un tableau JSON.');

      const key = `${userId}:${appId}:${fileId}`;
      return mutex.run(key, async () => {
        const meta = await drive.getJsonFileMetadata(userId, appId, fileId);
        if (!meta) throw new AppError(404, 'FILE_NOT_FOUND', 'Fichier introuvable.');
        if (meta.version !== expectedVersion) {
          throw new AppError(409, 'FILE_CONFLICT',
            `Version distante ${meta.version} (version envoy\u00e9e ${expectedVersion}). Recharge avant de fusionner.`);
        }
        const version = meta.version + 1;
        const updatedAt = nowIso();
        const updated = await drive.updateJsonFile(userId, appId, fileId, version, updatedAt, data, meta.appProperties);
        if (!updated) {
          throw new AppError(409, 'FILE_CONFLICT', 'Le fichier a \u00e9t\u00e9 supprim\u00e9 ou modifi\u00e9 pendant la mise \u00e0 jour.');
        }
        return { id: updated.id, filename: updated.filename, version, updatedAt, data };
      });
    },

    async rename(userId, appId, fileId, expectedVersion, filename) {
      requireCondition(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0,
        400, 'INVALID_VERSION', 'Version attendue invalide.');

      const key = `${userId}:${appId}:${fileId}`;
      return mutex.run(key, async () => {
        const meta = await drive.getJsonFileMetadata(userId, appId, fileId);
        if (!meta) throw new AppError(404, 'FILE_NOT_FOUND', 'Fichier introuvable.');
        if (meta.version !== expectedVersion) {
          throw new AppError(409, 'FILE_CONFLICT',
            `Version distante ${meta.version} (version envoy\u00e9e ${expectedVersion}). Recharge avant de fusionner.`);
        }
        const existing = await drive.findJsonFileByName(userId, appId, filename);
        if (existing && existing.id !== fileId) {
          throw new AppError(409, 'FILENAME_CONFLICT', 'Un autre fichier de cette application porte d\u00e9j\u00e0 ce nom.');
        }
        const version = meta.version + 1;
        const updatedAt = nowIso();
        const renamed = await drive.renameJsonFile(userId, appId, fileId, filename, version, updatedAt, meta.appProperties);
        if (!renamed) {
          throw new AppError(409, 'FILE_CONFLICT', 'Le fichier a \u00e9t\u00e9 supprim\u00e9 ou modifi\u00e9 pendant le renommage.');
        }
        return { id: renamed.id, filename: renamed.filename, version, updatedAt };
      });
    },

    async delete(userId, appId, fileId, expectedVersion) {
      requireCondition(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0,
        400, 'INVALID_VERSION', 'Version attendue invalide.');

      const key = `${userId}:${appId}:${fileId}`;
      return mutex.run(key, async () => {
        const meta = await drive.getJsonFileMetadata(userId, appId, fileId);
        if (!meta) throw new AppError(404, 'FILE_NOT_FOUND', 'Fichier introuvable.');
        if (meta.version !== expectedVersion) {
          throw new AppError(409, 'FILE_CONFLICT',
            `Version distante ${meta.version} (version envoy\u00e9e ${expectedVersion}). Recharge avant de r\u00e9essayer.`);
        }
        const deleted = await drive.deleteJsonFile(userId, appId, fileId);
        if (!deleted) {
          throw new AppError(409, 'FILE_CONFLICT', 'Le fichier a \u00e9t\u00e9 supprim\u00e9 ou modifi\u00e9 concurremment.');
        }
        return { ok: true };
      });
    }
  };
}
