#!/usr/bin/env bash
set -euo pipefail

REPO_URL=""
REF="main"
PORT="3000"
INSTALL_DIR="/opt/3x-connect"
SERVICE_NAME="3x-connect"

usage() {
  cat <<USAGE
Bootstrap-установка 3X Connect (из любого каталога)

Использование:
  sudo bash install.sh --repo <git_repo_url> [опции]

Опции:
  --repo <url>         Git URL репозитория (обязательно)
  --ref <branch/tag>   Ветка/тег (по умолчанию: main)
  --port <port>        Порт панели (по умолчанию: 3000)
  --dir <path>         Каталог установки (по умолчанию: /opt/3x-connect)
  --service <name>     Имя systemd-сервиса (по умолчанию: 3x-connect)
  -h, --help           Справка
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --ref) REF="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестный аргумент: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Запустите от root: sudo bash install.sh ..." >&2
  exit 1
fi

if [[ -z "$REPO_URL" ]]; then
  echo "Ошибка: --repo обязателен" >&2
  usage
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Некорректный порт: $PORT" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

git clone --depth=1 --branch "$REF" "$REPO_URL" "$TMP_DIR/repo"

if [[ ! -f "$TMP_DIR/repo/scripts/deploy-local.sh" ]]; then
  echo "В репозитории не найден scripts/deploy-local.sh" >&2
  exit 1
fi

bash "$TMP_DIR/repo/scripts/deploy-local.sh" \
  --repo-dir "$TMP_DIR/repo" \
  --port "$PORT" \
  --dir "$INSTALL_DIR" \
  --service "$SERVICE_NAME"
