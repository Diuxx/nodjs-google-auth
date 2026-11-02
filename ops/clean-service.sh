#!/usr/bin/env bash
set -Eeuo pipefail

# Remove resources created by Nicolabz Identity's deploy-vps.sh.
# Run as the SAME non-root SSH user that deployed the rootless Podman service.
# Other Podman containers, Nginx sites, Certbot certificates and packages are preserved.

readonly APP_NAME='nicolabz-identity'
readonly SERVICE_NAME="${APP_NAME}.service"
readonly IMAGE_NAME='localhost/nicolabz-identity:latest'
readonly VOLUME_NAME='nicolabz-identity-data' # Legacy volume (also removed on purge).
readonly HOST_DATA_DIR='/var/volumes/nicolabz-identity'
readonly QUADLET_FILE="${HOME}/.config/containers/systemd/${APP_NAME}.container"
readonly ENV_DIR="${HOME}/.config/nicolabz-identity"
readonly ENV_FILE="${ENV_DIR}/identity.env"
readonly NGINX_AVAILABLE="/etc/nginx/sites-available/${APP_NAME}.conf"
readonly NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}.conf"
readonly NGINX_CONFD="/etc/nginx/conf.d/${APP_NAME}.conf"
readonly CERTBOT_HOOK="/etc/letsencrypt/renewal-hooks/deploy/${APP_NAME}-reload-nginx.sh"
readonly MANAGED_NGINX_MARKER='# Managed by Nicolabz Identity VPS deploy'
readonly MANAGED_QUADLET_MARKER='# Managed by ops/deploy-vps.sh; do not store secrets here.'

PURGE=false
DRY_RUN=false
DOMAIN=''
BACKUP_DIR=''

info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
Usage: ./ops/clean-vps.sh [--dry-run] [--purge] [--domain auth.example.com]

By default, removes ONLY this app's Quadlet service, Podman container/image,
managed Nginx configuration, and app-specific Certbot reload hook.
SQLite host data, legacy volume, Google credentials and Let's Encrypt certificate are preserved.

--dry-run          Display removal plan without changing anything.
--purge            ALSO permanently delete /var/volumes/nicolabz-identity,
                   the legacy Podman volume, credentials, and (when exclusively
                   owned) the Let's Encrypt certificate.
--domain NAME      Domain for certificate deletion; otherwise read identity.env.
-h, --help         Show this help.

