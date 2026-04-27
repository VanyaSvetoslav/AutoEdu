import type {
  Dynamic,
  HomeworkEntry,
  SubjectMark,
  SubjectMarkPeriod,
  SubjectMarks,
} from './mosreg.js';

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

function dynamicIcon(d: Dynamic | undefined): string {
  switch (d) {
    case 'UP':
      return '📈';
    case 'DOWN':
      return '📉';
    case 'STABLE':
    case 'NONE':
      return '➖';
    default:
      return '➖';
  }
}

function formatMarkValue(m: SubjectMark): string {
  if (m.value === '5') return '<b>5</b>';
  if (m.value === '2' || m.value === '1') return `<b>${escapeHtml(m.value)}</b>`;
  return escapeHtml(m.value);
}

function formatMarkLine(m: SubjectMark): string {
  const value = formatMarkValue(m);
  const weight = m.weight && m.weight !== 1 ? ` ×${m.weight}` : '';
  const form = m.control_form_name ? ` · ${escapeHtml(m.control_form_name)}` : '';
  const parts = m.date ? m.date.split('-') : [];
  const date = parts.length === 3 ? ` · ${escapeHtml(`${parts[2]}.${parts[1]}`)}` : '';
  const exam = m.is_exam ? ' 📝' : '';
  const comment = m.comment && m.comment.trim() ? ` <i>(${escapeHtml(m.comment.trim())})</i>` : '';
  return `${value}${weight}${exam}${form}${date}${comment}`;
}

export function formatMarksOverview(subjects: SubjectMarks[]): string[] {
  if (subjects.length === 0) {
    return ['<b>📊 Оценки</b>\n\n<i>Оценок пока нет.</i>'];
  }
  const sorted = [...subjects].sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'ru'));
  const lines: string[] = ['<b>📊 Оценки — средние по предметам</b>', ''];
  for (const s of sorted) {
    const icon = dynamicIcon(s.dynamic);
    const avg = s.average ?? '—';
    const year = s.year_mark ? ` · год: <b>${escapeHtml(s.year_mark)}</b>` : '';
    lines.push(`${icon} ${escapeHtml(s.subject_name)} — <b>${escapeHtml(avg)}</b>${year}`);
  }
  lines.push('');
  lines.push('<i>Подробно: /marks &lt;часть_названия_предмета&gt;</i>');
  return [lines.join('\n')];
}

function formatPeriod(p: SubjectMarkPeriod): string {
  const lines: string[] = [];
  const icon = dynamicIcon(p.dynamic);
  const range = `${escapeHtml(p.start)}–${escapeHtml(p.end)}`;
  lines.push(`<b>🗓 ${escapeHtml(p.title)}</b> (${range}) — ${escapeHtml(p.value)} ${icon}`);
  if (p.marks.length === 0) {
    lines.push('<i>(оценок нет)</i>');
  } else {
    const sorted = [...p.marks].sort((a, b) => a.date.localeCompare(b.date));
    for (const m of sorted) {
      lines.push(`• ${formatMarkLine(m)}`);
    }
  }
  return lines.join('\n');
}

export function formatSubjectMarks(subject: SubjectMarks): string[] {
  const header = [
    `<b>📊 ${escapeHtml(subject.subject_name)}</b>`,
    `Средняя: <b>${escapeHtml(subject.average ?? '—')}</b> ${dynamicIcon(subject.dynamic)}` +
      (subject.year_mark ? ` · год: <b>${escapeHtml(subject.year_mark)}</b>` : ''),
  ].join('\n');
  const periods = subject.periods.map(formatPeriod);

  const messages: string[] = [];
  let current = header;
  const MAX = 3500;
  for (const block of periods) {
    if (current.length + block.length + 2 > MAX) {
      messages.push(current);
      current = block;
    } else {
      current = `${current}\n\n${block}`;
    }
  }
  if (current) messages.push(current);
  return messages;
}

export function findSubjects(subjects: SubjectMarks[], query: string): SubjectMarks[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return subjects.filter((s) => s.subject_name.toLowerCase().includes(q));
}
