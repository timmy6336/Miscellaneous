// Everything the on-device model needs, as pure code: the prompt, the JSON
// shape it must answer in, and turning that answer into a normal Command.
//
// A 1B model is bad at converting ("530pm" -> "17:30", "friday" -> a date) but
// decent at copying words out of the note. So it fills in a form with phrases
// copied from the note, and the rule-based parser turns those phrases into
// times and dates. Placing things in free time is still done by the scheduler.
// Shared by the app and scripts/ai-eval.mts.

import { addDays, dateKey, fromKey } from '../dates';
import { AddCommand, Command, parseCommand } from '../parser';
import { Item } from '../types';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAYS = ['today', 'tomorrow', ...WEEKDAYS] as const;
const REPEATS = [...WEEKDAYS, 'every day', 'weekdays', 'weekends'] as const;
const ACTIONS = ['add', 'move', 'remove', 'done', 'stop_repeat', 'set_wake', 'set_bedtime'] as const;

/** What the model answers with: mostly phrases copied from the note. */
export type AiAnswer = {
  action: (typeof ACTIONS)[number];
  title: string;
  day: (typeof DAYS)[number] | null;
  start: string | null;
  end: string | null;
  after: string | null;
  before: string | null;
  duration: string | null;
  repeat: (typeof REPEATS)[number][];
  every_other_week: boolean;
};

// oneOf (rather than a type array) works with both llama.rn and node-llama-cpp.
const nullable = (schema: object) => ({ oneOf: [schema, { type: 'null' }] });
const phrase = nullable({ type: 'string' });

/** JSON schema used to constrain decoding, so the output always parses. */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: [...ACTIONS] },
    title: { type: 'string' },
    day: nullable({ type: 'string', enum: [...DAYS] }),
    start: phrase,
    end: phrase,
    after: phrase,
    before: phrase,
    duration: phrase,
    repeat: { type: 'array', items: { type: 'string', enum: [...REPEATS] } },
    every_other_week: { type: 'boolean' },
  },
  required: ['action', 'title', 'day', 'start', 'end', 'after', 'before', 'duration', 'repeat', 'every_other_week'],
} as const;

export const SYSTEM_PROMPT = `You fill in a form for a day planner from the user's note. Answer with JSON only. Copy words from the note. Never add anything the note does not say.

action: "add" = a new plan. "move" = change the time or day of one of the listed plans. "remove" = cancel a listed plan. "done" = the user finished a listed plan. "stop_repeat" = stop a repeating plan for good. "set_wake" / "set_bedtime" = when the user wakes up or goes to bed.
title: the plan in a few words. For move, remove, done and stop_repeat: the name of the listed plan.
day: the day the note names, else null.
start, end: the times exactly as written in the note, like "530pm" or "9". Else null.
after, before: a time limit as written, like after "5pm" or before "noon". Else null.
duration: how long, as written, like "2 hours". Else null.
repeat: the days it repeats on. Only when the note says every/each/daily/weekly or lists several days. Else [].
every_other_week: true only for "every other week".`;

type Example = { note: string; answer: Partial<AiAnswer> };

const EXAMPLE_PLANS = 'Plans: Gym (today), Laundry (today), Dentist (friday), Work out (repeats)';

const EXAMPLES: Example[] = [
  { note: 'groceries', answer: { action: 'add', title: 'Groceries' } },
  {
    note: 'I work out mon tue thursday fri from 530pm to 630pm',
    answer: { action: 'add', title: 'Work out', start: '530pm', end: '630pm', repeat: ['monday', 'tuesday', 'thursday', 'friday'] },
  },
  { note: 'dentist tomorrow at 10am for an hour', answer: { action: 'add', title: 'Dentist', day: 'tomorrow', start: '10am', duration: 'an hour' } },
  { note: 'pay bills after 5', answer: { action: 'add', title: 'Pay bills', after: '5' } },
  { note: 'standup every weekday at 9:30', answer: { action: 'add', title: 'Standup', start: '9:30', repeat: ['weekdays'] } },
  { note: 'push the dentist to friday at 4', answer: { action: 'move', title: 'Dentist', day: 'friday', start: '4' } },
  { note: "can't make the gym", answer: { action: 'remove', title: 'Gym' } },
  { note: 'finished the laundry', answer: { action: 'done', title: 'Laundry' } },
  { note: 'no more workouts', answer: { action: 'stop_repeat', title: 'Work out' } },
  { note: 'I get up at 6:30', answer: { action: 'set_wake', title: 'Wake up', start: '6:30' } },
];

