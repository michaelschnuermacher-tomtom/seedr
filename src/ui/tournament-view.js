import { h, formatSigned, slugify } from './dom.js';
import { revealNext, redraw, setResult, hasResults } from '../engine/tournament.js';
import { resultKey, computeStandings } from '../engine/standings.js';
import { scheduleStats, drawWarnings } from '../engine/schedule.js';
import { newSeed } from '../engine/rng.js';

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
      h('button', { onclick: () => ctx.go('home') }, '‹ Home'),
      h('h1', {}, t.name)),
    h('nav', { class: 'tabs' }, TABS.map(([key, label]) =>
      h('button', { class: view.tab === key ? 'current' : '', onclick: () => { view.tab = key; ctx.render(); } }, label))),
    drawWarnings(scheduleStats(t.players, t.schedule)).map((w) => h('p', { class: 'warning' }, w)),
    body);
}

function roundsTab(ctx, t, view) {
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const names = (ids) => ids.map((id) => byId.get(id).name).join(' + ');
  const skillSum = (ids) => ids.reduce((sum, id) => sum + byId.get(id).skill, 0);
  const round = t.schedule[view.round - 1];

  const nav = h('nav', { class: 'round-nav' }, t.schedule.slice(0, t.revealedRounds).map((r) => h('button', {
    class: [r.round === view.round ? 'current' : '', roundComplete(t, r) ? 'complete' : ''].join(' ').trim(),
    onclick: () => { view.round = r.round; ctx.render(); },
  }, String(r.round))));

  const matches = round.matches.map((m) => {
    const winner = t.results[resultKey(round.round, m.court)];
    const side = (n, team) => h('button', {
      class: ['team', winner === n ? 'winner' : '', winner && winner !== n ? 'loser' : ''].join(' ').trim(),
      onclick: () => {
        ctx.save(setResult(t, round.round, m.court, winner === n ? null : n));
        ctx.render();
      },
    }, h('span', { class: 'names' }, names(team)), h('span', { class: 'sum' }, `Σ ${skillSum(team)}`));
    return h('div', { class: 'match' },
      h('div', { class: 'court' }, `Court ${m.court}`),
      side(1, m.team1),
      h('div', { class: 'vs' }, 'vs'),
      side(2, m.team2));
  });

  const hidden = t.settings.rounds - t.revealedRounds;
  const step = t.settings.revealBatch === 'all' ? hidden : Math.min(t.settings.revealBatch, hidden);
  const from = t.revealedRounds + 1;
  const revealLabel = step === 1 ? `Reveal round ${from}` : `Reveal rounds ${from}–${from + step - 1}`;

  return [
    nav,
    h('h2', {}, `Round ${round.round} of ${t.settings.rounds}`),
    h('p', { class: 'muted' }, 'Tap the winning team. Tap again to clear. Σ = sum of skills (lower = stronger).'),
    h('div', { class: 'matches' }, matches),
    round.sitOuts.length ? h('p', { class: 'muted' }, `Sitting out: ${round.sitOuts.map((id) => byId.get(id).name).join(', ')}`) : null,
    hidden > 0 ? h('button', {
      class: 'reveal primary',
      onclick: () => {
        ctx.save(revealNext(t));
        view.round = from;
        ctx.render();
      },
    }, revealLabel) : null,
  ];
}

function standingsTab(t) {
  const rows = computeStandings(t.players, t.schedule, t.results);
  const headers = ['#', 'Player', 'Skill', 'Games', 'Wins', 'Bonus', 'Points', 'Avg. advantage'];
  return [
    h('div', { class: 'table-wrap' }, h('table', { class: 'standings' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, r.rank),
        h('td', {}, r.name),
        h('td', {}, r.skill),
        h('td', {}, r.games),
        h('td', {}, r.wins),
        h('td', {}, r.bonus ? `+${r.bonus}` : ''),
        h('td', { class: 'points' }, r.points),
        h('td', {}, formatSigned(r.avgGap))))))),
    h('p', { class: 'muted' },
      'Games and bonus count only rounds with all results entered. Bonus: 0.5 points per game fewer than the most games played. ',
      'Avg. advantage: average difference in team strength per game (positive = played in the stronger team).'),
  ];
}

function exportTournament(t) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `${slugify(t.name)}.seedr.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fact(label, value) {
  return [h('dt', {}, label), h('dd', {}, String(value))];
}

function manageTab(ctx, t) {
  const s = t.settings;
  const locked = hasResults(t);
  return [
    h('dl', { class: 'facts' },
      fact('Players', t.players.length),
      fact('Courts', s.courts),
      fact('Rounds', s.rounds),
      fact('Match length', `${s.matchMinutes} min`),
      fact('Break', `${s.breakMinutes} min`),
      fact('Rounds revealed at a time', s.revealBatch === 'all' ? 'All' : s.revealBatch)),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => exportTournament(t) }, 'Export (.seedr.json)'),
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
    locked ? h('p', { class: 'muted' }, 'Redraw is only possible before the first result is entered.') : null,
  ];
}
