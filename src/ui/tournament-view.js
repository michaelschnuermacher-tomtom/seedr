import { h, formatSigned } from './dom.js';
import { logoDataUrl } from './logo.js';
import { revealNext, redraw, setResult, hasResults, isActive, firstRedrawableRound, withdrawPlayers, renameTournament, swapPlayersAcross, isFinished, finishTournament, reopenTournament, setSkills, redrawRemaining, setScore } from '../engine/tournament.js';
import { resultKey, computeStandings, scoreWinner } from '../engine/standings.js';
import { scheduleStats, drawWarnings, teamValue, formatValue, edgeLevel } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';
import { drawQuality } from '../engine/quality.js';
import { tournamentSummary } from '../engine/summary.js';
import { scaleOf, calibrated, calibratePlayers, stepUnit, levels, describeScale } from '../engine/scale.js';
import { exportBackup } from './backup.js';
import { draftFromTournament } from './setup.js';

const TABS = [['info', 'Info'], ['rounds', 'Rounds'], ['standings', 'Standings'], ['summary', 'Summary'], ['manage', 'Manage']];

function roundComplete(t, round) {
  return round.matches.every((m) => t.results[resultKey(round.round, m.court)]);
}

export function tournamentScreen(ctx) {
  const t = ctx.state.tournament;
  const view = (ctx.state.view ??= { tab: isFinished(t) ? 'summary' : 'rounds' });
  const body = view.tab === 'info' ? infoTab(t)
    : view.tab === 'standings' ? standingsTab(t)
    : view.tab === 'summary' ? summaryTab(t)
    : view.tab === 'manage' ? manageTab(ctx, t)
      : view.tab === 'print' ? printout(ctx, t, view)
      : roundsTab(ctx, t, view);
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'titles' },
        h('button', { class: 'eyebrow home-link', title: 'Home', onclick: () => ctx.go('home') }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'),
        h('h1', {}, t.name, isFinished(t) ? h('span', { class: 'title-badge' }, 'Finished') : null))),
    h('nav', { class: 'tabs' }, TABS.map(([key, label]) =>
      h('button', {
        class: view.tab === key ? 'current' : '',
        onclick: () => {
          // Manage holds every option that changes or reveals the draw: password each time.
          if (key === 'manage' && view.tab !== 'manage' && !askPassword(ctx, 'Password for Manage:')) return;
          if (key === 'manage') view.manage = null; // always open on the list
          view.tab = key;
          ctx.render();
        },
      }, key === 'manage' ? h('span', { class: 'lock', 'aria-hidden': 'true' }, '🔒') : null, label))),
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
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Tournament'),
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
      fact('Skill scale', `${scaleOf(s).min}–${scaleOf(s).max}. ${describeScale(scaleOf(s))}`),
      fact('Rounds revealed', `${s.revealBatch === 'all' ? 'All at once' : `${s.revealBatch} at a time`} (${t.revealedRounds} of ${s.rounds} so far)`)),
    h('div', { style: 'height: 12px' }));
}

