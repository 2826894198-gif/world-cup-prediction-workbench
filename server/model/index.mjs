import { buildScoreModel } from './poisson.mjs';
import { marketConsensusFromSnapshots, marketFromOdds } from './market.mjs';
import { estimateStrength, resolveTeams } from './strength.mjs';
import { clamp, normalize, round } from './math.mjs';
import { evaluateRules } from './rules.mjs';

function pickLabel(key) {
  if (key === 'home') return '主胜';
  if (key === 'away') return '客胜';
  return '平局';
}

function scoreOutcomeKey(score) {
  if (score.home_goals > score.away_goals) return 'home';
  if (score.home_goals < score.away_goals) return 'away';
  return 'draw';
}

function scoreText(score) {
  return score ? `${score.home_goals}-${score.away_goals}` : '--';
}

function readJsonObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function predictionWeights(modelVersion) {
  const weights = readJsonObject(modelVersion?.weights_json);
  const defaults = {
    strength: 0.22,
    goal_model: 0.18,
    market: 0.52,
    factors: 0.08
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, finiteNumber(weights[key], fallback)])
  );
}

function predictionCalibration(modelVersion) {
  const calibration = readJsonObject(modelVersion?.calibration_json);
  return {
    drawFloor: finiteNumber(calibration.draw_floor, 0.18),
    drawCeiling: finiteNumber(calibration.draw_ceiling, 0.34)
  };
}