const EMPTY: AiAnswer = {
  action: 'add',
  title: '',
  day: null,
  start: null,
  end: null,
  after: null,
  before: null,
  duration: null,
  repeat: [],
  every_other_week: false,
};

export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const userTurn = (plans: string, note: string) => `${plans}\nNote: ${note.trim()}`;

/** The plans the model may refer to: names only, with a rough day. */
export function plansLine(items: Item[], now: Date): string {
  const today = dateKey(now);
  const seen = new Set<string>();
  const plans: string[] = [];
  const upcoming = items
    .filter((i) => !i.done && i.date >= today && i.date <= addDays(today, 7))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 1e9) - (b.start ?? 1e9));
  for (const i of upcoming) {
    if (seen.has(i.title.toLowerCase()) || plans.length >= 10) continue;
    seen.add(i.title.toLowerCase());
    const when = i.routineId ? 'repeats' : i.date === today ? 'today' : i.date === addDays(today, 1) ? 'tomorrow' : WEEKDAYS[fromKey(i.date).getDay()];
    plans.push(`${i.title} (${when})`);
  }
  return `Plans: ${plans.length ? plans.join(', ') : 'none'}`;
}

/**
 * System prompt + example turns (identical every time, so they stay cached)
 * + the real note.
 */
export function buildMessages(note: string, items: Item[], now: Date): AiMessage[] {
  const messages: AiMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const ex of EXAMPLES) {
    messages.push({ role: 'user', content: userTurn(EXAMPLE_PLANS, ex.note) });
    messages.push({ role: 'assistant', content: JSON.stringify({ ...EMPTY, ...ex.answer }) });
  }
  messages.push({ role: 'user', content: userTurn(plansLine(items, now), note) });
  return messages;
}

// ---------------------------------------------------------------------------
// Turning the answer into a Command.

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9:]/g, '');

/** Only accept a phrase if it really appears in the note (no made-up times). */
function fromNote(value: string | null | undefined, note: string): string | null {
  if (!value || !value.trim()) return null;
  const v = squash(value);
  return v && squash(note).includes(v) ? value.trim() : null;
}

/** Reads a time phrase like "530pm", "9" or "noon" with the rule-based parser. */
function timeOf(value: string | null, now: Date, date: string): number | null {
  if (!value) return null;
  const c = parseCommand(`x at ${value}`, now, date);
  return c.kind === 'add' ? c.start : null;
}

function durationOf(value: string | null, now: Date, date: string): number | null {
  if (!value) return null;
  const c = parseCommand(`x for ${value}`, now, date);
  return c.kind === 'add' ? c.duration : null;
}

const DAY_ABBR: Record<string, RegExp> = Object.fromEntries(
  WEEKDAYS.map((d) => [d, new RegExp(String.raw`\b${d.slice(0, 3)}`, 'i')]),
);

function dayToDate(day: AiAnswer['day'], note: string, now: Date): string | null {
  if (!day) return null;
  const today = dateKey(now);
  if (day === 'today') return /\b(today|tonight)\b/i.test(note) ? today : null;
  if (day === 'tomorrow') return /\b(tomorrow|tmrw?|tmro|tomorow|tommorow)\b/i.test(note) ? addDays(today, 1) : null;
  if (!DAY_ABBR[day]?.test(note)) return null;
  const diff = (WEEKDAYS.indexOf(day) - now.getDay() + 7) % 7;
  return addDays(today, diff);
}

