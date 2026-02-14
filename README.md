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

Используйте отдельную команду для установки **именно этой панели** (не 3x-ui):

```bash
REPO_URL=https://github.com/<ваш_user>/<ваш_repo>.git \
bash <(curl -Ls https://raw.githubusercontent.com/<ваш_user>/<ваш_repo>/main/scripts/install-3x-connect.sh)
```

Скрипт:
- установит Node.js (если не установлен),
- скачает ваш репозиторий с панелью,
- создаст systemd-сервис `3x-connect`,
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
