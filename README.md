# 3X Connect

Панель управления локациями 3X UI с авторизацией (логин/пароль + 2FA), проверкой пинга и Telegram-ботом.

## Установка на свою Ubuntu-машину (с нуля)

Ниже только рабочий путь: **клонируете репозиторий на сервер** и разворачиваете локально.
Старые варианты с плейсхолдерами и нерабочими командами больше не используются.

### 1) Подготовка сервера

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

### 2) Клонирование репозитория

```bash
git clone https://github.com/<YOUR_USER>/<YOUR_REPO>.git
cd <YOUR_REPO>
```

### 3) Запуск авто-развертывания

Из корня репозитория:

```bash
sudo bash scripts/deploy-local.sh --port 3000
```

Опционально можно указать:

```bash
sudo bash scripts/deploy-local.sh --repo-dir "$(pwd)" --port 3000 --dir /opt/3x-connect --service 3x-connect
```

Что делает скрипт:
- ставит Node.js 20 (если нет),
- копирует проект в `/opt/3x-connect`,
- инициализирует `data/*.json`,
- создает и запускает `systemd`-сервис.

### 4) Проверка после установки

```bash
systemctl status 3x-connect --no-pager
journalctl -u 3x-connect -f
```

Открыть панель:

```text
http://<SERVER_IP>:3000
```

При первом входе создайте администратора и привяжите 2FA.

---

## Ручное развертывание (без скрипта)

Если хотите полностью вручную:

```bash
sudo apt update
sudo apt install -y nodejs npm
sudo mkdir -p /opt/3x-connect
sudo rsync -a --delete --exclude .git ./ /opt/3x-connect/
cd /opt/3x-connect
```

Создайте service `/etc/systemd/system/3x-connect.service`:

```ini
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
```

Далее:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 3x-connect
```

---

## Обновление панели

В корне локального репозитория:

```bash
git pull
sudo bash scripts/deploy-local.sh --repo-dir "$(pwd)" --port 3000
```

## Безопасность (обязательно для production)

- Закройте порт панели через firewall и открывайте доступ только нужным IP.
- Лучше ставить reverse proxy с HTTPS (nginx/caddy).
- Используйте сложный пароль и 2FA.
- Регулярно обновляйте систему.
