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
- `/marks` — средние оценки по всем предметам с динамикой 📈/📉/➖
- `/marks алгебра` — детально по предмету: оценки, формы контроля, веса, периоды, годовая
- `/schedule` — расписание уроков на сегодня
- `/schedule tomorrow` / `/schedule week` — расписание на завтра / на неделю
- `/schedule 2026-04-27` / `/schedule 2026-04-27..2026-05-03` — на дату или диапазон
- `/help` — справка

### Команды админа

- `/genkey [N]` — создать `N` приглашений (по умолчанию 1)
- `/keys` — последние 50 ключей и их статус
- `/revoke <KEY>` — отозвать ключ
- `/users` — список пользователей
- `/settoken <Bearer ...>` — обновить токен mosreg (сообщение удаляется автоматически)
- `/setcookie <Cookie>` — обновить Cookie mosreg
- `/setstudent <student_id> [profile_id]` — задать ID ученика
- `/setperson <UUID>` — задать `person_id` (UUID) для расписания (`eventcalendar` API)
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

| Переменная           | Описание                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `BOT_TOKEN`          | Токен бота от [@BotFather](https://t.me/BotFather)                                                                                       |
| `ADMIN_TG_ID`        | Числовой Telegram-ID админа (узнать у [@userinfobot](https://t.me/userinfobot))                                                          |
| `ENCRYPTION_KEY`     | 32 байта в hex (64 hex-символа). Сгенерировать: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`               |
| `DB_PATH`            | Путь к SQLite-файлу (по умолчанию `./data/autoedu.sqlite`)                                                                               |
| `TZ`                 | Таймзона для интерпретации «сегодня/завтра», по умолчанию `Europe/Moscow`                                                                |
| `TELEGRAM_PROXY_URL` | Опционально. Прокси **только** для Telegram Bot API (`http://`/`https://`/`socks5://`/`socks5h://`/`socks4://`). Mosreg всегда напрямую. |

## Деплой на свой сервер (Россия / за прокси) — рекомендуется

Если ты в РФ и Railway не может достучаться до `authedu.mosreg.ru` (получаешь `UND_ERR_CONNECT_TIMEOUT`), запускай бот **на домашнем Linux-сервере**:

- Telegram API при этом ходит **через твой прокси** (SOCKS5/HTTP) — потому что в РФ `api.telegram.org` блокируется.
- Mosreg API ходит **напрямую** через реальный IP сервера — российский IP mosreg как раз и нужен.

```bash
git clone https://github.com/VanyaSvetoslav/AutoEdu.git
cd AutoEdu
cp .env.example .env
# заполни BOT_TOKEN, ADMIN_TG_ID, ENCRYPTION_KEY (см. ниже),
# и раскомментируй TELEGRAM_PROXY_URL=socks5://192.168.20.3:20170
docker compose up -d --build
docker compose logs -f
```

В логах должно появиться:

```
Routing Telegram traffic through proxy: socks5://192.168.20.3:20170
AutoEdu bot starting…
Logged in as @<имя_бота>
```

> ⚠️ **MTProto-прокси (`mtg`) НЕ подходит** для Bot API — он работает только с MTProto-клиентами (Telegram Desktop/мобайл). Боту нужен обычный HTTP/SOCKS-прокси.
> Если у тебя `mtg` сам ходит наружу через какой-то SOCKS5 (как у тебя — `socks5://192.168.20.3:20170`), укажи **именно этот** SOCKS5 в `TELEGRAM_PROXY_URL` — бот пойдёт через него, минуя `mtg`.

### Поддерживаемые схемы прокси

`TELEGRAM_PROXY_URL` принимает:

- `http://host:port` / `https://host:port` — HTTP CONNECT прокси.
- `socks5://host:port` — SOCKS5, DNS резолвится клиентом.
- `socks5h://host:port` — SOCKS5, DNS резолвится прокси (важно, если у тебя локальный DNS не резолвит `api.telegram.org`).
- `socks4://host:port` — SOCKS4.
- С авторизацией: `socks5://user:password@host:port`.

### Сеть Docker и доступ к прокси

В `docker-compose.yml` по умолчанию стоит `network_mode: host` — контейнер делит сетевой стек хоста, поэтому `socks5://127.0.0.1:PORT` или `socks5://192.168.20.3:20170` (если этот IP — сам хост) работают без NAT-фокусов. Бот ничего не слушает извне (long polling — outbound-only), так что host-network безопасно.

Если по какой-то причине нужен bridge-режим — убери `network_mode: host` из compose, и тогда:

- SOCKS5 на хосте должен слушать `0.0.0.0` (а не только `127.0.0.1`), иначе из контейнера до него не достучаться.
- Внутри контейнера хост виден как `host.docker.internal` (нужно добавить `extra_hosts: ["host.docker.internal:host-gateway"]`) или через IP `docker0` (`172.17.0.1`).

### Если `npm ci` падает с ETIMEDOUT при сборке

`registry.npmjs.org` иногда плохо доступен из РФ. В Dockerfile есть `ARG NPM_REGISTRY` — можно собрать с зеркалом:

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
docker compose up -d
```

Или раскомментируй секцию `args` в `docker-compose.yml`:

```yaml
build:
  context: .
  args:
    NPM_REGISTRY: https://registry.npmmirror.com
```

Альтернатива — сборка через HTTP-прокси (npm SOCKS не понимает!): подними локально HTTP-прокси (например, `gost -L=http://127.0.0.1:8118 -F=socks5://192.168.20.3:20170`) и:

```bash
docker compose build --build-arg HTTPS_PROXY=http://192.168.20.3:8118
```

## Деплой на Railway

В репо лежат `Dockerfile` и `railway.json` — Railway соберёт образ автоматически через Docker builder.

1. **New Project → Deploy from GitHub Repo →** выбери `VanyaSvetoslav/AutoEdu`.
2. **Settings → Variables**, добавь все переменные из таблицы выше:
   - `BOT_TOKEN` — токен от @BotFather
   - `ADMIN_TG_ID` — твой числовой id (узнай у @userinfobot)
   - `ENCRYPTION_KEY` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (64 hex-символа)
   - `DB_PATH=/data/autoedu.sqlite`
   - `TZ=Europe/Moscow` (опционально)
3. **Settings → Volumes → Add Volume**:
   - Mount path: `/data`
   - Size: `1 GB` хватит за глаза.
   - Без Volume — БД (юзеры, ключи, mosreg-токен) будет сбрасываться на каждом редеплое!
4. Дождись успешного билда. В Logs должно появиться `Logged in as @<имя_бота>`.
5. Открой Telegram, напиши боту `/start` (с админ-аккаунта) → `/settoken …`, `/setcookie …`, `/setstudent <student_id>` → `/today`.

> 💡 Если позже истечёт mosreg-токен (~раз в неделю) — просто пришли боту новые `/settoken` и `/setcookie`, редеплой не нужен.

### Локально через Docker

```bash
docker build -t autoedu .
docker run -d --name autoedu \
  -e BOT_TOKEN=... -e ADMIN_TG_ID=... -e ENCRYPTION_KEY=... \
  -e DB_PATH=/data/autoedu.sqlite \
  -v autoedu-data:/data \
  autoedu
```

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

| Команда             |                                |
| ------------------- | ------------------------------ |
| `npm run dev`       | tsx watch — горячий перезапуск |
| `npm run build`     | TypeScript → `dist/`           |
| `npm start`         | запуск из `dist/`              |
| `npm run typecheck` | tsc --noEmit                   |
| `npm run lint`      | ESLint                         |
| `npm run format`    | Prettier --write               |

## Безопасность

- Никаких mosreg-секретов в репо: только `.env` (в `.gitignore`) и БД, в которой токены лежат зашифрованными.
- Если потерял `ENCRYPTION_KEY` — придётся заново вызвать `/settoken` и `/setcookie` (старые значения дешифровать нельзя).
- Доступ только по приглашениям. Админ может отозвать ключ или удалить юзера через SQLite.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
