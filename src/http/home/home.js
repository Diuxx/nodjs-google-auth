const ui = {
  indicator: document.querySelector('#status-indicator'),
  status: document.querySelector('#service-status'),
  description: document.querySelector('#status-description'),
  totalUsers: document.querySelector('#total-users'),
  activeUsers: document.querySelector('#active-users'),
  connectedDrives: document.querySelector('#connected-drives'),
  registeredApps: document.querySelector('#registered-apps'),
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

async function refreshOverview() {
  ui.refresh.disabled = true;
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
    ui.refresh.disabled = false;
  }
}

ui.refresh.addEventListener('click', refreshOverview);
refreshOverview();
