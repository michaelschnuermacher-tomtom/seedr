import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, evaluateDraft, draftFromTournament, syncRows } from '../src/ui/setup.js';
import { createTournament } from '../src/engine/tournament.js';

const SKILLS_18 = [1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 8, 8, 9, 10];
const people18 = SKILLS_18.map((skill, i) => ({ id: `x${i + 1}`, name: `P${i + 1}`, lastSkill: skill }));
// The spec example: 3 courts, 120 minutes, 2-minute break.
const example = () => ({ ...newDraft(people18), courts: 3, totalMinutes: 120, breakMinutes: 2 });

test('defaults: 2 courts, 5-minute break, 240 minutes', () => {
  const d = newDraft();
  assert.deepEqual([d.courts, d.breakMinutes, d.totalMinutes], [2, 5, 240]);
});

test('without people yet, the regular 17 players are ticked with their skills', () => {
  const ev = evaluateDraft(newDraft());
  assert.equal(ev.players.length, 17);
  const markus = ev.players.find((p) => p.name === 'Markus');
  assert.equal(markus.skill, 1);
  assert.ok(markus.personId);
});

test('a new tournament ticks the players of the most recent one, with their skill there', () => {
  const recent = createTournament({ id: 't', name: 'x', seed: 1, now: new Date(),
    players: people18.slice(0, 8).map((p) => ({ personId: p.id, name: p.name, skill: 3 })),
    settings: { courts: 2, rounds: 3, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all' } });
  const d = newDraft(people18, recent);
  assert.equal(d.rows.length, 18, 'everyone is listed');
  assert.deepEqual(d.rows.filter((r) => r.selected).map((r) => [r.name, r.skill]), people18.slice(0, 8).map((p) => [p.name, 3]));
  assert.equal(d.rows.find((r) => r.name === 'P18').skill, 10, 'not ticked: the last skill is suggested');
});

test('rounds and match length must be chosen from the options', () => {
  const ev = evaluateDraft(example());
  assert.equal(ev.players.length, 18);
  assert.ok(ev.options.length > 0);
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose rounds and match length/.test(p)));
});

test('a chosen option becomes the plan', () => {
  const ev = evaluateDraft({ ...example(), selectedRounds: 9 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 });
  assert.deepEqual(ev.games, { min: 6, max: 6, even: true });
});

test('an uneven option reports uneven games', () => {
  const ev = evaluateDraft({ ...example(), selectedRounds: 8 });
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 8, matchMinutes: 13 });
  assert.deepEqual(ev.games, { min: 5, max: 6, even: false });
});

test('a number of rounds that does not fit the total time is not accepted', () => {
  const ev = evaluateDraft({ ...example(), selectedRounds: 30 });
  assert.equal(ev.plan, null);
  assert.ok(ev.problems.some((p) => /Choose rounds and match length/.test(p)));
});

test('problems: too few players ticked, invalid courts', () => {
  const few = example();
  few.rows.forEach((r, i) => { r.selected = i < 3; });
  assert.ok(evaluateDraft(few).problems.some((p) => /at least 4 players/.test(p)));
  assert.ok(evaluateDraft({ ...example(), courts: NaN }).problems.some((p) => /Courts/.test(p)));
});

test('not enough time for one round', () => {
  const ev = evaluateDraft({ ...example(), totalMinutes: 6 });
  assert.ok(ev.problems.some((p) => /Not enough time/.test(p)));
});

test('the players carry their person and year of birth into the tournament', () => {
  const people = people18.map((p, i) => (i === 0 ? { ...p, birthYear: 1980 } : p));
  const ev = evaluateDraft({ ...newDraft(people), courts: 3, totalMinutes: 120, breakMinutes: 2, selectedRounds: 9 });
  assert.deepEqual(ev.players[0], { personId: 'x1', name: 'P1', skill: 1, birthYear: 1980 });
});

test('draftFromTournament ticks the tournament players with their skills', () => {
  const t = createTournament({
    id: 't9', name: 'Tenerife Cup', seed: 5, now: new Date('2026-10-14T18:00:00Z'),
    players: people18.map((p) => ({ personId: p.id, name: p.name, skill: p.lastSkill })),
    settings: { courts: 3, rounds: 9, matchMinutes: 11, breakMinutes: 2, revealBatch: 3 },
  });
  const d = draftFromTournament(t, [...people18, { id: 'new', name: 'Zoe', lastSkill: 4 }]);
  assert.equal(d.editingId, 't9');
  assert.equal(d.name, 'Tenerife Cup');
  assert.equal(d.rows.filter((r) => r.selected).length, 18);
  assert.equal(d.rows.find((r) => r.name === 'Zoe').selected, false);
  assert.deepEqual([d.courts, d.breakMinutes, d.revealBatch], [3, 2, 3]);
  const ev = evaluateDraft(d);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 11 }, 'the current option is selected');
});

test('syncRows follows renamed, added and deleted people', () => {
  const d = newDraft(people18.slice(0, 4));
  d.rows[0].selected = false;
  d.rows[1].skill = 9;
  syncRows(d, [{ ...people18[0], name: 'Anna' }, people18[1], people18[2], { id: 'new', name: 'Zoe', lastSkill: 4 }]);
  assert.deepEqual(d.rows.map((r) => [r.name, r.skill, r.selected]), [['Anna', 1, false], ['P2', 9, true], ['P3', 2, true], ['Zoe', 4, true]]);
});

test('choosing an option with fewer courts in the last round keeps them in the plan', () => {
  const people17 = [5, 9, 8, 6, 1, 9, 4, 6, 5, 7, 1, 4, 6, 3, 1, 3, 4].map((skill, i) => ({ id: `y${i}`, name: `P${i + 1}`, lastSkill: skill }));
  const d = { ...newDraft(people17), selectedRounds: 9, lastRoundCourts: 1 };
  const ev = evaluateDraft(d);
  assert.deepEqual(ev.problems, []);
  assert.deepEqual(ev.plan, { rounds: 9, matchMinutes: 21, lastRoundCourts: 1 });
  assert.deepEqual(ev.games, { min: 4, max: 4, even: true });
  const t = createTournament({ id: 't', name: 'x', seed: 1, now: new Date(), players: ev.players,
    settings: { courts: 2, rounds: 9, matchMinutes: 21, breakMinutes: 5, revealBatch: 'all', lastRoundCourts: 1 } });
  assert.equal(draftFromTournament(t, people17).lastRoundCourts, 1);
  assert.deepEqual(evaluateDraft(draftFromTournament(t, people17)).plan, { rounds: 9, matchMinutes: 21, lastRoundCourts: 1 });
});
