import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, evaluateDraft } from '../src/ui/setup.js';

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const text18 = SKILLS_18.map((s, i) => `P${i + 1}: ${s}`).join('\n');
// The spec example: 3 courts, 120 minutes, 2-minute break.
const example = () => ({ ...newDraft(), courts: 3, totalMinutes: 120, breakMinutes: 2 });

test('defaults: 2 courts, 5-minute break, 240 minutes', () => {
  const d = newDraft();
  assert.deepEqual([d.courts, d.breakMinutes, d.totalMinutes], [2, 5, 240]);
});

test('recommended planning requires choosing an option', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18 });
  assert.equal(ev.players.length, 18);
  assert.ok(ev.options.length > 0);
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose one of the options/.test(p)));
});

test('a chosen option becomes the plan', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18, selectedRounds: 9 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 });
  assert.deepEqual(ev.games, { min: 6, max: 6, even: true });
});

test('manual planning reports uneven games', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18, planning: 'manual', rounds: 8, matchMinutes: 13 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.games, { min: 5, max: 6, even: false });
});

test('problems: too few players, invalid courts, parse errors', () => {
  assert.ok(evaluateDraft({ ...example(), playersText: 'A: 1\nB: 2\nC: 3' }).problems.some((p) => /at least 4 players/.test(p)));
  assert.ok(evaluateDraft({ ...example(), playersText: text18, courts: NaN }).problems.some((p) => /Courts/.test(p)));
  assert.ok(evaluateDraft({ ...example(), playersText: `${text18}\nBroken` }).problems.some((p) => /^Line 19/.test(p)));
});

test('not enough time for one round', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18, totalMinutes: 6 });
  assert.ok(ev.problems.some((p) => /Not enough time/.test(p)));
});
