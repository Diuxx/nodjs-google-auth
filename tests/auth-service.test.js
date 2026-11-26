import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth/auth-service.js';
import { createTokenCipher, hashToken } from '../src/lib/crypto.js';
import { parseClientApps } from '../src/lib/client-apps.js';

function fakeAuth({
  clientAppsJson = '[{"id":"todo","origins":["https://todo.example.org"]}]',
  loginRefreshToken = null,
  existingRefreshToken = null
} = {}) {
  const flows = new Map();
  let nextSession;
  let savedRefreshToken = existingRefreshToken
    ? createTokenCipher(Buffer.alloc(32, 2).toString('base64')).encrypt(existingRefreshToken)
    : null;
  const config = {
    clientApps: parseClientApps(clientAppsJson, true),
    sessionDurationMs: 86400000,
    allowedEmails: new Set(),
    cipher: createTokenCipher(Buffer.alloc(32, 2).toString('base64'))
  };
  const repo = {
    transaction: work => work(),
    flows: {
      create(flow) { flows.set(flow.stateHash, flow); },
      consume(state) {
        const key = hashToken(state);
        const flow = flows.get(key);
        flows.delete(key);
        return flow ? { ...flow, browserHash: flow.browserHash, userId: flow.userId, expiresAt: flow.expiresAt } : null;
      }
    },
    users: {
      findByIdentity: () => existingRefreshToken ? { id: 1, primaryProvider: 'google' } : null,
      upsert: user => ({ id: 1, googleSub: user.sub, ...user })
    },
    sessions: { create(token) { nextSession = token; } },
    drive: {
      getEncryptedToken: () => savedRefreshToken,
      saveEncryptedToken(id, value) { savedRefreshToken = value; }
    }
  };
  const google = {
    buildAuthorizationUrl: (flow, state) => `https://google.example/?state=${state}`,
    exchangeCode: async flow => ({
      user: { sub: 'google-user', email: 'user@example.org', name: 'User', picture: null },
      refreshToken: flow.type === 'drive' ? 'secret-refresh' : loginRefreshToken
    })
  };
  const auth = createAuthService({ config, repo, google, clock: () => 1000 });
  return { auth, config, repo, google, getSession: () => nextSession, getRefresh: () => savedRefreshToken };
}

test('Flux connexion : state et navigateur liés, session à usage unique', async () => {
  const { auth, getSession } = fakeAuth();
  const start = auth.start('login', 'todo', 'https://todo.example.org/home');
  const state = new URL(start.redirectUrl).searchParams.get('state');
  await assert.rejects(() => auth.callback('login', state, 'code', 'cookie-incorrect'), { code: 'INVALID_OAUTH_FLOW' });
  const goodStart = auth.start('login', 'todo', 'https://todo.example.org/home');
  const goodState = new URL(goodStart.redirectUrl).searchParams.get('state');
  const result = await auth.callback('login', goodState, 'code', goodStart.browserToken);
  assert.equal(result.sessionToken, getSession());
  assert.equal(new URL(result.returnUrl).searchParams.get('auth'), 'connected');
  await assert.rejects(() => auth.callback('login', goodState, 'code', goodStart.browserToken), { code: 'INVALID_OAUTH_FLOW' });
});

test('Drive exige une session, puis chiffre le refresh token', async () => {
  const { auth, config, getRefresh } = fakeAuth();
  assert.throws(() => auth.start('drive', 'todo', 'https://todo.example.org/', null), { code: 'UNAUTHENTICATED' });
  const currentUser = { id: 1, googleSub: 'google-user' };
  const start = auth.start('drive', 'todo', 'https://todo.example.org/', currentUser);
  const state = new URL(start.redirectUrl).searchParams.get('state');
  await auth.callback('drive', state, 'code', start.browserToken, currentUser);
  assert.equal(config.cipher.decrypt(getRefresh()), 'secret-refresh');
});

test('Connexion Pécule enregistre le refresh token Drive chiffré', async () => {
  const { auth, config, getRefresh } = fakeAuth({
    clientAppsJson: '[{"id":"pecule","origins":["https://pecule.example.org"],"requiresDrive":true}]',
    loginRefreshToken: 'login-drive-refresh'
  });
  const start = auth.start('login', 'pecule', 'https://pecule.example.org/');
  const state = new URL(start.redirectUrl).searchParams.get('state');
  const result = await auth.callback('login', state, 'code', start.browserToken);
  assert.ok(result.sessionToken);
  assert.equal(config.cipher.decrypt(getRefresh()), 'login-drive-refresh');
});

test('Une ancienne connexion sans Drive ignore un refresh token non demandé', async () => {
  const { auth, getRefresh } = fakeAuth({ loginRefreshToken: 'unrequested-refresh' });
  const start = auth.start('login', 'todo', 'https://todo.example.org/');
  const state = new URL(start.redirectUrl).searchParams.get('state');
  await auth.callback('login', state, 'code', start.browserToken);
  assert.equal(getRefresh(), null);
});

test('Connexion exigeant Drive refuse l’absence de refresh token et conserve un jeton existant', async () => {
  const clientAppsJson = '[{"id":"pecule","origins":["https://pecule.example.org"],"requiresDrive":true}]';
  const withoutToken = fakeAuth({ clientAppsJson });
  const rejectedStart = withoutToken.auth.start('login', 'pecule', 'https://pecule.example.org/');
  const rejectedState = new URL(rejectedStart.redirectUrl).searchParams.get('state');
  await assert.rejects(
    () => withoutToken.auth.callback('login', rejectedState, 'code', rejectedStart.browserToken),
    { code: 'MISSING_REFRESH_TOKEN' }
  );
  assert.equal(withoutToken.getSession(), undefined);
  assert.equal(withoutToken.getRefresh(), null);

  const withToken = fakeAuth({ clientAppsJson, existingRefreshToken: 'previous-refresh' });
  const acceptedStart = withToken.auth.start('login', 'pecule', 'https://pecule.example.org/');
  const acceptedState = new URL(acceptedStart.redirectUrl).searchParams.get('state');
  await withToken.auth.callback('login', acceptedState, 'code', acceptedStart.browserToken);
  assert.equal(withToken.config.cipher.decrypt(withToken.getRefresh()), 'previous-refresh');
});

test('Réautorisation Drive refuse un autre compte Google', async () => {
  const { auth, google } = fakeAuth();
  google.exchangeCode = async () => ({
    user: { sub: 'different-google-user', email: 'other@example.org' },
    refreshToken: 'secret-refresh'
  });
  const currentUser = { id: 1, googleSub: 'google-user' };
  const start = auth.start('drive', 'todo', 'https://todo.example.org/', currentUser);
  const state = new URL(start.redirectUrl).searchParams.get('state');
  await assert.rejects(
    () => auth.callback('drive', state, 'code', start.browserToken, currentUser),
    { code: 'GOOGLE_ACCOUNT_MISMATCH' }
  );
});
