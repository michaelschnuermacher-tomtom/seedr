// Top-down tennis court for the page background, in feet: a 36 × 78 ft doubles court
// centered on a larger run-off area, so the whole court fits on screen. Its four
// quarters show the Grand Slam surfaces: Australian Open and US Open beyond the net,
// Wimbledon grass and Roland Garros clay in front.
const W = 84;
const H = 150;
const X0 = (W - 36) / 2; // doubles sideline
const Y0 = (H - 78) / 2; // baseline
const NET = H / 2;
const QUARTERS = [
  // [x, y, court color, run-off color]
  [0, 0, '#2596be', '#1b7ea3'], // Australian Open
  [W / 2, 0, '#1f3c88', '#172f6c'], // US Open
  [0, NET, '#006633', '#004f27'], // Wimbledon
  [W / 2, NET, '#c8553d', '#a8432d'], // Roland Garros
];

function courtShapes() {
  const runOff = QUARTERS.map(([x, y, , dark]) => `<rect x="${x}" y="${y}" width="${W / 2}" height="${NET}" fill="${dark}"/>`).join('');
  const surface = QUARTERS.map(([x, y, color]) => {
    const left = Math.max(x, X0);
    const top = Math.max(y, Y0);
    return `<rect x="${left}" y="${top}" width="${Math.min(x + W / 2, X0 + 36) - left}" height="${Math.min(y + NET, Y0 + 78) - top}" fill="${color}"/>`;
  }).join('');
  const s1 = X0 + 4.5;
  const s2 = X0 + 31.5;
  const mid = W / 2;
  const lines = [
    `<rect x="${X0}" y="${Y0}" width="36" height="78"/>`, // doubles court
    `<path d="M${s1} ${Y0}V${Y0 + 78}M${s2} ${Y0}V${Y0 + 78}"/>`, // singles sidelines
    `<path d="M${s1} ${NET - 21}H${s2}M${s1} ${NET + 21}H${s2}"/>`, // service lines, 21 ft from the net
    `<path d="M${mid} ${NET - 21}V${NET + 21}M${mid} ${Y0}v1M${mid} ${Y0 + 78}v-1"/>`, // center service line and marks
  ].join('');
  const net = `<path d="M${X0 - 3} ${NET}H${X0 + 39}" stroke-width="0.6"/>`;
  return `${runOff}${surface}<g fill="none" stroke="#fff" stroke-width="0.3">${lines}${net}</g>`;
}

export function courtSvg({ landscape }) {
  return landscape
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${H} ${W}" preserveAspectRatio="xMidYMid slice"><g transform="translate(${H} 0) rotate(90)">${courtShapes()}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${courtShapes()}</svg>`;
}

// Sets the two court pictures as CSS variables; styles.css picks one by orientation.
export function installCourtBackground(root = document.documentElement) {
  for (const landscape of [false, true]) {
    const url = `url("data:image/svg+xml,${encodeURIComponent(courtSvg({ landscape }))}")`;
    root.style.setProperty(landscape ? '--court-landscape' : '--court-portrait', url);
  }
}
