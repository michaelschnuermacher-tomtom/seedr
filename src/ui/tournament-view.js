import { h, formatSigned, slugify } from './dom.js';
import { logoDataUrl } from './logo.js';
import { revealNext, redraw, setResult, hasResults, isActive, firstRedrawableRound, withdrawPlayers, renamePlayers, renameTournament, swapPlayersAcross } from '../engine/tournament.js';
import { resultKey, computeStandings } from '../engine/standings.js';
import { scheduleStats, drawWarnings, teamValue, formatValue } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';
import { roundStartTimes } from '../engine/timeplan.js';
import { drawQuality } from '../engine/quality.js';
import { saveFile, downloadFile } from './export.js';
import { draftFromTournament } from './setup.js';

const TABS = [['rounds', 'Rounds'], ['standings', 'Standings'], ['manage', 'Manage']];

function roundComplete(t, round) {
  return round.matches.every((m) => t.results[resultKey(round.round, m.court)]);
}

function firstOpenRound(t) {
  const open = t.schedule.slice(0, t.revealedRounds).find((r) => !roundComplete(t, r));
  return open ? open.round : Math.max(1, t.revealedRounds);
}

export function tournamentScreen(ctx) {
  const t = ctx.state.tournament;
  const view = (ctx.state.view ??= { tab: 'rounds', round: firstOpenRound(t) });
  view.round = Math.min(Math.max(1, view.round), Math.max(1, t.revealedRounds));
  const body = view.tab === 'standings' ? standingsTab(t)
    : view.tab === 'manage' ? manageTab(ctx, t)
      : roundsTab(ctx, t, view);
  return h('main', { class: 'screen' },
    h('header', { class: 'top' },
      h('button', { class: 'back', onclick: () => ctx.go('home') }, '‹ Home'),
      h('div', { class: 'titles' }, h('span', { class: 'eyebrow' }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'), h('h1', {}, t.name))),
    h('nav', { class: 'tabs' }, TABS.map(([key, label]) =>
      h('button', {
        class: view.tab === key ? 'current' : '',
        onclick: () => {
          // Manage holds every option that changes or reveals the draw: password each time.
          if (key === 'manage' && view.tab !== 'manage' && !askPassword(ctx, 'Password for Manage:')) return;
          view.tab = key;
          ctx.render();
        },
      }, label))),
    drawWarnings(scheduleStats(t.players, t.schedule)).map((w) => h('p', { class: 'warning no-print' }, w)),
    body);
}

// Display data for all revealed rounds; hidden rounds are never included.
export function roundsOverview(t) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const team = (ids) => {
    const skills = ids.map((id) => byId.get(id).skill);
    return {
      names: ids.map((id) => byId.get(id).name).join(' + '),
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

function teamButton(ctx, t, round, match, n, numbers) {
  const team = n === 1 ? match.team1 : match.team2;
  const { winner } = match;
  return h('button', {
    class: ['team', winner === n ? 'winner' : '', winner && winner !== n ? 'loser' : ''].join(' ').trim(),
    onclick: () => {
      ctx.save(setResult(t, round, match.court, winner === n ? null : n));
      ctx.render();
    },
  }, h('span', { class: 'names' }, team.names), numbers ? h('span', { class: 'sum' }, `${formatValue(team.value)} · ↔ ${team.spread}`) : null);
}

// Court label, with how far apart the two teams are when numbers are shown.
function courtLine(tag, m, numbers) {
  return h(tag, { class: 'court' }, `Court ${m.court}`,
    numbers ? h('span', { class: 'gaps' }, `Gap ${formatValue(m.valueGap)} · ↔ ${m.spreadGap}`) : null);
}

// Whether team sums and spreads are shown; remembered on this device.
const NUMBERS_KEY = 'seedr.showNumbers';

function showNumbers(ctx) {
  if (ctx.state.showNumbers == null) {
    try {
      ctx.state.showNumbers = window.localStorage.getItem(NUMBERS_KEY) !== 'no';
    } catch {
      ctx.state.showNumbers = true;
    }
  }
  return ctx.state.showNumbers;
}

function setShowNumbers(ctx, on) {
  ctx.state.showNumbers = on;
  try {
    window.localStorage.setItem(NUMBERS_KEY, on ? 'yes' : 'no');
  } catch {
    // Not remembered, but still applies until the page is reloaded.
  }
}

// Manage asks for this password every time it is opened. It
// only keeps players from peeking: anyone can read it in the app's source.
const ALL_ROUNDS_PASSWORD = 'Tenerife';

export function isAllRoundsPassword(input) {
  return input != null && input.trim() === ALL_ROUNDS_PASSWORD;
}

// Asks for the password; false when cancelled or wrong.
function askPassword(ctx, question) {
  const input = prompt(question);
  if (input == null) return false;
  if (isAllRoundsPassword(input)) return true;
  ctx.flash('Wrong password.');
  return false;
}

function roundsTab(ctx, t, view) {
  const rounds = roundsOverview(t);
  const starts = t.settings.endTime ? roundStartTimes(t.settings) : null;
  // The view (one round or all), the numbers, revealing, swapping and printing are all
  // set in Manage.
  const layout = view.layout ?? 'one';
  const numbers = showNumbers(ctx);
  const hint = h('p', { class: 'muted no-print' }, 'Tap the winning team. Tap again to clear.',
    numbers ? ' Team value = sum of skills + ¼ of the spread (lower = stronger), ↔ = spread (skill difference between partners). Gap = difference between the two teams.' : '');
  const done = t.schedule.filter((r) => roundComplete(t, r)).length;
  const progress = h('div', { class: 'progress', title: `${done} of ${t.settings.rounds} rounds finished` },
    h('span', { style: `width: ${Math.round((100 * done) / t.settings.rounds)}%` }));

  const hidden = t.settings.rounds - t.revealedRounds;
  const comingUp = hidden > 0 ? h('p', { class: 'muted no-print' }, hidden === 1 ? '1 more round to come.' : `${hidden} more rounds to come.`) : null;
  const swapping = Boolean(view.swapping);

  if (layout === 'all') {
    return [
      h('h2', { class: 'print-only' }, 'Rounds'),
      progress,
      swapping ? swapHeader(ctx, t, view) : hint,
      h('div', { class: 'overview' }, rounds.map((r) => h('section', { class: `overview-round${r.complete ? ' complete' : ''}` },
        h('h3', {}, `Round ${r.round}${r.complete ? ' ✓' : ''}`, starts ? h('span', { class: 'start-time' }, starts[r.round - 1]) : null),
        swapping ? swapRound(ctx, t, view, r, numbers, true) : [
          r.matches.map((m) => h('div', { class: `mini-match ${courtColor(m.court)}` },
            courtLine('span', m, numbers),
            teamButton(ctx, t, r.round, m, 1, numbers),
            h('span', { class: 'vs' }, 'vs'),
            teamButton(ctx, t, r.round, m, 2, numbers))),
          r.sitOuts.length ? h('p', { class: 'muted' }, `Sitting out: ${r.sitOuts.join(', ')}`) : null,
        ]))),
      swapping ? swapDone(ctx, view) : comingUp,
    ];
  }

  const round = rounds[view.round - 1];
  const nav = h('nav', { class: 'round-nav' }, rounds.map((r) => h('button', {
    class: [r.round === view.round ? 'current' : '', r.complete ? 'complete' : ''].join(' ').trim(),
    onclick: () => { view.round = r.round; ctx.render(); },
  }, String(r.round))));

  return [
    nav,
    h('h2', {}, `Round ${round.round} of ${t.settings.rounds}`),
    starts ? h('p', { class: 'start-time' }, `Starts at ${starts[round.round - 1]}`) : null,
    progress,
    swapping ? [swapHeader(ctx, t, view), swapRound(ctx, t, view, round, numbers, false), swapDone(ctx, view)] : [
      hint,
      h('div', { class: 'matches' }, round.matches.map((m) => h('div', { class: `match ${courtColor(m.court)}` },
        courtLine('div', m, numbers),
        teamButton(ctx, t, round.round, m, 1, numbers),
        h('div', { class: 'vs' }, 'vs'),
        teamButton(ctx, t, round.round, m, 2, numbers)))),
      round.sitOuts.length ? h('p', { class: 'muted' }, `Sitting out: ${round.sitOuts.join(', ')}`) : null,
      comingUp,
    ],
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

// One round's matches and sit-outs as player buttons; `mini` for the All rounds view.
function swapRound(ctx, t, view, round, numbers, mini) {
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
  }, `${byId.get(id).name} (${byId.get(id).skill})`);
  const matches = r.matches.map((m, k) => {
    const locked = Boolean(t.results[resultKey(round.round, m.court)]);
    return h('div', { class: `match swap ${courtColor(m.court)}` },
      courtLine('div', round.matches[k], numbers),
      h('div', { class: 'chips' }, m.team1.map((id) => chip(id, locked))),
      h('div', { class: 'vs' }, locked ? 'vs · has a result' : 'vs'),
      h('div', { class: 'chips' }, m.team2.map((id) => chip(id, locked))));
  });
  return [
    mini ? matches : h('div', { class: 'matches' }, matches),
    r.sitOuts.length ? h('div', { class: 'sit-outs' }, h('p', { class: 'muted' }, 'Sitting out:'), h('div', { class: 'chips' }, r.sitOuts.map((id) => chip(id, false)))) : null,
  ];
}

// Prints the standings or all revealed rounds without buttons and controls (see
// @media print): shows that tab, prints, and comes back to Manage.
function printTab(ctx, tab) {
  const view = ctx.state.view;
  const layout = view.layout;
  view.tab = tab;
  if (tab === 'rounds') view.layout = 'all';
  ctx.render();
  const back = () => {
    view.tab = 'manage';
    view.layout = layout;
    ctx.render();
  };
  window.addEventListener('afterprint', back, { once: true });
  setTimeout(() => window.print(), 50); // let the browser lay out the tab first
}

function standingsTab(t) {
  const rows = computeStandings(t.players, t.schedule, t.results);
  // The Bonus column only appears once someone has bonus points.
  const bonus = rows.some((r) => r.bonus);
  const headers = ['#', 'Player', 'Games', 'Wins', bonus ? 'Bonus' : null, 'Points', 'PAS'].filter(Boolean);
  return [
    h('h2', { class: 'print-only' }, 'Standings'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.withdrawn ? 'withdrawn' : r.rank <= 3 && r.points > 0 ? `rank-${r.rank}` : '' },
        h('td', { class: 'rank' }, r.withdrawn ? '–' : h('span', { class: 'rank-badge' }, r.rank)),
        h('td', {}, r.name, r.withdrawn ? h('span', { class: 'muted' }, ' (withdrew)') : null),
        h('td', {}, r.games),
        h('td', {}, r.wins),
        bonus ? h('td', {}, r.bonus ? `+${r.bonus}` : '') : null,
        h('td', { class: 'points' }, r.points),
        h('td', {}, r.pas == null ? '–' : formatSigned(r.pas))))))),
    h('p', { class: 'muted' },
      'Games count only rounds with all results entered. ',
      bonus ? 'Bonus: 0.5 points per game fewer than the most games played. ' : '',
      rows.some((r) => r.withdrawn) ? 'Players who withdrew keep their wins, but get no bonus and no rank. ' : '',
      'PAS (Path Advantage Score): the average gap between the two team values in the games a player played, from their side: + = mostly in the stronger team, − = mostly in the weaker one, 0 = balanced.'),
  ];
}

