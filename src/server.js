import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createRepositories } from './db/repositories.js';
import { createGoogleAuth } from './auth/google-auth.js';
import { createAuthService } from './auth/auth-service.js';
import { createGoogleDrive } from './drive/google-drive.js';
import { createSyncService } from './sync/sync-service.js';
import { createApp } from './http/app.js';

const config = loadConfig();
const database = openDatabase(config.databasePath);
const repo = createRepositories(database);
repo.prune();
const cleanupTimer = setInterval(repo.prune, 60 * 60 * 1000);
cleanupTimer.unref();
const google = createGoogleAuth(config);
const auth = createAuthService({ config, repo, google });
const drive = createGoogleDrive({ config, repo, google });
const sync = createSyncService({ drive });
const app = await createApp({ config, repo, auth, google, sync, drive, database });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanupTimer);
  try {
    await app.close();
    database.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  database.close();
  process.exitCode = 1;
}
