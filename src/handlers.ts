import { GrammyError, HttpError, InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { config } from './config.js';
import {
  consumeInviteKey,
  createInviteKey,
  deleteUser,
  ensureUser,
  getInviteKey,
  getMosregCredentials,
  getUser,
  getUserByUsername,
  listInviteKeys,
  listUsers,
  revokeInviteKey,
  setMosregCookie,
  setMosregPerson,
  setMosregStudent,
  setMosregToken,
  touchUser,
} from './db.js';
import type { UserMeta, UserRow } from './db.js';
import {
  resolveRangeArg,
  shiftIso,
  todayIso,
  tomorrowIso,
  weekRange,
  humanRangeRu,
} from './dates.js';
import {
  fetchHomeworks,
  fetchSchedule,
  fetchSubjectMarks,
  MosregApiError,
  MosregNotConfiguredError,
  MosregPersonNotConfiguredError,
  mosregDebugCall,
  mosregScheduleDebugCall,
} from './mosreg.js';
import type { HomeworkEntry } from './mosreg.js';
import {
  escapeHtml,
  findSubjects,
  formatHomeworks,
  formatMarksOverview,
  formatSchedule,
  formatSubjectMarks,
} from './format.js';
import { generateInviteKey } from './keys.js';

const ADMIN_ID = Number(config.ADMIN_TG_ID);

function isAdmin(ctx: Context): boolean {
  return ctx.from?.id === ADMIN_ID;
}

function isAuthorized(tgId: number): boolean {
  if (tgId === ADMIN_ID) return true;
  const user = getUser(tgId);
  return user !== undefined;
}

const HELP_USER = `<b>AutoEdu — домашка, оценки и расписание из mosreg.ru</b>

<b>Домашка:</b>
/today — ДЗ на сегодня
/tomorrow — ДЗ на завтра
/week — ДЗ на ближайшие 7 дней
/hw <code>YYYY-MM-DD</code> — ДЗ на конкретную дату
/hw <code>YYYY-MM-DD..YYYY-MM-DD</code> — ДЗ на диапазон дат
/subject <code>&lt;часть_названия&gt;</code> — ДЗ только по этому предмету за неделю
/subject <code>&lt;часть_названия&gt; tomorrow|week|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD</code> — он же за конкретный период
ℹ️ После /week и /hw появятся кнопки с предметами — нажми, чтобы отфильтровать выдачу.

<b>Расписание:</b>
/schedule — расписание на сегодня
/schedule <code>tomorrow</code> — на завтра
/schedule <code>week</code> — на ближайшие 7 дней
/schedule <code>YYYY-MM-DD</code> — на конкретную дату
/schedule <code>YYYY-MM-DD..YYYY-MM-DD</code> — на диапазон дат

<b>Оценки:</b>
/marks — средние по всем предметам
/marks <code>&lt;часть_названия&gt;</code> — детально по предмету (например: <code>/marks алгебра</code>)

/help — эта справка`;

const HELP_ADMIN = `${HELP_USER}

<b>Команды администратора:</b>
/genkey [N] — создать N приглашений (по умолчанию 1)
/keys — последние 50 ключей
/revoke <code>KEY</code> — отозвать ключ
/users — список пользователей
/kick <code>&lt;tg_id|@username&gt;</code> — удалить пользователя из системы
/kick <code>&lt;tg_id|@username&gt;</code> <code>--release</code> — удалить и освободить его ключ для повторного использования
/settoken <code>&lt;Authorization&gt;</code> — обновить Bearer-токен mosreg
/setcookie <code>&lt;Cookie&gt;</code> — обновить Cookie mosreg
/setstudent <code>&lt;student_id&gt;</code> [profile_id] — задать ID ученика
/setperson <code>&lt;UUID&gt;</code> — задать person_id (UUID) для расписания
/credstatus — статус сохранённых credentials
/apidebug — тестовый запрос к mosreg /homeworks (сырой ответ)
/scheduledebug — тестовый запрос к mosreg /eventcalendar (сырой ответ)`;

// Pulls Telegram-side user metadata off a Context so we can persist it.
function ctxUserMeta(ctx: Context): UserMeta {
  return {
    username: ctx.from?.username ?? null,
    firstName: ctx.from?.first_name ?? null,
    lastName: ctx.from?.last_name ?? null,
  };
}

function fullName(u: { first_name: string | null; last_name: string | null }): string | null {
  const parts = [u.first_name ?? '', u.last_name ?? ''].map((s) => s.trim()).filter(Boolean);
  return parts.length === 0 ? null : parts.join(' ');
}

// Returns an HTML chunk that links to the user's Telegram profile by id and
// shows their @username + display name when available. Falls back to a bare
// numeric id when Telegram never gave us a username (e.g. user has none).
function userMention(u: UserRow): string {
  const name = fullName(u);
  const username = u.username ? `@${u.username}` : null;
  const display = username ?? name ?? String(u.tg_id);
  const link = `<a href="tg://user?id=${u.tg_id}">${escapeHtml(display)}</a>`;
  // Trailer always includes the numeric id so admins can /kick by id, and
  // adds the full name when only @username was used in the link. When we
  // have neither username nor name, the link itself already shows the id —
  // skip the redundant duplicate.
  const extras: string[] = [];
  if (username && name) extras.push(escapeHtml(name));
  if (username || name) extras.push(`<code>${u.tg_id}</code>`);
  return extras.length === 0 ? link : `${link} · ${extras.join(' · ')}`;
}

function quickKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📅 Сегодня', 'hw:today')
    .text('➡️ Завтра', 'hw:tomorrow')
    .row()
    .text('🗓 Неделя', 'hw:week');
}

function scheduleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📅 Сегодня', 'sch:today')
    .text('➡️ Завтра', 'sch:tomorrow')
    .row()
    .text('🗓 Неделя', 'sch:week');
}

async function sendSchedule(ctx: Context, from: string, to: string): Promise<void> {
  await ctx.replyWithChatAction('typing').catch(() => undefined);
  try {
    const entries = await fetchSchedule(from, to);
    const chunks = formatSchedule(entries, from, to);
    for (let i = 0; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      await ctx.reply(chunks[i]!, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(isLast ? { reply_markup: scheduleKeyboard() } : {}),
      });
    }
  } catch (err) {
    if (err instanceof MosregNotConfiguredError) {
      await ctx.reply(
        '⚠️ Mosreg ещё не настроен. Админ должен вызвать /settoken, /setcookie и /setstudent.',
      );
      return;
    }
    if (err instanceof MosregPersonNotConfiguredError) {
      await ctx.reply(
        '⚠️ Для расписания нужен <code>person_id</code> (UUID). Админ должен вызвать <code>/setperson &lt;UUID&gt;</code>.',
        { parse_mode: 'HTML' },
      );
      return;
    }
    if (err instanceof MosregApiError) {
      const hint =
        err.status === 401 || err.status === 403
          ? '\n\n💡 Похоже, токен или Cookie протухли. Админ должен обновить их через /settoken и /setcookie.'
          : '';
      await ctx.reply(`❌ Ошибка mosreg API (${err.status}).${hint}`);
      return;
    }
    console.error('schedule fetch failed', err);
    await ctx.reply('❌ Не удалось получить расписание. Попробуй ещё раз через минуту.');
  }
}

// Builds a keyboard with one button per distinct subject in `entries`.
// callback_data fits in Telegram's 64-byte limit: "hwsub:" (6) + 10-byte
// from + ":" + 10-byte to + ":" + numeric subject_id (up to ~10 digits) =
// well under the limit. Subjects are sorted by name and placed in 2 columns.
function subjectFilterKeyboard(
  entries: HomeworkEntry[],
  from: string,
  to: string,
): InlineKeyboard | null {
  const seen = new Map<number, string>();
  for (const e of entries) {
    if (e.subject_id && e.subject_name && !seen.has(e.subject_id)) {
      seen.set(e.subject_id, e.subject_name);
    }
  }
  if (seen.size === 0) return null;
  const sorted = [...seen.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'ru'));
  const kb = new InlineKeyboard();
  let col = 0;
  for (const [sid, name] of sorted) {
    if (col === 2) {
      kb.row();
      col = 0;
    }
    kb.text(`📚 ${name}`, `hwsub:${from}:${to}:${sid}`);
    col += 1;
  }
  return kb;
}

