// Turns a free-text line like "dentist tomorrow at 3pm for an hour" or
// "move gym to 6" into a structured command. Everything here is pure so it can
// be unit-tested without a phone.

import { addDays, dateKey, minutesOf } from './dates';

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export const PART_OF_DAY_START: Record<PartOfDay, number> = {
  morning: 8 * 60,
  afternoon: 12 * 60,
  evening: 17 * 60,
  night: 19 * 60,
};

export type AddCommand = {
  kind: 'add';
  title: string;
  date: string;
  start: number | null;
  duration: number | null;
  earliest: number | null;
};

export type Command =
  | AddCommand
  | {
      kind: 'move';
      query: string;
      date: string | null;
      start: number | null;
      duration: number | null;
      earliest: number | null;
      /** Minutes to shift by, e.g. "push gym back 30 min". */
      shift: number | null;
      /** "postpone gym" with no target: next free slot after it. */
      later: boolean;
      fallback: AddCommand | null;
    }
  | { kind: 'remove'; query: string; date: string | null; fallback: AddCommand | null }
  | { kind: 'done'; query: string; fallback: AddCommand | null }
  | { kind: 'none' };

type Meridiem = 'am' | 'pm' | null;
type ClockTime = { h: number; m: number; mer: Meridiem };

type When = {
  dayOffset?: number;
  weekday?: { dow: number; next: boolean };
  time?: ClockTime;
  endTime?: ClockTime;
  duration?: number;
  relMinutes?: number;
  partOfDay?: PartOfDay;
  shift?: number;
  later?: boolean;
};

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10,
  fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45, 'forty-five': 45,
  'half a': 0.5, 'half an': 0.5,
};

const AMOUNT = String.raw`(\d+(?:\.\d+)?|half an?|an?|one|two|three|four|five|six|ten|fifteen|twenty|thirty|forty[- ]five)`;
const UNIT = String.raw`(minutes?|mins?|hours?|hrs?|h|m)`;
const MER = String.raw`(a\.?m\.?|p\.?m\.?)`;
const AT = String.raw`(?:(?:\bat|\baround|\bby|@)\s*)`;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBR: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const DAY_WORD = String.raw`(?:today|tonight|tomorrow|tmrw|tmr|${WEEKDAYS.join('|')})`;
const TOMORROW = String.raw`(?:tomorrow|tmrw|tmr|tmro|tomorow|tommorow|tommorrow|2moro)`;

function amountToMinutes(amount: string, unit: string): number {
  const a = amount.toLowerCase();
  const n = WORD_NUM[a] ?? parseFloat(a);
  return Math.round(unit.toLowerCase().startsWith('h') ? n * 60 : n);
}

function toMer(s: string | undefined): Meridiem {
  if (!s) return null;
  return s.toLowerCase().replace(/\./g, '').startsWith('a') ? 'am' : 'pm';
}

/** Converts a clock time to minutes after midnight, guessing AM/PM when not given. */
function to24(t: ClockTime, part: PartOfDay | undefined, nowMinIfToday: number | null): number {
  let h = t.h;
  if (t.mer === 'pm' && h < 12) h += 12;
  else if (t.mer === 'am' && h === 12) h = 0;
  else if (t.mer === null && h >= 1 && h <= 11) {
    if (part === 'afternoon' || part === 'evening' || part === 'night') h += 12;
    else if (part === 'morning') { /* keep AM */ }
    else if (h < 7) h += 12; // nobody means 3am
    else if (nowMinIfToday !== null && h * 60 + t.m <= nowMinIfToday && (h + 12) * 60 + t.m > nowMinIfToday) h += 12;
  }
  return h * 60 + t.m;
}

