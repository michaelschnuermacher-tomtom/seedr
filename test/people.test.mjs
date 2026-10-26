import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personProblem, addPerson, updatePerson, deletePerson, splitPerson, usage, withPeople, withoutPeople,
  makeBackup, readBackup, mergeBackup,
} from '../src/engine/people.js';
import { createTournament } from '../src/engine/tournament.js';
import { validateTournament } from '../src/engine/validate.js';

const SETTINGS = { courts: 1, rounds: 2, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all' };
const person = (id, name, more = {}) => ({ id, name, ...more });
// A stored tournament: its players only refer to people.
const stored = (id, people) => withoutPeople(createTournament({ id, name: id, seed: 1, now: new Date('2026-01-01T00:00:00Z'), settings: SETTINGS,
  players: people.map((p, i) => ({ personId: p.id, name: p.name, skill: i + 1 })) }));
const four = [person('a', 'Seb', { birthYear: 1990 }), person('b', 'Micha'), person('c', 'Lia'), person('d', 'Max')];

test('names must be unique and years of birth plausible', () => {
  const people = [{ id: 'a', name: 'Seb' }];
  assert.match(personProblem(people, { name: ' ' }), /empty/);
  assert.match(personProblem(people, { name: 'seb ' }), /already a player called/);
  assert.equal(personProblem(people, { id: 'a', name: 'Seb' }), null, 'a person keeps their own name');
  assert.match(personProblem(people, { name: 'Ana', birthYear: 1850 }), /between 1900/);
  assert.match(personProblem(people, { name: 'Ana', birthYear: 1990.5 }), /between 1900/);
  assert.equal(personProblem(people, { name: 'Ana', birthYear: 1990 }), null);
});

test('stored tournaments only refer to people; names and years of birth come from the people', () => {
  const t = stored('t', four);
  assert.deepEqual(t.players[0], { id: 'p1', personId: 'a', skill: 1 });
  assert.equal(validateTournament(t).ok, true);
  const shown = withPeople(t, four);
  assert.deepEqual(shown.players[0], { id: 'p1', personId: 'a', skill: 1, name: 'Seb', birthYear: 1990 });
  assert.deepEqual(withoutPeople(shown), t, 'storing drops them again');
  assert.equal(withPeople(t, four.slice(1)).players[0].name, 'Unknown player');
});

test('a correction to a person shows in every tournament without changing it', () => {
  const t = stored('t', four);
  const people = updatePerson(four, 'a', { name: 'Sebastian', birthYear: 1985 });
  assert.deepEqual(people[0], { id: 'a', name: 'Sebastian', birthYear: 1985 });
  assert.equal(withPeople(t, people).players[0].name, 'Sebastian');
  assert.throws(() => updatePerson(four, 'a', { name: 'micha' }), /already a player/);
  assert.throws(() => updatePerson(four, 'x', { name: 'Zoe' }), /Unknown player/);
});

test('a person can only be deleted while they play in no tournament', () => {
  const t = stored('t', four);
  const { people: more, person: zoe } = addPerson(four, { name: 'Zoe', birthYear: 2001 }, () => 'zoe');
  assert.deepEqual(zoe, { id: 'zoe', name: 'Zoe', birthYear: 2001 });
  assert.equal(usage([t], 'zoe').length, 0);
  assert.equal(deletePerson(more, [t], 'zoe').length, 4);
  assert.throws(() => deletePerson(more, [t], 'a'), /part of a tournament/);
});

test('splitting gives the chosen tournaments a person of their own', () => {
  const a = stored('a', four);
  const b = stored('b', [four[3], person('e', 'Ada'), person('f', 'Hugo'), person('g', 'Anne')]);
  const people = [...four, person('e', 'Ada'), person('f', 'Hugo'), person('g', 'Anne')];
  assert.equal(usage([a, b], 'd').length, 2);
  const result = splitPerson(people, [a, b], 'd', ['b'], { name: 'Max B.', birthYear: null }, () => 'new');
  assert.equal(result.tournaments.length, 1);
  assert.equal(result.tournaments[0].players[0].personId, 'new');
  assert.equal(withPeople(result.tournaments[0], result.people).players[0].name, 'Max B.');
  assert.equal(usage([a, ...result.tournaments], 'd').length, 1);
  assert.throws(() => splitPerson(people, [a, b], 'd', [], { name: 'Max C.' }, () => 'x'), /at least one tournament/);
  assert.throws(() => splitPerson(people, [a, b], 'd', ['b'], { name: 'Ada' }, () => 'x'), /already a player/);
});

test('a backup round-trips all people and tournaments, without names in the tournaments', () => {
  const t = withPeople(stored('a', four), four); // as held in the app
  const backup = JSON.parse(JSON.stringify(makeBackup(four, [t], new Date('2026-10-26T10:00:00Z'))));
  assert.deepEqual([backup.format, backup.version, backup.exportedAt], ['seedr-backup', 2, '2026-10-26T10:00:00.000Z']);
  assert.ok(backup.tournaments[0].players.every((p) => !('name' in p)));
  assert.deepEqual(readBackup(backup), { people: four, tournaments: [stored('a', four)] });
  assert.throws(() => readBackup({ ...backup, version: 9 }), /Unsupported backup version/);
  assert.throws(() => readBackup({ ...backup, people: [{ id: 'a', name: 'X' }, { id: 'a', name: 'Y' }] }), /invalid player/);
  assert.throws(() => readBackup({ ...backup, people: four.slice(1) }), /not in the backup/);
  assert.throws(() => readBackup({ format: 'nope' }), /not a Seedr backup/);
});

test('older backups with names in the tournaments are read; the names are dropped', () => {
  const t = withPeople(stored('a', four), four);
  const old = { format: 'seedr-backup', version: 2, exportedAt: 'x', people: four, tournaments: [t] };
  assert.deepEqual(readBackup(old).tournaments[0], stored('a', four));
});

test('importing merges people by id, then by name', () => {
  const local = { people: four, tournaments: [stored('a', four)] };
  // From another device: Seb under another id with a year of birth, plus a new tournament.
  const remote = [person('r-seb', 'Seb', { birthYear: 1980 }), person('e', 'Ada'), person('f', 'Hugo'), person('g', 'Anne')];
  const merged = mergeBackup(local, readBackup(makeBackup(remote, [stored('b', remote)])));
  assert.equal(merged.people.filter((p) => p.name === 'Seb').length, 1, 'one Seb');
  assert.equal(merged.people.find((p) => p.name === 'Seb').birthYear, 1980);
  assert.equal(merged.tournaments.find((t) => t.id === 'b').players[0].personId, 'a', 'linked to the local Seb');
  assert.deepEqual(merged.replaced, { people: 1, tournaments: 0 });
  const again = mergeBackup({ people: merged.people, tournaments: [...local.tournaments, ...merged.tournaments] }, readBackup(makeBackup(four, [stored('a', four)])));
  assert.equal(again.replaced.tournaments, 1);
});
