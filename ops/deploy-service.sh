#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy Nicolabz Identity on a Debian/Ubuntu VPS:
# rootless Podman + user Quadlet + Nginx + Certbot (HTTP-01 webroot).
# Run as your normal SSH user from any directory. Never run with sudo.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly APP_NAME="nicolabz-identity"
readonly IMAGE_NAME="localhost/nicolabz-identity:latest"
readonly HOST_DATA_DIR="/var/volumes/nicolabz-identity"
readonly ENV_FILE="${HOME}/.config/nicolabz-identity/identity.env"
readonly QUADLET_FILE="${HOME}/.config/containers/systemd/nicolabz-identity.container"
readonly WEBROOT="/var/www/letsencrypt"
readonly HOST_PORT=3001
readonly CONTAINER_PORT=3000

DOMAIN=""
EMAIL=""
SKIP_BUILD=false
CONFIGURE_ENV=false
TEMP_ENV_FILE=""
SITE_FILE=""
SITE_LINK=""

info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage: ./ops/deploy-vps.sh [--domain auth.example.com] [--email admin@example.com] [--skip-build] [--configure-env]

Without arguments, the script asks for the domain and Let's Encrypt email.
On first deployment it also prompts for Google credentials and client apps.
Run as the SSH user that will own the rootless Podman container (not sudo).

--domain       Public HTTPS domain for the service
--email        Email for Let's Encrypt expiry notices
--skip-build   Use an image already built/loaded on this server
--configure-env  Interactively edit the existing environment configuration
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
      --configure-env) CONFIGURE_ENV=true; shift ;;
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
  [[ -f "$ENV_FILE" ]] || return 0
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

# Secrets are read from the terminal rather than CLI arguments (shell history / ps).
prompt_secret() {
  local label="$1" current="$2" input
  local suffix=''
  [[ -n "$current" && "$current" != REMPLACER* ]] && suffix=' [Enter to keep existing value]'
  read -r -s -p "$label$suffix: " input || fail 'Input cancelled.'
  printf '\n'
  REPLY="${input:-$current}"
  [[ -n "$REPLY" && "$REPLY" != REMPLACER* ]] || fail "$label is required."
  [[ "$REPLY" != *$'\n'* && "$REPLY" != *$'\r'* ]] || fail "$label contains a newline."
}

prompt_client_id() {
  local previous="$1" input hint=''
  [[ -n "$previous" && "$previous" != REMPLACER* ]] && hint=" [$previous]"
  read -r -p "Google OAuth client ID$hint: " input || fail 'Input cancelled.'
  REPLY="${input:-$previous}"
  [[ "$REPLY" =~ ^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$ ]] || fail 'Invalid Google OAuth client ID.'
}

