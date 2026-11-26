import { createHmac } from 'node:crypto';
import { requireCondition } from '../../lib/errors.js';
import { authorizationUrl, requestOAuthJson, requireAccessToken, optionalString } from './oauth-http.js';

export function createFacebookAuth(config, http = fetch) {
  const { clientId, clientSecret, apiVersion } = config.facebook;
  const redirectUri = `${config.publicBaseUrl}/auth/facebook/callback`;
  const graph = `https://graph.facebook.com/${apiVersion}`;
  return {
    buildAuthorizationUrl(_flow, state) {
      return authorizationUrl(`https://www.facebook.com/${apiVersion}/dialog/oauth`, {
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
        scope: 'public_profile,email', state
      });
    },
    async exchangeCode(_flow, code) {
      const tokens = await requestOAuthJson(http, authorizationUrl(`${graph}/oauth/access_token`, {
        client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code
      }));
      const token = requireAccessToken(tokens);
      const { data } = await requestOAuthJson(http, authorizationUrl(`${graph}/debug_token`, {
        input_token: token
      }), { headers: { Authorization: `Bearer ${clientId}|${clientSecret}` } });
      requireCondition(data?.is_valid === true && String(data.app_id) === clientId &&
        data.type === 'USER' && typeof data.user_id === 'string' && data.user_id,
        401, 'INVALID_PROVIDER_TOKEN', 'Jeton Facebook invalide ou destiné à une autre application.');
      const proof = createHmac('sha256', clientSecret).update(token).digest('hex');
      const profile = await requestOAuthJson(http, authorizationUrl(`${graph}/me`, {
        fields: 'id,name,email,picture', appsecret_proof: proof
      }), { headers: { Authorization: `Bearer ${token}` } });
      requireCondition(profile.id === data.user_id, 401, 'INVALID_PROVIDER_ID', 'Identité Facebook invalide.');
      return { user: {
        sub: profile.id, email: optionalString(profile.email),
        // Graph does not supply an OIDC-style verified-email claim.
        emailVerified: false, name: optionalString(profile.name), picture: optionalString(profile.picture?.data?.url)
      } };
    }
  };
}