function exportTournament(t) {
  saveFile(`${slugify(t.name)}.seedr.json`, JSON.stringify(t, null, 2), { nav: navigator, download: downloadFile });
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, String(value))];
}

// A player who cannot go on: keep the rounds played so far and draw the rest again.
function withdrawCard(ctx, t) {
  const from = firstRedrawableRound(t);
  const last = t.settings.rounds;
  const active = t.players.filter(isActive);
  const chosen = (ctx.state.view.withdraw ??= new Set());
  const canRedraw = hasResults(t) && from <= last;
  const rounds = from === last ? `round ${last}` : `rounds ${from}–${last}`;
  const button = h('button', {
    class: 'primary',
    disabled: !canRedraw || chosen.size === 0 || active.length - chosen.size < 4,
    onclick: (e) => {
      const names = active.filter((p) => chosen.has(p.id)).map((p) => p.name).join(', ');
      if (!confirm(`Withdraw ${names} and redraw ${rounds}? This cannot be undone.`)) return;
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Drawing…';
      setTimeout(() => { // let the browser paint "Drawing…" first
        try {
          ctx.save(withdrawPlayers(t, [...chosen], newSeed()));
          ctx.state.view.withdraw = null;
          ctx.state.view.tab = 'rounds';
          ctx.state.view.round = Math.min(from, ctx.state.tournament.revealedRounds);
        } catch (error) {
          ctx.state.message = error.message;
        }
        ctx.render();
      }, 20);
    },
  }, `Withdraw and redraw ${rounds}`);
  const note = !hasResults(t) ? 'Before the first result, remove players with Edit settings.'
    : from > last ? 'All rounds have results, there is nothing left to redraw.'
      : `${from === 2 ? 'Round 1 stays' : `Rounds 1–${from - 1} stay`} as played; ${rounds} will be drawn again without the chosen players. At least 4 players must remain.`;
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Player leaves'),
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
    canRedraw ? h('div', { class: 'actions' }, button) : null);
}

