import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAuth } from '../src/auth/google-auth.js';
import { parseClientApps } from '../src/lib/client-apps.js';

const google = createGoogleAuth({
  publicBaseUrl: 'https://auth.nicolabz.dev',
  googleClientId: '12345.apps.googleusercontent.com',
  googleClientSecret: 'test-secret',
  clientApps: parseClientApps(JSON.stringify([
    { id: 'pecule', origins: ['https://pecule.nicolabz.dev'], requiresDrive: true },
    { id: 'todo', origins: ['https://todo.nicolabz.dev'] }
  ]), true)
});

const flow = (type, appId) => ({
  type, appId, nonce: 'test-nonce', codeVerifier: 'test-code-verifier'
});

test('Le consentement de demo inclut drive.file pour les fichiers visibles', () => {
  const url = new URL(google.buildAuthorizationUrl(flow('drive', 'demo'), 'test-state'));
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.file'));
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://auth.nicolabz.dev/auth/drive/callback');
});

test('Les applications habituelles conservent seulement drive.appdata', () => {
  const url = new URL(google.buildAuthorizationUrl(flow('drive', 'todo'), 'test-state'));
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.appdata'));
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive.file'));
});

test('Une application configurée demande Drive avec l’identité lors de sa connexion', () => {
  const url = new URL(google.buildAuthorizationUrl(flow('login', 'pecule'), 'test-state'));
  const scopes = url.searchParams.get('scope').split(' ');
  assert.deepEqual(scopes, [
    'openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.appdata'
  ]);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://auth.nicolabz.dev/auth/google/callback');
});

test('Une application sans requiresDrive garde une connexion sans scope Drive', () => {
  const url = new URL(google.buildAuthorizationUrl(flow('login', 'todo'), 'test-state'));
  assert.deepEqual(url.searchParams.get('scope').split(' '), ['openid', 'email', 'profile']);
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.equal(url.searchParams.has('include_granted_scopes'), false);
});

test('Un indicateur reçu avec le flux ne peut pas remplacer la politique serveur', () => {
  const url = new URL(google.buildAuthorizationUrl({
    ...flow('login', 'todo'), requiresDrive: true
  }, 'test-state'));
  assert.deepEqual(url.searchParams.get('scope').split(' '), ['openid', 'email', 'profile']);
});