Run as your usual SSH user (e.g. ubuntu), NEVER with sudo.
The script asks for explicit confirmation before deleting anything.
It does not uninstall Podman, Nginx or Certbot, or delete your Git checkout.
HELP
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run) DRY_RUN=true; shift ;;
      --purge) PURGE=true; shift ;;
      --domain)
        (($# >= 2)) || fail 'Missing value for --domain.'
        DOMAIN="${2,,}"
        shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done
  (( EUID != 0 )) || fail 'Run as the rootless Podman user, without sudo.'
  if [[ -z "$DOMAIN" && -f "$ENV_FILE" ]]; then
    local base_url
    base_url="$(sed -n 's/^PUBLIC_BASE_URL=//p' "$ENV_FILE" | tail -n 1)"
    DOMAIN="${base_url#https://}"
    [[ "$base_url" == https://* ]] || DOMAIN=''
  fi
  if [[ -n "$DOMAIN" ]]; then
    [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail 'Invalid domain name.'
    # An explicitly provided domain must not target a different certificate
    # than the domain belonging to the installed application.
    if [[ -f "$ENV_FILE" ]]; then
      local configured_url
      configured_url="$(sed -n 's/^PUBLIC_BASE_URL=//p' "$ENV_FILE" | tail -n 1)"
      if [[ -n "$configured_url" && "$configured_url" != "https://$DOMAIN" ]]; then
        fail "--domain does not match PUBLIC_BASE_URL in $ENV_FILE."
      fi
    fi
  fi
  if [[ "$PURGE" == true && -z "$DOMAIN" ]]; then
    fail 'Provide --domain auth.example.com (required for safe certificate cleanup).'
  fi
}

print_plan() {
  cat <<EOF
Resources owned by $APP_NAME:
  - Quadlet:    $QUADLET_FILE
  - Service:    $SERVICE_NAME (systemd --user)
  - Container:  $APP_NAME (rootless Podman)
  - Image:      $IMAGE_NAME
  - Nginx:      $NGINX_AVAILABLE OR $NGINX_CONFD (+ enabled symlink)
  - Hook:       $CERTBOT_HOOK
EOF
  if [[ "$PURGE" == true ]]; then
    cat <<EOF
  - SQLite:     $HOST_DATA_DIR [PERMANENT DELETION]
  - Legacy:     Podman volume $VOLUME_NAME [PERMANENT DELETION]
  - Secrets:    $ENV_FILE [PERMANENT DELETION]
  - Certificate: $DOMAIN (only if no other service depends on it)
EOF
  else
    printf '  - Preserved:  SQLite data directory and legacy volume, secrets, and Lets Encrypt certificate\n'
  fi
  printf '  - Preserved:  Nginx/Podman/Certbot packages, other apps, project files\n'
}

confirm_removal() {
  local expected="REMOVE $APP_NAME" input=''
  [[ "$PURGE" == false ]] || expected="DELETE $APP_NAME"
  printf '\nType exactly "%s" to confirm: ' "$expected"
  read -r input || fail 'Interactive confirmation is required.'
  [[ "$input" == "$expected" ]] || fail 'Cancelled. Nothing has been removed.'
}

check_prerequisites() {
  command -v podman >/dev/null || fail 'Podman is required.'
  command -v systemctl >/dev/null || fail 'systemctl is required.'
  command -v sudo >/dev/null || fail 'sudo is required for Nginx/Certbot cleanup.'
  podman info >/dev/null || fail 'Rootless Podman is unavailable for this user.'
  systemctl --user show-environment >/dev/null || fail 'Cannot access the user systemd instance.'
  sudo -v || fail 'sudo authentication failed.'
}

check_owned_resources() {
  if [[ -e "$QUADLET_FILE" ]]; then
    grep -Fxq "$MANAGED_QUADLET_MARKER" "$QUADLET_FILE" || fail "Unrecognized Quadlet; refusing to modify $QUADLET_FILE."
    grep -Fxq "ContainerName=$APP_NAME" "$QUADLET_FILE" || fail 'Quadlet container name does not match.'
    grep -Fxq "Image=$IMAGE_NAME" "$QUADLET_FILE" || fail 'Quadlet image name does not match.'
  elif systemctl --user cat "$SERVICE_NAME" >/dev/null 2>&1; then
    fail 'A service with this name exists, but the managed Quadlet is missing.'
  fi

  if podman container exists "$APP_NAME"; then
    local current_image
    current_image="$(podman inspect --format '{{.ImageName}}' "$APP_NAME")"
    [[ "$current_image" == "$IMAGE_NAME" ]] || fail "Container uses an unexpected image: $current_image."
  fi

  local file
  for file in "$NGINX_AVAILABLE" "$NGINX_CONFD"; do
    if sudo test -e "$file" || sudo test -L "$file"; then
      sudo test -f "$file" && ! sudo test -L "$file" || fail "Unexpected Nginx file type: $file"
      sudo grep -Fxq "$MANAGED_NGINX_MARKER" "$file" || fail "Unmanaged Nginx config: $file"
    fi
  done
  if sudo test -e "$NGINX_ENABLED" || sudo test -L "$NGINX_ENABLED"; then
    sudo test -L "$NGINX_ENABLED" || fail "Unexpected Nginx enabled site: $NGINX_ENABLED"
    [[ "$(sudo readlink "$NGINX_ENABLED")" == "$NGINX_AVAILABLE" ]] || fail 'Enabled Nginx symlink points to a different configuration.'
  fi
}

remove_quadlet_and_container() {
  if [[ -f "$QUADLET_FILE" ]]; then
    info 'Stopping Quadlet service...'
    if systemctl --user is-active --quiet "$SERVICE_NAME"; then
      systemctl --user stop "$SERVICE_NAME" || fail 'Could not stop Quadlet service.'
    fi
    rm -- "$QUADLET_FILE"
    systemctl --user daemon-reload || fail 'Could not reload user systemd units.'
    systemctl --user reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  if podman container exists "$APP_NAME"; then
    info 'Removing remaining app container...'
    podman rm -f "$APP_NAME" >/dev/null || fail 'Could not remove app container.'
  fi
  if podman image exists "$IMAGE_NAME"; then
    info 'Removing app image...'
    if ! podman rmi "$IMAGE_NAME"; then
      warn 'Image is still used by another container; kept for safety.'
    fi
  fi
}

cleanup_backup() {
  if [[ -n "$BACKUP_DIR" ]]; then
    sudo rm -rf -- "$BACKUP_DIR"
    BACKUP_DIR=''
  fi
}

restore_nginx() {
  local file base
  for file in "$NGINX_AVAILABLE" "$NGINX_CONFD"; do
    base="$(basename "$(dirname "$file")")"
    if sudo test -f "$BACKUP_DIR/$base.conf"; then
      sudo cp -a -- "$BACKUP_DIR/$base.conf" "$file"
    fi
  done
  if sudo test -f "$BACKUP_DIR/enabled-link"; then
    sudo ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  fi
  sudo nginx -t && sudo systemctl reload nginx || true
}

remove_nginx_site() {
  local found=false
  local file base
  for file in "$NGINX_AVAILABLE" "$NGINX_CONFD"; do
    if sudo test -f "$file"; then found=true; fi
  done
  if sudo test -L "$NGINX_ENABLED"; then found=true; fi
  [[ "$found" == true ]] || return 0

  BACKUP_DIR="$(mktemp -d)"
  for file in "$NGINX_AVAILABLE" "$NGINX_CONFD"; do
    if sudo test -f "$file"; then
      base="$(basename "$(dirname "$file")")"
      sudo cp -a -- "$file" "$BACKUP_DIR/$base.conf"
    fi
  done
  if sudo test -L "$NGINX_ENABLED"; then
    touch "$BACKUP_DIR/enabled-link"
  fi

  info 'Removing only the managed Nginx site...'
  sudo rm -f -- "$NGINX_ENABLED" "$NGINX_AVAILABLE" "$NGINX_CONFD"
  if command -v nginx >/dev/null; then
    if ! sudo nginx -t || (sudo systemctl is-active --quiet nginx && ! sudo systemctl reload nginx); then
      restore_nginx
      fail 'Nginx validation/reload failed; site configuration restored.'
    fi
  fi
  cleanup_backup
}

remove_hook() {
  if sudo test -e "$CERTBOT_HOOK"; then
    local content expected
    content="$(sudo cat "$CERTBOT_HOOK")"
    expected="$(printf '#!/bin/sh\n/usr/bin/systemctl reload nginx\n')"
    if [[ "$content" != "$expected" ]]; then
      warn "Certbot hook is modified; preserving $CERTBOT_HOOK."
      return 0
    fi
    sudo rm -- "$CERTBOT_HOOK"
    info 'Removed app-specific Certbot hook.'
  fi
}

purge_certificate() {
  local renewal_file="/etc/letsencrypt/renewal/${DOMAIN}.conf"
  local cert_file="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  if ! sudo test -f "$renewal_file"; then
    info "No Certbot certificate named $DOMAIN found."
    return 0
  fi
  command -v certbot >/dev/null || fail 'Certbot is required to remove its certificate safely.'
  command -v openssl >/dev/null || fail 'OpenSSL is required to verify certificate names.'
  sudo test -f "$cert_file" || fail "Certificate exists in Certbot but $cert_file is missing."

  # Never delete certificates shared with other domains, or referenced by other sites.
  local -a names=()
  mapfile -t names < <(sudo openssl x509 -in "$cert_file" -noout -ext subjectAltName \
    | grep -oE 'DNS:[^,[:space:]]+' | sed 's/^DNS://' | sort -u)
  [[ "${#names[@]}" == 1 && "${names[0]}" == "$DOMAIN" ]] || \
    fail "Certificate $DOMAIN includes other domain(s), or its SAN cannot be checked. Preserving it."

  local references
  references="$(sudo grep -RIlF -- "/etc/letsencrypt/live/$DOMAIN/" \
    /etc/nginx /etc/apache2 /etc/httpd 2>/dev/null || true)"
  [[ -z "$references" ]] || fail "Certificate is referenced elsewhere; not deleting:\n$references"

  info "Deleting the certificate $DOMAIN with Certbot..."
  sudo certbot delete --cert-name "$DOMAIN" --non-interactive || fail 'Certbot certificate deletion failed.'
}

purge_private_data() {
  if [[ -e "$HOST_DATA_DIR" || -L "$HOST_DATA_DIR" ]]; then
    [[ ! -L "$HOST_DATA_DIR" && -d "$HOST_DATA_DIR" ]] || fail "Refusing to purge unexpected data path: $HOST_DATA_DIR"
    [[ "$(stat -c '%u' "$HOST_DATA_DIR")" == "$(id -u)" ]] || fail 'Refusing to delete a data directory owned by another user.'
    if mountpoint -q "$HOST_DATA_DIR" || findmnt -rn -o TARGET | grep -Fq -- "$HOST_DATA_DIR/"; then
      fail 'Refusing to purge a directory containing an active mount point.'
    fi
    info "Permanently deleting application data in $HOST_DATA_DIR..."
    rm -rf --one-file-system -- "$HOST_DATA_DIR"
  fi
  if podman volume exists "$VOLUME_NAME"; then
    info 'Permanently deleting old named SQLite volume...'
    podman volume rm "$VOLUME_NAME" || fail 'Volume still in use; refusing to force-delete it.'
  fi
  if [[ -f "$ENV_FILE" ]]; then
    info 'Deleting Google credentials and app configuration...'
    rm -- "$ENV_FILE"
  fi
  rmdir "$ENV_DIR" 2>/dev/null || true
}

main() {
  parse_args "$@"
  print_plan
  if [[ "$DRY_RUN" == true ]]; then
    info 'Dry-run only. Nothing was changed.'
    return 0
  fi
  check_prerequisites
  check_owned_resources
  confirm_removal
  trap cleanup_backup EXIT

  remove_quadlet_and_container
  remove_nginx_site
  remove_hook
  if [[ "$PURGE" == true ]]; then
    purge_certificate
    purge_private_data
  fi

  info 'Nicolabz Identity removal completed.'
  if [[ "$PURGE" == false ]]; then
    info "Data and secrets preserved; rerun with --purge --domain $DOMAIN to delete them permanently."
  fi
}

main "$@"