export function predictMatch(match, teamById, oddsSnapshots, rules, modelVersion, options = {}) {
  const { home, away } = resolveTeams(match, teamById);
  const latestOdds = oddsSnapshots.at(-1);
  const strength = estimateStrength(home, away, match);
  const baseScoreModel = buildScoreModel(strength.homeExpectedGoals, strength.awayExpectedGoals);
  const primaryMarket = marketFromOdds(latestOdds);
  const consensus = marketConsensusFromSnapshots(oddsSnapshots, {
    useProviderWeights: options.useProviderWeights,
    includeMovement: options.includeMovement
  });
  const market =
    consensus.providerCount >= 2
      ? {
          ...primaryMarket,
          home: consensus.home,
          draw: consensus.draw,
          away: consensus.away,
          favorite: consensus.favorite
        }
      : primaryMarket;
  const ruleResult = evaluateRules(match, oddsSnapshots, rules);
  const weights = predictionWeights(modelVersion);

  const blended = normalize([
    baseScoreModel.homeWin * weights.goal_model +
      strength.homeWin * weights.strength +
      market.home * weights.market +
      Math.max(0, ruleResult.factor) * weights.factors,
    baseScoreModel.draw * weights.goal_model +
      strength.draw * weights.strength +
      market.draw * weights.market +
      Math.abs(ruleResult.factor) * 0.15 * weights.factors,
    baseScoreModel.awayWin * weights.goal_model +
      strength.awayWin * weights.strength +
      market.away * weights.market +
      Math.max(0, -ruleResult.factor) * weights.factors
  ]);

  const calibration = predictionCalibration(modelVersion);
  const drawAdjusted = clamp(blended[1], calibration.drawFloor, calibration.drawCeiling);
  const sideTotal = 1 - drawAdjusted;
  const sideNormalized = normalize([blended[0], blended[2]]).map((value) => value * sideTotal);
  const calibrated = [sideNormalized[0], drawAdjusted, sideNormalized[1]];
  const maxProb = Math.max(...calibrated);
  const pickIndex = calibrated.indexOf(maxProb);
  const pickKey = pickIndex === 0 ? 'home' : pickIndex === 1 ? 'draw' : 'away';
  const scoreModel = buildScoreModel(strength.homeExpectedGoals, strength.awayExpectedGoals, {
    targetProbabilities: {
      home: calibrated[0],
      draw: calibrated[1],
      away: calibrated[2]
    },
    totalLine: latestOdds.total_line,
    overWater: latestOdds.over_water,
    underWater: latestOdds.under_water
  });
  const pickOdds = pickKey === 'home' ? latestOdds.home_odds : pickKey === 'draw' ? latestOdds.draw_odds : latestOdds.away_odds;
  const edge = maxProb * pickOdds - 1;
  const disagreement = Math.abs(calibrated[0] - market.home) + Math.abs(calibrated[2] - market.away);
  const primaryDisagreement =
    consensus.providerCount >= 2
      ? Math.abs(primaryMarket.home - consensus.home) + Math.abs(primaryMarket.draw - consensus.draw) + Math.abs(primaryMarket.away - consensus.away)
      : 0;
  const providerDisagreement = Number.isFinite(consensus.maxProbabilityRange) ? consensus.maxProbabilityRange : 0;
  const providerRisk = clamp((providerDisagreement - 0.035) * 1.8 + primaryDisagreement * 0.45 + (consensus.primaryAgreement === false ? 0.06 : 0), 0, 0.2);
  const movement = consensus.movement ?? {};
  const movementDeltaForPick =
    movement.providerCount >= 2 && movement.deltas ? finiteNumber(movement.deltas[pickKey], 0) : 0;
  const movementRisk = clamp(-movementDeltaForPick, 0, 0.07);
  const movementSupport = clamp(movementDeltaForPick, 0, 0.04);
  const tagRisk = ruleResult.tags
    .filter((tag) => ['极度拉满', '极度回盘', '妖刀', '热赛返走势'].includes(tag.rule.name))
    .reduce((sum, tag) => sum + tag.confidence * tag.rule.impact_strength, 0);
  const confidence = clamp(
    0.38 +
      (maxProb - 0.333) * 1.15 +
      strength.stability * 0.08 -
      tagRisk * 0.18 -
      providerRisk * 0.35 -
      movementRisk * 0.45 +
      movementSupport * 0.25,
    0.28,
    0.91
  );
  const upsetRisk = clamp(
    0.24 +
      disagreement * 0.34 +
      tagRisk * 0.95 +
      providerRisk * 0.9 +
      movementRisk * 0.75 -
      movementSupport * 0.2 +
      (1 - confidence) * 0.22,
    0.12,
    0.94
  );
  const riskLevel = upsetRisk > 0.5 ? '高' : upsetRisk > 0.4 ? '中' : '低';
  const topScores = scoreModel.scoreProbabilities.slice(0, 4);
  const directionalTopScore = scoreModel.scoreProbabilities.find((score) => scoreOutcomeKey(score) === pickKey) ?? topScores[0];
  const globalTopScore = topScores[0];
  const scoreLabel =
    directionalTopScore && globalTopScore && scoreText(directionalTopScore) !== scoreText(globalTopScore)
      ? `方向比分 ${scoreText(directionalTopScore)}，全局峰值 ${scoreText(globalTopScore)}`
      : `比分峰值 ${scoreText(globalTopScore)}`;
  const consensusLabel =
    consensus.method === 'historical_provider_weighted'
      ? `历史加权provider共识 ${consensus.matchedProviderCount}/${consensus.providerCount || 1}`
      : `provider共识 ${consensus.providerCount || 1}`;
  const movementLabel =
    movement.providerCount >= 2
      ? `盘口移动 ${movement.providerCount} 家，建议方向变化 ${round(movementDeltaForPick, 3)}`
      : `盘口移动样本不足 ${movement.providerCount ?? 0} 家`;

  return {
    match,
    home,
    away,
    latestOdds,
    tags: ruleResult.tags,
    prediction: {
      home_win_prob: round(blended[0]),
      draw_prob: round(blended[1]),
      away_win_prob: round(blended[2]),
      calibrated_home_prob: round(calibrated[0]),
      calibrated_draw_prob: round(calibrated[1]),
      calibrated_away_prob: round(calibrated[2]),
      expected_home_goals: round(scoreModel.expectedHomeGoals, 3),
      expected_away_goals: round(scoreModel.expectedAwayGoals, 3),
      confidence: round(confidence),
      upset_risk: round(upsetRisk),
      value_score: round(edge, 3),
      recommended_pick: pickLabel(pickKey),
      risk_level: riskLevel,
      explanation: `${pickLabel(pickKey)}为当前主模型建议；${scoreLabel}；进球均值 ${round(scoreModel.expectedTotalGoals, 2)}；市场分歧 ${round(disagreement, 3)}，${consensusLabel} 家，provider分歧 ${round(providerDisagreement, 3)}，${movementLabel}，标签风险 ${round(tagRisk, 3)}。`
    },
    scoreProbabilities: scoreModel.scoreProbabilities,
    goalProbabilities: scoreModel.goalProbabilities
  };
}
