import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { AppError, requireCondition } from '../lib/errors.js';
import { requireAppOrigin } from '../lib/client-apps.js';
import { registerDemoRoutes } from './demo/routes.js';
import { registerHomeRoutes } from './home/routes.js';
import { registerDemoTextRoutes } from './demo/text-routes.js';
import { cookieSettings, setSessionCookie, clearSessionCookie, setFlowCookie, clearFlowCookie } from './cookies.js';

export async function createApp({ config, repo, auth, google, sync, drive, database }) {
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'] },
    disableRequestLogging: true, // Évite de journaliser les codes OAuth dans les URLs de callback.
    bodyLimit: 1024 * 1024
  });
  const cookies = cookieSettings(config.isProduction);

  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: (origin, done) => done(null, origin && config.clientApps.origins.has(origin) ? origin : false),
    methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
  });
  await app.register(helmet, { referrerPolicy: { policy: 'no-referrer' } });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error.validation) {
      return reply.code(400).send({ error: { code: 'VALIDATION_FAILED', message: 'Requête invalide.' } });
    }
    if (error.statusCode === 413) {
      return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Document trop volumineux (maximum 1 Mio).' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne du serveur.' } });
  });

  function currentUser(request) {
    const user = repo.sessions.find(request.cookies[cookies.sessionName]);
    if (user && config.allowedEmails.size && !config.allowedEmails.has(user.email.toLowerCase())) {
      return undefined;
    }
    return user;
  }

  function requireUser(request) {
    const user = currentUser(request);
    requireCondition(user, 401, 'UNAUTHENTICATED', 'Connecte-toi avec Google.');
    return user;
  }

  function requireTrustedOrigin(request) {
    requireCondition(config.clientApps.origins.has(request.headers.origin),
      403, 'ORIGIN_FORBIDDEN', 'Origine non autorisée.');
  }

  function requireSyncAccess(request) {
    requireCondition(request.params.appId !== 'demo', 404, 'UNKNOWN_APP',
      'La démonstration est réservée à la connexion Google.');
    const user = requireUser(request);
    requireAppOrigin(config.clientApps, request.params.appId, request.headers.origin);
    return user;
  }

  function beginFlow(type, request, reply) {
    const user = type === 'drive' ? requireUser(request) : null;
    const { browserToken, redirectUrl } = auth.start(type, request.query.app, request.query.return_to, user);
    setFlowCookie(reply, cookies, browserToken);
    return reply.redirect(redirectUrl);
  }

  async function endFlow(type, request, reply) {
    if (request.query.error) {
      throw new AppError(400, 'GOOGLE_AUTH_DECLINED', 'Authentification ou autorisation Google refusée.');
    }
    const oldToken = request.cookies[cookies.sessionName];
    const result = await auth.callback(type, request.query.state, request.query.code,
      request.cookies[cookies.flowName], currentUser(request));
    clearFlowCookie(reply, cookies);
    if (result.sessionToken) {
      repo.sessions.remove(oldToken);
      setSessionCookie(reply, cookies, result.sessionToken, config.sessionDurationMs);
    }
    return reply.redirect(result.returnUrl);
  }

  registerHomeRoutes(app, { repo, registeredApplications: config.clientApps.apps.size - 1 });
  registerDemoRoutes(app, config.publicBaseUrl);
  registerDemoTextRoutes(app, { config, drive, requireUser });

  app.get('/health', async () => {
    database.prepare('SELECT 1').get();
    return { status: 'ok' };
  });
  app.get('/auth/google/start', (request, reply) => beginFlow('login', request, reply));
  app.get('/auth/google/callback', (request, reply) => endFlow('login', request, reply));
  app.get('/auth/drive/start', (request, reply) => beginFlow('drive', request, reply));
  app.get('/auth/drive/callback', (request, reply) => endFlow('drive', request, reply));

  app.get('/api/session', async request => {
    const user = currentUser(request);
    return { authenticated: Boolean(user), user: user ? {
      id: user.id, email: user.email, name: user.name, picture: user.picture
    } : null, driveConnected: Boolean(user && repo.drive.getEncryptedToken(user.id)) };
  });

  app.post('/api/logout', async (request, reply) => {
    requireTrustedOrigin(request);
    repo.sessions.remove(request.cookies[cookies.sessionName]);
    clearSessionCookie(reply, cookies);
    return { ok: true };
  });

  app.post('/api/drive/disconnect', async (request, reply) => {
    requireTrustedOrigin(request);
    const user = requireUser(request);
    const encrypted = repo.drive.getEncryptedToken(user.id);
    if (encrypted) {
      try { await google.revoke(config.cipher.decrypt(encrypted)); }
      catch (error) { request.log.warn({ message: error.message }, 'Révocation Google impossible (jeton local supprimé)'); }
      repo.drive.disconnect(user.id);
    }
    return { ok: true };
  });

  app.get('/api/sync/:appId', async request => {
    const user = requireSyncAccess(request);
    return sync.get(user.id, request.params.appId);
  });

  app.put('/api/sync/:appId', {
    schema: {
      body: {
        type: 'object', required: ['version', 'data'], additionalProperties: false,
        properties: {
          version: { type: 'integer', minimum: 0 },
          data: { anyOf: [{ type: 'object' }, { type: 'array' }] }
        }
      }
    }
  }, async request => {
    const user = requireSyncAccess(request);
    return sync.put(user.id, request.params.appId, request.body.version, request.body.data);
  });

  return app;
}
