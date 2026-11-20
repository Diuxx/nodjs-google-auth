# Usage and Operations

## Requirements and Development

- Node.js `>=22.13.0` and npm.
- A Google Cloud project with an OAuth web client.
- For local development, copy `.env.example` to `.env`, set the Google OAuth
  credentials, and generate `TOKEN_ENCRYPTION_KEY_BASE64` with `npm run secret`.
  Do not commit `.env`.

Install dependencies, run the tests, and start the development server:

```sh
npm install
npm test
node --env-file=.env --watch src/server.js
```

The API listens on port `3000` by default. `npm run dev` also opens a browser
using a Windows-specific command. `npm start` starts without watch mode and
expects its environment to have already been supplied. `npm run check` checks
JavaScript syntax.

## Production Deployment

The supplied service installer targets Debian or Ubuntu with rootless Podman,
systemd user services (Quadlet), Nginx, and Certbot. Run it from a normal SSH
account, not as root. The account needs working rootless Podman, `sudo`, and
OpenSSL; the script installs Nginx, Certbot, and curl if missing. Point the
public domain's DNS at the server and allow HTTP and HTTPS before deployment.
The installer configures the host's Nginx site and obtains a certificate; review
the script and the existing host configuration before running it.

```sh
./ops/deploy-service.sh --domain auth.example.org --email admin@example.org
```

On first installation, the script prompts for Google credentials, authorized
applications, each application's Drive and multi-file options, and an optional
email allowlist. It generates an encryption key and writes the configuration to
`~/.config/nicolabz-identity/identity.env` with mode `600`. Use
`./ops/deploy-service.sh --help` for all options; `--configure-env` revisits
the interactive configuration. Keeping the existing application list preserves
its settings. Rebuilding the list replaces it, so re-enter every application
and its options. Reconfiguration retains an existing encryption key.

The installer uses one container listening on port `3000`, published only as
`127.0.0.1:3001` on the host. Nginx terminates HTTPS and proxies to that host
port. The SQLite database is in
`/var/volumes/nicolabz-identity/identity.sqlite`, bind-mounted at `/app/data`;
configuration and credentials are kept outside the data directory. The script
enables user lingering and creates a rootless Quadlet service.

Production `PUBLIC_BASE_URL` and configured application origins must use
HTTPS. Applications should be on the same site as the API for the session
cookie's `SameSite=Lax` behavior; locally, use `localhost` consistently instead
of mixing it with `127.0.0.1`.

### Standalone Podman

For an existing reverse proxy without the installer-managed Quadlet, prepare
`~/.config/nicolabz-identity/identity.env` from
`ops/production.env.example`. Restrict it to the deploying user, set the
Google credentials and client applications, and set
`TOKEN_ENCRYPTION_KEY_BASE64` to a new key from `npm run secret` **only for a
new installation**. Do not replace the key of an existing installation.
Keep `PORT=3000`: `3001` is the published host port, not the container port.

```sh
./ops/deploy-podman.sh
```

Run this command from the repository root as the rootless Podman user. The
script binds `127.0.0.1:3001` to container port `3000` and uses the same host
data directory. `ENV_FILE` may select another environment file. Configure
HTTPS and the reverse proxy separately. This standalone mode refuses to run
when the installer-managed Quadlet file exists; use the redeployment command
below for that service.

### Verification, updates, and backups

```sh
systemctl --user status nicolabz-identity.service
journalctl --user -u nicolabz-identity.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3001/health
curl -fsS https://auth.example.org/health
```

The service and journal commands apply to the Quadlet installation. For
standalone Podman, use `podman ps` and
`podman logs --tail 100 nicolabz-identity`. A successful health response checks
the API and SQLite only; test `/demo` with a Google account separately.

Back up SQLite and the encryption key securely before updating. For a live
SQLite database, use SQLite's online backup rather than copying only the
database file while WAL is active. For example, with the `sqlite3` CLI:

```sh
mkdir -p "$HOME/backups"
sqlite3 /var/volumes/nicolabz-identity/identity.sqlite \
  ".backup '$HOME/backups/nicolabz-identity-$(date +%F-%H%M%S).sqlite'"
```

Back up the encryption key separately and do not print or publish the
environment file. After updating the checkout, redeploy the Quadlet service:

```sh
./ops/redeploy-service.sh
```

The redeployment script builds the image, restarts the service, and checks
`127.0.0.1:3001/health`. `--skip-build` reuses the existing image. It does not
change the environment, Nginx, certificate, or SQLite data. For standalone
Podman, run `./ops/deploy-podman.sh` again instead.

Neither installer automatically migrates or deletes the old named Podman
volume `nicolabz-identity-data`. If it contains needed data, plan and verify a
backup and migration before using the new host directory. Keep a compatible
previous image and database backup for rollback.

`./ops/clean-service.sh --dry-run` displays the Quadlet cleanup plan. Normal
cleanup preserves SQLite data and credentials. Its optional `--purge` mode is
destructive and requires explicit confirmation; review its help and backups
before using it.

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

## HTTP Routes

