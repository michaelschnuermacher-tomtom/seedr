import { h, formatSigned, slugify } from './dom.js';
import { logoDataUrl } from './logo.js';
import { revealNext, redraw, setResult, hasResults, isActive, firstRedrawableRound, withdrawPlayers, renamePlayers, swapPlayers } from '../engine/tournament.js';
import { resultKey, computeStandings } from '../engine/standings.js';
import { scheduleStats, drawWarnings } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';
import { roundStartTimes } from '../engine/timeplan.js';
import { saveFile, downloadFile } from './export.js';
import { draftFromTournament } from './setup.js';
import { photoHero } from './hero.js';

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
    photoHero(
      h('button', { class: 'back', onclick: () => ctx.go('home') }, '‹ Home'),
      h('div', { class: 'titles' }, h('span', { class: 'eyebrow' }, h('img', { src: logoDataUrl(), alt: '' }), 'Seedr'), h('h1', {}, t.name))),
    h('nav', { class: 'tabs' }, TABS.map(([key, label]) =>
      h('button', { class: view.tab === key ? 'current' : '', onclick: () => { view.tab = key; ctx.render(); } }, label))),
    drawWarnings(scheduleStats(t.players, t.schedule)).map((w) => h('p', { class: 'warning' }, w)),
    body);
}

// Display data for all revealed rounds; hidden rounds are never included.
export function roundsOverview(t) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const team = (ids) => {
    const skills = ids.map((id) => byId.get(id).skill);
    return {
      names: ids.map((id) => byId.get(id).name).join(' + '),
      sum: skills.reduce((sum, s) => sum + s, 0),
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
        sumGap: Math.abs(team1.sum - team2.sum),
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
  }, h('span', { class: 'names' }, team.names), numbers ? h('span', { class: 'sum' }, `Σ ${team.sum} · ↔ ${team.spread}`) : null);
}

// Court label, with how far apart the two teams are when numbers are shown.
function courtLine(tag, m, numbers) {
  return h(tag, { class: 'court' }, `Court ${m.court}`,
    numbers ? h('span', { class: 'gaps' }, `Gap Σ ${m.sumGap} · ↔ ${m.spreadGap}`) : null);
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

// The "All rounds" view (once per page load) and every reveal ask for this password. It
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
  const layout = view.layout ?? 'one';

  const chooseLayout = (key) => {
    if (key === 'all' && !ctx.state.allRoundsUnlocked) {
      if (!askPassword(ctx, 'Password for all rounds:')) return;
      ctx.state.allRoundsUnlocked = true;
    }
    view.layout = key;
    ctx.render();
  };
  const layoutSwitch = h('nav', { class: 'tabs layout' }, [['one', 'One round'], ['all', 'All rounds']].map(([key, label]) =>
    h('button', { class: layout === key ? 'current' : '', onclick: () => chooseLayout(key) }, label)));
  const numbers = showNumbers(ctx);
  const numbersToggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: numbers, onchange: (e) => { setShowNumbers(ctx, e.target.checked); ctx.render(); } }),
    'Show sums and spreads');
  const hint = h('p', { class: 'muted' }, 'Tap the winning team. Tap again to clear.',
    numbers ? ' Σ = sum of skills (lower = stronger), ↔ = spread (skill difference between partners). Gap = difference between the two teams.' : '');
  const done = t.schedule.filter((r) => roundComplete(t, r)).length;
  const progress = h('div', { class: 'progress', title: `${done} of ${t.settings.rounds} rounds finished` },
    h('span', { style: `width: ${Math.round((100 * done) / t.settings.rounds)}%` }));

  const hidden = t.settings.rounds - t.revealedRounds;
  const step = t.settings.revealBatch === 'all' ? hidden : Math.min(t.settings.revealBatch, hidden);
  const from = t.revealedRounds + 1;
  const revealButton = hidden > 0 ? h('button', {
    class: 'reveal primary',
    onclick: () => {
      if (!askPassword(ctx, step === 1 ? `Password to reveal round ${from}:` : `Password to reveal rounds ${from}–${from + step - 1}:`)) return;
      ctx.save(revealNext(t));
      view.round = from;
      ctx.render();
    },
  }, step === 1 ? `Reveal round ${from}` : `Reveal rounds ${from}–${from + step - 1}`) : null;

  if (layout === 'all') {
    return [
      layoutSwitch,
      numbersToggle,
      progress,
      hint,
      h('div', { class: 'overview' }, rounds.map((r) => h('section', { class: `overview-round${r.complete ? ' complete' : ''}` },
        h('h3', {}, `Round ${r.round}${r.complete ? ' ✓' : ''}`, starts ? h('span', { class: 'start-time' }, starts[r.round - 1]) : null),
        r.matches.map((m) => h('div', { class: `mini-match ${courtColor(m.court)}` },
          courtLine('span', m, numbers),
          teamButton(ctx, t, r.round, m, 1, numbers),
          h('span', { class: 'vs' }, 'vs'),
          teamButton(ctx, t, r.round, m, 2, numbers))),
        r.sitOuts.length ? h('p', { class: 'muted' }, `Sitting out: ${r.sitOuts.join(', ')}`) : null))),
      revealButton,
    ];
  }

  const round = rounds[view.round - 1];
  const nav = h('nav', { class: 'round-nav' }, rounds.map((r) => h('button', {
    class: [r.round === view.round ? 'current' : '', r.complete ? 'complete' : ''].join(' ').trim(),
    onclick: () => { view.round = r.round; view.swapPick = null; ctx.render(); },
  }, String(r.round))));

  return [
    layoutSwitch,
    numbersToggle,
    nav,
    h('h2', {}, `Round ${round.round} of ${t.settings.rounds}`),
    starts ? h('p', { class: 'start-time' }, `Starts at ${starts[round.round - 1]}`) : null,
    progress,
    hint,
    view.swapping ? swapPanel(ctx, t, view, round, numbers) : [
      h('div', { class: 'matches' }, round.matches.map((m) => h('div', { class: `match ${courtColor(m.court)}` },
        courtLine('div', m, numbers),
        teamButton(ctx, t, round.round, m, 1, numbers),
        h('div', { class: 'vs' }, 'vs'),
        teamButton(ctx, t, round.round, m, 2, numbers)))),
      round.sitOuts.length ? h('p', { class: 'muted' }, `Sitting out: ${round.sitOuts.join(', ')}`) : null,
      h('div', { class: 'actions' }, h('button', {
        onclick: () => {
          if (!askPassword(ctx, 'Password to swap players:')) return;
          view.swapping = true;
          view.swapPick = null;
          ctx.render();
        },
      }, 'Swap players')),
    ],
    view.swapping ? null : revealButton,
  ];
}

