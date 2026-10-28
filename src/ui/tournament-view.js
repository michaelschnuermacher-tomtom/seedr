import { h, formatSigned, lockedNote } from './dom.js';
import { logoDataUrl } from './logo.js';
import { redraw, setResult, hasResults, isActive, swapPlayersAcross, isFinished, finishTournament, reopenTournament, openMatches, setScore } from '../engine/tournament.js';
import { resultKey, computeStandings, scoreWinner, hasResult, isAmericano, scoresRequired, scoringLabel } from '../engine/standings.js';
import { scheduleStats, drawWarnings, teamValue, formatValue, edgeLevel } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';
import { drawQuality } from '../engine/quality.js';
import { tournamentSummary } from '../engine/summary.js';
import { scaleOf, calibrated, calibratePlayers, stepUnit, levels, describeScale } from '../engine/scale.js';
import { draftFromTournament } from './setup.js';

const TABS = [['info', 'Info'], ['rounds', 'Rounds'], ['standings', 'Standings'], ['summary', 'Summary'], ['print', 'Print']];

function roundComplete(t, round) {
  return round.matches.every((m) => hasResult(t.results, resultKey(round.round, m.court)));
}

export function tournamentScreen(ctx) {
  const t = ctx.state.tournament;
  const view = (ctx.state.view ??= { tab: 'info' });
  const body = view.tab === 'info' ? [infoTab(t), infoPlayers(t), qualitySection(t), infoEdit(ctx, t)]
    : view.tab === 'standings' ? standingsTab(t)
    : view.tab === 'summary' ? summaryTab(ctx, t)
    : view.tab === 'print' ? printPage(ctx, t)
      : view.tab === 'printout' ? printout(ctx, t, view)
      : view.editRounds ? allRoundsPage(ctx, t)
      : [roundsTab(ctx, t, view), roundsEdit(ctx, t)];
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'titles' },
        h('button', { class: 'eyebrow home-link', title: 'Home', onclick: () => ctx.go('home') }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'),
        h('h1', {}, t.name, isFinished(t) ? h('span', { class: 'title-badge' }, 'Finished') : null))),
    h('nav', { class: 'tabs' }, TABS.map(([key, label]) =>
      h('button', {
        class: view.tab === key ? 'current' : '',
        onclick: () => {
          Object.assign(view, { tab: key, editRounds: false, swapping: false, swapPick: null });
          ctx.render();
        },
      }, label))),
    body);
}

// The most important facts of the tournament at a glance. Games and sit-outs are counted
// from the schedule, so withdrawals and swaps are included.
function infoTab(t) {
  const s = t.settings;
  const active = t.players.filter(isActive);
  const withdrawn = t.players.length - active.length;
  const games = new Map(active.map((p) => [p.id, 0]));
  const sitOuts = new Map(active.map((p) => [p.id, 0]));
  for (const r of t.schedule) {
    for (const m of r.matches) for (const id of [...m.team1, ...m.team2]) if (games.has(id)) games.set(id, games.get(id) + 1);
    for (const id of r.sitOuts) if (sitOuts.has(id)) sitOuts.set(id, sitOuts.get(id) + 1);
  }
  // "4 each" or "4 for 13 players, 3 for 4 players", most common first.
  const spread = (counts, unit) => {
    const groups = new Map();
    for (const n of counts.values()) groups.set(n, (groups.get(n) ?? 0) + 1);
    const word = (n) => `${n} ${unit}${n === 1 ? '' : 's'}`;
    if (groups.size === 1) return `${word([...groups.keys()][0])} each`;
    return [...groups].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([n, players]) => `${word(n)} for ${players} player${players === 1 ? '' : 's'}`).join(', ');
  };
  const played = t.schedule.filter((r) => roundComplete(t, r)).length;
  const total = s.rounds * s.matchMinutes + (s.rounds - 1) * s.breakMinutes;
  const hours = Math.floor(total / 60);
  const status = isFinished(t) ? `Finished on ${new Date(t.finishedAt).toLocaleDateString()}`
    : hasResults(t) ? `Running: ${played} of ${s.rounds} rounds have all results` : 'Not started yet';
  return h('section', { class: 'card general' },
    h('h2', { class: 'card-title' }, 'General'),
    h('dl', { class: 'facts' },
      fact('Status', status),
      fact('Created', new Date(t.createdAt).toLocaleDateString()),
      fact('Players', withdrawn ? `${active.length} (${withdrawn} withdrew)` : active.length),
      fact('Courts', s.lastRoundCourts ? `${s.courts} (last round: ${s.lastRoundCourts})` : s.courts),
      fact('Rounds', s.rounds),
      fact('Match length', `${s.matchMinutes} min`),
      fact('Break between rounds', s.breakMinutes ? `${s.breakMinutes} min` : 'none'),
      fact('Playing time', `${total} min${hours ? ` (${hours} h${total % 60 ? ` ${total % 60} min` : ''})` : ''}`),
      fact('Games per player', spread(games, 'game')),
      fact('Sit-outs per player', spread(sitOuts, 'sit-out')),
      fact('Scoring', scoringLabel(s.scoring)),
      fact('Skill scale', `${scaleOf(s).min}–${scaleOf(s).max}. ${describeScale(scaleOf(s))}`)),
    h('div', { style: 'height: 12px' }));
}

