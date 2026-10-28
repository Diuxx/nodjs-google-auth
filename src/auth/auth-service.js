import { AppError, requireCondition } from '../lib/errors.js';
import { hashToken, randomToken, safeHashEqual } from '../lib/crypto.js';
import { validateReturnUrl } from '../lib/client-apps.js';

const FLOW_LIFETIME_MS = 10 * 60 * 1000;

export function createAuthService({ config, repo, google, clock = () => Date.now() }) {
  return {
    start(type, appId, returnTo, user = null) {
      const approvedReturnTo = validateReturnUrl(config.clientApps, appId, returnTo);
      requireCondition(type === 'login' || type === 'drive', 400, 'INVALID_FLOW', 'Flux OAuth invalide.');
      if (type === 'drive') requireCondition(user, 401, 'UNAUTHENTICATED', 'Connexion préalable nécessaire.');
      const state = randomToken();
      const browserToken = randomToken();
      const flow = {
        type, appId, returnTo: approvedReturnTo,
        codeVerifier: randomToken(), nonce: randomToken(), userId: user?.id ?? null,
        expiresAt: clock() + FLOW_LIFETIME_MS,
        stateHash: hashToken(state), browserHash: hashToken(browserToken)
      };
      repo.flows.create(flow);
      return { browserToken, redirectUrl: google.buildAuthorizationUrl(flow, state) };
    },
    async callback(type, state, code, browserToken, currentUser = null) {
      requireCondition(typeof state === 'string' && typeof code === 'string' && typeof browserToken === 'string',
        400, 'INVALID_CALLBACK', 'Paramètres OAuth manquants.');
      const flow = repo.flows.consume(state);
      requireCondition(flow && flow.type === type && flow.expiresAt > clock() &&
        safeHashEqual(flow.browserHash, hashToken(browserToken)),
        400, 'INVALID_OAUTH_FLOW', 'Tentative OAuth expirée ou invalide.');
      if (type === 'drive') {
        requireCondition(currentUser?.id === flow.userId, 401, 'SESSION_CHANGED', 'La session a changé pendant la connexion Drive.');
      }
      const result = await google.exchangeCode(flow, code);
      let sessionToken = null;
      if (type === 'login') {
        if (config.allowedEmails.size && !config.allowedEmails.has(result.user.email.toLowerCase())) {
          throw new AppError(403, 'USER_NOT_ALLOWED', 'Ce compte Google n’est pas autorisé.');
        }
        const user = repo.users.upsert(result.user);
        sessionToken = randomToken();
        repo.sessions.create(sessionToken, user.id, clock() + config.sessionDurationMs);
      } else {
        requireCondition(result.user.sub === currentUser.googleSub, 403, 'GOOGLE_ACCOUNT_MISMATCH',
          'Le compte Google Drive doit être le même que le compte connecté.');
        const previous = repo.drive.getEncryptedToken(currentUser.id);
        requireCondition(result.refreshToken || previous, 400, 'MISSING_REFRESH_TOKEN',
          'Google n’a pas fourni de refresh token. Révoque puis reconnecte l’application dans ton compte Google.');
        if (result.refreshToken) {
          repo.drive.saveEncryptedToken(currentUser.id, config.cipher.encrypt(result.refreshToken));
        }
      }
      const returnUrl = new URL(flow.returnTo);
      returnUrl.searchParams.set(type === 'login' ? 'auth' : 'drive', 'connected');
      return { sessionToken, returnUrl: returnUrl.href };
    }
  };
}
