#!/usr/bin/env bash
set -euo pipefail

# Lancer depuis la racine du dépôt, après configuration de /etc/nicolabz-identity/identity.env.
ENV_FILE="${ENV_FILE:-${HOME}/.config/nicolabz-identity/identity.env}"
IMAGE="localhost/nicolabz-identity:latest"
VOLUME="nicolabz-identity-data"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Fichier d'environnement introuvable : $ENV_FILE" >&2
  exit 1
fi

podman build -t "$IMAGE" -f Containerfile .
podman volume exists "$VOLUME" || podman volume create "$VOLUME"
podman run -d --replace \
  --name nicolabz-identity \
  --restart=unless-stopped \
  --env-file "$ENV_FILE" \
  --publish 127.0.0.1:3000:3000 \
  --volume "$VOLUME:/app/data:Z" \
  "$IMAGE"

echo 'Logs : podman logs -f nicolabz-identity'
