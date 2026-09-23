export type Item = {
  id: string;
  title: string;
  /** Local day, "YYYY-MM-DD". */
  date: string;
  /** Minutes after midnight, or null when no free slot was found ("Anytime"). */
  start: number | null;
  /** Length in minutes. */
  duration: number;
  /** True when the user gave an exact time. Fixed items never get moved automatically. */
  fixed: boolean;
  /** For flexible items: don't place before this minute (e.g. "this evening"). */
  earliest: number | null;
  /** For flexible items: must end by this minute (e.g. "before 3pm"). */
  latest?: number | null;
  done: boolean;
  createdAt: number;
  /** Id of the matching event in the phone calendar, once synced. */
  eventId?: string | null;
  /** Set on occurrences of a repeating item. */
  routineId?: string | null;
};

/** A repeating item ("workout mon tue thu fri 5-6pm every week"). */
export type Routine = {
  id: string;
  title: string;
  /** Weekdays, 0 = Sunday. */
  days: number[];
  start: number | null;
  duration: number;
  earliest: number | null;
  latest: number | null;
  /** First day it applies. */
  from: string;
  /** Occurrences have been created up to and including this day. */
  until: string;
  createdAt: number;
};

export type Settings = {
  /** Wake-up time and bedtime (minutes after midnight). Nothing is auto-placed outside them. */
  dayStart: number;
  dayEnd: number;
  defaultDuration: number;
  calendarSync: boolean;
  calendarId: string | null;
  /** Minutes before the start to alert. 0 = at start, -1 = no alert. */
  reminderMinutes: number;
};

export const DEFAULT_SETTINGS: Settings = {
  dayStart: 7 * 60,
  dayEnd: 23 * 60,
  defaultDuration: 30,
  calendarSync: true,
  calendarId: null,
  reminderMinutes: 10,
};

export type Interval = { start: number; end: number };

/** An event already in the phone calendar that we didn't create. */
export type BusyEvent = Interval & { id: string; title: string; date: string };
