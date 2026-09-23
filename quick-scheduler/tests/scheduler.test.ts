/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/parser';
import { applyCommand, bringToToday, Ctx, findSlot, pushLater, reflow, setDone } from '../src/scheduler';
import { DEFAULT_SETTINGS, Item } from '../src/types';

const NOW = new Date(2026, 8, 23, 13, 10); // Wed 1:10 PM
const TODAY = '2026-09-23';
const h = (hh: number, mm = 0) => hh * 60 + mm;
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ now: NOW, settings: DEFAULT_SETTINGS, busy: {}, viewDate: TODAY, ...over });

function run(lines: string[], c = ctx(), items: Item[] = []) {
  let last;
  for (const line of lines) {
    last = applyCommand(parseCommand(line, c.now, c.viewDate), items, c);
    items = last.items;
  }
  return { items, last: last! };
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
