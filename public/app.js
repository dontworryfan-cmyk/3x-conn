const statusEl = document.querySelector('#status');
const setupCard = document.querySelector('#setup-card');
const loginCard = document.querySelector('#login-card');
const appCard = document.querySelector('#app-card');
const setupForm = document.querySelector('#setup-form');
const setupResult = document.querySelector('#setup-result');
const loginForm = document.querySelector('#login-form');
const totpForm = document.querySelector('#totp-form');
const panelsList = document.querySelector('#panels-list');
const addPanelForm = document.querySelector('#add-panel-form');
const settingsForm = document.querySelector('#settings-form');

let tempToken = '';
let panels = [];

function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.style.color = error ? '#ff9f9f' : '';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

function toggleView({ setup = false, login = false, app = false }) {
  setupCard.classList.toggle('hidden', !setup);
  loginCard.classList.toggle('hidden', !login);
  appCard.classList.toggle('hidden', !app);
}

function panelItem(panel) {
  const ping = panel.lastPing ? `${panel.lastPing.ok ? '✅' : '❌'} ${panel.lastPing.latencyMs}ms` : 'нет данных';
  return `<li class="panel-item">
    <div class="panel-main">
      <label class="inline"><input type="checkbox" name="panel-select" value="${panel.id}" checked /> ${panel.name}</label>
      <div class="row">
        <button class="ghost" data-ping="${panel.id}">Пинг</button>
        <button class="ghost" data-delete="${panel.id}">Удалить</button>
      </div>
    </div>
    <div class="panel-meta">${panel.subscriptionUrl}</div>
    <div class="panel-meta">Текущий пинг: ${ping}</div>
  </li>`;
}

function renderPanels() {
  panelsList.innerHTML = panels.length ? panels.map(panelItem).join('') : '<li class="panel-item">Локации не добавлены.</li>';
}

async function loadPanels() {
  panels = await api('/api/panels', { method: 'GET', headers: {} });
  renderPanels();
}

async function loadSettings() {
  const s = await api('/api/settings', { method: 'GET', headers: {} });
  document.querySelector('#subscription-title').value = s.subscriptionTitle || '';
  document.querySelector('#support-url').value = s.supportUrl || '';
  document.querySelector('#announcement').value = s.announcement || '';
  document.querySelector('#install-command').value = s.installCommand || '';
  document.querySelector('#tg-enabled').checked = Boolean(s.telegram?.enabled);
  document.querySelector('#tg-token').value = s.telegram?.botToken || '';
  document.querySelector('#tg-admin-id').value = s.telegram?.adminId || '';
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({
        username: document.querySelector('#setup-username').value,
        password: document.querySelector('#setup-password').value
      })
    });
    setupResult.textContent = `Секрет 2FA: ${data.totpSecret}\nOTPAuth: ${data.otpauth}`;
    setStatus('Администратор создан. Войдите с 2FA.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.querySelector('#login-username').value,
        password: document.querySelector('#login-password').value
      })
    });
    tempToken = data.tempToken;
    totpForm.classList.remove('hidden');
    setStatus('Введите код 2FA.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

totpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code: document.querySelector('#totp-code').value })
    });
    await bootApp();
  } catch (error) {
    setStatus(error.message, true);
  }
});

addPanelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/panels', {
      method: 'POST',
      body: JSON.stringify({ name: document.querySelector('#panel-name').value, subscriptionUrl: document.querySelector('#panel-url').value })
    });
    addPanelForm.reset();
    await loadPanels();
    setStatus('Локация добавлена.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

panelsList.addEventListener('click', async (event) => {
  const btn = event.target;
  if (!(btn instanceof HTMLButtonElement)) return;
  try {
    if (btn.dataset.delete) {
      await api(`/api/panels/${btn.dataset.delete}`, { method: 'DELETE', headers: {} });
      await loadPanels();
      setStatus('Локация удалена.');
    }
    if (btn.dataset.ping) {
      await api(`/api/panels/${btn.dataset.ping}/ping`, { method: 'POST', body: '{}' });
      await loadPanels();
      setStatus('Ручной пинг выполнен.');
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#ping-all').addEventListener('click', async () => {
  try {
    await api('/api/panels/ping-all', { method: 'POST', body: '{}' });
    await loadPanels();
    setStatus('Пинг всех локаций завершен.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#generate-link').addEventListener('click', async () => {
  try {
    const ids = [...document.querySelectorAll('input[name="panel-select"]:checked')].map((i) => i.value);
    const data = await api('/api/subscriptions/generate', { method: 'POST', body: JSON.stringify({ panelIds: ids }) });
    document.querySelector('#merged-url').textContent = data.mergedUrl;
    document.querySelector('#result').classList.remove('hidden');
    setStatus('URL подписки готов.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#copy-link').addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.querySelector('#merged-url').textContent || '');
  setStatus('URL скопирован.');
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        subscriptionTitle: document.querySelector('#subscription-title').value,
        supportUrl: document.querySelector('#support-url').value,
        announcement: document.querySelector('#announcement').value,
        installCommand: document.querySelector('#install-command').value,
        telegram: {
          enabled: document.querySelector('#tg-enabled').checked,
          botToken: document.querySelector('#tg-token').value,
          adminId: document.querySelector('#tg-admin-id').value
        }
      })
    });
    setStatus('Настройки сохранены.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  window.location.reload();
});

async function bootApp() {
  toggleView({ app: true });
  await loadPanels();
  await loadSettings();
}

(async () => {
  try {
    const state = await api('/api/auth/state', { method: 'GET', headers: {} });
    if (state.setupRequired) {
      toggleView({ setup: true });
      return;
    }
    if (!state.user) {
      toggleView({ login: true });
      return;
    }
    await bootApp();
  } catch (error) {
    setStatus(error.message, true);
  }
})();
