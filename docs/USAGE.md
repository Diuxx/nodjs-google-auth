# Usage and Operations

## Requirements and Development

- Node.js `>=22.13.0` and npm.
- A Google Cloud project with an OAuth web client.
- For local development, copy `.env.example` to `.env`, set the Google OAuth
  credentials, and generate `TOKEN_ENCRYPTION_KEY_BASE64` with `npm run secret`.
  Do not commit `.env`.

Install dependencies and run the test suite:

```sh
npm install
npm test
npm run dev
```

The API listens on port `3000` by default. `npm start` starts it without the
development watch mode. `npm run check` checks JavaScript syntax.

## Home Page Applications

The public home page and `GET /api/public/applications` expose registered
application IDs and their `requiresDrive` and `multiple` settings, excluding
the internal demo. They do not expose origins, credentials, or file names.
`requiresDrive: false` means Drive is optional at login, not forbidden.
Protect the service at the reverse proxy if application IDs or settings
should not be public.

The **Compter mes fichiers** button counts JSON sync files only for the
currently signed-in Google account. It explicitly reads Drive on demand;
it does not create, change, or synchronize files. A count includes the
classic single-file document and any named multi-file documents, even if
multi-file mode is currently disabled. An unavailable or revoked Drive
authorization produces an unavailable count, not zero.

The count endpoint requires a session and the exact `PUBLIC_BASE_URL` origin,
and does not expose file names or counts to other application origins.

## Google Cloud

Configure the Google OAuth consent screen and a **Web application** OAuth
client. Enable the **Google Drive API** when any application uses Drive. Add
the scopes actually used by the server under the consent screen's **Data
Access**:

- `openid`, `email`, and `profile` for Google identity.
- `https://www.googleapis.com/auth/drive.appdata` for application sync data.
- `https://www.googleapis.com/auth/drive.file` only for the internal `/demo`
  feature that creates visible text files in the user's Drive.

For OAuth redirect URIs, retain the existing server callbacks; no new callback
or browser-side Google client is needed:

```text
https://auth.example.org/auth/google/callback
https://auth.example.org/auth/drive/callback
```

Use the corresponding `http://localhost:3000` callback URLs for local
development. While the consent screen is in testing mode, add each test
account. Google publication and verification requirements depend on the
requested scopes and project audience; follow the requirements shown for the
Cloud project.

## Per-Application Drive Policy

`CLIENT_APPS_JSON` is the server-side allowlist of application IDs and browser
origins. An optional boolean `requiresDrive` controls whether the app's initial
Google login also requests the Drive `appDataFolder` scope:

```dotenv
CLIENT_APPS_JSON=[{"id":"pecule","origins":["https://pecule.nicolabz.dev"],"requiresDrive":true},{"id":"batch","origins":["https://batch.nicolabz.dev"]}]
```

In this example, Pécule requests Google identity and Drive access together;
Batch requests identity only. Omitting `requiresDrive` is equivalent to
`false`, preserving existing configurations and identity-only login behavior.
The value must be a JSON boolean, not a string. The browser continues to send
the same `app` and `return_to` parameters; it cannot enable or disable Drive.
The internal `demo` app is not part of this setting.

When `requiresDrive` is true, the server requests `drive.appdata` during the
Google login with offline access, verifies that Drive scope was granted, and
encrypts any returned refresh token before storing it in SQLite. An existing
stored refresh token is retained if Google does not return a replacement. If
neither is available, login fails with `MISSING_REFRESH_TOKEN` rather than
creating a session that cannot use Drive.

Drive authorization remains separately available through
`/auth/drive/start?app=<id>&return_to=<url>` for applications that do not
require Drive at login and for reauthorization. That flow requires an
authenticated session and verifies that the Google account's stable `sub`
matches the signed-in account. It requests offline access and explicit consent.
If a required-Drive login cannot obtain a refresh token, sign in through an
identity-only application first, then use the separate Drive authorization
flow to reauthorize.

Google consent refusal does not establish a new session or store Drive
credentials. An existing session remains intact. `POST /api/drive/disconnect`
attempts to revoke Google's token and removes the local encrypted credential
even if Google has already revoked it. It does not delete sync indexes or
Drive documents. An externally revoked or expired token can be reauthorized
through the separate Drive flow.

