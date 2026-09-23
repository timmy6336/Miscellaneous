// Everything the on-device model needs, as pure code: the prompt, the JSON
// shape it must answer in, and turning that answer into a normal Command.
// The model only *understands* the note; placing things in free time is still
// done by the scheduler. Shared by the app and scripts/ai-eval.ts.

import { addDays, dateKey, fmtTime, fromKey, minutesOf } from '../dates';
import { AddCommand, Command, parseCommand } from '../parser';
import { Item } from '../types';

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** What the model answers with. */
export type AiAnswer = {
  action: 'add' | 'move' | 'remove' | 'done' | 'stop_repeat' | 'set_wake' | 'set_bedtime';
  title: string;
  date: string | null;
  start: string | null;
  end: string | null;
  duration_min: number | null;
  after: string | null;
  before: string | null;
  repeat_days: (typeof DOW)[number][];
  every_other_week: boolean;
};

// oneOf (rather than a type array) works with both llama.rn and node-llama-cpp.
const nullable = (type: string) => ({ oneOf: [{ type }, { type: 'null' }] });

/** JSON schema used to constrain decoding, so the output always parses. */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['add', 'move', 'remove', 'done', 'stop_repeat', 'set_wake', 'set_bedtime'] },
    title: { type: 'string' },
    date: nullable('string'),
    start: nullable('string'),
    end: nullable('string'),
    duration_min: nullable('integer'),
    after: nullable('string'),
    before: nullable('string'),
    repeat_days: { type: 'array', items: { type: 'string', enum: [...DOW] } },
    every_other_week: { type: 'boolean' },
  },
  required: ['action', 'title', 'date', 'start', 'end', 'duration_min', 'after', 'before', 'repeat_days', 'every_other_week'],
} as const;

// Kept fixed (no dates or schedule in it) so the model can reuse its cache
// for this part between messages.
export const SYSTEM_PROMPT = `You turn a short note into one scheduling action. Answer with JSON only.

Fields:
- action: "add" = plan something new. "move" = change the time or day of something already planned. "remove" = cancel one planned thing. "done" = the user finished something. "stop_repeat" = stop a repeating thing for good. "set_wake" / "set_bedtime" = the user says when they wake up or go to bed.
- title: short name with a capital letter, e.g. "Work out", "Call mom", "Dentist". Leave out times, days and words like "I want to". For move/remove/done/stop_repeat use the planned thing's name.
- date: "YYYY-MM-DD" copied from the calendar in the message, only if the note names a day. Otherwise null.
- start, end: 24-hour "HH:MM" only if the note says a time. 530pm = "17:30", 9am = "09:00", noon = "12:00". A bare 1 to 6 means afternoon. For set_wake/set_bedtime put the time in start.
- duration_min: minutes, only if the note says how long.
- after, before: "HH:MM" for "after 5pm" / "before noon" / "between 2 and 4pm". "after work" = "17:00".
- repeat_days: days it repeats on, e.g. ["mon","wed"]. "every day"/"daily" = all seven. "weekdays" = mon to fri. A list of several days means it repeats. Empty if it does not repeat.
- every_other_week: true only for "every other week".
Never make up a time or day that the note does not say.

Examples:
Note: groceries
{"action":"add","title":"Groceries","date":null,"start":null,"end":null,"duration_min":null,"after":null,"before":null,"repeat_days":[],"every_other_week":false}
Note: I work out mon tue thursday fri from 530pm to 630pm
{"action":"add","title":"Work out","date":null,"start":"17:30","end":"18:30","duration_min":null,"after":null,"before":null,"repeat_days":["mon","tue","thu","fri"],"every_other_week":false}
Note: pay bills after 5 for 20 min
{"action":"add","title":"Pay bills","date":null,"start":null,"end":null,"duration_min":20,"after":"17:00","before":null,"repeat_days":[],"every_other_week":false}
Note: push the dentist to friday at 3
{"action":"move","title":"Dentist","date":"<friday's date>","start":"15:00","end":null,"duration_min":null,"after":null,"before":null,"repeat_days":[],"every_other_week":false}`;