// Below everything in Info: Edit changes the whole tournament (settings, players, skills).
function infoEdit(ctx, t) {
  return h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => editTournament(ctx, t) }, 'Edit'));
}

// The players in the Info tab, by skill.
function infoPlayers(t) {
  const active = t.players.filter(isActive).length;
  const withdrawn = t.players.length - active;
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, `Players · ${active}${withdrawn ? ` (${withdrawn} withdrew)` : ''}`),
    h('p', { class: 'muted' }, describeScale(scaleOf(t.settings))),
    skillFacts(t),
    h('div', { style: 'height: 12px' }));
}

// Display data for every round of the schedule.
export function roundsOverview(t) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const scale = scaleOf(t.settings);
  const team = (ids) => {
    const skills = ids.map((id) => calibrated(byId.get(id).skill, scale));
    return {
      names: ids.map((id) => byId.get(id).name).join(' + '),
      members: ids.map((id) => byId.get(id).name),
      value: teamValue(skills[0], skills[1]),
      spread: Math.max(...skills) - Math.min(...skills),
    };
  };
  return t.schedule.map((r) => ({
    round: r.round,
    complete: roundComplete(t, r),
    matches: r.matches.map((m) => {
      const team1 = team(m.team1);
      const team2 = team(m.team2);
      return {
        court: m.court,
        team1,
        team2,
        valueGap: Math.abs(team1.value - team2.value),
        // The team with the edge (lower team value = stronger); 0 when both are equal.
        favoured: team1.value < team2.value ? 1 : team2.value < team1.value ? 2 : 0,
        spreadGap: Math.abs(team1.spread - team2.spread),
        winner: t.results[resultKey(r.round, m.court)],
        score: t.scores?.[resultKey(r.round, m.court)] ?? null,
      };
    }),
    sitOuts: r.sitOuts.map((id) => byId.get(id).name),
  }));
}

// Each court has its own Grand Slam color: AO blue, Roland Garros clay, Wimbledon green, US Open blue.
function courtColor(court) {
  return `court-color-${(court - 1) % 4}`;
}

// A team on a round card that cannot be tapped (Rounds → Edit, printout).
function teamBox(round, match, n) {
  const team = n === 1 ? match.team1 : match.team2;
  const { winner } = match;
  return h('div', { class: ['team', winner === n ? 'winner' : '', winner && winner !== n ? 'loser' : ''].join(' ').trim() },
    h('span', { class: 'names' }, team.members[0], h('span', { class: 'plus' }, ' + '), team.members[1]));
}

function teamButton(ctx, t, round, match, n) {
  const team = n === 1 ? match.team1 : match.team2;
  const { winner } = match;
  return h('button', {
    class: ['team', winner === n ? 'winner' : '', winner && winner !== n ? 'loser' : ''].join(' ').trim(),
    disabled: isFinished(t),
    onclick: () => {
      if (match.score || scoresRequired(t.settings.scoring)) {
        openScore(ctx, round, match);
        return;
      }
      ctx.save(setResult(t, round, match.court, winner === n ? null : n));
      ctx.render();
    },
  }, h('span', { class: 'names' }, team.members[0], h('span', { class: 'plus' }, ' + '), team.members[1]));
}

const scoreText = (sets) => sets.map(([a, b]) => `${a}:${b}`).join(', ');

