// Top-down tennis court for the page background, in feet: a 36 × 78 ft doubles court
// centered on a larger run-off area. The court lies across the screen: sideways on a
// phone held upright, lengthwise on a wide screen. The frame is narrow enough that the
// whole court stays visible when the picture is cropped to the screen. Its four
// quarters show the Grand Slam surfaces.
const COURT_W = 36;
const COURT_L = 78;
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
  const x0 = (w - cw) / 2;
  const y0 = (h - ch) / 2;
  // Quarters top-left, top-right, bottom-left, bottom-right; turned with the court.
  const order = across ? ['wim', 'ao', 'rg', 'uso'] : ['ao', 'uso', 'wim', 'rg'];
  const quarters = order.map((key, i) => [(i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), ...COLORS[key]]);
  const runOff = quarters.map(([x, y, , dark]) => `<rect x="${x}" y="${y}" width="${w / 2}" height="${h / 2}" fill="${dark}"/>`).join('');
  const surface = quarters.map(([x, y, color]) => {
    const left = Math.max(x, x0);
    const top = Math.max(y, y0);
    return `<rect x="${left}" y="${top}" width="${Math.min(x + w / 2, x0 + cw) - left}" height="${Math.min(y + h / 2, y0 + ch) - top}" fill="${color}"/>`;
  }).join('');
  const place = across
    ? `translate(${w / 2} ${h / 2}) rotate(90) translate(${-COURT_W / 2} ${-COURT_L / 2})`
    : `translate(${x0} ${y0})`;
  return `${runOff}${surface}<g fill="none" stroke="#fff" stroke-width="0.3" transform="${place}">${courtLines()}</g>`;
}

// Portrait: a tall frame (about a phone's shape) with the court sideways. Landscape: a
// wide frame with the court lengthwise from top to bottom.
export function courtSvg({ landscape }) {
  const [w, h] = landscape ? [178, 82] : [82, 178];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${courtShapes(w, h, !landscape)}</svg>`;
}

// Sets the two court pictures as CSS variables; styles.css picks one by orientation.
export function installCourtBackground(root = document.documentElement) {
  for (const landscape of [false, true]) {
    const url = `url("data:image/svg+xml,${encodeURIComponent(courtSvg({ landscape }))}")`;
    root.style.setProperty(landscape ? '--court-landscape' : '--court-portrait', url);
  }
}
