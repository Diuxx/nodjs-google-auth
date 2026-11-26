import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubAuth } from '../src/auth/providers/github-auth.js';
import { createFacebookAuth } from '../src/auth/providers/facebook-auth.js';
import { createHmac } from 'node:crypto';
import { sha256Base64Url } from '../src/lib/crypto.js';
import { loadConfig } from '../src/config.js';

const config = {
  publicBaseUrl: 'https://auth.example.org',
  github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
  facebook: { clientId: 'fb-id', clientSecret: 'fb-secret', apiVersion: 'v27.0' }
};
const flow = { codeVerifier: 'test-verifier', type: 'login' };

function fakeHttp(responses) {
  const calls = [];
  return {
    calls,
    http: async (url, options) => {
      calls.push({ url: new URL(url), options });
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      assert.ok(responses.length, 'Unexpected provider request');
      const response = responses.shift();
      return { ok: true, json: async () => response };
    }
  };
}

test('GitHub uses PKCE, stable numeric ID and verified private email', async () => {
  const { http, calls } = fakeHttp([
    { access_token: 'secret-token' },
    { id: 123, login: 'alice', email: 'untrusted@example.org', avatar_url: 'https://avatars.example.org/user' },
    [
      { email: 'untrusted@example.org', verified: false, primary: true },
      { email: 'verified@example.org', verified: true, primary: false }
    ]
  ]);
  const github = createGitHubAuth(config, http);
  const authorization = new URL(github.buildAuthorizationUrl(flow, 'state'));
  assert.equal(authorization.searchParams.get('code_challenge'), sha256Base64Url(flow.codeVerifier));
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('scope'), 'read:user user:email');
  assert.equal(authorization.searchParams.get('state'), 'state');
  const result = await github.exchangeCode(flow, 'auth-code');
  assert.deepEqual(result.user, {
    sub: '123', email: 'verified@example.org', emailVerified: true, name: 'alice',
    picture: 'https://avatars.example.org/user'
  });
  assert.equal(calls[0].options.body.get('code_verifier'), flow.codeVerifier);
  assert.equal(calls[0].options.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
  assert.equal(calls[1].url.pathname, '/user');
  assert.equal(calls[2].url.pathname, '/user/emails');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-token');
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('GitHub does not trust public email and rejects malformed identity', async () => {
  const valid = fakeHttp([{ access_token: 'token' }, { id: 123, email: 'unverified@example.org' }, []]);
  const result = await createGitHubAuth(config, valid.http).exchangeCode(flow, 'code');
  assert.equal(result.user.email, null);
  assert.equal(result.user.emailVerified, false);
  const invalid = fakeHttp([{ access_token: 'token' }, { login: 'alice' }]);
  await assert.rejects(() => createGitHubAuth(config, invalid.http).exchangeCode(flow, 'code'),
    { code: 'INVALID_PROVIDER_ID' });
});

test('Facebook verifies token app and subject, sends appsecret proof, and does not assert email verification', async () => {
  const { http, calls } = fakeHttp([
    { access_token: 'secret-token' },
    { data: { app_id: 'fb-id', user_id: 'fb-123', type: 'USER', is_valid: true } },
    { id: 'fb-123', email: 'alice@example.org', name: 'Alice', picture: { data: { url: 'https://picture.example.org' } } }
  ]);
  const facebook = createFacebookAuth(config, http);
  const authorization = new URL(facebook.buildAuthorizationUrl(flow, 'state'));
  assert.equal(authorization.searchParams.get('scope'), 'public_profile,email');
  assert.equal(authorization.searchParams.get('state'), 'state');
  const result = await facebook.exchangeCode(flow, 'auth-code');
  assert.equal(result.user.sub, 'fb-123');
  assert.equal(result.user.emailVerified, false);
  assert.equal(calls[0].url.searchParams.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
  assert.equal(calls[1].url.pathname, '/v27.0/debug_token');
  assert.equal(calls[2].url.searchParams.get('appsecret_proof'), createHmac('sha256', 'fb-secret').update('secret-token').digest('hex'));
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('Facebook rejects tokens from another app or a different profile', async () => {
  const invalidApp = fakeHttp([{ access_token: 'secret-token' },
    { data: { app_id: 'wrong-app', user_id: '123', type: 'USER', is_valid: true } }]);
  await assert.rejects(() => createFacebookAuth(config, invalidApp.http).exchangeCode(flow, 'code'),
    { code: 'INVALID_PROVIDER_TOKEN' });
  const invalidProfile = fakeHttp([{ access_token: 'secret-token' },
    { data: { app_id: 'fb-id', user_id: '123', type: 'USER', is_valid: true } }, { id: '456' }]);
  await assert.rejects(() => createFacebookAuth(config, invalidProfile.http).exchangeCode(flow, 'code'),
    { code: 'INVALID_PROVIDER_ID' });
});

test('OAuth failures never expose upstream errors or credentials', async () => {
  const provider = createGitHubAuth(config, async () => { throw new Error('gh-secret'); });
  await assert.rejects(() => provider.exchangeCode(flow, 'code'), error =>
    error.code === 'PROVIDER_OAUTH_FAILED' && !error.message.includes('gh-secret'));
});

test('social config is optional, pairwise and validates Facebook API version', () => {
  const env = {
    PUBLIC_BASE_URL: 'https://auth.example.org',
    GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret',
    TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 4).toString('base64'),
    CLIENT_APPS_JSON: '[{"id":"todo","origins":["https://todo.example.org"]}]'
  };
  assert.equal(loadConfig(env).github, null);
  assert.equal(loadConfig(env).facebook, null);
  assert.throws(() => loadConfig({ ...env, GITHUB_CLIENT_ID: 'only-id' }), /GITHUB_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...env, FACEBOOK_CLIENT_ID: 'id', FACEBOOK_CLIENT_SECRET: 'secret', FACEBOOK_API_VERSION: 'evil/path' }),
    /FACEBOOK_API_VERSION/);
});