function filterHomeworksBySubjectId(entries: HomeworkEntry[], subjectId: number): HomeworkEntry[] {
  return entries.filter((e) => e.subject_id === subjectId);
}

function filterHomeworksBySubjectQuery(entries: HomeworkEntry[], query: string): HomeworkEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => (e.subject_name ?? '').toLowerCase().includes(q));
}

async function replyMosregError(ctx: Context, err: unknown, what: string): Promise<void> {
  if (err instanceof MosregNotConfiguredError) {
    await ctx.reply(
      '⚠️ Mosreg ещё не настроен. Админ должен вызвать /settoken, /setcookie и /setstudent.',
    );
    return;
  }
  if (err instanceof MosregApiError) {
    const hint =
      err.status === 401 || err.status === 403
        ? '\n\n💡 Похоже, токен или Cookie протухли. Админ должен обновить их через /settoken и /setcookie.'
        : '';
    await ctx.reply(`❌ Ошибка mosreg API (${err.status}).${hint}`);
    return;
  }
  console.error(`${what} fetch failed`, err);
  await ctx.reply(`❌ Не удалось получить ${what}. Попробуй ещё раз через минуту.`);
}

async function sendHomeworks(ctx: Context, from: string, to: string): Promise<void> {
  await ctx.replyWithChatAction('typing').catch(() => undefined);
  try {
    const entries = await fetchHomeworks(from, to);
    const chunks = formatHomeworks(entries, from, to);
    const subjectKb = subjectFilterKeyboard(entries, from, to);
    for (let i = 0; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      await ctx.reply(chunks[i]!, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        // On the last chunk, prefer subject-filter buttons (more useful for
        // multi-day ranges); fall back to the today/tomorrow/week shortcuts
        // when there are no homeworks.
        ...(isLast ? { reply_markup: subjectKb ?? quickKeyboard() } : {}),
      });
    }
  } catch (err) {
    await replyMosregError(ctx, err, 'домашку');
  }
}

