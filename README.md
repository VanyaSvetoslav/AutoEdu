<div align="center">

# 📚 AutoEdu

**Приватный Telegram-бот для домашки, оценок и расписания из электронного дневника `mosreg.ru`.**

_Учись быстрее. Залогинься один раз — пользуйся всей семьёй._

[![CI](https://github.com/VanyaSvetoslav/AutoEdu/actions/workflows/ci.yml/badge.svg)](https://github.com/VanyaSvetoslav/AutoEdu/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.json)
[![grammY](https://img.shields.io/badge/grammY-1.x-179CDE?logo=telegram&logoColor=white)](https://grammy.dev)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./Dockerfile)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/VanyaSvetoslav/AutoEdu/pulls)

</div>

---

## 🧭 Содержание

- [Что это?](#-что-это)
- [Возможности](#-возможности)
- [Архитектура](#-архитектура)
- [Быстрый старт](#-быстрый-старт)
- [Конфигурация](#%EF%B8%8F-конфигурация-env)
- [Команды бота](#-команды-бота)
- [Где взять mosreg credentials](#-где-взять-mosreg-credentials)
- [Деплой](#-деплой)
  - [Self-hosted (Россия / за прокси)](#-self-hosted-россия--за-прокси--рекомендуется)
  - [Railway](#-railway)
  - [Docker (любой VPS)](#-docker-любой-vps)
- [Troubleshooting](#-troubleshooting)
- [Структура проекта](#-структура-проекта)
- [Скрипты](#-скрипты-npm-run-)
- [Безопасность](#-безопасность)
- [Лицензия](#-лицензия)

---

## 🤔 Что это?

AutoEdu — это middleware-прокси между [Telegram](https://telegram.org) и публичным API «Электронного дневника» [`authedu.mosreg.ru`](https://authedu.mosreg.ru).
Один аккаунт mosreg → один админ-чат → **сколько угодно** членов семьи в боте.

> Зачем оно нужно?
>
> - Сайт mosreg ленится грузиться, выдаёт капчу и регулярно отваливается.
> - Удобнее спросить у Telegram-бота `/today`, чем заходить в дневник.
> - У родителя может не быть желания делиться полным доступом к ЛК — а доступ к домашке можно «расшарить» через бота-приглашение, не отдавая пароль.

**Один токен → много пользователей.**
Все авторизованные через invite-ключ юзеры читают домашку **одного и того же** ученика — это by design. Если нужны разные ученики — поднимайте отдельных ботов.

---

## ✨ Возможности

|     | Фича                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| 📅  | Домашка на сегодня / завтра / неделю / любую дату или диапазон                                                        |
| 🔍  | Фильтр ДЗ по предмету (полнотекстовый поиск + кнопки one-tap под выдачей `/week` и `/hw`)                             |
| 📊  | Оценки: средневзвешенные по всем предметам с динамикой 📈/📉/➖ + детально по каждому (формы контроля, веса, периоды) |
| 🗓  | Расписание уроков (через `eventcalendar` API)                                                                         |
| 🔑  | Закрытый вход по invite-ключам — никаких рандомов, только те, кому админ выдал ключ                                   |
| 🔒  | Mosreg-токены и Cookie шифруются **AES-256-GCM** в БД (ключ — в `.env`)                                               |
| 🌐  | Поддержка прокси для Telegram Bot API (HTTP / HTTPS / SOCKS5 / SOCKS5h / SOCKS4)                                      |
| 🐳  | Готовый `Dockerfile` + `docker-compose.yml` + `railway.json`                                                          |
| 🛠  | Админ-команды: `/genkey`, `/keys`, `/revoke`, `/users`, `/kick`, `/settoken`, `/setcookie`, `/credstatus`             |
| ✂️  | Сообщения с секретами (`/settoken`, `/setcookie`) автоматически удаляются после сохранения                            |

---

## 🏗 Архитектура

```
┌──────────────┐   long polling   ┌───────────────────┐    HTTPS (опционально через proxy)
│   Telegram   │ ◄──────────────► │      grammY       │
└──────────────┘                  │  (src/handlers.ts)│
                                  └────────┬──────────┘
                                           │
                                           │ undici.request (без proxy — реальный IP сервера)
                                           ▼
                                  ┌───────────────────┐
                                  │ authedu.mosreg.ru │
                                  │   (homeworks /    │
                                  │   subject_marks / │
                                  │   eventcalendar)  │
                                  └───────────────────┘
                                           ▲
                                           │
                                  ┌────────┴──────────┐
                                  │  better-sqlite3   │
                                  │      (WAL)        │
                                  │                   │
                                  │  encrypted token  │
                                  │  encrypted cookie │
                                  │  invite_keys      │
                                  │  users            │
                                  └───────────────────┘
                                           ▲
                                           │
                                       AES-256-GCM
                                  (key в ENCRYPTION_KEY)
```

**Стек:**
[TypeScript](https://www.typescriptlang.org) (strict) ·
[Node 20+](https://nodejs.org) ·
[grammY](https://grammy.dev) ·
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3) ·
[undici](https://github.com/nodejs/undici) ·
[Zod](https://zod.dev) ·
[proxy-agent](https://github.com/TooTallNate/proxy-agents).

---

## 🚀 Быстрый старт

```bash
git clone https://github.com/VanyaSvetoslav/AutoEdu.git
cd AutoEdu
npm install
cp .env.example .env

# 1. BOT_TOKEN — выдаёт @BotFather
# 2. ADMIN_TG_ID — узнать у @userinfobot
# 3. ENCRYPTION_KEY — сгенерировать:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run build
npm start
```

Для разработки с автоперезапуском:

```bash
npm run dev
```

После запуска — открой Telegram, напиши боту `/start` (с админ-аккаунта), пришли `/settoken …` → `/setcookie …` → `/setstudent <student_id>` → `/today` 🎉.

---

## ⚙️ Конфигурация (`.env`)

| Переменная           | Обяз. | Описание                                                                                                                                                                            |
| -------------------- | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOT_TOKEN`          |  ✅   | Токен бота от [@BotFather](https://t.me/BotFather).                                                                                                                                 |
| `ADMIN_TG_ID`        |  ✅   | Числовой Telegram-ID админа. Узнай у [@userinfobot](https://t.me/userinfobot).                                                                                                      |
| `ENCRYPTION_KEY`     |  ✅   | 32 байта в hex (64 hex-символа). Сгенерировать: <br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Меняешь — сбрасываются токены mosreg.               |
| `DB_PATH`            |       | Путь к SQLite-файлу. По умолчанию `./data/autoedu.sqlite`. В Docker — `/data/autoedu.sqlite`.                                                                                       |
| `TZ`                 |       | Таймзона для интерпретации «сегодня/завтра». По умолчанию `Europe/Moscow`.                                                                                                          |
| `TELEGRAM_PROXY_URL` |       | Прокси **только для Telegram**. Mosreg всегда напрямую. Поддерживает `http://`, `https://`, `socks5://`, `socks5h://`, `socks4://`. С авторизацией: `socks5://user:pass@host:port`. |

> 💡 Mosreg `Authorization` живёт ~7 дней. Когда токен протухает — пришли админ-команду `/settoken …` с новым значением, лезть в код или редеплоить **не нужно**.

---

## 🤖 Команды бота

### Для пользователей

| Команда                                                               | Что делает                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `/start <KEY>`                                                        | Активировать invite-ключ                                             |
| `/today`                                                              | Домашка на сегодня                                                   |
| `/tomorrow`                                                           | Домашка на завтра                                                    |
| `/week`                                                               | Домашка на 7 дней (под ответом — кнопки фильтра по предметам)        |
| `/hw 2026-04-27`                                                      | На конкретную дату                                                   |
| `/hw 2026-04-27..2026-05-03`                                          | Диапазон дат                                                         |
| `/subject алгебра`                                                    | ДЗ по предмету за неделю                                             |
| `/subject алгебра tomorrow\|week\|YYYY-MM-DD\|YYYY-MM-DD..YYYY-MM-DD` | ДЗ по предмету за указанный период                                   |
| `/marks`                                                              | Средние оценки по всем предметам с динамикой 📈/📉/➖                |
| `/marks алгебра`                                                      | Детально по предмету: оценки, формы контроля, веса, периоды, годовая |
| `/schedule`                                                           | Расписание на сегодня                                                |
| `/schedule tomorrow` / `/schedule week`                               | Расписание на завтра / на неделю                                     |
| `/schedule 2026-04-27[..2026-05-03]`                                  | Расписание на дату или диапазон                                      |
| `/help`                                                               | Справка                                                              |

### Для администратора

| Команда                                 | Что делает                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `/genkey [N]`                           | Создать `N` приглашений (по умолчанию `1`, максимум `20`)                      |
| `/keys`                                 | Последние 50 ключей и их статус                                                |
| `/revoke <KEY>`                         | Отозвать ключ                                                                  |
| `/users`                                | Список пользователей с ссылками на профили Telegram                            |
| `/kick <tg_id\|@username>`              | Удалить пользователя                                                           |
| `/kick <tg_id\|@username> --release`    | Удалить и **освободить** его ключ для повторного использования                 |
| `/settoken <Bearer ...>`                | Обновить Bearer-токен mosreg (сообщение удаляется автоматически)               |
| `/setcookie <Cookie>`                   | Обновить Cookie mosreg (сообщение удаляется автоматически)                     |
| `/setstudent <student_id> [profile_id]` | Задать ID ученика. `profile_id` опциональный, по умолчанию равен `student_id`. |
| `/setperson <UUID>`                     | Задать `person_id` (UUID) для расписания (`eventcalendar` API)                 |
| `/credstatus`                           | Статус сохранённых credentials (длины полей, last update)                      |
| `/apidebug` / `/scheduledebug`          | Сырой ответ mosreg на тестовый запрос (для диагностики 401/403)                |

---

## 🔑 Где взять mosreg credentials

1. Залогинься в [authedu.mosreg.ru](https://authedu.mosreg.ru) под нужным аккаунтом (родитель или ученик).
2. Открой DevTools → вкладка **Network**.
3. Сделай любой запрос к `/api/family/web/v1/...` — например, открой страницу «Дневник».
4. В заголовках запроса скопируй:
   - `Authorization: Bearer eyJ…` — это **token**.
   - `Cookie: aupd_token=…; …` — это **cookie** (опционально, но в текущих условиях лучше передавать).
5. На странице школьника подсмотри `student_id` (число) — обычно в URL или DevTools, query-параметр `student_id`.
6. Для расписания нужен `person_id` (UUID) — в DevTools зайди на запрос к `eventcalendar`, посмотри query-параметр `person_ids`.
7. В чате с ботом (от админа):
   ```
   /settoken Bearer eyJ...
   /setcookie aupd_token=...; ...
   /setstudent 71913
   /setperson 11111111-2222-3333-4444-555555555555
   ```
   После каждой команды бот удаляет твоё сообщение (если у него есть права).

---

## 🌍 Деплой

### 🇷🇺 Self-hosted (Россия / за прокси) — рекомендуется

Если ты в РФ и облачные провайдеры (Railway/Fly.io/Render) не могут достучаться до `authedu.mosreg.ru` (`UND_ERR_CONNECT_TIMEOUT`), запускай бот **на домашнем Linux-сервере**:

- Telegram Bot API ходит **через твой прокси** (SOCKS5/HTTP) — потому что в РФ `api.telegram.org` блокируется.
- Mosreg API ходит **напрямую** через реальный IP сервера — российский IP mosreg как раз и нужен.

```bash
git clone https://github.com/VanyaSvetoslav/AutoEdu.git
cd AutoEdu
cp .env.example .env

# 1. заполни BOT_TOKEN, ADMIN_TG_ID, ENCRYPTION_KEY
# 2. раскомментируй TELEGRAM_PROXY_URL=socks5://192.168.20.3:20170 (твой прокси)
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
>
> Если у тебя `mtg` сам ходит наружу через какой-то SOCKS5 (например, `socks5://192.168.20.3:20170`), укажи **именно его** в `TELEGRAM_PROXY_URL` — бот пойдёт через него, минуя `mtg`.

#### Поддерживаемые схемы прокси

`TELEGRAM_PROXY_URL` принимает:

- `http://host:port` / `https://host:port` — HTTP CONNECT прокси.
- `socks5://host:port` — SOCKS5, DNS резолвится клиентом.
- `socks5h://host:port` — SOCKS5, DNS резолвится прокси (важно, если локальный DNS не резолвит `api.telegram.org`).
- `socks4://host:port` — SOCKS4.
- С авторизацией: `socks5://user:password@host:port`.

#### Сеть Docker и доступ к прокси

В `docker-compose.yml` по умолчанию стоит `network_mode: host` — контейнер делит сетевой стек хоста, поэтому `socks5://127.0.0.1:PORT` или `socks5://192.168.20.3:20170` работают без NAT-фокусов. Бот ничего не слушает извне (long polling — outbound-only), так что host-network безопасно.

Если по какой-то причине нужен bridge-режим — убери `network_mode: host` из compose, и тогда:

- SOCKS5 на хосте должен слушать `0.0.0.0` (а не только `127.0.0.1`).
- Внутри контейнера хост виден как `host.docker.internal` (нужно добавить `extra_hosts: ["host.docker.internal:host-gateway"]`) или через IP `docker0` (`172.17.0.1`).

---

### 🚂 Railway

В репо лежат `Dockerfile` и `railway.json` — Railway соберёт образ автоматически.

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
   - **Без Volume** — БД (юзеры, ключи, mosreg-токен) будет сбрасываться на каждом редеплое!
4. Дождись успешного билда. В Logs должно появиться `Logged in as @<имя_бота>`.

> 💡 Если позже истечёт mosreg-токен (~раз в неделю) — просто пришли боту новые `/settoken` и `/setcookie`, редеплой не нужен.
>
> ⚠️ Из РФ Railway может не достучаться до mosreg API — тогда лучше [Self-hosted](#-self-hosted-россия--за-прокси--рекомендуется).

---

### 🐳 Docker (любой VPS)

```bash
docker build -t autoedu .
docker run -d --name autoedu --restart unless-stopped \
  -e BOT_TOKEN=... \
  -e ADMIN_TG_ID=... \
  -e ENCRYPTION_KEY=... \
  -e DB_PATH=/data/autoedu.sqlite \
  -v autoedu-data:/data \
  autoedu
```

Логи:

```bash
docker logs -f autoedu
```

---

## 🛠 Troubleshooting

<details>
<summary><b>❓ <code>npm ci</code> падает с <code>ETIMEDOUT</code> при сборке Docker-образа</b></summary>

`registry.npmjs.org` иногда плохо доступен из РФ. В Dockerfile есть `ARG NPM_REGISTRY` — собери с зеркалом:

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
docker compose build --build-arg HTTPS_PROXY=http://127.0.0.1:8118
```

</details>

<details>
<summary><b>❓ Бот отвечает <code>❌ Ошибка mosreg API (401)</code> на <code>/today</code></b></summary>

Mosreg-токен или Cookie протухли (живут ~7 дней). Открой mosreg в браузере, обнови F5, скопируй свежие `Authorization` и `Cookie` из DevTools → Network, и пришли админ-команды:

```
/settoken Bearer eyJ...
/setcookie aupd_token=...
```

Чтобы убедиться, что бот шлёт корректные заголовки, можно вызвать `/apidebug` и посмотреть на сырой ответ mosreg.

</details>

<details>
<summary><b>❓ <code>/schedule</code> отвечает <code>❌ Ошибка mosreg API (401)</code>, а <code>/today</code> работает</b></summary>

Расписание ходит в другой Mosreg-эндпойнт (`/api/eventcalendar/...`), который **дополнительно** требует `Auth-Token` header и `person_id` (UUID).

Проверь:

1. Задан ли `person_id`: `/credstatus` → строка `Person:`.
2. Если нет — найди UUID в DevTools браузера (запрос к `eventcalendar`, query-параметр `person_ids`) и пришли `/setperson <UUID>`.
3. Для деталей — `/scheduledebug`.

</details>

<details>
<summary><b>❓ В Railway бот стартует, но получает <code>UND_ERR_CONNECT_TIMEOUT</code> на запросах к mosreg</b></summary>

Скорее всего, провайдер из РФ блокирует исходящие к mosreg. Перенеси бот на домашний Linux-сервер с российским IP и подключи Telegram через прокси — см. [Self-hosted](#-self-hosted-россия--за-прокси--рекомендуется).

</details>

<details>
<summary><b>❓ <code>SQLITE_CANTOPEN</code> при первом старте контейнера</b></summary>

Bind-mount `./data:/data` создаётся под пользователем хоста (часто `root:root`), а внутри контейнера бот работает как `node` (uid 1000). Решено в `docker-entrypoint.sh`: контейнер стартует root → `chown -R node:node /data` → `gosu node` → запуск. Если ошибка всё-таки появляется, удали `./data/` и пересоздай:

```bash
docker compose down
sudo rm -rf ./data
docker compose up -d
```

</details>

<details>
<summary><b>❓ Я потерял <code>ENCRYPTION_KEY</code> — что делать?</b></summary>

Старые `encrypted_token` и `encrypted_cookie` теперь нечитаемы. Сгенерируй новый ключ, перезапусти бот и пришли свежие `/settoken …` + `/setcookie …`. Юзеры и invite-ключи **не теряются** — они хранятся в открытом виде.

</details>

---

## 🗂 Структура проекта

```
AutoEdu/
├── src/
│   ├── index.ts          ← entrypoint: запускает grammY, ловит SIGINT/SIGTERM
│   ├── config.ts         ← Zod-схема для .env, fail-fast при невалидном конфиге
│   ├── crypto.ts         ← AES-256-GCM encrypt/decrypt (iv + tag + ct, base64)
│   ├── db.ts             ← better-sqlite3, миграции, типизированные prepared-statements
│   ├── handlers.ts       ← команды бота (user + admin), middleware, callbacks
│   ├── mosreg.ts         ← HTTP-клиент к authedu.mosreg.ru (homeworks, marks, schedule)
│   ├── format.ts         ← рендер HTML-сообщений, escape, чанкинг под 4096 символов
│   ├── dates.ts          ← парсинг диапазонов (today/tomorrow/week/ISO/range), TZ-aware
│   ├── keys.ts           ← генерация invite-ключей вида XXXX-XXXX-XXXX-XXXX
│   └── proxy.ts          ← обёртка над proxy-agent для Telegram
├── data/                 ← (gitignored) SQLite-файл и WAL/SHM
├── dist/                 ← (gitignored) скомпилированный JavaScript
├── .github/workflows/    ← CI: lint + format:check + typecheck + build
├── Dockerfile            ← multi-stage, builder → runtime, gosu drop-priv
├── docker-compose.yml    ← network_mode: host + bind-mount ./data:/data
├── docker-entrypoint.sh  ← chown /data → gosu node → exec
├── railway.json          ← deploy config для Railway
├── eslint.config.mjs     ← strict TS + prettier compat
├── tsconfig.json         ← noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── package.json
└── .env.example
```

> 🔧 **Почему импорты с `.js`-расширением, а не `.ts`?**
> Проект использует ESM + `moduleResolution: "NodeNext"` — Node требует расширение в импортах ESM, и для совместимости с runtime пишется `.js`, даже если сам файл `.ts`. Это стандартная практика для Node ESM-проектов.

---

## 📜 Скрипты (`npm run …`)

| Команда                | Что делает                                                   |
| ---------------------- | ------------------------------------------------------------ |
| `npm run dev`          | `tsx watch src/index.ts` — горячий перезапуск при изменениях |
| `npm run build`        | TypeScript → `dist/`                                         |
| `npm start`            | Запуск из `dist/` (требует предварительного `build`)         |
| `npm run typecheck`    | `tsc --noEmit` без генерации файлов                          |
| `npm run lint`         | ESLint (strict TS rules)                                     |
| `npm run lint:fix`     | ESLint --fix                                                 |
| `npm run format`       | Prettier --write                                             |
| `npm run format:check` | Prettier --check (не пишет, только проверяет)                |

CI запускает: `npm ci → lint → format:check → typecheck → build`. Все четыре должны пройти.

---

## 🔐 Безопасность

- **Никаких mosreg-секретов в репо.** В `.gitignore` — `.env`, `data/`, `*.sqlite`. Push secret-сканирование от GitHub лучше включить в Settings.
- **Шифрование at-rest.** `encrypted_token` и `encrypted_cookie` в БД зашифрованы AES-256-GCM с per-encryption random IV. Если кто-то выкрадет SQLite-файл, без `ENCRYPTION_KEY` он бесполезен.
- **Auth-tag отдельный.** Расшифровка падает с ошибкой, если payload подменили — `setAuthTag` это гарантирует.
- **Сообщения с секретами удаляются.** `/settoken`, `/setcookie` стирают исходное сообщение пользователя сразу после сохранения (если у бота есть на это право в чате — для приватного диалога 1×1 всегда есть).
- **Атомарное использование invite-ключей.** `UPDATE ... WHERE used_by IS NULL AND revoked = 0` — race-safe; два юзера не могут активировать один и тот же ключ.
- **Закрытый бот.** Любой text-message от неавторизованного пользователя молча игнорируется. Нет утечки «бот существует» — только команды `/start <KEY>`, `/help` и базовые поведения.
- **Админ — один**, и определяется через env-переменную `ADMIN_TG_ID`. Захват аккаунта — единственный путь к админ-командам.
- **HTML-escape применён везде**, где user-input идёт в `parse_mode: 'HTML'`. Регулярных тестов на это сейчас **нет** — на roadmap'е.

> 💡 Если ты потерял `ENCRYPTION_KEY` — токены/cookie в БД становятся «мёртвыми» зашифрованными байтами. Это **фича**, а не баг: их нельзя восстановить, нужно просто пересохранить через `/settoken` и `/setcookie`. Юзеры и invite-ключи останутся.

---

## 🤝 Contributing

PR'ы, баг-репорты и фича-реквесты — велкам в [Issues](https://github.com/VanyaSvetoslav/AutoEdu/issues).
Перед коммитом:

```bash
npm run lint && npm run format:check && npm run typecheck && npm run build
```

CI ругается, если хоть одно не зелёное.

---

## 📄 Лицензия

[MIT](./LICENSE) © 2026 VanyaSvetoslav

---

<div align="center">

**Сделано с ❤️ для тех, кто устал клацать по сайту mosreg ради двух строчек домашки.**

</div>
