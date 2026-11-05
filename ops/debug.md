# Nicolabz Identity — Commandes de supervision et de debug

Fiche pratique pour l'installation sur le **NAS `nico-nas`**, avec **Podman rootless**, **Quadlet**, **Nginx** et **SQLite**.

| Élément | Valeur |
|---|---|
| Utilisateur | `nicolas` |
| Service systemd | `nicolabz-identity.service` |
| Conteneur Podman | `nicolabz-identity` |
| API locale (hôte) | `http://127.0.0.1:3001` |
| API dans le conteneur | Port `3000` |
| Adresse publique | `https://auth.nicolabz.dev` |
| Données SQLite | `/var/volumes/nicolabz-identity/` |
| Quadlet | `~/.config/containers/systemd/nicolabz-identity.container` |
| Environnement | `~/.config/nicolabz-identity/identity.env` |

> Exécuter les commandes Podman et `systemctl --user` en tant que **`nicolas`**, sans `sudo`. `sudo` est réservé aux vérifications ou modifications du système (Nginx, Certbot, permissions).

## 1. Quadlet et systemd

```bash
systemctl --user status nicolabz-identity.service
```
Affiche l'état du service et les dernières erreurs.

```bash
systemctl --user start nicolabz-identity.service
systemctl --user stop nicolabz-identity.service
systemctl --user restart nicolabz-identity.service
```
Démarre, arrête ou redémarre l'application.

```bash
systemctl --user daemon-reload
systemctl --user cat nicolabz-identity.service
```
Recharge les fichiers Quadlet puis affiche le service systemd généré. À utiliser après une modification du `.container`.

```bash
cat ~/.config/containers/systemd/nicolabz-identity.container
loginctl show-user nicolas -p Linger
```
Vérifie la configuration et l'activation du démarrage sans session SSH (`Linger=yes`).

## 2. Journaux

```bash
podman logs -f --tail 100 nicolabz-identity
```
Suit en direct les messages produits par l'application Node.js.

```bash
journalctl --user -u nicolabz-identity.service -n 100 --no-pager
journalctl --user -u nicolabz-identity.service -f
```
Affiche les dernières entrées systemd ou suit les erreurs de démarrage en direct.

```bash
journalctl --user -u nicolabz-identity.service -b -p err --no-pager
```
N'affiche que les erreurs enregistrées depuis le dernier démarrage du NAS.

## 3. Conteneur Podman

```bash
podman ps -a
podman images
```
Liste les conteneurs et les images disponibles.

```bash
podman stats --no-stream nicolabz-identity
podman system df
```
Affiche la consommation CPU/RAM du conteneur et l'espace disque Podman.

```bash
podman inspect nicolabz-identity \
  --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```
Affiche les montages du conteneur, sans révéler les variables d'environnement.

## 4. Tester l'API

```bash
curl -i --max-time 5 http://127.0.0.1:3001/health
curl -i --max-time 10 https://auth.nicolabz.dev/health
```
Vérifie l'API **en local**, puis **à travers Nginx/HTTPS**. Résultat attendu : HTTP `200`.

```bash
curl -sS http://127.0.0.1:3001/api/public/status
curl -I https://auth.nicolabz.dev/
```
Affiche les statistiques publiques et contrôle la réponse HTTP de l'accueil.

Dans un navigateur, ouvrir `https://auth.nicolabz.dev/demo` pour tester la connexion Google et Drive.

## 5. Réseau et ports

```bash
sudo ss -ltnp | grep -E ':80 |:443 |:3000 |:3001 '
```
Identifie les processus qui écoutent sur les ports du proxy et des applications.

```bash
sudo ss -ltnp '( sport = :3001 )'
```
Vérifie spécifiquement le port hôte de Nicolabz Identity. Le port `3000` est utilisé par Open WebUI.

```bash
getent ahostsv4 auth.nicolabz.dev
```
Vérifie la résolution DNS IPv4 du domaine.