Paths are relative to `PUBLIC_BASE_URL`. The dashboard lists these functional
routes; the tables below describe their contracts. Static assets are listed
separately. JSON examples are illustrative, not live service data.

### Access and browser requests

- **Public** routes do not require a session.
- **Session** means an authenticated session cookie. Browser API calls from
  an application should use `credentials: 'include'`.
- **Allowed origin** means the request's `Origin` must be registered in
  `CLIENT_APPS_JSON` or be the reserved `PUBLIC_BASE_URL` origin for the demo.
  For sync routes, the origin must belong to the requested `appId`.
- **Service origin** means the exact `PUBLIC_BASE_URL` origin, not another
  registered application's origin.
- **Drive** means a stored Drive credential for the signed-in user; an expired
  or revoked authorization can still require reconnection.
- **Multi** additionally requires `multiple: true` for that application.

The internal `demo` app is reserved and cannot use sync routes. CORS allows
credentials and the methods `GET`, `PUT`, `POST`, `PATCH`, `DELETE`, and
`OPTIONS` for configured origins; it does not replace the per-route checks
above. JSON request bodies use `Content-Type: application/json`. The general
request body limit is 1 MiB; the demo text endpoint has a smaller limit.

### Service, session, and dashboard

| Method | Route | Access | Success |
| --- | --- | --- | --- |
| GET | `/` | Public | HTML dashboard |
| GET | `/health` | Public | `200` with `{"status":"ok"}` after a local SQLite check |
| GET | `/api/public/status` | Public | `200` with local checks and aggregate statistics |
| GET | `/api/public/applications` | Public | `200` with registered app IDs and options, excluding `demo` |
| GET | `/api/session` | Public | `200` with session state; `user` is `null` when anonymous |
| POST | `/api/logout` | Allowed origin | `200` with `{"ok":true}`; removes the current session if present |
| POST | `/api/drive/disconnect` | Session, allowed origin | `200` with `{"ok":true}`; removes the local Drive credential |
| POST | `/api/home/applications/:appId/file-count` | Session, service origin, Drive | `200` with counts for the signed-in user |

`GET /api/public/status` returns
`{"status":"ok","checks":{"api":"ok","sqlite":"ok"},"statistics":{"totalUsers":0,"activeUsers":0,"connectedDrives":0,"registeredApplications":0}}`.
These checks do not test Google services.
`GET /api/public/applications` returns
`{"applications":[{"id":"pecule","requiresDrive":true,"multiple":true}]}`.
The anonymous session response is
`{"authenticated":false,"user":null,"driveConnected":false}`. When signed
in, `user` contains `id`, `email`, `name`, and `picture`; `driveConnected`
only indicates that a local credential exists, not that Google still accepts it.

