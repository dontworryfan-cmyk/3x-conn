#!/usr/bin/env bash
set -euo pipefail

PORT="3000"
INSTALL_DIR="/opt/3x-connect"
SERVICE_NAME="3x-connect"
REPO_DIR="$(pwd)"

usage() {
  cat <<USAGE
Локальное развертывание 3X Connect на Ubuntu

Использование:
  sudo bash scripts/deploy-local.sh [опции]

Опции:
  --repo-dir <path>    Путь к уже клонированному репозиторию (по умолчанию: текущая папка)
  --port <port>        Порт панели (по умолчанию: 3000)
  --dir <path>         Папка установки (по умолчанию: /opt/3x-connect)
  --service <name>     Имя systemd-сервиса (по умолчанию: 3x-connect)
  -h, --help           Показать справку
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-dir)
      REPO_DIR="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --service)
      SERVICE_NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Неизвестный аргумент: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Запустите от root: sudo bash scripts/deploy-local.sh ..." >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Некорректный порт: $PORT" >&2
  exit 1
fi

if [[ ! -f "$REPO_DIR/server.js" || ! -d "$REPO_DIR/public" ]]; then
  echo "Похоже, это не корень репозитория 3X Connect: $REPO_DIR" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates rsync git

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

mkdir -p "$INSTALL_DIR"
rsync -a --delete --exclude .git "$REPO_DIR/" "$INSTALL_DIR/"

mkdir -p "$INSTALL_DIR/data"
[[ -f "$INSTALL_DIR/data/panels.json" ]] || echo '[]' > "$INSTALL_DIR/data/panels.json"
for f in tokens users sessions temp2fa; do
  [[ -f "$INSTALL_DIR/data/${f}.json" ]] || echo '{}' > "$INSTALL_DIR/data/${f}.json"
done
[[ -f "$INSTALL_DIR/data/settings.json" ]] || cat > "$INSTALL_DIR/data/settings.json" <<JSON
{
  "subscriptionTitle": "",
  "supportUrl": "",
  "announcement": "",
  "installCommand": "sudo bash scripts/deploy-local.sh --port 3000",
  "telegram": {
    "enabled": false,
    "botToken": "",
    "adminId": "",
    "lastUpdateId": 0
  }
}
JSON

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=3X Connect Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=PORT=${PORT}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "=== Готово ==="
echo "URL панели: http://${IP_ADDR}:${PORT}"
echo "Сервис: systemctl status ${SERVICE_NAME} --no-pager"
echo "Логи: journalctl -u ${SERVICE_NAME} -f"
