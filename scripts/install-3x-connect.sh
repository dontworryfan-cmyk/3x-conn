#!/usr/bin/env bash
set -euo pipefail

echo "3X UI helper install"
read -rp "Порт панели (например 2053): " PANEL_PORT
if ! [[ "$PANEL_PORT" =~ ^[0-9]+$ ]]; then
  echo "Некорректный порт" >&2
  exit 1
fi

read -rp "Логин админки: " ADMIN_LOGIN
read -rsp "Пароль админки: " ADMIN_PASS
echo

bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh)

sudo mkdir -p /etc/3x-connect/certs
sudo openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -subj "/CN=$(hostname)" \
  -keyout /etc/3x-connect/certs/self-signed.key \
  -out /etc/3x-connect/certs/self-signed.crt >/dev/null 2>&1

echo "----"
echo "Адрес панели: https://$(hostname -I | awk '{print $1}')"
echo "Порт: $PANEL_PORT"
echo "Логин: $ADMIN_LOGIN"
echo "Пароль: $ADMIN_PASS"
echo "Сертификат: self-signed"
echo "----"
