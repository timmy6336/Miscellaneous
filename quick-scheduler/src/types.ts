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
  done: boolean;
  createdAt: number;
  /** Id of the matching event in the phone calendar, once synced. */
  eventId?: string | null;
};

export type Settings = {
  /** Auto-placed items go between dayStart and dayEnd (minutes after midnight). */
  dayStart: number;
  dayEnd: number;
  defaultDuration: number;
  calendarSync: boolean;
  calendarId: string | null;
  /** Minutes before the start to alert. 0 = at start, -1 = no alert. */
  reminderMinutes: number;
};

export const DEFAULT_SETTINGS: Settings = {
  dayStart: 8 * 60,
  dayEnd: 22 * 60,
  defaultDuration: 30,
  calendarSync: true,
  calendarId: null,
  reminderMinutes: 10,
};

export type Interval = { start: number; end: number };

/** An event already in the phone calendar that we didn't create. */
export type BusyEvent = Interval & { id: string; title: string; date: string };