/** The per-message part: today, a short calendar, the relevant schedule and the note. */
export function buildUserMessage(note: string, items: Item[], now: Date, viewDate: string): string {
  const today = dateKey(now);
  const calendar: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = addDays(today, i);
    calendar.push(`${DAY_NAMES[fromKey(d).getDay()]} ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`);
  }
  const upcoming = items
    .filter((i) => !i.done && i.date >= today && i.date <= addDays(today, 7))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 1e9) - (b.start ?? 1e9))
    // One line per repeating item is enough context.
    .filter((i, idx, all) => !i.routineId || all.findIndex((x) => x.routineId === i.routineId) === idx)
    .slice(0, 12)
    .map((i) => {
      const when = i.start === null ? 'anytime' : `${fmtTime(i.start)}–${fmtTime(i.start + i.duration)}`;
      return `- ${DAY_NAMES[fromKey(i.date).getDay()].slice(0, 3)} ${i.date} ${when}: ${i.title}${i.routineId ? ' (repeats)' : ''}`;
    });
  return [
    `Now: ${DAY_NAMES[now.getDay()]} ${today}, ${fmtTime(minutesOf(now))}.${viewDate !== today ? ` Looking at ${viewDate}.` : ''}`,
    `Calendar: ${calendar.join('; ')}`,
    `Planned:\n${upcoming.length ? upcoming.join('\n') : '- nothing yet'}`,
    `Note: ${note.trim()}`,
  ].join('\n');
}

const toMin = (s: string | null | undefined): number | null => {
  const m = s ? HHMM.exec(s.trim()) : null;
  return m ? +m[1] * 60 + +m[2] : null;
};

// Words that show the note really mentions a time or a day. If they're absent
// we ignore any time/day the model came up with.
const TIME_HINT = /\d|\b(noon|midday|midnight|morning|afternoon|evening|tonight|night|lunch|dinner|breakfast|work|school|bed|later|early|late)\b/i;
const DAY_HINT =
  /\b(today|tonight|tomorrow|tmrw?|tmro|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|\w+day|\w+days|week|weekly|weekend|daily|next|\d{1,2}(st|nd|rd|th)|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * Turns the model's answer into a Command, cross-checked against the rule-based
 * parser. Returns null when the answer is unusable (the caller then falls back
 * to the rules).
 */
export function answerToCommand(raw: unknown, note: string, now: Date, viewDate: string): Command | null {
  const a = raw as Partial<AiAnswer> | null;
  if (!a || typeof a !== 'object' || typeof a.action !== 'string') return null;
  const title = (a.title ?? '').trim().replace(/^./, (c) => c.toUpperCase());
  const rules = parseCommand(note, now, viewDate);
  const today = dateKey(now);

  const hasTime = TIME_HINT.test(note);
  const hasDay = DAY_HINT.test(note);
  let start = hasTime ? toMin(a.start) : null;
  let end = hasTime ? toMin(a.end) : null;
  const after = hasTime ? toMin(a.after) : null;
  const before = hasTime ? toMin(a.before) : null;
  const inRange = (d: string | null | undefined) =>
    !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && d <= addDays(today, 366);
  const date = hasDay && inRange(a.date) ? a.date! : null;
  const repeat = [...new Set((hasDay ? a.repeat_days ?? [] : []).map((d) => DOW.indexOf(d)).filter((d) => d >= 0))].sort();

  // The rules are exact when they do find a time; trust them over the model.
  const ruleAdd = rules.kind === 'add' ? rules : 'fallback' in rules ? rules.fallback : null;
  if (ruleAdd && ruleAdd.start !== null && (start === null || a.action === 'add')) {
    start = ruleAdd.start;
    if (ruleAdd.duration !== null) end = start + ruleAdd.duration;
  }
  let duration: number | null = null;
  if (start !== null && end !== null) {
    while (end <= start) end += 12 * 60;
    duration = end - start;
  }
  if (typeof a.duration_min === 'number' && a.duration_min > 0 && a.duration_min <= 16 * 60) duration = a.duration_min;

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
        interval: repeat.length && a.every_other_week ? 2 : 1,
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
        duration,
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
      return { kind: 'setting', patch: a.action === 'set_wake' ? { dayStart: start } : { dayEnd: start === 0 ? 1440 : start } };
    }
    default:
      return null;
  }
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