// Under each match: its score, or "Add score"; tapping opens the score page. In a
// finished tournament and on paper only an existing score shows.
function scoreLine(ctx, t, round, match) {
  if (isFinished(t)) return match.score ? h('div', { class: 'score-line' }, scoreText(match.score)) : null;
  return h('button', { class: `score-line link${match.score ? '' : ' no-print'}`, onclick: () => openScore(ctx, round, match) },
    match.score ? scoreText(match.score) : 'Add score');
}

function openScore(ctx, round, match) {
  const sets = match.score ?? [[null, null]];
  Object.assign(ctx.state.view, { scoring: { round, court: match.court }, scoreDraft: { sets: sets.map((set) => [...set]), winner: match.winner ?? null } });
  ctx.state.message = null;
  ctx.render();
}

function closeScore(ctx) {
  Object.assign(ctx.state.view, { scoring: null, scoreDraft: null });
  ctx.render();
}

// The score of one match: one row per set with the points of both teams. The winner
// follows from the score (more sets, then more points); when both are equal it is chosen
// here. Unless the tournament requires scores, tapping the winner on the round card works too.
function scorePage(ctx, t, view) {
  if (isAmericano(t.settings.scoring)) return americanoScorePage(ctx, t, view);
  const { round, court } = view.scoring;
  const match = roundsOverview(t).find((r) => r.round === round)?.matches.find((m) => m.court === court);
  if (!match) {
    closeScore(ctx);
    return null;
  }
  const draft = view.scoreDraft;
  const names = (n) => (n === 1 ? match.team1 : match.team2).members.join(' & ');
  const parsed = () => draft.sets.map((set) => set.map((x) => (x === null || x === '' ? NaN : Number(x))));
  const verdict = h('p', { class: 'muted' });
  const choice = h('div', { class: 'actions' });
  // Shows the winner the score gives, or asks for it when sets and points are equal.
  const update = () => {
    const sets = parsed();
    const complete = sets.every((set) => set.every((x) => Number.isInteger(x) && x >= 0));
    const winner = complete ? scoreWinner(sets) : null;
    choice.replaceChildren();
    if (!complete) verdict.textContent = 'Enter the points of every set.';
    else if (winner) verdict.textContent = `Winner: ${names(winner)}.`;
    else {
      verdict.textContent = 'Sets and points are equal. Who won?';
      choice.append(...[1, 2].map((n) => h('button', {
        class: draft.winner === n ? 'primary' : '',
        onclick: () => { draft.winner = n; update(); },
      }, names(n))));
    }
  };
  const save = () => {
    try {
      ctx.save(setScore(t, round, court, parsed(), draft.winner));
      closeScore(ctx);
    } catch (error) {
      ctx.state.message = error.message;
      ctx.render();
    }
  };
  const pointsInput = (set, i) => h('input', {
    type: 'number', min: 0, step: 1, inputmode: 'numeric', value: set[i] ?? '',
    'aria-label': `Points ${names(i + 1)}`,
    oninput: (e) => { set[i] = e.target.value === '' ? null : Number(e.target.value); update(); },
  });
  const rows = draft.sets.map((set, k) => h('div', { class: 'score-set' },
    h('span', { class: 'score-set-label' }, `Set ${k + 1}`),
    pointsInput(set, 0), h('span', { class: 'vs' }, ':'), pointsInput(set, 1),
    draft.sets.length > 1 ? h('button', { class: 'small', 'aria-label': `Remove set ${k + 1}`, onclick: () => { draft.sets.splice(k, 1); ctx.render(); } }, '✕') : h('span', {})));
  update();
  return [
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, `Round ${round} · Court ${court}`),
      h('div', { class: 'score-set score-head' }, h('span', {}), h('strong', {}, names(1)), h('span', {}), h('strong', {}, names(2)), h('span', {})),
      rows,
      h('div', { class: 'actions' }, h('button', { class: 'small', onclick: () => { draft.sets.push([null, null]); ctx.render(); } }, 'Add set')),
      verdict,
      choice,
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: save }, 'Save'),
        match.score ? h('button', {
          onclick: () => {
            ctx.save(scoresRequired(t.settings.scoring) ? setResult(t, round, court, null) : setScore(t, round, court, null));
            closeScore(ctx);
          },
        }, 'Remove score') : null,
        h('button', { onclick: () => closeScore(ctx) }, 'Cancel'))),
  ];
}

