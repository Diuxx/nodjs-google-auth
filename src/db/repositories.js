import { requireCondition } from '../lib/errors.js';
import { hashToken } from '../lib/crypto.js';

export function createRepositories(db, clock = () => Date.now()) {
  const now = () => clock();
  const userColumns = 'u.id, g.provider_user_id AS googleSub, u.email, u.email_verified AS emailVerified, u.primary_provider AS primaryProvider, u.display_name AS name, u.picture_url AS picture';
  const googleJoin = "LEFT JOIN user_identities g ON g.user_id=u.id AND g.provider='google'";
  const findById = id => db.prepare(`SELECT ${userColumns} FROM users u ${googleJoin} WHERE u.id=?`).get(id);
  const findByIdentity = (provider, sub) => db.prepare(`SELECT ${userColumns} FROM users u
    JOIN user_identities i ON i.user_id=u.id ${googleJoin} WHERE i.provider=? AND i.provider_user_id=?`).get(provider, sub);
  const linkIdentity = db.transaction((userId, provider, profile) => {
    const owner = findByIdentity(provider, profile.sub);
    requireCondition(!owner || owner.id === userId, 409, 'IDENTITY_ALREADY_LINKED',
      'Cette identité est déjà associée à un autre compte.');
    const existing = db.prepare('SELECT provider_user_id FROM user_identities WHERE user_id=? AND provider=?').get(userId, provider);
    requireCondition(!existing || existing.provider_user_id === profile.sub, 409, 'PROVIDER_ALREADY_LINKED',
      'Un autre compte de ce fournisseur est déjà associé.');
    if (!existing) {
      db.prepare('INSERT INTO user_identities VALUES (?, ?, ?, ?)').run(userId, provider, profile.sub, now());
    }
  });
  const upsert = db.transaction((profile, provider = 'google') => {
    const existing = findByIdentity(provider, profile.sub);
    const fields = {
      email: profile.email ?? null, verified: Number(provider === 'google' || profile.emailVerified === true),
      name: profile.name ?? null, picture: profile.picture ?? null, now: now(), provider
    };
    if (existing) {
      if (existing.primaryProvider === provider) {
        db.prepare(`UPDATE users SET email=@email, email_verified=@verified, display_name=@name,
          picture_url=@picture, updated_at=@now WHERE id=@id`).run({ ...fields, id: existing.id });
      }
      return findById(existing.id);
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (email,email_verified,primary_provider,display_name,picture_url,created_at,updated_at)
      VALUES (@email,@verified,@provider,@name,@picture,@now,@now)`).run(fields);
    linkIdentity(lastInsertRowid, provider, profile);
    return findById(lastInsertRowid);
  });
  return {
    transaction: work => db.transaction(work)(),
    statistics: {
      overview() {
        return db.prepare(`SELECT
          (SELECT COUNT(*) FROM users) AS totalUsers,
          (SELECT COUNT(DISTINCT user_id) FROM sessions WHERE expires_at > @now) AS activeUsers,
          (SELECT COUNT(*) FROM drive_credentials) AS connectedDrives`).get({ now: now() });
      }
    },
    users: {
      upsert,
      findById,
      findByIdentity,
      findByGoogleSub: sub => findByIdentity('google', sub),
      linkIdentity,
      listProviders: userId => db.prepare('SELECT provider FROM user_identities WHERE user_id=? ORDER BY provider').all(userId).map(row => row.provider)
    },
    sessions: {
      create(token, userId, expiresAt) {
        db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expiresAt);
      },
      find(token) {
        if (!token || typeof token !== 'string') return undefined;
        return db.prepare(`SELECT ${userColumns}
          FROM sessions s JOIN users u ON u.id=s.user_id ${googleJoin} WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), now());
      },
      remove(token) {
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      }
    },
    flows: {
      create(flow) {
        db.prepare(`INSERT INTO oauth_flows
          (state_hash, browser_hash, flow_type, provider, app_id, return_to, code_verifier, nonce, user_id, expires_at)
          VALUES (@stateHash, @browserHash, @type, @provider, @appId, @returnTo, @codeVerifier, @nonce, @userId, @expiresAt)`).run(flow);
      },
      consume(state) {
        if (!state || typeof state !== 'string') return undefined;
        return db.prepare(`DELETE FROM oauth_flows WHERE state_hash=? RETURNING
          browser_hash AS browserHash, flow_type AS type, provider, app_id AS appId, return_to AS returnTo,
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
