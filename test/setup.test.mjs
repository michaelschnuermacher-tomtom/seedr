import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, evaluateDraft, draftFromTournament } from '../src/ui/setup.js';
import { createTournament } from '../src/engine/tournament.js';

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const text18 = SKILLS_18.map((s, i) => `P${i + 1}: ${s}`).join('\n');
// The spec example: 3 courts, 120 minutes, 2-minute break.
const example = () => ({ ...newDraft(), courts: 3, totalMinutes: 120, breakMinutes: 2 });

test('defaults: 2 courts, 5-minute break, 240 minutes', () => {
  const d = newDraft();
  assert.deepEqual([d.courts, d.breakMinutes, d.totalMinutes], [2, 5, 240]);
});

test('a new draft is pre-filled with the regular 17 players', () => {
  const ev = evaluateDraft(newDraft());
  assert.equal(ev.players.length, 17);
  assert.deepEqual([ev.players[0].name, ev.players[0].skill], ['Jenny', 5]);
  assert.ok(!ev.problems.some((p) => /^Line/.test(p)));
});

test('rounds and match length must be chosen from the options', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18 });
  assert.equal(ev.players.length, 18);
  assert.ok(ev.options.length > 0);
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose rounds and match length/.test(p)));
});

test('a chosen option becomes the plan', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18, selectedRounds: 9 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 });
  assert.deepEqual(ev.games, { min: 6, max: 6, even: true });
});

test('an uneven option reports uneven games', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18, selectedRounds: 8 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 8, matchMinutes: 13 });
  assert.deepEqual(ev.games, { min: 5, max: 6, even: false });
});

test('a number of rounds that does not fit the total time is not accepted', () => {
  const ev = evaluateDraft({ ...example(), playersText: text18, selectedRounds: 30 });
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose rounds and match length/.test(p)));
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

test('draftFromTournament pre-fills the setup form with the current settings', () => {
  const t = createTournament({
    id: 't9', name: 'Tenerife Cup', seed: 5, now: new Date('2026-10-14T18:00:00Z'),
    players: SKILLS_18.map((skill, i) => ({ name: `P${i + 1}`, skill })),
    settings: { courts: 3, rounds: 9, matchMinutes: 11, breakMinutes: 2, revealBatch: 3 },
  });
  const d = draftFromTournament(t);
  assert.equal(d.editingId, 't9');
  assert.equal(d.name, 'Tenerife Cup');
  assert.equal(d.playersText.split('\n')[0], 'P1: 1');
  assert.deepEqual([d.courts, d.breakMinutes, d.revealBatch], [3, 2, 3]);
  const ev = evaluateDraft(d);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 }, 'the current option is selected');
});
