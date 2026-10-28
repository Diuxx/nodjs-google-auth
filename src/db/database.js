import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const CURRENT_SCHEMA_VERSION = 1;

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
  return db;
}
