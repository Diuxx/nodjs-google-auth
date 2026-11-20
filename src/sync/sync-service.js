import { AppError, requireCondition } from '../lib/errors.js';
import { createKeyedMutex } from './keyed-mutex.js';

const emptyDocument = (appId) => ({ appId, version: 0, updatedAt: null, data: null });
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/;

export function validFileName(name) {
  return typeof name === 'string' && FILE_NAME_PATTERN.test(name);
}

function requireFileName(name) {
  requireCondition(validFileName(name), 400, 'INVALID_SYNC_FILENAME',
    'Nom de fichier JSON invalide.');
}

function validateWrite(expectedVersion, data) {
  requireCondition(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0,
    400, 'INVALID_VERSION', 'Version attendue invalide.');
  requireCondition(data !== null && typeof data === 'object',
    400, 'INVALID_DATA', 'Les données doivent être un objet ou un tableau JSON.');
}

function nextDocument(appId, currentVersion, data, clock) {
  return {
    schemaVersion: 1,
    appId,
    version: currentVersion + 1,
    updatedAt: clock().toISOString(),
    data
  };
}

function requireExpectedVersion(remote, expectedVersion) {
  const currentVersion = remote?.version ?? 0;
  if (currentVersion !== expectedVersion) {
    throw new AppError(409, 'SYNC_CONFLICT', `Version distante ${currentVersion} (version envoyée ${expectedVersion}). Recharge avant de fusionner.`);
  }
  return currentVersion;
}

async function listValidatedFiles(drive, userId, appId) {
  const files = await drive.listFiles(userId, appId);
  requireCondition(files.every(validFileName), 502, 'INVALID_DRIVE_DOCUMENT',
    'Nom de fichier de synchronisation Google Drive non reconnu.');
  return files;
}

export function createSyncService({ drive, mutex = createKeyedMutex(), clock = () => new Date() }) {
  return {
    async get(userId, appId) {
      const { document } = await drive.read(userId, appId);
      return document ? {
        appId, version: document.version, updatedAt: document.updatedAt, data: document.data
      } : emptyDocument(appId);
    },
    async put(userId, appId, expectedVersion, data) {
      validateWrite(expectedVersion, data);

      return mutex.run(`${userId}:${appId}`, async () => {
        const { fileId, document: remote } = await drive.read(userId, appId);
        const currentVersion = requireExpectedVersion(remote, expectedVersion);
        const document = nextDocument(appId, currentVersion, data, clock);
        await drive.write(userId, appId, fileId, document);
        return { appId, version: document.version, updatedAt: document.updatedAt, data: document.data };
      });
    },
    async listFiles(userId, appId) {
      return { appId, files: await listValidatedFiles(drive, userId, appId) };
    },
    async countFiles(userId, appId) {
      const legacy = Number(await drive.hasLegacyFile(userId, appId));
      const named = (await listValidatedFiles(drive, userId, appId)).length;
      return { legacy, named, total: legacy + named };
    },
    async getFile(userId, appId, name) {
      requireFileName(name);
      const { document } = await drive.readFile(userId, appId, name);
      requireCondition(document, 404, 'SYNC_FILE_NOT_FOUND', 'Fichier de synchronisation introuvable.');
      return { appId, name, version: document.version, updatedAt: document.updatedAt, data: document.data };
    },
    async putFile(userId, appId, name, expectedVersion, data) {
      requireFileName(name);
      validateWrite(expectedVersion, data);
      return mutex.run(`${userId}:${appId}`, async () => {
        const { fileId, folderId, document: remote } = await drive.readFile(userId, appId, name);
        const currentVersion = requireExpectedVersion(remote, expectedVersion);
        const document = nextDocument(appId, currentVersion, data, clock);
        await drive.writeFile(userId, appId, name, folderId, fileId, document);
        return { appId, name, version: document.version, updatedAt: document.updatedAt, data: document.data };
      });
    }
  };
}
