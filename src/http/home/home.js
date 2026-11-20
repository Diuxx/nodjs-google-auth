const ui = {
  indicator: document.querySelector('#status-indicator'),
  status: document.querySelector('#service-status'),
  description: document.querySelector('#status-description'),
  totalUsers: document.querySelector('#total-users'),
  activeUsers: document.querySelector('#active-users'),
  connectedDrives: document.querySelector('#connected-drives'),
  registeredApps: document.querySelector('#registered-apps'),
  lastCheck: document.querySelector('#last-check'),
  refresh: document.querySelector('#refresh'),
  applicationsList: document.querySelector('#applications-list'),
  applicationsMessage: document.querySelector('#applications-message'),
  countFiles: document.querySelector('#count-files')
};

const numberFormatter = new Intl.NumberFormat('fr-FR');
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const counters = [ui.totalUsers, ui.activeUsers, ui.connectedDrives, ui.registeredApps];
let applications = [];

function showStatus(status, description) {
  ui.indicator.classList.toggle('is-error', status === 'error');
  ui.indicator.classList.toggle('is-loading', status === 'loading');
  ui.status.textContent = {
    ok: 'API opérationnelle',
    loading: 'Vérification…',
    error: 'Statut indisponible'
  }[status];
  ui.description.textContent = description;
}

function displayStatistics(statistics) {
  const values = [
    statistics.totalUsers,
    statistics.activeUsers,
    statistics.connectedDrives,
    statistics.registeredApplications
  ];

  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Statistiques invalides');
  }

  counters.forEach((counter, index) => {
    counter.textContent = numberFormatter.format(values[index]);
  });
}

async function refreshOverview() {
  showStatus('loading', 'Contrôle de l’API et de SQLite');

  try {
    const response = await fetch('/api/public/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    if (result.status !== 'ok' || result.checks?.api !== 'ok' || result.checks?.sqlite !== 'ok') {
      throw new Error('Contrôles locaux non confirmés');
    }

    displayStatistics(result.statistics);
    showStatus('ok', 'API et base SQLite accessibles');
  } catch {
    counters.forEach(counter => { counter.textContent = '—'; });
    showStatus('error', 'Impossible de vérifier le service local');
  } finally {
    ui.lastCheck.textContent = timeFormatter.format(new Date());
  }
}

async function refreshPage() {
  ui.refresh.disabled = true;
  try {
    await Promise.all([refreshOverview(), loadApplications()]);
  } finally {
    ui.refresh.disabled = false;
  }
}

function addLabel(row, text, className) {
  const label = document.createElement('span');
  label.className = className;
  label.textContent = text;
  row.append(label);
  return label;
}

async function loadApplications() {
  applications = [];
  ui.applicationsList.replaceChildren();
  ui.countFiles.disabled = true;
  try {
    const response = await fetch('/api/public/applications', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.applications) || !result.applications.every(app =>
      app && typeof app.id === 'string' && typeof app.requiresDrive === 'boolean' && typeof app.multiple === 'boolean')) {
      throw new Error('Configuration des applications invalide');
    }
    applications = result.applications.map(app => {
      const row = document.createElement('li');
      row.className = 'application-row';
      addLabel(row, app.id, 'application-name');
      addLabel(row, app.requiresDrive ? 'Drive requis à la connexion' : 'Drive facultatif', 'chip enabled');
      addLabel(row, app.multiple ? 'Multi-fichiers' : 'Fichier unique', 'chip planned');
      const count = addLabel(row, 'Fichiers : non comptés', 'application-count');
      count.setAttribute('role', 'status');
      ui.applicationsList.append(row);
      return { id: app.id, count };
    });
    ui.applicationsMessage.textContent = applications.length
      ? 'Connectez-vous, puis lancez le comptage pour votre compte.'
      : 'Aucune application configurée.';
    ui.countFiles.disabled = applications.length === 0;
  } catch {
    ui.applicationsMessage.textContent = 'Impossible de charger les applications.';
    ui.countFiles.disabled = true;
  }
}

async function countApplicationFiles() {
  ui.countFiles.disabled = true;
  let hasError = false;
  let needsLogin = false;
  for (const app of applications) {
    app.count.textContent = 'Comptage…';
    try {
      const response = await fetch(`/api/home/applications/${encodeURIComponent(app.id)}/file-count`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) {
        hasError = true;
        if (result.error?.code === 'UNAUTHENTICATED') {
          needsLogin = true;
          app.count.textContent = 'Connexion requise';
        } else if (result.error?.code === 'DRIVE_NOT_CONNECTED') {
          app.count.textContent = 'Drive non connecté';
        } else if (['DRIVE_RECONNECT_REQUIRED', 'DRIVE_ACCESS_DENIED'].includes(result.error?.code)) {
          app.count.textContent = 'Drive à réautoriser';
        } else {
          app.count.textContent = 'Comptage indisponible';
        }
        continue;
      }
      if (result.appId !== app.id || !Number.isSafeInteger(result.total) || result.total < 0) {
        throw new Error('Comptage invalide');
      }
      app.count.textContent = `Fichiers : ${numberFormatter.format(result.total)}`;
    } catch {
      hasError = true;
      app.count.textContent = 'Comptage indisponible';
    }
  }
  ui.applicationsMessage.textContent = needsLogin
    ? 'Connectez-vous, puis lancez le comptage pour votre compte.'
    : hasError ? 'Certains comptages sont indisponibles.' : 'Comptage terminé pour votre compte.';
  ui.countFiles.disabled = false;
}

ui.refresh.addEventListener('click', refreshPage);
ui.countFiles.addEventListener('click', countApplicationFiles);
refreshPage();
