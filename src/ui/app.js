import { h } from './dom.js';
import { createStore } from './store.js';
import { validateTournament } from '../engine/validate.js';
import { homeScreen } from './home.js';
import { setupScreen } from './setup.js';
import { tournamentScreen } from './tournament-view.js';

const SCREENS = { home: homeScreen, setup: setupScreen, tournament: tournamentScreen };

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
  save(t) {
    state.tournament = t;
    if (!store.save(t)) state.message = 'Could not save on this device. Use Export to keep your data.';
  },
  open(t) {
    const check = validateTournament(t);
    if (!check.ok) {
      ctx.flash(`Cannot open this tournament: ${check.error}`);
      return;
    }
    state.tournament = t;
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

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
