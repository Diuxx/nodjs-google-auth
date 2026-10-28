import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth/auth-service.js';
import { createTokenCipher, hashToken } from '../src/lib/crypto.js';
import { parseClientApps } from '../src/lib/client-apps.js';

function fakeAuth() {
  const flows = new Map();
  let nextSession;
  let savedRefreshToken;
  const config = {
    clientApps: parseClientApps('[{"id":"todo","origins":["https://todo.example.org"]}]', true),
    sessionDurationMs: 86400000,
    allowedEmails: new Set(),
    cipher: createTokenCipher(Buffer.alloc(32, 2).toString('base64'))
  };
  const repo = {
    flows: {
      create(flow) { flows.set(flow.stateHash, flow); },
      consume(state) {
        const key = hashToken(state);
        const flow = flows.get(key);
        flows.delete(key);
        return flow ? { ...flow, browserHash: flow.browserHash, userId: flow.userId, expiresAt: flow.expiresAt } : null;
      }
    },
    users: { upsert: user => ({ id: 1, googleSub: user.sub, ...user }) },
    sessions: { create(token) { nextSession = token; } },
    drive: {
      getEncryptedToken: () => savedRefreshToken,
      saveEncryptedToken(id, value) { savedRefreshToken = value; }
    }
  };
  const google = {
    buildAuthorizationUrl: (flow, state) => `https://google.example/?state=${state}`,
    exchangeCode: async flow => ({
      user: { sub: flow.type === 'drive' ? 'google-user' : 'google-user', email: 'user@example.org', name: 'User', picture: null },
      refreshToken: flow.type === 'drive' ? 'secret-refresh' : null
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