Login and authorization do not synchronize application data. Sync occurs
only when a client explicitly calls the sync API. No schema migration is
required, and existing encrypted credentials and sync documents remain in
place when the policy is changed.

After changing the environment configuration, restart or redeploy the server.
Keep the same OAuth client, callback URLs, SQLite database, and encryption key.

## Application Integration

Applications start Google login using the existing routes:

```js
const url = new URL('https://auth.example.org/auth/google/start');
url.searchParams.set('app', 'pecule');
url.searchParams.set('return_to', location.href);
location.assign(url.href);
```

Use the configured app ID as the sync namespace, include
`credentials: 'include'` in browser API requests, and send the returned sync
version with each write. A `409 SYNC_CONFLICT` requires the client to reload
and resolve the conflict; the server does not merge documents automatically.

## Multiple JSON Files

Set `multiple` to `true` for each application that needs multiple files:

```dotenv
CLIENT_APPS_JSON=[{"id":"pecule","origins":["https://pecule.nicolabz.dev"],"requiresDrive":true,"multiple":true},{"id":"batch","origins":["https://batch.nicolabz.dev"],"multiple":false}]
```

The option must be a boolean; omitted or `false` disables the new routes.
It is independent of `requiresDrive`: an app can request Drive during login
or use the existing separate Drive authorization flow.

The following routes require an authenticated session, Drive access, the
registered origin for `appId`, and `multiple: true`. Include
`credentials: 'include'` in browser requests.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/sync/:appId/files` | `{ "appId": "pecule", "files": ["budgets.json", "comptes.json"] }` |
| GET | `/api/sync/:appId/files/:name` | The named document, or `404 SYNC_FILE_NOT_FOUND` |
| PUT | `/api/sync/:appId/files/:name` | Create or update a JSON document |

Names must start with an ASCII letter or digit and contain only ASCII letters,
digits, `_`, or `-` before the lowercase `.json` extension. The base name is
1–96 characters. Names are case-sensitive; Drive IDs are never supplied by
the client.

Create `comptes.json` by sending `PUT /api/sync/pecule/files/comptes.json`
with `Content-Type: application/json`:

```json
{"version":0,"data":{"accounts":[]}}
```

The response contains the filename, new version, timestamp and data:

```json
{"appId":"pecule","name":"comptes.json","version":1,"updatedAt":"2026-01-01T00:00:00.000Z","data":{"accounts":[]}}
```

For updates, send the last known version. Stale versions return
`409 SYNC_CONFLICT` without writing. Lists include all pages, sorted by name.
If Drive contains duplicate folder or file names, the API reports
`409 DUPLICATE_DRIVE_FILES` instead of choosing one.

The server creates a folder named `nicolabz.<appId>` inside each user's
private `appDataFolder` on the first write. The Google OAuth client and this
space are shared across applications: folder names are an organization
mechanism, while the API enforces session and origin isolation. Reads and
lists do not create folders or files.

Existing single-file routes and their `nicolabz.<appId>.json` documents stay
available even when `multiple` is enabled. No data is moved or copied
automatically. To switch an existing client, explicitly read its old document
and copy it into a new named file using the API, verifying the result before
making any separate cleanup decision.

The service provides no multi-file deletion, rename, automatic migration or
automatic sync. It uses in-memory locks within one server process; do not run
multiple writing instances against the same data. The existing 1 MiB HTTP
request body limit applies to each write.

## Data and Troubleshooting

- Refresh tokens are encrypted with `TOKEN_ENCRYPTION_KEY_BASE64`; keep that
  key separate from the SQLite volume and back it up securely.
- Login does not change `drive_credentials` for apps without `requiresDrive`.
- Drive sync JSON files live in the user's private `appDataFolder`. The
  visible `/demo` text upload is separate and uses `drive.file`.
- If Drive reports `DRIVE_RECONNECT_REQUIRED`, use the separate Drive
  authorization flow and grant access to the same Google account.
- If an app reports `DRIVE_PERMISSION_MISSING`, verify that the
  `drive.appdata` scope is declared in Google Cloud and that the application
  has `requiresDrive: true` when Drive is required during login.
- `MISSING_REFRESH_TOKEN` means no new refresh token was returned and no
  encrypted one was stored for that account. Reauthorize Drive through an
  identity-only login as described above.
