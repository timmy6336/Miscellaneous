/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerToCommand, buildMessages, parseAnswer, rulesNeedHelp } from '../src/ai/prompt';
import { parseCommand } from '../src/parser';
import { EVAL_ITEMS, EVAL_NOW, EVAL_TODAY } from './ai-cases';

const base = {
  action: 'add', title: 'X', day: null, start: null, end: null, after: null, before: null,
  duration: null, repeat: [], every_other_week: false,
};
const cmd = (answer: object, note: string) => answerToCommand({ ...base, ...answer }, note, EVAL_NOW, EVAL_TODAY) as any;
const h = (hh: number, mm = 0) => hh * 60 + mm;

test('copied phrases become times, days and repeats', () => {
  const c = cmd({ title: 'Work out', start: '530pm', end: '630pm', repeat: ['monday', 'tuesday', 'thursday', 'friday'] },
    'I work out mon tue thursday fri from 530pm to 630pm');
  assert.equal(c.kind, 'add');
  assert.deepEqual([c.title, c.start, c.duration, c.repeat], ['Work out', h(17, 30), 60, [1, 2, 4, 5]]);

  const m = cmd({ action: 'move', title: 'Dentist', day: 'friday', start: '4' }, 'push the dentist to friday at 4');
  assert.deepEqual([m.kind, m.query, m.date, m.start], ['move', 'Dentist', '2026-09-25', h(16)]);

  const w = cmd({ action: 'set_wake', title: 'Wake up', start: 'half past six' }, 'these days I get up at half past six');
  assert.deepEqual(w, { kind: 'setting', patch: { dayStart: h(6, 30) } });

  const g = cmd({ title: 'Groceries', after: '5' }, 'groceries sometime after 5');
  assert.equal(g.earliest, h(17));
  assert.equal(cmd({ title: 'Study', duration: '2 hours' }, 'study for like 2 hours').duration, 120);
  assert.deepEqual(cmd({ title: 'Standup', start: '9:30', repeat: ['weekdays'] }, 'standup weekdays 9:30').repeat, [1, 2, 3, 4, 5]);
});

test('anything not in the note is dropped', () => {
  const c = cmd({ title: 'Groceries', start: '09:00', day: 'saturday', repeat: ['monday'], after: '5pm' }, 'groceries');
  assert.deepEqual([c.start, c.date, c.repeat, c.earliest], [null, EVAL_TODAY, null, null]);
  // One day without "every" is a one-off.
  const one = cmd({ title: 'Haircut', day: 'saturday', repeat: ['saturday'] }, 'haircut saturday');
  assert.deepEqual([one.date, one.repeat], ['2026-09-26', null]);
});

test('rule-based times win when the model gets them wrong', () => {
  assert.equal(cmd({ title: 'Workout', start: '5' }, 'workout at 530pm').start, h(17, 30));
});

test('unusable answers return null', () => {
  assert.equal(answerToCommand(null, 'x', EVAL_NOW, EVAL_TODAY), null);
  assert.equal(cmd({ title: '' }, 'hmm'), null);
  assert.equal(cmd({ action: 'dance' }, 'hmm'), null);
  assert.equal(parseAnswer('not json'), null);
  assert.deepEqual(parseAnswer('sure: {"a":1}'), { a: 1 });
});

test('the prompt has cached examples first and the note last', () => {
  const msgs = buildMessages('move gym to 7pm', EVAL_ITEMS, EVAL_NOW);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].content, buildMessages('something else', [], EVAL_NOW)[1].content);
  const last = msgs[msgs.length - 1].content;
  assert.match(last, /Plans: Groceries \(today\), Gym \(today\), Laundry \(today\), Call mom \(tomorrow\), Work out \(repeats\), Dentist \(friday\)/);
  assert.match(last, /Note: move gym to 7pm$/);
  for (const m of msgs.filter((x) => x.role === 'assistant')) assert.ok(parseAnswer(m.content));
});

test('the model is only asked when the rules left something unread', () => {
  const p = (s: string) => parseCommand(s, EVAL_NOW, EVAL_TODAY);
  assert.equal(rulesNeedHelp(p('groceries')), false);
  assert.equal(rulesNeedHelp(p('I work out mon tue Thursday fri from 530pm to 630pm')), false);
  assert.equal(rulesNeedHelp(p('gym at half past five')), false); // the rules read this now
  assert.equal(rulesNeedHelp(p('call the plumber first thing tomorrow')), true);
  assert.equal(rulesNeedHelp(p('yoga every 3rd day')), true);
});

test('whatever the rules read wins, field by field', () => {
  // The model reads "after 5pm" as a start time; the rules know it's a window.
  const g = cmd({ title: 'Groceries', start: '5pm' }, 'groceries after 5pm');
  assert.deepEqual([g.start, g.earliest], [null, h(17)]);
  const r = cmd({ title: 'Call grandma' }, 'call grandma every sunday');
  assert.deepEqual(r.repeat, [0]);
  const p = cmd({ title: 'Piano lesson', start: '4pm' }, 'piano lesson every other wednesday at 4pm');
  assert.deepEqual([p.repeat, p.interval], [[3], 2]);
  // The model still supplies what the rules can't read.
  const c = cmd({ title: 'Coffee with Jess', day: 'thursday' }, 'coffee w/ jess thurs arvo');
  assert.deepEqual([c.title, c.date], ['Coffee with Jess', '2026-09-24']);
});

test('cancelling "every week" or "no more" ends the repeat', () => {
  assert.equal(cmd({ action: 'remove', title: 'Work out' }, 'stop working out every week').kind, 'stopRepeat');
  assert.equal(cmd({ action: 'remove', title: 'Work out' }, 'no more workouts').kind, 'stopRepeat');
  assert.equal(cmd({ action: 'remove', title: 'Gym' }, "I can't make it to the gym today").kind, 'remove');
});
