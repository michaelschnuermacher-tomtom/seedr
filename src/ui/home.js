import { h } from './dom.js';
import { logoDataUrl } from './logo.js';
import { exportBackup, importBackup } from './backup.js';
import { peoplePanel } from './people-view.js';

const HOME_TABS = [['tournaments', 'Tournaments'], ['players', 'Players'], ['backup', 'Backup']];

export function homeScreen(ctx) {
  const tab = (ctx.state.homeTab ??= 'tournaments');
  const body = tab === 'players' ? peoplePanel(ctx) : tab === 'backup' ? backupTab(ctx) : tournamentsTab(ctx);
  return h('main', { class: 'screen' },
    h('header', { class: 'top' }, h('div', { class: 'titles' },
      h('span', { class: 'eyebrow' }, 'Balanced doubles'),
      h('h1', { class: 'brand' }, h('img', { src: logoDataUrl(), alt: '' }), 'seedr'))),
    ctx.store.available ? null : h('p', { class: 'warning' }, 'This browser cannot save data. Use Backup to keep your tournaments.'),
    h('nav', { class: 'tabs' }, HOME_TABS.map(([key, label]) => h('button', {
      class: tab === key ? 'current' : '',
      onclick: () => {
        ctx.state.homeTab = key;
        ctx.state.peopleView = null; // the Players tab always opens on the list
        ctx.state.message = null;
        ctx.render();
      },
    }, label))),
    body);
}

function tournamentsTab(ctx) {
  const tournaments = ctx.store.list();
  return [
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => ctx.go('setup') }, 'New tournament')),
    tournaments.length === 0
      ? h('p', { class: 'muted' }, 'No tournaments saved on this device yet.')
      // Deleting is only possible in the tournament's Info tab, behind the password.
      : h('ul', { class: 'list' }, tournaments.map((t) => h('li', {},
        h('button', { class: 'link', onclick: () => ctx.open(t) },
          h('strong', {}, t.name),
          h('span', { class: 'muted' }, ` · ${t.players?.length ?? 0} players · ${new Date(t.createdAt).toLocaleDateString()}`),
          t.finishedAt ? h('span', { class: 'title-badge' }, 'Finished') : null)))),
  ];
}

function backupTab(ctx) {
  return h('section', { class: 'card' },
    h('h2', { class: 'card-title' }, 'Backup'),
    h('p', { class: 'muted' }, 'Browser storage can be lost. A backup is one file with all players and tournaments on this device; importing it adds them to another device or brings them back.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => exportBackup(ctx) }, 'Export backup'),
      h('label', { class: 'button' }, 'Import',
        h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { importBackup(ctx, e.target.files[0]); e.target.value = ''; } }))));
}