/** Pulls date/time/duration phrases out of the text, returning what's left. */
function extractWhen(input: string, mode: 'add' | 'move'): { rest: string; when: When } {
  let s = ` ${input} `;
  const when: When = {};

  // Runs `re` once; if `fn` accepts the match it is cut out of the text
  // (or swapped for the string `fn` returns).
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | string | void) => {
    const m = re.exec(s);
    if (!m) return false;
    const r = fn(m);
    if (r === false) return false;
    s = s.slice(0, m.index) + ` ${typeof r === 'string' ? r : ''} ` + s.slice(m.index + m[0].length);
    return true;
  };

  // Relative times: "in 20 minutes", "in an hour".
  take(new RegExp(String.raw`\bin\s+${AMOUNT}\s*${UNIT}\b`, 'i'), (m) => {
    when.relMinutes = amountToMinutes(m[1], m[2]);
  });

  // Explicit durations: "for 45 min", "for an hour".
  take(new RegExp(String.raw`\bfor\s+(?:about\s+|around\s+)?${AMOUNT}\s*${UNIT}\b`, 'i'), (m) => {
    when.duration = amountToMinutes(m[1], m[2]);
  });

  if (mode === 'move') {
    if (take(/\b(earlier|sooner)\b/i, () => {})) when.shift = -1;
    if (take(/\b(later|back)\b/i, () => {})) when.later = true;
    take(new RegExp(String.raw`\b(?:by\s+)?${AMOUNT}\s*${UNIT}\b`, 'i'), (m) => {
      when.shift = (when.shift === -1 ? -1 : 1) * amountToMinutes(m[1], m[2]);
    });
    if (when.shift === -1) delete when.shift;
  } else {
    // Bare durations: "30 min walk", "2h study session".
    if (when.duration === undefined) {
      take(new RegExp(String.raw`\b(\d+(?:\.\d+)?)\s*${UNIT}\b`, 'i'), (m) => {
        when.duration = amountToMinutes(m[1], m[2]);
      });
    }
    take(/\blater(?:\s+today)?\b/i, () => {
      when.later = true;
    });

    // Ranges: "3-4pm", "from 2 to 3:30", "10am to noon" isn't supported, keep it simple.
    take(
      new RegExp(
        String.raw`(\bfrom\s+)?\b(\d{1,2})(?::(\d{2}))?\s*${MER}?\s*(?:-|–|\bto\b|\buntil\b|\btill\b)\s*(\d{1,2})(?::(\d{2}))?\s*${MER}?(?=\W|$)`,
        'i',
      ),
      (m) => {
        const [, from, h1, m1, mer1, h2, m2, mer2] = m;
        if (!from && !mer1 && !mer2 && !m1 && !m2) return false;
        const a: ClockTime = { h: +h1, m: +(m1 ?? 0), mer: toMer(mer1) };
        const b: ClockTime = { h: +h2, m: +(m2 ?? 0), mer: toMer(mer2) };
        if (a.h > 23 || b.h > 23 || a.m > 59 || b.m > 59) return false;
        if (!a.mer && b.mer && a.h <= 12) {
          // "3-4pm" -> both PM, "11-1pm" -> 11am.
          a.mer = b.mer;
          if (to24(a, undefined, null) >= to24(b, undefined, null)) a.mer = b.mer === 'pm' ? 'am' : 'pm';
        }
        when.time = a;
        when.endTime = b;
      },
    );
  }

  // Part of day attached to a day: "tomorrow morning", "friday evening".
  take(
    new RegExp(String.raw`\b(${DAY_WORD})\s+(morning|afternoon|evening|night)\b`, 'i'),
    (m) => {
      when.partOfDay = m[2].toLowerCase() as PartOfDay;
      return m[1]; // keep the day word so it's parsed below
    },
  );

  take(/\b(?:in the|this)\s+(morning|afternoon|evening)\b/i, (m) => {
    when.partOfDay = m[1].toLowerCase() as PartOfDay;
  });
  take(/\bat night\b/i, () => {
    when.partOfDay = 'night';
  });
  take(/\b(?:tonight|tonite)\b/i, () => {
    when.dayOffset = 0;
    when.partOfDay = 'night';
  });

  // Days.
  take(new RegExp(String.raw`\b(?:the\s+)?day after ${TOMORROW}\b`, 'i'), () => {
    when.dayOffset = 2;
  });
  take(new RegExp(String.raw`\b${TOMORROW}\b`, 'i'), () => {
    when.dayOffset = 1;
  });
  take(/\btoday\b/i, () => {
    when.dayOffset ??= 0;
  });
  take(new RegExp(String.raw`\b(?:(on|next|this)\s+)?(${WEEKDAYS.join('|')})\b`, 'i'), (m) => {
    when.weekday = { dow: WEEKDAYS.indexOf(m[2].toLowerCase()), next: m[1]?.toLowerCase() === 'next' };
  });
  if (!when.weekday) {
    take(new RegExp(String.raw`\b(on|next|this)\s+(${Object.keys(WEEKDAY_ABBR).join('|')})\b`, 'i'), (m) => {
      when.weekday = { dow: WEEKDAY_ABBR[m[2].toLowerCase()], next: m[1].toLowerCase() === 'next' };
    });
  }

  // Times.
  if (!when.time) {
    const found =
      take(new RegExp(String.raw`${AT}?\b(\d{1,2})(?::(\d{2}))?\s*${MER}(?=\W|$)`, 'i'), (m) => {
        const h = +m[1];
        const min = +(m[2] ?? 0);
        if (h < 1 || h > 12 || min > 59) return false;
        when.time = { h, m: min, mer: toMer(m[3]) };
      }) ||
      take(new RegExp(String.raw`${AT}?\b(\d{1,2}):(\d{2})\b`, 'i'), (m) => {
        const h = +m[1];
        const min = +m[2];
        if (h > 23 || min > 59) return false;
        when.time = { h, m: min, mer: null };
      }) ||
      take(new RegExp(String.raw`${AT}(\d{1,2})\b(?![:.]\d)(?:\s*o'?clock)?`, 'i'), (m) => {
        const h = +m[1];
        if (h > 23) return false;
        when.time = { h, m: 0, mer: null };
      }) ||
      take(/\b(\d{1,2})\s*o'?clock\b/i, (m) => {
        const h = +m[1];
        if (h < 1 || h > 12) return false;
        when.time = { h, m: 0, mer: null };
      }) ||
      take(/(?:\bat\s+)?\b(noon|midday)\b/i, () => {
        when.time = { h: 12, m: 0, mer: 'pm' };
      });
    void found;
  }

  return { rest: s, when };
}

