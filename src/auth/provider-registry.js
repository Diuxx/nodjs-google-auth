import { requireCondition } from '../lib/errors.js';
import { createGitHubAuth } from './providers/github-auth.js';
import { createFacebookAuth } from './providers/facebook-auth.js';

export function createProviderRegistry(config, google) {
  const providers = new Map([['google', google]]);
  if (config.github) providers.set('github', createGitHubAuth(config));
  if (config.facebook) providers.set('facebook', createFacebookAuth(config));
  return providers;
}

export function requireProvider(providers, name) {
  const provider = providers.get(name);
  requireCondition(provider, 404, 'UNKNOWN_PROVIDER', 'Fournisseur d’identité non disponible.');
  return provider;
}