// Names can be corrected at any time; the draw and the results stay as they are.
// The tournament name can be changed at any time.
function nameCard(ctx, t) {
  const input = h('input', { type: 'text', value: t.name });
  const save = () => {
    if (input.value.trim() === t.name) return;
    ctx.state.message = null;
    try {
      ctx.save(renameTournament(t, input.value));
    } catch (error) {
      ctx.state.message = error.message;
    }
    ctx.render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Tournament name'),
    h('div', { class: 'row' }, input, h('button', { class: 'primary', onclick: save }, 'Save name')));
}

function renameCard(ctx, t) {
  // Edits not saved yet, by player id; kept when saving fails.
  const edits = (ctx.state.view.names ??= {});
  const save = () => {
    const names = Object.fromEntries(Object.entries(edits).filter(([id, name]) => t.players.find((p) => p.id === id)?.name !== name.trim()));
    if (Object.keys(names).length === 0) return;
    ctx.state.message = null;
    try {
      ctx.save(renamePlayers(t, names));
      ctx.state.view.names = null;
    } catch (error) {
      ctx.state.message = error.message;
    }
    ctx.render();
  };
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Player names'),
    h('p', { class: 'muted' }, 'Correct names at any time. The draw and the results stay as they are.'),
    h('div', { class: 'names-grid' }, t.players.map((p) => h('label', { class: 'field' },
      h('span', {}, `Skill ${p.skill}${isActive(p) ? '' : ' · withdrew'}`),
      h('input', { type: 'text', value: edits[p.id] ?? p.name, oninput: (e) => { edits[p.id] = e.target.value; } })))),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: save }, 'Save names')));
}

