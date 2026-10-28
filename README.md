# Nicolabz Identity

**Serveur Node.js d'authentification Google et de synchronisation JSON sur Google Drive**, destiné à plusieurs petites applications web (Todo, Budget, Batch Cooking…), sans Firebase.

- **Authentification** : Google OpenID Connect (code d'autorisation, PKCE, `state`, `nonce`), puis session serveur opaque dans un cookie `HttpOnly`.
- **SSO entre applications web** : une session commune hébergée sur `auth.nicolabz.dev`, consultée par les applications autorisées avec `fetch(..., { credentials: 'include' })`.
- **Synchronisation** : chaque utilisateur sauvegarde un JSON par application dans **son propre Google Drive**, dans l'espace privé `appDataFolder`.
- **Stockage local du serveur** : SQLite (identités, sessions, états OAuth temporaires, jetons Drive chiffrés, index de fichiers).
- **Exploitation** : une instance Node.js derrière Nginx, Podman, volume persistant, limites de taille, gestion des conflits par version.
- **Page de test intégrée** : `/demo`, connexion Google, consentement Drive et création d’un vrai fichier `.txt` dans « Mon Drive », sans serveur frontend supplémentaire.

> **Portée importante** : ceci est une **API centralisée avec Google comme fournisseur OpenID Connect**, et **non un fournisseur OIDC universel**. Les clients sont des applications web s'exécutant dans le navigateur, sur les origines explicitement autorisées. Pour connecter des outils tiers exigeant une découverte OIDC (`/.well-known/openid-configuration`), il faudra ajouter un véritable serveur OIDC (ex. `oidc-provider`) ou déployer Authentik. Les cookies de session ne sont jamais partagés entre les applications : chaque application interroge l'API centrale.

## 1. Schéma

```text
 Navigateur
   ├─ https://todo.nicolabz.dev ──────────────┐
   ├─ https://budget.nicolabz.dev ────────────┤ HTTPS + cookie de l'API
   └─ https://cooking.nicolabz.dev ───────────┘
                         │
                         ▼
                  Nginx / HTTPS
                         │
                         ▼
              auth.nicolabz.dev
                   Node / Fastify
              ┌──────────┴──────────┐
              ▼                     ▼
        Google Login           Google Drive Sync
       OIDC / OAuth 2.0        drive.appdata
              │                     │
              ▼                     ▼
       SQLite + sessions     Google Drive de chaque utilisateur
       + jetons chiffrés     nicolabz.todo.json, etc.
```

### Prérequis

- Node.js **22+** et npm (en local).
- Un compte Google et un projet Google Cloud.
- Pour production : **Podman**, DNS `auth.nicolabz.dev`, **Nginx** avec HTTPS et un certificat TLS valide.
- Les applications clientes doivent être servies en **HTTPS** dans le même site (`*.nicolabz.dev`) pour que le cookie `SameSite=Lax` fonctionne en contexte de navigation et d'appels API entre sous-domaines. En local, utilise `localhost` partout (et non un mélange de `localhost` et `127.0.0.1`).
- Une seule instance Node.js pour cette version (verrouillage des écritures **en mémoire**).

## 2. Configuration de Google Cloud — indispensable

Console : https://console.cloud.google.com/

1. **Créer un projet Google Cloud** (ou en sélectionner un existant).
2. **APIs & Services → Library** : activer **Google Drive API**.
3. **Google Auth Platform / OAuth consent screen** : configurer le nom de l'application, l'adresse e-mail de support, les domaines autorisés et le type d'audience (*External* pour des comptes Google personnels). Ajouter les comptes utilisateurs à la liste des **test users** tant que le projet est en mode Testing.
4. Dans les autorisations (*Data Access*), déclarer les scopes nécessaires : `openid`, `email`, `profile` pour la connexion, **`https://www.googleapis.com/auth/drive.appdata`** pour les JSON de synchronisation et **`https://www.googleapis.com/auth/drive.file`** pour créer un fichier `.txt` visible dans « Mon Drive ». Les permissions Drive sont demandées **séparément**, seulement lors d’une demande d’accès au Drive. La page `/demo` demande les deux scopes Drive ; les autres applications continuent de demander `drive.appdata` uniquement.
5. **Clients → Create client → Web application**. Utiliser le **même client OAuth Google** pour toutes tes applications web : seul le serveur central communique avec Google.
6. Déclarer **exactement** ces **Authorized redirect URIs** :

   **En développement (client de test distinct recommandé)** :

   ```text
   http://localhost:3000/auth/google/callback
   http://localhost:3000/auth/drive/callback
   ```

   **En production** :

   ```text
   https://auth.nicolabz.dev/auth/google/callback
   https://auth.nicolabz.dev/auth/drive/callback
   ```

7. Copier le **Client ID** et le **Client Secret** dans le fichier d'environnement correspondant. Ne jamais placer le secret dans le navigateur, le dépôt Git ou le JSON synchronisé.
8. Si ton application est destinée au public : vérifier ses exigences de publication, de politique de confidentialité et, selon les scopes demandés, de validation Google. **Le mode Testing des projets externes provoque généralement l'expiration du refresh token après 7 jours** pour les scopes autres que de simples informations de profil. Pour une synchronisation durable, utiliser un statut de publication adapté (en respectant les exigences Google).

Documentation Google : [OAuth 2.0 web-server](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata), [Scopes Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

### Deux types de fichiers dans Google Drive

Les **fichiers JSON de synchronisation**, sous `drive.appdata`, sont invisibles dans l'interface classique de Google Drive et accessibles uniquement à cette **application OAuth Google**. Tous tes clients (`todo`, `budget`…) peuvent utiliser les données **par le serveur central**, car il emploie un seul client OAuth. Les autres applications Google Drive ne voient pas ce dossier. Les fichiers peuvent être perdus si l'utilisateur révoque/supprime les données de l'application : **prévoir des exports manuels pour les données importantes**.

Le **fichier TXT de `/demo`** est au contraire créé à la racine de **« Mon Drive »**, avec le scope `drive.file`. Il est visible et téléchargeable dans Google Drive. Le scope `drive.file` autorise l’application à gérer les fichiers créés ou explicitement ouverts avec elle, pas tous les fichiers existants. Le consentement demandé depuis `/demo` utilise l’autorisation incrémentale de Google : il conserve les permissions précédentes. Un nouveau fichier est créé à chaque clic, même si le nom existe déjà.

## 3. Démarrage local

```bash
cp .env.example .env
npm run secret
```

Copier la clé affichée dans `TOKEN_ENCRYPTION_KEY_BASE64` de `.env`, puis ajouter les identifiants Google. Le fichier d'exemple configure `todo` sur `http://localhost:4173` et `budget` sur `http://localhost:4174`.

```bash
npm install
npm test
npm run dev
```

- API : http://localhost:3000/health
- Dans un **deuxième terminal**, démarrer le client web de démonstration :

  ```bash
  cd examples/web-client
  python3 -m http.server 4173 --bind 127.0.0.1
  ```

- Ouvrir **http://localhost:4173**, cliquer sur **Connexion Google**, puis sur **Connecter Drive** ; tester « Sauvegarder » et « Charger ».
- Toujours utiliser `http://localhost:4173` dans le navigateur, pas `http://127.0.0.1:4173`.

### Test intégré de la connexion Google et de la création d’un TXT via `/demo`

**Aucun client Todo/Budget à démarrer pour ce test.** Dès que l'API Node est lancée avec la configuration Google Cloud ci-dessus, ouvre :

- **En local** : [http://localhost:3000/demo](http://localhost:3000/demo)
- **Sur le NAS, derrière Nginx** : `https://auth.nicolabz.dev/demo`

La page propose « Continuer avec Google », affiche le **nom et l'e-mail** après authentification, demande ensuite le consentement Drive et permet de **créer un fichier `.txt` dans « Mon Drive »**, puis de se déconnecter. Le parcours suit exactement les routes existantes :

1. `GET /demo` affiche la page statique rendue par Fastify (HTML/CSS/JS inclus dans l'image Podman).
2. Le bouton passe par `GET /demo/login`, qui construit l’URL de connexion sur **`PUBLIC_BASE_URL`** (et non sur `location.origin`). Il redirige vers `/auth/google/start?app=demo&return_to=<URL-encodée de /demo>` sur le domaine canonique.
3. Google renvoie vers `/auth/google/callback` ; le serveur vérifie les jetons et crée la session SQLite.
4. Retour vers `/demo?auth=connected` ; la page vérifie la session avec `GET /api/session` et affiche le compte réellement connecté (elle ne fait pas confiance au seul paramètre `auth`).
5. Une fois connecté, cliquer sur **« Autoriser Google Drive »**, même si une ancienne connexion Drive pour Todo existe déjà : la page passe par `GET /demo/drive`, puis `/auth/drive/start?app=demo&return_to=...`, et demande `drive.appdata` + `drive.file`.
6. Après consentement, un formulaire de fichier apparaît : choisir un nom terminé par `.txt`, saisir du texte et cliquer sur **« Créer le fichier .txt dans Drive »**.
7. Le navigateur appelle `POST /api/demo/text-file` avec une session valide. Node.js transmet un fichier `text/plain` à l’API Drive, sans `parents: ['appDataFolder']`, puis renvoie son lien. **Le fichier doit apparaître dans « Mon Drive »**.
8. « Se déconnecter » effectue `POST /api/logout` avec le cookie de session.

**Aucune variable d'environnement supplémentaire** ni inscription manuelle de `demo` dans `CLIENT_APPS_JSON` : l'application interne `demo` est déclarée automatiquement avec l'origine exacte de `PUBLIC_BASE_URL` et cet identifiant est réservé. Le domaine de l'API ne doit pas être réutilisé comme origine d'une autre application dans `CLIENT_APPS_JSON`.

Cette page **teste l’authentification et la création d’un fichier texte visible**. Elle ne peut toujours **pas** accéder aux routes de synchronisation `/api/sync/demo` : pour valider les JSON versionnés dans `appDataFolder`, utiliser `examples/web-client/` (Todo) sur son port déclaré. Les URL Google Cloud à enregistrer restent **les callbacks**, notamment `http://localhost:3000/auth/google/callback` ou `https://auth.nicolabz.dev/auth/google/callback` : **ne pas ajouter `/demo` comme URI de redirection Google**. Ne pas utiliser un mélange de `localhost` et `127.0.0.1`, Pour se connecter, le navigateur doit pouvoir atteindre l’origine `PUBLIC_BASE_URL` ; si `/demo` est ouvert par IP ou sur un autre port, le bouton de connexion bascule automatiquement vers cette origine canonique. En production, privilégier l’accès direct par `https://auth.nicolabz.dev/demo` plutôt que par une IP. La page de session ouverte par IP ne partagera pas les cookies avec le domaine canonique.

**Précautions :** les fichiers TXT de la démo ne sont pas supprimés automatiquement. Les noms sont limités à 100 caractères (`.txt` obligatoire), le contenu à **16 Kio UTF-8**, et la route d’écriture n’accepte que l’origine exacte de `PUBLIC_BASE_URL` et une session valide. Pour une instance accessible depuis Internet, configurer **`ALLOWED_EMAILS`** et une limitation de débit au reverse proxy ; cette démo ne doit pas être ouverte librement à des inconnus.

**Migration depuis les versions précédentes :** aucun changement SQLite ni nouvelle variable d’environnement. En revanche, ajouter `drive.file` aux scopes de l’écran de consentement Google Cloud, redéployer l’image Podman, puis cliquer à nouveau sur **« Autoriser / renouveler les permissions Drive »** depuis `/demo` pour autoriser les fichiers visibles. Le booléen `driveConnected` peut être vrai avec un ancien jeton qui ne possède que `drive.appdata` : dans ce cas, un upload renvoie une erreur de permission et le nouveau consentement est nécessaire. **Les URL de callback OAuth ne changent pas.**

Si Google refuse l'accès et renvoie du JSON d'erreur, consulter le tableau de dépannage. Vérifier notamment le compte dans les utilisateurs de test Google Cloud et le filtre `ALLOWED_EMAILS`.

La base est automatiquement créée dans `./data/identity.sqlite` lors du premier démarrage. Le script SQL initial est versionné dans `src/db/migrations/001-initial.sql` (version `PRAGMA user_version=1`).

> **Installation des dépendances** : le projet inclut des versions exactes dans `package.json`. Un `package-lock.json` ne peut être garanti sans accès au registre npm ; lors de ton premier `npm install`, le lockfile sera généré. **Commite ce lockfile** pour des builds reproductibles ; l'image Podman utilisera ensuite `npm ci`.

## 4. Déploiement sur un NAS avec Podman

### 4.1 Préparer le DNS et le HTTPS

- Faire pointer `auth.nicolabz.dev` vers ton serveur (ou ton reverse proxy public).
- Prévoir un certificat valide, p. ex. Let's Encrypt.
- Nginx doit terminer HTTPS et faire le reverse proxy vers **`127.0.0.1:3000`**. Le conteneur n'est **pas exposé directement sur Internet**.
- Adapter le fichier `ops/nginx.conf`, activer le site, puis contrôler la config avec `nginx -t` avant rechargement. Les certificats et la configuration Nginx sont gérés **sur l'hôte**, pas dans le conteneur.

### 4.2 Préparer les secrets d'environnement

Pour un déploiement **Podman rootless** (recommandé) :

```bash
mkdir -p "$HOME/.config/nicolabz-identity"
cp ops/production.env.example "$HOME/.config/nicolabz-identity/identity.env"
chmod 600 "$HOME/.config/nicolabz-identity/identity.env"
npm run secret
```

Modifier `~/.config/nicolabz-identity/identity.env` :

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://auth.nicolabz.dev
DATABASE_PATH=/app/data/identity.sqlite
GOOGLE_CLIENT_ID=TON_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=TON_SECRET
TOKEN_ENCRYPTION_KEY_BASE64=TA_CLE_GENEREE
CLIENT_APPS_JSON=[{"id":"todo","origins":["https://todo.nicolabz.dev"]},{"id":"budget","origins":["https://budget.nicolabz.dev"]}]
SESSION_DAYS=14
ALLOWED_EMAILS=
```

**Important** : `CLIENT_APPS_JSON` doit contenir les origines exactes de **tous** les clients autorisés. Pour démarrer avec **seulement ton propre compte Google**, renseigne `ALLOWED_EMAILS=ton.adresse@gmail.com`. Laisse vide pour laisser s'inscrire tous les comptes Google avec e-mail vérifié.

### 4.3 Construire et démarrer

À la racine du dépôt :

```bash
./ops/deploy-podman.sh
```

Le script exécute ces opérations :

```bash
podman build -t localhost/nicolabz-identity:latest -f Containerfile .
podman volume create nicolabz-identity-data
podman run -d --replace \
  --name nicolabz-identity \
  --restart=unless-stopped \
  --env-file "$HOME/.config/nicolabz-identity/identity.env" \
  -p 127.0.0.1:3000:3000 \
  -v nicolabz-identity-data:/app/data:Z \
  localhost/nicolabz-identity:latest
```

Le `podman volume create` est idempotent dans le script (la commande ci-dessus illustre la première création). Le volume nommé **survit à un remplacement du conteneur**. Sous SELinux, `:Z` ajuste l'étiquetage du montage. Le conteneur tourne avec l'utilisateur non privilégié `node`.

**Attention aux droits d'accès au fichier d'environnement** : le compte Podman doit pouvoir lire le fichier. Évite `sudo` pour lancer Podman uniquement afin de contourner des permissions. Si tu choisis une autre destination, surcharge `ENV_FILE=/chemin/identity.env` au lancement du script.

### 4.4 Contrôler le fonctionnement

```bash
podman ps
podman logs --tail 100 nicolabz-identity
curl -i http://127.0.0.1:3000/health
curl -i https://auth.nicolabz.dev/health
```

Résultat attendu : `{ "status": "ok" }`. **Cela confirme seulement que l'API et SQLite répondent**, pas que Google OAuth et Google Drive sont correctement configurés. **Ouvrir `https://auth.nicolabz.dev/demo`** pour vérifier la connexion Google sans autre application ; pour Drive, utiliser le client d’exemple avec un compte de test.

### 4.5 Démarrage automatique après reboot

La commande `--restart=unless-stopped` gère certains redémarrages de conteneurs mais, avec **Podman rootless**, le démarrage du service utilisateur après reboot dépend du gestionnaire de services. Pour un NAS avec systemd, privilégier un **service Quadlet** plutôt que compter exclusivement sur `--restart` : voir la [documentation Podman Quadlet](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html). Activer la persistance des services utilisateur si nécessaire (`sudo loginctl enable-linger "$USER"`).

### 4.6 Mise à jour et rollback

Depuis le dépôt mis à jour :

```bash
npm test
ENV_FILE="$HOME/.config/nicolabz-identity/identity.env" ./ops/deploy-podman.sh
```

**Sauvegarder SQLite avant une mise à jour** (surtout avant toute future migration). Le script remplace le conteneur, mais pas son volume. Pour revenir à une ancienne version, conserver et réutiliser l'image précédente en veillant à la compatibilité de son schéma SQLite.

## 5. Intégration dans une application web

Pour une application `todo` servie sur `https://todo.nicolabz.dev` :

```js
const API = 'https://auth.nicolabz.dev';

function startGoogleLogin() {
  const url = new URL(`${API}/auth/google/start`);
  url.searchParams.set('app', 'todo');
  url.searchParams.set('return_to', location.href);
  location.assign(url.href);
}

async function getSession() {
  const response = await fetch(`${API}/api/session`, { credentials: 'include' });
  if (!response.ok) throw new Error('Session inaccessible');
  return response.json();
}

function connectGoogleDrive() {
  const url = new URL(`${API}/auth/drive/start`);
  url.searchParams.set('app', 'todo');
  url.searchParams.set('return_to', location.href);
  location.assign(url.href);
}

async function loadTodo() {
  const response = await fetch(`${API}/api/sync/todo`, { credentials: 'include' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error.message);
  return result;  // { appId, version, updatedAt, data }
}

async function saveTodo(version, tasks) {
  const response = await fetch(`${API}/api/sync/todo`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, data: { tasks } })
  });
  const result = await response.json();
  if (response.status === 409) throw new Error(`Conflit : ${result.error.message}`);
  if (!response.ok) throw new Error(result.error.message);
  return result;
}
```

Pour un nouvel outil, **déclarer un identifiant unique et son origine** dans `CLIENT_APPS_JSON`, puis utiliser cet identifiant comme namespace dans `/api/sync/:appId`. **Une origine ne peut appartenir qu'à une seule application**. Les tokens Google sont confinés au serveur et ne sont pas renvoyés aux clients.

## 6. Contrat HTTP

| Méthode | Route | Fonction |
| --- | --- | --- |
| GET | `/health` | Vérification API + SQLite |
| GET | `/demo` | Page HTML intégrée de connexion Google et création TXT |
| GET | `/demo/demo.js`, `/demo/demo.css` | Assets locaux de la page de test |
| GET | `/demo/login` | Connexion Google avec URL publique canonique |
| GET | `/demo/drive` | Autorisation Google Drive pour `demo` (`drive.file` + `drive.appdata`) |
| POST | `/api/demo/text-file` | Crée un `.txt` dans « Mon Drive » (session + origine API exigées) |
| GET | `/auth/google/start?app=todo&return_to=...` | Début de connexion Google (redirection navigateur) |
| GET | `/auth/google/callback` | Callback exclusivement utilisé par Google |
| GET | `/auth/drive/start?app=todo&return_to=...` | Consentement Google Drive, session requise |
| GET | `/auth/drive/callback` | Callback de consentement Drive |
| GET | `/api/session` | `{ authenticated, user, driveConnected }` |
| POST | `/api/logout` | Invalide la session |
| POST | `/api/drive/disconnect` | Révoque si possible et supprime le refresh token local, **sans supprimer les fichiers** |
| GET | `/api/sync/:appId` | Lit le JSON du Drive de l'utilisateur |
| PUT | `/api/sync/:appId` | Sauvegarde `{ "version": 0, "data": { ... } }` |

Exemple de requête de la page de démonstration :

```http
POST /api/demo/text-file
Origin: https://auth.nicolabz.dev
Content-Type: application/json

{"filename":"essai.txt","content":"Bonjour depuis le NAS !"}
```

Réponse HTTP `201` :

```json
{"id":"ID_RETOURNE_PAR_GOOGLE","name":"essai.txt","url":"https://drive.google.com/file/d/ID_RETOURNE_PAR_GOOGLE/view"}
```

Un compte Google autorisé et la session navigateur sont indispensables. Dans le navigateur, le cookie HttpOnly est envoyé automatiquement (`credentials: 'same-origin'`).

Toutes les routes `/api/sync/:appId` exigent **une session valide**, un en-tête `Origin` correspondant à l'application `appId`, et Drive connecté. Les routes de mutation exigent une origine autorisée pour limiter les attaques CSRF. Les appels navigateur doivent utiliser `credentials: 'include'` ; les requêtes `PUT` nécessitent un `Content-Type: application/json`.

Exemple de réponse de lecture :

```json
{
  "appId": "todo",
  "version": 3,
  "updatedAt": "2026-10-28T12:00:00.000Z",
  "data": { "tasks": [{ "id": "a1", "label": "Réviser Linux" }] }
}
```

Si le document n'existe pas : `version: 0`, `updatedAt: null`, `data: null`. Un `PUT` initial doit envoyer `version: 0`. Après écriture, reprendre **la nouvelle version renvoyée par le serveur**. `409 SYNC_CONFLICT` signifie que la version distante a changé : **recharger et fusionner**, ne pas écraser à l'aveugle. Le serveur ne fusionne pas automatiquement les données. **Limite JSON de 1 Mio** par requête HTTP (en pratique, garder les documents nettement plus petits).

Erreurs structurées :

```json
{ "error": { "code": "DRIVE_NOT_CONNECTED", "message": "Connecte Google Drive avant de synchroniser." } }
```

Codes fréquents : `401 UNAUTHENTICATED`, `403 ORIGIN_FORBIDDEN`, `409 DRIVE_NOT_CONNECTED`, `409 SYNC_CONFLICT`, `409 DRIVE_RECONNECT_REQUIRED`, `413 PAYLOAD_TOO_LARGE`, `502 DRIVE_API_FAILED`.

## 7. Sécurité : choix et limites

**Protections intégrées :**

- OpenID Connect Google côté serveur, jeton d'identité vérifié (audience, signature, `nonce`, email vérifié), authorization code + **PKCE**, `state` aléatoire lié à un cookie navigateur et consommé une fois (validité 10 minutes).
- URLs de retour validées strictement sur les origines déclarées : pas d'open redirect.
- Session serveur **opaque**, hachée (SHA-256) en SQLite ; cookie `HttpOnly`, `Secure` en production, `SameSite=Lax`, préfixe `__Host-` en production, sans attribut `Domain`.
- Refresh tokens Drive chiffrés en base avec **AES-256-GCM**. La clé doit rester **hors du volume SQLite** et être sauvegardée séparément. Changer cette clé sans procédure de rotation rend les jetons existants illisibles (reconnexion nécessaire).
- CORS autorise seulement les origines déclarées ; les écritures exigent un en-tête `Origin` autorisé. Un client ne peut accéder qu'à son namespace depuis son origine.
- Limite de corps HTTP, erreurs applicatives non détaillées, accès Drive limité à `drive.appdata` pour la synchronisation et à `drive.file` pour la création des TXT de `/demo`.
- Google Drive et SQLite sont synchronisés avec un index récupérable : le document Google Drive contient la version de référence. Après une interruption entre upload Drive et mise à jour SQLite, l'API peut retrouver le fichier par son nom.

**Limites connues (à prendre en compte avant une ouverture publique importante) :**

- **Ce n'est pas un serveur OIDC tiers** : les clients sont exclusivement des applications web utilisant cette API.
- **Une seule instance** et verrouillage concurrent **en mémoire**. Ne jamais lancer deux réplicas écrivant dans le même espace Drive/SQLite ; les versions peuvent alors entrer en collision. La version 1 n'offre pas de transaction distribuée Drive/SQLite.
- **Pas de synchronisation offline automatique** : à implémenter dans chaque client (file de modifications locales, gestion de conflits et reprise après reconnexion).
- **Pas de fusion JSON** : le client décide quoi faire lors d'un `409`.
- **Pas de quotas par utilisateur ni de limitation de débit applicative** : ajouter un rate limit au reverse proxy et de la supervision avant ouverture à des utilisateurs inconnus.
- **Pas de gestion de plusieurs connexions Google pour un même utilisateur** : un utilisateur interne correspond à un `sub` Google.
- Le **SSO navigateur suppose des sous-domaines du même site**. Sur des domaines de premier niveau distincts, les restrictions sur les cookies tiers peuvent empêcher `credentials: 'include'` de fonctionner. Prévoir alors un vrai fournisseur OIDC pour ces clients.
- Si un client autorisé a une faille XSS, sa session navigateur peut être utilisée contre **son** namespace ; renforcer la CSP et éviter l'injection de HTML dans chaque client.
- Pas d'audit de sécurité externe ni de test réel Google Cloud dans cet environnement de génération. **Ne pas exposer une instance publique sans validation de bout en bout**, tests d'intrusion proportionnés et sauvegardes.

## 8. SQLite : données et sauvegardes

Les tables sont `users`, `sessions`, `oauth_flows`, `drive_credentials`, `sync_files`. **Aucun fichier JSON de l'utilisateur n'est stocké dans SQLite** : seulement un index vers le Drive. `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000` sont configurés au démarrage.

SQLite convient très bien pour un service sur NAS avec un seul processus. **Ne pas placer le fichier SQLite sur NFS/SMB** : utiliser le volume Podman sur le disque local du NAS.

### Sauvegarde cohérente

Ne pas copier à chaud uniquement `identity.sqlite` : avec WAL, les dernières transactions peuvent être dans `identity.sqlite-wal`. Utiliser l'API de backup SQLite, par exemple :

```bash
podman exec nicolabz-identity node --input-type=module -e \
  "import Database from 'better-sqlite3'; const db = new Database('/app/data/identity.sqlite'); await db.backup('/app/data/identity-backup.sqlite'); db.close();"
podman cp nicolabz-identity:/app/data/identity-backup.sqlite ./identity-backup.sqlite
```

Stocker la sauvegarde **chiffrée** et protégée, car elle contient les jetons Drive chiffrés et les sessions hachées. Sauvegarder **séparément** `TOKEN_ENCRYPTION_KEY_BASE64` dans un coffre de secrets. Tester la restauration régulièrement. Pour restaurer : **arrêter le conteneur**, restaurer la sauvegarde au bon emplacement dans le volume et relancer une version compatible du programme.

### Vie privée / déconnexion

`POST /api/drive/disconnect` supprime le token stocké et tente une révocation côté Google ; il ne supprime **pas** les JSON dans Google Drive. `POST /api/logout` supprime uniquement la session en cours. La suppression totale des comptes et données est **hors du périmètre de cette V1** : ne pas promettre une fonction d'effacement complet sans l'implémenter.

## 9. Dépannage

| Symptôme | Cause probable / action |
| --- | --- |
| `INVALID_RETURN_URL` | L’URL `return_to` du démarrage OAuth n’a pas une origine déclarée pour l’application. Pour `/demo`, la version 0.1.2 utilise `/demo/login` pour choisir automatiquement `PUBLIC_BASE_URL`. Vérifier que `PUBLIC_BASE_URL` correspond à l’URL externe réelle (schéma, domaine, port) et que le navigateur peut l’atteindre. Pour les autres applications, vérifier `CLIENT_APPS_JSON` et les URLs envoyées par les clients. Après modification du fichier d’environnement Podman, relancer le déploiement. |
| `redirect_uri_mismatch` | Les URLs Google Cloud doivent correspondre **au caractère près** aux deux callbacks et à `PUBLIC_BASE_URL` (protocole, port, nom). |
| `access_denied` / application non vérifiée | Vérifier consent screen, scopes, test users, restrictions de publication Google. |
| `UNAUTHENTICATED` après login | Utiliser HTTPS sur tous les sous-domaines et `credentials: 'include'`. Vérifier le cookie dans les DevTools. En local : `localhost`, pas `127.0.0.1`. |
| `ORIGIN_FORBIDDEN` | Origine non déclarée, mélange HTTP/HTTPS, mauvais `appId`, ou requête non issue d'un navigateur autorisé. |
| `DRIVE_NOT_CONNECTED` | L'utilisateur n'a pas encore cliqué sur « Connecter Drive ». |
| `DRIVE_RECONNECT_REQUIRED` | Refresh token révoqué/expiré (notamment mode Testing). Relancer le consentement Drive. |
| `DRIVE_ACCESS_DENIED` lors du TXT | Le jeton ne possède pas encore `drive.file`, ou le compte a retiré le consentement. Cliquer sur « Autoriser / renouveler les permissions Drive » depuis `/demo` et accepter l’accès aux fichiers créés par l’application. |
| `DRIVE_FILE_PERMISSION_MISSING` | Le consentement Google a été accordé sans `drive.file` ; vérifier le scope dans Google Cloud puis refaire la connexion Drive. |
| `INVALID_FILENAME`, `TEXT_FILE_TOO_LARGE` | Nom `.txt` incorrect ou contenu de plus de 16 Kio UTF-8. |
| `SYNC_CONFLICT` | Deux appareils ont modifié la même version : recharger et réconcilier. |
| Erreur d'écriture SQLite | Vérifier les droits du volume Podman, l'utilisateur `node` et l'espace disque. |
| Serveur joignable seulement localement | Vérifier Nginx et DNS ; le port `3000` est volontairement lié à `127.0.0.1` sur l'hôte. |
| Échec `npm ci` / construction native | Vérifier la version de Node et la compatibilité `better-sqlite3` ; l'étape de build installe Python, make, g++ pour les modules natifs. |

## 10. Organisation du dépôt

```text
src/
├── server.js                  # Composition et cycle de vie
├── config.js                  # Validation stricte des variables
├── auth/
│   ├── auth-service.js       # SSO, états OAuth, sessions et compte Drive
│   └── google-auth.js        # Protocole Google, validation OpenID
├── db/
│   ├── database.js           # SQLite/WAL/migration
│   ├── migrations/           # SQL versionné
│   └── repositories.js       # Accès SQL
├── drive/
│   └── google-drive.js       # Drive API, appDataFolder, tokens d'accès
├── sync/
│   ├── sync-service.js       # Versions, conflits, règles métier
│   └── keyed-mutex.js        # Sérialisation des écritures par document
├── http/
│   ├── app.js                # Routes, CORS, schémas HTTP, erreurs
│   ├── demo/                 # Page /demo : HTML, CSS, JS, consentement, création TXT
│   └── cookies.js            # Paramètres de cookies
└── lib/
    ├── crypto.js             # AES-256-GCM, hachage, PKCE
    ├── client-apps.js        # Clients et URLs autorisés
    └── errors.js
```

`tests/` contient des tests de logique OAuth (avec doubles), sécurité, synchronisation, pages `/demo` et appels Drive simulés. `examples/web-client/` permet de valider l'intégration réelle dans un navigateur, une fois Google Cloud configuré. `ops/` contient le déploiement Podman et la configuration Nginx de référence.

## 11. Vérifications

```bash
npm run check  # Analyse syntaxique des fichiers JS via node --check
npm test       # Tests unitaires / simulation des API
curl http://localhost:3000/health
```

Les tests utilisent `node:test` et n'envoient **aucune** requête à Google (les tests HTTP utilisent des requêtes Fastify injectées). Un test d'intégration réel doit être réalisé avec un compte Google de test, un navigateur et les deux URLs de redirection enregistrées dans Google Cloud.

---

**Architecture volontairement légère** : un service Node.js, une base SQLite, et le Drive personnel de chaque utilisateur. L'objectif est de faire évoluer séparément l'authentification, les clients et la synchronisation, sans réécrire toute la plateforme.
