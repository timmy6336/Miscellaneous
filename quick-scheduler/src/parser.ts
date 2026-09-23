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
  latest: number | null;
  /** Weekdays (0 = Sunday) this repeats on, e.g. "every mon and wed". */
  repeat: number[] | null;
  /** Extra one-off days, e.g. "this sat and sun". */
  alsoOn: string[];
  /** Extra start times, e.g. "meds at 8am and 8pm". */
  alsoAt: number[];
  /** Repeat every N weeks ("every other week" = 2). */
  interval: number;
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
      latest: number | null;
      /** Minutes to shift by, e.g. "push gym back 30 min". */
      shift: number | null;
      /** "postpone gym" with no target: next free slot after it. */
      later: boolean;
      fallback: AddCommand | null;
    }
  | { kind: 'remove'; query: string; date: string | null; fallback: AddCommand | null }
  | { kind: 'done'; query: string; fallback: AddCommand | null }
  /** "stop workout" — end a repeating item. */
  | { kind: 'stopRepeat'; query: string; fallback: AddCommand | null }
  /** "I wake up at 7", "bedtime 11pm". */
  | { kind: 'setting'; patch: { dayStart?: number; dayEnd?: number } }
  | { kind: 'none' };

type Meridiem = 'am' | 'pm' | null;
type ClockTime = { h: number; m: number; mer: Meridiem };

