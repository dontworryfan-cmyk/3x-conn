# 3X Connect

Панель управления локациями 3X UI с авторизацией (логин/пароль + 2FA), проверкой пинга и Telegram-ботом.

> Ниже — **только ручная установка**, без авто-скриптов. Делайте шаги строго по порядку.

## Ручная установка на Ubuntu 22.04/24.04 (пошагово)

### Шаг 1. Подключитесь к серверу

```bash
ssh root@<SERVER_IP>
```

Если входите не под root, используйте пользователя с `sudo`.

---

### Шаг 2. Установите системные пакеты

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg git rsync
```

---

### Шаг 3. Установите Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Проверьте версии:

```bash
node -v
npm -v
```

Ожидается `node` версии 20.x или выше.

---

### Шаг 4. Склонируйте репозиторий

```bash
git clone https://github.com/<YOUR_USER>/<YOUR_REPO>.git
cd <YOUR_REPO>
```

Проверьте, что вы в корне проекта:

```bash
ls
```

В списке должны быть: `server.js`, `public`, `data`, `package.json`.

---

### Шаг 5. Скопируйте проект в постоянную директорию

```bash
sudo mkdir -p /opt/3x-connect
sudo rsync -a --delete --exclude .git ./ /opt/3x-connect/
cd /opt/3x-connect
```

---

### Шаг 6. Подготовьте data-файлы

```bash
sudo mkdir -p /opt/3x-connect/data
printf '[]\n' | sudo tee /opt/3x-connect/data/panels.json >/dev/null
printf '{}\n' | sudo tee /opt/3x-connect/data/tokens.json >/dev/null
printf '{}\n' | sudo tee /opt/3x-connect/data/sessions.json >/dev/null
printf '{}\n' | sudo tee /opt/3x-connect/data/temp2fa.json >/dev/null
printf '[]\n' | sudo tee /opt/3x-connect/data/users.json >/dev/null
cat <<'JSON' | sudo tee /opt/3x-connect/data/settings.json >/dev/null
{
  "subscriptionTitle": "",
  "supportUrl": "",
  "announcement": "",
  "installCommand": "manual-install",
  "telegram": {
    "enabled": false,
    "botToken": "",
    "adminId": "",
    "lastUpdateId": 0
  }
}
JSON
```

---

### Шаг 7. Создайте systemd unit

```bash
cat <<'SERVICE' | sudo tee /etc/systemd/system/3x-connect.service >/dev/null
[Unit]
Description=3X Connect Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/3x-connect
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE
```

Если нужен другой порт — измените `Environment=PORT=3000`.

---

### Шаг 8. Запустите сервис

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 3x-connect
```

Проверьте состояние:

```bash
sudo systemctl status 3x-connect --no-pager
```

Просмотр логов в реальном времени:

```bash
sudo journalctl -u 3x-connect -f
```

---

### Шаг 9. Откройте панель

Откройте в браузере:

```text
http://<SERVER_IP>:3000
```

При первом входе создайте администратора и настройте 2FA.

---

## Обновление вручную

```bash
cd ~
rm -rf <YOUR_REPO>
git clone https://github.com/<YOUR_USER>/<YOUR_REPO>.git
cd <YOUR_REPO>
sudo rsync -a --delete --exclude .git ./ /opt/3x-connect/
sudo systemctl restart 3x-connect
sudo systemctl status 3x-connect --no-pager
```

---

## Частые проблемы и решение

### 1) `scripts/deploy-local.sh: No such file or directory`
Вы запускали команду не из директории репозитория. В этом гайде этот скрипт вообще не используется.

### 2) `node: command not found`
Node.js не установлен — повторите шаг 3.

### 3) `EADDRINUSE: address already in use :::3000`
Порт занят. Смените порт в `/etc/systemd/system/3x-connect.service` и выполните:

```bash
sudo systemctl daemon-reload
sudo systemctl restart 3x-connect
```

### 4) Панель не открывается извне
Проверьте firewall/security group и откройте TCP-порт 3000.

---

## Минимальные требования безопасности

- Используйте сложный пароль и обязательно включайте 2FA.
- Ограничьте доступ к порту панели по IP (firewall).
- Для продакшена ставьте reverse proxy с HTTPS (nginx/caddy).
