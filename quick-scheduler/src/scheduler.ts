// Scheduling engine: places items into free time and applies parsed commands.
// Pure functions only — the UI hands in the current time, settings and the
// busy blocks read from the phone calendar.

import { addDays, dateKey, dayLabel, fmtRange, fmtTime, fromKey, minutesOf } from './dates';
import { AddCommand, Command } from './parser';
import { BusyEvent, Interval, Item, Routine, Settings } from './types';

/** How far ahead occurrences of repeating items are created (and put in the calendar). */
export const HORIZON_DAYS = 28;

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
  /** Set when repeating items changed. */
  routines?: Routine[];
  /** Set when a setting changed ("I wake up at 7"). */
  settings?: Partial<Settings>;
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
  // Items that have already started (in real time) stay where they are.
  const startedBy = date === dateKey(ctx.now) ? roundUp(minutesOf(ctx.now)) : -Infinity;
  const day = items.filter((i) => i.date === date && !i.done);
  const locked = day.filter((i) => i.start !== null && (i.fixed || i.start < startedBy));
  const flexible = day
    .filter((i) => !locked.includes(i))
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.createdAt - b.createdAt);

  const occupied: Interval[] = [...(ctx.busy[date] ?? []), ...locked.map(interval)];
  const placed = new Map<string, number | null>();
  for (const f of flexible) {
    const end = Math.min(ctx.settings.dayEnd, f.latest ?? 1440);
    const start = findSlot(occupied, Math.max(base, f.earliest ?? 0), f.duration, end);
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
  if (hit) return ` Heads up: overlaps “${hit.title}”.`;
  if (item.fixed && me.start < ctx.settings.dayStart) return ` Heads up: that's before you wake up (${fmtTime(ctx.settings.dayStart)}).`;
  if (item.fixed && me.end > ctx.settings.dayEnd) return ` Heads up: that runs past your bedtime (${fmtTime(ctx.settings.dayEnd)}).`;
  return '';
}