// How even and how varied the draw is, over the revealed rounds only: repeated
// pairings would otherwise give away hidden rounds.
function qualityCard(t) {
  const revealed = t.schedule.slice(0, t.revealedRounds);
  if (revealed.length === 0) return null;
  const q = drawQuality(t.players, revealed);
  const one = (x) => (Math.round(x * 10) / 10).toString();
  const scope = revealed.length < t.schedule.length ? ` (rounds 1–${revealed.length} of ${t.schedule.length}, the revealed ones)` : '';
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Draw quality'),
    h('p', { class: 'muted' }, `Team value gap = difference between the two teams' values (sum of skills + ¼ of the spread)${scope}.`),
    h('dl', { class: 'facts' },
      fact('Average gap', formatValue(Math.round(q.avgGap * 100) / 100)),
      fact('Biggest gap', q.worst ? `${formatValue(q.worst.gap)} (round ${q.worst.round}, court ${q.worst.court})` : '–'),
      fact('Different partners', `${one(q.partners.distinct)} per player${q.partners.repeats ? `, ${q.partners.repeats} repeated` : ', none repeated'}`),
      fact('Different opponents', `${one(q.opponents.distinct)} per player`),
      fact('Repeated opponents', q.opponents.repeats
        ? `${q.opponents.repeats} meeting(s) again${q.opponents.thirds ? `, ${q.opponents.thirds} a third time or more` : ''}`
        : 'none'),
      q.opponents.most.length ? fact('Most often opponents', q.opponents.most.map((m) => `${m.names.join(' & ')} ${m.times}×`).join(', ')) : null,
      fact('Sitting out twice in a row', q.sitOuts.backToBack ? `${q.sitOuts.backToBack}×, longest ${q.sitOuts.longestRun} rounds` : 'never')),
    h('div', { style: 'height: 12px' }));
}

