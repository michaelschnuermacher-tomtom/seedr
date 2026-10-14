import { h } from './dom.js';
import { PHOTOS, TOURNAMENT_PHOTO } from './photo-list.js';

const ROTATE_MS = 6000;
let heroTimer = null;
let heroIndex = 0; // survives re-renders, so tapping a result does not restart the slideshow

export function photoOrder() {
  return [TOURNAMENT_PHOTO, ...PHOTOS.filter((p) => p !== TOURNAMENT_PHOTO)];
}

// Photo banner behind the tournament title: starts with the tournament photo, then
// cross-fades through all photos. The next photo is shown only once it has loaded.
export function photoHero(...content) {
  const order = photoOrder();
  const layers = [h('div', { class: 'hero-photo visible' }), h('div', { class: 'hero-photo' })];
  layers[0].style.backgroundImage = `url("${order[heroIndex % order.length]}")`;
  let front = 0;
  const hero = h('header', { class: 'hero' }, layers, h('div', { class: 'hero-content' }, content));
  clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    if (!hero.isConnected) return;
    const next = (heroIndex + 1) % order.length;
    const img = new Image();
    img.onload = () => {
      if (!hero.isConnected) return;
      heroIndex = next;
      layers[1 - front].style.backgroundImage = `url("${order[next]}")`;
      layers[1 - front].classList.add('visible');
      layers[front].classList.remove('visible');
      front = 1 - front;
    };
    img.src = order[next];
  }, ROTATE_MS);
  return hero;
}