// Americano: the points of both teams, adding up to the points per match. Typing one fills
// in the other; equal points are a draw.
function americanoScorePage(ctx, t, view) {
  const { round, court } = view.scoring;
  const match = roundsOverview(t).find((r) => r.round === round)?.matches.find((m) => m.court === court);
  if (!match) {
    closeScore(ctx);
    return null;
  }
  const total = t.settings.scoring.points;
  const pair = view.scoreDraft.sets[0];
  const names = (n) => (n === 1 ? match.team1 : match.team2).members.join(' & ');
  const verdict = h('p', { class: 'muted' });
  const inputs = [];
  const update = () => {
    const [a, b] = pair;
    verdict.textContent = !Number.isInteger(a) || !Number.isInteger(b) ? `Enter the points of one team; together they make ${total}.`
      : a + b !== total ? `The points must add up to ${total}.`
        : a === b ? 'Draw.' : `Winner: ${names(a > b ? 1 : 2)}.`;
  };
  const pointsInput = (i) => {
    const input = h('input', {
      type: 'number', min: 0, max: total, step: 1, inputmode: 'numeric', value: pair[i] ?? '',
      'aria-label': `Points ${names(i + 1)}`,
      oninput: (e) => {
        pair[i] = e.target.value === '' ? null : Number(e.target.value);
        const other = 1 - i;
        if (Number.isInteger(pair[i]) && pair[i] >= 0 && pair[i] <= total) {
          pair[other] = total - pair[i];
          inputs[other].value = pair[other];
        }
        update();
      },
    });
    inputs[i] = input;
    return input;
  };
  const save = () => {
    try {
      ctx.save(setScore(t, round, court, [pair.map((x) => (Number.isInteger(x) ? x : NaN))]));
      closeScore(ctx);
    } catch (error) {
      ctx.state.message = error.message;
      ctx.render();
    }
  };
  update();
  return [
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, `Round ${round} · Court ${court} · ${total} points`),
      h('div', { class: 'score-set score-head' }, h('span', {}), h('strong', {}, names(1)), h('span', {}), h('strong', {}, names(2)), h('span', {})),
      h('div', { class: 'score-set' }, h('span', { class: 'score-set-label' }, 'Points'), pointsInput(0), h('span', { class: 'vs' }, ':'), pointsInput(1), h('span', {})),
      verdict,
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onclick: save }, 'Save'),
        match.score ? h('button', {
          onclick: () => {
            ctx.save(setResult(t, round, court, null)); // the score is the result
            closeScore(ctx);
          },
        }, 'Remove score') : null,
        h('button', { onclick: () => closeScore(ctx) }, 'Cancel'))),
  ];
}

const EDGE_LABELS = { slight: 'Slight edge', clear: 'Clear edge', big: 'Big edge' };

// Court label, with how big the edge is and which team has it (e.g. "Slight edge: Felix & Gesa"), or Even.
function courtLine(tag, m, showEdge = true) {
  if (!showEdge) return h(tag, { class: 'court' }, `Court ${m.court}`);
  const level = edgeLevel(m.valueGap);
  const favoured = m.favoured === 1 ? m.team1 : m.team2;
  return h(tag, { class: 'court' }, `Court ${m.court}`,
    h('span', { class: `gaps edge-tag edge-${level}` }, level === 'even' ? 'Even' : `${EDGE_LABELS[level]}: ${favoured.members.join(' & ')}`));
}

// Editing (Info → Edit, Rounds → Edit, finishing) asks for this password every time. It
// only keeps players from peeking: anyone can read it in the app's source.
const ALL_ROUNDS_PASSWORD = 'Tenerife';
// Switched off for now: editing opens without asking. Set to true to ask again.
const PASSWORD_REQUIRED = false;

export function isAllRoundsPassword(input) {
  return input != null && input.trim() === ALL_ROUNDS_PASSWORD;
}

// Asks for the password; false when cancelled or wrong.
function askPassword(ctx, question) {
  if (!PASSWORD_REQUIRED) return true;
  const input = prompt(question);
  if (input == null) return false;
  if (isAllRoundsPassword(input)) return true;
  ctx.flash('Wrong password.');
  return false;
}

// Below the rounds: Edit opens every round of the schedule (password), not once finished.
function roundsEdit(ctx, t) {
  if (ctx.state.view.scoring) return null;
  if (isFinished(t)) return lockedNote('The tournament is finished: results and rounds are locked. Reopen it in the Summary tab to change them.');
  return h('div', { class: 'actions' }, h('button', {
    class: 'primary',
    onclick: () => {
      if (!askPassword(ctx, 'Password to edit the rounds:')) return;
      Object.assign(ctx.state.view, { editRounds: true, swapPick: null });
      ctx.state.message = null;
      ctx.render();
    },
  }, 'Edit'));
}

