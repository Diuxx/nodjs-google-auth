const ui = {
  indicator: document.querySelector('#status-indicator'),
  status: document.querySelector('#service-status'),
  description: document.querySelector('#status-description'),
  totalUsers: document.querySelector('#total-users'),
  activeUsers: document.querySelector('#active-users'),
  connectedDrives: document.querySelector('#connected-drives'),
  registeredApps: document.querySelector('#registered-apps'),
  applicationsStatus: document.querySelector('#applications-status'),
  applicationsList: document.querySelector('#applications-list'),
  lastCheck: document.querySelector('#last-check'),
  refresh: document.querySelector('#refresh')
};

const numberFormatter = new Intl.NumberFormat('fr-FR');
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const counters = [ui.totalUsers, ui.activeUsers, ui.connectedDrives, ui.registeredApps];

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

async function refreshApplications() {
  ui.applicationsStatus.textContent = 'Chargement des applications…';
  ui.applicationsList.replaceChildren();

  try {
    const response = await fetch('/api/public/applications', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.applications) || !result.applications.every(application =>
      application && typeof application.id === 'string' &&
      Array.isArray(application.origins) && application.origins.length > 0 &&
      application.origins.every(origin => typeof origin === 'string'))) {
      throw new Error('Liste des applications invalide');
    }

    for (const application of result.applications) {
      const row = document.createElement('li');
      row.className = 'application-row';
      const id = document.createElement('strong');
      id.className = 'application-id';
      id.textContent = application.id;
      const origins = document.createElement('ul');
      origins.className = 'application-origins';
      origins.setAttribute('aria-label', `Origines autorisées pour ${application.id}`);
      for (const origin of application.origins) {
        const item = document.createElement('li');
        item.textContent = origin;
        origins.append(item);
      }
      row.append(id, origins);
      ui.applicationsList.append(row);
    }
    ui.applicationsStatus.textContent = result.applications.length ? '' : 'Aucune application configurée.';
  } catch {
    ui.applicationsList.replaceChildren();
    ui.applicationsStatus.textContent = 'Impossible de charger les applications autorisées.';
  }
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
    await Promise.all([refreshOverview(), refreshApplications()]);
  } finally {
    ui.refresh.disabled = false;
  }
}

ui.refresh.addEventListener('click', refreshPage);
refreshPage();
