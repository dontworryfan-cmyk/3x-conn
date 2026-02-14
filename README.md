# 3X Connect

Панель управления локациями 3X UI с безопасным входом, 2FA, объединённой подпиской и Telegram-ботом для мониторинга.

## Что добавлено

- Авторизация: логин + пароль + обязательный 2FA (TOTP).
- Локации: добавление/удаление, ручной пинг, пинг всех локаций.
- Подписка: генерация единого URL для Happ.
- Метаданные для Happ: **Заголовок Подписки**, **URL Поддержки**, **Объявление**.
- Telegram-бот (Bot API): проверка Admin ID, команды `/menu`, `/status`, `/ping`, `/add`, `/delete`.
- Установочная команда Ubuntu в настройках:
  `bash <(curl -Ls https://raw.githubusercontent.com/<ваш_user>/<ваш_repo>/main/scripts/install-3x-connect.sh)`
- Вспомогательный скрипт установки: `scripts/install-3x-connect.sh`.


## Отдельная команда установки панели на Ubuntu

Рабочий вариант (замените `<user>` и `<repo>`):

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/scripts/install-3x-connect.sh -o install-3x-connect.sh
sudo bash install-3x-connect.sh --repo https://github.com/<user>/<repo>.git --ref main --port 3000
```

Если хотите one-liner:

```bash
sudo bash -c 'curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/scripts/install-3x-connect.sh | bash -s -- --repo https://github.com/<user>/<repo>.git --ref main --port 3000'
```

Скрипт автоматически:
- установит зависимости и Node.js,
- скачает репозиторий,
- поднимет systemd-сервис `3x-connect`,
- запустит панель на выбранном порту.

## Запуск

```bash
npm start
```

Откройте: `http://localhost:3000`

## Telegram команды

- `/menu` — главное меню;
- `/status` — статус локаций и их пинг;
- `/ping` — ручной пинг всех локаций;
- `/add NAME URL` — добавить локацию;
- `/delete ID` — удалить локацию.

## Важно по безопасности

Невозможно «исключить все варианты взлома» на 100%, но в проект уже добавлены базовые меры (2FA, сессии HttpOnly/SameSite, валидация входных данных). Для production обязательно ставьте HTTPS reverse-proxy, firewall, rate-limit и регулярные обновления ОС.
