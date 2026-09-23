/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, parseCommand } from '../src/parser';

// Wednesday, Sep 23 2026, 1:10 PM local time.
const NOW = new Date(2026, 8, 23, 13, 10);
const TODAY = '2026-09-23';
const p = (s: string, view = TODAY) => parseCommand(s, NOW, view);
const h = (hh: number, mm = 0) => hh * 60 + mm;

function add(s: string) {
  const c = p(s);
  assert.equal(c.kind, 'add', `expected add for "${s}", got ${c.kind}`);
  return c as Extract<typeof c, { kind: 'add' }>;
}

test('plain task goes to the viewed day with no time', () => {
  assert.deepEqual(add('buy groceries'), {
    kind: 'add', title: 'Buy groceries', date: TODAY, start: null, duration: null, earliest: null,
    latest: null, repeat: null, alsoOn: [],
  });
  assert.equal((p('water plants', '2026-09-25') as any).date, '2026-09-25');
});

test('filler words are stripped from titles', () => {
  assert.equal(add('I need to call the bank').title, 'Call the bank');
  assert.equal(add('remind me to take out the trash').title, 'Take out the trash');
  assert.equal(add("i want to go for a run at 6pm").title, 'Go for a run');
  assert.equal(cleanTitle('  pls  email Sam , '), 'Email Sam');
});

test('explicit times', () => {
  assert.equal(add('call mom at 3pm').start, h(15));
  assert.equal(add('call mom at 3:45 pm').start, h(15, 45));
  assert.equal(add('standup 9:30am').start, h(9, 30));
  assert.equal(add('dinner @ 7p.m.').start, h(19));
  assert.equal(add('lunch at noon').start, h(12));
  assert.equal(add('meeting at 16:30').start, h(16, 30));
  assert.equal(add('pick up kids at 5 o\'clock').start, h(17));
  assert.equal(add('call mom at 3pm').title, 'Call mom');
});

test('ambiguous hours pick the sensible half of the day', () => {
  assert.equal(add('call at 3').start, h(15)); // small numbers are PM
  assert.equal(add('call at 11').start, h(23)); // 11am already passed today (it's 1:10pm)
  assert.equal(add('call tomorrow at 11').start, h(11)); // tomorrow, 11am is fine
  assert.equal(add('gym at 8 tonight').start, h(20));
  assert.equal(add('run tomorrow morning at 7').start, h(7));
});

test('days', () => {
  assert.equal(add('dentist tomorrow at 2pm').date, '2026-09-24');
  assert.equal(add('dentist tmrw').date, '2026-09-24');
  assert.equal(add('dentist day after tomorrow').date, '2026-09-25');
  assert.equal(add('haircut on friday').date, '2026-09-25');
  assert.equal(add('haircut friday 10am').title, 'Haircut');
  assert.equal(add('team sync wednesday').date, TODAY);
  assert.equal(add('team sync next wednesday').date, '2026-09-30');
  assert.equal(add('brunch on sat').date, '2026-09-26');
  assert.equal(add('read tonight').date, TODAY);
});

test('durations and ranges', () => {
  assert.equal(add('study for 2 hours').duration, 120);
  assert.equal(add('nap for half an hour').duration, 30);
  assert.equal(add('walk for an hour').duration, 60);
  assert.equal(add('30 min walk').duration, 30);
  assert.equal(add('30 min walk').title, 'Walk');
  assert.equal(add('focus time 1.5h').duration, 90);
  const r = add('workshop 3-4:30pm');
  assert.equal(r.start, h(15));
  assert.equal(r.duration, 90);
  const r2 = add('brunch 11-1pm');
  assert.equal(r2.start, h(11));
  assert.equal(r2.duration, 120);
  assert.equal(add('meeting from 2 to 3').duration, 60);
});

test('relative times and parts of day', () => {
  const r = add('check the oven in 20 minutes');
  assert.equal(r.start, h(13, 30));
  assert.equal(r.title, 'Check the oven');
  assert.equal(add('stretch in an hour').start, h(14, 10));
  const e = add('call grandma this evening');
  assert.equal(e.start, null);
  assert.equal(e.earliest, h(17));
  assert.equal(add('laundry tomorrow afternoon').earliest, h(12));
  assert.equal(add('email Sam later').earliest, h(14, 10));
});

test('numbers that are not times stay in the title', () => {
  assert.equal(add('read 20 pages').title, 'Read 20 pages');
  assert.equal(add('buy 2 lemons').start, null);
  assert.equal(add('meet at 5th street cafe').start, null);
});

