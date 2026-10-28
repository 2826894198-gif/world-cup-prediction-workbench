import { clamp, normalize, poisson, round } from './math.mjs';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resultKey(cell) {
  if (cell.home_goals > cell.away_goals) return 'home';
  if (cell.home_goals < cell.away_goals) return 'away';
  return 'draw';
}

function dixonColesAdjustment(homeGoals, awayGoals, homeLambda, awayLambda, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeLambda * awayLambda * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeLambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayLambda * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function normalizeCells(cells) {
  const normalized = normalize(cells.map((cell) => cell.probability));
  return cells.map((cell, index) => ({
    ...cell,
    probability: Math.max(0, normalized[index])
  }));
}

function aggregateOutcomeProbabilities(cells) {
  const totals = { home: 0, draw: 0, away: 0 };
  for (const cell of cells) totals[resultKey(cell)] += cell.probability;
  return totals;
}

function normalizeTargets(targetProbabilities) {
  if (!targetProbabilities) return null;
  const values = ['home', 'draw', 'away'].map((key) => finiteNumber(targetProbabilities[key]));
  if (values.some((value) => value == null || value < 0)) return null;
  const [home, draw, away] = normalize(values);
  return { home, draw, away };
}

function applyOutcomeTargets(cells, targets) {
  if (!targets) return cells;
  const current = aggregateOutcomeProbabilities(cells);
  return normalizeCells(
    cells.map((cell) => {
      const key = resultKey(cell);
      const scale = targets[key] / Math.max(0.0001, current[key]);
      return { ...cell, probability: cell.probability * scale };
    })
  );
}

function totalGoalMean(cells) {
  return cells.reduce((sum, cell) => sum + (cell.home_goals + cell.away_goals) * cell.probability, 0);
}

function homeGoalMean(cells) {
  return cells.reduce((sum, cell) => sum + cell.home_goals * cell.probability, 0);
}

function awayGoalMean(cells) {
  return cells.reduce((sum, cell) => sum + cell.away_goals * cell.probability, 0);
}

function impliedOverProbability(overWater, underWater) {
  const over = finiteNumber(overWater);
  const under = finiteNumber(underWater);
  if (over == null || under == null || over <= 1 || under <= 1) return null;
  const overImplied = 1 / over;
  const underImplied = 1 / under;
  return overImplied / Math.max(0.0001, overImplied + underImplied);
}

function targetTotalMean(options, fallbackMean) {
  const totalLine = finiteNumber(options.totalLine);
  if (totalLine == null || totalLine <= 0) return null;
  const overProbability = impliedOverProbability(options.overWater, options.underWater);
  const marketLean = overProbability == null ? 0 : (overProbability - 0.5) * 0.9;
  const target = totalLine + marketLean;
  const blended = target * 0.72 + fallbackMean * 0.28;
  return clamp(blended, 1.25, 4.6);
}

function tiltCellsToTotalMean(cells, targetMean) {
  if (targetMean == null) return cells;
  let low = -1.4;
  let high = 1.4;
  for (let index = 0; index < 30; index += 1) {
    const mid = (low + high) / 2;
    const tilted = normalizeCells(
      cells.map((cell) => ({
        ...cell,
        probability: cell.probability * Math.exp(mid * (cell.home_goals + cell.away_goals))
      }))
    );
    if (totalGoalMean(tilted) < targetMean) low = mid;
    else high = mid;
  }
  const theta = (low + high) / 2;
  return normalizeCells(
    cells.map((cell) => ({
      ...cell,
      probability: cell.probability * Math.exp(theta * (cell.home_goals + cell.away_goals))
    }))
  );
}

export function buildScoreModel(homeLambda, awayLambda, options = {}) {
  const rho = -0.03;
  const cells = [];
  for (let homeGoals = 0; homeGoals <= 6; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals += 1) {
      const base = poisson(homeGoals, homeLambda) * poisson(awayGoals, awayLambda);
      const adjusted = base * dixonColesAdjustment(homeGoals, awayGoals, homeLambda, awayLambda, rho);
      cells.push({
        home_goals: homeGoals,
        away_goals: awayGoals,
        probability: Math.max(0, adjusted)
      });
    }
  }

  const targets = normalizeTargets(options.targetProbabilities);
  const fallbackMean = finiteNumber(homeLambda + awayLambda) ?? 2.5;
  const totalMeanTarget = targetTotalMean(options, fallbackMean);
  let calibratedCells = normalizeCells(cells);
  if (targets || totalMeanTarget != null) {
    for (let index = 0; index < 5; index += 1) {
      calibratedCells = tiltCellsToTotalMean(calibratedCells, totalMeanTarget);
      calibratedCells = applyOutcomeTargets(calibratedCells, targets);
    }
  }

  const scoreProbabilities = calibratedCells.map((cell) => ({
    ...cell,
    probability: round(cell.probability, 6)
  }));

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  const goalBuckets = new Map();

  for (const cell of scoreProbabilities) {
    if (cell.home_goals > cell.away_goals) homeWin += cell.probability;
    if (cell.home_goals === cell.away_goals) draw += cell.probability;
    if (cell.home_goals < cell.away_goals) awayWin += cell.probability;
    const total = cell.home_goals + cell.away_goals;
    goalBuckets.set(total, (goalBuckets.get(total) ?? 0) + cell.probability);
  }

  return {
    homeWin: round(homeWin),
    draw: round(draw),
    awayWin: round(awayWin),
    expectedHomeGoals: round(homeGoalMean(scoreProbabilities), 4),
    expectedAwayGoals: round(awayGoalMean(scoreProbabilities), 4),
    expectedTotalGoals: round(totalGoalMean(scoreProbabilities), 4),
    scoreProbabilities: scoreProbabilities.sort((a, b) => b.probability - a.probability),
    goalProbabilities: Array.from(goalBuckets, ([total_goals, probability]) => ({
      total_goals,
      probability: round(clamp(probability, 0, 1), 6)
    })).sort((a, b) => a.total_goals - b.total_goals)
  };
}
