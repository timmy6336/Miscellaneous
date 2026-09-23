// Scheduling engine: places items into free time and applies parsed commands.
// Pure functions only — the UI hands in the current time, settings and the
// busy blocks read from the phone calendar.

import { addDays, dateKey, dayLabel, fmtRange, fmtTime, minutesOf } from './dates';
import { AddCommand, Command } from './parser';
import { BusyEvent, Interval, Item, Settings } from './types';

export type Ctx = {
  now: Date;
  settings: Settings;
  /** Events already in the phone calendar, keyed by date. */
  busy: Record<string, BusyEvent[]>;
  /** The day currently on screen. */
  viewDate: string;
};

export type Result = {
  items: Item[];
  message: string;
  tone: 'ok' | 'warn' | 'error';
  /** Short "what will happen" line shown while typing. */
  preview?: string;
  /** Day the change landed on, so the UI can jump there. */
  date?: string;
};

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const roundUp = (min: number, step = 5) => Math.ceil(min / step) * step;

/** Earliest start >= `from` where `duration` fits between the busy blocks and before `dayEnd`. */
export function findSlot(occupied: Interval[], from: number, duration: number, dayEnd: number): number | null {
  let t = from;
  for (const b of [...occupied].sort((a, b) => a.start - b.start)) {
    if (b.end <= t) continue;
    if (b.start >= t + duration) break;
    t = b.end;
  }
  return t + duration <= dayEnd ? t : null;
}

const interval = (i: Item): Interval => ({ start: i.start!, end: i.start! + i.duration });

/** First minute that auto-placed items may use on `date`. */
function baseMinute(date: string, ctx: Ctx): number {
  const today = dateKey(ctx.now);
  const floor = date === today ? roundUp(minutesOf(ctx.now)) : 0;
  return Math.max(ctx.settings.dayStart, floor);
}

/**
 * Re-packs the flexible (auto-placed) items on `date` into the free time left
 * by fixed items and calendar events. Items that already started, fixed items
 * and finished items stay put. Past days are left alone.
 */
export function reflow(items: Item[], date: string, ctx: Ctx): Item[] {
  if (date < dateKey(ctx.now)) return items;
  const base = baseMinute(date, ctx);
  const day = items.filter((i) => i.date === date && !i.done);
  const locked = day.filter((i) => i.start !== null && (i.fixed || i.start < base));
  const flexible = day
    .filter((i) => !locked.includes(i))
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.createdAt - b.createdAt);

  const occupied: Interval[] = [...(ctx.busy[date] ?? []), ...locked.map(interval)];
  const placed = new Map<string, number | null>();
  for (const f of flexible) {
    const start = findSlot(occupied, Math.max(base, f.earliest ?? 0), f.duration, ctx.settings.dayEnd);
    placed.set(f.id, start);
    if (start !== null) occupied.push({ start, end: start + f.duration });
  }
  return items.map((i) => (placed.has(i.id) && placed.get(i.id) !== i.start ? { ...i, start: placed.get(i.id)! } : i));
}

/** Names of flexible items whose time changed between two versions, for the status message. */
function movedNote(before: Item[], after: Item[], skipId?: string): string {
  const prev = new Map(before.map((i) => [i.id, i]));
  const moved = after.filter((i) => {
    const p = prev.get(i.id);
    return p && i.id !== skipId && !i.fixed && p.date === i.date && p.start !== i.start;
  });
  if (!moved.length) return '';
  const list = moved
    .slice(0, 2)
    .map((i) => `“${i.title}” → ${i.start === null ? 'anytime' : fmtTime(i.start)}`)
    .join(', ');
  return ` Shifted ${list}${moved.length > 2 ? ` +${moved.length - 2} more` : ''}.`;
}

function overlapNote(item: Item, items: Item[], ctx: Ctx): string {
  if (item.start === null) return '';
  const me = interval(item);
  const others = [
    ...items.filter((i) => i.id !== item.id && i.date === item.date && !i.done && i.start !== null && i.fixed),
    ...(ctx.busy[item.date] ?? []),
  ];
  const hit = others.find((o) => {
    const iv = 'duration' in o ? interval(o as Item) : (o as BusyEvent);
    return iv.start < me.end && me.start < iv.end;
  });
  return hit ? ` Heads up: overlaps “${hit.title}”.` : '';
}

function where(item: Item, ctx: Ctx): string {
  const day = dayLabel(item.date, dateKey(ctx.now));
  return item.start === null ? `${day}, anytime` : `${day} ${fmtRange(item.start, item.duration)}`;
}

