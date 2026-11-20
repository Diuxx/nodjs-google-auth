# Nicolabz Identity

Nicolabz Identity is a central Google sign-in and Drive synchronization
service for authorized web applications.

## Features

- Google sign-in and server-side browser sessions.
- Optional Drive authorization per application.
- Versioned single- and multi-file JSON synchronization in each user's Drive.
- A service dashboard and an interactive demo.

## Quick Start

Install Node.js 22.13 or later, configure a Google OAuth client, and copy
`.env.example` to `.env`. Set the required credentials and encryption key as
described in the [usage guide](docs/USAGE.md).

```sh
npm install
npm test
node --env-file=.env --watch src/server.js
```

Open `http://localhost:3000/`.

## Deployment

For Debian or Ubuntu with rootless Podman and systemd, run as your normal SSH
user. Replace the example domain and email with your own:

```sh
# First deployment; prompts for Google credentials and application settings
./ops/deploy-service.sh --domain auth.example.org --email admin@example.org

# Rebuild and restart after updating the project
./ops/redeploy-service.sh
```

To update the configuration, edit
`~/.config/nicolabz-identity/identity.env`, then restart without rebuilding:

```sh
./ops/redeploy-service.sh --skip-build
```

Alternatively, run the first deployment command again with `--configure-env`
to edit the configuration interactively; this also reruns the deployment.
Keep the existing encryption key and never publish the environment file.
See the [deployment guide](docs/USAGE.md#production-deployment) for
prerequisites, backups, and standalone Podman.

## Documentation

See [docs/USAGE.md](docs/USAGE.md) for configuration, API routes, integration,
deployment, and troubleshooting.
