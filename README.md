# AutoEdu

Приватный Telegram-бот для получения домашнего задания из электронного дневника **mosreg.ru** (`authedu.mosreg.ru`).

- Стек: **TypeScript + Node 20 + grammY + better-sqlite3 + undici**.
- Mosreg-токены/Cookie хранятся в БД **зашифрованными AES-256-GCM**, ключ — в `.env`.
- Доступ к боту по системе одноразовых **ключей-приглашений**, которые выдаёт админ.
- Внутри одной mosreg-сессии (одного аккаунта родителя/ученика). Все авторизованные пользователи видят домашку этого ученика — это сделано специально, чтобы не открывать публичный доступ к API mosreg.

## Возможности

### Команды для пользователей
- `/start <KEY>` — активировать приглашение
- `/today` — ДЗ на сегодня
- `/tomorrow` — ДЗ на завтра
- `/week` — ДЗ на ближайшие 7 дней
- `/hw 2026-04-27` — ДЗ на конкретную дату
- `/hw 2026-04-27..2026-05-03` — ДЗ за диапазон дат
- `/help` — справка

### Команды админа
- `/genkey [N]` — создать `N` приглашений (по умолчанию 1)
- `/keys` — последние 50 ключей и их статус
- `/revoke <KEY>` — отозвать ключ
- `/users` — список пользователей
- `/settoken <Bearer ...>` — обновить токен mosreg (сообщение удаляется автоматически)
- `/setcookie <Cookie>` — обновить Cookie mosreg
- `/setstudent <student_id> [profile_id]` — задать ID ученика
- `/credstatus` — статус сохранённых credentials

> 💡 Mosreg `Authorization` живёт ~7 дней. Когда токен протухает — просто пришли админ-команду `/settoken …` с новым значением, лезть в код не нужно.

## Установка

```bash
git clone https://github.com/VanyaSvetoslav/AutoEdu.git
cd AutoEdu
npm install
cp .env.example .env
# заполни BOT_TOKEN, ADMIN_TG_ID, ENCRYPTION_KEY
npm run build
npm start
```

Для разработки:
```bash
npm run dev
```

## Конфигурация (`.env`)

| Переменная | Описание |
|---|---|
| `BOT_TOKEN` | Токен бота от [@BotFather](https://t.me/BotFather) |
| `ADMIN_TG_ID` | Числовой Telegram-ID админа (узнать у [@userinfobot](https://t.me/userinfobot)) |
| `ENCRYPTION_KEY` | 32 байта в hex (64 hex-символа). Сгенерировать: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DB_PATH` | Путь к SQLite-файлу (по умолчанию `./data/autoedu.sqlite`) |
| `TZ` | Таймзона для интерпретации «сегодня/завтра», по умолчанию `Europe/Moscow` |

## Где взять mosreg credentials

1. Залогинься в [authedu.mosreg.ru](https://authedu.mosreg.ru) под нужным аккаунтом.
2. Открой DevTools → Network, сделай любой запрос к `/api/family/web/v1/...`.
3. Скопируй заголовок `Authorization` (`Bearer …`) и `Cookie` целиком.
4. В чате с ботом (от админа):
   ```
   /settoken Bearer eyJ...
   /setcookie aupd_token=...; ...
   /setstudent 71913
   ```
   Сообщения с секретами бот удаляет автоматически.

## Как это работает

```
Telegram ──► grammY (long polling) ──► handlers ──► undici ──► authedu.mosreg.ru
                                          │
                                          ▼
                                   better-sqlite3 (WAL)
                                          │
                                          ▼
                                  AES-256-GCM на токенах
```

Endpoint, используемый ботом:
```
GET https://authedu.mosreg.ru/api/family/web/v1/homeworks
    ?from=YYYY-MM-DD&to=YYYY-MM-DD&student_id=NNN
Authorization: Bearer ...
Cookie: ...
Profile-Id: NNN
Profile-Type: student
X-mes-subsystem: familyweb
```

## Скрипты

| Команда | |
|---|---|
| `npm run dev` | tsx watch — горячий перезапуск |
| `npm run build` | TypeScript → `dist/` |
| `npm start` | запуск из `dist/` |
| `npm run typecheck` | tsc --noEmit |
| `npm run lint` | ESLint |
| `npm run format` | Prettier --write |

## Безопасность

- Никаких mosreg-секретов в репо: только `.env` (в `.gitignore`) и БД, в которой токены лежат зашифрованными.
- Если потерял `ENCRYPTION_KEY` — придётся заново вызвать `/settoken` и `/setcookie` (старые значения дешифровать нельзя).
- Доступ только по приглашениям. Админ может отозвать ключ или удалить юзера через SQLite.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
