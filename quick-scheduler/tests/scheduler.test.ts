/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/parser';
import { applyCommand, bringToToday, Ctx, findSlot, materialize, pushLater, reflow, setDone, stopRoutine } from '../src/scheduler';
import { DEFAULT_SETTINGS, Item, Routine } from '../src/types';

const NOW = new Date(2026, 8, 23, 13, 10); // Wed 1:10 PM
const TODAY = '2026-09-23';
const h = (hh: number, mm = 0) => hh * 60 + mm;
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ now: NOW, settings: DEFAULT_SETTINGS, busy: {}, viewDate: TODAY, ...over });

function run(lines: string[], c = ctx(), items: Item[] = [], routines: Routine[] = []) {
  let last;
  for (const line of lines) {
    last = applyCommand(parseCommand(line, c.now, c.viewDate), items, c, routines);
    items = last.items;
    routines = last.routines ?? routines;
  }
  return { items, routines, last: last! };
}
const byTitle = (items: Item[], t: string) => items.find((i) => i.title === t)!;

test('findSlot skips busy blocks', () => {
  assert.equal(findSlot([], 600, 30, 1320), 600);
  assert.equal(findSlot([{ start: 600, end: 660 }], 600, 30, 1320), 660);
  assert.equal(findSlot([{ start: 640, end: 700 }], 600, 30, 1320), 600);
  assert.equal(findSlot([{ start: 620, end: 700 }], 600, 30, 1320), 700);
  assert.equal(findSlot([{ start: 600, end: 1320 }], 600, 30, 1320), null);
});

test('untimed items go into the next free slot after now', () => {
  const { items, last } = run(['groceries', 'laundry for 1 hour']);
  assert.equal(byTitle(items, 'Groceries').start, h(13, 10));
  assert.equal(byTitle(items, 'Laundry').start, h(13, 40));
  assert.match(last.message, /Added “Laundry” · Today 1:40 PM – 2:40 PM/);
});

test('a fixed-time item bumps flexible items out of the way', () => {
  const { items, last } = run(['groceries', 'call with boss at 1:15pm for 45 min']);
  assert.equal(byTitle(items, 'Call with boss').start, h(13, 15));
  assert.equal(byTitle(items, 'Groceries').start, h(14));
  assert.match(last.message, /Shifted “Groceries” → 2:00 PM/);
});

test('calendar events count as busy', () => {
  const busy = { [TODAY]: [{ id: 'e1', title: 'Standup', date: TODAY, start: h(13), end: h(14) }] };
  const { items } = run(['email Sam'], ctx({ busy }));
  assert.equal(byTitle(items, 'Email Sam').start, h(14));
  const r = run(['1:1 at 1:30pm'], ctx({ busy }));
  assert.match(r.last.message, /overlaps “Standup”/);
  assert.equal(r.last.tone, 'warn');
});

test('items that do not fit today land in Anytime', () => {
  const late = ctx({ now: new Date(2026, 8, 23, 21, 50) });
  const { items, last } = run(['long study session for 2 hours'], late);
  assert.equal(items[0].start, null);
  assert.match(last.message, /Anytime/);
});

test('parts of day set an earliest time', () => {
  const { items } = run(['call grandma this evening']);
  assert.equal(items[0].start, h(17));
  assert.equal(items[0].fixed, false);
});

test('move, shift and push later', () => {
  let { items } = run(['gym at 5pm', 'groceries']);
  ({ items } = run(['move gym to 6:30pm'], ctx(), items));
  assert.equal(byTitle(items, 'Gym').start, h(18, 30));
  ({ items } = run(['push gym back 30 min'], ctx(), items));
  assert.equal(byTitle(items, 'Gym').start, h(19));
  ({ items } = run(['move gym to tomorrow'], ctx(), items));
  assert.equal(byTitle(items, 'Gym').date, '2026-09-24');
  assert.equal(byTitle(items, 'Gym').start, h(19)); // keeps its exact time
  const g = byTitle(items, 'Groceries');
  const r = pushLater(items, g.id, ctx());
  assert.equal(byTitle(r.items, 'Groceries').start, h(13, 40));
});

