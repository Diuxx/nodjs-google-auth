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

## Upgrade from the old named Podman volume

If `nicolabz-identity-data` exists, the updated installation script attempts a one-time migration **before** switching the Quadlet mount. It stops the old application first so SQLite is not written during the copy.

- The host directory must be **empty** before migration, otherwise the deployment aborts rather than overwriting data.
- The old Podman named volume is deliberately **preserved** for rollback; after verifying the application you can remove it manually if no longer needed.
- If migration fails, the original volume remains intact. Inspect the target and restore or clear partial copied files **only after backing them up**, before retrying.
- Back up the SQLite database before any migration, and do not perform these operations while another instance writes to it.

Verify:

```bash
ls -lah /var/volumes/nicolabz-identity
podman inspect nicolabz-identity --format '{{json .Mounts}}'
curl -fsS http://127.0.0.1:3000/health
```

If needed, inspect the old volume:

```bash
podman volume inspect nicolabz-identity-data
```

## Redeploy and cleanup

`./ops/redeploy-app.sh` continues to work unchanged and preserves the data directory.

The updated `./ops/clean-vps.sh` preserves `/var/volumes/nicolabz-identity` during normal uninstall. With `--purge`, it removes that directory and any old named volume, after explicit confirmation. Both operations are irreversible. Back up your SQLite data before using `--purge`.

## Security

- Do not make the SQLite directory world-writable (`chmod 777`).
- Avoid direct edits to a live SQLite database. Stop the application, or use SQLite's online backup mechanism.
- Back up `identity.sqlite` as well as the encryption key in `identity.env`; losing the key may prevent decryption of stored Google credentials.
- `/var/volumes` is a host convention, not a special Podman folder. Other applications can use `/var/volumes/<service>` separately.
