import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors.js';

const API_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const MULTI_JSON_KIND = 'multi-json';

function driveError(status) {
  if (status === 401 || status === 403) {
    return new AppError(409, 'DRIVE_ACCESS_DENIED', 'Accès à Google Drive refusé. Reconnecte Google Drive.');
  }
  return new AppError(502, 'DRIVE_API_FAILED', 'Google Drive ne répond pas correctement.');
}

export function createGoogleDrive({ config, repo, google, http = fetch }) {
  function clientFor(userId) {
    const encrypted = repo.drive.getEncryptedToken(userId);
    if (!encrypted) throw new AppError(409, 'DRIVE_NOT_CONNECTED', 'Connecte Google Drive avant de synchroniser.');
    return google.oauthClientForDrive(config.cipher.decrypt(encrypted));
  }

  async function request(userId, method, url, { body, contentType } = {}) {
    let token;
    try {
      ({ token } = await clientFor(userId).getAccessToken());
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error?.message?.includes('invalid_grant')) {
        throw new AppError(409, 'DRIVE_RECONNECT_REQUIRED', 'Autorisation Drive expirée ou révoquée. Reconnecte Drive.');
      }
      throw new AppError(502, 'GOOGLE_TOKEN_FAILED', 'Impossible de renouveler le jeton Google Drive.');
    }
    if (!token) throw new AppError(409, 'DRIVE_RECONNECT_REQUIRED', 'Jeton Google Drive indisponible.');
    let response;
    try {
      response = await http(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(contentType ? { 'Content-Type': contentType } : {})
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new AppError(502, 'GOOGLE_NETWORK_FAILED', 'Google Drive est momentanément inaccessible.');
    }
    if (!response.ok && response.status !== 404) throw driveError(response.status);
    return response;
  }

  async function createFile(userId, metadata, content, mediaType) {
    const boundary = `nicolabz-${randomBytes(12).toString('hex')}`;
    const multipart = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n${content}\r\n`,
      `--${boundary}--\r\n`
    ].join('');
    const response = await request(userId, 'POST',
      `${UPLOAD_URL}?uploadType=multipart&fields=id,name,appProperties,modifiedTime,webViewLink`, {
        body: multipart, contentType: `multipart/related; boundary=${boundary}`
      });
    const created = await response.json();
    if (!created.id) throw new AppError(502, 'DRIVE_CREATE_FAILED',
      'Google Drive n’a pas confirmé la création du fichier.');
    return created;
  }

  async function findFile(userId, appId) {
    const name = `nicolabz.${appId}.json`;
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${name}' and 'appDataFolder' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name)',
      pageSize: '10'
    });
    const response = await request(userId, 'GET', `${API_URL}?${params}`);
    const result = await response.json();
    if (result.nextPageToken || result.files?.length > 1) {
      throw new AppError(409, 'DUPLICATE_DRIVE_FILES', 'Plusieurs fichiers de synchronisation portent le même nom. Intervention nécessaire.');
    }
    return result.files?.[0]?.id ?? null;
  }

  async function resolveFileId(userId, appId) {
    const cachedId = repo.sync.getFileId(userId, appId);
    if (cachedId) return cachedId;
    const fileId = await findFile(userId, appId);
    if (fileId) repo.sync.saveFileId(userId, appId, fileId);
    return fileId;
  }

  async function read(userId, appId) {
    let fileId = await resolveFileId(userId, appId);
    if (!fileId) return { fileId: null, document: null };
    let response = await request(userId, 'GET', `${API_URL}/${encodeURIComponent(fileId)}?alt=media`);
    if (response.status === 404) {
      repo.sync.clearFileId(userId, appId);
      fileId = await resolveFileId(userId, appId);
      if (!fileId) return { fileId: null, document: null };
      response = await request(userId, 'GET', `${API_URL}/${encodeURIComponent(fileId)}?alt=media`);
      if (response.status === 404) throw new AppError(502, 'DRIVE_FILE_NOT_FOUND', 'Fichier Drive introuvable.');
    }
    let document;
    try { document = await response.json(); } catch {
      throw new AppError(502, 'INVALID_DRIVE_DOCUMENT', 'Fichier de synchronisation Google Drive invalide.');
    }
    if (document?.schemaVersion !== 1 || document.appId !== appId ||
        !Number.isSafeInteger(document.version) || document.version < 1 ||
        typeof document.data !== 'object' || document.data === null ||
        typeof document.updatedAt !== 'string') {
      throw new AppError(502, 'INVALID_DRIVE_DOCUMENT', 'Format du fichier Google Drive non reconnu.');
    }
    return { fileId, document };
  }

  async function write(userId, appId, fileId, document) {
    const content = JSON.stringify(document);
    if (fileId) {
      const response = await request(userId, 'PATCH',
        `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`,
        { body: content, contentType: 'application/json; charset=UTF-8' }
      );
      if (response.status === 404) throw new AppError(409, 'DRIVE_FILE_REMOVED', 'Fichier Drive supprimé. Recharge les données avant de réessayer.');
      return fileId;
    }

    const created = await createFile(userId,
      { name: `nicolabz.${appId}.json`, mimeType: 'application/json', parents: ['appDataFolder'] },
      content, 'application/json; charset=UTF-8');
    repo.sync.saveFileId(userId, appId, created.id);
    return created.id;
  }

  async function createTextFile(userId, name, content) {
    // Sans parent appDataFolder, Drive crée le fichier à la racine de « Mon Drive ».
    const created = await createFile(userId, { name, mimeType: 'text/plain' },
      content, 'text/plain; charset=UTF-8');
    return {
      id: created.id,
      name: created.name || name,
      url: `https://drive.google.com/file/d/${encodeURIComponent(created.id)}/view`
    };
  }

  function parseRevision(appProperties) {
    if (!appProperties) return 0;
    const raw = Number.parseInt(appProperties.revision ?? '0', 10);
    if (!Number.isSafeInteger(raw) || raw < 0) return 0;
    return raw;
  }

  async function listJsonFiles(userId, appId, { pageSize = 20, pageToken } = {}) {
    const size = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const q = [
      "'appDataFolder' in parents",
      "trashed = false",
      "mimeType = 'application/json'",
      `appProperties has { key='appId' and value='${appId.replace(/['\\]/g, '\\$&')}' }`,
      `appProperties has { key='kind' and value='${MULTI_JSON_KIND}' }`
    ].join(' and ');
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q,
      fields: 'nextPageToken,files(id,name,appProperties,modifiedTime)',
      pageSize: String(size)
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await request(userId, 'GET', `${API_URL}?${params}`);
    const body = await response.json();
    const files = (body.files ?? []).map(file => ({
      id: file.id,
      filename: file.name,
      version: parseRevision(file.appProperties),
      updatedAt: file.appProperties?.updatedAt ?? file.modifiedTime ?? null
    }));
    return { files, nextPageToken: body.nextPageToken ?? null };
  }

  async function findJsonFileByName(userId, appId, filename) {
    const q = [
      "'appDataFolder' in parents",
      "trashed = false",
      "mimeType = 'application/json'",
      `name = '${filename.replace(/['\\]/g, '\\$&')}'`,
      `appProperties has { key='appId' and value='${appId.replace(/['\\]/g, '\\$&')}' }`,
      `appProperties has { key='kind' and value='${MULTI_JSON_KIND}' }`
    ].join(' and ');
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q,
      fields: 'files(id,name,appProperties,modifiedTime)',
      pageSize: '10'
    });
    const response = await request(userId, 'GET', `${API_URL}?${params}`);
    const body = await response.json();
    if (body.files?.length > 1) {
      throw new AppError(409, 'DUPLICATE_DRIVE_FILES', 'Plusieurs fichiers portent le même nom. Intervention nécessaire.');
    }
    const file = body.files?.[0];
    if (!file) return null;
    return {
      id: file.id,
      filename: file.name,
      version: parseRevision(file.appProperties),
      updatedAt: file.appProperties?.updatedAt ?? file.modifiedTime ?? null,
      appProperties: file.appProperties ?? {}
    };
  }

  async function getJsonFileMetadata(userId, appId, fileId) {
    const params = new URLSearchParams({
      fields: 'id,name,appProperties,modifiedTime,trashed'
    });
    const response = await request(userId, 'GET', `${API_URL}/${encodeURIComponent(fileId)}?${params}`);
    if (response.status === 404) return null;
    const file = await response.json();
    if (file.trashed) return null;
    const appProperties = file.appProperties ?? {};
    if (appProperties.appId !== appId || appProperties.kind !== MULTI_JSON_KIND) return null;
    return {
      id: file.id,
      filename: file.name,
      version: parseRevision(appProperties),
      updatedAt: appProperties.updatedAt ?? file.modifiedTime ?? null,
      appProperties
    };
  }

  async function getJsonFile(userId, appId, fileId) {
    const meta = await getJsonFileMetadata(userId, appId, fileId);
    if (!meta) return null;
    const response = await request(userId, 'GET', `${API_URL}/${encodeURIComponent(fileId)}?alt=media`);
    if (response.status === 404) return null;
    let data;
    try {
      data = await response.json();
    } catch {
      throw new AppError(502, 'INVALID_DRIVE_DOCUMENT', 'Fichier Google Drive JSON invalide.');
    }
    if (data === null || typeof data !== 'object') {
      throw new AppError(502, 'INVALID_DRIVE_DOCUMENT', 'Fichier Google Drive JSON invalide.');
    }
    return { ...meta, data };
  }

  async function createJsonFile(userId, appId, filename, version, updatedAt, data) {
    const appProperties = { appId, kind: MULTI_JSON_KIND, revision: String(version), updatedAt };
    const created = await createFile(userId,
      { name: filename, mimeType: 'application/json', parents: ['appDataFolder'], appProperties },
      JSON.stringify(data), 'application/json; charset=UTF-8');
    return {
      id: created.id,
      filename: created.name || filename,
      version,
      updatedAt,
      appProperties
    };
  }

  async function updateJsonFile(userId, appId, fileId, version, updatedAt, data, currentAppProperties = {}) {
    const appProperties = {
      ...currentAppProperties,
      appId,
      kind: MULTI_JSON_KIND,
      revision: String(version),
      updatedAt
    };
    const boundary = `nicolabz-${randomBytes(12).toString('hex')}`;
    const multipart = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ appProperties })}\r\n`,
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n`,
      `--${boundary}--\r\n`
    ].join('');
    const response = await request(userId, 'PATCH',
      `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,appProperties,modifiedTime`, {
        body: multipart,
        contentType: `multipart/related; boundary=${boundary}`
      });
    if (response.status === 404) return null;
    const updated = await response.json();
    if (!updated.id) throw new AppError(502, 'DRIVE_UPDATE_FAILED',
      'Google Drive n’a pas confirmé la mise à jour du fichier.');
    return {
      id: updated.id,
      filename: updated.name,
      version,
      updatedAt,
      appProperties
    };
  }

  async function renameJsonFile(userId, appId, fileId, filename, version, updatedAt, currentAppProperties = {}) {
    const appProperties = {
      ...currentAppProperties,
      appId,
      kind: MULTI_JSON_KIND,
      revision: String(version),
      updatedAt
    };
    const response = await request(userId, 'PATCH',
      `${API_URL}/${encodeURIComponent(fileId)}?fields=id,name,appProperties,modifiedTime`, {
        body: JSON.stringify({ name: filename, appProperties }),
        contentType: 'application/json; charset=UTF-8'
      });
    if (response.status === 404) return null;
    const updated = await response.json();
    if (!updated.id) throw new AppError(502, 'DRIVE_UPDATE_FAILED',
      'Google Drive n’a pas confirmé la mise à jour du fichier.');
    return {
      id: updated.id,
      filename: updated.name,
      version,
      updatedAt,
      appProperties
    };
  }

  async function deleteJsonFile(userId, appId, fileId) {
    const meta = await getJsonFileMetadata(userId, appId, fileId);
    if (!meta) return false;
    const response = await request(userId, 'DELETE', `${API_URL}/${encodeURIComponent(fileId)}`);
    if (response.status === 404) return false;
    if (!response.ok && response.status !== 204) throw driveError(response.status);
    return true;
  }

  return {
    read,
    write,
    createTextFile,
    listJsonFiles,
    findJsonFileByName,
    getJsonFile,
    getJsonFileMetadata,
    createJsonFile,
    updateJsonFile,
    renameJsonFile,
    deleteJsonFile
  };
}