// Display data for all revealed rounds; hidden rounds are never included.
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
  return t.schedule.slice(0, t.revealedRounds).map((r) => ({
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

function teamButton(ctx, t, round, match, n) {
  const team = n === 1 ? match.team1 : match.team2;
  const { winner } = match;
  return h('button', {
    class: ['team', winner === n ? 'winner' : '', winner && winner !== n ? 'loser' : ''].join(' ').trim(),
    disabled: isFinished(t),
    onclick: () => {
      if (match.score) {
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
// here. Entering a score is optional: tapping the winner on the round card still works.
function scorePage(ctx, t, view) {
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
    h('button', { class: 'back-link', onclick: () => closeScore(ctx) }, '← Rounds'),
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
            ctx.save(setScore(t, round, court, null));
            closeScore(ctx);
          },
        }, 'Remove score') : null,
        h('button', { onclick: () => closeScore(ctx) }, 'Cancel'))),
  ];
}

const EDGE_LABELS = { slight: 'Slight edge', clear: 'Clear edge', big: 'Big edge' };

// Court label, with how big the edge is and which team has it (e.g. "Slight edge: Felix & Gesa"), or Even.
function courtLine(tag, m) {
  const level = edgeLevel(m.valueGap);
  const favoured = m.favoured === 1 ? m.team1 : m.team2;
  return h(tag, { class: 'court' }, `Court ${m.court}`,
    h('span', { class: `gaps edge-tag edge-${level}` }, level === 'even' ? 'Even' : `${EDGE_LABELS[level]}: ${favoured.members.join(' & ')}`));
}

// Manage asks for this password every time it is opened. It
// only keeps players from peeking: anyone can read it in the app's source.
const ALL_ROUNDS_PASSWORD = 'Tenerife';
// Switched off for now: Manage opens without asking. Set to true to ask again.
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

// All revealed rounds; revealing, swapping and the team values are set in Manage.
function roundsTab(ctx, t, view) {
  if (view.scoring) return scorePage(ctx, t, view);
  const rounds = roundsOverview(t);
  const hidden = t.settings.rounds - t.revealedRounds;
  const comingUp = hidden > 0 ? h('p', { class: 'muted no-print' }, hidden === 1 ? '1 more round to come.' : `${hidden} more rounds to come.`) : null;
  const swapping = Boolean(view.swapping);
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
        teamButton(ctx, t, r.round, m, 1),
        h('span', { class: 'vs' }, 'vs'),
        teamButton(ctx, t, r.round, m, 2),
        scoreLine(ctx, t, r.round, m)))))),
    swapping ? swapDone(ctx, view) : comingUp,
  ];
}

// Tweaking the draw: tap two players of the same round to swap them, in either view.
// Matches with a result are locked. `view.swapPick` is the first player tapped.
function swapHeader(ctx, t, view) {
  const pick = view.swapPick && t.players.find((p) => p.id === view.swapPick.id);
  return h('p', { class: 'warning' }, pick
    ? `Now tap the player to swap with ${pick.name} (round ${view.swapPick.round}). In another round, they trade places in both rounds. Tap ${pick.name} again to cancel.`
    : 'Swap mode: tap two players to swap them, also in different rounds. Courts with a result are locked.');
}

function swapDone(ctx, view) {
  return h('div', { class: 'actions' }, h('button', {
    class: 'primary',
    onclick: () => {
      view.swapping = false;
      view.swapPick = null;
      ctx.render();
    },
  }, 'Done'));
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
    const locked = Boolean(t.results[resultKey(round.round, m.court)]);
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

// One printout: the standings, then all revealed rounds from a new page, without buttons
// and controls (see @media print). Shows them, prints, and comes back to Manage.
// The sections of the printout, in this order, as chosen on the Print page.
const PRINT_PARTS = [['summary', 'Tournament summary'], ['standings', 'Standings'], ['rounds', 'Rounds'], ['skills', 'Player skills']];

// Everything by default. The summary only exists once the tournament is finished.
function defaultPrintParts() {
  return { summary: true, skills: true, standings: true, rounds: true };
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
    parts.summary ? [h('h2', { class: 'print-only' }, 'Tournament summary'), summaryCard(t)] : null,
    parts.standings ? standingsTab(t) : null,
    parts.rounds ? roundsTab(ctx, t, { ...view, swapping: false }) : null,
    parts.skills ? [h('h2', { class: 'print-only' }, 'Player skills'), skillsCard(t)] : null,
  ];
}

