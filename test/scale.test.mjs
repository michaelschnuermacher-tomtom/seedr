import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrated, stepUnit, levels, describeScale, scaleProblem, isSkill, scaleOf } from '../src/engine/scale.js';
import { createTournament, setSkills } from '../src/engine/tournament.js';
import { validateTournament } from '../src/engine/validate.js';
import { tournamentSummary } from '../src/engine/summary.js';

const low10 = { min: 1, max: 10, best: 'low' };

test('own skills map onto the calibrated 1–10 scale (1 = best)', () => {
  assert.equal(calibrated(1, low10), 1);
  assert.equal(calibrated(10, low10), 10);
  assert.equal(calibrated(5, { min: 1, max: 5, best: 'high' }), 1, 'the best on a 1–5 scale where higher is better');
  assert.equal(calibrated(1, { min: 1, max: 5, best: 'high' }), 10);
  assert.equal(calibrated(3, { min: 1, max: 5, best: 'low' }), 5.5);
  assert.equal(calibrated(100, { min: 0, max: 100, best: 'high' }), 1);
  assert.equal(calibrated(50, { min: 0, max: 100, best: 'high' }), 5.5);
  assert.equal(stepUnit({ min: 1, max: 5, best: 'low' }), 2.25);
  assert.equal(stepUnit(low10), 1);
});

test('levels are listed best first, and the scale is described in words', () => {
  assert.deepEqual(levels({ min: 1, max: 5, best: 'high' }), [5, 4, 3, 2, 1]);
  assert.equal(describeScale({ min: 1, max: 5, best: 'high' }), 'Skill 5 is the best, 1 the weakest.');
  assert.equal(describeScale(low10), 'Skill 1 is the best, 10 the weakest.');
  assert.deepEqual(scaleOf({}), low10, 'tournaments without a scale use 1–10, lower is better');
  assert.ok(isSkill(0, { min: 0, max: 100, best: 'low' }) && !isSkill(2.5, low10));
  assert.equal(scaleProblem({ min: 0, max: 100, best: 'high' }), null);
  assert.match(scaleProblem({ min: 3, max: 3, best: 'low' }), /lowest below the highest/);
  assert.match(scaleProblem({ min: 1, max: 5, best: 'up' }), /direction/);
});

test('a mirrored scale draws exactly the same schedule', () => {
  const skills = [1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10];
  const settings = { courts: 3, rounds: 6, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all' };
  const make = (scale, skill) => createTournament({ id: 't', name: 'x', seed: 5, now: new Date(),
    players: skills.map((s, i) => ({ name: `P${i + 1}`, skill: skill(s) })), settings: { ...settings, scale } });
  const low = make(low10, (s) => s);
  const high = make({ min: 1, max: 10, best: 'high' }, (s) => 11 - s);
  const wide = make({ min: 0, max: 90, best: 'low' }, (s) => (s - 1) * 10);
  assert.deepEqual(high.schedule, low.schedule);
  assert.deepEqual(wide.schedule, low.schedule);
  assert.equal(validateTournament(high).ok, true);
});

test('skills are checked against the tournament’s scale', () => {
  const scale = { min: 0, max: 100, best: 'high' };
  const t = createTournament({ id: 't', name: 'x', seed: 1, now: new Date(), settings: { courts: 1, rounds: 2, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all', scale },
    players: [80, 60, 40, 0].map((skill, i) => ({ name: `P${i + 1}`, skill })) });
  assert.equal(validateTournament(t).ok, true);
  assert.match(validateTournament({ ...t, settings: { ...t.settings, scale: { ...scale, max: 50 } } }).error, /Invalid skill/);
  assert.match(validateTournament({ ...t, settings: { ...t.settings, scale: { min: 1, max: 1, best: 'low' } } }).error, /skill range/);
  assert.equal(setSkills(t, { p1: 100 }).players[0].skill, 100);
  assert.throws(() => setSkills(t, { p1: 101 }), /from 0 to 100/);
});

test('the summary is the same on a mirrored scale, with the tournament’s own skill numbers', () => {
  const skills = [1, 1, 1, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9];
  const make = (scale, skill) => createTournament({ id: 't', name: 'x', seed: 4, now: new Date(),
    players: skills.map((s, i) => ({ name: `P${i + 1}`, skill: skill(s) })),
    settings: { courts: 2, rounds: 6, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all', scale } });
  const results = {};
  const low = make(low10, (s) => s);
  low.schedule.forEach((r, i) => r.matches.forEach((m) => { results[`${r.round}-${m.court}`] = ((i + m.court) % 2) + 1; }));
  const high = make({ min: 1, max: 10, best: 'high' }, (s) => 11 - s);
  const texts = (t) => tournamentSummary({ ...t, results }).map((x) => `${x.title}: ${x.text}`);
  const mirror = (text) => text.replace(/skills? (\d+)( and (\d+))?/g, (_, a, __, b) => (b ? `skills ${11 - a} and ${11 - b}` : `skill ${11 - a}`));
  assert.deepEqual(texts(high), texts(low).map(mirror));
});
