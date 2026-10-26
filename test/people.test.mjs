import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personProblem, addPerson, updatePerson, deletePerson, splitPerson, usage, linkTournament, syncTournament,
  rememberSkills, makeBackup, readBackup, mergeBackup,
} from '../src/engine/people.js';
import { createTournament } from '../src/engine/tournament.js';
import { validateTournament } from '../src/engine/validate.js';

const ids = () => { let n = 0; return () => `n${++n}`; };
const SETTINGS = { courts: 1, rounds: 2, matchMinutes: 10, breakMinutes: 2, revealBatch: 'all' };
// A tournament whose players are not linked to people yet (linkTournament links them).
const oldTournament = (id, names, createdAt = '2026-01-01T00:00:00.000Z') =>
  createTournament({ id, name: id, seed: 1, now: new Date(createdAt), settings: SETTINGS, players: names.map((name, i) => ({ name, skill: i + 1 })) });

test('names must be unique and years of birth plausible', () => {
  const people = [{ id: 'a', name: 'Seb' }];
  assert.match(personProblem(people, { name: ' ' }), /empty/);
  assert.match(personProblem(people, { name: 'seb ' }), /already a player called/);
  assert.equal(personProblem(people, { id: 'a', name: 'Seb' }), null, 'a person keeps their own name');
  assert.match(personProblem(people, { name: 'Ana', birthYear: 1850 }), /between 1900/);
  assert.match(personProblem(people, { name: 'Ana', birthYear: 1990.5 }), /between 1900/);
  assert.equal(personProblem(people, { name: 'Ana', birthYear: 1990 }), null);
});

test('linking gives every player a person, by name, and keeps the tournament valid', () => {
  const t = oldTournament('a', ['Seb', 'Micha', 'Lia', 'Max']);
  const { t: linked, people } = linkTournament(t, [{ id: 'p-seb', name: 'seb', birthYear: 1990 }], ids());
  assert.deepEqual(linked.players.map((p) => p.personId), ['p-seb', 'n1', 'n2', 'n3']);
  assert.equal(linked.players[0].name, 'seb', 'the person’s spelling is copied in');
  assert.equal(linked.players[0].birthYear, 1990);
  assert.equal(people.length, 4);
  assert.deepEqual([linked.schedule, linked.results], [t.schedule, t.results]);
  assert.equal(validateTournament(linked).ok, true);
});

test('a correction to a person shows in all their tournaments', () => {
  const next = ids();
  let { t: a, people } = linkTournament(oldTournament('a', ['Seb', 'Micha', 'Lia', 'Max']), [], next);
  let b;
  ({ t: b, people } = linkTournament(oldTournament('b', ['Seb', 'Ada', 'Hugo', 'Anne']), people, next));
  const seb = people.find((p) => p.name === 'Seb');
  const result = updatePerson(people, [a, b], seb.id, { name: 'Sebastian', birthYear: 1985 });
  assert.equal(result.people.find((p) => p.id === seb.id).name, 'Sebastian');
  assert.equal(result.tournaments.length, 2);
  for (const t of result.tournaments) assert.deepEqual(t.players.find((p) => p.personId === seb.id), { ...t.players[0], name: 'Sebastian', birthYear: 1985 });
  assert.throws(() => updatePerson(people, [a, b], seb.id, { name: 'micha' }), /already a player/);
  const ada = people.find((p) => p.name === 'Ada');
  assert.equal(updatePerson(people, [a, b], ada.id, { name: 'Ada', birthYear: 1970 }).tournaments.length, 1, 'only tournaments of the person change');
});

test('a person can only be deleted while they play in no tournament', () => {
  const { t, people } = linkTournament(oldTournament('a', ['Seb', 'Micha', 'Lia', 'Max']), [], ids());
  const { people: more, person } = addPerson(people, { name: 'Zoe', birthYear: 2001 }, () => 'zoe');
  assert.deepEqual(person, { id: 'zoe', name: 'Zoe', birthYear: 2001 });
  assert.equal(usage([t], 'zoe').length, 0);
  assert.equal(deletePerson(more, [t], 'zoe').length, 4);
  assert.throws(() => deletePerson(more, [t], people[0].id), /part of a tournament/);
});