// Choose the sections, then print.
function printPage(ctx, t) {
  const parts = (ctx.state.view.printChoice ??= { ...(ctx.state.view.printParts ?? defaultPrintParts()) });
  const available = printableParts(t);
  const start = () => {
    if (!available.some(([key]) => parts[key])) {
      ctx.state.message = 'Choose at least one section to print.';
      ctx.render();
      return;
    }
    Object.assign(ctx.state.view, { printParts: { ...parts }, printChoice: null, manage: null });
    printAll(ctx);
  };
  return subPage(ctx, 'Print', [
    h('p', { class: 'muted' }, isFinished(t)
      ? 'Choose what goes into the printout.'
      : 'Choose what goes into the printout. The tournament summary can be printed once the tournament is finished.'),
    h('div', { class: 'options' }, available.map(([key, label]) => h('label', { class: 'option' },
      h('input', { type: 'checkbox', checked: parts[key], onchange: (e) => { parts[key] = e.target.checked; } }),
      h('span', {}, label)))),
  ], [h('button', { class: 'primary', onclick: start }, 'Print')]);
}

function printAll(ctx) {
  const view = ctx.state.view;
  view.tab = 'print';
  ctx.render();
  const back = () => {
    view.tab = 'manage';
    ctx.render();
  };
  window.addEventListener('afterprint', back, { once: true });
  setTimeout(() => window.print(), 50); // let the browser lay out the tab first
}

// A point difference with a real minus sign, like the edge: +12, −3, 0.
const formatPoints = (x) => (x > 0 ? `+${x}` : x < 0 ? `−${-x}` : '0');

function standingsTab(t) {
  const scale = scaleOf(t.settings);
  const rows = computeStandings(calibratePlayers(t.players, scale), t.schedule, t.results, t.scores);
  // The Bonus column only appears once someone has bonus points.
  const bonus = rows.some((r) => r.bonus);
  // Sets and point difference only appear once a score has been entered.
  const scored = Object.keys(t.scores ?? {}).length > 0;
  const headers = ['#', 'Player', 'Games', 'Wins', bonus ? 'Bonus' : null, 'Points', scored ? 'Sets' : null, scored ? '+/−' : null, 'Edge'].filter(Boolean);
  return [
    h('h2', { class: 'print-only' }, 'Standings'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: x === 'Edge' || x === '+/−' ? 'num' : null }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.withdrawn ? 'withdrawn' : r.rank <= 3 && r.points > 0 ? `rank-${r.rank}` : '' },
        h('td', { class: 'rank' }, r.withdrawn ? '–' : h('span', { class: 'rank-badge' }, r.rank)),
        h('td', {}, r.name, r.withdrawn ? h('span', { class: 'muted' }, ' (withdrew)') : null),
        h('td', {}, r.games),
        h('td', {}, r.wins),
        bonus ? h('td', {}, r.bonus ? `+${r.bonus}` : '') : null,
        h('td', { class: 'points' }, r.points),
        scored ? h('td', {}, `${r.setsWon}:${r.setsLost}`) : null,
        scored ? h('td', { class: 'num' }, formatPoints(r.pointsFor - r.pointsAgainst)) : null,
        h('td', { class: 'num' }, r.edge == null ? '–' : formatSigned(r.edge / stepUnit(scale)))))))),
    h('p', { class: 'muted' },
      'Games count only rounds with all results entered. ',
      bonus ? 'Bonus: 0.5 points per game fewer than the most games played. ' : '',
      rows.some((r) => r.withdrawn) ? 'Players who withdrew keep their wins, but get no bonus and no rank. ' : '',
      scored ? 'On equal points, set difference and then point difference (+/−) decide; matches without a score count 0:0. ' : '',
      'Edge: how much stronger, on average, the team a player played in was than its opponents (team values): + = mostly in the stronger team, − = mostly in the weaker one, 0 = balanced.'),
  ];
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, String(value))];
}

// Manage lists everything read-only; changes happen on a sub-page (view.manage) that an
// Edit button opens, with Save and Cancel. Actions that change nothing stay direct buttons.
function manageTab(ctx, t) {
  const pages = { tournament: tournamentPage, skills: skillsPage, withdraw: withdrawPage, quality: qualityPage, print: printPage };
  const page = pages[ctx.state.view.manage];
  return page ? page(ctx, t) : manageOverview(ctx, t);
}

