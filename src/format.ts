import type { HomeworkEntry } from './mosreg.js';

const DAY_NAMES = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];
const MONTH_NAMES = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = DAY_NAMES[date.getUTCDay()];
  const month = MONTH_NAMES[m - 1];
  return `${dow}, ${d} ${month} ${y}`;
}

function timeFromIso(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function groupByDate(entries: HomeworkEntry[]): Map<string, HomeworkEntry[]> {
  const map = new Map<string, HomeworkEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.lesson_date_time ?? '').localeCompare(b.lesson_date_time ?? ''));
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function formatEntry(entry: HomeworkEntry): string {
  const lines: string[] = [];
  const time = timeFromIso(entry.lesson_date_time);
  const subject = escapeHtml(entry.subject_name || 'Без предмета');
  const head = time ? `<b>🕘 ${time} · ${subject}</b>` : `<b>📚 ${subject}</b>`;
  lines.push(head);

  const text = (entry.homework ?? entry.description ?? '').trim();
  if (text) {
    lines.push(escapeHtml(text));
  } else {
    lines.push('<i>(без текста)</i>');
  }

  for (const m of entry.materials) {
    const titleRaw = m.title || m.type_name || 'Материал';
    const title = escapeHtml(titleRaw);
    const url = m.urls?.[0]?.url;
    if (url) {
      lines.push(`📎 <a href="${escapeHtml(url)}">${title}</a>`);
    } else {
      lines.push(`📎 ${title}`);
    }
  }

  if (entry.is_done) {
    lines.push('<i>✓ отмечено выполненным</i>');
  }

  return lines.join('\n');
}

export function formatHomeworks(entries: HomeworkEntry[], from: string, to: string): string[] {
  if (entries.length === 0) {
    const range = from === to ? humanDate(from) : `${humanDate(from)} — ${humanDate(to)}`;
    return [`<b>📅 ${escapeHtml(range)}</b>\n\n<i>Домашних заданий не найдено.</i>`];
  }

  const grouped = groupByDate(entries);
  const messages: string[] = [];
  let current = '';
  const MAX = 3500;

  for (const [date, list] of grouped) {
    const header = `<b>📅 ${escapeHtml(humanDate(date))}</b>`;
    const blocks = list.map(formatEntry);
    const dayBlock = [header, ...blocks].join('\n\n');

    if (current.length + dayBlock.length + 2 > MAX && current) {
      messages.push(current);
      current = dayBlock;
    } else {
      current = current ? `${current}\n\n${dayBlock}` : dayBlock;
    }
  }
  if (current) messages.push(current);
  return messages;
}
