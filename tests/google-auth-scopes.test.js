import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAuth } from '../src/auth/google-auth.js';

const google = createGoogleAuth({
  publicBaseUrl: 'https://auth.nicolabz.dev',
  googleClientId: '12345.apps.googleusercontent.com',
  googleClientSecret: 'test-secret'
});

const flow = appId => ({
  type: 'drive', appId, nonce: 'test-nonce', codeVerifier: 'test-code-verifier'
});

test('Le consentement de demo inclut drive.file pour les fichiers visibles', () => {
  const url = new URL(google.buildAuthorizationUrl(flow('demo'), 'test-state'));
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.file'));
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://auth.nicolabz.dev/auth/drive/callback');
});

test('Les applications habituelles conservent seulement drive.appdata', () => {
  const url = new URL(google.buildAuthorizationUrl(flow('todo'), 'test-state'));
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive.file'));
});
