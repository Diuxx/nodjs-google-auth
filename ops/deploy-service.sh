#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy Nicolabz Identity on a Debian/Ubuntu VPS:
# rootless Podman + user Quadlet + Nginx + Certbot (HTTP-01 webroot).
# Run as your normal SSH user from any directory. Never run with sudo.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly APP_NAME="nicolabz-identity"
readonly IMAGE_NAME="localhost/nicolabz-identity:latest"
readonly VOLUME_NAME="nicolabz-identity-data"
readonly ENV_FILE="${HOME}/.config/nicolabz-identity/identity.env"
readonly QUADLET_FILE="${HOME}/.config/containers/systemd/nicolabz-identity.container"
readonly WEBROOT="/var/www/letsencrypt"
readonly PORT=3000

DOMAIN=""
EMAIL=""
SKIP_BUILD=false
SITE_FILE=""
SITE_LINK=""

info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: ./ops/deploy-vps.sh [--domain auth.example.com] [--email admin@example.com] [--skip-build]

Without arguments, the script asks for the domain and Let's Encrypt email.
Run as the SSH user that will own the rootless Podman container (not sudo).

--domain       Public HTTPS domain for the service
--email        Email for Let's Encrypt expiry notices
--skip-build   Use an image already built/loaded on this server
-h, --help     Display this help
USAGE
}

