# 3X Connect

Панель управления локациями 3X UI с авторизацией (логин/пароль + 2FA), проверкой пинга и Telegram-ботом.

## Почему у вас была ошибка `scripts/deploy-local.sh: No such file or directory`

Эта ошибка возникает, когда команда запускается **не из папки репозитория**.
Скрипт `scripts/deploy-local.sh` существует только внутри клонированного проекта.

---

## Рабочий способ №1 (рекомендуется): bootstrap-скрипт из любого каталога

Этот способ можно запускать хоть из `/root`, хоть из `/home`.

```bash
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh -o install.sh
sudo bash install.sh --repo https://github.com/<YOUR_USER>/<YOUR_REPO>.git --ref main --port 3000
```

Что делает `install.sh`:
- клонирует репозиторий во временную папку,
- запускает внутренний deploy-скрипт,
- разворачивает сервис через systemd.

---

## Рабочий способ №2: классический (клонирование + локальный deploy)

```bash
git clone https://github.com/<YOUR_USER>/<YOUR_REPO>.git
cd <YOUR_REPO>
sudo bash scripts/deploy-local.sh --port 3000
```

> Важно: команду выше нужно запускать **после `cd <YOUR_REPO>`**.

---

## Проверка после установки

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

## Ручное развертывание (без скриптов)

```bash
sudo apt update
sudo apt install -y nodejs npm rsync
sudo mkdir -p /opt/3x-connect
sudo rsync -a --delete --exclude .git ./ /opt/3x-connect/
```

Файл `/etc/systemd/system/3x-connect.service`:

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