## 6. Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```
Valide la configuration, puis la recharge **uniquement si le test réussit**.

```bash
ls -l /etc/nginx/sites-enabled/
sudo grep -R 'server_name\|proxy_pass' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
```
Liste les sites actifs et leurs destinations de reverse proxy.

```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```
Suit les erreurs Nginx et les requêtes HTTP. L'emplacement peut varier selon les directives de journalisation des sites.

## 7. Certbot et HTTPS

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```
Affiche les certificats et teste leur renouvellement sans renouvellement réel.

```bash
systemctl status certbot.timer
```
Vérifie le renouvellement programmé lorsque Certbot utilise un timer systemd.

```bash
echo | openssl s_client \
  -connect auth.nicolabz.dev:443 \
  -servername auth.nicolabz.dev 2>/dev/null \
  | openssl x509 -noout -dates -subject
```
Affiche le nom et les dates de validité du certificat présenté publiquement.

## 8. SQLite et volumes

```bash
ls -lah /var/volumes/nicolabz-identity/
namei -l /var/volumes/nicolabz-identity
```
Vérifie la présence de la base et les droits d'accès au répertoire hôte.

```bash
du -sh /var/volumes/nicolabz-identity
df -h /var/volumes
```
Affiche la place occupée par l'application et l'espace disponible sur le disque.

```bash
sqlite3 /var/volumes/nicolabz-identity/identity.sqlite 'PRAGMA integrity_check;'
```
Vérifie l'intégrité SQLite si l'outil `sqlite3` est installé. Résultat attendu : `ok`.

**Sauvegarde à chaud (SQLite)** :

```bash
mkdir -p "$HOME/backups"
sqlite3 /var/volumes/nicolabz-identity/identity.sqlite \
  ".backup '$HOME/backups/nicolabz-identity-$(date +%F-%H%M%S).sqlite'"
```
Crée une sauvegarde cohérente, y compris si SQLite utilise le mode WAL. Ne pas supprimer les fichiers `-wal`/`-shm` pendant que l'application tourne.

## 9. Diagnostic express

```bash
echo '=== SERVICE ==='
systemctl --user is-active nicolabz-identity.service

echo '=== CONTENEUR ==='
podman ps --filter name=nicolabz-identity

echo '=== PORT 3001 ==='
ss -ltnp '( sport = :3001 )'

echo '=== API LOCALE ==='
curl -sS -i --max-time 5 http://127.0.0.1:3001/health

echo '=== API PUBLIQUE ==='
curl -sS -i --max-time 10 https://auth.nicolabz.dev/health

echo '=== DERNIERS LOGS ==='
journalctl --user -u nicolabz-identity.service -n 20 --no-pager
```

## 10. Symptômes fréquents

| Symptôme | Premier contrôle |
|---|---|
| Service Quadlet absent | `systemctl --user daemon-reload` puis `systemctl --user cat nicolabz-identity.service` |
| Conteneur qui échoue au démarrage | `journalctl --user -u nicolabz-identity.service -n 100` |
| `Address already in use` | `sudo ss -ltnp '( sport = :3001 )'` |
| Nginx répond `502` | `curl -i http://127.0.0.1:3001/health` |
| Domaine inaccessible | DNS, pare-feu, Nginx et ports `80/443` |
| Google `403 access_denied` | Liste des testeurs OAuth dans Google Cloud |
| Google `redirect_uri_mismatch` | Callbacks Google et `PUBLIC_BASE_URL` |
| SQLite : `permission denied` | `namei -l /var/volumes/nicolabz-identity` |
| Arrêt après reboot | Vérifier `Linger=yes` et `WantedBy=default.target` dans Quadlet |

**Ordre de diagnostic recommandé :** `systemctl --user status` → `podman logs` → `curl` local → `curl` HTTPS → journaux Nginx.

> Ne publie jamais le contenu de `identity.env`, ni un `podman inspect` complet : ces sorties peuvent contenir des secrets OAuth et de chiffrement.