function openPage(ctx, name) {
  ctx.state.view.manage = name;
  ctx.state.message = null;
  ctx.render();
}

// Back to the Manage list; edits not saved are dropped.
function closePage(ctx) {
  Object.assign(ctx.state.view, { manage: null, skills: null, withdraw: null, printChoice: null });
  ctx.render();
}

// One part of Manage: a title, what is set now, and its buttons.
function section(title, content, buttons = []) {
  const shown = buttons.filter(Boolean);
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, title),
    content,
    shown.length ? h('div', { class: 'actions' }, shown) : h('div', { style: 'height: 12px' }));
}

// A sub-page of Manage: its own buttons (e.g. Save), then Cancel (or Back when nothing is edited).
function subPage(ctx, title, content, buttons = [], close = 'Cancel') {
  const shown = buttons.filter(Boolean);
  return [
    h('button', { class: 'back-link', onclick: () => closePage(ctx) }, '← Manage'),
    section(title, content, [...shown, h('button', { onclick: () => closePage(ctx) }, shown.length ? close : 'Back')]),
  ];
}

// Finishing locks results and the draw and shows the summary to everyone in its own tab.
function finishSection(ctx, t) {
  if (isFinished(t)) {
    return section('Finished', h('p', { class: 'muted' }, `Finished on ${new Date(t.finishedAt).toLocaleDateString()}. Results and the draw are locked, and the Summary tab shows the highlights to everyone.`), [
      h('button', {
        onclick: () => {
          if (!confirm('Reopen the tournament? The summary is hidden until it is finished again.')) return;
          ctx.save(reopenTournament(t));
          ctx.render();
        },
      }, 'Reopen'),
    ]);
  }
  const open = t.schedule.reduce((n, r) => n + r.matches.filter((m) => !t.results[resultKey(r.round, m.court)]).length, 0);
  return section('Finish', h('p', { class: 'muted' }, 'When the last match is played: finishing locks results and the draw, and shows the tournament summary to everyone in the Summary tab. It can be reopened.'), [
    h('button', {
      class: 'primary',
      onclick: () => {
        const question = open
          ? `${open} ${open === 1 ? 'match has' : 'matches have'} no result yet. Finish the tournament anyway?`
          : 'Finish the tournament and show the summary to everyone?';
        if (!confirm(question)) return;
        ctx.save(finishTournament(t, new Date()));
        ctx.state.view.tab = 'summary';
        ctx.render();
      },
    }, 'Finish tournament'),
  ]);
}