parse_arguments() {
  while (($#)); do
    case "$1" in
      --domain|--email)
        (($# >= 2)) || fail "Missing value for $1"
        if [[ "$1" == --domain ]]; then DOMAIN="$2"; else EMAIL="$2"; fi
        shift 2
        ;;
      --skip-build) SKIP_BUILD=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown option: $1 (see --help)" ;;
    esac
  done

  if [[ -z "$DOMAIN" ]]; then read -r -p 'Public domain (e.g. auth.nicolabz.dev): ' DOMAIN; fi
  if [[ -z "$EMAIL" ]]; then read -r -p "Let's Encrypt email: " EMAIL; fi
  DOMAIN="${DOMAIN,,}"

  [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail 'Invalid domain name.'
  [[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail 'Invalid email address.'
}

check_prerequisites() {
  (( EUID != 0 )) || fail 'Run as your normal user (e.g. ubuntu), not with sudo.'
  [[ -f "$PROJECT_DIR/Containerfile" ]] || fail 'Containerfile missing: launch from the complete Nicolabz Identity project.'
  [[ -f "$PROJECT_DIR/ops/production.env.example" ]] || fail 'Production environment example missing.'
  command -v podman >/dev/null || fail 'Podman is missing. Install it before continuing.'
  command -v systemctl >/dev/null || fail 'systemd is required for Quadlet.'
  command -v sudo >/dev/null || fail 'sudo is required to configure host Nginx and Certbot.'
  command -v openssl >/dev/null || fail 'openssl is required to generate the encryption key.'
  podman info >/dev/null || fail 'Podman rootless is not working for this user.'
  sudo -v || fail 'sudo authentication failed.'

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "$ID" in
      ubuntu|debian) ;;
      *) fail 'Automatic Nginx/Certbot installation is supported only on Debian and Ubuntu.' ;;
    esac
    if [[ "$ID" == ubuntu && "$VERSION_ID" == 25.04 ]]; then
      warn 'Ubuntu 25.04 is end-of-life (since 2026-01-15). Upgrade to a supported LTS release.'
      warn 'The apt repositories may also fail; this script cannot fix an unsupported OS.'
    fi
  fi
  if ! getent ahosts "$DOMAIN" >/dev/null 2>&1; then
    fail "DNS not resolved for $DOMAIN. Configure its A/AAAA records first."
  fi
}

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

prepare_environment() {
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$PROJECT_DIR/ops/production.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    local secret
    secret="$(openssl rand -base64 32 | tr -d '\n')"
    sed -i \
      -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${DOMAIN}|" \
      -e "s|^TOKEN_ENCRYPTION_KEY_BASE64=.*|TOKEN_ENCRYPTION_KEY_BASE64=${secret}|" \
      "$ENV_FILE"
    info "Created $ENV_FILE with a unique encryption key."
    warn 'Edit GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CLIENT_APPS_JSON and ALLOWED_EMAILS before deploying.'
    printf 'Edit: nano %s\nThen rerun the same deployment command.\n' "$ENV_FILE"
    exit 0
  fi

  chmod 600 "$ENV_FILE"
  [[ "$(read_env_value NODE_ENV)" == production ]] || fail 'Set NODE_ENV=production in identity.env.'
  [[ "$(read_env_value HOST)" == 0.0.0.0 ]] || fail 'Set HOST=0.0.0.0 in identity.env.'
  [[ "$(read_env_value PORT)" == "$PORT" ]] || fail "Set PORT=$PORT in identity.env."
  [[ "$(read_env_value DATABASE_PATH)" == /app/data/identity.sqlite ]] || fail 'DATABASE_PATH must be /app/data/identity.sqlite.'
  [[ "$(read_env_value PUBLIC_BASE_URL)" == "https://$DOMAIN" ]] || fail "PUBLIC_BASE_URL must be https://$DOMAIN."

  local key value
  for key in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET TOKEN_ENCRYPTION_KEY_BASE64 CLIENT_APPS_JSON; do
    value="$(read_env_value "$key")"
    [[ -n "$value" && "$value" != *REMPLACER* ]] || fail "Configure $key in $ENV_FILE."
  done
  if [[ -z "$(read_env_value ALLOWED_EMAILS)" ]]; then
    warn 'ALLOWED_EMAILS is empty: any Google user allowed by the OAuth consent screen can sign in.'
  fi
}

ensure_host_packages() {
  local packages=()
  command -v nginx >/dev/null || packages+=(nginx)
  command -v certbot >/dev/null || packages+=(certbot)
  command -v curl >/dev/null || packages+=(curl)

  if ((${#packages[@]})); then
    info "Installing missing packages: ${packages[*]}"
    sudo apt-get update || fail 'apt-get update failed. Check OS support and package sources.'
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}" || fail 'Package installation failed.'
  fi
  sudo systemctl enable --now nginx || fail 'Nginx could not start. Check ports 80/443 and existing Nginx sites.'
  sudo nginx -t || fail 'Existing Nginx configuration is invalid.'
  sudo mkdir -p "$WEBROOT/.well-known/acme-challenge"
}

build_image() {
  if [[ "$SKIP_BUILD" == true ]]; then
    podman image exists "$IMAGE_NAME" || fail "Image $IMAGE_NAME not found; build it first or omit --skip-build."
    info 'Using locally available image.'
  else
    info 'Building rootless Podman image (this may need temporary memory/disk space)...'
    (cd "$PROJECT_DIR" && podman build -t "$IMAGE_NAME" -f Containerfile .)
  fi
}

write_quadlet() {
  mkdir -p "$(dirname "$QUADLET_FILE")"
  podman volume exists "$VOLUME_NAME" || podman volume create "$VOLUME_NAME" >/dev/null

  cat > "$QUADLET_FILE" <<QUADLET
# Managed by ops/deploy-vps.sh; do not store secrets here.
[Unit]
Description=Nicolabz Identity API (rootless Podman)

[Container]
Image=$IMAGE_NAME
ContainerName=$APP_NAME
EnvironmentFile=$ENV_FILE
PublishPort=127.0.0.1:$PORT:$PORT
Volume=$VOLUME_NAME:/app/data:Z
Pull=never

[Service]
Restart=on-failure
RestartSec=5
TimeoutStartSec=180

[Install]
WantedBy=default.target
QUADLET

  sudo loginctl enable-linger "$(id -un)"
  systemctl --user daemon-reload || fail 'Unable to contact your user systemd instance. Reconnect over SSH and retry.'
  systemctl --user cat "$APP_NAME.service" >/dev/null || fail 'Quadlet did not generate its systemd unit. Check podman-system-generator.'

  # Migrate the container created by the older ops/deploy-podman.sh.
  if podman container exists "$APP_NAME" && ! systemctl --user is-active --quiet "$APP_NAME.service"; then
    local current_image
    current_image="$(podman inspect --format '{{.ImageName}}' "$APP_NAME")"
    [[ "$current_image" == "$IMAGE_NAME" ]] || fail "Container $APP_NAME belongs to a different image; refusing to remove it."
    info 'Removing the old non-Quadlet container (named SQLite volume is preserved).'
    podman rm -f "$APP_NAME" >/dev/null
  fi

  systemctl --user restart "$APP_NAME.service" || {
    systemctl --user --no-pager status "$APP_NAME.service" || true
    fail 'Failed to start Nicolabz Identity with Quadlet.'
  }
}

check_local_health() {
  local attempt
  for attempt in {1..12}; do
    if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
      info 'Local API health check passed.'
      return 0
    fi
    sleep 1
  done
  systemctl --user --no-pager status "$APP_NAME.service" || true
  fail "The API did not respond at 127.0.0.1:$PORT/health. See: podman logs $APP_NAME"
}

choose_nginx_location() {
  if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] &&
      sudo grep -Eq '^[[:space:]]*include[[:space:]]+/etc/nginx/sites-enabled/\*' /etc/nginx/nginx.conf; then
    SITE_FILE="/etc/nginx/sites-available/$APP_NAME.conf"
    SITE_LINK="/etc/nginx/sites-enabled/$APP_NAME.conf"
  else
    SITE_FILE="/etc/nginx/conf.d/$APP_NAME.conf"
    SITE_LINK="$SITE_FILE"
  fi

  if sudo test -e "$SITE_FILE"; then
    sudo grep -q '^# Managed by Nicolabz Identity VPS deploy' "$SITE_FILE" || \
      fail "Nginx file already exists and is not managed by this script: $SITE_FILE"
    sudo grep -Fq "server_name $DOMAIN;" "$SITE_FILE" || \
      fail "This managed Nginx site targets another domain. Inspect $SITE_FILE before proceeding."
  fi

  # A domain configured elsewhere could make Certbot use the wrong virtual host.
  local other_site
  while IFS= read -r other_site; do
    [[ -n "$other_site" ]] || continue
    if [[ "$(readlink -f "$other_site")" != "$(readlink -f "$SITE_FILE")" ]]; then
      fail "Domain $DOMAIN already appears in another enabled Nginx site: $other_site"
    fi
  done < <(sudo grep -rlF "server_name $DOMAIN" \
      /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true)
}

write_site() {
  local mode="$1" nginx_config
  nginx_config="$(mktemp)"
  # Use quoted EOF to preserve Nginx $variables literally; substitute only the domain afterwards.
  if [[ "$mode" == challenge ]]; then
    cat > "$nginx_config" <<'NGINX'
# Managed by Nicolabz Identity VPS deploy
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }
    location / { return 503; }
}
NGINX
  else
    cat > "$nginx_config" <<'NGINX'
# Managed by Nicolabz Identity VPS deploy
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
    }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name __DOMAIN__;

    ssl_certificate /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    server_tokens off;
    client_max_body_size 1m;
    add_header X-Content-Type-Options nosniff always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 45s;
    }
}
NGINX
  fi
  sed -i "s|__DOMAIN__|$DOMAIN|g" "$nginx_config"
  local backup=""
  if sudo test -e "$SITE_FILE"; then
    backup="$(mktemp)"
    sudo cp "$SITE_FILE" "$backup"
  fi
  sudo install -m 644 "$nginx_config" "$SITE_FILE"
  rm -f "$nginx_config"
  if [[ "$SITE_LINK" != "$SITE_FILE" ]]; then
    sudo ln -sfn "$SITE_FILE" "$SITE_LINK"
  fi

  if ! sudo nginx -t || ! sudo systemctl reload nginx; then
    # Leave the host with its previous working Nginx configuration.
    if [[ -n "$backup" ]]; then
      sudo install -m 644 "$backup" "$SITE_FILE"
    else
      sudo rm -f "$SITE_FILE"
      if [[ "$SITE_LINK" != "$SITE_FILE" ]]; then sudo rm -f "$SITE_LINK"; fi
    fi
    sudo nginx -t && sudo systemctl reload nginx || true
    [[ -z "$backup" ]] || rm -f "$backup"
    fail "Unable to activate the Nginx site: $SITE_FILE. Previous configuration restored."
  fi
  [[ -z "$backup" ]] || rm -f "$backup"
}

