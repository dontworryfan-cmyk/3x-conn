#!/usr/bin/env bash
set -euo pipefail

PORT="3000"
INSTALL_DIR="/opt/3x-connect"
SERVICE_NAME="3x-connect"
REPO_URL=""
REF="main"

usage() {
  cat <<USAGE
Установка 3X Connect на Ubuntu

Использование:
  sudo bash install-3x-connect.sh --repo <git_repo_url> [опции]

Опции:
  --repo <url>         Git URL репозитория (обязательно)
  --ref <branch/tag>   Ветка/тег, по умолчанию: main
  --port <port>        Порт панели, по умолчанию: 3000
  --dir <path>         Папка установки, по умолчанию: /opt/3x-connect
  --service <name>     Имя systemd-сервиса, по умолчанию: 3x-connect
  -h, --help           Показать справку

Пример:
  sudo bash install-3x-connect.sh --repo https://github.com/<user>/<repo>.git --ref main --port 3000
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --ref)
      REF="${2:-}"
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
  echo "Запустите от root: sudo bash install-3x-connect.sh ..." >&2
  exit 1
fi

if [[ -z "$REPO_URL" ]]; then
  echo "Ошибка: --repo обязателен." >&2
  usage
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Некорректный порт: $PORT" >&2
  exit 1
fi

echo "=== Установка 3X Connect ==="
echo "Repo: $REPO_URL"
echo "Ref: $REF"
echo "Port: $PORT"
echo "Dir: $INSTALL_DIR"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates git rsync

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

git clone --depth=1 --branch "$REF" "$REPO_URL" "$TMP_DIR/repo"
mkdir -p "$INSTALL_DIR"
rsync -a --delete --exclude .git "$TMP_DIR/repo/" "$INSTALL_DIR/"

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
  "installCommand": "",
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