// The rounds the players see: every complete round and the next one. With `all` (Rounds → Edit)
// every round, where players can be swapped. `readOnly` (Rounds → Edit and the printout): no
// result entry.
function roundsTab(ctx, t, view, all = false, readOnly = all) {
  if (view.scoring && !readOnly) return scorePage(ctx, t, view);
  const rounds = roundsOverview(t);
  // In Rounds → Edit (all rounds) players can always be swapped, unless the tournament is finished.
  const swapping = all && Boolean(view.swapping) && !isFinished(t);
  // In Rounds → Edit and the printout results are not entered: the round cards are only shown.
  const team = (r, m, n) => (readOnly ? teamBox(r, m, n) : teamButton(ctx, t, r.round, m, n));
  const { matchMinutes, breakMinutes } = t.settings;
  const timing = `Each round takes ${matchMinutes} min, ${breakMinutes ? `with a ${breakMinutes} min break between rounds` : 'with no break between rounds'}.`;
  return [
    h('h2', { class: 'print-only' }, 'Rounds'),
    // On screen the timing is in the Info tab; the printout keeps it here.
    swapping ? swapHeader(ctx, t, view) : h('p', { class: 'muted timing print-only' }, timing),
    h('div', { class: 'overview' }, rounds.map((r) => h('section', { class: `overview-round${r.complete ? ' complete' : ''}` },
      h('h3', {}, `Round ${r.round}${r.complete ? ' ✓' : ''}`),
      swapping ? swapRound(ctx, t, view, r) : r.matches.map((m) => h('div', { class: `mini-match ${courtColor(m.court)}` },
        courtLine('span', m),
        team(r, m, 1),
        h('span', { class: 'vs' }, 'vs'),
        team(r, m, 2),
        readOnly ? (m.score ? h('div', { class: 'score-line' }, scoreText(m.score)) : null) : scoreLine(ctx, t, r.round, m)))))),
  ];
}

// Tweaking the draw: tap two players of the same round to swap them, in either view.
// Matches with a result are locked. `view.swapPick` is the first player tapped.
function swapHeader(ctx, t, view) {
  const pick = view.swapPick && t.players.find((p) => p.id === view.swapPick.id);
  return h('p', { class: pick ? 'warning' : 'muted' }, pick
    ? `Now tap the player to swap with ${pick.name} (round ${view.swapPick.round}). In another round, they trade places in both rounds. Tap ${pick.name} again to cancel.`
    : 'To swap two players, tap one and then the other, also in different rounds. Courts with a result are locked.');
}

// One round's matches and sit-outs as player buttons.
function swapRound(ctx, t, view, round) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const r = t.schedule[round.round - 1];
  const picked = (id) => view.swapPick?.round === round.round && view.swapPick.id === id;
  const tap = (id) => {
    if (picked(id)) view.swapPick = null;
    else if (!view.swapPick) view.swapPick = { round: round.round, id };
    else {
      try {
        ctx.save(swapPlayersAcross(t, view.swapPick.round, view.swapPick.id, round.round, id));
      } catch (error) {
        ctx.state.message = error.message;
      }
      view.swapPick = null;
    }
    ctx.render();
  };
  const chip = (id, locked) => h('button', {
    class: `chip${picked(id) ? ' picked' : ''}`,
    disabled: locked,
    onclick: () => tap(id),
  }, byId.get(id).name);
  const matches = r.matches.map((m, k) => {
    const locked = hasResult(t.results, resultKey(round.round, m.court));
    return h('div', { class: `match swap ${courtColor(m.court)}` },
      courtLine('div', round.matches[k]),
      h('div', { class: 'chips' }, m.team1.map((id) => chip(id, locked))),
      h('div', { class: 'vs' }, locked ? 'vs · has a result' : 'vs'),
      h('div', { class: 'chips' }, m.team2.map((id) => chip(id, locked))));
  });
  return [
    matches,
    r.sitOuts.length ? h('div', { class: 'sit-outs' }, h('p', { class: 'muted' }, 'Sitting out:'), h('div', { class: 'chips' }, r.sitOuts.map((id) => chip(id, false)))) : null,
  ];
}

