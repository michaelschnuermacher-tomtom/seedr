import { h, newId } from './dom.js';
import { createStore, STORAGE_PREFIX, PEOPLE_KEY } from './store.js';
import { validateTournament } from '../engine/validate.js';
import { withPeople, withoutPeople } from '../engine/people.js';
import { homeScreen } from './home.js';
import { peopleScreen } from './people-view.js';
import { installCourtBackground } from './court.js';
import { installPrintHeader } from './print-header.js';
import { setupScreen, defaultPeople } from './setup.js';
import { tournamentScreen } from './tournament-view.js';

const SCREENS = { home: homeScreen, setup: setupScreen, tournament: tournamentScreen, people: peopleScreen };

const appRoot = document.getElementById('app');
const store = createStore(safeLocalStorage());
const state = { screen: 'home', tournament: null, view: null, draft: null, message: null };

function safeLocalStorage() {
  try {
    const storage = window.localStorage;
    storage.getItem('seedr.probe');
    return storage;
  } catch {
    return null;
  }
}

const ctx = {
  state,
  store,
  render,
  go(screen) {
    state.screen = screen;
    state.message = null;
    render();
  },
  flash(message) {
    state.message = message;
    render();
  },
  // The open tournament carries the names and years of birth of its players; stored, it
  // only refers to the people.
  save(t) {
    state.tournament = withPeople(t, ctx.people());
    if (!store.save(withoutPeople(t))) state.message = 'Could not save on this device. Use Export backup to keep your data.';
  },
  people() {
    return store.people() ?? [];
  },
  // Saves the people, and tournaments that changed with them (e.g. after splitting a person).
  savePeople(people, tournaments = []) {
    let ok = store.savePeople(people);
    for (const t of tournaments) ok = store.save(withoutPeople(t)) && ok;
    if (state.tournament) state.tournament = withPeople(store.get(state.tournament.id) ?? state.tournament, people);
    if (!ok) state.message = 'Could not save on this device. Use Export backup to keep your data.';
  },
  open(t) {
    const check = validateTournament(t);
    if (!check.ok) {
      ctx.flash(`Cannot open this tournament: ${check.error}`);
      return;
    }
    state.tournament = withPeople(t, ctx.people());
    state.view = null;
    ctx.go('tournament');
  },
};

function render() {
  const screen = SCREENS[state.screen] ?? homeScreen;
  const banner = state.message
    ? h('div', { class: 'banner', onclick: () => { state.message = null; render(); } }, state.message)
    : null;
  appRoot.replaceChildren(...[banner, screen(ctx)].filter(Boolean));
}

// A new device starts with the default players.
function addDefaultPeople() {
  if (!store.people()) store.savePeople(defaultPeople().map((p) => ({ ...p, id: newId() })));
}

// Another tab changed a tournament or the people: show the stored version instead of a stale copy.
window.addEventListener('storage', (event) => {
  if (event.key !== null && !event.key.startsWith(STORAGE_PREFIX) && event.key !== PEOPLE_KEY) return;
  if (state.tournament) {
    const fresh = store.get(state.tournament.id);
    if (fresh) {
      state.tournament = withPeople(fresh, ctx.people());
    } else {
      state.tournament = null;
      state.screen = 'home';
      state.message = 'This tournament was deleted in another window.';
    }
  }
  if (state.screen !== 'setup') render(); // re-rendering setup would drop typed input focus
});

if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

addDefaultPeople();
installCourtBackground();
installPrintHeader();
render();
