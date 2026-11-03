#!/usr/bin/env bash
set -euo pipefail

# Lancer depuis la racine du dépôt, après configuration de /etc/nicolabz-identity/identity.env.
ENV_FILE="${ENV_FILE:-${HOME}/.config/nicolabz-identity/identity.env}"
IMAGE="localhost/nicolabz-identity:latest"
HOST_DATA_DIR="/var/volumes/nicolabz-identity"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Fichier d'environnement introuvable : $ENV_FILE" >&2
  exit 1
fi

podman build -t "$IMAGE" -f Containerfile .
# This standalone mode must not interfere with the systemd-managed deployment.
if [[ -f "$HOME/.config/containers/systemd/nicolabz-identity.container" ]]; then
  echo "Quadlet already manages this service. Use ops/redeploy-app.sh instead." >&2
  exit 1
fi
if [[ -L "$HOST_DATA_DIR" ]]; then
  echo "Refusing a symlinked data directory: $HOST_DATA_DIR" >&2
  exit 1
fi
if [[ ! -d "$HOST_DATA_DIR" ]]; then
  if [[ ! -d /var/volumes ]]; then
    sudo install -d -m 755 /var/volumes
  fi
  sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$HOST_DATA_DIR"
fi
if [[ "$(stat -c '%u' "$HOST_DATA_DIR")" != "$(id -u)" ]]; then
  echo "Data directory is not owned by the current user: $HOST_DATA_DIR" >&2
  exit 1
fi
podman run -d --replace \
  --name nicolabz-identity \
  --restart=unless-stopped \
  --env-file "$ENV_FILE" \
  --publish 127.0.0.1:3001:3000 \
  --userns keep-id \
  --user "$(id -u):$(id -g)" \
  --volume "$HOST_DATA_DIR:/app/data:Z" \
  "$IMAGE"

echo 'Logs : podman logs -f nicolabz-identity'