// Everything that changes or reveals the draw, behind the Manage password.
function roundsOptionsCard(ctx, t) {
  const view = ctx.state.view;
  const hidden = t.settings.rounds - t.revealedRounds;
  const step = t.settings.revealBatch === 'all' ? hidden : Math.min(t.settings.revealBatch, hidden);
  const from = t.revealedRounds + 1;
  const reveal = hidden > 0 ? h('button', {
    class: 'primary',
    onclick: () => {
      ctx.save(revealNext(t));
      view.round = from;
      ctx.state.message = step === 1 ? `Round ${from} is revealed.` : `Rounds ${from}–${from + step - 1} are revealed.`;
      ctx.render();
    },
  }, step === 1 ? `Reveal round ${from}` : `Reveal rounds ${from}–${from + step - 1}`) : null;
  const layout = view.layout ?? 'one';
  const layoutSwitch = h('nav', { class: 'tabs layout' }, [['one', 'One round'], ['all', 'All rounds']].map(([key, label]) =>
    h('button', { class: layout === key ? 'current' : '', onclick: () => { view.layout = key; ctx.render(); } }, label)));
  const numbers = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: showNumbers(ctx), onchange: (e) => { setShowNumbers(ctx, e.target.checked); ctx.render(); } }),
    'Show team values and spreads (on this device)');
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Rounds & display'),
    h('p', { class: 'muted' }, hidden > 0
      ? `Rounds 1–${t.revealedRounds} of ${t.settings.rounds} are revealed.`
      : `All ${t.settings.rounds} rounds are revealed.`),
    h('p', { class: 'muted' }, 'The Rounds tab shows:'),
    layoutSwitch,
    numbers,
    h('div', { class: 'actions' },
      reveal,
      h('button', {
        onclick: () => {
          view.swapping = true;
          view.swapPick = null;
          view.tab = 'rounds';
          ctx.render();
        },
      }, 'Swap players'),
      h('button', { onclick: () => printTab(ctx, 'rounds') }, 'Print rounds'),
      h('button', { onclick: () => printTab(ctx, 'standings') }, 'Print standings')));
}

function manageTab(ctx, t) {
  const s = t.settings;
  const locked = hasResults(t);
  const withdrawn = t.players.length - t.players.filter(isActive).length;
  return [
    roundsOptionsCard(ctx, t),
    nameCard(ctx, t),
    h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Settings'), h('dl', { class: 'facts' },
      fact('Players', withdrawn ? `${t.players.length - withdrawn} (${withdrawn} withdrew)` : t.players.length),
      fact('Courts', s.lastRoundCourts ? `${s.courts} (last round: ${s.lastRoundCourts})` : s.courts),
      fact('Rounds', s.rounds),
      fact('Match length', `${s.matchMinutes} min`),
      fact('Break', `${s.breakMinutes} min`),
      s.endTime ? fact('End time', s.endTime) : null,
      fact('Rounds revealed at a time', s.revealBatch === 'all' ? 'All' : s.revealBatch)), h('div', { style: 'height: 12px' })),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => exportTournament(t) }, 'Export (.seedr.json)'),
      h('button', {
        disabled: locked,
        onclick: () => {
          ctx.state.draft = draftFromTournament(t);
          ctx.go('setup');
        },
      }, 'Edit settings'),
      h('button', {
        disabled: locked,
        onclick: () => {
          if (!confirm('Draw a completely new schedule?')) return;
          ctx.save(redraw(t, newSeed()));
          ctx.state.view.round = 1;
          ctx.render();
        },
      }, 'Redraw schedule'),
      h('button', {
        class: 'danger',
        onclick: () => {
          if (!confirm(`Delete "${t.name}" from this device? Export it first if you want to keep it.`)) return;
          ctx.store.remove(t.id);
          ctx.state.tournament = null;
          ctx.go('home');
        },
      }, 'Delete tournament')),
    locked ? h('p', { class: 'muted' }, 'Settings and the draw can only be changed before the first result is entered.') : null,
    qualityCard(t),
    renameCard(ctx, t),
    withdrawCard(ctx, t),
  ];
}
