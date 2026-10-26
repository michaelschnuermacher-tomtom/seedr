import { h } from './dom.js';
import { logoDataUrl } from './logo.js';
import { exportBackup, importBackup } from './backup.js';

export function homeScreen(ctx) {
  const tournaments = ctx.store.list();
  return h('main', { class: 'screen' },
    h('header', { class: 'top' }, h('div', { class: 'titles' },
      h('span', { class: 'eyebrow' }, 'Balanced doubles'),
      h('h1', { class: 'brand' }, h('img', { src: logoDataUrl(), alt: '' }), 'seedr'))),
    ctx.store.available ? null : h('p', { class: 'warning' }, 'This browser cannot save data. Use Export backup to keep your tournaments.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => ctx.go('setup') }, 'New tournament'),
      h('button', { onclick: () => { ctx.state.peopleReturn = 'home'; ctx.go('people'); } }, 'Players')),
    tournaments.length === 0
      ? h('p', { class: 'muted' }, 'No tournaments saved on this device yet.')
      // Deleting is only possible in Manage, behind its password.
      : h('ul', { class: 'list' }, tournaments.map((t) => h('li', {},
        h('button', { class: 'link', onclick: () => ctx.open(t) },
          h('strong', {}, t.name),
          h('span', { class: 'muted' }, ` · ${t.players?.length ?? 0} players · ${new Date(t.createdAt).toLocaleDateString()}`))))),
    h('section', { class: 'card backup' },
      h('h2', { class: 'card-title' }, 'Backup'),
      h('p', { class: 'muted' }, 'Browser storage can be lost. A backup is one file with all players and tournaments on this device; importing it adds them to another device or brings them back. Older tournament files can be imported too.'),
      h('div', { class: 'actions' },
        h('button', { onclick: () => exportBackup(ctx) }, 'Export backup'),
        h('label', { class: 'button' }, 'Import',
          h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { importBackup(ctx, e.target.files[0]); e.target.value = ''; } })))),
  );
}
