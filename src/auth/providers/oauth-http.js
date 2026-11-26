import { AppError, requireCondition } from '../../lib/errors.js';

export function authorizationUrl(endpoint, params) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  return url.href;
}

export async function requestOAuthJson(http, url, options = {}) {
  try {
    const response = await http(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', ...options.headers }
    });
    if (!response.ok) throw new Error('OAuth request failed');
    const result = await response.json();
    if (!result || typeof result !== 'object' || result.error) throw new Error('Invalid OAuth response');
    return result;
  } catch {
    // Provider responses and URLs can contain credentials.
    throw new AppError(502, 'PROVIDER_OAUTH_FAILED', 'Le fournisseur d’identité ne répond pas correctement.');
  }
}

export function requireAccessToken(result) {
  requireCondition(typeof result.access_token === 'string' && result.access_token.length > 0,
    502, 'INVALID_ACCESS_TOKEN', 'Jeton d’accès du fournisseur manquant.');
  return result.access_token;
}

export function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
