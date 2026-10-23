// Top-down tennis court for the page background, in feet: a 36 × 78 ft doubles court
// centered on a run-off area. It runs along the screen (top to bottom when upright,
// left to right on a wide screen) and is drawn for the screen's shape, so the whole
// court is visible and fills most of it. Its four quarters show the Grand Slam surfaces:
// Australian Open and US Open beyond the net, Wimbledon grass and Roland Garros clay in
// front.
const COURT_W = 36;
const COURT_L = 78;
const FILL = 0.92; // share of the screen the court takes along its limiting side
// Printed background: the paper is not known in advance, so the court is drawn for the
// middle between A4 (0.71) and Letter (0.78) and a little smaller, to fit both whole.
const PRINT_ASPECT = 0.745;
const PRINT_FILL = 0.84;
const COLORS = {
  ao: ['#2596be', '#1b7ea3'], // Australian Open: [court, run-off]
  uso: ['#1f3c88', '#172f6c'], // US Open
  wim: ['#006633', '#004f27'], // Wimbledon
  rg: ['#c8553d', '#a8432d'], // Roland Garros
};

// Court lines with the court's top-left corner at 0,0 and the net across the middle.
function courtLines() {
  const s1 = 4.5;
  const s2 = COURT_W - 4.5;
  const mid = COURT_W / 2;
  const net = COURT_L / 2;
  return [
    `<rect x="0" y="0" width="${COURT_W}" height="${COURT_L}"/>`, // doubles court
    `<path d="M${s1} 0V${COURT_L}M${s2} 0V${COURT_L}"/>`, // singles sidelines
    `<path d="M${s1} ${net - 21}H${s2}M${s1} ${net + 21}H${s2}"/>`, // service lines, 21 ft from the net
    `<path d="M${mid} ${net - 21}V${net + 21}M${mid} 0v1M${mid} ${COURT_L}v-1"/>`, // center service line and marks
    `<path d="M-3 ${net}H${COURT_W + 3}" stroke-width="0.6"/>`, // net
  ].join('');
}

// The court in a frame of `w` × `h` ft. `across`: the net runs from top to bottom.
function courtShapes(w, h, across) {
  const cw = across ? COURT_L : COURT_W;
  const ch = across ? COURT_W : COURT_L;
  const x0 = round1((w - cw) / 2);
  const y0 = round1((h - ch) / 2);
  // Quarters top-left, top-right, bottom-left, bottom-right; turned with the court.
  const order = across ? ['wim', 'ao', 'rg', 'uso'] : ['ao', 'uso', 'wim', 'rg'];
  const quarters = order.map((key, i) => [(i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), ...COLORS[key]]);
  const rect = (x, y, rw, rh, fill) => `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(rw)}" height="${round1(rh)}" fill="${fill}"/>`;
  const runOff = quarters.map(([x, y, , dark]) => rect(x, y, w / 2, h / 2, dark)).join('');
  const surface = quarters.map(([x, y, color]) => {
    const left = Math.max(x, x0);
    const top = Math.max(y, y0);
    return rect(left, top, Math.min(x + w / 2, x0 + cw) - left, Math.min(y + h / 2, y0 + ch) - top, color);
  }).join('');
  const place = across
    ? `translate(${round1(w / 2)} ${round1(h / 2)}) rotate(90) translate(${-COURT_W / 2} ${-COURT_L / 2})`
    : `translate(${x0} ${y0})`;
  return `${runOff}${surface}<g fill="none" stroke="#fff" stroke-width="0.3" transform="${place}">${courtLines()}</g>`;
}

const round1 = (x) => Math.round(x * 10) / 10;

// The court for a screen of the given shape (width / height). The frame has exactly that
// shape, so nothing is cropped, and the court fills `fill` of its limiting side.
export function courtSvg({ aspect, fill = FILL }) {
  const across = aspect > 1;
  const ratio = across ? 1 / aspect : aspect; // short side / long side
  const long = round1(Math.max(COURT_L / fill, COURT_W / (fill * ratio)));
  const short = round1(long * ratio);
  const [w, h] = across ? [long, short] : [short, long];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${courtShapes(w, h, across)}</svg>`;
}

// Sets the court picture as CSS variables (styles.css picks one by orientation) for the
// window's current shape, again whenever it changes, and for the page while printing.
export function installCourtBackground(root = document.documentElement, win = window) {
  const show = (aspect, fill) => {
    const url = `url("data:image/svg+xml,${encodeURIComponent(courtSvg({ aspect, fill }))}")`;
    root.style.setProperty('--court-portrait', url);
    root.style.setProperty('--court-landscape', url);
  };
  const fit = () => show(win.innerWidth / Math.max(1, win.innerHeight));
  let pending = false;
  win.addEventListener('resize', () => {
    if (pending) return;
    pending = true;
    win.requestAnimationFrame(() => { pending = false; fit(); });
  });
  win.addEventListener('beforeprint', () => show(PRINT_ASPECT, PRINT_FILL));
  win.addEventListener('afterprint', fit);
  fit();
}