test('cancelling frees time and flexible items move up', () => {
  let { items } = run(['errand for 1 hour', 'walk']);
  assert.equal(byTitle(items, 'Walk').start, h(14, 10));
  const r = run(['cancel the errand'], ctx(), items);
  assert.equal(r.items.length, 1);
  assert.equal(byTitle(r.items, 'Walk').start, h(13, 10));
  assert.match(r.last.message, /Removed “Errand”/);
});

test('done commands match fuzzily; unknown targets become new items', () => {
  let { items } = run(['pick up dry cleaning', 'dentist appointment at 4pm']);
  let r = run(['done dry cleaning'], ctx(), items);
  assert.equal(byTitle(r.items, 'Pick up dry cleaning').done, true);
  r = run(['cancel dentist'], ctx(), items);
  assert.equal(r.items.length, 1);
  r = run(['cancel my gym membership'], ctx(), items);
  assert.equal(r.items.length, 3);
  assert.ok(byTitle(r.items, 'Cancel my gym membership'));
});

test('"it" refers to the last thing added', () => {
  const { items } = run(['water plants', 'move it to 6pm']);
  assert.equal(items[0].start, h(18));
});

test('marking done frees the slot; past items stay put', () => {
  let { items } = run(['a thing for 1 hour', 'b thing']);
  const r = setDone(items, byTitle(items, 'A thing').id, true, ctx());
  assert.equal(byTitle(r.items, 'B thing').start, h(13, 10));

  const later = ctx({ now: new Date(2026, 8, 23, 15, 0) });
  const stay = reflow(r.items, TODAY, later);
  assert.equal(byTitle(stay, 'B thing').start, h(13, 10)); // already started, not moved
});

test('leftovers from earlier days can be brought into today', () => {
  const old: Item = {
    id: 'x', title: 'Old task', date: '2026-09-21', start: h(10), duration: 30, fixed: true,
    earliest: null, done: false, createdAt: 0,
  };
  const r = bringToToday([old], ctx());
  assert.equal(r.items[0].date, TODAY);
  assert.equal(r.items[0].start, h(13, 10));
});

test('"after 5pm" goes into the first free slot after 5', () => {
  const { items } = run(['dinner at 5pm for 1 hour', 'groceries after 5pm']);
  assert.equal(byTitle(items, 'Groceries').start, h(18));
  assert.equal(byTitle(items, 'Groceries').fixed, false);
});

test('"before" limits when an item may end', () => {
  const { items, last } = run(['call the bank before 2pm for 1 hour']); // it's 1:10 PM
  assert.equal(items[0].start, null);
  assert.match(last.message, /no free slot before 2:00 PM/);
  const ok = run(['call the bank before 3pm for 1 hour']);
  assert.equal(ok.items[0].start, h(13, 10));
});

test('nothing is auto-placed outside wake-up and bedtime', () => {
  const settings = { ...DEFAULT_SETTINGS, dayStart: h(9), dayEnd: h(21) };
  const tomorrow = run(['laundry tomorrow'], ctx({ settings }));
  assert.equal(tomorrow.items[0].start, h(9));
  const late = run(['long read for 2 hours'], ctx({ settings, now: new Date(2026, 8, 23, 19, 30) }));
  assert.equal(late.items[0].start, null);
  const warn = run(['call at 10:30pm'], ctx({ settings }));
  assert.match(warn.last.message, /past your bedtime/);
});

test('changing wake-up time by typing moves auto-placed items', () => {
  let { items } = run(['laundry tomorrow']);
  assert.equal(items[0].start, h(7));
  const r = run(['I wake up at 9'], ctx(), items);
  assert.deepEqual(r.last.settings, { dayStart: h(9) });
  assert.equal(r.items[0].start, h(9));
});

