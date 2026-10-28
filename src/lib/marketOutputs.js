import { percent, signed } from './format.js';

const PICK_BY_LABEL = {
  主胜: 'home',
  平局: 'draw',
  客胜: 'away'
};

const PICK_LABEL = {
  home: '主胜',
  draw: '平局',
  away: '客胜'
};

const HHAD_LABEL = {
  home: '让胜',
  draw: '让平',
  away: '让负'
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fixed(value, digits = 2) {
  return isFiniteNumber(value) ? value.toFixed(digits) : '--';
}

function signedLine(value, digits = 1) {
  if (!isFiniteNumber(value)) return '--';
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function expectedMargin(match) {
  const home = match?.expectedGoals?.home;
  const away = match?.expectedGoals?.away;
  if (!isFiniteNumber(home) || !isFiniteNumber(away)) return null;
  return home - away;
}

function expectedTotal(match) {
  const home = match?.expectedGoals?.home;
  const away = match?.expectedGoals?.away;
  if (!isFiniteNumber(home) || !isFiniteNumber(away)) return null;
  return home + away;
}

function outcomeFromMargin(margin, drawBand = 0.28) {
  if (!isFiniteNumber(margin)) return null;
  if (margin > drawBand) return 'home';
  if (margin < -drawBand) return 'away';
  return 'draw';
}

function bestPick(probabilities) {
  const entries = Object.entries(probabilities ?? {}).filter(([, value]) => isFiniteNumber(value));
  if (!entries.length) return null;
  return entries.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function pickProbability(match, key) {
  const probability = match?.probabilities?.[key];
  return isFiniteNumber(probability) ? probability : null;
}

function sportterySource(marketAudit) {
  return (marketAudit?.sources ?? []).find((source) => String(source.provider ?? '').includes('Sporttery'));
}

export function sportteryEntryForMatch(marketAudit, matchNo) {
  const source = sportterySource(marketAudit);
  return (source?.sample ?? []).find((entry) => Number(entry.officialMatchNo) === Number(matchNo)) ?? null;
}

function oddsByOutcome(pool, key) {
  if (!pool) return null;
  if (key === 'home') return finiteNumber(pool.h);
  if (key === 'draw') return finiteNumber(pool.d);
  if (key === 'away') return finiteNumber(pool.a);
  return null;
}

function scoreOutcomeKey(score) {
  if (!score) return null;
  if (score.homeGoals > score.awayGoals) return 'home';
  if (score.homeGoals < score.awayGoals) return 'away';
  return 'draw';
}

function scoreTotalGoals(score) {
  if (!score) return null;
  return score.homeGoals + score.awayGoals;
}

function scoreMargin(score) {
  if (!score) return null;
  return score.homeGoals - score.awayGoals;
}

function scoreDistanceToExpected(score, match) {
  const home = match?.expectedGoals?.home;
  const away = match?.expectedGoals?.away;
  if (!score || !isFiniteNumber(home) || !isFiniteNumber(away)) return 999;
  return (score.homeGoals - home) ** 2 + (score.awayGoals - away) ** 2;
}

function projectedScoreForTotal(match, pickKey, totalGoals) {
  if (!isFiniteNumber(totalGoals) || totalGoals < 0 || !pickKey) return null;
  const candidates = [];
  for (let homeGoals = 0; homeGoals <= totalGoals; homeGoals += 1) {
    const awayGoals = totalGoals - homeGoals;
    const score = { homeGoals, awayGoals, probability: null, projected: true };
    if (scoreOutcomeKey(score) === pickKey) candidates.push(score);
  }
  if (!candidates.length) return null;
  return candidates.sort((left, right) => scoreDistanceToExpected(left, match) - scoreDistanceToExpected(right, match))[0];
}

function normalizeScore(score) {
  if (!score) return null;
  const homeGoals = score.homeGoals ?? score.home_goals;
  const awayGoals = score.awayGoals ?? score.away_goals;
  const probability = score.probability;
  if (!isFiniteNumber(homeGoals) || !isFiniteNumber(awayGoals)) return null;
  return { homeGoals, awayGoals, probability };
}

function normalizeGoal(goal) {
  if (!goal) return null;
  const totalGoals = goal.totalGoals ?? goal.total_goals;
  const probability = goal.probability;
  if (!isFiniteNumber(totalGoals)) return null;
  return { totalGoals, probability };
}

function historySnapshot(row) {
  if (!row) return null;
  return {
    capturedAt: row.capturedAt ?? row.captured_at,
    provider: row.provider,
    sourceType: row.sourceType ?? row.source_type,
    homeOdds: finiteNumber(row.homeOdds ?? row.home_odds),
    drawOdds: finiteNumber(row.drawOdds ?? row.draw_odds),
    awayOdds: finiteNumber(row.awayOdds ?? row.away_odds),
    asianLine: finiteNumber(row.asianLine ?? row.asian_line),
    asianHomeWater: finiteNumber(row.asianHomeWater ?? row.asian_home_water),
    asianAwayWater: finiteNumber(row.asianAwayWater ?? row.asian_away_water),
    totalLine: finiteNumber(row.totalLine ?? row.total_line),
    overWater: finiteNumber(row.overWater ?? row.over_water),
    underWater: finiteNumber(row.underWater ?? row.under_water)
  };
}

function latestSnapshotFromMatch(match) {
  return historySnapshot({
    capturedAt: match?.odds?.capturedAt,
    provider: match?.odds?.provider,
    sourceType: match?.odds?.sourceType,
    homeOdds: match?.odds?.home,
    drawOdds: match?.odds?.draw,
    awayOdds: match?.odds?.away,
    asianLine: match?.odds?.asianLine,
    asianHomeWater: match?.odds?.asianHomeWater,
    asianAwayWater: match?.odds?.asianAwayWater,
    totalLine: match?.odds?.totalLine,
    overWater: match?.odds?.overWater,
    underWater: match?.odds?.underWater
  });
}

function favoriteFromOdds(snapshot) {
  if (!snapshot || !isFiniteNumber(snapshot.homeOdds) || !isFiniteNumber(snapshot.awayOdds)) return null;
  return snapshot.homeOdds <= snapshot.awayOdds ? 'home' : 'away';
}

function sideName(match, key) {
  if (key === 'home') return match?.homeTeam ?? '主队';
  if (key === 'away') return match?.awayTeam ?? '客队';
  return '平局';
}

function sideWater(snapshot, side) {
  if (side === 'home') return snapshot?.asianHomeWater;
  if (side === 'away') return snapshot?.asianAwayWater;
  return null;
}

function decimalWater(value) {
  if (!isFiniteNumber(value)) return null;
  return value > 1.2 ? value : value + 1;
}

function favoriteLineMagnitude(snapshot, favorite) {
  const line = snapshot?.asianLine;
  if (!isFiniteNumber(line) || !favorite) return null;
  if (favorite === 'home' && line < 0) return Math.abs(line);
  if (favorite === 'away' && line > 0) return Math.abs(line);
  return 0;
}

function expectedHandicapDepth(favoriteProbability) {
  if (!isFiniteNumber(favoriteProbability)) return 0.5;
  if (favoriteProbability >= 0.64) return 1.25;
  if (favoriteProbability >= 0.58) return 1;
  if (favoriteProbability >= 0.52) return 0.75;
  if (favoriteProbability >= 0.45) return 0.5;
  return 0.25;
}

function favoriteLineMove(opening, latest, favorite) {
  if (!opening || !latest || !favorite) return 0;
  const open = favoriteLineMagnitude(opening, favorite);
  const now = favoriteLineMagnitude(latest, favorite);
  if (!isFiniteNumber(open) || !isFiniteNumber(now)) return 0;
  return now - open;
}

function favoriteExpectedMargin(match, favorite) {
  const margin = expectedMargin(match);
  if (!isFiniteNumber(margin)) return null;
  if (favorite === 'home') return margin;
  if (favorite === 'away') return -margin;
  return null;
}

function narrowWinMargin(depth) {
  if (!isFiniteNumber(depth)) return 1;
  if (depth <= 0.5) return 0;
  if (depth <= 1.25) return 1;
  return Math.max(1, Math.round(depth - 0.25));
}

function coverMargin(depth) {
  if (!isFiniteNumber(depth)) return 1;
  if (depth < 1) return 1;
  return Math.max(1, Math.ceil(depth + 0.001));
}

function underdogCoverLabel(favoriteName, underdogName, depth) {
  if (!isFiniteNumber(depth)) return `${underdogName}受让`;
  if (depth <= 0.5) return `${underdogName}受让，防${favoriteName}不胜`;
  if (depth <= 0.75) return `${underdogName}受让，${favoriteName}小胜或不胜`;
  const maxMargin = narrowWinMargin(depth);
  return `${underdogName}受让，${favoriteName}最多赢${maxMargin}球`;
}

function totalImpliedOver(snapshot) {
  const over = snapshot?.overWater;
  const under = snapshot?.underWater;
  if (!isFiniteNumber(over) || !isFiniteNumber(under)) return null;
  if (over > 1.1 && under > 1.1) {
    const overImplied = 1 / over;
    const underImplied = 1 / under;
    return overImplied / Math.max(0.0001, overImplied + underImplied);
  }
  const overLean = under - over;
  return 0.5 + Math.max(-0.18, Math.min(0.18, overLean * 0.32));
}

function impliedMoneylineProbabilities(snapshot) {
  if (!snapshot || !isFiniteNumber(snapshot.homeOdds) || !isFiniteNumber(snapshot.drawOdds) || !isFiniteNumber(snapshot.awayOdds)) {
    return null;
  }
  const raw = [1 / snapshot.homeOdds, 1 / snapshot.drawOdds, 1 / snapshot.awayOdds];
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (!isFiniteNumber(total) || total <= 0) return null;
  return {
    home: raw[0] / total,
    draw: raw[1] / total,
    away: raw[2] / total
  };
}

function preferredGoalsFromTotalLine(line, lean) {
  if (!isFiniteNumber(line)) return [2, 3];
  if (line >= 3.25) return [3, 4];
  if (line <= 1.75 && lean === 'under') return [1, 2];
  return [2, 3];
}

function marketScoreForOutcomeAndGoals(outcome, totalGoals, favoriteCover) {
  if (!outcome || !isFiniteNumber(totalGoals)) return null;
  if (outcome === 'draw') {
    if (totalGoals <= 0) return { homeGoals: 0, awayGoals: 0, probability: null, projected: true };
    if (totalGoals <= 2) return { homeGoals: 1, awayGoals: 1, probability: null, projected: true };
    return { homeGoals: 2, awayGoals: 2, probability: null, projected: true };
  }
  let winnerGoals;
  let loserGoals;
  if (totalGoals <= 1) {
    winnerGoals = 1;
    loserGoals = 0;
  } else if (totalGoals === 2) {
    winnerGoals = 2;
    loserGoals = 0;
  } else if (totalGoals === 3) {
    winnerGoals = favoriteCover ? 3 : 2;
    loserGoals = favoriteCover ? 0 : 1;
  } else {
    winnerGoals = favoriteCover ? totalGoals - 1 : Math.ceil((totalGoals + 1) / 2);
    loserGoals = totalGoals - winnerGoals;
  }
  return outcome === 'home'
    ? { homeGoals: winnerGoals, awayGoals: loserGoals, probability: null, projected: true }
    : { homeGoals: loserGoals, awayGoals: winnerGoals, probability: null, projected: true };
}

function bestScoreForMarginAndTotal(scores, margin, totalGoals, match) {
  return scores
    .filter((score) => scoreTotalGoals(score) === totalGoals && scoreMargin(score) === margin)
    .sort((left, right) => {
      const probabilityDelta = (right.probability ?? -1) - (left.probability ?? -1);
      return probabilityDelta || scoreDistanceToExpected(left, match) - scoreDistanceToExpected(right, match);
    })[0] ?? null;
}

function probabilityForTotal(goalRows, totalGoals) {
  return goalRows.find((goal) => goal.totalGoals === totalGoals)?.probability ?? null;
}

function marginInRange(margin, range) {
  if (!isFiniteNumber(margin) || !range) return false;
  return margin >= range.min && margin <= range.max;
}

function intersectRange(left, right) {
  if (!left) return right;
  if (!right) return left;
  const min = Math.max(left.min, right.min);
  const max = Math.min(left.max, right.max);
  if (min > max) return null;
  return { min, max };
}

function rangeText(range) {
  if (!range) return '无约束';
  if (range.min === range.max) return `净胜 ${signed(range.min, 0)}`;
  if (range.min === -Infinity) return `净胜 ≤ ${signed(range.max, 0)}`;
  if (range.max === Infinity) return `净胜 ≥ ${signed(range.min, 0)}`;
  return `净胜 ${signed(range.min, 0)} 到 ${signed(range.max, 0)}`;
}

function baseRangeForPick(pickKey) {
  if (pickKey === 'home') return { min: 1, max: Infinity, source: '胜平负' };
  if (pickKey === 'away') return { min: -Infinity, max: -1, source: '胜平负' };
  if (pickKey === 'draw') return { min: 0, max: 0, source: '胜平负' };
  return null;
}

function hhadRange(line, key) {
  if (!isFiniteNumber(line) || !key) return null;
  const threshold = -line;
  const integerThreshold = Math.round(threshold);
  const isInteger = Math.abs(threshold - integerThreshold) < 0.001;
  if (key === 'draw' && isInteger) return { min: integerThreshold, max: integerThreshold, source: '体彩让球' };
  if (key === 'home') return { min: Math.floor(threshold) + 1, max: Infinity, source: '体彩让球' };
  if (key === 'away') return { min: -Infinity, max: Math.ceil(threshold) - 1, source: '体彩让球' };
  return null;
}

function asianRange(line, side) {
  if (!isFiniteNumber(line) || !side || side === 'watch') return null;
  const threshold = -line;
  const integerThreshold = Math.round(threshold);
  const isInteger = Math.abs(threshold - integerThreshold) < 0.001;
  if (side === 'home') {
    return {
      min: isInteger ? integerThreshold + 1 : Math.ceil(threshold),
      max: Infinity,
      source: '让球盘'
    };
  }
  if (side === 'away') {
    return {
      min: -Infinity,
      max: isInteger ? integerThreshold : Math.floor(threshold),
      source: '让球盘'
    };
  }
  return null;
}

function hhadOutcomeForScore(score, line) {
  if (!score || !isFiniteNumber(line)) return null;
  const adjusted = scoreMargin(score) + line;
  if (adjusted > 0) return 'home';
  if (adjusted < 0) return 'away';
  return 'draw';
}

function keyByLargestProbability(probabilities) {
  const entries = Object.entries(probabilities ?? {}).filter(([, value]) => isFiniteNumber(value));
  if (!entries.length) return null;
  return entries.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

function hhadDistributionForScores(scores, line, pickKey = null) {
  if (!isFiniteNumber(line)) return null;
  const sourceScores = (scores ?? []).filter((score) => (
    score &&
    isFiniteNumber(score.homeGoals) &&
    isFiniteNumber(score.awayGoals) &&
    isFiniteNumber(score.probability)
  ));
  const filteredScores = pickKey
    ? sourceScores.filter((score) => scoreOutcomeKey(score) === pickKey)
    : sourceScores;
  const rows = filteredScores.length ? filteredScores : sourceScores;
  if (!rows.length) return null;

  const totals = { home: 0, draw: 0, away: 0 };
  for (const score of rows) {
    const key = hhadOutcomeForScore(score, line);
    if (key) totals[key] += score.probability;
  }
  const total = totals.home + totals.draw + totals.away;
  if (!isFiniteNumber(total) || total <= 0) return null;
  const probabilities = {
    home: totals.home / total,
    draw: totals.draw / total,
    away: totals.away / total
  };
  return {
    probabilities,
    key: keyByLargestProbability(probabilities),
    conditional: Boolean(pickKey && filteredScores.length)
  };
}

function totalDirectionForScore(score, line) {
  if (!score || !isFiniteNumber(line)) return null;
  const total = scoreTotalGoals(score);
  if (total > line) return 'over';
  if (total < line) return 'under';
  return 'push';
}

function lineSide(match) {
  const line = match?.odds?.asianLine;
  const margin = expectedMargin(match);
  if (!isFiniteNumber(line) || !isFiniteNumber(margin)) return null;
  const adjustedMargin = margin + line;
  if (adjustedMargin > 0.15) return 'home';
  if (adjustedMargin < -0.15) return 'away';
  return 'watch';
}

function targetMarginFromRange(range, margin, pickKey) {
  if (!range) return null;
  const fallback = pickKey === 'home' ? 1 : pickKey === 'away' ? -1 : 0;
  const expected = isFiniteNumber(margin) ? Math.round(margin) : fallback;
  const lower = range.min === -Infinity ? expected : range.min;
  const upper = range.max === Infinity ? expected : range.max;
  return Math.max(lower, Math.min(upper, expected));
}

function scoreFitsTotalMarket(score, totalOutput, line) {
  if (!score || !totalOutput || !isFiniteNumber(line)) return true;
  const direction = totalDirectionForScore(score, line);
  if (totalOutput === '大球') return direction === 'over' || direction === 'push';
  if (totalOutput === '小球') return direction === 'under' || direction === 'push';
  return true;
}

function bestScoreForScript(match, scores, goals, script) {
  const pickKey = script.pickKey;
  const directionScores = scores.filter((score) => scoreOutcomeKey(score) === pickKey);
  if (!directionScores.length) return scores[0] ?? null;

  const peakGoalProbability = Math.max(0, ...goals.map((goal) => goal.probability ?? 0));
  const closeGoalTotals = goals
    .filter((goal) => (
      isFiniteNumber(goal.probability) &&
      (peakGoalProbability - goal.probability <= 0.035 || goal.probability >= peakGoalProbability * 0.86)
    ))
    .map((goal) => goal.totalGoals);
  const targetRange = script.targetRange;
  const totalLine = match?.odds?.totalLine;
  const totalLabel = script.totalLabel;

  const scored = directionScores.map((score) => {
    const margin = scoreMargin(score);
    const totalGoals = scoreTotalGoals(score);
    const marginFit = marginInRange(margin, targetRange);
    const closeGoalFit = closeGoalTotals.includes(totalGoals);
    const totalMarketFit = scoreFitsTotalMarket(score, totalLabel, totalLine);
    const probability = isFiniteNumber(score.probability) ? score.probability : 0;
    const goalProbability = probabilityForTotal(goals, totalGoals) ?? 0;
    const marginDistance = isFiniteNumber(script.targetMargin)
      ? Math.abs(margin - script.targetMargin)
      : Math.abs(margin - (isFiniteNumber(script.expectedMargin) ? script.expectedMargin : margin));
    const scoreValue =
      (marginFit ? 100 : 0) +
      (closeGoalFit ? 28 : 0) +
      (totalMarketFit ? 16 : -20) +
      probability * 140 +
      goalProbability * 60 -
      marginDistance * 10 -
      scoreDistanceToExpected(score, match) * 2;
    return { score, scoreValue, marginFit, closeGoalFit, totalMarketFit };
  });

  return scored
    .sort((left, right) => right.scoreValue - left.scoreValue)
    .map((item) => item.score)[0] ?? directionScores[0];
}

function scriptLabelFor(match, script) {
  if (!script?.score) return '等待剧本';
  const margin = scoreMargin(script.score);
  const total = scoreTotalGoals(script.score);
  const direction =
    margin > 0 ? '主队' : margin < 0 ? '客队' : '平局';
  const marginLabel =
    margin === 0 ? '守平' : Math.abs(margin) === 1 ? '小胜' : `净胜${Math.abs(margin)}`;
  const totalLabel = isFiniteNumber(total) && total <= 2 ? '低比分' : isFiniteNumber(total) && total >= 4 ? '高比分' : '常规比分';
  return `${direction}${marginLabel} · ${totalLabel}`;
}

function buildMatchScript(match, marketAudit, distributions = {}) {
  const pickKey = PICK_BY_LABEL[match?.recommendedPick] ?? bestPick(match?.probabilities);
  const margin = expectedMargin(match);
  const total = expectedTotal(match);
  const scoreRows = (distributions.scores?.length ? distributions.scores : match?.scoreCandidates ?? [])
    .map(normalizeScore)
    .filter(Boolean);
  const goalRows = (distributions.goals?.length ? distributions.goals : match?.goalCandidates ?? [])
    .map(normalizeGoal)
    .filter((goal) => goal && isFiniteNumber(goal.probability))
    .sort((a, b) => b.probability - a.probability || a.totalGoals - b.totalGoals);
  const entry = sportteryEntryForMatch(marketAudit, match?.matchNo);
  const hhadLine = finiteNumber(entry?.hhad?.goalLine);
  const hhadExpectedKey = isFiniteNumber(hhadLine) && isFiniteNumber(margin)
    ? outcomeFromMargin(margin + hhadLine, 0.24)
    : null;
  const hhadDistribution = hhadDistributionForScores(scoreRows, hhadLine);
  const hhadConditionalDistribution = hhadDistributionForScores(scoreRows, hhadLine, pickKey);
  const hhadKey = hhadConditionalDistribution?.key ?? hhadDistribution?.key ?? hhadExpectedKey;
  const asianLineValue = match?.odds?.asianLine;
  const asianSide = lineSide(match);
  const constraints = [baseRangeForPick(pickKey)];
  if (hhadKey) constraints.push(hhadRange(hhadLine, hhadKey));
  if (asianSide) constraints.push(asianRange(asianLineValue, asianSide));

  let targetRange = constraints[0] ?? null;
  const conflicts = [];
  for (const constraint of constraints.slice(1)) {
    if (!constraint) continue;
    const nextRange = intersectRange(targetRange, constraint);
    if (nextRange) {
      targetRange = nextRange;
    } else {
      conflicts.push(`${constraint.source} 与 ${rangeText(targetRange)} 分歧`);
    }
  }

  const totalLabel = totalGoalsOutput(match, goalRows).label;
  const targetMargin = targetMarginFromRange(targetRange, margin, pickKey);
  const score = bestScoreForScript(match, scoreRows, goalRows, {
    pickKey,
    expectedMargin: margin,
    targetRange,
    targetMargin,
    totalLabel
  });
  const script = {
    pickKey,
    expectedMargin: margin,
    expectedTotal: total,
    score,
    scriptTotal: scoreTotalGoals(score),
    targetRange,
    targetMargin,
    goalRows,
    scoreRows,
    sportteryEntry: entry,
    hhadLine,
    hhadKey,
    hhadExpectedKey,
    hhadDistribution,
    hhadConditionalDistribution,
    asianLine: asianLineValue,
    asianSide,
    totalLabel,
    conflicts
  };
  script.label = scriptLabelFor(match, script);
  return script;
}

function candidateSummary(candidates) {
  if (!candidates?.length) return '--';
  return candidates
    .map((candidate) => `${candidate.primary ? '优先 ' : ''}${candidate.label} ${candidate.metric}`)
    .join(' / ');
}

function uniqueCandidates(candidates, labelForCandidate = (candidate) => candidate?.label) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const label = labelForCandidate(candidate);
    if (!candidate || !label || seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

export function moneylineOutput(match) {
  const key = PICK_BY_LABEL[match?.recommendedPick] ?? bestPick(match?.probabilities);
  const probability = pickProbability(match, key);
  return {
    title: '胜平负',
    label: PICK_LABEL[key] ?? match?.recommendedPick ?? '待接入',
    detail: '模型校准概率',
    metric: isFiniteNumber(probability) ? percent(probability, 1) : '--',
    status: key ? 'ready' : 'pending'
  };
}

function moneylineMarketFallbackOutput(match) {
  const output = moneylineOutput(match);
  const odds = match?.odds ?? {};
  const hasOdds = [odds.home, odds.draw, odds.away].every(isFiniteNumber);
  return {
    title: '胜平负盘口',
    label: output.label,
    detail: hasOdds
      ? `欧赔 ${fixed(odds.home)} / ${fixed(odds.draw)} / ${fixed(odds.away)}`
      : '赛前胜平负概率',
    metric: output.metric === '--' ? '概率待核' : `模型 ${output.metric}`,
    status: output.status === 'ready' ? 'ready' : 'watch',
    fallback: true
  };
}

export function sportteryHandicapOutput(match, marketAudit, script = null) {
  const entry = script?.sportteryEntry ?? sportteryEntryForMatch(marketAudit, match?.matchNo);
  const line = finiteNumber(entry?.hhad?.goalLine);
  const margin = expectedMargin(match);
  if (!entry || !isFiniteNumber(line)) {
    return moneylineMarketFallbackOutput(match);
  }
  if (!isFiniteNumber(margin)) {
    return {
      title: '体彩让球',
      label: '官方 HHAD',
      detail: `${entry.matchNum ?? '体彩'} 主队 ${signedLine(line)}`,
      metric: `让胜/平/负 ${fixed(entry.hhad?.h)} / ${fixed(entry.hhad?.d)} / ${fixed(entry.hhad?.a)}`,
      status: 'watch'
    };
  }
  const adjustedMargin = margin + line;
  const expectedKey = outcomeFromMargin(adjustedMargin, 0.24);
  const scoreKey = hhadOutcomeForScore(script?.score, line);
  const key = scoreKey ?? script?.hhadKey ?? expectedKey;
  const odds = oddsByOutcome(entry.hhad, key);
  const conditionalProbability = script?.hhadConditionalDistribution?.probabilities?.[key];
  const distributionText = isFiniteNumber(conditionalProbability)
    ? `剧本概率 ${percent(conditionalProbability, 1)}`
    : `修正差 ${signed(adjustedMargin, 2)}`;
  const expectedText = expectedKey && expectedKey !== key
    ? ` · 均值层${HHAD_LABEL[expectedKey]}`
    : '';
  return {
    title: '体彩让球',
    label: HHAD_LABEL[key] ?? '观察',
    detail: `${entry.matchNum ?? '体彩'} 主队 ${signedLine(line)}`,
    metric: `${distributionText}${expectedText} · 赔率 ${fixed(odds)}`,
    status: expectedKey && expectedKey !== key ? 'watch' : 'ready'
  };
}

export function asianHandicapOutput(match, script = null) {
  const line = match?.odds?.asianLine;
  const margin = expectedMargin(match);
  if (!isFiniteNumber(line)) {
    return {
      title: '让球盘',
      label: '待接入',
      detail: '无完整亚盘',
      metric: '--',
      status: 'pending'
    };
  }
  if (!isFiniteNumber(margin)) {
    return {
      title: '让球盘',
      label: '等待模型',
      detail: `主队 ${signedLine(line)}`,
      metric: `水位 ${fixed(match?.odds?.asianHomeWater)} / ${fixed(match?.odds?.asianAwayWater)}`,
      status: 'pending'
    };
  }
  const adjustedMargin = margin + line;
  const side = script?.asianSide ?? (
    adjustedMargin > 0.15
      ? 'home'
      : adjustedMargin < -0.15
        ? 'away'
        : 'watch'
  );
  const pickKey = script?.pickKey ?? PICK_BY_LABEL[match?.recommendedPick] ?? bestPick(match?.probabilities);
  const score = script?.score;
  const scriptAdjusted = score ? scoreMargin(score) + line : null;
  const coherent =
    side === 'watch' ||
    !isFiniteNumber(scriptAdjusted) ||
    (side === 'home' && scriptAdjusted >= 0) ||
    (side === 'away' && scriptAdjusted <= 0);
  const label = (() => {
    if (side === 'watch') return '盘口观察';
    if (pickKey === 'home' && side === 'away') return '主胜不穿';
    if (pickKey === 'away' && side === 'home') return '客胜不穿';
    if (pickKey === 'home' && side === 'home') return '主队穿盘';
    if (pickKey === 'away' && side === 'away') return '客队方向';
    if (pickKey === 'draw') return side === 'home' ? '主队受让' : '客队受让';
    return side === 'home' ? '主队方向' : '客队方向';
  })();
  const detail =
    side === 'home'
      ? `主队 ${signedLine(line)}`
      : side === 'away'
        ? `客队 ${signedLine(-line)}`
        : `主队 ${signedLine(line)} / 客队 ${signedLine(-line)}`;
  const range = asianRange(line, side);
  return {
    title: '让球盘',
    label,
    detail,
    metric: coherent
      ? `${range ? rangeText(range) : `修正差 ${signed(adjustedMargin, 2)}`} · 水位 ${fixed(match?.odds?.asianHomeWater)} / ${fixed(match?.odds?.asianAwayWater)}`
      : `盘口分歧 · 剧本修正 ${signed(scriptAdjusted, 2)}`,
    status: side === 'watch' || !coherent ? 'watch' : 'ready'
  };
}

export function totalGoalsOutput(match, goals = null) {
  const line = match?.odds?.totalLine;
  if (!isFiniteNumber(line)) {
    return {
      title: '大小球',
      label: '待接入',
      detail: '无完整大小球盘',
      metric: '--',
      status: 'pending'
    };
  }
  const goalSummary = match?.goalSummary;
  if (
    isFiniteNumber(goalSummary?.overProbability) &&
    isFiniteNumber(goalSummary?.underProbability)
  ) {
    const over = goalSummary.overProbability;
    const under = goalSummary.underProbability;
    const push = isFiniteNumber(goalSummary.pushProbability) ? goalSummary.pushProbability : 0;
    const isOver = over >= under;
    return {
      title: '大小球',
      label: isOver ? '大球' : '小球',
      detail: `${fixed(line, 2)} 球`,
      metric: `${isOver ? '大' : '小'} ${percent(Math.max(over, under), 1)}${push > 0 ? ` · 走 ${percent(push, 1)}` : ''}`,
      status: 'ready'
    };
  }
  const goalRows = (goals ?? []).map(normalizeGoal).filter((goal) => goal && isFiniteNumber(goal.probability));
  if (goalRows.length) {
    const over = goalRows.reduce((sum, goal) => sum + (goal.totalGoals > line ? goal.probability : 0), 0);
    const under = goalRows.reduce((sum, goal) => sum + (goal.totalGoals < line ? goal.probability : 0), 0);
    const push = goalRows.reduce((sum, goal) => sum + (goal.totalGoals === line ? goal.probability : 0), 0);
    const isOver = over >= under;
    const metric = `${isOver ? '大' : '小'} ${percent(Math.max(over, under), 1)}${push > 0 ? ` · 走 ${percent(push, 1)}` : ''}`;
    return {
      title: '大小球',
      label: isOver ? '大球' : '小球',
      detail: `${fixed(line, 2)} 球`,
      metric,
      status: 'ready'
    };
  }
  const total = expectedTotal(match);
  if (!isFiniteNumber(total)) {
    return {
      title: '大小球',
      label: '等待模型',
      detail: `${fixed(line, 2)} 球`,
      metric: `水位 ${fixed(match?.odds?.overWater)} / ${fixed(match?.odds?.underWater)}`,
      status: 'pending'
    };
  }
  const diff = total - line;
  return {
    title: '大小球',
    label: Math.abs(diff) < 0.08 ? '大小观察' : diff > 0 ? '大球' : '小球',
    detail: `${fixed(line, 2)} 球`,
    metric: `均值 ${fixed(total, 2)} · 水位 ${fixed(match?.odds?.overWater)} / ${fixed(match?.odds?.underWater)}`,
    status: Math.abs(diff) < 0.08 ? 'watch' : 'ready'
  };
}

export function goalCountOutput(match, goals = null, script = null) {
  const sourceGoals = (goals?.length ? goals : match?.goalCandidates ?? [])
    .map(normalizeGoal)
    .filter((goal) => goal && isFiniteNumber(goal.probability))
    .sort((a, b) => b.probability - a.probability || a.totalGoals - b.totalGoals);
  const scriptTotal = script?.scriptTotal;
  const peakGoal = sourceGoals[0] ?? null;
  const orderedGoals = uniqueCandidates(sourceGoals, (goal) => String(goal.totalGoals));
  const candidates = orderedGoals.slice(0, 2).map((goal, index) => ({
    label: `${goal.totalGoals}球`,
    metric: percent(goal.probability, 1),
    totalGoals: goal.totalGoals,
    probability: goal.probability,
    primary: index === 0
  }));

  if (candidates.length) {
    return {
      title: '进球数',
      label: candidates[0].label,
      detail:
        isFiniteNumber(scriptTotal) && scriptTotal !== candidates[0].totalGoals
          ? `分布优先 · 剧本 ${scriptTotal}球`
          : peakGoal && candidates[0].totalGoals !== peakGoal.totalGoals
            ? `分布峰值 ${peakGoal.totalGoals}球`
            : candidates.length > 1 ? `备选 ${candidates.slice(1).map((candidate) => candidate.label).join(' / ')}` : '优先推荐',
      metric: candidates[0].metric,
      candidates,
      candidateText: candidateSummary(candidates),
      status: 'ready'
    };
  }

  const total = expectedTotal(match);
  if (!isFiniteNumber(total)) {
    return {
      title: '进球数',
      label: '--',
      detail: '无进球分布',
      metric: '--',
      candidates: [],
      candidateText: '--',
      status: 'pending'
    };
  }

  const roundedTotal = Math.max(0, Math.round(total));
  return {
    title: '进球数',
    label: `${roundedTotal}球`,
    detail: '按期望均值取整',
    metric: `均值 ${fixed(total, 2)}`,
    candidates: [{ label: `${roundedTotal}球`, metric: `均值 ${fixed(total, 2)}`, totalGoals: roundedTotal, primary: true }],
    candidateText: `优先 ${roundedTotal}球 · 均值 ${fixed(total, 2)}`,
    status: 'watch'
  };
}

export function scoreRecommendationOutput(match, scores = null, goalCount = null, script = null) {
  const normalizedScores = (scores?.length ? scores : match?.scoreCandidates ?? []).map(normalizeScore).filter(Boolean);
  const pickKey = PICK_BY_LABEL[match?.recommendedPick] ?? bestPick(match?.probabilities);
  const globalPeak = normalizedScores[0] ?? normalizeScore(match?.scoreSummary);
  const directionScores = normalizedScores.filter((score) => scoreOutcomeKey(score) === pickKey);
  const goalTotals = (goalCount?.candidates ?? [])
    .map((candidate) => candidate.totalGoals)
    .filter(isFiniteNumber);
  const goalAlignedScores = [];
  for (const totalGoals of goalTotals) {
    const scoreForTotal =
      directionScores
        .filter((score) => scoreTotalGoals(score) === totalGoals)
        .sort((left, right) => {
          const probabilityDelta = (right.probability ?? -1) - (left.probability ?? -1);
          return probabilityDelta || scoreDistanceToExpected(left, match) - scoreDistanceToExpected(right, match);
        })[0] ?? projectedScoreForTotal(match, pickKey, totalGoals);
    if (scoreForTotal) goalAlignedScores.push(scoreForTotal);
  }
  const scriptScore = normalizeScore(script?.score);
  const directionPeak = directionScores
    .slice()
    .sort((left, right) => (right.probability ?? -1) - (left.probability ?? -1))[0];
  const directionScore =
    goalAlignedScores[0] ??
    directionPeak ??
    globalPeak;
  if (!directionScore) {
    return {
      title: '比分',
      label: '--',
      detail: '无比分分布',
      metric: '--',
      candidates: [],
      candidateText: '--',
      status: 'pending'
    };
  }
  const globalLabel = globalPeak ? `${globalPeak.homeGoals}-${globalPeak.awayGoals}` : '--';
  const directionLabel = `${directionScore.homeGoals}-${directionScore.awayGoals}`;
  const mainScoreRows = uniqueCandidates(
    [
      directionScore,
      ...goalAlignedScores,
      ...directionScores
    ],
    (score) => `${score.homeGoals}-${score.awayGoals}`
  )
    .slice(0, 2);
  const candidates = mainScoreRows
    .map((score, index) => ({
      label: `${score.homeGoals}-${score.awayGoals}`,
      metric: isFiniteNumber(score.probability) ? percent(score.probability, 1) : '逻辑',
      probability: score.probability,
      projected: score.projected === true,
      primary: index === 0
    }));
  return {
    title: '比分',
    label: directionLabel,
    detail:
      goalTotals.length > 0
        ? `优先匹配 ${goalTotals.slice(0, 2).map((total) => `${total}球`).join(' / ')}`
        : directionLabel === globalLabel
          ? '优先推荐 · 比分峰值'
          : `优先推荐 · 峰值 ${globalLabel}`,
    metric: isFiniteNumber(directionScore.probability) ? percent(directionScore.probability, 1) : '逻辑',
    candidates,
    candidateText: candidateSummary(candidates),
    status: 'ready'
  };
}

export function alternativeMarketReadingOutput(match, distributions = {}) {
  const latest = latestSnapshotFromMatch(match);
  const history = (match?.oddsHistory ?? [])
    .map(historySnapshot)
    .filter(Boolean)
    .sort((left, right) => new Date(left.capturedAt).getTime() - new Date(right.capturedAt).getTime());
  const providerHistory = history.filter((row) => row.provider === latest?.provider);
  const opening = providerHistory[0] ?? history[0] ?? latest;
  const current = providerHistory.at(-1) ?? latest;
  const marketProbabilities = impliedMoneylineProbabilities(current);
  const marketPick = bestPick(marketProbabilities);
  const favorite = favoriteFromOdds(current) ?? marketPick;
  const underdog = favorite === 'home' ? 'away' : favorite === 'away' ? 'home' : null;
  const favoriteProbability = marketProbabilities?.[favorite] ?? null;
  const depth = favoriteLineMagnitude(current, favorite);
  const expectedDepth = expectedHandicapDepth(favoriteProbability);
  const shallow = isFiniteNumber(depth) && depth + 0.001 < expectedDepth;
  const lineMove = favoriteLineMove(opening, current, favorite);
  const openingFavoriteWater = decimalWater(sideWater(opening, favorite));
  const favoriteWater = decimalWater(sideWater(current, favorite));
  const favoriteWaterMove =
    isFiniteNumber(openingFavoriteWater) && isFiniteNumber(favoriteWater)
      ? favoriteWater - openingFavoriteWater
      : 0;
  const favoriteName = sideName(match, favorite);
  const underdogName = sideName(match, underdog);

  const handicapLean = (() => {
    if (!favorite || !underdog) return 'watch';
    if (isFiniteNumber(depth) && depth <= 0.25) return 'shallow_draw';
    if ((isFiniteNumber(favoriteWater) && (favoriteWater < 1.86 || favoriteWater >= 2)) || lineMove <= -0.24) return 'underdog_cover';
    if (isFiniteNumber(depth) && depth >= 0.5 && lineMove >= 0.24 && isFiniteNumber(favoriteWater) && favoriteWater >= 1.86 && favoriteWater < 2) return 'favorite_cover';
    if (isFiniteNumber(depth) && depth >= 1.25 && isFiniteNumber(favoriteWater) && favoriteWater >= 1.86 && favoriteWater < 1.94 && favoriteWaterMove <= 0.08) return 'favorite_cover';
    if (shallow) return 'underdog_cover';
    return 'favorite_edge';
  })();
  const marketWdlPick = (() => {
    if (isFiniteNumber(depth) && depth <= 0.25) return 'draw';
    if ((isFiniteNumber(favoriteWater) && favoriteWater < 1.86) || lineMove <= -0.24) return underdog;
    return favorite;
  })();
  const favoriteCoverSignal =
    isFiniteNumber(depth) &&
    depth >= 0.5 &&
    lineMove >= 0.24 &&
    isFiniteNumber(favoriteWater) &&
    favoriteWater >= 1.86 &&
    favoriteWater < 2;
  const confidenceTier =
    !current
      ? 'pending'
      : isFiniteNumber(depth) && (depth <= 0.25 || (isFiniteNumber(favoriteWater) && favoriteWater < 1.86))
        ? 'watch'
        : isFiniteNumber(depth) && depth >= 0.5 && isFiniteNumber(favoriteWater) && favoriteWater >= 1.86 && lineMove >= -0.01
          ? 'strong'
          : 'candidate';
  const targetMarginSign = favorite === 'home' ? 1 : favorite === 'away' ? -1 : 0;
  const targetMargin = (() => {
    if (handicapLean === 'favorite_cover') return targetMarginSign * coverMargin(depth);
    if (handicapLean === 'underdog_cover' || handicapLean === 'favorite_edge') return targetMarginSign * narrowWinMargin(depth);
    if (handicapLean === 'shallow_draw') return 0;
    return 0;
  })();
  const handicapPick = (() => {
    if (handicapLean === 'shallow_draw') return '浅盘，胜平优先看平';
    if (handicapLean === 'favorite_cover') return `${favoriteName}穿盘`;
    if (handicapLean === 'favorite_edge') return `${favoriteName}胜向，${underdogName}受让`;
    if (handicapLean === 'underdog_cover') return underdogCoverLabel(favoriteName, underdogName, depth);
    return '盘口观察';
  })();
  const handicapReason = [
    `即时让球 ${signedLine(current?.asianLine, 2)}，${favoriteName}为盘口低赔方向。`,
    `欧赔隐含 ${favoriteName}胜率 ${percent(favoriteProbability, 1)}，合理让步约 ${expectedDepth.toFixed(2)}，当前 ${fixed(depth, 2)} ${shallow ? '偏浅' : '不浅'}。`,
    lineMove > 0.01 || Math.abs(favoriteWaterMove) > 0.01
      ? `相对初盘让步变化 ${signed(lineMove, 2)}，热门侧水位变化 ${signed(favoriteWaterMove, 2)}。`
      : '盘口相对初盘变化不大。',
    handicapLean === 'favorite_cover'
      ? '升盘且热门水位处在可接受区间，保留穿盘剧本。'
      : handicapLean === 'favorite_edge'
        ? '胜平负仍跟低赔方向，但让球盘不硬判穿盘。'
        : handicapLean === 'underdog_cover'
          ? '退盘、热门过高水或过低水时优先反热门让球。'
          : handicapLean === 'shallow_draw'
            ? '0/0.25 浅盘不强推胜负，降级看平局或观察。'
            : '盘口信号不足，降级观察。'
  ];

  const overProbability = totalImpliedOver(current);
  const totalMove =
    isFiniteNumber(opening?.totalLine) && isFiniteNumber(current?.totalLine)
      ? current.totalLine - opening.totalLine
      : 0;
  const totalLean =
    isFiniteNumber(overProbability) && overProbability >= 0.515
      ? 'over'
      : isFiniteNumber(overProbability) && overProbability <= 0.485
        ? 'under'
        : current?.totalLine >= 2.75
          ? 'under'
          : 'over';
  const preferredGoals = preferredGoalsFromTotalLine(current?.totalLine, totalLean);
  const totalPick = `${totalLean === 'over' ? '偏大' : '偏小'}，进球数 ${preferredGoals.map((goal) => `${goal}球`).join(' / ')}`;
  const totalReason = [
    `大小球初盘 ${fixed(opening?.totalLine, 2)}，即时 ${fixed(current?.totalLine, 2)}，盘位变化 ${signed(totalMove, 2)}。`,
    isFiniteNumber(overProbability)
      ? `水位折算大球倾向约 ${percent(overProbability, 1)}。`
      : '大小球水位不完整，按期望总进球和进球分布兜底。',
    '世界杯正赛默认从 2/3 球基准出发，只有极端大小盘才调整到相邻档。'
  ];

  const scoreCandidates = uniqueCandidates(
    preferredGoals
      .map((goal) => marketScoreForOutcomeAndGoals(marketWdlPick, goal, favoriteCoverSignal))
      .filter(Boolean),
    (score) => `${score.homeGoals}-${score.awayGoals}`
  )
    .slice(0, 2)
    .map((score, index) => ({
      label: `${score.homeGoals}-${score.awayGoals}`,
      metric: '盘口',
      primary: index === 0
    }));
  const scorePick = scoreCandidates.map((score) => score.label).join(' / ') || '--';

  return {
    title: '盘口推演',
    status: current ? 'ready' : 'pending',
    opening,
    current,
    handicap: {
      label: handicapPick,
      lean: handicapLean,
      tier: confidenceTier,
      wdlPick: marketWdlPick,
      predictedHandicap: favoriteCoverSignal ? `${favorite}_cover` : `${underdog}_cover`,
      targetMargin,
      reasons: handicapReason
    },
    total: {
      label: totalPick,
      lean: totalLean,
      preferredGoals,
      reasons: totalReason
    },
    score: {
      label: scorePick,
      candidates: scoreCandidates,
      detail: `按 ${handicapPick} + ${totalPick} 合成`
    },
    summary: `${confidenceTier === 'strong' ? '强推' : confidenceTier === 'candidate' ? '候选' : '观察'}：${handicapPick}；${totalPick}；比分 ${scorePick}。`
  };
}

function technicalReasonsOutput(match, outputs) {
  const reasons = [];
  const margin = expectedMargin(match);
  const total = expectedTotal(match);
  const asianLine = match?.odds?.asianLine;
  const script = outputs.script;

  if (script?.score) {
    const scoreText = `${script.score.homeGoals}-${script.score.awayGoals}`;
    const primaryText = outputs.score?.label;
    const conflictText = script.conflicts?.length ? `；存在 ${script.conflicts.join('、')}，因此降级观察` : '';
    const scriptPrimary = !primaryText || primaryText === scoreText;
    reasons.push(
      scriptPrimary
        ? `剧本：${script.label}，目标 ${rangeText(script.targetRange)}，优先比分 ${scoreText}${conflictText}。`
        : `剧本观察：${script.label} 给出 ${scoreText}，但主比分采用概率更高的 ${primaryText}${conflictText}。`
    );
  }

  if (outputs.moneyline.status === 'ready') {
    reasons.push(`胜平负：${outputs.moneyline.label} 的校准概率最高，为 ${outputs.moneyline.metric}。`);
  }

  if (outputs.goalCount.status !== 'pending') {
    const backup = outputs.goalCount.candidates?.slice(1).map((candidate) => candidate.label).join(' / ');
    reasons.push(
      `进球数：优先 ${outputs.goalCount.label}${backup ? `，备选 ${backup}` : ''}；期望总进球 ${isFiniteNumber(total) ? fixed(total, 2) : '--'}。`
    );
  }

  if (outputs.score.status === 'ready') {
    const backup = outputs.score.candidates?.slice(1).map((candidate) => candidate.label).join(' / ');
    reasons.push(`比分：优先 ${outputs.score.label}${backup ? `，备选 ${backup}` : ''}；先匹配胜平负、净胜球区间和进球数，再看概率/期望进球。`);
  }

  if (isFiniteNumber(margin) && isFiniteNumber(asianLine)) {
    reasons.push(`让球盘：期望净胜 ${signed(margin, 2)}，叠加盘口 ${signedLine(asianLine)} 后修正差 ${signed(margin + asianLine, 2)}；若与主胜同向但不穿盘，则只表达受让逻辑。`);
  }

  if (outputs.sporttery.status === 'ready' || outputs.sporttery.status === 'watch') {
    const sourceText = outputs.sporttery.fallback
      ? `${outputs.sporttery.title}：官方 HHAD 缺失时降级使用赛前胜平负盘口，${outputs.sporttery.detail}，${outputs.sporttery.metric}。`
      : `体彩让球：采用官方 HHAD ${outputs.sporttery.detail}，${outputs.sporttery.metric}。`;
    reasons.push(sourceText);
  }

  return reasons.slice(0, 5);
}

export function buildMarketOutputs(match, marketAudit, distributions = {}) {
  const script = buildMatchScript(match, marketAudit, distributions);
  const goalCount = goalCountOutput(match, distributions.goals, script);
  const outputs = {
    script,
    moneyline: moneylineOutput(match),
    sporttery: sportteryHandicapOutput(match, marketAudit, script),
    handicap: asianHandicapOutput(match, script),
    total: totalGoalsOutput(match, distributions.goals),
    goalCount,
    score: scoreRecommendationOutput(match, distributions.scores, goalCount, script)
  };
  return {
    ...outputs,
    reasons: technicalReasonsOutput(match, outputs)
  };
}
