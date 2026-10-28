const elements = {
  loading: document.querySelector('#loading'),
  loggedOut: document.querySelector('#logged-out'),
  loggedIn: document.querySelector('#logged-in'),
  error: document.querySelector('#error'),
  login: document.querySelector('#login'),
  logout: document.querySelector('#logout'),
  name: document.querySelector('#user-name'),
  email: document.querySelector('#user-email'),
  avatar: document.querySelector('#avatar')
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
    const session = await requestJson('/api/session');
    if (!session.authenticated) {
      showView('logged-out');
      return;
    }

    const name = session.user.name?.trim() || 'Compte Google';
    elements.name.textContent = name;
    elements.email.textContent = session.user.email;
    elements.avatar.textContent = name.charAt(0).toLocaleUpperCase('fr');
    showView('logged-in');
  } catch (error) {
    showView('logged-out');
    showError(`Impossible de vérifier la session : ${error.message}`);
  }
}

function startGoogleLogin() {
  const url = new URL('/auth/google/start', location.origin);
  url.searchParams.set('app', 'demo');
  url.searchParams.set('return_to', new URL('/demo', location.origin).href);
  location.assign(url.href);
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

elements.login.addEventListener('click', startGoogleLogin);
elements.logout.addEventListener('click', logout);

// Le callback OAuth revient sur /demo?auth=connected. Le paramètre ne prouve
// pas la connexion : seul /api/session fournit l'état de référence.
const url = new URL(location.href);
if (url.searchParams.has('auth')) {
  url.searchParams.delete('auth');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
refreshSession();
