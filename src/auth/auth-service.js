import { requireCondition } from '../lib/errors.js';
import { hashToken, randomToken, safeHashEqual } from '../lib/crypto.js';
import { validateReturnUrl } from '../lib/client-apps.js';
import { requireProvider } from './provider-registry.js';

const FLOW_LIFETIME_MS = 10 * 60 * 1000;

export function isAllowedUser(config, user) {
  return !config.allowedEmails.size || Boolean(user?.email && user.emailVerified &&
    config.allowedEmails.has(user.email.toLowerCase()));
}

function requireAllowedLogin(config, provider, profile, existing) {
  // Secondary identities inherit the already admitted local account, not their email.
  const candidate = existing && existing.primaryProvider !== provider ? existing : {
    email: profile.email, emailVerified: provider === 'google' || profile.emailVerified === true
  };
  requireCondition(isAllowedUser(config, candidate), 403, 'USER_NOT_ALLOWED',
    'Ce compte n’est pas autorisé. Une adresse e-mail vérifiée est nécessaire si une liste d’accès est configurée.');
}

export function createAuthService({ config, repo, google, providers = new Map([['google', google]]), clock = () => Date.now() }) {
  function completeLogin(flow, result) {
    const existing = repo.users.findByIdentity(flow.provider, result.user.sub);
    requireAllowedLogin(config, flow.provider, result.user, existing);
    const requiresDrive = config.clientApps.driveRequiredApps.has(flow.appId);
    const previous = requiresDrive && existing ? repo.drive.getEncryptedToken(existing.id) : null;
    const googleDriveLogin = requiresDrive && flow.provider === 'google';
    requireCondition(!googleDriveLogin || result.refreshToken || previous, 400, 'MISSING_REFRESH_TOKEN',
      'Google n’a pas fourni de refresh token. Révoque puis reconnecte l’application dans ton compte Google.');
    const user = repo.users.upsert(result.user, flow.provider);
    if (googleDriveLogin && result.refreshToken) {
      repo.drive.saveEncryptedToken(user.id, config.cipher.encrypt(result.refreshToken));
    }
    const sessionToken = randomToken();
    repo.sessions.create(sessionToken, user.id, clock() + config.sessionDurationMs);
    const returnUrl = new URL(flow.returnTo);
    returnUrl.searchParams.set('auth', 'connected');
    // Social login can be followed by independent Google consent for Drive-required apps.
    if (requiresDrive && flow.provider !== 'google' && !previous) {
      const consentUrl = new URL('/auth/drive/start', config.publicBaseUrl);
      consentUrl.searchParams.set('app', flow.appId);
      consentUrl.searchParams.set('return_to', returnUrl.href);
      return { sessionToken, returnUrl: consentUrl.href };
    }
    return { sessionToken, returnUrl: returnUrl.href };
  }

  function completeDrive(flow, result, currentUser) {
    requireCondition(!currentUser.googleSub || result.user.sub === currentUser.googleSub, 403, 'GOOGLE_ACCOUNT_MISMATCH',
      'Le compte Google Drive doit être le même que le compte Google associé.');
    const previous = repo.drive.getEncryptedToken(currentUser.id);
    requireCondition(result.refreshToken || previous, 400, 'MISSING_REFRESH_TOKEN',
      'Google n’a pas fourni de refresh token. Révoque puis reconnecte l’application dans ton compte Google.');
    // A social-only account may connect Google, but never take over an existing identity.
    if (!currentUser.googleSub) repo.users.linkIdentity(currentUser.id, 'google', result.user);
    if (result.refreshToken) repo.drive.saveEncryptedToken(currentUser.id, config.cipher.encrypt(result.refreshToken));
    const returnUrl = new URL(flow.returnTo);
    returnUrl.searchParams.set('drive', 'connected');
    return { sessionToken: null, returnUrl: returnUrl.href };
  }

  return {
    start(type, appId, returnTo, user = null, provider = 'google') {
      const approvedReturnTo = validateReturnUrl(config.clientApps, appId, returnTo);
      requireCondition(['login', 'drive', 'link'].includes(type) && (type !== 'drive' || provider === 'google'),
        400, 'INVALID_FLOW', 'Flux OAuth invalide.');
      const strategy = requireProvider(providers, provider);
      if (type !== 'login') requireCondition(user, 401, 'UNAUTHENTICATED', 'Connexion préalable nécessaire.');
      const state = randomToken();
      const browserToken = randomToken();
      const flow = {
        type, provider, appId, returnTo: approvedReturnTo,
        codeVerifier: randomToken(), nonce: randomToken(), userId: type === 'login' ? null : user.id,
        expiresAt: clock() + FLOW_LIFETIME_MS,
        stateHash: hashToken(state), browserHash: hashToken(browserToken)
      };
      repo.flows.create(flow);
      return { browserToken, redirectUrl: strategy.buildAuthorizationUrl(flow, state) };
    },

    async callback(type, state, code, browserToken, currentUser = null, provider = 'google') {
      const strategy = requireProvider(providers, provider);
      requireCondition(typeof state === 'string' && typeof code === 'string' && typeof browserToken === 'string',
        400, 'INVALID_CALLBACK', 'Paramètres OAuth manquants.');
      const flow = repo.flows.consume(state);
      // The provider callback is shared by sign-in and explicit linking, not Drive.
      const validType = flow && (flow.type === type || (type === 'login' && flow.type === 'link'));
      requireCondition(validType && flow.provider === provider && flow.expiresAt > clock() &&
        safeHashEqual(flow.browserHash, hashToken(browserToken)),
        400, 'INVALID_OAUTH_FLOW', 'Tentative OAuth expirée ou invalide.');
      if (flow.type !== 'login') {
        requireCondition(currentUser?.id === flow.userId, 401, 'SESSION_CHANGED', 'La session a changé pendant la connexion.');
      }
      const result = await strategy.exchangeCode(flow, code);
      requireCondition(typeof result.user?.sub === 'string' && result.user.sub.length > 0,
        401, 'INVALID_PROVIDER_ID', 'Identité du fournisseur invalide.');
      return repo.transaction(() => {
        if (flow.type === 'login') return completeLogin(flow, result);
        if (flow.type === 'drive') return completeDrive(flow, result, currentUser);
        repo.users.linkIdentity(currentUser.id, provider, result.user);
        const returnUrl = new URL(flow.returnTo);
        returnUrl.searchParams.set('identity', 'linked');
        return { sessionToken: null, returnUrl: returnUrl.href };
      });
    }
  };
}
