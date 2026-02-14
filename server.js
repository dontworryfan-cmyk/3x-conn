const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const FILES = {
  panels: path.join(DATA_DIR, 'panels.json'),
  tokens: path.join(DATA_DIR, 'tokens.json'),
  users: path.join(DATA_DIR, 'users.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  temp2fa: path.join(DATA_DIR, 'temp2fa.json')
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8'
};

let telegramLoopRunning = false;

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function normalizeUrl(url) {
  try {
    return new URL(String(url).trim()).toString();
  } catch {
    return null;
  }
}

function sanitizePanel(input) {
  const name = String(input.name || '').trim();
  const subscriptionUrl = String(input.subscriptionUrl || '').trim();

  if (!name) {
    return { error: 'Название локации обязательно.' };
  }

  const normalizedUrl = normalizeUrl(subscriptionUrl);
  if (!normalizedUrl) {
    return { error: 'Введите корректный URL подписки.' };
  }

  return { name, subscriptionUrl: normalizedUrl };
}

function sendJson(res, statusCode, payload, cookie) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (cookie) {
    headers['set-cookie'] = cookie;
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(payload);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const pairs = raw.split(';').map((v) => v.trim()).filter(Boolean);
  const cookies = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookies[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
  }
  return cookies;
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, savedHash) {
  const [saltHex, keyHex] = String(savedHash || '').split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  const derived = Buffer.from(await scrypt(password, salt, key.length));
  if (derived.length !== key.length) return false;
  return crypto.timingSafeEqual(derived, key);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function randomBase32(length = 32) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return out;
}

function base32ToBuffer(secret) {
  let bits = '';
  const clean = secret.replace(/=+$/, '').toUpperCase();
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret, step = 30, digits = 6, timeMs = Date.now()) {
  const counter = Math.floor(timeMs / 1000 / step);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32ToBuffer(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

function verifyTotp(secret, code) {
  const candidate = String(code || '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const now = Date.now();
  for (const offset of [-30000, 0, 30000]) {
    if (totpCode(secret, 30, 6, now + offset) === candidate) return true;
  }
  return false;
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies.session_token;
  if (!token) return null;
  const sessions = await readJson(FILES.sessions, {});
  const session = sessions[token];
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) return null;
  const users = await readJson(FILES.users, []);
  return users.find((user) => user.id === session.userId) || null;
}

async function requireAuth(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Требуется авторизация.' });
    return null;
  }
  return user;
}

async function pingLocation(panel) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(panel.subscriptionUrl, { method: 'GET', signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function pingAllPanels(panels) {
  const results = {};
  for (const panel of panels) {
    results[panel.id] = await pingLocation(panel);
  }
  return results;
}

async function fetchSubscriptionLines(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return text.split(/\r?\n/).map((v) => v.trim()).filter((v) => v && !v.startsWith('#'));
  } finally {
    clearTimeout(timeout);
  }
}

function isHappClient(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  return ua.includes('happ');
}

async function serveStatic(res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function requestUrl(req) {
  return new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
}

async function telegramRequest(token, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function sendTelegramMessage(settings, text, extra = {}) {
  if (!settings.telegram?.botToken || !settings.telegram?.adminId) return;
  await telegramRequest(settings.telegram.botToken, 'sendMessage', {
    chat_id: settings.telegram.adminId,
    text,
    parse_mode: 'Markdown',
    ...extra
  });
}

async function buildStatusText() {
  const panels = await readJson(FILES.panels, []);
  if (panels.length === 0) {
    return '*Локации не добавлены.*';
  }
  const pingMap = await pingAllPanels(panels);
  const lines = ['*Статус серверов:*'];
  let allOk = true;
  panels.forEach((panel, index) => {
    const p = pingMap[panel.id];
    const mark = p.ok ? '✅' : '❌';
    if (!p.ok) allOk = false;
    lines.push(`${index + 1}. ${mark} ${panel.name} — ${p.latencyMs}ms`);
  });
  lines.push(allOk ? '\n*все в порядке*' : '\n*есть проблемы с локациями*');
  return lines.join('\n');
}

async function handleTelegramCommands(settings, update) {
  const msg = update.message;
  if (!msg || String(msg.chat?.id) !== String(settings.telegram.adminId)) return;

  const text = String(msg.text || '').trim();
  if (!text) return;

  if (text === '/start' || text === '/menu') {
    await telegramRequest(settings.telegram.botToken, 'sendMessage', {
      chat_id: settings.telegram.adminId,
      text: 'Главное меню бота',
      reply_markup: {
        keyboard: [[{ text: '/status' }, { text: '/ping' }], [{ text: '/menu' }]],
        resize_keyboard: true
      }
    });
    return;
  }

  if (text === '/status') {
    await sendTelegramMessage(settings, await buildStatusText());
    return;
  }

  if (text === '/ping') {
    await sendTelegramMessage(settings, `*Ручной пинг выполнен*\n${await buildStatusText()}`);
    return;
  }

  if (text.startsWith('/add ')) {
    const args = text.slice(5).split(' ');
    const name = args.shift();
    const subscriptionUrl = args.join(' ');
    const prepared = sanitizePanel({ name, subscriptionUrl });
    if (prepared.error) {
      await sendTelegramMessage(settings, `❌ ${prepared.error}`);
      return;
    }
    const panels = await readJson(FILES.panels, []);
    const panel = { id: crypto.randomUUID(), ...prepared, createdAt: new Date().toISOString() };
    panels.push(panel);
    await writeJson(FILES.panels, panels);
    await sendTelegramMessage(settings, `✅ Локация добавлена: *${panel.name}*`);
    return;
  }

  if (text.startsWith('/delete ')) {
    const id = text.slice(8).trim();
    const panels = await readJson(FILES.panels, []);
    const next = panels.filter((panel) => panel.id !== id);
    if (next.length === panels.length) {
      await sendTelegramMessage(settings, '❌ Локация не найдена по ID.');
      return;
    }
    await writeJson(FILES.panels, next);
    await sendTelegramMessage(settings, '✅ Локация удалена.');
  }
}

async function ensureTelegramPolling() {
  if (telegramLoopRunning) return;
  telegramLoopRunning = true;

  setInterval(async () => {
    try {
      const settings = await readJson(FILES.settings, {});
      const tg = settings.telegram || {};
      if (!tg.enabled || !tg.botToken || !tg.adminId) return;

      const updates = await telegramRequest(tg.botToken, 'getUpdates', {
        offset: (tg.lastUpdateId || 0) + 1,
        timeout: 0
      });
      if (!updates.ok || !Array.isArray(updates.result)) return;

      for (const update of updates.result) {
        await handleTelegramCommands(settings, update);
        tg.lastUpdateId = update.update_id;
      }

      settings.telegram = tg;
      await writeJson(FILES.settings, settings);
    } catch (error) {
      console.error('Telegram polling error:', error.message);
    }
  }, 5000);
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/state') {
    const users = await readJson(FILES.users, []);
    const user = await getCurrentUser(req);
    sendJson(res, 200, { setupRequired: users.length === 0, user: user ? { username: user.username } : null });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/setup') {
    const users = await readJson(FILES.users, []);
    if (users.length > 0) {
      sendJson(res, 400, { error: 'Пользователь уже создан.' });
      return true;
    }
    const body = await collectBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'Некорректный JSON.' });
      return true;
    }
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 3 || password.length < 10) {
      sendJson(res, 400, { error: 'Логин >=3 символов, пароль >=10 символов.' });
      return true;
    }

    const totpSecret = randomBase32();
    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: await hashPassword(password),
      totpSecret,
      createdAt: new Date().toISOString()
    };
    await writeJson(FILES.users, [user]);
    sendJson(res, 201, {
      message: 'Администратор создан. Сохраните секрет 2FA.',
      totpSecret,
      otpauth: `otpauth://totp/3XConnect:${encodeURIComponent(username)}?secret=${totpSecret}&issuer=3XConnect`
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await collectBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'Некорректный JSON.' });
      return true;
    }
    const users = await readJson(FILES.users, []);
    const user = users.find((item) => item.username === String(body.username || '').trim());
    if (!user || !(await verifyPassword(String(body.password || ''), user.passwordHash))) {
      sendJson(res, 401, { error: 'Неверный логин или пароль.' });
      return true;
    }

    const tempToken = crypto.randomBytes(16).toString('hex');
    const tempData = await readJson(FILES.temp2fa, {});
    tempData[tempToken] = { userId: user.id, expiresAt: Date.now() + 180000 };
    await writeJson(FILES.temp2fa, tempData);
    sendJson(res, 200, { tempToken, require2fa: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/verify-2fa') {
    const body = await collectBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'Некорректный JSON.' });
      return true;
    }
    const tempData = await readJson(FILES.temp2fa, {});
    const payload = tempData[String(body.tempToken || '')];
    if (!payload || payload.expiresAt < Date.now()) {
      sendJson(res, 401, { error: 'Сессия 2FA истекла.' });
      return true;
    }
    const users = await readJson(FILES.users, []);
    const user = users.find((item) => item.id === payload.userId);
    if (!user || !verifyTotp(user.totpSecret, body.code)) {
      sendJson(res, 401, { error: 'Неверный код 2FA.' });
      return true;
    }

    const sessions = await readJson(FILES.sessions, {});
    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessions[sessionToken] = { userId: user.id, expiresAt: new Date(Date.now() + 86400000).toISOString() };
    delete tempData[String(body.tempToken || '')];
    await writeJson(FILES.sessions, sessions);
    await writeJson(FILES.temp2fa, tempData);
    sendJson(res, 200, { ok: true }, `session_token=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const cookies = parseCookies(req);
    const sessions = await readJson(FILES.sessions, {});
    delete sessions[cookies.session_token];
    await writeJson(FILES.sessions, sessions);
    sendJson(res, 200, { ok: true }, 'session_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/panels') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const panels = await readJson(FILES.panels, []);
    sendJson(res, 200, panels);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/panels') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await collectBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'Некорректный JSON.' });
      return true;
    }
    const payload = sanitizePanel(body);
    if (payload.error) {
      sendJson(res, 400, { error: payload.error });
      return true;
    }
    const panels = await readJson(FILES.panels, []);
    const panel = { id: crypto.randomUUID(), ...payload, createdAt: new Date().toISOString() };
    panels.push(panel);
    await writeJson(FILES.panels, panels);
    sendJson(res, 201, panel);
    return true;
  }

  const panelIdMatch = url.pathname.match(/^\/api\/panels\/([a-zA-Z0-9-]+)$/);
  if (panelIdMatch && req.method === 'DELETE') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const panelId = panelIdMatch[1];
    const panels = await readJson(FILES.panels, []);
    const nextPanels = panels.filter((panel) => panel.id !== panelId);
    if (nextPanels.length === panels.length) {
      sendJson(res, 404, { error: 'Локация не найдена.' });
      return true;
    }
    await writeJson(FILES.panels, nextPanels);
    res.writeHead(204);
    res.end();
    return true;
  }

  const panelPingMatch = url.pathname.match(/^\/api\/panels\/([a-zA-Z0-9-]+)\/ping$/);
  if (panelPingMatch && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const panels = await readJson(FILES.panels, []);
    const panel = panels.find((item) => item.id === panelPingMatch[1]);
    if (!panel) {
      sendJson(res, 404, { error: 'Локация не найдена.' });
      return true;
    }
    const ping = await pingLocation(panel);
    panel.lastPing = ping;
    await writeJson(FILES.panels, panels);
    sendJson(res, 200, ping);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/panels/ping-all') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const panels = await readJson(FILES.panels, []);
    const pingMap = await pingAllPanels(panels);
    panels.forEach((panel) => {
      panel.lastPing = pingMap[panel.id];
    });
    await writeJson(FILES.panels, panels);
    sendJson(res, 200, pingMap);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const settings = await readJson(FILES.settings, {
      subscriptionTitle: '',
      supportUrl: '',
      announcement: '',
      telegram: { enabled: false, botToken: '', adminId: '', lastUpdateId: 0 },
      installCommand: "curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh -o install.sh && sudo bash install.sh --repo https://github.com/<YOUR_USER>/<YOUR_REPO>.git --ref main --port 3000"
    });
    if (settings.telegram?.botToken) settings.telegram.botToken = '***hidden***';
    sendJson(res, 200, settings);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await collectBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'Некорректный JSON.' });
      return true;
    }

    const current = await readJson(FILES.settings, {
      subscriptionTitle: '',
      supportUrl: '',
      announcement: '',
      telegram: { enabled: false, botToken: '', adminId: '', lastUpdateId: 0 },
      installCommand: "curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh -o install.sh && sudo bash install.sh --repo https://github.com/<YOUR_USER>/<YOUR_REPO>.git --ref main --port 3000"
    });

    const supportUrl = String(body.supportUrl || '').trim();
    if (supportUrl && !normalizeUrl(supportUrl)) {
      sendJson(res, 400, { error: 'URL поддержки некорректный.' });
      return true;
    }

    const telegramEnabled = Boolean(body.telegram?.enabled);
    const adminId = String(body.telegram?.adminId || current.telegram?.adminId || '').trim();
    const botTokenRaw = String(body.telegram?.botToken || '').trim();
    const botToken = botTokenRaw === '***hidden***' ? (current.telegram?.botToken || '') : botTokenRaw;
    if (telegramEnabled && (!/^\d+$/.test(adminId) || !/^\d+:[\w-]{20,}$/.test(botToken))) {
      sendJson(res, 400, { error: 'Для Telegram укажите валидные Bot Token и Admin ID.' });
      return true;
    }

    const next = {
      ...current,
      subscriptionTitle: String(body.subscriptionTitle || ''),
      supportUrl,
      announcement: String(body.announcement || ''),
      installCommand: String(body.installCommand || current.installCommand || ''),
      telegram: {
        enabled: telegramEnabled,
        adminId,
        botToken,
        lastUpdateId: current.telegram?.lastUpdateId || 0
      }
    };

    await writeJson(FILES.settings, next);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/subscriptions/generate') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await collectBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'Некорректный JSON.' });
      return true;
    }
    const panelIds = Array.isArray(body.panelIds) ? body.panelIds : [];
    if (panelIds.length === 0) {
      sendJson(res, 400, { error: 'Выберите минимум одну локацию.' });
      return true;
    }
    const panels = await readJson(FILES.panels, []);
    const selectedPanels = panels.filter((panel) => panelIds.includes(panel.id));
    if (selectedPanels.length === 0) {
      sendJson(res, 400, { error: 'Локации не найдены.' });
      return true;
    }
    const token = crypto.randomBytes(24).toString('hex');
    const tokens = await readJson(FILES.tokens, {});
    tokens[token] = { panelIds: selectedPanels.map((v) => v.id), createdAt: new Date().toISOString() };
    await writeJson(FILES.tokens, tokens);
    const protocol = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    sendJson(res, 200, {
      token,
      mergedUrl: `${protocol}://${req.headers.host}/api/subscriptions/${token}`,
      totalPanels: selectedPanels.length
    });
    return true;
  }

  const tokenMatch = url.pathname.match(/^\/api\/subscriptions\/([a-f0-9]{48})$/);
  if (tokenMatch && req.method === 'GET') {
    const tokens = await readJson(FILES.tokens, {});
    const tokenData = tokens[tokenMatch[1]];
    if (!tokenData) {
      sendText(res, 404, 'Token not found');
      return true;
    }

    const settings = await readJson(FILES.settings, {});
    const panels = await readJson(FILES.panels, []);
    const selectedPanels = panels.filter((panel) => tokenData.panelIds.includes(panel.id));

    const lines = [];
    const failed = [];
    for (const panel of selectedPanels) {
      try {
        lines.push(...(await fetchSubscriptionLines(panel.subscriptionUrl)));
      } catch (error) {
        failed.push(`${panel.name} (${error.message})`);
      }
    }

    const comments = ['# 3X UI aggregated subscription', `# panels: ${selectedPanels.length}`];
    if (isHappClient(req)) {
      if (settings.subscriptionTitle) comments.push(`# title: ${settings.subscriptionTitle}`);
      if (settings.supportUrl) comments.push(`# support-url: ${settings.supportUrl}`);
      if (settings.announcement) comments.push(`# announcement: ${settings.announcement}`);
    }
    if (failed.length > 0) comments.push(`# failed: ${failed.join(', ')}`);
    sendText(res, 200, [...comments, ...new Set(lines)].join('\n') + '\n');
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/security/hardening') {
    sendJson(res, 200, {
      notes: [
        'Используйте сложный пароль и обязательный 2FA.',
        'Запускайте за reverse proxy с HTTPS.',
        'Ограничьте доступ к панели по IP через firewall.',
        'Включите rate-limit на прокси (nginx/caddy).',
        'Регулярно обновляйте ОС и 3x-ui.'
      ]
    });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = requestUrl(req);
  try {
    const handled = await handleApi(req, res, url);
    if (handled) return;

    const served = await serveStatic(res, url.pathname);
    if (!served) sendText(res, 404, 'Not Found');
  } catch (error) {
    sendJson(res, 500, { error: 'Internal server error', details: error.message });
  }
});

server.listen(PORT, async () => {
  console.log(`3X Connect running at http://localhost:${PORT}`);
  await ensureTelegramPolling();
});
