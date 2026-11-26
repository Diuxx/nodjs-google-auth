import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const CURRENT_SCHEMA_VERSION = 2;

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const version = db.pragma('user_version', { simple: true });
  if (version > CURRENT_SCHEMA_VERSION) {
    db.close();
    throw new Error(`La base SQLite est plus récente que ce serveur (version ${version}).`);
  }
  if (version === 0) {
    const sql = fs.readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma('user_version = 1');
    })();
  }
  if (version < 2) {
    // Rebuilding the users table must not cascade-delete existing sessions or Drive data.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(fs.readFileSync(new URL('./migrations/002-user-identities.sql', import.meta.url), 'utf8'));
        if (db.pragma('foreign_key_check').length) throw new Error('Invalid foreign keys after identity migration.');
        db.pragma('user_version = 2');
      })();
    } catch (error) {
      db.close();
      throw error;
    }
    db.pragma('foreign_keys = ON');
  }
  return db;
}
