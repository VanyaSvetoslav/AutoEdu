import type {
  Dynamic,
  HomeworkEntry,
  ScheduleEntry,
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

// Σ(value*weight) / Σ(weight) over numeric mark values. Skips non-numeric
// values like "Н" / "ОСВ" and empty/whitespace strings. Without the
// whitespace check, `Number("") === 0`, which would silently drag the
// average down on a 1–5 scale. Returns null if there are no numeric marks.
function weightedAverage(marks: SubjectMark[]): number | null {
  let sum = 0;
  let weights = 0;
  for (const m of marks) {
    if (!m.value || !m.value.trim()) continue;
    const v = Number(m.value);
    if (!Number.isFinite(v)) continue;
    const w = m.weight && m.weight > 0 ? m.weight : 1;
    sum += v * w;
    weights += w;
  }
  if (weights === 0) return null;
  return sum / weights;
}

function formatAverage(avg: number | null): string {
  return avg === null ? '—' : avg.toFixed(2);
}

// "5×3 · 4×6 · 3×2". Skips empty/whitespace and non-numeric values for the
// same reason as `weightedAverage` (Number("") === 0).
function markDistribution(marks: SubjectMark[]): string {
  const counts = new Map<string, number>();
  for (const m of marks) {
    if (!m.value || !m.value.trim()) continue;
    if (!Number.isFinite(Number(m.value))) continue;
    counts.set(m.value, (counts.get(m.value) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const ordered = [...counts.entries()].sort(([a], [b]) => Number(b) - Number(a));
  return ordered.map(([v, c]) => `${escapeHtml(v)}×${c}`).join(' · ');
}

// "I · II · III" mark digest from periods[].value, with — for empty.
function periodDigest(periods: SubjectMarkPeriod[]): string {
  if (periods.length === 0) return '';
  return periods
    .map((p) => {
      const v = p.value && p.value.trim() ? p.value.trim() : '—';
      return escapeHtml(v);
    })
    .join(' · ');
}

export function formatMarksOverview(subjects: SubjectMarks[]): string[] {
  if (subjects.length === 0) {
    return ['<b>📊 Оценки</b>\n\n<i>Оценок пока нет.</i>'];
  }
  const sorted = [...subjects].sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'ru'));
  const lines: string[] = [
    '<b>📊 Оценки</b>',
    '<i>Формат: предмет — оценки за периоды (I · II · III) · средневзвешенная за всё время · год.</i>',
    '<i>«Средневзвешенная» — это число, которое сам считает дневник по всем оценкам с весами; оно может отличаться от итоговой оценки за период.</i>',
    '',
  ];
  for (const s of sorted) {
    const icon = dynamicIcon(s.dynamic);
    const periods = periodDigest(s.periods);
    const calc = formatAverage(weightedAverage(s.periods.flatMap((p) => p.marks)));
    const apiAvg = s.average && s.average.trim() ? s.average : null;
    const avgPart = apiAvg ? `ср. <b>${escapeHtml(apiAvg)}</b>` : `ср. <b>${calc}</b>`;
    const year = s.year_mark ? ` · год: <b>${escapeHtml(s.year_mark)}</b>` : '';
    const periodsPart = periods ? ` — ${periods}` : '';
    lines.push(`${icon} <b>${escapeHtml(s.subject_name)}</b>${periodsPart} · ${avgPart}${year}`);
  }
  lines.push('');
  lines.push('<i>Подробно: /marks &lt;часть_названия_предмета&gt;</i>');
  return [lines.join('\n')];
}

function formatPeriodHeader(p: SubjectMarkPeriod): string {
  const icon = dynamicIcon(p.dynamic);
  const range = `${escapeHtml(p.start)}–${escapeHtml(p.end)}`;
  const value = p.value && p.value.trim() ? p.value.trim() : '—';
  return `<b>🗓 ${escapeHtml(p.title)}</b> (${range}) · итог: <b>${escapeHtml(value)}</b> ${icon}`;
}

function formatPeriod(p: SubjectMarkPeriod): string {
  const lines: string[] = [formatPeriodHeader(p)];
  if (p.marks.length === 0) {
    lines.push('<i>(оценок нет)</i>');
    return lines.join('\n');
  }
  const calc = weightedAverage(p.marks);
  const dist = markDistribution(p.marks);
  lines.push(
    `<i>Расчётная средневзвешенная: <b>${formatAverage(calc)}</b> · оценок: ${p.marks.length}</i>`,
  );
  if (dist) {
    lines.push(`<i>Распределение: ${dist}</i>`);
  }
  const sorted = [...p.marks].sort((a, b) => a.date.localeCompare(b.date));
  for (const m of sorted) {
    lines.push(`• ${formatMarkLine(m)}`);
  }
  return lines.join('\n');
}

export function formatSubjectMarks(subject: SubjectMarks): string[] {
  const headerLines = [
    `<b>📊 ${escapeHtml(subject.subject_name)}</b> ${dynamicIcon(subject.dynamic)}`,
    '',
  ];

  // Compact summary block at the top so the user sees итоги без листания.
  headerLines.push('<b>Итоги по периодам</b>');
  if (subject.periods.length === 0) {
    headerLines.push('<i>(периодов нет)</i>');
  } else {
    for (const p of subject.periods) {
      const v = p.value && p.value.trim() ? p.value.trim() : '—';
      headerLines.push(`🗓 ${escapeHtml(p.title)}: <b>${escapeHtml(v)}</b>`);
    }
  }
  if (subject.year_mark) {
    headerLines.push(`📅 Год: <b>${escapeHtml(subject.year_mark)}</b>`);
  }
  if (subject.average && subject.average.trim()) {
    headerLines.push(
      `🌍 Средневзвешенная за всё время (по дневнику): <b>${escapeHtml(subject.average)}</b>`,
    );
  }
  const allMarks = subject.periods.flatMap((p) => p.marks);
  const calcAll = weightedAverage(allMarks);
  if (calcAll !== null) {
    headerLines.push(
      `🧮 Средневзвешенная за всё время (расчётная): <b>${formatAverage(calcAll)}</b> · оценок: ${allMarks.length}`,
    );
  }
  const header = headerLines.join('\n');
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

function dateFromIso(s: string): string {
  // "2026-04-27T08:50:00+03:00" -> "2026-04-27"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : s;
}

function hhmm(s: string): string {
  const m = s.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function groupScheduleByDate(entries: ScheduleEntry[]): Map<string, ScheduleEntry[]> {
  const map = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const date = dateFromIso(e.start_at);
    const list = map.get(date) ?? [];
    list.push(e);
    map.set(date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
  }
  return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function formatScheduleEntry(entry: ScheduleEntry, index: number): string {
  const lines: string[] = [];
  const start = hhmm(entry.start_at);
  const finish = hhmm(entry.finish_at);
  const time = start && finish ? `${start}–${finish}` : start || finish || '';
  const subject = escapeHtml(entry.subject_name || 'Без предмета');
  const num = `${index}.`;

  const flags: string[] = [];
  if (entry.cancelled) flags.push('❌ отменён');
  if (entry.replaced) flags.push('🔁 замена');
  const flagsStr = flags.length > 0 ? ` <i>(${flags.join(', ')})</i>` : '';

  const head = time
    ? `<b>${num} 🕘 ${escapeHtml(time)} · ${subject}</b>${flagsStr}`
    : `<b>${num} 📚 ${subject}</b>${flagsStr}`;
  lines.push(head);

  const room = entry.room_number || entry.room_name;
  if (room) {
    const roomLabel = entry.room_number
      ? `каб. ${escapeHtml(entry.room_number)}` +
        (entry.room_name ? ` · ${escapeHtml(entry.room_name)}` : '')
      : escapeHtml(entry.room_name ?? '');
    lines.push(`📍 ${roomLabel}`);
  }

  const hw = entry.homework;
  if (hw && hw.descriptions && hw.descriptions.length > 0) {
    const text = hw.descriptions
      .map((d) => d.trim())
      .filter(Boolean)
      .join('\n');
    if (text) {
      lines.push(`📝 ${escapeHtml(text)}`);
    }
  }

  return lines.join('\n');
}

export function formatSchedule(entries: ScheduleEntry[], from: string, to: string): string[] {
  if (entries.length === 0) {
    const range = from === to ? humanDate(from) : `${humanDate(from)} — ${humanDate(to)}`;
    return [`<b>🗓 Расписание · ${escapeHtml(range)}</b>\n\n<i>Уроков не найдено.</i>`];
  }

  const grouped = groupScheduleByDate(entries);
  const messages: string[] = [];
  let current = '';
  const MAX = 3500;

  for (const [date, list] of grouped) {
    const header = `<b>🗓 ${escapeHtml(humanDate(date))}</b>`;
    const blocks = list.map((e, i) => formatScheduleEntry(e, i + 1));
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
