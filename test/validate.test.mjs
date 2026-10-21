import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTournament, setResult, withdrawPlayers } from '../src/engine/tournament.js';
import { validateTournament } from '../src/engine/validate.js';

const base = () => {
  const t = createTournament({
    id: 't1', name: 'Club night', seed: 3, now: new Date('2026-10-14T18:00:00Z'),
    players: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((skill, i) => ({ name: `P${i + 1}`, skill })),
    settings: { courts: 2, rounds: 4, matchMinutes: 12, breakMinutes: 2, revealBatch: 'all' },
  });
  return JSON.parse(JSON.stringify(setResult(t, 1, 1, 2)));
};

const broken = (mutate) => {
  const t = base();
  mutate(t);
  return validateTournament(t);
};

test('a created tournament survives a JSON round trip', () => {
  const t = base();
  const result = validateTournament(JSON.parse(JSON.stringify(t)));
  assert.equal(result.ok, true);
  assert.deepEqual(result.tournament, t);
});

test('rejects things that are not tournaments', () => {
  for (const value of [null, [], 'text', 42, {}]) assert.equal(validateTournament(value).ok, false);
});

const cases = {
  'unsupported version': [(t) => { t.version = 2; }, /version/],
  'too few players': [(t) => { t.players = t.players.slice(0, 3); }, /4 players/],
  'skill out of range': [(t) => { t.players[0].skill = 11; }, /skill/],
  'duplicate name (case-insensitive)': [(t) => { t.players[1].name = t.players[0].name.toLowerCase(); }, /Duplicate player name/],
  'schedule length differs from rounds': [(t) => { t.schedule.pop(); }, /Schedule/],
  'player missing from a round': [(t) => { t.schedule[0].sitOuts = []; }, /every player/],
  'unknown player in a round': [(t) => { t.schedule[0].matches[0].team1[0] = 'ghost'; }, /Unknown player/],
  'invalid court number': [(t) => { t.schedule[0].matches[0].court = 7; }, /court/],
  'result for an unknown match': [(t) => { t.results['9-1'] = 1; }, /unknown match/],
  'invalid result value': [(t) => { t.results['1-1'] = 3; }, /Invalid result/],
  'revealed rounds out of range': [(t) => { t.revealedRounds = 5; }, /revealed/],
  'invalid reveal batch': [(t) => { t.settings.revealBatch = 0; }, /reveal batch/],
};

for (const [name, [mutate, message]] of Object.entries(cases)) {
  test(`rejects: ${name}`, () => {
    const result = broken(mutate);
    assert.equal(result.ok, false);
    assert.match(result.error, message);
  });
}

test('withdrawn players may only appear up to their last round', () => {
  const t = withdrawPlayers(base(), ['p1'], 8);
  assert.equal(validateTournament(JSON.parse(JSON.stringify(t))).ok, true);
  const back = JSON.parse(JSON.stringify(t));
  back.players[0].withdrawnAfter = 3;
  assert.match(validateTournament(back).error, /round 2 does not include every player/);
  const early = JSON.parse(JSON.stringify(t));
  early.players[0].withdrawnAfter = 0;
  assert.match(validateTournament(early).error, /Withdrawn player in round 1/);
  const bad = JSON.parse(JSON.stringify(t));
  bad.players[0].withdrawnAfter = 'yes';
  assert.match(validateTournament(bad).error, /Invalid withdrawal/);
});

test('the fewer-games mark must be true or false', () => {
  const t = base();
  t.players[0].fewer = 'yes';
  assert.match(validateTournament(t).error, /fewer-games/);
});

test('the end time is optional but must be HH:MM', () => {
  const t = base();
  t.settings.endTime = '18:30';
  assert.equal(validateTournament(t).ok, true);
  t.settings.endTime = '25:00';
  assert.match(validateTournament(t).error, /end time/);
});

test('the last round may not use more courts than set', () => {
  const t = base();
  t.settings.lastRoundCourts = 1;
  assert.match(validateTournament(t).error, /Invalid court in round 4/);
  t.settings.lastRoundCourts = 2;
  assert.match(validateTournament(t).error, /courts in the last round/);
});