function manageOverview(ctx, t) {
  const s = t.settings;
  const view = ctx.state.view;
  const hidden = s.rounds - t.revealedRounds;
  const step = s.revealBatch === 'all' ? hidden : Math.min(s.revealBatch, hidden);
  const from = t.revealedRounds + 1;
  const reveal = hidden > 0 ? h('button', {
    class: 'primary',
    onclick: () => {
      ctx.save(revealNext(t));
      ctx.state.message = step === 1 ? `Round ${from} is revealed.` : `Rounds ${from}–${from + step - 1} are revealed.`;
      ctx.render();
    },
  }, step === 1 ? `Reveal round ${from}` : `Reveal rounds ${from}–${from + step - 1}`) : null;
  const swap = h('button', {
    onclick: () => {
      view.swapping = true;
      view.swapPick = null;
      view.tab = 'rounds';
      ctx.render();
    },
  }, 'Swap players');
  const withdrawn = t.players.length - t.players.filter(isActive).length;
  const quality = revealedQuality(t);
  const finished = isFinished(t);
  return [
    finishSection(ctx, t),
    section('Rounds', h('p', { class: 'muted' }, hidden > 0
      ? `Rounds 1–${t.revealedRounds} of ${s.rounds} are revealed.`
      : `All ${s.rounds} rounds are revealed.`), finished ? [] : [reveal, swap]),
    section('Tournament', h('dl', { class: 'facts' },
      fact('Name', t.name),
      fact('Courts', s.lastRoundCourts ? `${s.courts} (last round: ${s.lastRoundCourts})` : s.courts),
      fact('Rounds', s.rounds),
      fact('Match length', `${s.matchMinutes} min`),
      fact('Break', `${s.breakMinutes} min`),
      fact('Rounds revealed at a time', s.revealBatch === 'all' ? 'All' : s.revealBatch)),
    [h('button', { onclick: () => openPage(ctx, 'tournament') }, 'Edit')]),
    section('Players', [
      h('p', { class: 'muted' }, `${t.players.length - withdrawn} players${withdrawn ? ` (${withdrawn} withdrew)` : ''}. ${describeScale(scaleOf(t.settings))}`),
      skillFacts(t)],
    [finished ? null : h('button', { onclick: () => openPage(ctx, 'skills') }, 'Edit skills'),
      finished ? null : h('button', { onclick: () => openPage(ctx, 'withdraw') }, 'Player leaves…')]),
    section('Draw quality', [quality.warnings, quality.q
      ? h('dl', { class: 'facts' },
        fact('Average edge', formatValue(Math.round((quality.q.avgGap / quality.unit) * 100) / 100)),
        fact('Biggest edge', quality.q.worst ? formatValue(Math.round((quality.q.worst.gap / quality.unit) * 100) / 100) : '–'))
      : h('p', { class: 'muted' }, 'Shown once the first round is revealed.')],
    [h('button', { onclick: () => openPage(ctx, 'quality') }, 'Details')]),
    section('Print & export', h('p', { class: 'muted' }, 'The printout can have the summary (once the tournament is finished), the standings, all revealed rounds and the player skills: Print… lets you choose. The backup is one file with all players and tournaments on this device, to keep them safe or move them to another device.'), [
      h('button', { onclick: () => openPage(ctx, 'print') }, 'Print…'),
      h('button', { onclick: () => exportBackup(ctx) }, 'Export backup')]),
    h('div', { class: 'actions' }, h('button', {
      class: 'danger',
      onclick: () => {
        if (!confirm(`Delete "${t.name}" from this device? Export it first if you want to keep it.`)) return;
        ctx.store.remove(t.id);
        ctx.state.tournament = null;
        ctx.go('home');
      },
    }, 'Delete tournament')),
  ];
}

