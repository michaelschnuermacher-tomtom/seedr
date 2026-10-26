import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, evaluateDraft, draftFromTournament, shownLevels, defaultPeople } from '../src/ui/setup.js';
import { createTournament } from '../src/engine/tournament.js';

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const people18 = SKILLS_18.map((_, i) => ({ id: `x${i + 1}`, name: `P${i + 1}` }));
// The spec example: 3 courts, 120 minutes, 2-minute break, skills 1–10 (lower is better).
const example = () => ({
  ...newDraft(), name: 'Club night', scaleMin: 1, scaleMax: 10, best: 'low',
  picks: people18.map((p, i) => ({ personId: p.id, skill: SKILLS_18[i] })),
  courts: 3, totalMinutes: 120, breakMinutes: 2, revealBatch: 'all',
});

test('a new draft has no skills, no players and no scale; courts and time have defaults', () => {
  const d = newDraft();
  assert.deepEqual([d.courts, d.breakMinutes, d.totalMinutes], [2, 5, 240]);
  assert.deepEqual([d.scaleMin, d.scaleMax, d.best, d.picks, d.revealBatch], [null, null, null, [], null]);
  assert.ok(defaultPeople().every((p) => !('skill' in p) && !('lastSkill' in p)), 'the default people have no skills');
});

test('the steps are done one after the other', () => {
  const steps = (d) => evaluateDraft(d, people18).steps;
  assert.deepEqual(steps(newDraft()), { name: false, scale: false, players: false, courts: true, time: false, plan: false, reveal: false });
  const d = { ...newDraft(), name: 'x' };
  assert.equal(steps(d).scale, false);
  Object.assign(d, { scaleMin: 1, scaleMax: 5 });
  assert.equal(steps(d).scale, false, 'the direction is still missing');
  d.best = 'high';
  assert.equal(steps(d).scale, true);
  d.picks = people18.slice(0, 3).map((p) => ({ personId: p.id, skill: 2 }));
  assert.equal(steps(d).players, false, 'at least 4 players');
  d.picks.push({ personId: 'x4', skill: 5 });
  assert.deepEqual(steps(d), { name: true, scale: true, players: true, courts: true, time: true, plan: false, reveal: false });
});

test('the skill range can be anything from 0 to 100, lowest below highest', () => {
  const problem = (min, max) => evaluateDraft({ ...newDraft(), scaleMin: min, scaleMax: max, best: 'low' }).problems.find((p) => /skill/i.test(p));
  assert.equal(problem(0, 100), undefined);
  assert.equal(problem(1, 5), undefined);
  assert.match(problem(5, 5), /lowest below the highest/);
  assert.match(problem(-1, 10), /from 0 to 100/);
  assert.match(problem(1, 101), /from 0 to 100/);
});

test('rounds and match length must be chosen from the options', () => {
  const ev = evaluateDraft(example(), people18);
  assert.equal(ev.players.length, 18);
  assert.ok(ev.options.length > 0);
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose rounds and match length/.test(p)));
});

test('a chosen option becomes the plan', () => {
  const ev = evaluateDraft({ ...example(), selectedRounds: 9 }, people18);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 });
  assert.deepEqual(ev.games, { min: 6, max: 6, even: true });
  assert.deepEqual(ev.scale, { min: 1, max: 10, best: 'low' });
});

test('an uneven option reports uneven games', () => {
  const ev = evaluateDraft({ ...example(), selectedRounds: 8 }, people18);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 8, matchMinutes: 13 });
  assert.deepEqual(ev.games, { min: 5, max: 6, even: false });
});

test('problems: no name, too few players, invalid courts, not enough time', () => {
  assert.ok(evaluateDraft({ ...example(), name: ' ' }, people18).problems.some((p) => /name/.test(p)));
  assert.ok(evaluateDraft({ ...example(), picks: example().picks.slice(0, 3) }, people18).problems.some((p) => /at least 4 players/.test(p)));
  assert.ok(evaluateDraft({ ...example(), courts: NaN }, people18).problems.some((p) => /Courts/.test(p)));
  assert.ok(evaluateDraft({ ...example(), totalMinutes: 6 }, people18).problems.some((p) => /Not enough time/.test(p)));
});

test('the players carry their person, name and year of birth into the tournament', () => {
  const people = people18.map((p, i) => (i === 0 ? { ...p, birthYear: 1980 } : p));
  const ev = evaluateDraft({ ...example(), selectedRounds: 9 }, people);
  assert.deepEqual(ev.players[0], { personId: 'x1', name: 'P1', skill: 1, birthYear: 1980 });
});

test('picks outside a changed range are left out', () => {
  const d = { ...example(), scaleMax: 5 };
  assert.equal(evaluateDraft(d, people18).players.length, SKILLS_18.filter((s) => s <= 5).length);
});

test('small scales show every level, large ones only the levels in use or added', () => {
  const d = { ...newDraft(), picks: [{ personId: 'a', skill: 70 }], extraLevels: [40] };
  assert.deepEqual(shownLevels(d, { min: 1, max: 10, best: 'low' }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(shownLevels(d, { min: 1, max: 5, best: 'high' }), [5, 4, 3, 2, 1], 'best first');
  assert.deepEqual(shownLevels(d, { min: 0, max: 100, best: 'high' }), [70, 40]);
});

test('draftFromTournament fills in every step', () => {
  const t = createTournament({
    id: 't9', name: 'Tenerife Cup', seed: 5, now: new Date('2026-10-14T18:00:00Z'),
    players: people18.map((p, i) => ({ personId: p.id, name: p.name, skill: SKILLS_18[i] })),
    settings: { courts: 3, rounds: 9, matchMinutes: 11, breakMinutes: 2, revealBatch: 3, scale: { min: 1, max: 10, best: 'low' } },
  });
  const d = draftFromTournament(t);
  assert.deepEqual([d.editingId, d.name, d.scaleMin, d.scaleMax, d.best, d.picks.length], ['t9', 'Tenerife Cup', 1, 10, 'low', 18]);
  assert.deepEqual([d.courts, d.breakMinutes, d.revealBatch], [3, 2, 3]);
  const ev = evaluateDraft(d, people18);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 }, 'the current option is selected');
});

test('choosing an option with fewer courts in the last round keeps them in the plan', () => {
  const skills17 = [5, 9, 8, 6, 1, 9, 4, 6, 5, 7, 1, 4, 6, 3, 1, 3, 4];
  const people17 = skills17.map((_, i) => ({ id: `y${i}`, name: `P${i + 1}` }));
  const d = { ...newDraft(), name: 'x', scaleMin: 1, scaleMax: 10, best: 'low', revealBatch: 'all',
    picks: people17.map((p, i) => ({ personId: p.id, skill: skills17[i] })), selectedRounds: 9, lastRoundCourts: 1 };
  const ev = evaluateDraft(d, people17);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 21, lastRoundCourts: 1 });
  assert.deepEqual(ev.games, { min: 4, max: 4, even: true });
  const t = createTournament({ id: 't', name: 'x', seed: 1, now: new Date(), players: ev.players,
    settings: { courts: 2, rounds: 9, matchMinutes: 21, breakMinutes: 5, revealBatch: 'all', lastRoundCourts: 1, scale: ev.scale } });
  assert.equal(draftFromTournament(t).lastRoundCourts, 1);
  assert.deepEqual(evaluateDraft(draftFromTournament(t), people17).plan, { rounds: 9, matchMinutes: 21, lastRoundCourts: 1 });
});
