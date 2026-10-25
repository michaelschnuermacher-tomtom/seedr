import { h, formatSigned, slugify } from './dom.js';
import { logoDataUrl } from './logo.js';
import { revealNext, redraw, setResult, hasResults, isActive, firstRedrawableRound, withdrawPlayers, renamePlayers, renameTournament, swapPlayersAcross } from '../engine/tournament.js';
import { resultKey, computeStandings } from '../engine/standings.js';
import { scheduleStats, drawWarnings, teamValue, formatValue, edgeLevel } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';
import { drawQuality } from '../engine/quality.js';
import { tournamentSummary } from '../engine/summary.js';
import { saveFile, downloadFile } from './export.js';
import { draftFromTournament } from './setup.js';

const TABS = [['rounds', 'Rounds'], ['standings', 'Standings'], ['manage', 'Manage']];

function roundComplete(t, round) {
  return round.matches.every((m) => t.results[resultKey(round.round, m.court)]);
}

export function tournamentScreen(ctx) {
  const t = ctx.state.tournament;
  const view = (ctx.state.view ??= { tab: 'rounds' });
  const body = view.tab === 'standings' ? standingsTab(t)
    : view.tab === 'manage' ? manageTab(ctx, t)
      : view.tab === 'print' ? [
        h('h2', { class: 'print-only' }, 'Tournament summary'), summaryCard(t),
        h('h2', { class: 'print-only' }, 'Player skills'), skillsCard(t),
        standingsTab(t), h('div', { class: 'page-break' }), roundsTab(ctx, t, { ...view, swapping: false })]
      : roundsTab(ctx, t, view);
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('div', { class: 'titles' },
        h('button', { class: 'eyebrow home-link', title: 'Home', onclick: () => ctx.go('home') }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'),
        h('h1', {}, t.name))),
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

// Display data for all revealed rounds; hidden rounds are never included.
export function roundsOverview(t) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const team = (ids) => {
    const skills = ids.map((id) => byId.get(id).skill);
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
    onclick: () => {
      ctx.save(setResult(t, round, match.court, winner === n ? null : n));
      ctx.render();
    },
  }, h('span', { class: 'names' }, team.members[0], h('span', { class: 'plus' }, ' + '), team.members[1]));
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
  const rounds = roundsOverview(t);
  const hidden = t.settings.rounds - t.revealedRounds;
  const comingUp = hidden > 0 ? h('p', { class: 'muted no-print' }, hidden === 1 ? '1 more round to come.' : `${hidden} more rounds to come.`) : null;
  const swapping = Boolean(view.swapping);
  const { matchMinutes, breakMinutes } = t.settings;
  const timing = `Each round takes ${matchMinutes} min, ${breakMinutes ? `with a ${breakMinutes} min break between rounds` : 'with no break between rounds'}.`;
  return [
    h('h2', { class: 'print-only' }, 'Rounds'),
    swapping ? swapHeader(ctx, t, view) : h('p', { class: 'muted timing' }, timing),
    h('div', { class: 'overview' }, rounds.map((r) => h('section', { class: `overview-round${r.complete ? ' complete' : ''}` },
      h('h3', {}, `Round ${r.round}${r.complete ? ' ✓' : ''}`),
      swapping ? swapRound(ctx, t, view, r) : r.matches.map((m) => h('div', { class: `mini-match ${courtColor(m.court)}` },
        courtLine('span', m),
        teamButton(ctx, t, r.round, m, 1),
        h('span', { class: 'vs' }, 'vs'),
        teamButton(ctx, t, r.round, m, 2)))))),
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

function standingsTab(t) {
  const rows = computeStandings(t.players, t.schedule, t.results);
  // The Bonus column only appears once someone has bonus points.
  const bonus = rows.some((r) => r.bonus);
  const headers = ['#', 'Player', 'Games', 'Wins', bonus ? 'Bonus' : null, 'Points', 'Edge'].filter(Boolean);
  return [
    h('h2', { class: 'print-only' }, 'Standings'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: x === 'Edge' ? 'num' : null }, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.withdrawn ? 'withdrawn' : r.rank <= 3 && r.points > 0 ? `rank-${r.rank}` : '' },
        h('td', { class: 'rank' }, r.withdrawn ? '–' : h('span', { class: 'rank-badge' }, r.rank)),
        h('td', {}, r.name, r.withdrawn ? h('span', { class: 'muted' }, ' (withdrew)') : null),
        h('td', {}, r.games),
        h('td', {}, r.wins),
        bonus ? h('td', {}, r.bonus ? `+${r.bonus}` : '') : null,
        h('td', { class: 'points' }, r.points),
        h('td', { class: 'num' }, r.edge == null ? '–' : formatSigned(r.edge))))))),
    h('p', { class: 'muted' },
      'Games count only rounds with all results entered. ',
      bonus ? 'Bonus: 0.5 points per game fewer than the most games played. ' : '',
      rows.some((r) => r.withdrawn) ? 'Players who withdrew keep their wins, but get no bonus and no rank. ' : '',
      'Edge: how much stronger, on average, the team a player played in was than its opponents (team values): + = mostly in the stronger team, − = mostly in the weaker one, 0 = balanced.'),
  ];
}

function exportTournament(t) {
  saveFile(`${slugify(t.name)}.seedr.json`, JSON.stringify(t, null, 2), { nav: navigator, download: downloadFile });
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, String(value))];
}

