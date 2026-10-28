// Adapter les constantes au client déclaré dans CLIENT_APPS_JSON.
const AUTH_BASE = 'http://localhost:3000';
const APP_ID = 'todo';
let remoteVersion = 0;

const status = document.querySelector('#status');
const editor = document.querySelector('#editor');

function redirectTo(path) {
  const url = new URL(`${AUTH_BASE}${path}`);
  url.searchParams.set('app', APP_ID);
  url.searchParams.set('return_to', location.origin + location.pathname);
  location.assign(url.href);
}

async function api(path, options = {}) {
  const response = await fetch(`${AUTH_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error?.code || response.status}: ${body.error?.message || 'Erreur'}`);
  return body;
}

async function run(action) {
  try { await action(); } catch (error) { status.textContent = error.message; }
}

async function updateSession() {
  const session = await api('/api/session');
  status.textContent = session.authenticated
    ? `Compte : ${session.user.email}\nDrive : ${session.driveConnected ? 'connecté' : 'non connecté'}\nVersion locale : ${remoteVersion}`
    : 'Non connecté : commence par la connexion Google.';
}

document.querySelector('#login').addEventListener('click', () => redirectTo('/auth/google/start'));
document.querySelector('#drive').addEventListener('click', () => redirectTo('/auth/drive/start'));
document.querySelector('#logout').addEventListener('click', () => run(async () => {
  await api('/api/logout', { method: 'POST' });
  remoteVersion = 0;
  await updateSession();
}));
document.querySelector('#load').addEventListener('click', () => run(async () => {
  const document = await api(`/api/sync/${APP_ID}`);
  remoteVersion = document.version;
  editor.value = JSON.stringify(document.data ?? { tasks: [] }, null, 2);
  await updateSession();
}));
document.querySelector('#save').addEventListener('click', () => run(async () => {
  const data = JSON.parse(editor.value);
  const document = await api(`/api/sync/${APP_ID}`, {
    method: 'PUT', body: JSON.stringify({ version: remoteVersion, data })
  });
  remoteVersion = document.version;
  await updateSession();
}));

run(updateSession);
