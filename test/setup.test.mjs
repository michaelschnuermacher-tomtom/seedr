import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, evaluateDraft, draftFromTournament, skillOrder, defaultPeople } from '../src/ui/setup.js';
import { createTournament } from '../src/engine/tournament.js';

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const people18 = SKILLS_18.map((_, i) => ({ id: `x${i + 1}`, name: `P${i + 1}` }));
// The spec example: 3 courts, 120 minutes, 2-minute break, skills 1–10 (lower is better).
const example = () => ({
  ...newDraft(), name: 'Club night', scaleMin: 1, scaleMax: 10, best: 'low', scoring: 'wins',
  picks: people18.map((p, i) => ({ personId: p.id, skill: SKILLS_18[i] })),
  courts: 3, totalMinutes: 120, breakMinutes: 2,
});

test('a new draft has no skills, no players and no scale; courts and time have defaults', () => {
  const d = newDraft();
  assert.deepEqual([d.courts, d.breakMinutes, d.totalMinutes], [2, 5, 240]);
  assert.deepEqual([d.scaleMin, d.scaleMax, d.best, d.picks], [null, null, null, []]);
  assert.ok(defaultPeople().every((p) => !('skill' in p) && !('lastSkill' in p)), 'the default people have no skills');
});

test('the steps are done one after the other', () => {
  const steps = (d) => evaluateDraft(d, people18).steps;
  assert.deepEqual(steps(newDraft()), { name: false, scale: false, scoring: false, players: false, skills: false, courts: true, time: false, plan: false });
  const d = { ...newDraft(), name: 'x' };
  assert.equal(steps(d).scale, false);
  Object.assign(d, { scaleMin: 1, scaleMax: 5 });
  assert.equal(steps(d).scale, false, 'the direction is still missing');
  d.best = 'high';
  assert.equal(steps(d).scale, true);
  d.scoring = 'americano';
  assert.equal(steps(d).scoring, false, 'Americano needs the points per match');
  d.americanoPoints = 24;
  assert.equal(steps(d).scoring, true);
  d.picks = [{ personId: 'x1', skill: null }];
  assert.deepEqual([steps(d).players, steps(d).skills], [true, false], 'skills can be set from the first player on');
  d.picks = people18.slice(0, 3).map((p) => ({ personId: p.id, skill: 2 }));
  assert.equal(steps(d).skills, false, 'going on needs at least 4 players');
  d.picks.push({ personId: 'x4', skill: null });
  assert.equal(steps(d).skills, false, 'every player needs a skill');
  assert.ok(evaluateDraft(d, people18).problems.includes('Give every player a skill.'));
  d.picks[3].skill = 5;
  assert.deepEqual(steps(d), { name: true, scale: true, scoring: true, players: true, skills: true, courts: true, time: true, plan: false });
  assert.deepEqual(evaluateDraft(d, people18).scoring, { mode: 'americano', points: 24 });
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

test('skills outside a changed range count as not set', () => {
  const ev = evaluateDraft({ ...example(), scaleMax: 5 }, people18);
  assert.equal(ev.players.length, SKILLS_18.filter((s) => s <= 5).length);
  assert.equal(ev.steps.skills, false);
});

test('players with a skill are sorted by it, best first; the others follow', () => {
  const picks = [{ personId: 'a', skill: null }, { personId: 'b', skill: 3 }, { personId: 'c', skill: 5 }, { personId: 'd', skill: null }, { personId: 'e', skill: 1 }];
  assert.deepEqual(skillOrder(picks, { min: 1, max: 5, best: 'high' }).map((p) => p.personId), ['c', 'b', 'e', 'a', 'd']);
  assert.deepEqual(skillOrder(picks, { min: 1, max: 5, best: 'low' }).map((p) => p.personId), ['e', 'b', 'c', 'a', 'd']);
});

test('draftFromTournament fills in every step', () => {
  const t = createTournament({
    id: 't9', name: 'Tenerife Cup', seed: 5, now: new Date('2026-10-14T18:00:00Z'),
    players: people18.map((p, i) => ({ personId: p.id, name: p.name, skill: SKILLS_18[i] })),
    settings: { courts: 3, rounds: 9, matchMinutes: 11, breakMinutes: 2, revealBatch: 3, scale: { min: 1, max: 10, best: 'low' } },
  });
  const d = draftFromTournament(t);
  assert.deepEqual([d.editingId, d.name, d.scaleMin, d.scaleMax, d.best, d.picks.length], ['t9', 'Tenerife Cup', 1, 10, 'low', 18]);
  assert.deepEqual([d.courts, d.breakMinutes, d.scoring], [3, 2, 'wins']);
  const ev = evaluateDraft(d, people18);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 }, 'the current option is selected');
});

test('choosing an option with fewer courts in the last round keeps them in the plan', () => {
  const skills17 = [5, 9, 8, 6, 1, 9, 4, 6, 5, 7, 1, 4, 6, 3, 1, 3, 4];
  const people17 = skills17.map((_, i) => ({ id: `y${i}`, name: `P${i + 1}` }));
  const d = { ...newDraft(), name: 'x', scaleMin: 1, scaleMax: 10, best: 'low', scoring: 'wins',
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

test('the scoring step: wins, scores required, or Americano with points per match', () => {
  const scoring = (d) => evaluateDraft({ ...example(), selectedRounds: 9, ...d }, people18).scoring;
  assert.equal(scoring({ scoring: 'wins' }), null, 'wins with optional scores need no settings');
  assert.deepEqual(scoring({ scoring: 'sets' }), { mode: 'sets' });
  assert.deepEqual(scoring({ scoring: 'americano', americanoPoints: 21 }), { mode: 'americano', points: 21 });
  assert.equal(evaluateDraft({ ...example(), scoring: 'americano' }, people18).steps.scoring, false, 'Americano needs the points');
});