For example, the file-count response is
`{"appId":"pecule","legacy":1,"named":2,"total":3}`. It reads Drive metadata
on demand, including named files when multi-file mode is disabled. See
[Home Page Applications](#home-page-applications).

### OAuth and demo

| Method | Route | Access | Success |
| --- | --- | --- | --- |
| GET | `/auth/google/start?app=<id>&return_to=<url>` | Public | `302` to Google for identity, with Drive scope if configured |
| GET | `/auth/google/callback` | Google OAuth flow | `302` to the approved return URL with `auth=connected` |
| GET | `/auth/drive/start?app=<id>&return_to=<url>` | Session | `302` to Google for Drive authorization |
| GET | `/auth/drive/callback` | Google OAuth flow, same session | `302` to the approved return URL with `drive=connected` |
| GET | `/demo` | Public | HTML demo; `/demo/` redirects to it |
| GET | `/demo/login` | Public | `302` to the demo's Google login start |
| GET | `/demo/drive` | Public redirect; destination requires a session | `302` to the demo's Drive authorization start |
| POST | `/api/demo/text-file` | Session, service origin, Drive | `201` with the created visible Drive text file |

The OAuth start routes require a registered `app` and an absolute `return_to`
URL with an origin registered for that app. Encode query values when building
the URL. Callbacks are invoked by Google and require the active browser-bound
flow; they are not general-purpose login endpoints. Google consent refusal
returns `400 GOOGLE_AUTH_DECLINED`. The separate Drive flow also verifies
that the Google account matches the signed-in account.

The demo text request is `{"filename":"example.txt","content":"Hello"}`.
The filename must be a simple `.txt` name of at most 100 characters, without
`..`; content is limited to 16 KiB UTF-8. A successful response has the form
`{"id":"<drive-id>","name":"example.txt","url":"https://drive.google.com/file/d/<drive-id>/view"}`.
This creates a visible file in My Drive and does not delete it automatically.

### Synchronization

All sync routes require a session, the origin registered for `:appId`, and
Drive access. `:appId` identifies the application; `:name` is a validated
JSON filename. Multi-file routes additionally require the app's `multiple`
setting. See [Multiple JSON Files](#multiple-json-files) for naming rules,
examples, conflict handling, and deletion precautions.

| Method | Route | Access | Request and success |
| --- | --- | --- | --- |
| GET | `/api/sync/:appId` | Session, app origin, Drive | `200` with the single document, or version `0` and `null` data if absent |
| PUT | `/api/sync/:appId` | Session, app origin, Drive | `{"version":N,"data":{}}`; `200` with the updated document |
| GET | `/api/sync/:appId/files` | Session, app origin, Drive, multi | `200` with `{"appId":"pecule","files":["comptes.json"]}` |
| GET | `/api/sync/:appId/files/:name` | Session, app origin, Drive, multi | `200` with the named document; `404` if absent |
| PUT | `/api/sync/:appId/files/:name` | Session, app origin, Drive, multi | `{"version":N,"data":{}}`; `200` with the created or updated document |
| PATCH | `/api/sync/:appId/files/:name` | Session, app origin, Drive, multi | `{"version":N,"name":"new.json"}`; `200` with the renamed document |
| DELETE | `/api/sync/:appId/files/:name?version=N` | Session, app origin, Drive, multi | `200` with `{"ok":true}`; permanently deletes the file |

Write `data` must be a JSON object or array. Use version `0` to create a
document and the latest returned version to update it. Named-file rename and
delete require a version of at least `1`. A single-document response contains
`appId`, `version`, `updatedAt`, and `data`; named-document responses also
contain `name`.

### Errors

Application errors handled by the server return JSON in this shape:
`{"error":{"code":"SYNC_CONFLICT","message":"..."}}`. Common cases include:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Invalid request body or query parameters |
| 400 | `INVALID_SYNC_FILENAME` | Invalid named-file source or destination |
| 400 | `GOOGLE_AUTH_DECLINED` | Google login or authorization was refused |
| 401 | `UNAUTHENTICATED` | A required session is missing |
| 403 | `ORIGIN_FORBIDDEN` | The request origin is not allowed for the route |
| 403 | `MULTIPLE_SYNC_DISABLED` | Multi-file mode is disabled for this app |
| 404 | `UNKNOWN_APP` / `SYNC_FILE_NOT_FOUND` | App or named file not found |
| 409 | `SYNC_CONFLICT` | The supplied version is stale |
| 409 | `SYNC_FILENAME_EXISTS` / `DUPLICATE_DRIVE_FILES` | Destination exists or Drive contains duplicate names |
| 409 | `DRIVE_NOT_CONNECTED` / `DRIVE_RECONNECT_REQUIRED` / `DRIVE_ACCESS_DENIED` | Drive authorization is missing, expired, or denied |
| 413 | `PAYLOAD_TOO_LARGE` / `TEXT_FILE_TOO_LARGE` | The applicable request or text content limit was exceeded |
| 502 | `DRIVE_API_FAILED` / `GOOGLE_NETWORK_FAILED` | Google Drive failed or could not be reached |

`UNKNOWN_APP` may also be a `400` when starting an OAuth flow with an
undeclared app. Other OAuth, validation, and provider errors can also occur.
Do not treat a failed or timed-out write as proof that Drive did not apply it.

### Static assets

The server also provides `GET /home/home.css`, `/home/home.js`,
`/demo/demo.css`, `/demo/demo.js`, `/favicon.svg`, `/theme/theme.css`,
`/theme/theme.js`, and `/theme/lucide-license.txt`.

## Multiple JSON Files

Set `multiple` to `true` for each application that needs multiple files:

```dotenv
CLIENT_APPS_JSON=[{"id":"pecule","origins":["https://pecule.nicolabz.dev"],"requiresDrive":true,"multiple":true},{"id":"batch","origins":["https://batch.nicolabz.dev"],"multiple":false}]
```

The option must be a boolean; omitted or `false` disables the new routes.
It is independent of `requiresDrive`: an app can request Drive during login
or use the existing separate Drive authorization flow.

The routes and access requirements are listed under
[Synchronization](#synchronization).

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

To rename a file, send `PATCH /api/sync/pecule/files/comptes.json` with
`{"version":1,"name":"accounts.json"}`. The response has the same shape as
a read, with the new name and incremented version. Renaming to the same name
checks the version but leaves the document unchanged. An occupied target
returns `409 SYNC_FILENAME_EXISTS`; a missing source returns
`404 SYNC_FILE_NOT_FOUND`.

To delete the renamed document, send
`DELETE /api/sync/pecule/files/accounts.json?version=2`. A successful deletion
returns `{"ok":true}`. This permanently deletes the Drive file rather than
moving it to the trash. Confirm the user's intent and keep a backup if needed.
After a timeout or lost response, re-read before retrying; recreating a name
starts its version at 1, so a version is not a permanent file identity. A
stale request can therefore match a replacement with the same name and
version. A timed-out Drive operation may also complete after a later read;
verify its outcome before retrying or reusing the name.

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

The service provides no automatic migration or automatic sync. Files previously
created directly under `appDataFolder` by the separate metadata-based
multi-file implementation are not migrated or listed by these routes; they
remain untouched and require an explicit, verified migration. The service
uses in-memory locks within one server process; do not run multiple writing
instances against the same data. Drive writes outside this process are not
protected by an atomic compare-and-swap. The existing 1 MiB HTTP request body
limit applies to each write.

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