function repeatDays(repeat: AiAnswer['repeat'] | undefined, note: string): number[] {
  const out = new Set<number>();
  for (const r of repeat ?? []) {
    if (r === 'every day' && /\b(every\s*day|daily|each day|every (morning|evening|night))\b/i.test(note)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => out.add(d));
    else if (r === 'weekdays' && /\bweekdays?\b|\bmon\w*\s*(-|to|through|thru)\s*fri/i.test(note)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
    else if (r === 'weekends' && /\bweekends?\b/i.test(note)) [0, 6].forEach((d) => out.add(d));
    else if ((WEEKDAYS as readonly string[]).includes(r) && DAY_ABBR[r].test(note)) out.add(WEEKDAYS.indexOf(r as (typeof WEEKDAYS)[number]));
  }
  return [...out].sort();
}

/**
 * Turns the model's answer into a Command. Everything it says is checked
 * against the note, and exact times the rules find win. Returns null when the
 * answer is unusable (the caller then falls back to the rules).
 */
export function answerToCommand(raw: unknown, note: string, now: Date, viewDate: string): Command | null {
  const a = raw as Partial<AiAnswer> | null;
  if (!a || typeof a !== 'object' || !ACTIONS.includes(a.action as AiAnswer['action'])) return null;
  const title = (a.title ?? '').trim().replace(/^./, (c) => c.toUpperCase());
  const rules = parseCommand(note, now, viewDate);
  const ruleAdd = rules.kind === 'add' ? rules : 'fallback' in rules ? rules.fallback : null;
  const today = dateKey(now);

  const date = dayToDate(a.day ?? null, note, now);
  const on = date ?? viewDate;
  let start = timeOf(fromNote(a.start, note), now, on);
  let end = timeOf(fromNote(a.end, note), now, on);
  const after = timeOf(fromNote(a.after, note), now, on);
  const before = timeOf(fromNote(a.before, note), now, on);
  let duration = durationOf(fromNote(a.duration, note), now, on);
  let repeat = repeatDays(a.repeat, note);
  // A single day without "every"/"weekly" is just that day, not a repeat.
  if (repeat.length === 1 && !/\b(every|each|weekly)\b|days\b/i.test(note)) repeat = [];

  // The rules are exact when they find a time; trust them over the model.
  if (ruleAdd && ruleAdd.start !== null) {
    start = ruleAdd.start;
    if (ruleAdd.duration !== null) duration = ruleAdd.duration;
  }
  if (start !== null && end !== null && duration === null) {
    while (end <= start) end += 12 * 60;
    duration = end - start;
  }

  switch (a.action) {
    case 'add': {
      if (!title) return null;
      const add: AddCommand = {
        kind: 'add',
        title,
        date: date ?? (repeat.length && viewDate < today ? today : viewDate),
        start,
        duration,
        earliest: start === null ? after : null,
        latest: start === null ? before : null,
        repeat: repeat.length ? repeat : null,
        alsoOn: [],
        alsoAt: ruleAdd?.alsoAt ?? [],
        interval: repeat.length && a.every_other_week && /other|second|bi-?weekly/i.test(note) ? 2 : 1,
      };
      return add;
    }
    case 'move':
      if (!title) return null;
      return {
        kind: 'move',
        query: title,
        date,
        start,
        duration: null,
        earliest: start === null ? after : null,
        latest: start === null ? before : null,
        shift: rules.kind === 'move' ? rules.shift : null,
        later: rules.kind === 'move' ? rules.later : false,
        fallback: ruleAdd,
      };
    case 'remove':
      return title ? { kind: 'remove', query: title, date, fallback: ruleAdd } : null;
    case 'done':
      return title ? { kind: 'done', query: title, fallback: ruleAdd } : null;
    case 'stop_repeat':
      return title ? { kind: 'stopRepeat', query: title, fallback: ruleAdd } : null;
    case 'set_wake':
    case 'set_bedtime': {
      if (rules.kind === 'setting') return rules;
      if (start === null) return null;
      if (a.action === 'set_wake') return { kind: 'setting', patch: { dayStart: start >= 12 * 60 ? start - 12 * 60 : start } };
      return { kind: 'setting', patch: { dayEnd: start < 6 * 60 ? 1440 : start } };
    }
    default:
      return null;
  }
}

// Leftovers in a title that mean the rules missed a time, day or repeat.
const LEFTOVER =
  /\d|\b(am|pm|noon|midnight|tonight|tomorrow|tmrw|today|every|daily|weekly|weekdays?|weekends?|after|before|between|until|o'?\s?clock|half past|quarter (past|to)|ish|first thing|morning|afternoon|evening|night|weekend|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|(mon|tues|wednes|thurs|fri|satur|sun)days?)\b/i;

/**
 * True when the rule-based parser clearly didn't understand everything, e.g.
 * a time was left in the title. Only then is the model asked.
 */
export function rulesNeedHelp(cmd: Command): boolean {
  if (cmd.kind === 'none') return true;
  if (cmd.kind === 'add') return LEFTOVER.test(cmd.title);
  return false;
}

/** Pulls the first JSON object out of the model's text. */
export function parseAnswer(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