ensure_certificate() {
  choose_nginx_location
  local had_certificate=false
  if sudo test -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" &&
      sudo test -s "/etc/letsencrypt/live/$DOMAIN/privkey.pem"; then
    had_certificate=true
    info "An existing Let's Encrypt certificate was found."
    write_site https
  else
    info 'Preparing an HTTP challenge site for Certbot.'
    write_site challenge
  fi

  if ! sudo certbot certonly --webroot --webroot-path "$WEBROOT" \
      --domain "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive \
      --keep-until-expiring; then
    warn 'Certbot failed. Check DNS, firewall TCP 80, and whether another server answers this domain.'
    if [[ "$had_certificate" == false ]]; then
      sudo rm -f "$SITE_FILE"
      if [[ "$SITE_LINK" != "$SITE_FILE" ]]; then sudo rm -f "$SITE_LINK"; fi
      sudo nginx -t && sudo systemctl reload nginx || true
    fi
    fail 'HTTPS was not configured.'
  fi

  write_site https
  local hook='/etc/letsencrypt/renewal-hooks/deploy/nicolabz-identity-reload-nginx.sh'
  sudo install -d -m 755 "$(dirname "$hook")"
  printf '#!/bin/sh\n/usr/bin/systemctl reload nginx\n' | sudo tee "$hook" >/dev/null
  sudo chmod 755 "$hook"
  if systemctl list-unit-files certbot.timer --no-legend 2>/dev/null | grep -q '^certbot.timer'; then
    sudo systemctl enable --now certbot.timer
  else
    warn 'No certbot.timer found; configure automatic certificate renewal on this host.'
  fi
}

main() {
  parse_arguments "$@"
  info "Deploying $APP_NAME on https://$DOMAIN"
  check_prerequisites
  prepare_environment
  ensure_host_packages
  build_image
  write_quadlet
  check_local_health
  ensure_certificate
  info 'Deployment completed.'
  printf '\nURL:       https://%s/\nDemo:      https://%s/demo\nHealth:    https://%s/health\n' "$DOMAIN" "$DOMAIN" "$DOMAIN"
  printf 'Logs:      podman logs -f %s\nService:   systemctl --user status %s.service\n' "$APP_NAME" "$APP_NAME"
  printf 'Nginx:     %s\nSQLite:    Podman volume %s\nSecrets:   %s\n' "$SITE_FILE" "$VOLUME_NAME" "$ENV_FILE"
  printf '\nGoogle Cloud OAuth redirect URIs:\n  https://%s/auth/google/callback\n  https://%s/auth/drive/callback\n' "$DOMAIN" "$DOMAIN"
}

main "$@"