// Renders homework filtered to a single subject. `subjectLabel` is what we
// display in the heading (full name when we resolved by id, or the user's
// query verbatim when we matched by substring).
async function sendHomeworksForSubject(
  ctx: Context,
  from: string,
  to: string,
  filter: { kind: 'id'; subjectId: number } | { kind: 'query'; query: string },
): Promise<void> {
  await ctx.replyWithChatAction('typing').catch(() => undefined);
  try {
    const entries = await fetchHomeworks(from, to);
    const filtered =
      filter.kind === 'id'
        ? filterHomeworksBySubjectId(entries, filter.subjectId)
        : filterHomeworksBySubjectQuery(entries, filter.query);

    let label: string;
    if (filter.kind === 'id') {
      label = entries.find((e) => e.subject_id === filter.subjectId)?.subject_name ?? '—';
    } else {
      label = filter.query;
    }

    const range = humanRangeRu(from, to);
    if (filtered.length === 0) {
      // Suggest neighbouring subject names so the user can fix typos quickly.
      const known = [...new Set(entries.map((e) => e.subject_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .join(', ');
      const knownPart = known ? `\n\nДоступные предметы за этот период: ${escapeHtml(known)}` : '';
      await ctx.reply(
        `📚 <b>${escapeHtml(label)}</b> · ${escapeHtml(range)}\n\n<i>ДЗ нет.</i>${knownPart}`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const heading = `📚 <b>${escapeHtml(label)}</b> · ${escapeHtml(range)}`;
    const chunks = formatHomeworks(filtered, from, to);
    // Prefix the first chunk with the subject heading so the user always sees
    // which subject and range they're looking at.
    chunks[0] = `${heading}\n\n${chunks[0]}`;
    for (let i = 0; i < chunks.length; i += 1) {
      await ctx.reply(chunks[i]!, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (err) {
    await replyMosregError(ctx, err, 'домашку по предмету');
  }
}

export function registerHandlers(bot: Bot): void {
  // Refresh username/first_name/last_name on every interaction so /users can
  // show human-readable identities and the admin can /kick by @username.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id) {
      touchUser(ctx.from.id, ctxUserMeta(ctx));
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const args = (ctx.match ?? '').toString().trim();
    const meta = ctxUserMeta(ctx);

    if (tgId === ADMIN_ID) {
      ensureUser(tgId, 'admin', null, meta);
      await ctx.reply(`Привет, админ! 👋\n\n${HELP_ADMIN}`, { parse_mode: 'HTML' });
      return;
    }

    if (getUser(tgId)) {
      await ctx.reply(`С возвращением!\n\n${HELP_USER}`, { parse_mode: 'HTML' });
      return;
    }

    if (!args) {
      await ctx.reply(
        'Этот бот приватный. Чтобы получить доступ, попроси админа создать ключ-приглашение и пришли его командой:\n<code>/start KEY-XXXX-XXXX-XXXX</code>',
        { parse_mode: 'HTML' },
      );
      return;
    }

    const row = getInviteKey(args);
    if (!row || row.revoked || row.used_by !== null) {
      await ctx.reply('❌ Ключ недействителен, уже использован или отозван.');
      return;
    }
    if (!consumeInviteKey(args, tgId)) {
      await ctx.reply('❌ Не удалось активировать ключ. Попробуй ещё раз.');
      return;
    }
    const userRow = ensureUser(tgId, 'user', args, meta);
    await ctx.reply(`✅ Доступ выдан!\n\n${HELP_USER}`, { parse_mode: 'HTML' });

    // Notify admin so they know who claimed the invite without /users-checking.
    if (ADMIN_ID && ADMIN_ID !== tgId) {
      const text =
        `🔔 Новый пользователь активировал ключ <code>${escapeHtml(args)}</code>:\n` +
        `${userMention(userRow)}`;
      try {
        await ctx.api.sendMessage(ADMIN_ID, text, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('failed to notify admin of key activation', err);
      }
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(isAdmin(ctx) ? HELP_ADMIN : HELP_USER, { parse_mode: 'HTML' });
  });

  const requireAuth = async (ctx: Context, fn: () => Promise<void>): Promise<void> => {
    if (!ctx.from || !isAuthorized(ctx.from.id)) {
      await ctx.reply('🚫 Нет доступа. Используй /start <ключ>.');
      return;
    }
    await fn();
  };

  bot.command('today', (ctx) =>
    requireAuth(ctx, async () => {
      const d = todayIso();
      await sendHomeworks(ctx, d, d);
    }),
  );

  bot.command('tomorrow', (ctx) =>
    requireAuth(ctx, async () => {
      const d = tomorrowIso();
      await sendHomeworks(ctx, d, d);
    }),
  );

  bot.command('week', (ctx) =>
    requireAuth(ctx, async () => {
      const { from, to } = weekRange();
      await sendHomeworks(ctx, from, to);
    }),
  );

  bot.command('hw', (ctx) =>
    requireAuth(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      const range = resolveRangeArg(arg);
      if (!range) {
        await ctx.reply(
          'Использование:\n<code>/hw 2026-04-27</code>\n<code>/hw 2026-04-27..2026-05-03</code>\n<code>/hw today|tomorrow|week</code>',
          { parse_mode: 'HTML' },
        );
        return;
      }
      await sendHomeworks(ctx, range.from, range.to);
    }),
  );

  // /subject <part_of_subject_name> [today|tomorrow|week|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD]
  // Default range is the current week. The subject query is everything
  // except the (optional) trailing range token, so multi-word subject names
  // ("информационная безопасность") work without quoting.
  bot.command('subject', (ctx) =>
    requireAuth(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      if (!arg) {
        await ctx.reply(
          'Использование:\n<code>/subject алгебра</code> — за неделю\n<code>/subject алгебра tomorrow</code>\n<code>/subject алгебра 2026-04-27..2026-05-03</code>',
          { parse_mode: 'HTML' },
        );
        return;
      }
      const tokens = arg.split(/\s+/);
      let range: { from: string; to: string } | null = null;
      let subjectQuery = arg;
      if (tokens.length > 1) {
        const last = tokens[tokens.length - 1]!;
        const candidate = resolveRangeArg(last);
        if (candidate) {
          range = candidate;
          subjectQuery = tokens.slice(0, -1).join(' ');
        }
      }
      if (!range) {
        range = weekRange();
      }
      if (!subjectQuery.trim()) {
        await ctx.reply('❌ Не указан предмет. Пример: <code>/subject алгебра week</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      await sendHomeworksForSubject(ctx, range.from, range.to, {
        kind: 'query',
        query: subjectQuery,
      });
    }),
  );

  bot.command('schedule', (ctx) =>
    requireAuth(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      const range = resolveRangeArg(arg);
      if (!range) {
        await ctx.reply(
          'Использование:\n<code>/schedule</code> — сегодня\n<code>/schedule tomorrow</code>\n<code>/schedule week</code>\n<code>/schedule 2026-04-27</code>\n<code>/schedule 2026-04-27..2026-05-03</code>',
          { parse_mode: 'HTML' },
        );
        return;
      }
      await sendSchedule(ctx, range.from, range.to);
    }),
  );

  const sendMarksError = async (ctx: Context, err: unknown): Promise<void> => {
    if (err instanceof MosregNotConfiguredError) {
      await ctx.reply('⚠️ Mosreg ещё не настроен. Админ должен вызвать /settoken и /setstudent.');
      return;
    }
    if (err instanceof MosregApiError) {
      const hint =
        err.status === 401 || err.status === 403
          ? '\n\n💡 Похоже, токен протух. Админ должен обновить его через /settoken.'
          : '';
      await ctx.reply(`❌ Ошибка mosreg API (${err.status}).${hint}`);
      return;
    }
    console.error('marks fetch failed', err);
    await ctx.reply('❌ Не удалось получить оценки. Попробуй ещё раз через минуту.');
  };

  bot.command('marks', (ctx) =>
    requireAuth(ctx, async () => {
      await ctx.replyWithChatAction('typing').catch(() => undefined);
      const query = (ctx.match ?? '').toString().trim();
      try {
        const subjects = await fetchSubjectMarks();
        if (!query) {
          const chunks = formatMarksOverview(subjects);
          for (const c of chunks) {
            await ctx.reply(c, { parse_mode: 'HTML' });
          }
          return;
        }
        const matches = findSubjects(subjects, query);
        if (matches.length === 0) {
          const known = subjects
            .map((s) => s.subject_name)
            .sort((a, b) => a.localeCompare(b, 'ru'))
            .join(', ');
          await ctx.reply(
            `❌ Предмет «${escapeHtml(query)}» не найден.\n\nДоступные: ${escapeHtml(known)}`,
            { parse_mode: 'HTML' },
          );
          return;
        }
        for (const subject of matches) {
          const chunks = formatSubjectMarks(subject);
          for (const c of chunks) {
            await ctx.reply(c, { parse_mode: 'HTML' });
          }
        }
      } catch (err) {
        await sendMarksError(ctx, err);
      }
    }),
  );

  bot.callbackQuery(/^hw:(today|tomorrow|week)$/, async (ctx) => {
    if (!ctx.from || !isAuthorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Нет доступа.' });
      return;
    }
    await ctx.answerCallbackQuery();
    const which = ctx.match[1];
    if (which === 'today') {
      const d = todayIso();
      await sendHomeworks(ctx, d, d);
    } else if (which === 'tomorrow') {
      const d = tomorrowIso();
      await sendHomeworks(ctx, d, d);
    } else {
      const { from, to } = weekRange();
      await sendHomeworks(ctx, from, to);
    }
  });

  // hwsub:<from>:<to>:<subject_id> — subject filter buttons appended to a
  // /week or /hw response. Re-fetches homeworks for the same range and
  // shows only entries with the requested subject_id.
  bot.callbackQuery(/^hwsub:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):(\d+)$/, async (ctx) => {
    if (!ctx.from || !isAuthorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Нет доступа.' });
      return;
    }
    await ctx.answerCallbackQuery();
    const from = ctx.match[1]!;
    const to = ctx.match[2]!;
    const subjectId = Number(ctx.match[3]!);
    await sendHomeworksForSubject(ctx, from, to, { kind: 'id', subjectId });
  });

  bot.callbackQuery(/^sch:(today|tomorrow|week)$/, async (ctx) => {
    if (!ctx.from || !isAuthorized(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Нет доступа.' });
      return;
    }
    await ctx.answerCallbackQuery();
    const which = ctx.match[1];
    if (which === 'today') {
      const d = todayIso();
      await sendSchedule(ctx, d, d);
    } else if (which === 'tomorrow') {
      const d = tomorrowIso();
      await sendSchedule(ctx, d, d);
    } else {
      const { from, to } = weekRange();
      await sendSchedule(ctx, from, to);
    }
  });

  // ---------- Admin ----------

  const requireAdmin = async (ctx: Context, fn: () => Promise<void>): Promise<void> => {
    if (!isAdmin(ctx)) {
      await ctx.reply('🚫 Только админ.');
      return;
    }
    await fn();
  };

  bot.command('genkey', (ctx) =>
    requireAdmin(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      let n = arg ? Math.max(1, Math.min(20, Number(arg))) : 1;
      if (Number.isNaN(n)) n = 1;
      const keys: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const k = generateInviteKey();
        createInviteKey(k, ctx.from!.id);
        keys.push(k);
      }
      const body = keys.map((k) => `<code>${k}</code>`).join('\n');
      await ctx.reply(
        `🔑 Создано ключей: ${n}\n\n${body}\n\nПередай юзеру: <code>/start KEY</code>`,
        {
          parse_mode: 'HTML',
        },
      );
    }),
  );

  bot.command('keys', (ctx) =>
    requireAdmin(ctx, async () => {
      const rows = listInviteKeys();
      if (rows.length === 0) {
        await ctx.reply('Ключей пока нет.');
        return;
      }
      const lines = rows.map((r) => {
        let status: string;
        if (r.revoked) {
          status = '🚫 отозван';
        } else if (r.used_by) {
          const u = getUser(r.used_by);
          status = `✅ использован: ${u ? userMention(u) : `<code>${r.used_by}</code>`}`;
        } else {
          status = '🟢 свободен';
        }
        return `<code>${r.key}</code> — ${status}`;
      });
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }),
  );

  bot.command('revoke', (ctx) =>
    requireAdmin(ctx, async () => {
      const key = (ctx.match ?? '').toString().trim();
      if (!key) {
        await ctx.reply('Использование: <code>/revoke KEY-XXXX-XXXX-XXXX</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      const ok = revokeInviteKey(key);
      await ctx.reply(ok ? '✅ Ключ отозван.' : '❌ Ключ не найден.');
    }),
  );

  bot.command('users', (ctx) =>
    requireAdmin(ctx, async () => {
      const rows = listUsers();
      if (rows.length === 0) {
        await ctx.reply('Пользователей пока нет.');
        return;
      }
      const lines = rows.map((u) => {
        const role = u.role === 'admin' ? '👑' : '👤';
        const joined = new Date(u.joined_at * 1000).toISOString().slice(0, 10);
        return `${role} ${userMention(u)} · ${joined}`;
      });
      await ctx.reply(lines.join('\n'), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }),
  );

  bot.command('kick', (ctx) =>
    requireAdmin(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      if (!arg) {
        await ctx.reply(
          'Использование:\n<code>/kick &lt;tg_id|@username&gt;</code> — удалить пользователя\n<code>/kick &lt;tg_id|@username&gt; --release</code> — удалить и освободить его ключ для повторного использования',
          { parse_mode: 'HTML' },
        );
        return;
      }
      const parts = arg.split(/\s+/);
      const target = parts[0]!;
      const releaseKey = parts.slice(1).includes('--release');

      let user: UserRow | undefined;
      if (/^\d+$/.test(target)) {
        user = getUser(Number(target));
      } else {
        user = getUserByUsername(target);
      }
      if (!user) {
        await ctx.reply(
          `❌ Пользователь не найден.\n\n💡 По <code>@username</code> ищется только среди тех, кто хоть раз писал боту после обновления (так Telegram сообщает username). Попробуй по числовому id из /users.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      if (user.tg_id === ADMIN_ID) {
        await ctx.reply('🚫 Нельзя удалить админа.');
        return;
      }
      const ok = deleteUser(user.tg_id, { releaseKey });
      if (!ok) {
        await ctx.reply('❌ Не удалось удалить пользователя (уже отсутствует?).');
        return;
      }
      const releasedNote =
        releaseKey && user.used_key
          ? `\nКлюч <code>${escapeHtml(user.used_key)}</code> освобождён и снова свободен.`
          : '';
      await ctx.reply(`✅ Удалён: ${userMention(user)}${releasedNote}`, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }),
  );

  bot.command('settoken', (ctx) =>
    requireAdmin(ctx, async () => {
      const value = (ctx.match ?? '').toString().trim();
      if (!value) {
        await ctx.reply(
          'Использование: <code>/settoken &lt;Bearer ...&gt;</code>\n\nМожно с префиксом <code>Bearer</code> или без — бот добавит сам.',
          { parse_mode: 'HTML' },
        );
        return;
      }
      setMosregToken(value);
      await ctx.deleteMessage().catch(() => undefined);
      await ctx.reply('✅ Токен сохранён (зашифрован). Сообщение удалено.');
    }),
  );

  bot.command('setcookie', (ctx) =>
    requireAdmin(ctx, async () => {
      const value = (ctx.match ?? '').toString().trim();
      if (!value) {
        await ctx.reply('Использование: <code>/setcookie &lt;Cookie header&gt;</code>', {
          parse_mode: 'HTML',
        });
        return;
      }
      setMosregCookie(value);
      await ctx.deleteMessage().catch(() => undefined);
      await ctx.reply('✅ Cookie сохранён (зашифрован). Сообщение удалено.');
    }),
  );

  bot.command('setstudent', (ctx) =>
    requireAdmin(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      if (!arg) {
        await ctx.reply(
          'Использование: <code>/setstudent &lt;student_id&gt; [profile_id]</code>\n\nЕсли profile_id не указан, используется student_id.',
          { parse_mode: 'HTML' },
        );
        return;
      }
      const [studentId, profileIdRaw] = arg.split(/\s+/);
      if (!studentId || !/^\d+$/.test(studentId)) {
        await ctx.reply('❌ student_id должен быть числом.');
        return;
      }
      const profileId = profileIdRaw && /^\d+$/.test(profileIdRaw) ? profileIdRaw : studentId;
      setMosregStudent(studentId, profileId);
      await ctx.reply(
        `✅ student_id=<code>${studentId}</code>, profile_id=<code>${profileId}</code> сохранены.`,
        { parse_mode: 'HTML' },
      );
    }),
  );

  bot.command('setperson', (ctx) =>
    requireAdmin(ctx, async () => {
      const arg = (ctx.match ?? '').toString().trim();
      if (!arg) {
        await ctx.reply(
          'Использование: <code>/setperson &lt;UUID&gt;</code>\n\nUUID можно подсмотреть в запросе mosreg к <code>eventcalendar</code> (параметр <code>person_ids</code>).',
          { parse_mode: 'HTML' },
        );
        return;
      }
      const uuidRe =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (!uuidRe.test(arg)) {
        await ctx.reply(
          '❌ person_id должен быть UUID вида <code>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>.',
          {
            parse_mode: 'HTML',
          },
        );
        return;
      }
      setMosregPerson(arg);
      await ctx.reply(`✅ person_id=<code>${arg}</code> сохранён.`, { parse_mode: 'HTML' });
    }),
  );

  bot.command('credstatus', (ctx) =>
    requireAdmin(ctx, async () => {
      const c = getMosregCredentials();
      const updated = c.updatedAt
        ? new Date(c.updatedAt * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : '—';
      const tokenLen = c.token ? Buffer.byteLength(c.token, 'utf8') : 0;
      const cookieLen = c.cookie ? Buffer.byteLength(c.cookie, 'utf8') : 0;
      const tokenPrefix = c.token ? c.token.slice(0, 12) + '…' : '';
      const lines = [
        `Token:     ${c.token ? `✅ ${tokenLen} байт (${tokenPrefix})` : '❌ нет'}`,
        `Cookie:    ${c.cookie ? `✅ ${cookieLen} байт` : '➖ не задан (опционально)'}`,
        `Student:   ${c.studentId ?? '—'}`,
        `Profile:   ${c.profileId ?? '—'}`,
        `Person:    ${c.personId ?? '— (нужен для /schedule)'}`,
        `Обновлено: ${updated}`,
      ];
      await ctx.reply(`<pre>${escapeHtml(lines.join('\n'))}</pre>`, { parse_mode: 'HTML' });
    }),
  );

  bot.command('apidebug', (ctx) =>
    requireAdmin(ctx, async () => {
      try {
        const result = await mosregDebugCall(todayIso(), todayIso());
        const cookiePart = result.sentCookie ? `Cookie len: ${result.sentCookie}` : 'Cookie: skip';
        const lines = [
          `URL: ${result.url}`,
          `Headers: Authorization len=${result.sentAuthLen}, ${cookiePart}`,
          `→ HTTP ${result.status}`,
          '',
          'Body (first 400 chars):',
          result.bodyPreview,
        ];
        await ctx.reply(`<pre>${escapeHtml(lines.join('\n'))}</pre>`, { parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(
          `❌ apidebug failed: <pre>${escapeHtml(String(err instanceof Error ? (err.stack ?? err.message) : err))}</pre>`,
          { parse_mode: 'HTML' },
        );
      }
    }),
  );

  bot.command('scheduledebug', (ctx) =>
    requireAdmin(ctx, async () => {
      try {
        const d = todayIso();
        const result = await mosregScheduleDebugCall(d, d);
        const cookieKind = result.syntheticCookie ? 'synthetic' : 'user-provided';
        const lines = [
          `URL: ${result.url}`,
          `Headers: Authorization len=${result.sentAuthLen}, Auth-Token len=${result.sentAuthTokenLen}, Cookie len=${result.sentCookieLen} (${cookieKind})`,
          `→ HTTP ${result.status}`,
          '',
          'Body (first 400 chars):',
          result.bodyPreview,
        ];
        await ctx.reply(`<pre>${escapeHtml(lines.join('\n'))}</pre>`, { parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(
          `❌ scheduledebug failed: <pre>${escapeHtml(String(err instanceof Error ? (err.stack ?? err.message) : err))}</pre>`,
          { parse_mode: 'HTML' },
        );
      }
    }),
  );

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error('Grammy error', e.description);
    } else if (e instanceof HttpError) {
      console.error('HTTP error', e);
    } else {
      console.error('Unknown handler error', e);
    }
  });

  // Silently ignore other text from unauthorized users.
  bot.on('message:text', async (ctx) => {
    if (!ctx.from || !isAuthorized(ctx.from.id)) return;
    await ctx.reply('Не понял команду. Используй /help для списка команд.');
  });

  // Suppress unused-import complaint for shiftIso.
  void shiftIso;
  void humanRangeRu;
}
