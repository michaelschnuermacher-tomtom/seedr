import { h } from './dom.js';
import { PHOTOS, TOURNAMENT_PHOTO, PHOTO_INFO } from './photo-list.js';

const ROTATE_MS = 6000;
let heroTimer = null;
let heroIndex = 0; // survives re-renders, so tapping a result does not restart the slideshow

export function photoOrder() {
  return [TOURNAMENT_PHOTO, ...PHOTOS.filter((p) => p !== TOURNAMENT_PHOTO)];
}

// CSS background-position that keeps the focus point (fractions of the photo) inside a
// box when the photo is scaled to cover it, centered on the point where possible.
export function bannerPosition([fx, fy], imageW, imageH, boxW, boxH) {
  const scale = Math.max(boxW / imageW, boxH / imageH);
  const axis = (f, image, box) => {
    const overflow = image * scale - box;
    if (overflow < 0.5) return '50%';
    const offset = Math.min(Math.max(f * image * scale - box / 2, 0), overflow);
    return `${Math.round((1000 * offset) / overflow) / 10}%`;
  };
  return `${axis(fx, imageW, boxW)} ${axis(fy, imageH, boxH)}`;
}

function showPhoto(layer, photo, hero) {
  layer.dataset.photo = photo;
  layer.style.backgroundImage = `url("${photo}")`;
  aimPhoto(layer, hero);
}

function aimPhoto(layer, hero) {
  const [fx, fy, w, h] = PHOTO_INFO[layer.dataset.photo] ?? [0.5, 0.4, 4, 3];
  if (hero.clientWidth) layer.style.backgroundPosition = bannerPosition([fx, fy], w, h, hero.clientWidth, hero.clientHeight);
}

// Photo banner behind the tournament title: starts with the tournament photo, then
// cross-fades through all photos. The next photo is shown only once it has loaded.
export function photoHero(...content) {
  const order = photoOrder();
  const layers = [h('div', { class: 'hero-photo visible' }), h('div', { class: 'hero-photo' })];
  let front = 0;
  const hero = h('header', { class: 'hero' }, layers, h('div', { class: 'hero-content' }, content));
  showPhoto(layers[0], order[heroIndex % order.length], hero);
  // Re-aim when the banner gets its size or changes it (window resize, iPad rotation).
  new ResizeObserver(() => layers.forEach((layer) => layer.dataset.photo && aimPhoto(layer, hero))).observe(hero);
  clearInterval(heroTimer);
  heroTimer = setInterval(() => {
    if (!hero.isConnected) return;
    const next = (heroIndex + 1) % order.length;
    const img = new Image();
    img.onload = () => {
      if (!hero.isConnected) return;
      heroIndex = next;
      showPhoto(layers[1 - front], order[next], hero);
      layers[1 - front].classList.add('visible');
      layers[front].classList.remove('visible');
      front = 1 - front;
    };
    img.src = order[next];
  }, ROTATE_MS);
  return hero;
}