// Manage lists everything read-only; changes happen on a sub-page (view.manage) that an
// Edit button opens, with Save and Cancel. Actions that change nothing stay direct buttons.
function manageTab(ctx, t) {
  const pages = { tournament: tournamentPage, players: playersPage, withdraw: withdrawPage, quality: qualityPage };
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
  Object.assign(ctx.state.view, { manage: null, names: null, withdraw: null });
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
  return [
    section('Rounds', h('p', { class: 'muted' }, hidden > 0
      ? `Rounds 1–${t.revealedRounds} of ${s.rounds} are revealed.`
      : `All ${s.rounds} rounds are revealed.`), [reveal, swap]),
    section('Tournament', h('dl', { class: 'facts' },
      fact('Name', t.name),
      fact('Courts', s.lastRoundCourts ? `${s.courts} (last round: ${s.lastRoundCourts})` : s.courts),
      fact('Rounds', s.rounds),
      fact('Match length', `${s.matchMinutes} min`),
      fact('Break', `${s.breakMinutes} min`),
      fact('Rounds revealed at a time', s.revealBatch === 'all' ? 'All' : s.revealBatch)),
    [h('button', { onclick: () => openPage(ctx, 'tournament') }, 'Edit')]),
    section('Players', [
      h('p', { class: 'muted' }, `${t.players.length - withdrawn} players${withdrawn ? ` (${withdrawn} withdrew)` : ''}. Skill 1 is the best, 10 the weakest.`),
      skillFacts(t)],
    [h('button', { onclick: () => openPage(ctx, 'players') }, 'Edit names'),
      h('button', { onclick: () => openPage(ctx, 'withdraw') }, 'Player leaves…')]),
    section('Draw quality', [quality.warnings, quality.q
      ? h('dl', { class: 'facts' },
        fact('Average edge', formatValue(Math.round(quality.q.avgGap * 100) / 100)),
        fact('Biggest edge', quality.q.worst ? formatValue(quality.q.worst.gap) : '–'))
      : h('p', { class: 'muted' }, 'Shown once the first round is revealed.')],
    [h('button', { onclick: () => openPage(ctx, 'quality') }, 'Details')]),
    summaryCard(t),
    section('Print & export', h('p', { class: 'muted' }, 'The printout has the summary, the player skills, the standings and all revealed rounds. The export is a file to keep the tournament safe or move it to another device.'), [
      h('button', { onclick: () => printAll(ctx) }, 'Print'),
      h('button', { onclick: () => exportTournament(t) }, 'Export (.seedr.json)')]),
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
  const locked = hasResults(t);
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
        ctx.state.draft = draftFromTournament(t);
        ctx.go('setup');
      },
    }, 'Change courts, rounds & times…')),
  ], [h('button', { class: 'primary', onclick: save }, 'Save')]);
}

// Names can be corrected at any time; the draw and the results stay as they are.
function playersPage(ctx, t) {
  // Edits not saved yet, by player id; kept when saving fails.
  const edits = (ctx.state.view.names ??= {});
  const save = () => {
    const names = Object.fromEntries(Object.entries(edits).filter(([id, name]) => t.players.find((p) => p.id === id)?.name !== name.trim()));
    try {
      if (Object.keys(names).length) ctx.save(renamePlayers(t, names));
      closePage(ctx);
    } catch (error) {
      ctx.state.message = error.message;
      ctx.render();
    }
  };
  return subPage(ctx, 'Player names', [
    h('p', { class: 'muted' }, 'Correct names at any time. The draw and the results stay as they are.'),
    h('div', { class: 'names-grid' }, t.players.map((p) => h('label', { class: 'field' },
      h('span', {}, `Skill ${p.skill}${isActive(p) ? '' : ' · withdrew'}`),
      h('input', { type: 'text', value: edits[p.id] ?? p.name, oninput: (e) => { edits[p.id] = e.target.value; } })))),
  ], [h('button', { class: 'primary', onclick: save }, 'Save')]);
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
  const warnings = drawWarnings(scheduleStats(t.players, t.schedule)).map((w) => h('p', { class: 'warning' }, w));
  const revealed = t.schedule.slice(0, t.revealedRounds);
  return { warnings, revealed, q: revealed.length ? drawQuality(t.players, revealed) : null };
}

function qualityPage(ctx, t) {
  const { warnings, revealed, q } = revealedQuality(t);
  const locked = hasResults(t);
  const one = (x) => (Math.round(x * 10) / 10).toString();
  const scope = revealed.length < t.schedule.length ? ` (rounds 1–${revealed.length} of ${t.schedule.length}, the revealed ones)` : '';
  return subPage(ctx, 'Draw quality', [
    warnings,
    q ? [
      h('p', { class: 'muted' }, `Edge = how much stronger one team is than the other in a match (team values: sum of skills + ¼ of the spread)${scope}.`),
      h('dl', { class: 'facts' },
        fact('Average edge', formatValue(Math.round(q.avgGap * 100) / 100)),
        fact('Biggest edge', q.worst ? `${formatValue(q.worst.gap)} (round ${q.worst.round}, court ${q.worst.court})` : '–'),
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
  const skills = [...new Set(t.players.map((p) => p.skill))].sort((a, b) => a - b);
  return h('dl', { class: 'facts' }, skills.map((skill) => fact(`Skill ${skill}`, t.players.filter((p) => p.skill === skill)
    .map((p) => (isActive(p) ? p.name : `${p.name} (withdrew)`)).join(', '))));
}

// The player skills for the printout.
function skillsCard(t) {
  return h('section', { class: 'card skills' },
    h('h2', { class: 'card-title' }, 'Player skills'),
    h('p', { class: 'muted' }, 'Skill 1 is the best, 10 the weakest.'),
    skillFacts(t),
    h('div', { style: 'height: 12px' }));
}

// Fun highlights of the results so far (Manage and the top of the printout).
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
