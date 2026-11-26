import { requireCondition } from '../../lib/errors.js';
import { sha256Base64Url } from '../../lib/crypto.js';
import { authorizationUrl, requestOAuthJson, requireAccessToken, optionalString } from './oauth-http.js';

export function createGitHubAuth(config, http = fetch) {
  const { clientId, clientSecret } = config.github;
  const redirectUri = `${config.publicBaseUrl}/auth/github/callback`;
  return {
    buildAuthorizationUrl(flow, state) {
      return authorizationUrl('https://github.com/login/oauth/authorize', {
        client_id: clientId, redirect_uri: redirectUri, scope: 'read:user user:email',
        state, code_challenge: sha256Base64Url(flow.codeVerifier), code_challenge_method: 'S256',
        prompt: 'select_account'
      });
    },
    async exchangeCode(flow, code) {
      const tokens = await requestOAuthJson(http, 'https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret, code,
          redirect_uri: redirectUri, code_verifier: flow.codeVerifier
        })
      });
      const token = requireAccessToken(tokens);
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Nicolabz-Identity' };
      const profile = await requestOAuthJson(http, 'https://api.github.com/user', { headers });
      requireCondition(Number.isSafeInteger(profile.id) && profile.id > 0, 401, 'INVALID_PROVIDER_ID', 'Identité GitHub invalide.');
      const emails = await requestOAuthJson(http, 'https://api.github.com/user/emails?per_page=100', { headers });
      requireCondition(Array.isArray(emails), 502, 'INVALID_PROVIDER_PROFILE', 'Adresses GitHub invalides.');
      const verified = emails.filter(item => item?.verified === true && optionalString(item.email));
      const email = verified.find(item => item.primary === true)?.email ?? verified[0]?.email ?? null;
      return { user: {
        sub: String(profile.id), email, emailVerified: Boolean(email),
        name: optionalString(profile.name) ?? optionalString(profile.login), picture: optionalString(profile.avatar_url)
      } };
    }
  };
}