// One printout, without buttons and controls (see @media print), for everybody: so it shows
// only what the players see. Shows it, prints, and comes back to the Info tab.
// The sections of the printout, in this order, as chosen on the Print page.
const PRINT_PARTS = [['general', 'General'], ['summary', 'Tournament summary'], ['standings', 'Standings'], ['rounds', 'Rounds'], ['quality', 'Draw quality'], ['skills', 'Player skills']];

// Everything by default. The summary only exists once the tournament is finished.
function defaultPrintParts() {
  return Object.fromEntries(PRINT_PARTS.map(([key]) => [key, true]));
}

// Only the sections that exist: no summary before the tournament is finished.
function printableParts(t) {
  return PRINT_PARTS.filter(([key]) => key !== 'summary' || isFinished(t));
}

function printout(ctx, t, view) {
  const chosen = view.printParts ?? defaultPrintParts();
  const parts = Object.fromEntries(printableParts(t).map(([key]) => [key, chosen[key]]));
  // No forced page breaks: a section starts on the same page when its heading and first
  // block (e.g. the first two rounds) still fit, otherwise on the next one.
  return [
    parts.general ? [h('h2', { class: 'print-only' }, 'General'), infoTab(t)] : null,
    parts.summary ? [h('h2', { class: 'print-only' }, 'Tournament summary'), summaryCard(t)] : null,
    parts.standings ? standingsTab(t) : null,
    parts.rounds ? roundsTab(ctx, t, { ...view, swapping: false }, false, true) : null,
    parts.quality ? [h('h2', { class: 'print-only' }, 'Draw quality'), qualitySection(t)] : null,
    parts.skills ? [h('h2', { class: 'print-only' }, 'Player skills'), skillsCard(t)] : null,
  ];
}

// The Print tab, for everybody: choose the sections, then print.
function printPage(ctx, t) {
  const parts = (ctx.state.view.printChoice ??= { ...(ctx.state.view.printParts ?? defaultPrintParts()) });
  const available = printableParts(t);
  const start = () => {
    if (!available.some(([key]) => parts[key])) {
      ctx.state.message = 'Choose at least one section to print.';
      ctx.render();
      return;
    }
    Object.assign(ctx.state.view, { printParts: { ...parts }, printChoice: null });
    printAll(ctx);
  };
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Print'),
    h('p', { class: 'muted' }, 'Choose what goes into the printout.'),
    // Every section is listed; the summary stays greyed out until the tournament is finished.
    h('div', { class: 'options' }, PRINT_PARTS.map(([key, label]) => {
      const ready = available.some(([k]) => k === key);
      return [
        h('label', { class: `option${ready ? '' : ' unavailable'}` },
          h('input', { type: 'checkbox', checked: ready && parts[key], disabled: !ready, onchange: (e) => { parts[key] = e.target.checked; } }),
          h('span', {}, label)),
        ready ? null : lockedNote('The tournament summary can be printed once the tournament is finished (Summary tab).'),
      ];
    })),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: start }, 'Print')));
}

function printAll(ctx) {
  const view = ctx.state.view;
  view.tab = 'printout';
  ctx.render();
  const back = () => {
    view.tab = 'print';
    ctx.render();
  };
  window.addEventListener('afterprint', back, { once: true });
  setTimeout(() => window.print(), 50); // let the browser lay out the tab first
}

// A point difference with a real minus sign, like the edge: +12, −3, 0.
const formatPoints = (x) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0');