# Interactive app list: only simple HTTPS origins are accepted, making JSON encoding safe.
# Client identifiers and origins are intentionally restricted to avoid free-form JSON input.
prompt_client_apps() {
  local previous="$1" answer app_id raw_origins origin part app_json='[' comma=''
  local -a origins
  local -A registered_ids=() registered_origins=()

  if [[ -n "$previous" && "$previous" != REMPLACER* ]]; then
    read -r -p 'Keep existing client applications? [Y/n]: ' answer || fail 'Input cancelled.'
    if [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]; then
      REPLY="$previous"
      return 0
    fi
  fi

  info 'Configure authorized applications (the built-in /demo app is automatic).'
  while :; do
    read -r -p 'Application ID (e.g. budget; blank to finish): ' app_id || fail 'Input cancelled.'
    if [[ -z "$app_id" ]]; then
      [[ "$app_json" != '[' ]] || { warn 'At least one client application is required.'; continue; }
      break
    fi
    if [[ ! "$app_id" =~ ^[a-z][a-z0-9_-]{0,39}$ || "$app_id" == demo || -v registered_ids[$app_id] ]]; then
      warn 'Invalid, reserved or duplicate application ID.'
      continue
    fi

    read -r -p "Authorized HTTPS origins for $app_id (comma separated): " raw_origins || fail 'Input cancelled.'
    IFS=',' read -r -a origins <<< "$raw_origins"
    local origin_json='[' origin_separator='' valid=true
    for part in "${origins[@]}"; do
      origin="${part#"${part%%[![:space:]]*}"}"
      origin="${origin%"${origin##*[![:space:]]}"}"
      # The project's production mode requires HTTPS and exact browser origins.
      if [[ ! "$origin" =~ ^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$ || "$origin" == "https://$DOMAIN" || -v registered_origins[$origin] ]]; then
        warn "Invalid, API-reserved or duplicate origin: $origin"
        valid=false
        break
      fi
      origin_json+="${origin_separator}\"${origin}\""
      origin_separator=','
    done
    if [[ "$valid" == false || "$origin_json" == '[' ]]; then
      warn 'Please enter at least one valid HTTPS origin; no paths or trailing slash.'
      continue
    fi
    origin_json+=']'
    for part in "${origins[@]}"; do
      origin="${part#"${part%%[![:space:]]*}"}"
      origin="${origin%"${origin##*[![:space:]]}"}"
      registered_origins["$origin"]=1
    done
    registered_ids["$app_id"]=1
    app_json+="${comma}{\"id\":\"${app_id}\",\"origins\":${origin_json}}"
    comma=','
  done
  REPLY="${app_json}]"
}

prompt_allowed_emails() {
  local current="$1" input answer
  read -r -p "Allowed Google emails (comma-separated; blank = unrestricted) [$current]: " input || fail 'Input cancelled.'
  REPLY="${input:-$current}"
  [[ "$REPLY" != *$'\n'* && "$REPLY" != *$'\r'* ]] || fail 'Invalid email list.'
  if [[ -z "$REPLY" ]]; then
    warn 'With ALLOWED_EMAILS empty, any account authorized by the Google consent screen may sign in.'
    read -r -p 'Continue without an email allowlist? [y/N]: ' answer || fail 'Input cancelled.'
    [[ "$answer" =~ ^[Yy]$ ]] || fail 'Configuration cancelled. No changes were saved.'
  fi
}

# Replace only managed keys, preserving custom settings and preventing partial writes.
write_environment() {
  local client_id="$1" client_secret="$2" apps="$3" emails="$4" encryption_key="$5"
  local source_file="$PROJECT_DIR/ops/production.env.example" line key
  local -A updated_keys=() seen_keys=()
  local -a key_order=(NODE_ENV HOST PORT PUBLIC_BASE_URL DATABASE_PATH GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET TOKEN_ENCRYPTION_KEY_BASE64 CLIENT_APPS_JSON ALLOWED_EMAILS)

  [[ -f "$ENV_FILE" ]] && source_file="$ENV_FILE"
  updated_keys[NODE_ENV]=production
  updated_keys[HOST]=0.0.0.0
  updated_keys[PORT]="$CONTAINER_PORT"
  updated_keys[PUBLIC_BASE_URL]="https://$DOMAIN"
  updated_keys[DATABASE_PATH]=/app/data/identity.sqlite
  updated_keys[GOOGLE_CLIENT_ID]="$client_id"
  updated_keys[GOOGLE_CLIENT_SECRET]="$client_secret"
  updated_keys[TOKEN_ENCRYPTION_KEY_BASE64]="$encryption_key"
  updated_keys[CLIENT_APPS_JSON]="$apps"
  updated_keys[ALLOWED_EMAILS]="$emails"

  TEMP_ENV_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
  chmod 600 "$TEMP_ENV_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Z_][A-Z0-9_]*)= ]]; then
      key="${BASH_REMATCH[1]}"
      if [[ -v updated_keys[$key] ]]; then
        [[ -v seen_keys[$key] ]] || printf '%s=%s\n' "$key" "${updated_keys[$key]}" >> "$TEMP_ENV_FILE"
        seen_keys["$key"]=1
        continue
      fi
    fi
    printf '%s\n' "$line" >> "$TEMP_ENV_FILE"
  done < "$source_file"

  for key in "${key_order[@]}"; do
    [[ -v seen_keys[$key] ]] || printf '%s=%s\n' "$key" "${updated_keys[$key]}" >> "$TEMP_ENV_FILE"
  done
  mv -f -- "$TEMP_ENV_FILE" "$ENV_FILE"
  TEMP_ENV_FILE=''
  info "Environment saved to $ENV_FILE (permissions 600)."
}

configure_environment() {
  [[ -t 0 ]] || fail 'An interactive terminal is required to configure the environment.'
  local current_client_id current_client_secret current_apps current_emails current_key
  local client_id client_secret apps emails answer

  current_client_id="$(read_env_value GOOGLE_CLIENT_ID)"
  current_client_secret="$(read_env_value GOOGLE_CLIENT_SECRET)"
  current_apps="$(read_env_value CLIENT_APPS_JSON)"
  current_emails="$(read_env_value ALLOWED_EMAILS)"
  current_key="$(read_env_value TOKEN_ENCRYPTION_KEY_BASE64)"
  [[ "$current_key" != REMPLACER* ]] || current_key=''

  prompt_client_id "$current_client_id"; client_id="$REPLY"
  prompt_secret 'Google OAuth client secret (hidden)' "$current_client_secret"; client_secret="$REPLY"
  prompt_client_apps "$current_apps"; apps="$REPLY"
  prompt_allowed_emails "$current_emails"; emails="$REPLY"

  printf '\nConfiguring %s with %s.\n' "$ENV_FILE" "https://$DOMAIN"
  read -r -p 'Save these settings and continue deployment? [y/N]: ' answer || fail 'Input cancelled.'
  [[ "$answer" =~ ^[Yy]$ ]] || fail 'Configuration cancelled. No changes were saved.'

  # Never rotate the encryption key during a reconfiguration; existing tokens need it.
  [[ -n "$current_key" ]] || current_key="$(openssl rand -base64 32 | tr -d '\n')"
  write_environment "$client_id" "$client_secret" "$apps" "$emails" "$current_key"
}

validate_environment() {
  [[ "$(read_env_value NODE_ENV)" == production ]] || fail 'Set NODE_ENV=production in identity.env.'
  [[ "$(read_env_value HOST)" == 0.0.0.0 ]] || fail 'Set HOST=0.0.0.0 in identity.env.'
  [[ "$(read_env_value PORT)" == "$CONTAINER_PORT" ]] || fail "Set PORT=$CONTAINER_PORT in identity.env."
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

prepare_environment() {
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ -f "$ENV_FILE" ]]; then
    chmod 600 "$ENV_FILE"
    if [[ "$(read_env_value PUBLIC_BASE_URL)" != "https://$DOMAIN" ]]; then
      fail 'Existing PUBLIC_BASE_URL differs from the requested domain; domain migration is not automatic.'
    fi
  fi

  if [[ ! -f "$ENV_FILE" || "$CONFIGURE_ENV" == true ]]; then
    configure_environment
  else
    info "Using existing $ENV_FILE (use --configure-env to edit interactively)."
  fi
  validate_environment
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

# A bind mount makes SQLite data directly accessible as the SSH user.
# Only the application's directory is owned by that user, not /var/volumes itself.
prepare_data_directory() {
  if sudo test -L /var/volumes; then
    fail 'Refusing symlinked /var/volumes directory.'
  fi
  if sudo test -e /var/volumes; then
    sudo test -d /var/volumes || fail '/var/volumes is not a directory.'
  else
    sudo install -d -m 755 /var/volumes
  fi
  if sudo test -L "$HOST_DATA_DIR"; then
    fail "Refusing to use symlinked data directory: $HOST_DATA_DIR"
  fi
  if sudo test -e "$HOST_DATA_DIR"; then
    sudo test -d "$HOST_DATA_DIR" || fail "Not a directory: $HOST_DATA_DIR"
    local owner
    owner="$(sudo stat -c '%u' "$HOST_DATA_DIR")"
    [[ "$owner" == "$(id -u)" ]] || fail "$HOST_DATA_DIR is owned by UID $owner, expected $(id -u). Fix manually."
  else
    sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$HOST_DATA_DIR"
  fi
  chmod 700 "$HOST_DATA_DIR"
}

write_quadlet() {
  mkdir -p "$(dirname "$QUADLET_FILE")"
  prepare_data_directory

  cat > "$QUADLET_FILE" <<QUADLET
# Managed by ops/deploy-vps.sh; do not store secrets here.
[Unit]
Description=Nicolabz Identity API (rootless Podman)

[Container]
Image=$IMAGE_NAME
ContainerName=$APP_NAME
EnvironmentFile=$ENV_FILE
PublishPort=127.0.0.1:$HOST_PORT:$CONTAINER_PORT
# Keep the running UID/GID equal to the host SSH user, so files remain accessible.
UserNS=keep-id
User=$(id -u)
Group=$(id -g)
Volume=$HOST_DATA_DIR:/app/data:Z
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

  # Avoid replacing a standalone container, which may use different storage.
  if podman container exists "$APP_NAME" && ! systemctl --user is-active --quiet "$APP_NAME.service"; then
    fail "A container named $APP_NAME already exists outside the running Quadlet. Check and remove it manually before deployment."
  fi

  systemctl --user restart "$APP_NAME.service" || {
    systemctl --user --no-pager status "$APP_NAME.service" || true
    fail 'Failed to start Nicolabz Identity with Quadlet.'
  }
}

check_local_health() {
  local attempt
  for attempt in {1..12}; do
    if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:$HOST_PORT/health" >/dev/null 2>&1; then
      info 'Local API health check passed.'
      return 0
    fi
    sleep 1
  done
  systemctl --user --no-pager status "$APP_NAME.service" || true
  fail "The API did not respond at 127.0.0.1:$HOST_PORT/health. See: podman logs $APP_NAME"
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
        proxy_pass http://127.0.0.1:3001;
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
  trap '[[ -z "$TEMP_ENV_FILE" ]] || rm -f -- "$TEMP_ENV_FILE"' EXIT
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
  printf 'Nginx:     %s\nSQLite:    %s\nSecrets:   %s\n' "$SITE_FILE" "$HOST_DATA_DIR" "$ENV_FILE"
  printf '\nGoogle Cloud OAuth redirect URIs:\n  https://%s/auth/google/callback\n  https://%s/auth/drive/callback\n' "$DOMAIN" "$DOMAIN"
}

main "$@"
