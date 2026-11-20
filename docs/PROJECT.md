# Project Reference

## Purpose

Nicolabz Identity is a Node.js service that authenticates browser applications
with Google OpenID Connect and provides a central, session-based API for
application-specific JSON synchronization in each user's Google Drive.

It is a web API, not a general-purpose OpenID Connect provider.

## Architecture

- `src/server.js` composes configuration, SQLite repositories, Google OAuth,
  Drive access, synchronization, and Fastify HTTP routes.
- `src/config.js` validates environment configuration. `CLIENT_APPS_JSON`
  declares application IDs and allowed browser origins.
- `src/auth/` implements Google authorization-code flows, PKCE, identity
  verification, sessions, and Drive authorization.
- `src/db/` owns the SQLite schema and repositories. Drive refresh tokens are
  encrypted before persistence.
- `src/drive/` accesses the Drive API. Sync documents use the private
  `appDataFolder`; the internal `/demo` also supports visible text-file uploads.
- `src/sync/` implements explicit versioned reads and writes with conflict
  detection. Login does not trigger synchronization.
- `src/http/` contains Fastify routes, CORS/origin checks, cookies, and the
  integrated demo and status pages.

## Conventions and Constraints

- Registered applications are configured server-side and are keyed by unique
  IDs. Their origins must be exact and cannot be shared by other applications.
- The `demo` application ID and the API's public origin are reserved.
- OAuth flows use `state`, `nonce`, PKCE, a browser-bound cookie, and a
  short-lived, one-use database record.
- Browser sessions are opaque server-side tokens. Google refresh tokens are
  encrypted with the configured token-encryption key.
- Drive authorization and data synchronization are separate concerns. Never
  synchronize or alter user documents merely because a login or consent flow
  completed.
- Keep changes compatible with existing environment configurations and SQLite
  data unless a task explicitly requires a migration.

## Development

- Runtime: Node.js `>=22.13.0`.
- Dependencies are declared in `package.json`.
- Run tests with `npm test`; run the syntax check with `npm run check`.
- Keep project documentation in English. See `docs/USAGE.md` for verified
  configuration and operation instructions.