test('repeating workout fills the next 4 weeks and shows up on each day', () => {
  const { items, routines, last } = run(['on Monday Tuesday Thursday Friday I want to workout from 5-6pm every week']);
  assert.equal(routines.length, 1);
  assert.equal(items.length, 16);
  assert.ok(items.every((i) => i.title === 'Workout' && i.start === h(17) && i.duration === 60 && i.fixed));
  assert.deepEqual([...new Set(items.map((i) => new Date(i.date + 'T12:00').getDay()))].sort(), [1, 2, 4, 5]);
  assert.match(last.message, /Repeating: “Workout” every Mon, Tue, Thu, Fri · 5:00 PM – 6:00 PM\. Next: Tomorrow/);

  // A week later, the next week gets filled in; deleted occurrences stay deleted.
  const withoutOne = items.filter((i) => i.date !== '2026-09-24');
  const weekLater = ctx({ now: new Date(2026, 8, 30, 8, 0) });
  const m = materialize(routines, withoutOne, weekLater);
  assert.equal(m.added.length, 4);
  assert.ok(!m.items.some((i) => i.date === '2026-09-24'));
});

test('flexible repeats get placed around other things', () => {
  const { items } = run(['dinner tomorrow at 5pm for 1 hour', 'walk every day after 5pm']);
  const tomorrowWalk = items.find((i) => i.title === 'Walk' && i.date === '2026-09-24')!;
  assert.equal(tomorrowWalk.start, h(18));
});

test('stopping a repeat removes upcoming occurrences but keeps finished ones', () => {
  let { items, routines } = run(['yoga every day at 7am']);
  const first = items.find((i) => i.date === '2026-09-24')!;
  items = setDone(items, first.id, true, ctx()).items;
  const r = run(['stop yoga'], ctx(), items, routines);
  assert.equal(r.routines.length, 0);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].done, true);
  assert.match(r.last.message, /Stopped repeating “Yoga”/);
  assert.equal(stopRoutine(items, [], 'nope', ctx()).tone, 'error');
});

test('removing one occurrence mentions how to stop the series', () => {
  const { items, routines } = run(['piano every monday at 4pm']);
  const r = run(['cancel piano'], ctx(), items, routines);
  assert.equal(r.items.length, items.length - 1);
  assert.equal(r.routines.length, 1);
  assert.match(r.last.message, /stop piano/);
});

test('"this sat and sun" adds one item per day', () => {
  const { items } = run(['brunch this sat and sun at 11am']);
  assert.deepEqual(items.map((i) => i.date).sort(), ['2026-09-26', '2026-09-27']);
  assert.ok(items.every((i) => i.start === h(11) && !i.routineId));
});

test('leftovers skip missed occurrences of repeats', () => {
  const missed: Item = {
    id: 'r1', title: 'Workout', date: '2026-09-21', start: h(17), duration: 60, fixed: true,
    earliest: null, done: false, createdAt: 0, routineId: 'x',
  };
  assert.equal(bringToToday([missed], ctx()).items[0].date, '2026-09-21');
});

test('the reported workout lands at 5:30-6:30 PM on the right days', () => {
  const { items } = run(['I work out mon tue Thursday fri from 530pm to 630pm']);
  assert.equal(items.length, 16);
  assert.ok(items.every((i) => i.title === 'Work out' && i.start === h(17, 30) && i.duration === 60 && i.fixed));
});

test('several times make several items (or repeats)', () => {
  const once = run(['take meds at 8am and 8pm']);
  assert.deepEqual(once.items.map((i) => i.start).sort((a, b) => a! - b!), [h(8), h(20)]);
  const daily = run(['take meds every day at 8am and 8pm']);
  assert.equal(daily.routines.length, 2);
  assert.equal(daily.items.filter((i) => i.date === '2026-09-24').length, 2);
});

test('every other week skips alternate weeks', () => {
  const { items, routines } = run(['piano every other wednesday at 4pm']);
  assert.equal(routines[0].interval, 2);
  assert.deepEqual(items.map((i) => i.date).sort(), ['2026-09-23', '2026-10-07']);
});