// The tournament name can be changed at any time; courts, rounds and times only before
// the first result, in the setup (which draws again).
function tournamentPage(ctx, t) {
  const locked = hasResults(t) || isFinished(t);
  const input = h('input', { type: 'text', value: t.name });
  const save = () => {
    try {
      if (input.value.trim() !== t.name) ctx.save(renameTournament(t, input.value));
      closePage(ctx);
    } catch (error) {
      ctx.state.message = error.message;
      ctx.render();
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  return subPage(ctx, 'Tournament', [
    h('label', { class: 'field' }, h('span', {}, 'Name'), input),
    h('p', { class: 'muted' }, locked
      ? 'Courts, rounds and times can only be changed before the first result is entered.'
      : 'Courts, rounds, times and the player list are changed in the setup, which draws the schedule again.'),
    h('div', { class: 'actions' }, h('button', {
      disabled: locked,
      onclick: () => {
        ctx.state.view.manage = null;
        ctx.state.draft = draftFromTournament(t, ctx.people());
        ctx.go('setup');
      },
    }, 'Change courts, rounds & times…')),
  ], [h('button', { class: 'primary', onclick: save }, 'Save')]);
}

// Skills belong to this tournament and can change while it runs. Team values, edges, the
// standings and the summary follow at once; the schedule was drawn for the old skills, so
// what has no result yet can be drawn again. Names are changed on the Players page.
function skillsPage(ctx, t) {
  // Changes not saved yet, by player id; kept when saving fails.
  const edits = (ctx.state.view.skills ??= {});
  const last = t.settings.rounds;
  const from = hasResults(t) ? firstRedrawableRound(t) : 1;
  const rounds = from === last ? `round ${last}` : `rounds ${from}–${last}`;
  const save = (redrawToo) => {
    const changed = Object.fromEntries(Object.entries(edits).filter(([id, skill]) => t.players.find((p) => p.id === id)?.skill !== skill));
    if (redrawToo && !confirm(hasResults(t)
      ? `Save the skills and draw ${rounds} again? Rounds with results stay as they are.`
      : 'Save the skills and draw a completely new schedule?')) return;
    try {
      let next = setSkills(t, changed);
      if (redrawToo) next = redrawRemaining(next, newSeed());
      ctx.save(next);
      closePage(ctx);
    } catch (error) {
      ctx.state.message = error.message;
      ctx.render();
    }
  };
  const skillSelect = (p) => {
    const select = h('select', { onchange: (e) => { edits[p.id] = Number(e.target.value); } },
      levels(scaleOf(t.settings)).map((n) => h('option', { value: n }, `Skill ${n}`)));
    select.value = String(edits[p.id] ?? p.skill);
    return select;
  };
  return subPage(ctx, 'Skills', [
    h('p', { class: 'muted' }, `Skills belong to this tournament. ${describeScale(scaleOf(t.settings))} Team values, edges, the standings and the summary follow the new skills.`
      + (from <= last ? ` The schedule was drawn for the old skills: ${hasResults(t) ? `${rounds} can be drawn again (rounds with results stay)` : 'it can be drawn again'}.` : '')
      + ' Names and years of birth are changed on the Players page (home screen).'),
    h('div', { class: 'names-grid' }, t.players.map((p) => h('label', { class: 'field' },
      h('span', {}, `${p.name}${isActive(p) ? '' : ' · withdrew'}`),
      skillSelect(p)))),
  ], [
    from <= last ? h('button', { class: 'primary', onclick: () => save(true) }, hasResults(t) ? `Save and redraw ${rounds}` : 'Save and redraw') : null,
    h('button', { class: from <= last ? '' : 'primary', onclick: () => save(false) }, 'Save only'),
  ]);
}

// A player who cannot go on: keep the rounds played so far and draw the rest again.
function withdrawPage(ctx, t) {
  const from = firstRedrawableRound(t);
  const last = t.settings.rounds;
  const active = t.players.filter(isActive);
  const chosen = (ctx.state.view.withdraw ??= new Set());
  const canRedraw = hasResults(t) && from <= last;
  const rounds = from === last ? `round ${last}` : `rounds ${from}–${last}`;
  const button = canRedraw ? h('button', {
    class: 'primary',
    disabled: chosen.size === 0 || active.length - chosen.size < 4,
    onclick: (e) => {
      const names = active.filter((p) => chosen.has(p.id)).map((p) => p.name).join(', ');
      if (!confirm(`Withdraw ${names} and redraw ${rounds}? This cannot be undone.`)) return;
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Drawing…';
      setTimeout(() => { // let the browser paint "Drawing…" first
        try {
          ctx.save(withdrawPlayers(t, [...chosen], newSeed()));
          Object.assign(ctx.state.view, { manage: null, withdraw: null, tab: 'rounds' });
        } catch (error) {
          ctx.state.message = error.message;
        }
        ctx.render();
      }, 20);
    },
  }, `Withdraw and redraw ${rounds}`) : null;
  const note = !hasResults(t) ? 'Before the first result, remove players in Tournament → Edit → Change courts, rounds & times.'
    : from > last ? 'All rounds have results, there is nothing left to redraw.'
      : `${from === 2 ? 'Round 1 stays' : `Rounds 1–${from - 1} stay`} as played; ${rounds} will be drawn again without the chosen players. At least 4 players must remain.`;
  return subPage(ctx, 'Player leaves', [
    h('p', { class: 'muted' }, note),
    canRedraw ? h('div', { class: 'options withdraw' }, active.map((p) => h('label', { class: 'option' },
      h('input', {
        type: 'checkbox',
        checked: chosen.has(p.id),
        onchange: (e) => {
          if (e.target.checked) chosen.add(p.id);
          else chosen.delete(p.id);
          button.disabled = chosen.size === 0 || active.length - chosen.size < 4;
        },
      }),
      h('span', {}, p.name)))) : null,
  ], [button]);
}

// How even and how varied the draw is, over the revealed rounds only: repeated pairings
// would otherwise give away hidden rounds. Warnings look at the whole draw, but only say
// that something is off, not where.
function revealedQuality(t) {
  const scale = scaleOf(t.settings);
  const players = calibratePlayers(t.players, scale);
  const warnings = drawWarnings(scheduleStats(players, t.schedule), stepUnit(scale)).map((w) => h('p', { class: 'warning' }, w));
  const revealed = t.schedule.slice(0, t.revealedRounds);
  return { warnings, revealed, q: revealed.length ? drawQuality(players, revealed) : null, unit: stepUnit(scale) };
}

function qualityPage(ctx, t) {
  const { warnings, revealed, q, unit } = revealedQuality(t);
  const locked = hasResults(t) || isFinished(t);
  const one = (x) => (Math.round(x * 10) / 10).toString();
  const scope = revealed.length < t.schedule.length ? ` (rounds 1–${revealed.length} of ${t.schedule.length}, the revealed ones)` : '';
  return subPage(ctx, 'Draw quality', [
    warnings,
    q ? [
      h('p', { class: 'muted' }, `Edge = how much stronger one team is than the other in a match (team values: sum of skills + ¼ of the spread), in skill steps${scope}.`),
      h('dl', { class: 'facts' },
        fact('Average edge', formatValue(Math.round((q.avgGap / unit) * 100) / 100)),
        fact('Biggest edge', q.worst ? `${formatValue(Math.round((q.worst.gap / unit) * 100) / 100)} (round ${q.worst.round}, court ${q.worst.court})` : '–'),
        fact('Different partners', `${one(q.partners.distinct)} per player${q.partners.repeats ? `, ${q.partners.repeats} repeated` : ', none repeated'}`),
        fact('Different opponents', `${one(q.opponents.distinct)} per player`),
        fact('Repeated opponents', q.opponents.repeats
          ? `${q.opponents.repeats} meeting(s) again${q.opponents.thirds ? `, ${q.opponents.thirds} a third time or more` : ''}`
          : 'none'),
        q.opponents.most.length ? fact('Most often opponents', q.opponents.most.map((m) => `${m.names.join(' & ')} ${m.times}×`).join(', ')) : null,
        fact('Sitting out twice in a row', q.sitOuts.backToBack ? `${q.sitOuts.backToBack}×, longest ${q.sitOuts.longestRun} rounds` : 'never')),
    ] : h('p', { class: 'muted' }, 'The figures are shown once the first round is revealed.'),
    h('p', { class: 'muted' }, locked
      ? 'The schedule can only be drawn again before the first result is entered.'
      : 'Drawing again replaces the whole schedule with a new one.'),
  ], [h('button', {
    disabled: locked,
    onclick: () => {
      if (!confirm('Draw a completely new schedule?')) return;
      ctx.save(redraw(t, newSeed()));
      ctx.render();
    },
  }, 'Redraw schedule')], 'Back');
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
function summaryTab(t) {
  if (isFinished(t)) return summaryCard(t);
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Tournament summary'),
    h('p', { class: 'muted' }, 'Fun highlights of the tournament (champion, underdog of the day, upset of the tournament and more) appear here once the tournament is finished.'),
    h('div', { style: 'height: 12px' }));
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
