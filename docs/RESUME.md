# Architecture Summary

Nicolabz Identity is a Node.js 22+ Fastify API for Google OpenID Connect
sessions shared across allowlisted browser applications, with optional
per-application Google Drive authorization and explicit JSON synchronization.

- `src/server.js` composes configuration, SQLite, OAuth, Drive, sync, and HTTP.
- `src/lib/client-apps.js` validates server-declared app IDs and origins.
  `requiresDrive` and multi-file sync option `multiple` default to `false`.
- `src/auth/` handles authorization-code OAuth with `state`, `nonce`, PKCE,
  identity verification, and encrypted Drive refresh-token persistence.
- `src/db/` stores users, opaque sessions, temporary OAuth flows, encrypted
  Drive credentials, and per-app Drive file IDs.
- `src/drive/` reads and writes JSON in each user's Drive `appDataFolder`;
  multi-file apps use per-app folders.
- `src/sync/` exposes explicit versioned sync with conflict detection; login
  does not synchronize data.
- `src/http/` provides Fastify routes, CORS/origin enforcement, cookies, the
  status page, and the internal `/demo`.

Configuration is supplied through environment variables, especially
`CLIENT_APPS_JSON`. Tests use the Node.js built-in test runner (`npm test`).
See [USAGE.md](./USAGE.md) for Google Cloud and deployment configuration.
