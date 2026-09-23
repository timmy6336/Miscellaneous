/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerToCommand, buildUserMessage, parseAnswer, rulesNeedHelp } from '../src/ai/prompt';
import { parseCommand } from '../src/parser';
import { EVAL_ITEMS, EVAL_NOW, EVAL_TODAY } from './ai-cases';

const base = {
  action: 'add', title: 'X', date: null, start: null, end: null, duration_min: null,
  after: null, before: null, repeat_days: [], every_other_week: false,
};
const cmd = (answer: object, note: string) => answerToCommand({ ...base, ...answer }, note, EVAL_NOW, EVAL_TODAY) as any;
const h = (hh: number, mm = 0) => hh * 60 + mm;

test('model answers become commands', () => {
  const c = cmd({ title: 'Work out', start: '17:30', end: '18:30', repeat_days: ['mon', 'tue', 'thu', 'fri'] },
    'I work out mon tue thursday fri from 530pm to 630pm');
  assert.equal(c.kind, 'add');
  assert.deepEqual([c.title, c.start, c.duration, c.repeat], ['Work out', h(17, 30), 60, [1, 2, 4, 5]]);

  const m = cmd({ action: 'move', title: 'Dentist', date: '2026-09-25', start: '16:00' }, 'push the dentist to friday at 4');
  assert.deepEqual([m.kind, m.query, m.date, m.start], ['move', 'Dentist', '2026-09-25', h(16)]);

  const w = cmd({ action: 'set_wake', title: '', start: '06:30' }, 'I get up around 6:30 these days');
  assert.deepEqual(w, { kind: 'setting', patch: { dayStart: h(6, 30) } });

  assert.equal(cmd({ after: '17:00' }, 'groceries after 5').earliest, h(17));
});

test('made-up times, days and repeats are dropped', () => {
  const c = cmd({ title: 'Groceries', start: '09:00', date: '2026-09-27', repeat_days: ['mon'] }, 'groceries');
  assert.deepEqual([c.start, c.date, c.repeat], [null, EVAL_TODAY, null]);
});

test('rule-based times win when the model gets them wrong', () => {
  const c = cmd({ title: 'Workout', start: '05:30' }, 'workout at 530pm');
  assert.equal(c.start, h(17, 30));
});

test('unusable answers return null', () => {
  assert.equal(answerToCommand(null, 'x', EVAL_NOW, EVAL_TODAY), null);
  assert.equal(cmd({ title: '' }, 'hmm'), null);
  assert.equal(parseAnswer('not json'), null);
  assert.deepEqual(parseAnswer('sure: {"a":1}'), { a: 1 });
});

test('the prompt includes the calendar and planned items', () => {
  const msg = buildUserMessage('move gym to 7pm', EVAL_ITEMS, EVAL_NOW, EVAL_TODAY);
  assert.match(msg, /Friday 2026-09-25/);
  assert.match(msg, /6:00 PM–7:00 PM: Gym/);
  assert.match(msg, /Note: move gym to 7pm$/);
});

test('the model is only asked when the rules left something unread', () => {
  const p = (s: string) => parseCommand(s, EVAL_NOW, EVAL_TODAY);
  assert.equal(rulesNeedHelp(p('groceries')), false);
  assert.equal(rulesNeedHelp(p('I work out mon tue Thursday fri from 530pm to 630pm')), false);
  assert.equal(rulesNeedHelp(p('gym at half past five')), true); // time in words
  assert.equal(rulesNeedHelp(p('swim at 5ish on the weekend')), true);
  assert.equal(rulesNeedHelp(p('yoga every 3rd day')), true);
});
