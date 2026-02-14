#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Запустите скрипт от root: sudo bash install-3x-connect.sh" >&2
  exit 1
fi

echo "=== Установка панели 3X Connect (Ubuntu) ==="
read -rp "Порт панели (по умолчанию 3000): " PANEL_PORT
PANEL_PORT=${PANEL_PORT:-3000}
if ! [[ "$PANEL_PORT" =~ ^[0-9]+$ ]] || (( PANEL_PORT < 1 || PANEL_PORT > 65535 )); then
  echo "Некорректный порт" >&2
  exit 1
fi

read -rp "Путь установки (по умолчанию /opt/3x-connect): " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/3x-connect}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

apt-get update -y
apt-get install -y curl ca-certificates git rsync
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

REPO_URL=${REPO_URL:-"https://github.com/REPLACE_WITH_YOUR_REPO/3x-conn.git"}
if [[ "$REPO_URL" == *"REPLACE_WITH_YOUR_REPO"* ]]; then
  echo "ВНИМАНИЕ: перед запуском укажите корректный REPO_URL, например:" >&2
  echo "REPO_URL=https://github.com/<user>/<repo>.git bash <(curl -Ls <raw-install-url>)" >&2
  exit 1
fi

git clone --depth=1 "$REPO_URL" "$TMP_DIR/repo"
mkdir -p "$INSTALL_DIR"
rsync -a --delete --exclude .git "$TMP_DIR/repo/" "$INSTALL_DIR/"

mkdir -p "$INSTALL_DIR/data"
[[ -f "$INSTALL_DIR/data/panels.json" ]] || echo '[]' > "$INSTALL_DIR/data/panels.json"
for f in tokens users sessions temp2fa; do
  [[ -f "$INSTALL_DIR/data/${f}.json" ]] || echo '{}' > "$INSTALL_DIR/data/${f}.json"
done

cat > "$INSTALL_DIR/data/settings.json" <<JSON
{
  "subscriptionTitle": "",
  "supportUrl": "",
  "announcement": "",
  "installCommand": "bash <(curl -Ls https://raw.githubusercontent.com/REPLACE_WITH_YOUR_REPO/3x-conn/main/scripts/install-3x-connect.sh)",
  "telegram": {
    "enabled": false,
    "botToken": "",
    "adminId": "",
    "lastUpdateId": 0
  }
}
JSON

cat > /etc/systemd/system/3x-connect.service <<SERVICE
[Unit]
Description=3X Connect Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
Environment=PORT=$PANEL_PORT
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now 3x-connect.service

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "=== Готово ==="
echo "Панель запущена: http://${IP_ADDR}:${PANEL_PORT}"
echo "Далее откройте сайт и выполните первичную настройку (логин/пароль/2FA)."
echo "Проверка сервиса: systemctl status 3x-connect --no-pager"