test('move commands', () => {
  const m = p('move gym to 6pm');
  assert.equal(m.kind, 'move');
  assert.equal((m as any).query, 'Gym');
  assert.equal((m as any).start, h(18));

  const t = p('reschedule dentist to tomorrow') as any;
  assert.equal(t.query, 'Dentist');
  assert.equal(t.date, '2026-09-24');
  assert.equal(t.start, null);

  const s = p('push laundry back 30 min') as any;
  assert.equal(s.query, 'Laundry');
  assert.equal(s.shift, 30);

  assert.equal((p('move call earlier by an hour') as any).shift, -60);
  const l = p('postpone groceries') as any;
  assert.equal(l.later, false);
  assert.equal(l.shift, null);
  assert.equal((p('push groceries later') as any).later, true);
});

test('remove and done commands', () => {
  assert.deepEqual(
    { ...(p('cancel the dentist') as any), fallback: undefined },
    { kind: 'remove', query: 'Dentist', date: null, fallback: undefined },
  );
  assert.equal((p('delete gym tomorrow') as any).date, '2026-09-24');
  assert.equal(p('done laundry').kind, 'done');
  assert.equal((p('finished the report') as any).query, 'Report');
  assert.equal((p('laundry is done') as any).query, 'Laundry');
  assert.equal(p('').kind, 'none');
  assert.equal(p('at 3pm').kind, 'none');
});

test('time windows: after / before / between', () => {
  const a = add('groceries after 5pm');
  assert.equal(a.title, 'Groceries');
  assert.equal(a.start, null);
  assert.equal(a.earliest, h(17));
  assert.equal(add('groceries after 5').earliest, h(17));
  assert.equal(add('call the bank before noon').latest, h(12));
  assert.equal(add('pay bills by 3').latest, h(15));
  const b = add('study between 2 and 4pm');
  assert.equal(b.earliest, h(14));
  assert.equal(b.latest, h(16));
  assert.equal(b.title, 'Study');
  assert.equal(add('run after work').earliest, h(17));
  assert.equal(add('email Sam before lunch').latest, h(12));
  const c = add('laundry after 5 before 8');
  assert.equal(c.earliest, h(17));
  assert.equal(c.latest, h(20));
  // An exact time wins over a window.
  assert.equal(add('gym at 6pm after work').start, h(18));
});

test('repeating items', () => {
  const w = add('on Monday Tuesday Thursday Friday I want to workout from 5-6pm every week');
  assert.equal(w.title, 'Workout');
  assert.deepEqual(w.repeat, [1, 2, 4, 5]);
  assert.equal(w.start, h(17));
  assert.equal(w.duration, 60);

  assert.deepEqual(add('standup weekdays at 9:30am').repeat, [1, 2, 3, 4, 5]);
  assert.deepEqual(add('yoga tuesdays at 7pm').repeat, [2]);
  assert.deepEqual(add('call grandma every sunday').repeat, [0]);
  assert.deepEqual(add('mon, wed and fri gym at 6pm every week').repeat, [1, 3, 5]);
  assert.deepEqual(add('team call every week at 3pm').repeat, [3]); // today is Wednesday
  assert.equal(add('stretch every day at 9').start, h(9)); // not bumped to PM for repeats
  const m = add('meditate every morning');
  assert.deepEqual(m.repeat, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(m.earliest, h(8));
  assert.equal(m.title, 'Meditate');
  assert.deepEqual(add('read daily after 9pm').repeat, [0, 1, 2, 3, 4, 5, 6]);
});

test('day lists without "every" are one-offs', () => {
  const b = add('brunch sat and sun');
  assert.equal(b.repeat, null);
  assert.equal(b.date, '2026-09-26');
  assert.deepEqual(b.alsoOn, ['2026-09-27']);
  assert.equal(add('cleaning monday').date, '2026-09-28');
  assert.equal(add('cleaning monday').repeat, null);
  assert.equal(add('c\'mon get the mail').title, "C'mon get the mail");
});

test('wake-up and bedtime', () => {
  const s = (x: string) => (p(x) as any).patch;
  assert.deepEqual(s('I wake up at 6:30'), { dayStart: h(6, 30) });
  assert.deepEqual(s('wake up at 7am'), { dayStart: h(7) });
  assert.deepEqual(s('set wake time to 8'), { dayStart: h(8) });
  assert.deepEqual(s('bedtime 11pm'), { dayEnd: h(23) });
  assert.deepEqual(s('I usually go to bed at 10:30'), { dayEnd: h(22, 30) });
  assert.deepEqual(s('sleep at midnight'), { dayEnd: 1440 });
});

test('stopping repeating items', () => {
  const st = p('stop workout') as any;
  assert.equal(st.kind, 'stopRepeat');
  assert.equal(st.query, 'Workout');
  assert.equal((p('cancel yoga every week') as any).kind, 'stopRepeat');
  assert.equal((p('delete all the standups') as any).query, 'Standups');
  assert.equal(p('cancel yoga').kind, 'remove');
  const fb = (p('stop by the bank at 3pm') as any).fallback;
  assert.equal(fb.title, 'Stop by the bank');
  assert.equal(fb.start, h(15));
});