function standingsTab(t) {
  const scale = scaleOf(t.settings);
  const americano = isAmericano(t.settings.scoring);
  const rows = computeStandings(calibratePlayers(t.players, scale), t.schedule, t.results, t.scores, t.settings.scoring);
  // The Bonus column only appears once someone has bonus points.
  const bonus = rows.some((r) => r.bonus);
  // Sets and point difference only appear once a score has been entered.
  const scored = Object.keys(t.scores ?? {}).length > 0;
  const headers = americano
    ? ['#', 'Player', 'Games', 'W–D–L', bonus ? 'Bonus' : null, 'Points', '+/−', 'Edge'].filter(Boolean)
    : ['#', 'Player', 'Games', 'Wins', bonus ? 'Bonus' : null, 'Points', scored ? 'Sets' : null, scored ? '+/−' : null, 'Edge'].filter(Boolean);
  return [
    h('h2', { class: 'print-only' }, 'Standings'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: x === 'Edge' || x === '+/−' ? 'num' : null }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.withdrawn ? 'withdrawn' : r.rank <= 3 && r.points > 0 ? `rank-${r.rank}` : '' },
        h('td', { class: 'rank' }, r.withdrawn ? '–' : h('span', { class: 'rank-badge' }, r.rank)),
        h('td', {}, r.name, r.withdrawn ? h('span', { class: 'muted' }, ' (withdrew)') : null),
        h('td', {}, r.games),
        h('td', {}, americano ? `${r.wins}–${r.draws}–${r.losses}` : r.wins),
        bonus ? h('td', {}, r.bonus ? `+${r.bonus}` : '') : null,
        h('td', { class: 'points' }, r.points),
        scored && !americano ? h('td', {}, `${r.setsWon}:${r.setsLost}`) : null,
        scored || americano ? h('td', { class: 'num' }, formatPoints(r.pointsFor - r.pointsAgainst)) : null,
        h('td', { class: 'num' }, r.edge == null ? '–' : formatSigned(r.edge / stepUnit(scale)))))))),
    h('p', { class: 'muted' },
      'Games count only rounds with all results entered. ',
      bonus ? (americano
        ? 'Bonus: for each game fewer than the most games played, the player’s own average points per game. '
        : 'Bonus: 0.5 points per game fewer than the most games played. ') : '',
      americano ? 'Points: the points the player’s teams scored. On equal points, the point difference (+/−) and then the wins decide. ' : '',
      rows.some((r) => r.withdrawn) ? 'Players who withdrew keep their wins, but get no bonus and no rank. ' : '',
      scored && !americano ? 'On equal points, set difference and then point difference (+/−) decide; matches without a score count 0:0. ' : '',
      'Edge: how much stronger, on average, the team a player played in was than its opponents (team values): + = mostly in the stronger team, − = mostly in the weaker one, 0 = balanced.'),
  ];
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, String(value))];
}

// A card: a title, its content, and its buttons.
function section(title, content, buttons = []) {
  const shown = buttons.filter(Boolean);
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, title),
    content,
    shown.length ? h('div', { class: 'actions' }, shown) : h('div', { style: 'height: 12px' }));
}

// In the Summary tab: finishing locks results and the draw and shows the summary to
// everyone. Like editing, it can ask for the password.
function finishSection(ctx, t) {
  if (isFinished(t)) {
    return section('Finished', h('p', { class: 'muted' }, `Finished on ${new Date(t.finishedAt).toLocaleDateString()}. Results and the draw are locked. Reopening hides the summary until it is finished again.`), [
      h('button', {
        onclick: () => {
          if (!confirm('Reopen the tournament? The summary is hidden until it is finished again.') || !askPassword(ctx, 'Password to reopen:')) return;
          ctx.save(reopenTournament(t));
          ctx.render();
        },
      }, 'Reopen'),
    ]);
  }
  const open = openMatches(t);
  return section('Finish', [
    h('p', { class: 'muted' }, 'Finishing locks results and the draw and shows the summary here. It can be reopened.'),
    open ? lockedNote(`Possible once all rounds are played: still ${open} ${open === 1 ? 'match' : 'matches'} without a result.`) : null,
  ], [
    h('button', {
      class: 'primary',
      disabled: open > 0,
      onclick: () => {
        if (!confirm('Finish the tournament and show the summary to everyone?') || !askPassword(ctx, 'Password to finish:')) return;
        ctx.save(finishTournament(t, new Date()));
        ctx.state.view.tab = 'summary';
        ctx.render();
      },
    }, 'Finish tournament'),
  ]);
}

// Every round of the schedule, including the ones players do not see yet; swapping
// players works here too.
function allRoundsPage(ctx, t) {
  const view = ctx.state.view;
  view.swapping = true; // ready to swap: tap two players
  const close = () => {
    Object.assign(view, { editRounds: false, swapping: false, swapPick: null });
    ctx.render();
  };
  const done = () => h('button', { class: 'primary', onclick: close }, 'Done');
  return [
    h('div', { class: 'actions' }, done(), hasResults(t) ? lockedNote('Redraw schedule: only before the first result.') : h('button', {
      onclick: () => {
        if (!confirm('Draw a completely new schedule? Until the first result, this replaces it.')) return;
        ctx.save(redraw(t, newSeed()));
        ctx.render();
      },
    }, 'Redraw schedule')),
    roundsTab(ctx, t, view, true),
    h('div', { class: 'actions' }, done()),
  ];
}