type When = {
  dayOffset?: number;
  /** Weekdays mentioned ("monday", "mon wed fri"); `next` = "next monday". */
  days?: { dows: number[]; next: boolean };
  /** "every ...", "weekly", "mondays" etc. */
  recurring?: boolean;
  /** Weeks between repeats ("every other week" = 2). */
  interval?: number;
  /** Additional times: "at 8am and 8pm". */
  extraTimes?: ClockTime[];
  /** Time window for flexible items: "after 5pm", "before noon". */
  after?: ClockTime;
  before?: ClockTime;
  afterMin?: number;
  beforeMin?: number;
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
const AT = String.raw`(?:(?:\bat|\baround|@)\s*)`;
/** Hour with optional minutes: "5", "5:30", "5.30", "530", "1730" (2 groups). */
const HM = String.raw`(\d{1,2})(?:[:.]?(\d{2}))?`;
/** A clock time: "5", "5:30", "530pm", "noon", "midnight" (4 groups). */
const CLOCK = String.raw`(?:${HM}\s*${MER}?|(noon|midday|midnight))`;
const NOT_DURATION = String.raw`(?!\s*(?:min|hour|hr|h\b|day|week|month))`;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_TOKEN = String.raw`(?:sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|tues|thurs|thur|weds|sun|mon|tue|wed|thu|fri|sat)`;
const DOW_BY_PREFIX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
// Named anchors for "after work", "before lunch", ...
const NAMED_AFTER: Record<string, number> = { work: 17 * 60, school: 15 * 60 + 30, breakfast: 9 * 60, lunch: 13 * 60, dinner: 19 * 60 + 30 };
const NAMED_BEFORE: Record<string, number> = { work: 8 * 60 + 30, school: 7 * 60 + 30, breakfast: 8 * 60, lunch: 12 * 60, dinner: 18 * 60 };
/** A single time token without capture groups, for lists like "8am, 2pm and 8pm". */
const TIME_TOKEN = String.raw`\b\d{1,2}(?:[:.]?\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?`;
const DAY_WORD = String.raw`(?:today|tonight|tomorrow|tmrw|tmr|${WEEKDAYS.join('|')})`;
const TOMORROW = String.raw`(?:tomorrow|tmrw|tmr|tmro|tomorow|tommorow|tommorrow|2moro)`;

function amountToMinutes(amount: string, unit: string): number {
  const a = amount.toLowerCase();
  const n = WORD_NUM[a] ?? parseFloat(a);
  return Math.round(unit.toLowerCase().startsWith('h') ? n * 60 : n);
}

function clock(h?: string, mm?: string, mer?: string, word?: string): ClockTime | null {
  if (word) return word.toLowerCase() === 'midnight' ? { h: 24, m: 0, mer: null } : { h: 12, m: 0, mer: 'pm' };
  if (h === undefined) return null;
  const t: ClockTime = { h: +h, m: +(mm ?? 0), mer: toMer(mer) };
  if (t.h > 23 || t.m > 59 || (t.mer && (t.h < 1 || t.h > 12))) return null;
  return t;
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
    take(/\b(?:some\s*time|at\s+some\s+point|whenever)\b/i, () => {});


    // Ranges: "3-4pm", "from 2 to 3:30", "10am to noon" isn't supported, keep it simple.
    take(
      new RegExp(
        String.raw`(\bfrom\s+)?\b${HM}\s*${MER}?\s*(?:-|–|\bto\b|\buntil\b|\btill\b)\s*${HM}\s*${MER}?(?=\W|$)`,
        'i',
      ),
      (m) => {
        const [, from, h1, m1, mer1, h2, m2, mer2] = m;
        if (!from && !mer1 && !mer2 && !/\d[:.]\d/.test(m[0])) {
          // A bare "7-9" is a time range, but "555-1234" or "2-3 miles" aren't.
          const after = s.slice(m.index + m[0].length);
          const hours = !m1 && !m2 && +h1 >= 1 && +h1 <= 12 && +h2 >= 1 && +h2 <= 12 && +h1 !== +h2;
          const followedByWord =
            /^\s*[a-z]/i.test(after) &&
            !new RegExp(String.raw`^\s*(?:on|every|each|tomorrow|today|tonight|this|next|daily|weekdays?|weekends?|for|at|in|${DAY_TOKEN})\b`, 'i').test(after);
          if (!hours || followedByWord) return false;
        }
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

  // Time windows: "between 2 and 4pm", "after 5", "before noon", "after work".
  take(new RegExp(String.raw`\bbetween\s+${CLOCK}\s*(?:and|-|–|to)\s*${CLOCK}(?=\W|$)`, 'i'), (m) => {
    const a = clock(m[1], m[2], m[3], m[4]);
    const b = clock(m[5], m[6], m[7], m[8]);
    if (!a || !b) return false;
    if (!a.mer && b.mer && a.h <= 12) {
      a.mer = b.mer;
      if (to24(a, undefined, null) >= to24(b, undefined, null)) a.mer = b.mer === 'pm' ? 'am' : 'pm';
    }
    when.after = a;
    when.before = b;
  });
  take(/\bbefore\s+(?:bed(?:time)?|sleep|going\s+to\s+(?:bed|sleep))\b/i, () => {
    when.afterMin = 20 * 60; // winding down in the evening
  });
  take(/\b(after|before)\s+(work|school|breakfast|lunch|dinner)\b/i, (m) => {
    const key = m[2].toLowerCase();
    if (m[1].toLowerCase() === 'after') when.afterMin = NAMED_AFTER[key];
    else when.beforeMin = NAMED_BEFORE[key];
  });
  take(new RegExp(String.raw`\b(?:after|not before|no earlier than)\s+${CLOCK}${NOT_DURATION}(?=\W|$)`, 'i'), (m) => {
    const c = clock(m[1], m[2], m[3], m[4]);
    if (!c) return false;
    when.after = c;
  });
  take(new RegExp(String.raw`\b(?:before|by|no later than)\s+${CLOCK}${NOT_DURATION}(?=\W|$)`, 'i'), (m) => {
    const c = clock(m[1], m[2], m[3], m[4]);
    if (!c) return false;
    when.before = c;
  });

  // Repeats: "every other week", "every day", "weekdays", "every week", "every evening".
  take(/\b(?:every\s+(?:other|second|2nd)\s+week|every\s+(?:2|two)\s+weeks|bi-?weekly|fortnightly)\b/i, () => {
    when.recurring = true;
    when.interval = 2;
  });
  take(new RegExp(String.raw`\bevery\s+(?:other|second|2nd)\s+(?=${DAY_TOKEN}\b)`, 'i'), () => {
    when.interval = 2;
    return 'every';
  });
  take(/\b(?:every\s*day|each\s+day|every\s+single\s+day|daily)\b/i, () => {
    when.days = { dows: ALL_DAYS, next: false };
    when.recurring = true;
  });
  take(/\b(?:every|each)\s+(morning|afternoon|evening|night)\b/i, (m) => {
    when.days = { dows: ALL_DAYS, next: false };
    when.recurring = true;
    when.partOfDay = m[1].toLowerCase() as PartOfDay;
  });
  take(/\b(?:(?:every|each)\s+weekday|(?:on\s+)?weekdays)\b/i, () => {
    when.days = { dows: [1, 2, 3, 4, 5], next: false };
    when.recurring = true;
  });
  take(/\b(?:on\s+the|this|over\s+the)\s+weekend\b/i, () => {
    when.days = { dows: [6], next: false }; // "on the weekend" = this Saturday
  });
  take(/\b(?:(?:every|each)\s+weekend|(?:on\s+)?weekends)\b/i, () => {
    when.days = { dows: [0, 6], next: false };
    when.recurring = true;
  });
  take(/\b(?:(?:every|each)\s+week|weekly|(?:on\s+)?a\s+weekly\s+basis)\b/i, () => {
    when.recurring = true;
  });

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
  // Day ranges: "mon-fri", "monday through thursday".
  if (!when.days) {
    take(
      new RegExp(String.raw`\b(?:(on|every|each|this|next)\s+)?(?:from\s+)?(${DAY_TOKEN})\s*(?:-|–|\bto\b|\bthrough\b|\bthru\b|\buntil\b)\s*(${DAY_TOKEN})\b`, 'i'),
      (m) => {
        const a = DOW_BY_PREFIX[m[2].toLowerCase().slice(0, 3)];
        const b = DOW_BY_PREFIX[m[3].toLowerCase().slice(0, 3)];
        if (a === b) return false;
        const dows: number[] = [];
        for (let d = a; ; d = (d + 1) % 7) {
          dows.push(d);
          if (d === b) break;
        }
        const prefix = m[1]?.toLowerCase();
        when.days = { dows: dows.sort(), next: prefix === 'next' };
        if (prefix !== 'this' && prefix !== 'next') when.recurring = true;
      },
    );
  }
  // Weekdays, alone or as a list: "friday", "on sat", "mon, wed and fri", "tuesdays".
  if (!when.days) {
    take(
      new RegExp(
        String.raw`\b(?:(on|every|each|next|this)\s+)?(${DAY_TOKEN}(?:(?:\s*[,/&]\s*|\s+(?:and|or)\s+|\s+)${DAY_TOKEN}\b)*)\b`,
        'i',
      ),
      (m) => {
        const prefix = m[1]?.toLowerCase();
        const words = m[2].toLowerCase().split(/[^a-z]+/).filter((w) => w && w !== 'and' && w !== 'or');
        // A lone abbreviation like "sat" or "sun" is too likely to be an ordinary word,
        // unless a time is right next to it ("soccer sat 10am").
        if (words.length === 1 && !prefix && !words[0].includes('day')) {
          const nextToTime =
            /^\s*(?:at\s+|@\s*)?\d/.test(s.slice(m.index + m[0].length)) ||
            /\d\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:on\s+)?$/i.test(s.slice(0, m.index));
          if (!nextToTime) return false;
        }
        const dows = [...new Set(words.map((w) => DOW_BY_PREFIX[w.slice(0, 3)]))].sort();
        when.days = { dows, next: prefix === 'next' };
        // "every friday", "fridays" and lists like "mon wed fri" repeat weekly;
        // "this sat and sun" / "next fri" are one-offs.
        if (prefix === 'every' || prefix === 'each' || words.some((w) => w.endsWith('days'))) when.recurring = true;
        else if (dows.length > 1 && prefix !== 'this' && prefix !== 'next') when.recurring = true;
      },
    );
  }

  if (mode === 'add' && !when.time && !when.after) {
    // Several times: "meds at 8am and 8pm", "check in at 9am, 1pm and 5pm".
    take(new RegExp(String.raw`(?:${AT})?${TIME_TOKEN}(?:\s*(?:,|and|&)\s*(?:at\s+)?${TIME_TOKEN})+(?=\W|$)`, 'i'), (m) => {
      const parts = [...m[0].matchAll(new RegExp(String.raw`(\d{1,2})(?:[:.]?(\d{2}))?\s*${MER}?`, 'gi'))];
      if (parts.length < 2 || !parts[parts.length - 1][3]) return false;
      const times = parts.map((p) => clock(p[1], p[2], p[3]));
      if (times.some((t) => !t)) return false;
      const last = times[times.length - 1]!;
      for (const t of times) if (!t!.mer) t!.mer = last.mer;
      when.time = times[0]!;
      when.extraTimes = times.slice(1) as ClockTime[];
    });
  }

  // Times.
  if (!when.time) {
    const found =
      take(new RegExp(String.raw`${AT}?\b${HM}\s*${MER}(?=\W|$)`, 'i'), (m) => {
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
      take(new RegExp(String.raw`${AT}${HM}\b(?![:.]\d)(?:\s*o'?clock)?`, 'i'), (m) => {
        const h = +m[1];
        const min = +(m[2] ?? 0);
        if (h > 23 || min > 59) return false;
        when.time = { h, m: min, mer: null };
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
      'i(?:\\s+usually|\\s+normally|\\s+always)?(?=\\s)',
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

type Resolved = {
  date: string | null;
  start: number | null;
  duration: number | null;
  earliest: number | null;
  latest: number | null;
  repeat: number[] | null;
  alsoOn: string[];
  alsoAt: number[];
  interval: number;
};

function resolve(when: When, now: Date, defaultDate: string): Resolved {
  const today = dateKey(now);
  const nowMin = minutesOf(now);
  let date: string | null = null;
  let start: number | null = null;
  let duration: number | null = when.duration ?? null;
  let earliest: number | null = null;
  let latest: number | null = null;
  let repeat: number[] | null = null;
  let alsoOn: string[] = [];
  const nextDow = (dow: number, forceNextWeek: boolean) => {
    let diff = (dow - now.getDay() + 7) % 7;
    if (diff === 0 && forceNextWeek) diff = 7;
    return addDays(today, diff);
  };

  if (when.relMinutes !== undefined) {
    const t = Math.ceil((nowMin + when.relMinutes) / 5) * 5;
    date = addDays(today, Math.floor(t / 1440));
    start = t % 1440;
  }
  if (when.dayOffset !== undefined) {
    date = addDays(today, when.dayOffset);
  }

  if (when.recurring) {
    const from = date ?? (defaultDate > today ? defaultDate : today);
    repeat = when.days?.dows ?? [new Date(fromKeyParts(from)).getDay()];
    date = from;
  } else if (when.days && date === null) {
    const dates = when.days.dows.map((d) => nextDow(d, when.days!.next)).sort();
    date = dates[0];
    alsoOn = dates.slice(1);
  }

  const effectiveDate = date ?? defaultDate;
  // For "at 9" today, a time that already passed means PM; not for repeats.
  const nowIfToday = effectiveDate === today && !repeat ? nowMin : null;
  const alsoAt = (when.extraTimes ?? []).map((t) => to24(t, when.partOfDay, nowIfToday));
  if (when.time) {
    start = to24(when.time, when.partOfDay, nowIfToday);
    if (when.endTime) {
      let end = to24(when.endTime, when.partOfDay, null);
      while (end <= start) end += 12 * 60;
      duration = end - start;
    }
  }
  if (start === null) {
    const lows: number[] = [];
    if (when.partOfDay) lows.push(PART_OF_DAY_START[when.partOfDay]);
    if (when.later && effectiveDate === today) lows.push(nowMin + 60);
    if (when.afterMin !== undefined) lows.push(when.afterMin);
    if (when.after) lows.push(to24(when.after, when.partOfDay, nowIfToday));
    if (lows.length) earliest = Math.max(...lows);

    const highs: number[] = [];
    if (when.beforeMin !== undefined) highs.push(when.beforeMin);
    if (when.before) {
      let b = to24(when.before, when.partOfDay, nowIfToday);
      // "after 5 before 8" -> 8pm, not 8am.
      if (earliest !== null && b <= earliest && b + 720 <= 1440) b += 720;
      highs.push(b);
    }
    if (highs.length) latest = Math.min(...highs);
  }
  return { date, start, duration, earliest, latest, repeat, alsoOn, alsoAt, interval: repeat ? when.interval ?? 1 : 1 };
}

const fromKeyParts = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

function parseAdd(text: string, now: Date, defaultDate: string): AddCommand | null {
  const { rest, when } = extractWhen(text, 'add');
  const title = cleanTitle(rest);
  if (!title) return null;
  const r = resolve(when, now, defaultDate);
  return {
    kind: 'add',
    title,
    date: r.date ?? defaultDate,
    start: r.start,
    duration: r.duration,
    earliest: r.earliest,
    latest: r.latest,
    repeat: r.repeat,
    alsoOn: r.alsoOn,
    alsoAt: r.alsoAt,
    interval: r.interval,
  };
}

/** Wake-up / bedtime clock → minutes. Bare numbers mean AM for waking and PM for bed. */
function settingMinutes(t: ClockTime, kind: 'wake' | 'sleep'): number {
  if (kind === 'wake') return t.mer ? to24(t, undefined, null) : t.h * 60 + t.m;
  let min = t.mer ? to24(t, undefined, null) : t.h >= 7 && t.h <= 11 ? (t.h + 12) * 60 + t.m : t.h * 60 + t.m;
  if (min === 0 || min === 12 * 60 && !t.mer) min = 1440; // "midnight" / "12"
  return min < 6 * 60 ? 1440 : Math.min(min, 1440); // past-midnight bedtimes are capped at midnight
}

const WAKE_RE = new RegExp(
  String.raw`^(?:set\s+(?:my\s+)?)?(?:i\s+)?(?:usually\s+|normally\s+)?(?:wake(?:\s*-?\s*up)?|get\s+up)(?:\s+time)?(?:\s+(?:is|to))?\s+(?:at\s+|around\s+)?${CLOCK}(?:\s+every\s*day)?[.!]*$`,
  'i',
);
const SLEEP_RE = new RegExp(
  String.raw`^(?:set\s+(?:my\s+)?)?(?:i\s+)?(?:usually\s+|normally\s+)?(?:go\s+to\s+(?:bed|sleep)|sleep|bed\s*time|fall\s+asleep)(?:\s+time)?(?:\s+(?:is|to))?\s+(?:at\s+|around\s+)?${CLOCK}(?:\s+every\s*(?:day|night))?[.!]*$`,
  'i',
);

const DONE_PREFIX = /^(?:i(?:'ve|'m| am| have)?\s+)?(?:done with|finished(?: with)?|completed?|did|mark(?:ed)?\s+(?:as\s+)?done:?|check(?:ed)? off|done:?)\s+(.+)$/i;
const DONE_SUFFIX = /^(.+?)\s+(?:is\s+|are\s+)?(?:done|finished|completed?)[.!]*$/i;
const REMOVE_PREFIX = /^(?:please\s+)?(?:cancel|remove|delete|unschedule|scratch|forget(?:\s+about)?|never\s?mind|nvm)\s+(.+)$/i;
const STOP_PREFIX = /^(?:please\s+)?(?:stop(?:\s+repeating)?|end|no\s+more|quit)\s+(.+)$/i;
const SERIES_WORDS = /\b(?:every\s*(?:week|day)|each\s+week|all(?:\s+of\s+them)?|recurring|repeating|repeats?|series|weekly|for\s+good|forever|permanently)\b/gi;
const MOVE_PREFIX = /^(?:please\s+)?(?:move|reschedule|push|shift|bump|postpone|delay)\s+(.+)$/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NW = String.raw`(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})`;
const MINUTE_WORDS: Record<string, string> = { thirty: '30', fifteen: '15', 'forty five': '45', 'forty-five': '45', 'o five': '05' };
const numOf = (w: string) => NUMBER_WORDS[w.toLowerCase()] ?? +w;

/** Rewrites times written in words ("half past five", "at seven thirty", "5ish") as digits. */
export function normalizeTimeWords(text: string): string {
  return text
    .replace(new RegExp(String.raw`\bhalf past ${NW}\b`, 'gi'), (_, n) => `${numOf(n)}:30`)
    .replace(new RegExp(String.raw`\bquarter past ${NW}\b`, 'gi'), (_, n) => `${numOf(n)}:15`)
    .replace(new RegExp(String.raw`\bquarter (?:to|til) ${NW}\b`, 'gi'), (_, n) => `${((numOf(n) + 10) % 12) + 1}:45`)
    .replace(new RegExp(String.raw`\b${NW}[ -](thirty|fifteen|forty[ -]five|o five)\b`, 'gi'), (_, n, m) => `${numOf(n)}:${MINUTE_WORDS[m.toLowerCase().replace('-', ' ')]}`)
    .replace(new RegExp(String.raw`\b${NW}\s*(o'?\s?clock|a\.?m\.?|p\.?m\.?)`, 'gi'), (_, n, suffix) => `${numOf(n)} ${suffix.replace(/\s/, '')}`)
    .replace(
      new RegExp(String.raw`\b(at|by|after|before|around|from|until|till) ${NW}\b(?=\s*(?:$|[,.!?]|-|to\b|and\b|until\b|tonight|tomorrow|today|in\b|on\b|every|for\b|this\b|next\b))`, 'gi'),
      (_, prep, n) => `${prep} ${numOf(n)}`,
    )
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*-?ish\b/gi, '$1');
}

/**
 * @param defaultDate the day the user is looking at; used when no day is mentioned.
 */
export function parseCommand(input: string, now: Date, defaultDate: string): Command {
  const text = normalizeTimeWords(input.trim().replace(/\s+/g, ' '));
  if (!text) return { kind: 'none' };
  const fallback = () => parseAdd(text, now, defaultDate);

  for (const [re, kind] of [[WAKE_RE, 'wake'], [SLEEP_RE, 'sleep']] as const) {
    const m = re.exec(text);
    const c = m && clock(m[1], m[2], m[3], m[4]);
    if (c) {
      const min = settingMinutes(c, kind);
      return { kind: 'setting', patch: kind === 'wake' ? { dayStart: min } : { dayEnd: min } };
    }
  }

  const stop = STOP_PREFIX.exec(text);
  if (stop) {
    const query = cleanQuery(extractWhen(stop[1].replace(SERIES_WORDS, ' '), 'add').rest);
    if (query) return { kind: 'stopRepeat', query, fallback: fallback() };
  }

  const done = DONE_PREFIX.exec(text) ?? DONE_SUFFIX.exec(text);
  if (done) {
    const query = cleanQuery(done[1]);
    if (query) return { kind: 'done', query, fallback: fallback() };
  }

  const remove = REMOVE_PREFIX.exec(text);
  if (remove && SERIES_WORDS.test(remove[1])) {
    SERIES_WORDS.lastIndex = 0;
    const query = cleanQuery(extractWhen(remove[1].replace(SERIES_WORDS, ' '), 'add').rest);
    if (query) return { kind: 'stopRepeat', query, fallback: fallback() };
  }
  SERIES_WORDS.lastIndex = 0;
  if (remove) {
    const { rest, when } = extractWhen(remove[1], 'add');
    const query = cleanQuery(rest);
    if (query) {
      const hasDay = when.dayOffset !== undefined || when.days !== undefined;
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
        latest: r.latest,
        shift: when.shift ?? null,
        later: !!when.later && when.shift === undefined,
        fallback: fallback(),
      };
    }
  }

  return fallback() ?? { kind: 'none' };
}