/** "after 5:00 PM", "between 2:00 PM and 4:00 PM" — how a flexible item is constrained. */
function windowLabel(earliest: number | null | undefined, latest: number | null | undefined): string {
  if (earliest != null && latest != null) return `between ${fmtTime(earliest)} and ${fmtTime(latest)}`;
  if (earliest != null) return `after ${fmtTime(earliest)}`;
  if (latest != null) return `before ${fmtTime(latest)}`;
  return '';
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function daysLabel(days: number[]): string {
  const key = [...days].sort().join('');
  if (key === '0123456') return 'every day';
  if (key === '12345') return 'weekdays';
  if (key === '06') return 'weekends';
  // Monday-first order reads more naturally.
  return 'every ' + [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(', ');
}

/** "every Mon, Wed" / "every other week: Mon, Wed". */
export function routineLabel(r: Routine): string {
  const days = daysLabel(r.days);
  return (r.interval ?? 1) > 1 ? `every other week, ${days.replace(/^every /, '')}` : days;
}

export function routineWhen(r: Routine): string {
  return r.start !== null ? fmtRange(r.start, r.duration) : windowLabel(r.earliest, r.latest) || 'in a free slot';
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

function add(cmd: AddCommand, items: Item[], ctx: Ctx, note = '', routines: Routine[] = []): Result {
  if (cmd.alsoAt.length) {
    // "meds at 8am and 8pm": one item (or repeat) per time.
    let next = items;
    let nextRoutines = routines;
    const previews: string[] = [];
    let date = cmd.date;
    for (const start of [cmd.start, ...cmd.alsoAt]) {
      const r = add({ ...cmd, start, alsoAt: [] }, next, ctx, '', nextRoutines);
      next = r.items;
      nextRoutines = r.routines ?? nextRoutines;
      previews.push(start === null ? 'anytime' : fmtTime(start));
      date = r.date ?? date;
    }
    const summary = `“${cmd.title}” at ${previews.join(' and ')}${cmd.repeat ? `, ${daysLabel(cmd.repeat)}` : ''}`;
    return {
      items: next,
      routines: cmd.repeat ? nextRoutines : undefined,
      message: `Added ${summary}.${note}`,
      tone: 'ok',
      preview: `Add ${summary}`,
      date,
    };
  }
  if (cmd.repeat) return addRoutine(cmd, items, routines, ctx);
  if (cmd.alsoOn.length) {
    // "yoga sat and sun": one item per day.
    let next = items;
    const placed: Item[] = [];
    for (const date of [cmd.date, ...cmd.alsoOn]) {
      const r = add({ ...cmd, date, alsoOn: [] }, next, ctx);
      placed.push(r.items.find((i) => !next.some((n) => n.id === i.id))!);
      next = r.items;
    }
    const list = placed.map((p) => where(p, ctx)).join('; ');
    return {
      items: next,
      message: `Added “${cmd.title}” ${placed.length} times: ${list}.${note}`,
      tone: 'ok',
      preview: `Add “${cmd.title}” · ${list}`,
      date: cmd.date,
    };
  }
  const item: Item = {
    id: newId(),
    title: cmd.title,
    date: cmd.date,
    start: cmd.start,
    duration: cmd.duration ?? ctx.settings.defaultDuration,
    fixed: cmd.start !== null,
    earliest: cmd.earliest,
    latest: cmd.latest,
    done: false,
    createdAt: ctx.now.getTime(),
  };
  const next = reflow([...items, item], item.date, ctx);
  const placed = next.find((i) => i.id === item.id)!;
  let message = `Added “${placed.title}” · ${where(placed, ctx)}.`;
  const win = windowLabel(placed.earliest, placed.latest);
  if (!placed.fixed && placed.start === null)
    message = `Added “${placed.title}” to ${dayLabel(placed.date, dateKey(ctx.now))} — no free slot${win ? ` ${win}` : ''} left, so it's under Anytime.`;
  message += overlapNote(placed, next, ctx) + movedNote(items, next, item.id) + note;
  return {
    items: next,
    message,
    tone: message.includes('Heads up') ? 'warn' : 'ok',
    preview: `Add “${placed.title}” · ${where(placed, ctx)}${placed.fixed || placed.start === null ? '' : ` (first free slot${win ? ` ${win}` : ''})`}`,
    date: placed.date,
  };
}

function notFound(query: string, fallback: AddCommand | null, items: Item[], ctx: Ctx, routines: Routine[] = []): Result {
  if (fallback) return add(fallback, items, ctx, ` (Nothing matched “${query}”, so I added it as a new item.)`, routines);
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
    message:
      `Removed “${old.title}”.` +
      (old.routineId ? ` It still repeats — type “stop ${old.title.toLowerCase()}” to end it.` : '') +
      movedNote(items, next),
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
  return moveItem(items, id, { date, start: null, fixed: false, earliest: after, latest: null }, ctx);
}

// ---------------------------------------------------------------------------
// Repeating items.

/** Reflows every day from today on that has pending items. */
function reflowAll(items: Item[], ctx: Ctx): Item[] {
  const today = dateKey(ctx.now);
  const dates = new Set(items.filter((i) => !i.done && i.date >= today).map((i) => i.date));
  let next = items;
  for (const d of dates) next = reflow(next, d, ctx);
  return next;
}

/**
 * Creates occurrences of repeating items up to HORIZON_DAYS ahead. Days that
 * were already filled in are never regenerated, so deleting or moving a single
 * occurrence sticks.
 */
export function materialize(routines: Routine[], items: Item[], ctx: Ctx): { routines: Routine[]; items: Item[]; added: Item[] } {
  const today = dateKey(ctx.now);
  const horizon = addDays(today, HORIZON_DAYS - 1);
  const added: Item[] = [];
  const nextRoutines = routines.map((r) => {
    if (r.until >= horizon) return r;
    let d = [addDays(r.until, 1), r.from, today].sort().pop()!;
    const fromDate = fromKey(r.from);
    for (; d <= horizon; d = addDays(d, 1)) {
      const day = fromKey(d);
      if (!r.days.includes(day.getDay())) continue;
      if ((r.interval ?? 1) > 1) {
        // Weeks (Sunday-based) since the repeat started.
        const days = Math.round((day.getTime() - fromDate.getTime()) / 864e5) + fromDate.getDay();
        if (Math.floor(days / 7) % r.interval! !== 0) continue;
      }
      added.push({
        id: newId(),
        title: r.title,
        date: d,
        start: r.start,
        duration: r.duration,
        fixed: r.start !== null,
        earliest: r.earliest,
        latest: r.latest,
        done: false,
        createdAt: r.createdAt,
        routineId: r.id,
      });
    }
    return { ...r, until: horizon };
  });
  if (!added.length) return { routines: nextRoutines, items, added };
  let next = [...items, ...added];
  for (const d of new Set(added.map((i) => i.date))) next = reflow(next, d, ctx);
  return { routines: nextRoutines, items: next, added };
}

function addRoutine(cmd: AddCommand, items: Item[], routines: Routine[], ctx: Ctx): Result {
  const routine: Routine = {
    id: newId(),
    title: cmd.title,
    days: cmd.repeat!,
    interval: cmd.interval > 1 ? cmd.interval : undefined,
    start: cmd.start,
    duration: cmd.duration ?? ctx.settings.defaultDuration,
    earliest: cmd.start === null ? cmd.earliest : null,
    latest: cmd.start === null ? cmd.latest : null,
    from: cmd.date,
    until: addDays(cmd.date, -1),
    createdAt: ctx.now.getTime(),
  };
  const m = materialize([...routines, routine], items, ctx);
  const first = m.added.filter((i) => i.routineId === routine.id).sort((a, b) => a.date.localeCompare(b.date))[0];
  const placedFirst = first && m.items.find((i) => i.id === first.id);
  const summary = `“${routine.title}” ${routineLabel(routine)} · ${routineWhen(routine)}`;
  return {
    items: m.items,
    routines: m.routines,
    message: `Repeating: ${summary}.${placedFirst ? ` Next: ${where(placedFirst, ctx)}.` : ''}${placedFirst ? overlapNote(placedFirst, m.items, ctx) : ''}`,
    tone: 'ok',
    preview: `Repeat ${summary}`,
    date: first?.date,
  };
}

export function findRoutine(query: string, routines: Routine[]): Routine | null {
  const q = tokens(query);
  let best: { r: Routine; score: number } | null = null;
  for (const r of routines) {
    const t = tokens(r.title);
    if (!t.length || !q.length) continue;
    const hits = q.filter((w) => t.some((x) => tokenMatch(w, x))).length;
    const score = hits / Math.min(q.length, t.length);
    if (hits && score >= 0.6 && (!best || score > best.score)) best = { r, score };
  }
  return best?.r ?? null;
}

/** Ends a repeating item and removes its upcoming (unfinished) occurrences. */
export function stopRoutine(items: Item[], routines: Routine[], routineId: string, ctx: Ctx): Result {
  const r = routines.find((x) => x.id === routineId);
  if (!r) return { items, message: 'That repeating item no longer exists.', tone: 'error' };
  const today = dateKey(ctx.now);
  const drop = (i: Item) => i.routineId === routineId && !i.done && i.date >= today;
  const dates = new Set(items.filter(drop).map((i) => i.date));
  let next = items.filter((i) => !drop(i));
  for (const d of dates) next = reflow(next, d, ctx);
  return {
    items: next,
    routines: routines.filter((x) => x.id !== routineId),
    message: `Stopped repeating “${r.title}” (${routineLabel(r)}). Removed ${dates.size} upcoming.`,
    tone: 'ok',
    preview: `Stop repeating “${r.title}” (${routineLabel(r)})`,
  };
}

function applySetting(patch: Partial<Settings>, items: Item[], ctx: Ctx): Result {
  const settings = { ...ctx.settings, ...patch };
  if (settings.dayEnd - settings.dayStart < 60) {
    return { items, message: 'Your wake-up time needs to be at least an hour before bedtime.', tone: 'error' };
  }
  const next = reflowAll(items, { ...ctx, settings });
  const what = patch.dayStart !== undefined ? `you wake up at ${fmtTime(settings.dayStart)}` : `bedtime is ${fmtTime(settings.dayEnd)}`;
  return {
    items: next,
    settings: patch,
    message: `Got it — ${what}. Nothing gets auto-placed outside ${fmtTime(settings.dayStart)} – ${fmtTime(settings.dayEnd)}.` + movedNote(items, next),
    tone: 'ok',
    preview: `Set: ${what}`,
  };
}

export function changeSettings(patch: Partial<Settings>, items: Item[], ctx: Ctx): Item[] {
  return reflowAll(items, { ...ctx, settings: { ...ctx.settings, ...patch } });
}

export function applyCommand(cmd: Command, items: Item[], ctx: Ctx, routines: Routine[] = []): Result {
  switch (cmd.kind) {
    case 'none':
      return { items, message: '', tone: 'ok' };
    case 'add':
      return add(cmd, items, ctx, '', routines);
    case 'setting':
      return applySetting(cmd.patch, items, ctx);
    case 'stopRepeat': {
      const r = findRoutine(cmd.query, routines);
      return r ? stopRoutine(items, routines, r.id, ctx) : notFound(cmd.query, cmd.fallback, items, ctx, routines);
    }
    case 'done': {
      const item = findItem(cmd.query, items, ctx, null);
      return item ? setDone(items, item.id, true, ctx) : notFound(cmd.query, cmd.fallback, items, ctx, routines);
    }
    case 'remove': {
      const item = findItem(cmd.query, items, ctx, cmd.date);
      return item ? removeItem(items, item.id, ctx) : notFound(cmd.query, cmd.fallback, items, ctx, routines);
    }
    case 'move': {
      const item = findItem(cmd.query, items, ctx, null);
      if (!item) return notFound(cmd.query, cmd.fallback, items, ctx, routines);
      const patch: Partial<Item> = {};
      if (cmd.duration !== null) patch.duration = cmd.duration;
      if (cmd.start !== null) {
        Object.assign(patch, { start: cmd.start, fixed: true, earliest: null, latest: null });
        if (cmd.date) patch.date = cmd.date;
        else if (item.date < dateKey(ctx.now)) patch.date = dateKey(ctx.now);
      } else if (cmd.shift !== null) {
        const from = item.start ?? baseMinute(item.date, ctx);
        const start = Math.min(Math.max(from + cmd.shift, 0), 1440 - item.duration);
        Object.assign(patch, { start, fixed: true, earliest: null, latest: null });
      } else if (cmd.date || cmd.earliest !== null || cmd.latest !== null) {
        patch.date = cmd.date ?? (item.date < dateKey(ctx.now) ? dateKey(ctx.now) : item.date);
        // Keep an exact time when just changing the day; otherwise re-place it.
        if (!item.fixed || cmd.earliest !== null || cmd.latest !== null)
          Object.assign(patch, { start: null, fixed: false, earliest: cmd.earliest, latest: cmd.latest });
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
  // Missed occurrences of repeating items aren't carried over.
  return items.filter((i) => !i.done && i.date < today && !i.routineId);
}

export function bringToToday(items: Item[], ctx: Ctx): Result {
  const today = dateKey(ctx.now);
  const old = leftovers(items, ctx);
  const ids = new Set(old.map((i) => i.id));
  const next = reflow(
    items.map((i) => (ids.has(i.id) ? { ...i, date: today, start: null, fixed: false, earliest: null, latest: null } : i)),
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
