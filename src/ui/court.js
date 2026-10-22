// Top-down tennis courts for the page background, in feet: two 36 × 78 ft doubles courts
// lying sideways, one above the other with 12 ft between them, on a run-off area. The
// picture is drawn for the screen's shape, so both courts are always fully visible and
// fill most of it. Each court's four quarters show the Grand Slam surfaces.
const COURT_W = 36;
const COURT_L = 78;
const GAP = 12; // run-off between the two courts
const FILL = 0.92; // share of the screen the courts take along the limiting side
const PRINT_ASPECT = 0.69; // A4 or Letter page, upright, without margins
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

// One sideways court (net from top to bottom) with its top-left corner at x0, y0, on the
// run-off area from `top` to `bottom` across the full width `w`. The run-off is split
// into quarters at the net and at the court's middle, each in its Grand Slam color.
function courtShapes(w, top, bottom, x0, y0) {
  const midX = x0 + COURT_L / 2;
  const midY = y0 + COURT_W / 2;
  // Quarters top-left, top-right, bottom-left, bottom-right.
  const quarters = ['wim', 'ao', 'rg', 'uso'].map((key, i) => {
    const [left, right] = i % 2 ? [midX, w] : [0, midX];
    const [upper, lower] = i < 2 ? [top, midY] : [midY, bottom];
    return [left, upper, right - left, lower - upper, ...COLORS[key]];
  });
  const rect = (x, y, rw, rh, fill) => `<rect x="${round1(x)}" y="${round1(y)}" width="${round1(rw)}" height="${round1(rh)}" fill="${fill}"/>`;
  const runOff = quarters.map(([x, y, rw, rh, , dark]) => rect(x, y, rw, rh, dark)).join('');
  const surface = quarters.map(([x, y, rw, rh, color]) => {
    const left = Math.max(x, x0);
    const upper = Math.max(y, y0);
    return rect(left, upper, Math.min(x + rw, x0 + COURT_L) - left, Math.min(y + rh, y0 + COURT_W) - upper, color);
  }).join('');
  const place = `translate(${round1(midX)} ${round1(midY)}) rotate(90) translate(${-COURT_W / 2} ${-COURT_L / 2})`;
  return `${runOff}${surface}<g fill="none" stroke="#fff" stroke-width="0.3" transform="${place}">${courtLines()}</g>`;
}

const round1 = (x) => Math.round(x * 10) / 10;

// Both courts for a screen of the given shape (width / height). The frame has exactly
// that shape, so nothing is cropped, and the courts fill FILL of its limiting side.
export function courtSvg({ aspect }) {
  const blockH = 2 * COURT_W + GAP;
  const h = round1(Math.max(blockH / FILL, COURT_L / (FILL * aspect)));
  const w = round1(h * aspect);
  const x0 = (w - COURT_L) / 2;
  const y0 = (h - blockH) / 2;
  const middle = h / 2; // halfway between the courts: where one run-off area ends
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">`
    + courtShapes(w, 0, middle, x0, y0)
    + courtShapes(w, middle, h, x0, y0 + COURT_W + GAP)
    + '</svg>';
}

// Sets the court picture as CSS variables (styles.css picks one by orientation) for the
// window's current shape, again whenever it changes, and for the page while printing.
export function installCourtBackground(root = document.documentElement, win = window) {
  const show = (aspect) => {
    const url = `url("data:image/svg+xml,${encodeURIComponent(courtSvg({ aspect }))}")`;
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
  win.addEventListener('beforeprint', () => show(PRINT_ASPECT));
  win.addEventListener('afterprint', fit);
  fit();
}
