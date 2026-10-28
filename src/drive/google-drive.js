import { randomBytes } from 'node:crypto';
import { AppError } from '../lib/errors.js';

const API_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

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

  return { read, write, createTextFile };
}
