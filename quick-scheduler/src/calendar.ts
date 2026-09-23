// Bridge to the phone's calendar. Items with a time become calendar events with
// an alert, so the phone's own calendar app handles the notifications. Events
// that were already in the calendar are read back as "busy" time.

import * as Cal from 'expo-calendar/legacy';
import { Platform } from 'react-native';
import { addDays, fromKey, minutesOf, dateKey } from './dates';
import { BusyEvent, Item, Settings } from './types';

const MARKER = 'Added by Quick Scheduler';
const OWN_CALENDAR_TITLE = 'Quick Scheduler';

export type CalendarChoice = { id: string; title: string; source: string; color: string };

export async function hasPermission(): Promise<boolean> {
  return (await Cal.getCalendarPermissionsAsync()).granted;
}

export async function requestPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  const current = await Cal.getCalendarPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'blocked';
  return (await Cal.requestCalendarPermissionsAsync()).granted ? 'granted' : 'denied';
}

export async function writableCalendars(): Promise<CalendarChoice[]> {
  const cals = await Cal.getCalendarsAsync(Cal.EntityTypes.EVENT);
  return cals
    .filter((c) => c.allowsModifications)
    .map((c) => ({ id: c.id, title: c.title, source: c.source?.name ?? '', color: c.color }));
}

/** A calendar that syncs (e.g. your Google calendar) so reminders show up everywhere. */
export async function pickDefaultCalendar(): Promise<string> {
  if (Platform.OS === 'ios') {
    try {
      return (await Cal.getDefaultCalendarAsync()).id;
    } catch {
      // fall through
    }
  }
  const cals = (await Cal.getCalendarsAsync(Cal.EntityTypes.EVENT)).filter((c) => c.allowsModifications);
  const pick =
    cals.find((c) => c.isPrimary) ??
    cals.find((c) => c.source?.type === 'com.google' && c.accessLevel === Cal.CalendarAccessLevel.OWNER) ??
    cals.find((c) => !c.source?.isLocalAccount) ??
    cals[0];
  return pick ? pick.id : createOwnCalendar();
}

/** Creates (or reuses) a separate "Quick Scheduler" calendar on the phone. */
export async function createOwnCalendar(): Promise<string> {
  const existing = (await Cal.getCalendarsAsync(Cal.EntityTypes.EVENT)).find(
    (c) => c.title === OWN_CALENDAR_TITLE && c.allowsModifications,
  );
  if (existing) return existing.id;
  const base = {
    title: OWN_CALENDAR_TITLE,
    color: '#5B5BD6',
    entityType: Cal.EntityTypes.EVENT,
    name: 'quick-scheduler',
    ownerAccount: 'personal',
    accessLevel: Cal.CalendarAccessLevel.OWNER,
  };
  if (Platform.OS === 'ios') {
    const def = await Cal.getDefaultCalendarAsync();
    return Cal.createCalendarAsync({ ...base, sourceId: def.source.id, source: def.source });
  }
  return Cal.createCalendarAsync({ ...base, source: { isLocalAccount: true, name: OWN_CALENDAR_TITLE, type: 'LOCAL' } });
}

/** Timed events from all calendars that we didn't create, bucketed by day. */
export async function loadBusy(dates: string[], ownEventIds: Set<string>): Promise<Record<string, BusyEvent[]>> {
  if (!dates.length) return {};
  const sorted = [...dates].sort();
  const cals = await Cal.getCalendarsAsync(Cal.EntityTypes.EVENT);
  const ids = cals.filter((c) => c.isVisible !== false).map((c) => c.id);
  if (!ids.length) return Object.fromEntries(dates.map((d) => [d, []]));
  const events = await Cal.getEventsAsync(ids, fromKey(sorted[0]), fromKey(addDays(sorted[sorted.length - 1], 1)));

  const wanted = new Set(dates);
  const out: Record<string, BusyEvent[]> = Object.fromEntries(dates.map((d) => [d, []]));
  for (const e of events) {
    if (e.allDay || ownEventIds.has(e.id) || (e.notes ?? '').includes(MARKER)) continue;
    if (e.availability === Cal.Availability.FREE) continue;
    const s = new Date(e.startDate);
    const end = new Date(e.endDate);
    // Split events that cross midnight into per-day pieces.
    for (let d = dateKey(s); d <= dateKey(end); d = addDays(d, 1)) {
      if (!wanted.has(d)) continue;
      const start = d === dateKey(s) ? minutesOf(s) : 0;
      const stop = d === dateKey(end) ? minutesOf(end) : 1440;
      if (stop <= start) continue;
      out[d].push({ id: e.id, title: e.title || 'Busy', date: d, start, end: stop });
    }
  }
  return out;
}

function eventDetails(item: Item, settings: Settings) {
  return {
    title: item.title,
    startDate: fromKey(item.date, item.start!),
    endDate: fromKey(item.date, item.start! + item.duration),
    notes: MARKER,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    alarms:
      settings.reminderMinutes >= 0
        ? [{ relativeOffset: -settings.reminderMinutes, method: Cal.AlarmMethod.ALERT }]
        : [],
  };
}

const sameSlot = (a: Item, b: Item) =>
  a.title === b.title && a.date === b.date && a.start === b.start && a.duration === b.duration;

/**
 * Makes the phone calendar match `next`. Returns the event id each item should
 * now carry (null = no event).
 */
export async function syncCalendar(prev: Item[], next: Item[], settings: Settings): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!settings.calendarSync || !settings.calendarId) return result;

  const nextIds = new Set(next.map((i) => i.id));
  for (const old of prev) {
    if (!nextIds.has(old.id) && old.eventId) await Cal.deleteEventAsync(old.eventId).catch(() => {});
  }

  const prevById = new Map(prev.map((i) => [i.id, i]));
  for (const item of next) {
    const before = prevById.get(item.id);
    if (item.start === null) {
      if (item.eventId) {
        await Cal.deleteEventAsync(item.eventId).catch(() => {});
        result.set(item.id, null);
      }
      continue;
    }
    if (item.eventId) {
      if (before && before.eventId === item.eventId && sameSlot(before, item)) continue;
      try {
        // Android silently ignores updates to missing events, so check first.
        await Cal.getEventAsync(item.eventId);
        await Cal.updateEventAsync(item.eventId, eventDetails(item, settings));
        continue;
      } catch {
        // The event was deleted from the calendar; recreate it below.
      }
    }
    try {
      result.set(item.id, await Cal.createEventAsync(settings.calendarId, eventDetails(item, settings)));
    } catch (e) {
      console.warn('Could not create calendar event', e);
    }
  }
  return result;
}