// ---------------------------------------------------------------------------
// Matching free text ("the dentist thing") to an existing item.

const STOP = new Set(['the', 'a', 'an', 'my', 'to', 'with', 'for', 'at', 'on', 'in', 'of', 'and', 'go', 'get', 'do', 'some', 'thing', 'appointment', 'appt']);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 ? t.replace(/s$/, '') : t));

const tokenMatch = (a: string, b: string) =>
  a === b || (a.length >= 3 && b.startsWith(a)) || (b.length >= 3 && a.startsWith(b));

export function findItem(query: string, items: Item[], ctx: Ctx, dateHint: string | null): Item | null {
  const pending = items.filter((i) => !i.done);
  if (/^(it|that|this|last( one| thing)?|the last( one| thing)?)$/i.test(query.trim())) {
    return [...pending].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  const q = tokens(query);
  if (!q.length) return null;
  const today = dateKey(ctx.now);
  const anchor = dateHint ?? ctx.viewDate;
  const dist = (d: string) => Math.abs(Date.parse(d) - Date.parse(anchor)) / 864e5 + (d < today ? 100 : 0);

  let best: { item: Item; score: number } | null = null;
  for (const item of dateHint ? pending.filter((i) => i.date === dateHint) : pending) {
    const t = tokens(item.title);
    if (!t.length) continue;
    const hits = q.filter((w) => t.some((x) => tokenMatch(w, x))).length;
    const score = hits / Math.min(q.length, t.length) - dist(item.date) * 0.001;
    if (hits && score >= 0.6 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

// ---------------------------------------------------------------------------
// Commands.

function add(cmd: AddCommand, items: Item[], ctx: Ctx, note = ''): Result {
  const item: Item = {
    id: newId(),
    title: cmd.title,
    date: cmd.date,
    start: cmd.start,
    duration: cmd.duration ?? ctx.settings.defaultDuration,
    fixed: cmd.start !== null,
    earliest: cmd.earliest,
    done: false,
    createdAt: ctx.now.getTime(),
  };
  const next = reflow([...items, item], item.date, ctx);
  const placed = next.find((i) => i.id === item.id)!;
  let message = `Added “${placed.title}” · ${where(placed, ctx)}.`;
  if (!placed.fixed && placed.start === null) message = `Added “${placed.title}” to ${dayLabel(placed.date, dateKey(ctx.now))} — no free slot left, so it's under Anytime.`;
  message += overlapNote(placed, next, ctx) + movedNote(items, next, item.id) + note;
  return {
    items: next,
    message,
    tone: message.includes('Heads up') ? 'warn' : 'ok',
    preview: `Add “${placed.title}” · ${where(placed, ctx)}${placed.fixed || placed.start === null ? '' : ' (next free slot)'}`,
    date: placed.date,
  };
}

function notFound(query: string, fallback: AddCommand | null, items: Item[], ctx: Ctx): Result {
  if (fallback) return add(fallback, items, ctx, ` (Nothing matched “${query}”, so I added it as a new item.)`);
  return { items, message: `Couldn't find anything matching “${query}”.`, tone: 'error' };
}

/** Moves an item and reflows the affected days. */
export function moveItem(items: Item[], id: string, patch: Partial<Item>, ctx: Ctx): Result {
  const old = items.find((i) => i.id === id);
  if (!old) return { items, message: 'That item no longer exists.', tone: 'error' };
  const updated: Item = { ...old, ...patch };
  let next = items.map((i) => (i.id === id ? updated : i));
  next = reflow(next, updated.date, ctx);
  if (old.date !== updated.date) next = reflow(next, old.date, ctx);
  const placed = next.find((i) => i.id === id)!;
  const message = `Moved “${placed.title}” to ${where(placed, ctx)}.` + overlapNote(placed, next, ctx) + movedNote(items, next, id);
  return {
    items: next,
    message,
    tone: message.includes('Heads up') ? 'warn' : 'ok',
    preview: `Move “${placed.title}” → ${where(placed, ctx)}`,
    date: placed.date,
  };
}

export function removeItem(items: Item[], id: string, ctx: Ctx): Result {
  const old = items.find((i) => i.id === id);
  if (!old) return { items, message: 'That item no longer exists.', tone: 'error' };
  const next = reflow(items.filter((i) => i.id !== id), old.date, ctx);
  return {
    items: next,
    message: `Removed “${old.title}”.` + movedNote(items, next),
    tone: 'ok',
    preview: `Remove “${old.title}” (${where(old, ctx)})`,
    date: old.date,
  };
}

export function setDone(items: Item[], id: string, done: boolean, ctx: Ctx): Result {
  const old = items.find((i) => i.id === id);
  if (!old) return { items, message: 'That item no longer exists.', tone: 'error' };
  const next = reflow(items.map((i) => (i.id === id ? { ...i, done } : i)), old.date, ctx);
  return {
    items: next,
    message: (done ? `Nice — “${old.title}” is done.` : `“${old.title}” is back on the list.`) + movedNote(items, next),
    tone: 'ok',
    preview: done ? `Mark “${old.title}” done` : `Un-check “${old.title}”`,
    date: old.date,
  };
}

/** Next free slot after the item's current end (or after now). */
export function pushLater(items: Item[], id: string, ctx: Ctx): Result {
  const old = items.find((i) => i.id === id);
  if (!old) return { items, message: 'That item no longer exists.', tone: 'error' };
  const today = dateKey(ctx.now);
  const date = old.date < today ? today : old.date;
  const after = old.start !== null && old.date === date ? old.start + old.duration : baseMinute(date, ctx);
  return moveItem(items, id, { date, start: null, fixed: false, earliest: after }, ctx);
}

export function applyCommand(cmd: Command, items: Item[], ctx: Ctx): Result {
  switch (cmd.kind) {
    case 'none':
      return { items, message: '', tone: 'ok' };
    case 'add':
      return add(cmd, items, ctx);
    case 'done': {
      const item = findItem(cmd.query, items, ctx, null);
      return item ? setDone(items, item.id, true, ctx) : notFound(cmd.query, cmd.fallback, items, ctx);
    }
    case 'remove': {
      const item = findItem(cmd.query, items, ctx, cmd.date);
      return item ? removeItem(items, item.id, ctx) : notFound(cmd.query, cmd.fallback, items, ctx);
    }
    case 'move': {
      const item = findItem(cmd.query, items, ctx, null);
      if (!item) return notFound(cmd.query, cmd.fallback, items, ctx);
      const patch: Partial<Item> = {};
      if (cmd.duration !== null) patch.duration = cmd.duration;
      if (cmd.start !== null) {
        Object.assign(patch, { start: cmd.start, fixed: true, earliest: null });
        if (cmd.date) patch.date = cmd.date;
        else if (item.date < dateKey(ctx.now)) patch.date = dateKey(ctx.now);
      } else if (cmd.shift !== null) {
        const from = item.start ?? baseMinute(item.date, ctx);
        const start = Math.min(Math.max(from + cmd.shift, 0), 1440 - item.duration);
        Object.assign(patch, { start, fixed: true, earliest: null });
      } else if (cmd.date || cmd.earliest !== null) {
        patch.date = cmd.date ?? item.date;
        // Keep an exact time when just changing the day; otherwise re-place it.
        if (!item.fixed || cmd.earliest !== null) Object.assign(patch, { start: null, fixed: false, earliest: cmd.earliest });
      } else {
        return pushLater(items, item.id, ctx);
      }
      return moveItem(items, item.id, patch, ctx);
    }
  }
}

/** Unfinished items from earlier days. */
export function leftovers(items: Item[], ctx: Ctx): Item[] {
  const today = dateKey(ctx.now);
  return items.filter((i) => !i.done && i.date < today);
}

export function bringToToday(items: Item[], ctx: Ctx): Result {
  const today = dateKey(ctx.now);
  const old = leftovers(items, ctx);
  const ids = new Set(old.map((i) => i.id));
  const next = reflow(
    items.map((i) => (ids.has(i.id) ? { ...i, date: today, start: null, fixed: false, earliest: null } : i)),
    today,
    ctx,
  );
  return { items: next, message: `Brought ${old.length} unfinished item${old.length === 1 ? '' : 's'} into today.`, tone: 'ok', date: today };
}

/** Everything that needs busy data: today, the viewed day and any day with pending items. */
export function datesOfInterest(items: Item[], ctx: Ctx, extra: (string | null | undefined)[] = []): string[] {
  const today = dateKey(ctx.now);
  const set = new Set<string>([today, addDays(today, 1), ctx.viewDate]);
  for (const i of items) if (!i.done && i.date >= today) set.add(i.date);
  for (const d of extra) if (d) set.add(d);
  return [...set].sort();
}
