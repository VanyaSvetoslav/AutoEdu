import { config } from './config.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function partsInTimezone(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function todayIso(): string {
  const { y, m, d } = partsInTimezone(new Date(), config.TZ);
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function shiftIso(iso: string, days: number): string {
  const [yStr, mStr, dStr] = iso.split('-');
  const base = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr)));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function tomorrowIso(): string {
  return shiftIso(todayIso(), 1);
}

export function weekRange(): { from: string; to: string } {
  const from = todayIso();
  const to = shiftIso(from, 6);
  return { from, to };
}

export function parseRange(input: string): { from: string; to: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes('..')) {
    const [a, b] = trimmed.split('..').map((s) => s.trim());
    if (a && b && isValidIsoDate(a) && isValidIsoDate(b)) {
      return a <= b ? { from: a, to: b } : { from: b, to: a };
    }
    return null;
  }
  if (isValidIsoDate(trimmed)) {
    return { from: trimmed, to: trimmed };
  }
  return null;
}

export function humanRangeRu(from: string, to: string): string {
  return from === to ? from : `${from} — ${to}`;
}