// Tweaking the draw: tap two players of this round to swap them. Matches with a result
// are locked.
function swapPanel(ctx, t, view, round, numbers) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const r = t.schedule[round.round - 1];
  const tap = (id) => {
    if (!view.swapPick) view.swapPick = id;
    else if (view.swapPick === id) view.swapPick = null;
    else {
      try {
        ctx.save(swapPlayers(t, round.round, view.swapPick, id));
      } catch (error) {
        ctx.state.message = error.message;
      }
      view.swapPick = null;
    }
    ctx.render();
  };
  const chip = (id, locked) => h('button', {
    class: `chip${view.swapPick === id ? ' picked' : ''}`,
    disabled: locked,
    onclick: () => tap(id),
  }, `${byId.get(id).name} (${byId.get(id).skill})`);
  return [
    h('p', { class: 'warning' }, view.swapPick
      ? `Now tap the player to swap with ${byId.get(view.swapPick).name}.`
      : 'Swap mode: tap two players to swap them. Courts with a result are locked.'),
    h('div', { class: 'matches' }, r.matches.map((m, k) => {
      const locked = Boolean(t.results[resultKey(round.round, m.court)]);
      return h('div', { class: `match ${courtColor(m.court)}` },
        courtLine('div', round.matches[k], numbers),
        h('div', { class: 'chips' }, m.team1.map((id) => chip(id, locked))),
        h('div', { class: 'vs' }, locked ? 'vs · has a result' : 'vs'),
        h('div', { class: 'chips' }, m.team2.map((id) => chip(id, locked))));
    })),
    r.sitOuts.length ? h('div', {}, h('p', { class: 'muted' }, 'Sitting out:'), h('div', { class: 'chips' }, r.sitOuts.map((id) => chip(id, false)))) : null,
    h('div', { class: 'actions' }, h('button', {
      class: 'primary',
      onclick: () => {
        view.swapping = false;
        view.swapPick = null;
        ctx.render();
      },
    }, 'Done')),
  ];
}

function standingsTab(t) {
  const rows = computeStandings(t.players, t.schedule, t.results);
  const headers = ['#', 'Player', 'Skill', 'Games', 'Wins', 'Bonus', 'Points', 'Avg. advantage'];
  return [
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.withdrawn ? 'withdrawn' : r.rank <= 3 && r.points > 0 ? `rank-${r.rank}` : '' },
        h('td', { class: 'rank' }, r.withdrawn ? '–' : h('span', { class: 'rank-badge' }, r.rank)),
        h('td', {}, r.name, r.withdrawn ? h('span', { class: 'muted' }, ' (withdrew)') : null),
        h('td', {}, r.skill),
        h('td', {}, r.games),
        h('td', {}, r.wins),
        h('td', {}, r.bonus ? `+${r.bonus}` : ''),
        h('td', { class: 'points' }, r.points),
        h('td', {}, formatSigned(r.avgGap))))))),
    h('p', { class: 'muted' },
      'Games and bonus count only rounds with all results entered. Bonus: 0.5 points per game fewer than the most games played. ',
      rows.some((r) => r.withdrawn) ? 'Players who withdrew keep their wins, but get no bonus and no rank. ' : '',
      'Avg. advantage: average difference in team strength per game (positive = played in the stronger team).'),
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

function manageTab(ctx, t) {
  const s = t.settings;
  const locked = hasResults(t);
  const withdrawn = t.players.length - t.players.filter(isActive).length;
  return [
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
    renameCard(ctx, t),
    withdrawCard(ctx, t),
  ];
}