test('splitting gives the chosen tournaments a person of their own', () => {
  const next = ids();
  let { t: a, people } = linkTournament(oldTournament('a', ['Max', 'Micha', 'Lia', 'Seb']), [], next);
  let b;
  ({ t: b, people } = linkTournament(oldTournament('b', ['Max', 'Ada', 'Hugo', 'Anne']), people, next));
  const max = people.find((p) => p.name === 'Max');
  assert.equal(usage([a, b], max.id).length, 2);
  const result = splitPerson(people, [a, b], max.id, ['b'], { name: 'Max B.', birthYear: null }, next);
  assert.equal(result.tournaments.length, 1);
  const moved = result.tournaments[0].players.find((p) => p.personId === result.person.id);
  assert.equal(moved.name, 'Max B.');
  assert.equal(usage([a, ...result.tournaments], max.id).length, 1);
  assert.throws(() => splitPerson(people, [a, b], max.id, [], { name: 'Max C.' }, next), /at least one tournament/);
  assert.throws(() => splitPerson(people, [a, b], max.id, ['b'], { name: 'Ada' }, next), /already a player/);
});

test('the last skill is remembered for the next tournament', () => {
  const people = rememberSkills([{ id: 'a', name: 'Seb', lastSkill: 2 }, { id: 'b', name: 'Lia' }], [{ personId: 'a', skill: 1 }, { personId: 'b', skill: 4 }]);
  assert.deepEqual(people.map((p) => p.lastSkill), [1, 4]);
});

test('a backup round-trips all people and tournaments', () => {
  const { t, people } = linkTournament(oldTournament('a', ['Seb', 'Micha', 'Lia', 'Max']), [{ id: 'x', name: 'Zoe', birthYear: 2001 }], ids());
  const backup = JSON.parse(JSON.stringify(makeBackup(people, [t], new Date('2026-10-26T10:00:00Z'))));
  assert.deepEqual([backup.format, backup.version, backup.exportedAt], ['seedr-backup', 2, '2026-10-26T10:00:00.000Z']);
  const read = readBackup(backup);
  assert.deepEqual(read, { people, tournaments: [t] });
  assert.throws(() => readBackup({ ...backup, version: 9 }), /Unsupported backup version/);
  assert.throws(() => readBackup({ ...backup, people: [{ id: 'a', name: 'X' }, { id: 'a', name: 'Y' }] }), /invalid player/);
  assert.throws(() => readBackup({ format: 'nope' }), /not a Seedr backup/);
  assert.throws(() => readBackup(t), /not a Seedr backup/, 'a single tournament is no backup');
});

test('importing merges by id, then by name', () => {
  const next = ids();
  const local = linkTournament(oldTournament('a', ['Seb', 'Micha', 'Lia', 'Max']), [], next);
  const seb = local.people.find((p) => p.name === 'Seb');
  // From another device: Seb under another id with a year of birth, plus a new tournament.
  const other = linkTournament(oldTournament('b', ['Seb', 'Ada', 'Hugo', 'Anne']), [{ id: 'remote-seb', name: 'Seb', birthYear: 1990 }], () => `r${Math.random()}`);
  const merged = mergeBackup({ people: local.people, tournaments: [local.t] }, readBackup(makeBackup(other.people, [other.t])), next);
  assert.equal(merged.people.filter((p) => p.name === 'Seb').length, 1, 'one Seb');
  assert.equal(merged.people.find((p) => p.name === 'Seb').birthYear, 1990);
  const b = merged.tournaments.find((t) => t.id === 'b');
  assert.equal(b.players.find((p) => p.name === 'Seb').personId, seb.id, 'linked to the local Seb');
  assert.ok(merged.tournaments.some((t) => t.id === 'a' && t.players[0].birthYear === 1990), 'the local tournament gets the year too');
  assert.deepEqual(merged.replaced, { people: 1, tournaments: 0 });
});

test('syncTournament leaves a tournament alone when nothing changed', () => {
  const { t, people } = linkTournament(oldTournament('a', ['Seb', 'Micha', 'Lia', 'Max']), [], ids());
  assert.equal(syncTournament(t, people), t);
});
