import { AppError, requireCondition } from './errors.js';

const APP_ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export function parseClientApps(raw, isProduction) {
  let apps;
  try {
    apps = JSON.parse(raw);
  } catch {
    throw new Error('CLIENT_APPS_JSON doit être un tableau JSON valide.');
  }
  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error('CLIENT_APPS_JSON doit déclarer au moins une application.');
  }

  const result = new Map();
  const origins = new Set();
  for (const app of apps) {
    if (!app || typeof app.id !== 'string' || !APP_ID_PATTERN.test(app.id) || result.has(app.id)) {
      throw new Error('Identifiant d’application invalide ou dupliqué.');
    }
    if (!Array.isArray(app.origins) || !app.origins.length) {
      throw new Error(`L’application ${app.id} doit déclarer des origines.`);
    }
    const allowed = new Set();
    for (const value of app.origins) {
      let url;
      try { url = new URL(value); } catch { throw new Error(`Origine invalide pour ${app.id}.`); }
      const localHttp = !isProduction && url.protocol === 'http:' && url.hostname === 'localhost';
      if ((!localHttp && url.protocol !== 'https:') || url.origin !== value || url.username || url.password) {
        throw new Error(`Origine non autorisée pour ${app.id} : ${value}`);
      }
      if (origins.has(value)) throw new Error(`L’origine ${value} appartient déjà à une application.`);
      allowed.add(value);
      origins.add(value);
    }
    result.set(app.id, allowed);
  }
  return { apps: result, origins };
}

export function validateReturnUrl(clientApps, appId, returnTo) {
  const origins = clientApps.apps.get(appId);
  requireCondition(origins, 400, 'UNKNOWN_APP', 'Application non déclarée.');
  let url;
  try { url = new URL(returnTo); } catch { throw new AppError(400, 'INVALID_RETURN_URL', 'URL de retour invalide.'); }
  requireCondition(origins.has(url.origin) && !url.username && !url.password,
    400, 'INVALID_RETURN_URL', 'URL de retour non autorisée pour cette application.');
  return url.href;
}

export function requireAppOrigin(clientApps, appId, origin) {
  requireCondition(clientApps.apps.has(appId), 404, 'UNKNOWN_APP', 'Application inconnue.');
  requireCondition(clientApps.apps.get(appId).has(origin), 403, 'ORIGIN_FORBIDDEN', 'Origine non autorisée pour cette application.');
}

/**
 * Réserve l'origine de l'API à la page de démonstration interne.
 * Aucun ajout dans CLIENT_APPS_JSON n'est nécessaire.
 */
export function registerDemoApp(clientApps, publicBaseUrl) {
  const demoAppId = 'demo';
  const origin = new URL(publicBaseUrl).origin;
  if (clientApps.apps.has(demoAppId)) {
    throw new Error('L’identifiant « demo » est réservé à la page /demo intégrée.');
  }
  if (clientApps.origins.has(origin)) {
    throw new Error('L’origine PUBLIC_BASE_URL est réservée à la page /demo intégrée.');
  }
  clientApps.apps.set(demoAppId, new Set([origin]));
  clientApps.origins.add(origin);
}
