#!/usr/bin/env bash
set -Eeuo pipefail

# Rebuild and restart Nicolabz Identity after its initial VPS installation.
# This script intentionally does not change Nginx, Certbot, secrets or SQLite data.
# Run as the same non-root user who installed the rootless Quadlet.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly APP_NAME="nicolabz-identity"
readonly IMAGE_NAME="localhost/nicolabz-identity:latest"
readonly UNIT_NAME="${APP_NAME}.service"
readonly QUADLET_FILE="${HOME}/.config/containers/systemd/${APP_NAME}.container"
readonly ENV_FILE="${HOME}/.config/nicolabz-identity/identity.env"
readonly HEALTH_URL="http://127.0.0.1:3000/health"

SKIP_BUILD=false

info() { printf '[INFO] %s\n' "$*"; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: ./ops/redeploy-app.sh [--skip-build]

Rebuild the local image and restart the existing rootless Quadlet service.
No changes to Nginx, Certbot, the SQLite volume or environment variables.

--skip-build   Reuse an image already built or loaded on this server
-h, --help     Display this help
USAGE
}

parse_arguments() {
  while (($#)); do
    case "$1" in
      --skip-build) SKIP_BUILD=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown option: $1 (see --help)" ;;
    esac
  done
}

check_prerequisites() {
  (( EUID != 0 )) || fail 'Run as the rootless Podman user, without sudo.'
  [[ -f "$PROJECT_DIR/Containerfile" ]] || fail "Containerfile not found in $PROJECT_DIR."
  [[ -f "$QUADLET_FILE" ]] || fail "Quadlet is missing: $QUADLET_FILE. Run deploy-vps.sh first."
  [[ -f "$ENV_FILE" ]] || fail "Configuration is missing: $ENV_FILE. Run deploy-vps.sh first."

  command -v podman >/dev/null || fail 'Podman is not installed.'
  command -v systemctl >/dev/null || fail 'systemctl is not available.'
  command -v curl >/dev/null || fail 'curl is not installed.'

  podman info >/dev/null || fail 'Podman rootless is unavailable for this user.'
  systemctl --user cat "$UNIT_NAME" >/dev/null 2>&1 || \
    fail "Quadlet service $UNIT_NAME is not registered. Run deploy-vps.sh first."
}

build_image() {
  if [[ "$SKIP_BUILD" == true ]]; then
    podman image exists "$IMAGE_NAME" || fail "Image $IMAGE_NAME is missing."
    info "Reusing image $IMAGE_NAME."
    return
  fi

  info "Building $IMAGE_NAME from $PROJECT_DIR..."
  (cd "$PROJECT_DIR" && podman build --tag "$IMAGE_NAME" --file Containerfile .) || \
    fail 'Image build failed. The currently running container has not been restarted.'
}

show_diagnostics() {
  systemctl --user --no-pager status "$UNIT_NAME" || true
  journalctl --user --no-pager --unit "$UNIT_NAME" --lines 30 || true
}

restart_service() {
  info "Restarting $UNIT_NAME..."
  if ! systemctl --user restart "$UNIT_NAME"; then
    show_diagnostics
    fail 'Service restart failed. Check the service logs.'
  fi
}

wait_for_health() {
  local attempt
  for attempt in {1..20}; do
    if curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
      info 'Health check passed.'
      return
    fi
    sleep 1
  done

  show_diagnostics
  fail "The API did not become healthy at $HEALTH_URL."
}

main() {
  parse_arguments "$@"
  check_prerequisites
  build_image
  restart_service
  wait_for_health

  info 'Application redeployed successfully.'
  printf 'Status: systemctl --user status %s\n' "$UNIT_NAME"
  printf 'Logs:   journalctl --user -u %s -f\n' "$UNIT_NAME"
}

main "$@"
