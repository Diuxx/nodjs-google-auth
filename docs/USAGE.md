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

Login and authorization do not synchronize application data. Sync still
occurs only when a client explicitly calls `GET` or `PUT /api/sync/:appId`.
No schema migration is required, and existing encrypted credentials and sync
documents remain in place when the policy is changed.

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
