// Evaluation set for note understanding. Used by scripts/ai-eval.ts to score
// the on-device model (and the rule-based parser, as a baseline).
// "Now" is Wednesday 2026-09-23, 1:10 PM.

import { Item } from '../src/types';

export const EVAL_NOW = new Date(2026, 8, 23, 13, 10);
export const EVAL_TODAY = '2026-09-23';

const h = (hh: number, mm = 0) => hh * 60 + mm;
const item = (title: string, date: string, start: number | null, duration = 30, routineId?: string): Item => ({
  id: title + date,
  title,
  date,
  start,
  duration,
  fixed: start !== null,
  earliest: null,
  done: false,
  createdAt: 0,
  routineId,
});

/** The schedule the model sees for move/remove/done notes. */
export const EVAL_ITEMS: Item[] = [
  item('Gym', '2026-09-23', h(18), 60),
  item('Groceries', '2026-09-23', h(14, 30)),
  item('Dentist', '2026-09-25', h(15), 60),
  item('Call mom', '2026-09-24', h(17)),
  item('Work out', '2026-09-24', h(17, 30), 60, 'r1'),
  item('Laundry', '2026-09-23', null),
];

/** Only the listed fields are checked. Titles are compared loosely. */
export type Expect = {
  kind: 'add' | 'move' | 'remove' | 'done' | 'stopRepeat' | 'setting';
  title?: string;
  date?: string | null;
  start?: number | null;
  duration?: number | null;
  earliest?: number | null;
  latest?: number | null;
  repeat?: number[] | null;
  interval?: number;
  patch?: { dayStart?: number; dayEnd?: number };
};

export const CASES: { note: string; expect: Expect }[] = [
  // Plain adds
  { note: 'groceries', expect: { kind: 'add', title: 'Groceries', date: EVAL_TODAY, start: null, repeat: null } },
  { note: 'I need to call the bank', expect: { kind: 'add', title: 'Call the bank', start: null } },
  { note: 'remind me to water the plants', expect: { kind: 'add', title: 'Water the plants', start: null } },
  { note: 'pick up dry cleaning sometime today', expect: { kind: 'add', title: 'Pick up dry cleaning', date: EVAL_TODAY, start: null } },
  // Exact times
  { note: 'call mom at 5', expect: { kind: 'add', title: 'Call mom', start: h(17) } },
  { note: 'workout at 530pm', expect: { kind: 'add', title: 'Workout', start: h(17, 30) } },
  { note: 'dentist tomorrow at 10am for an hour', expect: { kind: 'add', title: 'Dentist', date: '2026-09-24', start: h(10), duration: 60 } },
  { note: 'dinner with Sam friday 7pm-9pm', expect: { kind: 'add', title: 'Dinner with Sam', date: '2026-09-25', start: h(19), duration: 120 } },
  { note: 'haircut on saturday at 11:30', expect: { kind: 'add', title: 'Haircut', date: '2026-09-26', start: h(11, 30) } },
  { note: 'meeting with the landlord at noon tomorrow', expect: { kind: 'add', title: 'Meeting with the landlord', date: '2026-09-24', start: h(12) } },
  { note: 'movie at 7:30 tonight', expect: { kind: 'add', title: 'Movie', date: EVAL_TODAY, start: h(19, 30) } },
  { note: 'lunch 1230-130pm', expect: { kind: 'add', title: 'Lunch', start: h(12, 30), duration: 60 } },
  { note: 'I have a doctors appointment at 4:15', expect: { kind: 'add', start: h(16, 15) } },
  { note: 'study 7-9', expect: { kind: 'add', title: 'Study', start: h(19), duration: 120 } },
  // Durations and windows
  { note: 'study for 2 hours', expect: { kind: 'add', title: 'Study', start: null, duration: 120 } },
  { note: 'groceries after 5pm', expect: { kind: 'add', title: 'Groceries', start: null, earliest: h(17) } },
  { note: 'pay bills before noon', expect: { kind: 'add', title: 'Pay bills', start: null, latest: h(12) } },
  { note: 'go for a run after work', expect: { kind: 'add', title: 'Go for a run', start: null, earliest: h(17) } },
  { note: 'read between 8 and 10pm', expect: { kind: 'add', title: 'Read', start: null, earliest: h(20), latest: h(22) } },
  { note: 'finish the report by 3 tomorrow', expect: { kind: 'add', title: 'Finish the report', date: '2026-09-24', latest: h(15) } },
  // Repeats
  {
    note: 'I work out mon tue Thursday fri from 530pm to 630pm',
    expect: { kind: 'add', title: 'Work out', start: h(17, 30), duration: 60, repeat: [1, 2, 4, 5] },
  },
  {
    note: 'on Monday Tuesday Thursday Friday I want to workout from 5-6pm every week',
    expect: { kind: 'add', title: 'Workout', start: h(17), duration: 60, repeat: [1, 2, 4, 5] },
  },
  { note: 'standup every weekday at 9:30am', expect: { kind: 'add', title: 'Standup', start: h(9, 30), repeat: [1, 2, 3, 4, 5] } },
  { note: 'yoga tuesdays and thursdays at 7pm', expect: { kind: 'add', title: 'Yoga', start: h(19), repeat: [2, 4] } },
  { note: 'take my vitamins every day at 8am', expect: { kind: 'add', start: h(8), repeat: [0, 1, 2, 3, 4, 5, 6] } },
  { note: 'call grandma every sunday', expect: { kind: 'add', title: 'Call grandma', start: null, repeat: [0] } },
  { note: 'piano lesson every other wednesday at 4pm', expect: { kind: 'add', title: 'Piano lesson', start: h(16), repeat: [3], interval: 2 } },
  { note: 'I go to the gym mon/wed/fri 6-7am', expect: { kind: 'add', start: h(6), duration: 60, repeat: [1, 3, 5] } },
  { note: 'meditate every morning', expect: { kind: 'add', title: 'Meditate', repeat: [0, 1, 2, 3, 4, 5, 6] } },
  // Changing existing things
  { note: 'move gym to 7pm', expect: { kind: 'move', title: 'Gym', start: h(19) } },
  { note: 'push the dentist to friday at 4', expect: { kind: 'move', title: 'Dentist', date: '2026-09-25', start: h(16) } },
  { note: 'reschedule calling mom to tomorrow at 6', expect: { kind: 'move', title: 'Call mom', date: '2026-09-24', start: h(18) } },
  { note: 'move groceries to after 5', expect: { kind: 'move', title: 'Groceries', start: null, earliest: h(17) } },
  { note: 'cancel the dentist', expect: { kind: 'remove', title: 'Dentist' } },
  { note: "I can't make it to the gym today", expect: { kind: 'remove', title: 'Gym' } },
  { note: 'done with groceries', expect: { kind: 'done', title: 'Groceries' } },
  { note: 'finished the laundry', expect: { kind: 'done', title: 'Laundry' } },
  { note: 'stop working out every week', expect: { kind: 'stopRepeat', title: 'Work out' } },
  { note: 'no more workouts', expect: { kind: 'stopRepeat', title: 'Work out' } },
  // Settings
  { note: 'I usually wake up at 630', expect: { kind: 'setting', patch: { dayStart: h(6, 30) } } },
  { note: 'I go to bed around 11pm', expect: { kind: 'setting', patch: { dayEnd: h(23) } } },
];
