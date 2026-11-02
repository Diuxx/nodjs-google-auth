# Persistent volumes on the VPS

Nicolabz Identity now mounts its SQLite directory from the host:

- Host: `/var/volumes/nicolabz-identity`
- Inside the container: `/app/data`
- SQLite database: `/var/volumes/nicolabz-identity/identity.sqlite`
- Configuration secrets remain in `~/.config/nicolabz-identity/identity.env` (not exposed through the volume).

The directory is created with mode `700` and owned by the SSH user that deploys the rootless container, typically `ubuntu`. `/var/volumes` remains owned by root with mode `755`. You do not need to run Podman as root.

The Quadlet uses `UserNS=keep-id`, plus the current user's UID and GID, to write host-readable files without a recursive `:U` ownership change. The `:Z` suffix is kept for SELinux-compatible systems. If your application stores other files under `/app/data`, they appear in the same host directory.

## First installation

```bash
./ops/deploy-vps.sh --domain auth.example.com --email admin@example.com
```

During deployment the script prepares the host data directory before starting the container. It does not modify Nginx or Let's Encrypt behavior.

## New installation without migration

The install script **does not inspect, migrate, or delete** the older named Podman volume `nicolabz-identity-data`. It creates `/var/volumes/nicolabz-identity` if needed, and mounts that directory directly into `/app/data`. SQLite creates its database there at first startup.

The old volume, even if it exists, remains untouched. Once you have confirmed it is unused, you may remove it manually if you wish:

```bash
podman volume inspect nicolabz-identity-data
# Optional, only after confirming the volume has no needed data:
podman volume rm nicolabz-identity-data
```

Verify the bind mount:

```bash
ls -lah /var/volumes/nicolabz-identity
podman inspect nicolabz-identity --format '{{json .Mounts}}'
curl -fsS http://127.0.0.1:3000/health
```

If an old standalone container named `nicolabz-identity` exists, the new installer stops with an error rather than deleting it automatically. Inspect its storage, then remove it manually if appropriate.

## Redeploy and cleanup

`./ops/redeploy-app.sh` continues to work unchanged and preserves the data directory.

The updated `./ops/clean-vps.sh` preserves `/var/volumes/nicolabz-identity` during normal uninstall. With `--purge`, it removes that directory after explicit confirmation. The old named volume is never deleted automatically. Both operations are irreversible. Back up your SQLite data before using `--purge`.

## Security

- Do not make the SQLite directory world-writable (`chmod 777`).
- Avoid direct edits to a live SQLite database. Stop the application, or use SQLite's online backup mechanism.
- Back up `identity.sqlite` as well as the encryption key in `identity.env`; losing the key may prevent decryption of stored Google credentials.
- `/var/volumes` is a host convention, not a special Podman folder. Other applications can use `/var/volumes/<service>` separately.
