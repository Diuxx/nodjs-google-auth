import googleAuth from 'google-auth-library';
import { AppError, requireCondition } from '../lib/errors.js';
import { sha256Base64Url } from '../lib/crypto.js';

const { OAuth2Client } = googleAuth;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export function createGoogleAuth(config) {
  const clientFor = (type) => new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    `${config.publicBaseUrl}/auth/${type === 'login' ? 'google' : 'drive'}/callback`
  );

  return {
    buildAuthorizationUrl(flow, state) {
      const client = clientFor(flow.type);
      return client.generateAuthUrl({
        scope: flow.type === 'login' ? ['openid', 'email', 'profile'] : ['openid', 'email', DRIVE_SCOPE],
        state,
        nonce: flow.nonce,
        code_challenge: sha256Base64Url(flow.codeVerifier),
        code_challenge_method: 'S256',
        access_type: flow.type === 'drive' ? 'offline' : 'online',
        ...(flow.type === 'drive' ? { prompt: 'consent' } : {})
      });
    },
    async exchangeCode(flow, code) {
      let tokens;
      const client = clientFor(flow.type);
      try {
        ({ tokens } = await client.getToken({ code, codeVerifier: flow.codeVerifier }));
      } catch {
        throw new AppError(502, 'GOOGLE_OAUTH_FAILED', 'Échange du code avec Google impossible.');
      }
      requireCondition(tokens.id_token, 400, 'MISSING_ID_TOKEN', 'Google n’a pas fourni de preuve d’identité.');
      let payload;
      try {
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
        payload = ticket.getPayload();
      } catch {
        throw new AppError(401, 'INVALID_ID_TOKEN', 'Jeton d’identité Google invalide.');
      }
      requireCondition(payload?.nonce === flow.nonce, 401, 'INVALID_NONCE', 'Nonce OpenID invalide.');
      requireCondition(payload?.sub && payload.email && (payload.email_verified === true || payload.email_verified === 'true'),
        403, 'UNVERIFIED_EMAIL', 'Compte Google avec e-mail vérifié requis.');
      if (flow.type === 'drive') {
        const scopes = (tokens.scope || '').split(' ');
        requireCondition(scopes.includes(DRIVE_SCOPE), 403, 'DRIVE_PERMISSION_MISSING', 'Autorisation Google Drive manquante.');
      }
      return {
        user: { sub: payload.sub, email: payload.email, name: payload.name ?? null, picture: payload.picture ?? null },
        refreshToken: tokens.refresh_token || null
      };
    },
    oauthClientForDrive(refreshToken) {
      const client = clientFor('drive');
      client.setCredentials({ refresh_token: refreshToken });
      return client;
    },
    async revoke(refreshToken) {
      const client = clientFor('drive');
      await client.revokeToken(refreshToken);
    }
  };
}