// Every option of the tournament, on the same page as for a new tournament (the setup).
function editTournament(ctx, t) {
  if (!askPassword(ctx, 'Password to edit the tournament:')) return;
  ctx.state.draft = draftFromTournament(ctx.store.get(t.id) ?? t);
  ctx.go('setup');
}

// How even and how varied the draw is, with warnings when something is off.
function drawFigures(t) {
  const scale = scaleOf(t.settings);
  const players = calibratePlayers(t.players, scale);
  const warnings = drawWarnings(scheduleStats(players, t.schedule), stepUnit(scale)).map((w) => h('p', { class: 'warning' }, w));
  return { warnings, q: t.schedule.length ? drawQuality(players, t.schedule) : null, unit: stepUnit(scale) };
}

// Draw quality, with every figure, in Info.
function qualitySection(t) {
  const { warnings, q, unit } = drawFigures(t);
  const one = (x) => (Math.round(x * 10) / 10).toString();
  const steps = (x) => formatValue(Math.round((x / unit) * 100) / 100);
  const card = section('Draw quality', [
    warnings,
    q ? [
      h('p', { class: 'muted' }, `Edge = how much stronger one team is than the other in a match (team values: sum of skills + ¼ of the spread), in skill steps.`),
      h('dl', { class: 'facts' },
        fact('Average edge', steps(q.avgGap)),
        fact('Biggest edge', q.worst ? `${steps(q.worst.gap)} (round ${q.worst.round}, court ${q.worst.court})` : '–'),
        fact('Different partners', `${one(q.partners.distinct)} per player${q.partners.repeats ? `, ${q.partners.repeats} repeated` : ', none repeated'}`),
        fact('Different opponents', `${one(q.opponents.distinct)} per player`),
        fact('Repeated opponents', q.opponents.repeats
          ? `${q.opponents.repeats} meeting(s) again${q.opponents.thirds ? `, ${q.opponents.thirds} a third time or more` : ''}`
          : 'none'),
        q.opponents.most.length ? fact('Most often opponents', q.opponents.most.map((m) => `${m.names.join(' & ')} ${m.times}×`).join(', ')) : null,
        fact('Sitting out twice in a row', q.sitOuts.backToBack ? `${q.sitOuts.backToBack}×, longest ${q.sitOuts.longestRun} rounds` : 'never')),
    ] : h('p', { class: 'muted' }, 'No rounds yet.'),
  ]);
  card.classList.add('quality');
  return card;
}

// How the players were assessed: one line per skill, like the player list.
function skillFacts(t) {
  const present = new Set(t.players.map((p) => p.skill));
  const skills = levels(scaleOf(t.settings)).filter((skill) => present.has(skill)); // best first
  return h('dl', { class: 'facts' }, skills.map((skill) => fact(`Skill ${skill}`, t.players.filter((p) => p.skill === skill)
    .map((p) => (isActive(p) ? p.name : `${p.name} (withdrew)`)).join(', '))));
}

// The player skills for the printout.
function skillsCard(t) {
  return h('section', { class: 'card skills' },
    h('h2', { class: 'card-title' }, 'Player skills'),
    h('p', { class: 'muted' }, describeScale(scaleOf(t.settings))),
    skillFacts(t),
    h('div', { style: 'height: 12px' }));
}

// The highlights would give away results nobody should see yet, so the Summary tab only
// shows them once the tournament is finished.
function summaryTab(ctx, t) {
  if (isFinished(t)) return [summaryCard(t), finishSection(ctx, t)];
  return [
    h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, 'Tournament summary'),
      h('p', { class: 'muted' }, 'Fun highlights of the tournament (champion, underdog of the day, upset of the tournament and more) appear here once the tournament is finished.'),
      h('div', { style: 'height: 12px' })),
    finishSection(ctx, t),
  ];
}

// Fun highlights of the results (the Summary tab and the top of the printout).
function summaryCard(t) {
  const highlights = tournamentSummary(t);
  return h('section', { class: 'card summary' },
    h('h2', { class: 'card-title' }, 'Tournament summary'),
    highlights.length
      ? h('ul', { class: 'highlights' }, highlights.map((x) => h('li', {},
        h('span', { class: 'icon', 'aria-hidden': 'true' }, x.icon),
        h('span', {}, h('strong', {}, x.title), ' ', x.text))))
      : h('p', { class: 'muted' }, 'The highlights appear once the first round has all its results.'),
    h('div', { style: 'height: 12px' }));
}
