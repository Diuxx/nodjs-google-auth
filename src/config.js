import path from 'node:path';
import { parseClientApps, registerDemoApp } from './lib/client-apps.js';
import { createTokenCipher } from './lib/crypto.js';

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production';
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY_BASE64', 'CLIENT_APPS_JSON', 'PUBLIC_BASE_URL']) {
    if (!env[key] || env[key] === 'REMPLACER' || env[key].startsWith('REMPLACER.')) {
      throw new Error(`Configuration obligatoire manquante : ${key}`);
    }
  }
  const publicBaseUrl = new URL(env.PUBLIC_BASE_URL);
  if ((isProduction && publicBaseUrl.protocol !== 'https:') ||
      (!isProduction && !['http:', 'https:'].includes(publicBaseUrl.protocol)) ||
      publicBaseUrl.pathname !== '/' || publicBaseUrl.search || publicBaseUrl.hash ||
      publicBaseUrl.username || publicBaseUrl.password) {
    throw new Error('PUBLIC_BASE_URL doit être une origine valide, HTTPS en production.');
  }
  const clientApps = parseClientApps(env.CLIENT_APPS_JSON, isProduction);
  registerDemoApp(clientApps, publicBaseUrl.origin);
  const days = Number(env.SESSION_DAYS ?? 14);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('SESSION_DAYS doit être compris entre 1 et 90.');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT invalide.');
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEY_BASE64);
  return {
    isProduction, port, host: env.HOST || '0.0.0.0',
    publicBaseUrl: publicBaseUrl.origin,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    databasePath: path.resolve(env.DATABASE_PATH || './data/identity.sqlite'),
    sessionDurationMs: days * 24 * 60 * 60 * 1000,
    allowedEmails: new Set((env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
    clientApps, cipher
  };
}