const LEADING_FILLER = new RegExp(
  '^(?:' +
    [
      'please', 'pls', 'ok(?:ay)?', 'so', 'also', 'and', 'then', 'oh',
      'remind me to', 'remember to', "don'?t forget to",
      "i(?:'d| would) like to",
      "i(?:'m| am) going to",
      'i\\s+(?:really\\s+)?(?:want|need|have|got|gotta|should|must|wanna|gonna|plan)(?:\\s+to)?',
      "i(?:'ll| will)",
      'gotta', 'need to', 'want to', 'have to', 'going to', 'gonna', 'wanna', 'should',
      'to ?do:?', 'add', 'schedule', 'to',
    ].join('|') +
    ')\\s+',
  'i',
);
const TRAILING_JUNK = /(?:\s+\b(?:at|on|by|for|from|to|in|around|and|then|until|till|between|this|the|a|an|with)\b|\s*[,.;:!\-–@])\s*$/i;

export function cleanTitle(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim().replace(/^[,.;:!\-–@\s]+/, '');
  for (let i = 0; i < 10; i++) {
    const next = t.replace(LEADING_FILLER, '').replace(TRAILING_JUNK, '').trim();
    if (next === t) break;
    t = next;
  }
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Like cleanTitle, but also drops a leading "the"/"my" so it reads as a reference. */
const cleanQuery = (raw: string) => cleanTitle(cleanTitle(raw).replace(/^(?:the|my|a|an|that|this)\s+/i, ''));

function resolve(
  when: When,
  now: Date,
  defaultDate: string,
): { date: string | null; start: number | null; duration: number | null; earliest: number | null } {
  const today = dateKey(now);
  const nowMin = minutesOf(now);
  let date: string | null = null;
  let start: number | null = null;
  let duration: number | null = when.duration ?? null;
  let earliest: number | null = null;

  if (when.relMinutes !== undefined) {
    const t = Math.ceil((nowMin + when.relMinutes) / 5) * 5;
    date = addDays(today, Math.floor(t / 1440));
    start = t % 1440;
  }
  if (when.dayOffset !== undefined) {
    date = addDays(today, when.dayOffset);
  } else if (when.weekday) {
    let diff = (when.weekday.dow - now.getDay() + 7) % 7;
    if (diff === 0 && when.weekday.next) diff = 7;
    date = addDays(today, diff);
  }

  const effectiveDate = date ?? defaultDate;
  if (when.time) {
    start = to24(when.time, when.partOfDay, effectiveDate === today ? nowMin : null);
    if (when.endTime) {
      let end = to24(when.endTime, when.partOfDay, null);
      while (end <= start) end += 12 * 60;
      duration = end - start;
    }
  }
  if (start === null) {
    if (when.partOfDay) earliest = PART_OF_DAY_START[when.partOfDay];
    if (when.later && effectiveDate === today) earliest = Math.max(earliest ?? 0, nowMin + 60);
  }
  return { date, start, duration, earliest };
}

function parseAdd(text: string, now: Date, defaultDate: string): AddCommand | null {
  const { rest, when } = extractWhen(text, 'add');
  const title = cleanTitle(rest);
  if (!title) return null;
  const r = resolve(when, now, defaultDate);
  return { kind: 'add', title, date: r.date ?? defaultDate, start: r.start, duration: r.duration, earliest: r.earliest };
}

const DONE_PREFIX = /^(?:i(?:'ve|'m| am| have)?\s+)?(?:done with|finished(?: with)?|completed?|did|mark(?:ed)?\s+(?:as\s+)?done:?|check(?:ed)? off|done:?)\s+(.+)$/i;
const DONE_SUFFIX = /^(.+?)\s+(?:is\s+|are\s+)?(?:done|finished|completed?)[.!]*$/i;
const REMOVE_PREFIX = /^(?:please\s+)?(?:cancel|remove|delete|unschedule|scratch|forget(?:\s+about)?|never\s?mind|nvm)\s+(.+)$/i;
const MOVE_PREFIX = /^(?:please\s+)?(?:move|reschedule|push|shift|bump|postpone|delay)\s+(.+)$/i;

/**
 * @param defaultDate the day the user is looking at; used when no day is mentioned.
 */
export function parseCommand(input: string, now: Date, defaultDate: string): Command {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return { kind: 'none' };
  const fallback = () => parseAdd(text, now, defaultDate);

  const done = DONE_PREFIX.exec(text) ?? DONE_SUFFIX.exec(text);
  if (done) {
    const query = cleanQuery(done[1]);
    if (query) return { kind: 'done', query, fallback: fallback() };
  }

  const remove = REMOVE_PREFIX.exec(text);
  if (remove) {
    const { rest, when } = extractWhen(remove[1], 'add');
    const query = cleanQuery(rest);
    if (query) {
      const hasDay = when.dayOffset !== undefined || when.weekday !== undefined;
      return { kind: 'remove', query, date: hasDay ? resolve(when, now, defaultDate).date : null, fallback: fallback() };
    }
  }

  const move = MOVE_PREFIX.exec(text);
  if (move) {
    const { rest, when } = extractWhen(move[1], 'move');
    const query = cleanQuery(rest);
    if (query) {
      const r = resolve(when, now, defaultDate);
      return {
        kind: 'move',
        query,
        date: r.date,
        start: r.start,
        duration: r.duration,
        earliest: r.earliest,
        shift: when.shift ?? null,
        later: !!when.later && when.shift === undefined,
        fallback: fallback(),
      };
    }
  }

  return fallback() ?? { kind: 'none' };
}
