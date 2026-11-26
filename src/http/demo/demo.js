const providerLabels = { google: 'Google', facebook: 'Facebook', github: 'GitHub' };

const elements = {
  loading: document.querySelector('#loading'),
  loggedOut: document.querySelector('#logged-out'),
  loggedIn: document.querySelector('#logged-in'),
  error: document.querySelector('#error'),
  login: document.querySelector('#login'),
  logout: document.querySelector('#logout'),
  name: document.querySelector('#user-name'),
  email: document.querySelector('#user-email'),
  avatar: document.querySelector('#avatar'),
  driveStatus: document.querySelector('#drive-status'),
  connectDrive: document.querySelector('#connect-drive'),
  form: document.querySelector('#text-file-form'),
  filename: document.querySelector('#filename'),
  content: document.querySelector('#content'),
  saveFile: document.querySelector('#save-file'),
  fileResult: document.querySelector('#file-result'),
  fileResultName: document.querySelector('#file-result-name'),
  fileResultLink: document.querySelector('#file-result-link')
};

function showView(view) {
  elements.loading.hidden = view !== 'loading';
  elements.loggedOut.hidden = view !== 'logged-out';
  elements.loggedIn.hidden = view !== 'logged-in';
}

function showError(message) {
  elements.error.hidden = !message;
  elements.error.textContent = message ?? '';
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? `Erreur HTTP ${response.status}`);
  return result;
}

async function refreshSession() {
  showView('loading');
  showError(null);
  try {
    const [session, { providers }] = await Promise.all([
      requestJson('/api/session'), requestJson('/api/auth/providers')
    ]);
    for (const provider of ['facebook', 'github']) {
      document.querySelector(`#login-${provider}`).hidden = !providers.includes(provider);
    }
    if (!session.authenticated) {
      showView('logged-out');
      return;
    }

    const name = session.user.name?.trim() || 'Compte';
    elements.name.textContent = name;
    elements.email.textContent = session.user.email ?? 'Adresse e-mail non disponible';
    elements.avatar.textContent = name.charAt(0).toLocaleUpperCase('fr');
    elements.driveStatus.textContent = session.driveConnected ? 'Drive connecté' : 'Drive non connecté';
    elements.connectDrive.textContent = session.driveConnected
      ? 'Autoriser / renouveler les permissions Drive'
      : 'Autoriser Google Drive';
    elements.form.hidden = !session.driveConnected;
    await renderIdentities(providers);
    showView('logged-in');
  } catch (error) {
    showView('logged-out');
    showError(`Impossible de vérifier la session : ${error.message}`);
  }
}

async function renderIdentities(enabled) {
  const { providers: linked } = await requestJson('/api/auth/identities');
  document.querySelector('#linked-identities').textContent = linked.map(provider => providerLabels[provider]).join(' · ');
  const container = document.querySelector('#link-providers');
  container.replaceChildren();
  for (const provider of enabled.filter(name => !linked.includes(name))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button provider-button';
    button.textContent = `Associer ${providerLabels[provider]}`;
    button.addEventListener('click', () => linkIdentity(provider, button));
    container.append(button);
  }
}

async function linkIdentity(provider, button) {
  button.disabled = true;
  showError(null);
  try {
    const { redirectUrl } = await requestJson(`/auth/${provider}/link`, { method: 'POST' });
    location.assign(redirectUrl);
  } catch (error) {
    showError(`Association impossible : ${error.message}`);
    button.disabled = false;
  }
}

function startGoogleLogin() {
  // Le serveur détermine l’URL publique autorisée : jamais location.origin.
  location.assign('/demo/login');
}

async function logout() {
  elements.logout.disabled = true;
  showError(null);
  try {
    await requestJson('/api/logout', { method: 'POST' });
    await refreshSession();
  } catch (error) {
    showError(`Déconnexion impossible : ${error.message}`);
  } finally {
    elements.logout.disabled = false;
  }
}

function authorizeDrive() {
  // Comme pour la connexion, l’URL de retour est construite côté serveur.
  location.assign('/demo/drive');
}

async function saveTextFile(event) {
  event.preventDefault();
  elements.saveFile.disabled = true;
  elements.fileResult.hidden = true;
  showError(null);
  try {
    const saved = await requestJson('/api/demo/text-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: elements.filename.value, content: elements.content.value })
    });
    elements.fileResultName.textContent = saved.name;
    elements.fileResultLink.href = saved.url;
    elements.fileResult.hidden = false;
  } catch (error) {
    showError(`Impossible de créer le fichier : ${error.message}`);
  } finally {
    elements.saveFile.disabled = false;
  }
}

elements.login.addEventListener('click', startGoogleLogin);
for (const provider of ['facebook', 'github']) {
  document.querySelector(`#login-${provider}`).addEventListener('click', () => location.assign(`/demo/login/${provider}`));
}
elements.logout.addEventListener('click', logout);
elements.connectDrive.addEventListener('click', authorizeDrive);
elements.form.addEventListener('submit', saveTextFile);

// Le callback OAuth revient sur /demo?auth=connected. Le paramètre ne prouve
// pas la connexion : seul /api/session fournit l'état de référence.
const url = new URL(location.href);
if (url.searchParams.has('auth') || url.searchParams.has('drive') || url.searchParams.has('identity')) {
  url.searchParams.delete('auth');
  url.searchParams.delete('drive');
  url.searchParams.delete('identity');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
refreshSession();
