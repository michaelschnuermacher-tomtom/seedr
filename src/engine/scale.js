// The skill scale of a tournament: its range (e.g. 1–5, 1–10) and whether a lower or a
// higher skill is better. The draw and everything computed from skills (team values,
// edges, standings, summary) work on one calibrated scale, 1–10 with 1 the best; a
// tournament's own skills are mapped onto it linearly, so 1–5, 1–10 or 1–20 behave alike.
// Tournaments without a scale use 1–10, lower is better.

export const DEFAULT_SCALE = { min: 1, max: 10, best: 'low' };
// Any whole-number range within these limits can be chosen.
export const SCALE_LIMITS = { min: 0, max: 100 };

export function scaleOf(settings) {
  return settings?.scale ?? DEFAULT_SCALE;
}

// The skill on the calibrated scale (1 = best, 10 = weakest), possibly with decimals.
export function calibrated(skill, scale) {
  const fromBest = scale.best === 'low' ? skill - scale.min : scale.max - skill;
  return 1 + (9 * fromBest) / (scale.max - scale.min);
}

// Players with calibrated skills, for the draw and every calculation.
export function calibratePlayers(players, scale) {
  return players.map((p) => ({ ...p, skill: calibrated(p.skill, scale) }));
}

// How many calibrated units one step of the tournament's own scale is: edges and gaps are
// shown in the tournament's own steps.
export function stepUnit(scale) {
  return 9 / (scale.max - scale.min);
}

// The skill levels of a scale, best first.
export function levels(scale) {
  const all = Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i);
  return scale.best === 'low' ? all : all.reverse();
}

export function isSkill(skill, scale) {
  return Number.isInteger(skill) && skill >= scale.min && skill <= scale.max;
}

// "Skill 1 is the best, 10 the weakest."
export function describeScale(scale) {
  const [best, worst] = scale.best === 'low' ? [scale.min, scale.max] : [scale.max, scale.min];
  return `Skill ${best} is the best, ${worst} the weakest.`;
}

export function scaleProblem(scale) {
  if (!scale || typeof scale !== 'object') return 'Invalid skill scale';
  if (!Number.isInteger(scale.min) || !Number.isInteger(scale.max) || scale.min >= scale.max
    || scale.min < SCALE_LIMITS.min || scale.max > SCALE_LIMITS.max) {
    return `The skill range must be whole numbers from ${SCALE_LIMITS.min} to ${SCALE_LIMITS.max}, the lowest below the highest.`;
  }
  if (scale.best !== 'low' && scale.best !== 'high') return 'Invalid skill direction';
  return null;
}
