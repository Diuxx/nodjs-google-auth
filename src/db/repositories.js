import { hashToken } from '../lib/crypto.js';

export function createRepositories(db, clock = () => Date.now()) {
  const now = () => clock();
  return {
    users: {
      upsert(googleUser) {
        db.prepare(`INSERT INTO users (google_sub, email, display_name, picture_url, created_at, updated_at)
          VALUES (@sub, @email, @name, @picture, @now, @now)
          ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,
            display_name=excluded.display_name, picture_url=excluded.picture_url,
            updated_at=excluded.updated_at`).run({ ...googleUser, now: now() });
        return db.prepare('SELECT id, google_sub AS googleSub, email, display_name AS name, picture_url AS picture FROM users WHERE google_sub = ?').get(googleUser.sub);
      },
      findById(userId) {
        return db.prepare('SELECT id, google_sub AS googleSub, email, display_name AS name, picture_url AS picture FROM users WHERE id = ?').get(userId);
      }
    },
    sessions: {
      create(token, userId, expiresAt) {
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expiresAt);
      },
      find(token) {
        if (!token || typeof token !== 'string') return undefined;
        return db.prepare(`SELECT u.id, u.google_sub AS googleSub, u.email, u.display_name AS name, u.picture_url AS picture
          FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), now());
      },
      remove(token) {
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      }
    },
    flows: {
      create(flow) {
        db.prepare(`INSERT INTO oauth_flows
          (state_hash, browser_hash, flow_type, app_id, return_to, code_verifier, nonce, user_id, expires_at)
          VALUES (@stateHash, @browserHash, @type, @appId, @returnTo, @codeVerifier, @nonce, @userId, @expiresAt)`).run(flow);
      },
      consume(state) {
        if (!state || typeof state !== 'string') return undefined;
        return db.prepare(`DELETE FROM oauth_flows WHERE state_hash=? RETURNING
          browser_hash AS browserHash, flow_type AS type, app_id AS appId, return_to AS returnTo,
          code_verifier AS codeVerifier, nonce, user_id AS userId, expires_at AS expiresAt`).get(hashToken(state));
      }
    },
    drive: {
      getEncryptedToken(userId) {
        return db.prepare('SELECT refresh_token_encrypted AS value FROM drive_credentials WHERE user_id=?').get(userId)?.value;
      },
      saveEncryptedToken(userId, encrypted) {
        db.prepare(`INSERT INTO drive_credentials(user_id,refresh_token_encrypted,updated_at) VALUES(?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET refresh_token_encrypted=excluded.refresh_token_encrypted,
          updated_at=excluded.updated_at`).run(userId, encrypted, now());
      },
      disconnect(userId) {
        db.prepare('DELETE FROM drive_credentials WHERE user_id=?').run(userId);
      }
    },
    sync: {
      getFileId(userId, appId) {
        return db.prepare('SELECT drive_file_id AS fileId FROM sync_files WHERE user_id=? AND app_id=?').get(userId, appId)?.fileId;
      },
      saveFileId(userId, appId, fileId) {
        db.prepare(`INSERT INTO sync_files(user_id,app_id,drive_file_id) VALUES (?,?,?)
          ON CONFLICT(user_id,app_id) DO UPDATE SET drive_file_id=excluded.drive_file_id`).run(userId, appId, fileId);
      },
      clearFileId(userId, appId) {
        db.prepare('DELETE FROM sync_files WHERE user_id=? AND app_id=?').run(userId, appId);
      }
    },
    prune() {
      db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
      db.prepare('DELETE FROM oauth_flows WHERE expires_at<?').run(now());
    }
  };
}
