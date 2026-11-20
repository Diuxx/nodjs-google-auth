import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors.js';

const API_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const JSON_MIME = 'application/json';

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
      `${UPLOAD_URL}?uploadType=multipart&fields=id,name,webViewLink`, {
        body: multipart, contentType: `multipart/related; boundary=${boundary}`
      });
    if (!response.ok) throw driveError(response.status);
    const created = await response.json();
    if (!created.id) throw new AppError(502, 'DRIVE_CREATE_FAILED',
      'Google Drive n’a pas confirmé la création du fichier.');
    return created;
  }

  function queryValue(value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  async function listEntries(userId, query) {
    const files = [];
    const seenPages = new Set();
    let pageToken;
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder', q: query,
        fields: 'nextPageToken,files(id,name)', pageSize: '1000'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await request(userId, 'GET', `${API_URL}?${params}`);
      if (!response.ok) throw driveError(response.status);
      const result = await response.json();
      if (!Array.isArray(result.files) || result.files.some(file =>
        !file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || !file.name) ||
        (result.nextPageToken !== undefined &&
          (typeof result.nextPageToken !== 'string' || !result.nextPageToken || seenPages.has(result.nextPageToken)))) {
        throw new AppError(502, 'INVALID_DRIVE_RESPONSE', 'Réponse de liste Google Drive invalide.');
      }
      files.push(...result.files);
      pageToken = result.nextPageToken;
      if (pageToken) seenPages.add(pageToken);
    } while (pageToken);
    return files;
  }

  function uniqueEntry(files) {
    if (files.length > 1) {
      throw new AppError(409, 'DUPLICATE_DRIVE_FILES',
        'Plusieurs éléments de synchronisation portent le même nom. Intervention nécessaire.');
    }
    return files[0]?.id ?? null;
  }

  async function findAppFolder(userId, appId) {
    const name = queryValue(`nicolabz.${appId}`);
    return uniqueEntry(await listEntries(userId,
      `name = '${name}' and mimeType = '${FOLDER_MIME}' and 'appDataFolder' in parents and trashed = false`));
  }

  async function createAppFolder(userId, appId) {
    const response = await request(userId, 'POST', `${API_URL}?fields=id`, {
      body: JSON.stringify({ name: `nicolabz.${appId}`, mimeType: FOLDER_MIME, parents: ['appDataFolder'] }),
      contentType: 'application/json; charset=UTF-8'
    });
    if (!response.ok) throw driveError(response.status);
    const folder = await response.json();
    if (typeof folder.id !== 'string' || !folder.id) {
      throw new AppError(502, 'DRIVE_CREATE_FAILED', 'Google Drive n’a pas confirmé la création du dossier.');
    }
    return folder.id;
  }

  async function listFolderFiles(userId, folderId, name = null) {
    const parent = queryValue(folderId);
    const nameFilter = name === null ? '' : ` and name = '${queryValue(name)}'`;
    return listEntries(userId,
      `'${parent}' in parents and mimeType = '${JSON_MIME}' and trashed = false${nameFilter}`);
  }

  async function readDocument(userId, appId, fileId) {
    const response = await request(userId, 'GET', `${API_URL}/${encodeURIComponent(fileId)}?alt=media`);
    if (response.status === 404) return null;
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
    return document;
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

  async function hasLegacyFile(userId, appId) {
    const name = queryValue(`nicolabz.${appId}.json`);
    const files = await listEntries(userId,
      `name = '${name}' and mimeType = '${JSON_MIME}' and 'appDataFolder' in parents and trashed = false`);
    return Boolean(uniqueEntry(files));
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
    let document = await readDocument(userId, appId, fileId);
    if (!document) {
      repo.sync.clearFileId(userId, appId);
      fileId = await resolveFileId(userId, appId);
      if (!fileId) return { fileId: null, document: null };
      document = await readDocument(userId, appId, fileId);
      if (!document) throw new AppError(502, 'DRIVE_FILE_NOT_FOUND', 'Fichier Drive introuvable.');
    }
    return { fileId, document };
  }

  async function listFiles(userId, appId) {
    const folderId = await findAppFolder(userId, appId);
    if (!folderId) return [];
    const files = await listFolderFiles(userId, folderId);
    const names = new Set();
    for (const file of files) {
      if (names.has(file.name)) {
        throw new AppError(409, 'DUPLICATE_DRIVE_FILES',
          'Plusieurs fichiers de synchronisation portent le même nom. Intervention nécessaire.');
      }
      names.add(file.name);
    }
    return [...names].sort();
  }

  async function readFile(userId, appId, name) {
    const folderId = await findAppFolder(userId, appId);
    if (!folderId) return { folderId: null, fileId: null, document: null };
    const fileId = uniqueEntry(await listFolderFiles(userId, folderId, name));
    if (!fileId) return { folderId, fileId: null, document: null };
    const document = await readDocument(userId, appId, fileId);
    if (!document) throw new AppError(409, 'DRIVE_FILE_REMOVED', 'Fichier Drive supprimé. Recharge les données avant de réessayer.');
    return { folderId, fileId, document };
  }

  async function writeFile(userId, appId, name, folderId, fileId, document) {
    const content = JSON.stringify(document);
    if (fileId) {
      const response = await request(userId, 'PATCH',
        `${UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`,
        { body: content, contentType: 'application/json; charset=UTF-8' });
      if (response.status === 404) throw new AppError(409, 'DRIVE_FILE_REMOVED', 'Fichier Drive supprimé. Recharge les données avant de réessayer.');
      return;
    }
    const parentId = folderId || await createAppFolder(userId, appId);
    await createFile(userId,
      { name, mimeType: JSON_MIME, parents: [parentId] }, content, 'application/json; charset=UTF-8');
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

  return { read, write, listFiles, readFile, writeFile, hasLegacyFile, createTextFile };
}
