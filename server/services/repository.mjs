import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, parseJson } from '../db/connection.mjs';
import { refreshPredictions } from '../db/refresh.mjs';
import { seedDatabase } from '../db/seed.mjs';
import { marketConsensusFromSnapshots } from '../model/market.mjs';
import { estimateStrength, placeholderTeam } from '../model/strength.mjs';
import { ODDS_AUDIT_FILE, refreshMarketOdds } from './oddsRefresh.mjs';
import {
  isPredictionUsableOddsSource,
  oddsSourceTier,
  predictionUsableSourceSqlList,
  preferredPredictionSnapshots
} from './oddsSourcePolicy.mjs';
import { previewDecision } from './previewDecision.mjs';
import { buildProbabilityUncertainty } from './probabilityUncertainty.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = dirname(dirname(__dirname));
const REPORT_DIR = join(ROOT_DIR, 'reports');
const PREVIEW_DECISION_AUDIT_FILE = join(REPORT_DIR, 'preview-decision-audit.json');
const FRIENDLY_PREDICTION_LEDGER_FILE = join(REPORT_DIR, 'friendly-prediction-ledger.json');
const MODEL_CHANGE_IMPACT_AUDIT_FILE = join(REPORT_DIR, 'model-change-impact-audit.json');
const PROMOTION_GATE_AUDIT_FILE = join(REPORT_DIR, 'promotion-gate-audit.json');
const OFFICIAL_2026_SCHEDULE_FILE = join(
  ROOT_DIR,
  'data',
  'research',
  'worldcup-2026',
  'official-schedule.json'
);
function percent(value) {
  return Math.round((value ?? 0) * 1000) / 10;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readJsonReport(filename) {
  const filePath = join(REPORT_DIR, filename);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      error: `无法读取报告 ${filename}: ${error.message}`
    };
  }
}

function isSampleSandboxMatches(matches) {
  return matches.length > 0 && matches.every((match) => match.status === 'sample_placeholder');
}

function officialFixtureLabel(fixture) {
  const home = fixture.home_code ?? fixture.home_placeholder ?? 'TBD';
  const away = fixture.away_code ?? fixture.away_placeholder ?? 'TBD';
  return `${home} vs ${away}`;
}

function mapOfficialFixture(fixture) {
  return {
    matchNo: fixture.match_no,
    stage: fixture.stage,
    roundLabel: fixture.round_label,
    dateEt: fixture.date_et,
    kickoffEt: fixture.kickoff_et,
    kickoffUtc: fixture.kickoff_utc,
    venue: fixture.venue,
    label: officialFixtureLabel(fixture)
  };
}

function readOfficialScheduleAudit() {
  if (!existsSync(OFFICIAL_2026_SCHEDULE_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(OFFICIAL_2026_SCHEDULE_FILE, 'utf8'));
    const fixtures = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
    const sampleMatchNumbers = new Set([1, 2, 3, 4, 5, 6, 7, 8, 73, 74, 88, 89, 97, 101, 102, 103, 104]);
    return {
      status: parsed.status ?? 'official_schedule_parsed',
      file: 'data/research/worldcup-2026/official-schedule.json',
      matchCount: parsed.match_count ?? fixtures.length,
      dateSpanEt: parsed.date_span_et,
      stageCounts: parsed.stage_counts,
      venueCount: parsed.venue_count,
      timeBasis: parsed.time_basis,
      sourcePage: parsed.source_page,
      sourceRelease: parsed.source_release,
      sourcePdf: parsed.source_pdf,
      localPdf: parsed.local_pdf,
      parser: parsed.parser,
      sampleFixtures: fixtures
        .filter((fixture) => sampleMatchNumbers.has(fixture.match_no))
        .map(mapOfficialFixture)
    };
  } catch (error) {
    return {
      status: 'official_schedule_read_error',
      file: 'data/research/worldcup-2026/official-schedule.json',
      error: error.message
    };
  }
}

function readOddsSourceAudit() {
  if (!existsSync(ODDS_AUDIT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(ODDS_AUDIT_FILE, 'utf8'));
    return {
      status: parsed.status ?? 'odds_source_audit_read',
      file: 'data/research/worldcup-2026/odds-source-audit.json',
      generatedAt: parsed.generatedAt,
      targetWindow: parsed.targetWindow,
      sourcePolicy: parsed.sourcePolicy,
      recommendationPolicy: parsed.recommendationPolicy,
      euroHandicapRecommendations: parsed.euroHandicapRecommendations ?? null,
      recommendationDiff: parsed.recommendationDiff ?? null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      importSummary: parsed.importSummary ?? {}
    };
  } catch (error) {
    return {
      status: 'odds_source_audit_read_error',
      file: 'data/research/worldcup-2026/odds-source-audit.json',
      error: error.message,
      sources: [],
      importSummary: {}
    };
  }
}

function readPreviewDecisionAudit() {
  if (!existsSync(PREVIEW_DECISION_AUDIT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(PREVIEW_DECISION_AUDIT_FILE, 'utf8'));
    return {
      ...parsed,
      file: 'reports/preview-decision-audit.json'
    };
  } catch (error) {
    return {
      ok: false,
      file: 'reports/preview-decision-audit.json',
      error: error.message
    };
  }
}

function readFriendlyPredictionLedger() {
  if (!existsSync(FRIENDLY_PREDICTION_LEDGER_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(FRIENDLY_PREDICTION_LEDGER_FILE, 'utf8'));
    return {
      ...parsed,
      file: 'reports/friendly-prediction-ledger.json'
    };
  } catch (error) {
    return {
      ok: false,
      file: 'reports/friendly-prediction-ledger.json',
      error: error.message
    };
  }
}

function readModelChangeImpactAudit() {
  if (!existsSync(MODEL_CHANGE_IMPACT_AUDIT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(MODEL_CHANGE_IMPACT_AUDIT_FILE, 'utf8'));
    return {
      ...parsed,
      file: 'reports/model-change-impact-audit.json'
    };
  } catch (error) {
    return {
      ok: false,
      file: 'reports/model-change-impact-audit.json',
      error: error.message
    };
  }
}

function readPromotionGateAudit() {
  if (!existsSync(PROMOTION_GATE_AUDIT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(PROMOTION_GATE_AUDIT_FILE, 'utf8'));
    return {
      ...parsed,
      file: 'reports/promotion-gate-audit.json'
    };
  } catch (error) {
    return {
      ok: false,
      file: 'reports/promotion-gate-audit.json',
      error: error.message
    };
  }
}

function normalizeProbabilities(values) {
  const probs = values.map((value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0));
  const total = probs.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0.38, 0.26, 0.36];
  return probs.map((value) => value / total);
}

function resultPickFromProbabilities(probabilities) {
  const entries = [
    ['主胜', Number(probabilities?.home ?? 0)],
    ['平局', Number(probabilities?.draw ?? 0)],
    ['客胜', Number(probabilities?.away ?? 0)]
  ];
  return entries.toSorted((left, right) => right[1] - left[1]).at(0)?.[0] ?? null;
}

function auxiliaryDirectionSignal(row, hasUsablePrediction) {
  const home = teamFromRow(row, 'home');
  const away = teamFromRow(row, 'away');
  const strength = estimateStrength(home, away, { stage: row.stage, match_no: row.match_no });
  const [homeProb, drawProb, awayProb] = normalizeProbabilities([
    strength.homeWin,
    strength.draw,
    strength.awayWin
  ]);
  const probabilities = {
    home: roundNumber(homeProb),
    draw: roundNumber(drawProb),
    away: roundNumber(awayProb)
  };
  const sorted = [homeProb, drawProb, awayProb].toSorted((left, right) => right - left);
  const pick = resultPickFromProbabilities(probabilities);
  const aligned = hasUsablePrediction && row.recommended_pick != null ? pick === row.recommended_pick : null;
  const adjustment = aligned === true ? 0.06 : aligned === false ? -0.06 : 0;
  const baseConfidence = finiteNumber(row.confidence);
  const adjustedConfidence =
    baseConfidence == null ? null : roundNumber(Math.min(0.94, Math.max(0.18, baseConfidence + adjustment)));
  const status = aligned === true ? 'aligned' : aligned === false ? 'conflict' : 'reference_only';
  return {
    source: 'team_strength_prior',
    status,
    aligned,
    pick,
    probabilities,
    confidence: roundNumber(sorted[0]),
    margin: roundNumber(sorted[0] - sorted[1]),
    confidenceAdjustment: roundNumber(adjustment),
    adjustedConfidence,
    label:
      status === 'aligned'
        ? '辅助方向一致'
        : status === 'conflict'
          ? '辅助方向分歧'
          : '辅助先验参考',
    note:
      status === 'aligned'
        ? '球队强度辅助模型与盘口主模型同向，展示置信度上调。'
        : status === 'conflict'
          ? '球队强度辅助模型与盘口主模型不同向，展示置信度下调并建议降级观察。'
          : '缺少主模型输出时，仅展示球队强度辅助方向。'
  };
}

function asianResultKey(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number > 0) return 'home';
  if (number < 0) return 'away';
  return 'push';
}

function asianRecommendedSide(adjustedMargin, line, rawMargin) {
  if (!Number.isFinite(adjustedMargin)) return null;
  if (adjustedMargin > 0) return 'home';
  if (adjustedMargin < 0) return 'away';
  if (line < 0) return 'away';
  if (line > 0) return 'home';
  if (rawMargin > 0) return 'home';
  if (rawMargin < 0) return 'away';
  return null;
}

function asianPickIsCorrect(row) {
  const line = Number(row.asian_line);
  const homeScore = Number(row.home_score);
  const awayScore = Number(row.away_score);
  const topScoreHome = Number(row.top_score_home_goals);
  const topScoreAway = Number(row.top_score_away_goals);
  const expectedHome = Number(row.expected_home_goals);
  const expectedAway = Number(row.expected_away_goals);
  const predictedMargin =
    [topScoreHome, topScoreAway].every(Number.isFinite)
      ? topScoreHome - topScoreAway
      : [expectedHome, expectedAway].every(Number.isFinite)
        ? expectedHome - expectedAway
        : null;
  const predictedKey =
    predictedMargin == null ? null : asianRecommendedSide(predictedMargin + line, line, predictedMargin);
  if (![line, homeScore, awayScore].every(Number.isFinite) || !predictedKey) return null;
  return predictedKey === asianResultKey(homeScore - awayScore + line);
}

function teamFromRow(row, side) {
  const prefix = side === 'home' ? 'home' : 'away';
  const id = row[`${prefix}_team_id`];
  if (!id) return placeholderTeam(row[`${prefix}_placeholder`], row.match_no + (side === 'home' ? 0 : 17));
  return {
    id,
    name_zh: row[`${prefix}_team_name`] ?? row[`${prefix}_placeholder`],
    elo: row[`${prefix}_elo`],
    glicko_mu: row[`${prefix}_glicko_mu`],
    glicko_phi: row[`${prefix}_glicko_phi`],
    attack: row[`${prefix}_attack`],
    defense: row[`${prefix}_defense`],
    form: row[`${prefix}_form`]
  };
}

function buildReviewBaseline(row, hasUsablePrediction) {
  if (hasUsablePrediction) {
    const probabilities = {
      home: row.calibrated_home_prob,
      draw: row.calibrated_draw_prob,
      away: row.calibrated_away_prob
    };
    return {
      source: 'market_prediction',
      label: '赛前盘口预测',
      pick: row.recommended_pick,
      probabilities,
      confidence: row.confidence,
      expectedGoals: {
        home: row.expected_home_goals,
        away: row.expected_away_goals
      },
      countsAsMarketPrediction: true
    };
  }

  const home = teamFromRow(row, 'home');
  const away = teamFromRow(row, 'away');
  const strength = estimateStrength(home, away, { stage: row.stage, match_no: row.match_no });
  const [homeProb, drawProb, awayProb] = normalizeProbabilities([
    strength.homeWin,
    strength.draw,
    strength.awayWin
  ]);
  const probabilities = {
    home: homeProb,
    draw: drawProb,
    away: awayProb
  };
  return {
    source: 'team_strength_prior',
    label: '赛前模型先验',
    pick: resultPickFromProbabilities(probabilities),
    probabilities,
    confidence: Math.max(homeProb, drawProb, awayProb),
    expectedGoals: {
      home: strength.homeExpectedGoals,
      away: strength.awayExpectedGoals
    },
    countsAsMarketPrediction: false,
    note: '该场缺少可信赛前盘口快照，复盘只使用赛前球队强度先验。'
  };
}

function seededUnit(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function drawOutcome(probabilities, random) {
  const value = random();
  if (value < probabilities[0]) return 'home';
  if (value < probabilities[0] + probabilities[1]) return 'draw';
  return 'away';
}

function teamStrengthScore(team) {
  return (
    Number(team.elo ?? 1600) +
    Number(team.attack ?? 1) * 28 +
    Number(team.defense ?? 1) * 24 +
    Number(team.form ?? 0.5) * 38
  );
}

function emptyStanding(row) {
  return {
    team: row.team,
    code: row.code,
    seedRank: row.seedRank,
    elo: row.elo,
    strengthScore: row.strengthScore,
    pts: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    advanceCount: 0
  };
}

function compareStanding(left, right) {
  return (
    right.pts - left.pts ||
    right.gd - left.gd ||
    right.gf - left.gf ||
    right.strengthScore - left.strengthScore ||
    left.seedRank - right.seedRank
  );
}

function roundOne(value) {
  return Math.round(Number(value ?? 0) * 10) / 10;
}

function applyExpectedMatchStats(model) {
  const [homeWin, draw, awayWin] = model.probabilities;
  model.home.pts += homeWin * 3 + draw;
  model.away.pts += awayWin * 3 + draw;
  model.home.gf += model.homeExpectedGoals;
  model.home.ga += model.awayExpectedGoals;
  model.away.gf += model.awayExpectedGoals;
  model.away.ga += model.homeExpectedGoals;
}

function applyScoreToStanding(home, away, homeScore, awayScore) {
  home.gf += homeScore;
  home.ga += awayScore;
  away.gf += awayScore;
  away.ga += homeScore;
  if (homeScore > awayScore) {
    home.pts += 3;
  } else if (homeScore < awayScore) {
    away.pts += 3;
  } else {
    home.pts += 1;
    away.pts += 1;
  }
  home.gd = home.gf - home.ga;
  away.gd = away.gf - away.ga;
}

function applySettledMatchStats(model) {
  applyScoreToStanding(model.home, model.away, model.homeScore, model.awayScore);
}

function applySettledSimulatedMatch(model, standings) {
  const home = standings.get(model.home.team);
  const away = standings.get(model.away.team);
  if (!home || !away) return;
  applyScoreToStanding(home, away, model.homeScore, model.awayScore);
}

function applySimulatedMatch(model, standings, random) {
  const home = standings.get(model.home.team);
  const away = standings.get(model.away.team);
  if (!home || !away) return;

  const outcome = drawOutcome(model.probabilities, random);
  const expectedMargin = model.homeExpectedGoals - model.awayExpectedGoals;
  const decisiveMargin = Math.max(0.35, Math.abs(expectedMargin) + 0.62 + random() * 0.45);
  const drawGoals = Math.max(0.25, (model.homeExpectedGoals + model.awayExpectedGoals) / 2 + (random() - 0.5) * 0.28);

  if (outcome === 'home') {
    const homeGoals = Math.max(0.9, model.homeExpectedGoals + decisiveMargin * 0.22);
    const awayGoals = Math.max(0.15, model.awayExpectedGoals - decisiveMargin * 0.18);
    home.pts += 3;
    home.gf += homeGoals;
    home.ga += awayGoals;
    away.gf += awayGoals;
    away.ga += homeGoals;
  } else if (outcome === 'away') {
    const awayGoals = Math.max(0.9, model.awayExpectedGoals + decisiveMargin * 0.22);
    const homeGoals = Math.max(0.15, model.homeExpectedGoals - decisiveMargin * 0.18);
    away.pts += 3;
    away.gf += awayGoals;
    away.ga += homeGoals;
    home.gf += homeGoals;
    home.ga += awayGoals;
  } else {
    home.pts += 1;
    away.pts += 1;
    home.gf += drawGoals;
    home.ga += drawGoals;
    away.gf += drawGoals;
    away.ga += drawGoals;
  }

  home.gd = home.gf - home.ga;
  away.gd = away.gf - away.ga;
}

function rowScoreCandidate(homeGoals, awayGoals, probability) {
  if (homeGoals == null || awayGoals == null) return null;
  return {
    homeGoals,
    awayGoals,
    probability
  };
}

function rowGoalCandidate(totalGoals, probability) {
  if (totalGoals == null) return null;
  return {
    totalGoals,
    probability
  };
}

function mapMatchRow(row, oddsSnapshots = null, scoreCandidates = null, goalCandidates = null) {
  const homeName = row.home_team_name ?? row.home_placeholder;
  const awayName = row.away_team_name ?? row.away_placeholder;
  const consensusSnapshots = Array.isArray(oddsSnapshots)
    ? preferredPredictionSnapshots(
        oddsSnapshots.filter((snapshot) => isVerifiedOddsSource(snapshot.source_type)),
        { allowSample: true }
      )
    : null;
  const consensus = Array.isArray(consensusSnapshots) ? marketConsensusFromSnapshots(consensusSnapshots) : null;
  const marketConsensus = mapMarketConsensus(row, consensus);
  const rawPredictionAvailable = row.prediction_id != null;
  const sourceVerified = isVerifiedOddsSource(row.odds_source_type);
  const hasUsablePrediction = rawPredictionAvailable;
  const tags = row.tags ? row.tags.split('|').filter(Boolean) : [];
  const resultSummary =
    row.result_1x2 == null
      ? null
      : {
          homeScore: row.home_score,
          awayScore: row.away_score,
          result1x2: row.result_1x2,
          handicapResult: row.handicap_result,
          totalResult: row.total_result,
          upsetType: row.upset_type,
          note: row.result_note
        };
  const reviewBaseline = resultSummary ? buildReviewBaseline(row, hasUsablePrediction) : null;
  const marketQuality = mapPreviewMarketQuality(row, consensus);
  const decision = previewDecision(row.value_score, row.confidence, row.upset_risk, marketQuality);
  const auxiliarySignal = auxiliaryDirectionSignal(row, hasUsablePrediction);
  const probabilityUncertainty = buildProbabilityUncertainty(
    {
      home: row.calibrated_home_prob,
      draw: row.calibrated_draw_prob,
      away: row.calibrated_away_prob
    },
    {
      providerDisagreement: marketConsensus?.maxProbabilityRange ?? row.consensus_max_probability_range,
      latestAgeHours: decision.marketQuality?.latestAgeHours,
      candidateReady: decision.marketQuality?.candidateReady,
      watchReady: decision.marketQuality?.watchReady
    }
  );
  return {
    id: row.id,
    matchNo: row.match_no,
    stage: row.stage,
    groupName: row.group_name,
    roundLabel: row.round_label,
    kickoffUtc: row.kickoff_utc,
    venue: row.venue,
    homeTeam: homeName,
    awayTeam: awayName,
    status: row.status,
    hasPrediction: hasUsablePrediction,
    rawPredictionAvailable,
    sourceVerified,
    sourceTier: oddsSourceTier(row.odds_source_type),
    predictionBlockedReason: null,
    probabilities: {
      home: row.calibrated_home_prob,
      draw: row.calibrated_draw_prob,
      away: row.calibrated_away_prob
    },
    rawProbabilities: {
      home: row.home_win_prob,
      draw: row.draw_prob,
      away: row.away_win_prob
    },
    probabilityUncertainty,
    expectedGoals: {
      home: row.expected_home_goals,
      away: row.expected_away_goals
    },
    confidence: row.confidence,
    displayConfidence: auxiliarySignal.adjustedConfidence ?? row.confidence,
    auxiliarySignal,
    upsetRisk: row.upset_risk,
    valueScore: row.value_score,
    recommendedPick: row.recommended_pick,
    reviewBaseline,
    previewDecision: decision,
    marketQuality: decision.marketQuality,
    riskLevel: row.risk_level,
    explanation: row.explanation,
    odds: {
      provider: row.odds_provider,
      capturedAt: row.odds_captured_at,
      sourceType: row.odds_source_type,
      snapshotHash: row.odds_snapshot_hash,
      home: row.home_odds,
      draw: row.draw_odds,
      away: row.away_odds,
      asianLine: row.asian_line,
      asianHomeWater: row.asian_home_water,
      asianAwayWater: row.asian_away_water,
      totalLine: row.total_line,
      overWater: row.over_water,
      underWater: row.under_water
    },
    marketConsensus,
    tags,
    scoreSummary:
      row.top_score_home_goals == null
        ? null
        : {
            homeGoals: row.top_score_home_goals,
            awayGoals: row.top_score_away_goals,
            probability: row.top_score_probability
          },
    scoreCandidates: [
      ...(Array.isArray(scoreCandidates)
        ? scoreCandidates.map((score) => rowScoreCandidate(score.home_goals, score.away_goals, score.probability))
        : [
            rowScoreCandidate(row.top_score_home_goals, row.top_score_away_goals, row.top_score_probability),
            rowScoreCandidate(row.second_score_home_goals, row.second_score_away_goals, row.second_score_probability),
            rowScoreCandidate(row.third_score_home_goals, row.third_score_away_goals, row.third_score_probability)
          ])
    ].filter(Boolean),
    goalSummary:
      row.total_over_probability == null
        ? null
        : {
            overProbability: row.total_over_probability,
            underProbability: row.total_under_probability,
            pushProbability: row.total_push_probability
          },
    goalCandidates: [
      ...(Array.isArray(goalCandidates)
        ? goalCandidates.map((goal) => rowGoalCandidate(goal.total_goals, goal.probability))
        : [
            rowGoalCandidate(row.top_goal_total_goals, row.top_goal_probability),
            rowGoalCandidate(row.second_goal_total_goals, row.second_goal_probability)
          ])
    ].filter(Boolean),
    resultSummary
  };
}

function mapResult(row) {
  if (!row) return null;
  return {
    homeScore: row.home_score,
    awayScore: row.away_score,
    result1x2: row.result_1x2,
    handicapResult: row.handicap_result,
    totalResult: row.total_result,
    upsetType: row.upset_type,
    settledAt: row.settled_at,
    note: row.note
  };
}

function guessTypeLabel(type) {
  if (type === 'result') return '胜平负';
  if (type === 'handicap_result') return '让球胜平负';
  if (type === 'total_goals') return '总进球数';
  if (type === 'score') return '比分';
  return '猜测';
}

function resultPickLabel(key) {
  if (key === 'home') return '主胜';
  if (key === 'draw') return '平局';
  if (key === 'away') return '客胜';
  return null;
}

function handicapPickLabel(key) {
  if (key === 'home') return '让胜';
  if (key === 'draw') return '让平';
  if (key === 'away') return '让负';
  return null;
}

function handicapActualLabel(value) {
  if (value === '主队赢盘') return '让胜';
  if (value === '走水') return '让平';
  if (value === '主队输盘') return '让负';
  return value ?? '--';
}

function handicapActualKey(value) {
  if (value === '主队赢盘') return 'home';
  if (value === '走水') return 'draw';
  if (value === '主队输盘') return 'away';
  return null;
}

function splitGuessKeys(value) {
  if (Array.isArray(value)) return value.flatMap(splitGuessKeys);
  return String(value ?? '')
    .split(/[|,，、/\\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeScorePick(value) {
  const match = String(value ?? '').trim().match(/(\d{1,2})\s*(?:-|:|比)\s*(\d{1,2})/);
  if (!match) return null;
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 20 || away > 20) return null;
  return `${home}-${away}`;
}

function normalizeGuessPick(type, rawKey) {
  const keys = splitGuessKeys(rawKey);
  if (!keys.length) return null;
  const normalized = [];
  const seen = new Set();
  const add = (pickKey, pickLabel) => {
    if (!pickKey || seen.has(pickKey)) return;
    seen.add(pickKey);
    normalized.push({ pickKey, pickLabel });
  };
  if (type === 'result') {
    for (const key of keys) {
      const label = resultPickLabel(key);
      if (label) add(key, label);
    }
  } else if (type === 'handicap_result') {
    for (const key of keys) {
      const label = handicapPickLabel(key);
      if (label) add(key, label);
    }
  } else if (type === 'total_goals') {
    for (const key of keys) {
      if (key === '7+') {
        add(key, '7+ 球');
        continue;
      }
      const total = Number(key);
      if (Number.isInteger(total) && total >= 0 && total <= 6) add(String(total), `${total} 球`);
    }
  } else if (type === 'score') {
    for (const key of keys) {
      const score = normalizeScorePick(key);
      if (score) add(score, score);
    }
  }
  if (!normalized.length) return null;
  return {
    pickKey: normalized.map((item) => item.pickKey).join('|'),
    pickLabel: normalized.map((item) => item.pickLabel).join(' / ')
  };
}

function settleGuess(row) {
  if (row.result_1x2 == null || row.home_score == null || row.away_score == null) {
    return {
      status: 'pending',
      hit: null,
      actualLabel: '待赛果',
      score: null,
      settledAt: null
    };
  }

  const score = `${row.home_score}-${row.away_score}`;
  const totalGoals = Number(row.home_score) + Number(row.away_score);
  const pickKeys = splitGuessKeys(row.pick_key);
  let hit = false;
  let actualLabel = row.result_1x2;

  if (row.market_type === 'result') {
    const settledOutcome = row.result_1x2 === '主胜' ? 'home' : row.result_1x2 === '平局' ? 'draw' : row.result_1x2 === '客胜' ? 'away' : null;
    hit = settledOutcome != null && pickKeys.includes(settledOutcome);
    actualLabel = row.result_1x2;
  } else if (row.market_type === 'handicap_result') {
    const actualKey = handicapActualKey(row.handicap_result);
    hit = actualKey != null && pickKeys.includes(actualKey);
    actualLabel = handicapActualLabel(row.handicap_result);
  } else if (row.market_type === 'total_goals') {
    hit = pickKeys.some((key) => (key === '7+' ? totalGoals >= 7 : totalGoals === Number(key)));
    actualLabel = `${totalGoals} 球`;
  } else if (row.market_type === 'score') {
    hit = pickKeys.includes(score);
    actualLabel = score;
  }

  return {
    status: 'settled',
    hit,
    actualLabel,
    score,
    settledAt: row.settled_at
  };
}

function mapPersonalGuess(row) {
  const settlement = settleGuess(row);
  return {
    id: row.id,
    matchId: row.match_id,
    matchNo: row.match_no,
    stage: row.stage,
    groupName: row.group_name,
    roundLabel: row.round_label,
    kickoffUtc: row.kickoff_utc,
    venue: row.venue,
    fixture: `${row.home_team_name ?? row.home_placeholder} vs ${row.away_team_name ?? row.away_placeholder}`,
    homeTeam: row.home_team_name ?? row.home_placeholder,
    awayTeam: row.away_team_name ?? row.away_placeholder,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    marketType: row.market_type,
    marketLabel: guessTypeLabel(row.market_type),
    pickKey: row.pick_key,
    pickLabel: row.pick_label,
    confidence: row.confidence,
    note: row.note,
    settlement
  };
}

function personalGuessGroupKey(guess) {
  return guess.note
    ? [guess.matchId, guess.confidence, guess.note].join('|')
    : [guess.matchId, guess.createdAt, guess.updatedAt, guess.confidence].join('|');
}

function groupPersonalGuessesForStats(guesses) {
  const groups = new Map();
  for (const guess of guesses) {
    const key = personalGuessGroupKey(guess);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(guess);
  }

  return [...groups.values()].map((rows) => {
    const settledRows = rows.filter((guess) => guess.settlement.status === 'settled');
    const allSettled = settledRows.length === rows.length;
    const hitRows = settledRows.filter((guess) => guess.settlement.hit);
    const confidence =
      rows.reduce((sum, guess) => sum + Number(guess.confidence ?? 0), 0) / Math.max(1, rows.length);
    return {
      rows,
      confidence,
      settled: allSettled,
      hit: allSettled ? hitRows.length === rows.length : false
    };
  });
}

function buildGuessStats(guesses) {
  const groups = groupPersonalGuessesForStats(guesses);
  const settledGroups = groups.filter((group) => group.settled);
  const hits = settledGroups.filter((group) => group.hit).length;
  const byType = ['result', 'handicap_result', 'total_goals', 'score'].map((type) => {
    const rows = guesses.filter((guess) => guess.marketType === type);
    const settledRows = rows.filter((guess) => guess.settlement.status === 'settled');
    const typeHits = settledRows.filter((guess) => guess.settlement.hit).length;
    return {
      key: type,
      label: guessTypeLabel(type),
      total: rows.length,
      matches: rows.length,
      settled: settledRows.length,
      hits: typeHits,
      hitRate: settledRows.length ? typeHits / settledRows.length : null
    };
  });
  const confidenceBands = [
    { key: 'high', label: '高信心', test: (value) => value >= 0.7 },
    { key: 'mid', label: '中信心', test: (value) => value >= 0.5 && value < 0.7 },
    { key: 'low', label: '低信心', test: (value) => value < 0.5 }
  ].map((band) => {
    const rows = groups.filter((group) => band.test(group.confidence));
    const settledRows = rows.filter((group) => group.settled);
    const bandHits = settledRows.filter((group) => group.hit).length;
    return {
      key: band.key,
      label: band.label,
      total: rows.length,
      matches: rows.length,
      settled: settledRows.length,
      hits: bandHits,
      hitRate: settledRows.length ? bandHits / settledRows.length : null
    };
  });
  return {
    total: groups.length,
    pending: groups.length - settledGroups.length,
    settled: settledGroups.length,
    hits,
    misses: settledGroups.length - hits,
    hitRate: settledGroups.length ? hits / settledGroups.length : null,
    avgConfidence: groups.length
      ? groups.reduce((sum, group) => sum + group.confidence, 0) / groups.length
      : null,
    byType,
    confidenceBands
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isVerifiedOddsSource(sourceType) {
  return isPredictionUsableOddsSource(sourceType, { allowSample: true });
}

function roundNumber(value, precision = 4) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function favoriteFromProbabilities(home, draw, away) {
  if ([home, draw, away].some((value) => finiteNumber(value) == null)) return null;
  if (home >= draw && home >= away) return 'home';
  if (away >= home && away >= draw) return 'away';
  return 'draw';
}

function marketFavoriteFromOdds(row) {
  const implied = [1 / Number(row.home_odds), 1 / Number(row.draw_odds), 1 / Number(row.away_odds)];
  const total = implied.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return favoriteFromProbabilities(implied[0] / total, implied[1] / total, implied[2] / total);
}

function mapMarketConsensus(row, consensus = null) {
  const providerCount = Number(consensus?.providerCount ?? row.consensus_provider_count ?? 0);
  if (providerCount <= 0) return null;
  const home = finiteNumber(consensus?.home ?? row.consensus_home_prob);
  const draw = finiteNumber(consensus?.draw ?? row.consensus_draw_prob);
  const away = finiteNumber(consensus?.away ?? row.consensus_away_prob);
  const favorite = consensus?.favorite ?? favoriteFromProbabilities(home, draw, away);
  const primaryFavorite = marketFavoriteFromOdds(row);
  return {
    method: consensus?.method ?? 'equal_provider_average',
    providerCount,
    matchedProviderCount: Number(consensus?.matchedProviderCount ?? 0),
    snapshotCount: Number(consensus?.snapshotCount ?? row.consensus_snapshot_count ?? 0),
    probabilities: {
      home: roundNumber(home),
      draw: roundNumber(draw),
      away: roundNumber(away)
    },
    favorite,
    primaryAgreement:
      consensus?.primaryAgreement ?? (primaryFavorite == null || favorite == null ? null : primaryFavorite === favorite),
    maxProbabilityRange: roundNumber(consensus?.maxProbabilityRange ?? row.consensus_max_probability_range),
    avgProbabilityRange: roundNumber(consensus?.avgProbabilityRange ?? row.consensus_avg_probability_range),
    latestCapturedAt: consensus?.latestCapturedAt ?? row.consensus_latest_captured_at,
    oldestProviderCapturedAt: consensus?.oldestProviderCapturedAt ?? row.consensus_oldest_provider_captured_at,
    providerWeightRange: consensus?.providerWeightRange ?? null,
    movement: consensus?.movement
      ? {
          ...consensus.movement,
          providers: (consensus.movement.providers ?? []).map((provider) => ({
            provider: provider.provider,
            snapshots: provider.snapshots,
            firstCapturedAt: provider.firstCapturedAt,
            latestCapturedAt: provider.latestCapturedAt,
            capturedSpanHours: provider.capturedSpanHours,
            firstFavorite: provider.firstFavorite,
            latestFavorite: provider.latestFavorite,
            deltas: provider.deltas,
            maxAbsMove: provider.maxAbsMove,
            favoriteDelta: provider.favoriteDelta,
            weight: roundNumber(provider.reliability?.weight),
            historicalCode: provider.reliability?.code,
            historicalLabel: provider.reliability?.label,
            evidenceMatched: provider.reliability?.matched ?? false
          }))
        }
      : null,
    oddsRange: {
      home: {
        min: roundNumber(consensus?.homeOddsRange?.min ?? row.consensus_home_odds_min, 2),
        max: roundNumber(consensus?.homeOddsRange?.max ?? row.consensus_home_odds_max, 2)
      },
      draw: {
        min: roundNumber(consensus?.drawOddsRange?.min ?? row.consensus_draw_odds_min, 2),
        max: roundNumber(consensus?.drawOddsRange?.max ?? row.consensus_draw_odds_max, 2)
      },
      away: {
        min: roundNumber(consensus?.awayOddsRange?.min ?? row.consensus_away_odds_min, 2),
        max: roundNumber(consensus?.awayOddsRange?.max ?? row.consensus_away_odds_max, 2)
      }
    },
    providers: (consensus?.providers ?? []).map((provider) => ({
      provider: provider.provider,
      capturedAt: provider.capturedAt,
      weight: roundNumber(provider.reliability?.weight),
      historicalCode: provider.reliability?.code,
      historicalLabel: provider.reliability?.label,
      evidenceRows: provider.reliability?.rows,
      evidenceMatched: provider.reliability?.matched ?? false,
      note: provider.reliability?.note
    }))
  };
}

function mapPreviewMarketQuality(row, consensus = null) {
  const providerCount = Number(consensus?.providerCount ?? row.consensus_provider_count ?? 0);
  if (providerCount <= 0 && !row.odds_captured_at) return null;
  return {
    providerCount,
    latestCapturedAt: consensus?.latestCapturedAt ?? row.consensus_latest_captured_at ?? row.odds_captured_at,
    maxProviderDisagreement: roundNumber(consensus?.maxProbabilityRange ?? row.consensus_max_probability_range),
    generatedAt: row.prediction_generated_at
  };
}

const matchListSql = `
  WITH provider_latest_snapshots AS (
    SELECT os.*
    FROM odds_snapshots os
    WHERE datetime(os.captured_at) <= datetime('now', '+15 minutes')
      AND NOT EXISTS (
      SELECT 1
      FROM odds_snapshots newer
      WHERE newer.match_id = os.match_id
        AND newer.provider = os.provider
        AND datetime(newer.captured_at) <= datetime('now', '+15 minutes')
        AND (
          datetime(newer.captured_at) > datetime(os.captured_at)
          OR (newer.captured_at = os.captured_at AND newer.id > os.id)
        )
    )
  ),
  provider_market AS (
    SELECT
      *,
      (1.0 / home_odds) / ((1.0 / home_odds) + (1.0 / draw_odds) + (1.0 / away_odds)) AS implied_home_prob,
      (1.0 / draw_odds) / ((1.0 / home_odds) + (1.0 / draw_odds) + (1.0 / away_odds)) AS implied_draw_prob,
      (1.0 / away_odds) / ((1.0 / home_odds) + (1.0 / draw_odds) + (1.0 / away_odds)) AS implied_away_prob
    FROM provider_latest_snapshots
  ),
  market_consensus AS (
    SELECT
      pm.match_id,
      COUNT(*) AS provider_count,
      AVG(pm.implied_home_prob) AS home_prob,
      AVG(pm.implied_draw_prob) AS draw_prob,
      AVG(pm.implied_away_prob) AS away_prob,
      MAX(pm.implied_home_prob) - MIN(pm.implied_home_prob) AS home_range,
      MAX(pm.implied_draw_prob) - MIN(pm.implied_draw_prob) AS draw_range,
      MAX(pm.implied_away_prob) - MIN(pm.implied_away_prob) AS away_range,
      MIN(pm.captured_at) AS oldest_provider_captured_at,
      MAX(pm.captured_at) AS latest_captured_at,
      MIN(pm.home_odds) AS home_odds_min,
      MAX(pm.home_odds) AS home_odds_max,
      MIN(pm.draw_odds) AS draw_odds_min,
      MAX(pm.draw_odds) AS draw_odds_max,
      MIN(pm.away_odds) AS away_odds_min,
      MAX(pm.away_odds) AS away_odds_max
    FROM provider_market pm
    GROUP BY pm.match_id
  ),
  snapshot_counts AS (
    SELECT match_id, COUNT(*) AS snapshot_count
    FROM odds_snapshots
    WHERE datetime(captured_at) <= datetime('now', '+15 minutes')
    GROUP BY match_id
  )
  SELECT
    m.*,
    ht.name_zh AS home_team_name,
    at.name_zh AS away_team_name,
    ht.elo AS home_elo,
    ht.glicko_mu AS home_glicko_mu,
    ht.glicko_phi AS home_glicko_phi,
    ht.attack AS home_attack,
    ht.defense AS home_defense,
    ht.form AS home_form,
    at.elo AS away_elo,
    at.glicko_mu AS away_glicko_mu,
    at.glicko_phi AS away_glicko_phi,
    at.attack AS away_attack,
    at.defense AS away_defense,
    at.form AS away_form,
    p.home_win_prob,
    p.id AS prediction_id,
    p.draw_prob,
    p.away_win_prob,
    p.calibrated_home_prob,
    p.calibrated_draw_prob,
    p.calibrated_away_prob,
    p.expected_home_goals,
    p.expected_away_goals,
    p.confidence,
    p.upset_risk,
    p.value_score,
    p.recommended_pick,
    p.risk_level,
    p.explanation,
    p.generated_at AS prediction_generated_at,
    (
      SELECT sp.home_goals
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1
    ) AS top_score_home_goals,
    (
      SELECT sp.away_goals
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1
    ) AS top_score_away_goals,
    (
      SELECT sp.probability
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1
    ) AS top_score_probability,
    (
      SELECT sp.home_goals
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1 OFFSET 1
    ) AS second_score_home_goals,
    (
      SELECT sp.away_goals
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1 OFFSET 1
    ) AS second_score_away_goals,
    (
      SELECT sp.probability
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1 OFFSET 1
    ) AS second_score_probability,
    (
      SELECT sp.home_goals
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1 OFFSET 2
    ) AS third_score_home_goals,
    (
      SELECT sp.away_goals
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1 OFFSET 2
    ) AS third_score_away_goals,
    (
      SELECT sp.probability
      FROM score_probabilities sp
      WHERE sp.prediction_id = p.id
      ORDER BY sp.probability DESC, sp.home_goals, sp.away_goals
      LIMIT 1 OFFSET 2
    ) AS third_score_probability,
    (
      SELECT SUM(CASE WHEN gp.total_goals > os.total_line THEN gp.probability ELSE 0 END)
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
    ) AS total_over_probability,
    (
      SELECT SUM(CASE WHEN gp.total_goals < os.total_line THEN gp.probability ELSE 0 END)
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
    ) AS total_under_probability,
    (
      SELECT SUM(CASE WHEN gp.total_goals = os.total_line THEN gp.probability ELSE 0 END)
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
    ) AS total_push_probability,
    (
      SELECT gp.total_goals
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
      ORDER BY gp.probability DESC, gp.total_goals
      LIMIT 1
    ) AS top_goal_total_goals,
    (
      SELECT gp.probability
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
      ORDER BY gp.probability DESC, gp.total_goals
      LIMIT 1
    ) AS top_goal_probability,
    (
      SELECT gp.total_goals
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
      ORDER BY gp.probability DESC, gp.total_goals
      LIMIT 1 OFFSET 1
    ) AS second_goal_total_goals,
    (
      SELECT gp.probability
      FROM goal_probabilities gp
      WHERE gp.prediction_id = p.id
      ORDER BY gp.probability DESC, gp.total_goals
      LIMIT 1 OFFSET 1
    ) AS second_goal_probability,
    os.home_odds,
    os.draw_odds,
    os.away_odds,
    os.asian_line,
    os.asian_home_water,
    os.asian_away_water,
    os.total_line,
    os.over_water,
    os.under_water,
    os.provider AS odds_provider,
    os.captured_at AS odds_captured_at,
    os.source_type AS odds_source_type,
    os.snapshot_hash AS odds_snapshot_hash,
    mc.provider_count AS consensus_provider_count,
    sc.snapshot_count AS consensus_snapshot_count,
    mc.home_prob AS consensus_home_prob,
    mc.draw_prob AS consensus_draw_prob,
    mc.away_prob AS consensus_away_prob,
    CASE
      WHEN mc.home_range >= mc.draw_range AND mc.home_range >= mc.away_range THEN mc.home_range
      WHEN mc.away_range >= mc.draw_range THEN mc.away_range
      ELSE mc.draw_range
    END AS consensus_max_probability_range,
    ((mc.home_range + mc.draw_range + mc.away_range) / 3.0) AS consensus_avg_probability_range,
    mc.oldest_provider_captured_at AS consensus_oldest_provider_captured_at,
    mc.latest_captured_at AS consensus_latest_captured_at,
    mc.home_odds_min AS consensus_home_odds_min,
    mc.home_odds_max AS consensus_home_odds_max,
    mc.draw_odds_min AS consensus_draw_odds_min,
    mc.draw_odds_max AS consensus_draw_odds_max,
    mc.away_odds_min AS consensus_away_odds_min,
    mc.away_odds_max AS consensus_away_odds_max,
    r.home_score,
    r.away_score,
    r.result_1x2,
    r.handicap_result,
    r.total_result,
    r.upset_type,
    r.note AS result_note,
    GROUP_CONCAT(tr.name, '|') AS tags
  FROM matches m
  LEFT JOIN teams ht ON ht.id = m.home_team_id
  LEFT JOIN teams at ON at.id = m.away_team_id
  LEFT JOIN predictions p ON p.match_id = m.id
  LEFT JOIN odds_snapshots os ON os.id = p.odds_snapshot_id
  LEFT JOIN market_consensus mc ON mc.match_id = m.id
  LEFT JOIN snapshot_counts sc ON sc.match_id = m.id
  LEFT JOIN results r ON r.match_id = m.id
  LEFT JOIN match_tags mt ON mt.match_id = m.id
  LEFT JOIN tag_rules tr ON tr.id = mt.tag_rule_id
  GROUP BY m.id
  ORDER BY m.match_no
`;

export class Repository {
  constructor(db = openDatabase()) {
    this.db = db;
  }

  getModelVersions() {
    return this.db
      .prepare('SELECT * FROM model_versions ORDER BY created_at DESC')
      .all()
      .map((row) => ({
        ...row,
        weights: parseJson(row.weights_json, {}),
        calibration: parseJson(row.calibration_json, {}),
        accuracy: parseJson(row.accuracy_json, {})
      }));
  }

  getOddsSnapshotsByMatch(matchId = null) {
    const rows =
      matchId == null
        ? this.db
            .prepare(
              `SELECT *
               FROM odds_snapshots
               WHERE datetime(captured_at) <= datetime('now', '+15 minutes')
               ORDER BY match_id, captured_at, id`
            )
            .all()
        : this.db
            .prepare(
              `SELECT *
               FROM odds_snapshots
               WHERE match_id = ?
                 AND datetime(captured_at) <= datetime('now', '+15 minutes')
               ORDER BY captured_at, id`
            )
            .all(matchId);
    const snapshotsByMatch = new Map();
    for (const row of rows) {
      if (!snapshotsByMatch.has(row.match_id)) snapshotsByMatch.set(row.match_id, []);
      snapshotsByMatch.get(row.match_id).push(row);
    }
    return snapshotsByMatch;
  }

  getPredictionDistributions() {
    const scoreRows = this.db
      .prepare('SELECT prediction_id, home_goals, away_goals, probability FROM score_probabilities ORDER BY prediction_id, probability DESC, home_goals, away_goals')
      .all();
    const goalRows = this.db
      .prepare('SELECT prediction_id, total_goals, probability FROM goal_probabilities ORDER BY prediction_id, probability DESC, total_goals')
      .all();
    const scoresByPrediction = new Map();
    const goalsByPrediction = new Map();
    for (const row of scoreRows) {
      if (!scoresByPrediction.has(row.prediction_id)) scoresByPrediction.set(row.prediction_id, []);
      scoresByPrediction.get(row.prediction_id).push(row);
    }
    for (const row of goalRows) {
      if (!goalsByPrediction.has(row.prediction_id)) goalsByPrediction.set(row.prediction_id, []);
      goalsByPrediction.get(row.prediction_id).push(row);
    }
    return { scoresByPrediction, goalsByPrediction };
  }

  getMatches() {
    const snapshotsByMatch = this.getOddsSnapshotsByMatch();
    const { scoresByPrediction, goalsByPrediction } = this.getPredictionDistributions();
    return this.db
      .prepare(matchListSql)
      .all()
      .map((row) =>
        mapMatchRow(
          row,
          snapshotsByMatch.get(row.id),
          scoresByPrediction.get(row.prediction_id),
          goalsByPrediction.get(row.prediction_id)
        )
      );
  }

  getMatchDetail(id) {
    const row = this.db.prepare(`${matchListSql.replace('ORDER BY m.match_no', '')} HAVING m.id = ?`).get(id);
    if (!row) return null;
    const oddsSnapshotRows = this.getOddsSnapshotsByMatch(id).get(id) ?? [];
    const match = mapMatchRow(row, oddsSnapshotRows);
    const prediction = this.db.prepare('SELECT id FROM predictions WHERE match_id = ? ORDER BY generated_at DESC LIMIT 1').get(id);
    const scores = prediction
      ? this.db.prepare('SELECT home_goals, away_goals, probability FROM score_probabilities WHERE prediction_id = ? ORDER BY probability DESC LIMIT 10').all(prediction.id)
      : [];
    const goals = prediction
      ? this.db.prepare('SELECT total_goals, probability FROM goal_probabilities WHERE prediction_id = ? ORDER BY total_goals').all(prediction.id)
      : [];
    const oddsHistory = oddsSnapshotRows.map((snapshot) => ({
        capturedAt: snapshot.captured_at,
        provider: snapshot.provider,
        sourceType: snapshot.source_type,
        snapshotHash: snapshot.snapshot_hash,
        homeOdds: snapshot.home_odds,
        drawOdds: snapshot.draw_odds,
        awayOdds: snapshot.away_odds,
        asianLine: snapshot.asian_line,
        asianHomeWater: snapshot.asian_home_water,
        asianAwayWater: snapshot.asian_away_water,
        totalLine: snapshot.total_line,
        overWater: snapshot.over_water,
        underWater: snapshot.under_water
      }));
    const tags = this.db
      .prepare(
        `SELECT tr.*, mt.confidence, mt.note, mt.review_result
         FROM match_tags mt
         JOIN tag_rules tr ON tr.id = mt.tag_rule_id
         WHERE mt.match_id = ?
         ORDER BY mt.confidence DESC`
      )
      .all(id)
      .map((tag) => ({
        code: tag.code,
        name: tag.name,
        category: tag.category,
        triggerCondition: tag.trigger_condition,
        impactDirection: tag.impact_direction,
        impactStrength: tag.impact_strength,
        historicalHitRate: tag.historical_hit_rate,
        reviewSummary: tag.review_summary,
        confidence: tag.confidence,
        note: tag.note,
        reviewResult: tag.review_result
      }));
    const reviews = this.db.prepare('SELECT * FROM reviews WHERE match_id = ? ORDER BY created_at DESC LIMIT 8').all(id);
    const result = mapResult(this.db.prepare('SELECT * FROM results WHERE match_id = ?').get(id));
    return { ...match, scores, goals, oddsHistory, tags, reviews, result };
  }

  getSummary() {
    const matches = this.getMatches();
    const modelVersions = this.getModelVersions();
    const groups = this.buildGroupTables(matches);
    const champions = this.buildChampionProbabilities();
    const knockoutPaths = this.buildKnockoutPaths(matches);
    const calibration = this.buildCalibrationSummary();
    const latestRun = this.db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 1').get();
    const oddsSources = this.db
      .prepare(
        `SELECT provider, source_type, COUNT(*) AS count, MIN(captured_at) AS first_captured_at, MAX(captured_at) AS last_captured_at
         FROM odds_snapshots
         GROUP BY provider, source_type
         ORDER BY count DESC`
      )
      .all();
    const tagRules = this.db.prepare('SELECT * FROM tag_rules ORDER BY id').all().map((rule) => ({
      code: rule.code,
      name: rule.name,
      category: rule.category,
      triggerCondition: rule.trigger_condition,
      impactDirection: rule.impact_direction,
      impactStrength: rule.impact_strength,
      historicalHitRate: rule.historical_hit_rate,
      reviewSummary: rule.review_summary
    }));
    const sampleSandbox = isSampleSandboxMatches(matches);
    const officialSchedule = readOfficialScheduleAudit();
    const rawMarketAudit = readOddsSourceAudit();
    const previewAudit = readPreviewDecisionAudit();
    const friendlyLedger = readFriendlyPredictionLedger();
	    const modelChangeImpact = readModelChangeImpactAudit();
	    const promotionGate = readPromotionGateAudit();
	    const evidenceManifest = readJsonReport('evidence-manifest.json');
	    const dbSnapshotsAvailable = this.db.prepare('SELECT COUNT(*) AS count FROM odds_snapshots').get().count;
	    const dbVerifiedSnapshotsAvailable = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM odds_snapshots os
         JOIN matches m ON m.id = os.match_id
         WHERE os.source_type IN (${predictionUsableSourceSqlList()})
           AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
           AND datetime(os.captured_at) < datetime(m.kickoff_utc)`
      )
      .get().count;
    const dbSampleSnapshotsAvailable = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM odds_snapshots
         WHERE source_type = 'sample_sandbox_snapshot'`
      )
      .get().count;
    const predictionUsableSnapshotsAvailable = sampleSandbox
      ? dbSampleSnapshotsAvailable
      : dbVerifiedSnapshotsAvailable;
    const auditVerifiedSnapshotsAvailable = Number(rawMarketAudit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
    const marketAudit = sampleSandbox
      ? {
          status: 'sample_sandbox_market_ready',
          generatedAt: latestRun?.finished_at ?? latestRun?.started_at,
          sourcePolicy: '样例沙盒使用本地可复现盘口快照，不代表真实博彩公司盘口。',
          recommendationPolicy: '样例模式允许演示串关、风险输入和复盘校准；任何输出都只用于产品闭环验证。',
          sources: oddsSources,
          importSummary: {
            rowsImported: dbSampleSnapshotsAvailable,
            completeCandidates: dbSampleSnapshotsAvailable,
            verifiedSnapshotsAvailable: dbSampleSnapshotsAvailable,
            databaseSnapshotsAvailable: dbSampleSnapshotsAvailable,
            auditVerifiedSnapshotsAvailable: dbSampleSnapshotsAvailable,
            staleDatabaseMismatch: false,
            sourceCount: oddsSources.length
          }
        }
      : rawMarketAudit
      ? {
          ...rawMarketAudit,
	          importSummary: {
	            ...rawMarketAudit.importSummary,
	            verifiedSnapshotsAvailable: predictionUsableSnapshotsAvailable,
	            databaseSnapshotsAvailable: dbSnapshotsAvailable,
	            auditVerifiedSnapshotsAvailable,
	            staleDatabaseMismatch:
	              auditVerifiedSnapshotsAvailable !== predictionUsableSnapshotsAvailable ||
	              Number(rawMarketAudit.importSummary?.databaseSnapshotsAvailable ?? dbSnapshotsAvailable) !== dbSnapshotsAvailable
	          }
        }
      : null;
    const marketRowsImported = Number(marketAudit?.importSummary?.rowsImported ?? 0);
    const verifiedSnapshotsAvailable = predictionUsableSnapshotsAvailable;
    const marketSourceCount = marketAudit?.sources?.length ?? 0;
    const marketAvailable = verifiedSnapshotsAvailable > 0;
    const parlays = this.buildParlays(matches, marketAudit);
    const marketConfidence =
      verifiedSnapshotsAvailable > 0
        ? `盘口可用 ${verifiedSnapshotsAvailable} 条完整快照，本轮新增 ${marketRowsImported} 条`
        : marketRowsImported > 0
        ? `盘口已入库 ${marketRowsImported} 条完整快照`
        : marketAudit
          ? `盘口源已审计 ${marketSourceCount} 个，未达完整入库条件`
          : '盘口源待审计';

    return {
      counts: {
        matches: matches.length,
        groupMatches: matches.filter((match) => match.stage === 'group').length,
        knockoutMatches: matches.filter((match) => match.stage !== 'group').length,
        predictedMatches: matches.filter((match) => match.hasPrediction).length,
        highRisk: matches.filter((match) => match.riskLevel === '高').length,
        positiveValue: matches.filter((match) => match.previewDecision?.tier === 'candidate').length,
        results: matches.filter((match) => match.resultSummary).length
      },
      latestRun,
      dataQuality: {
        mode: sampleSandbox
          ? 'sample_sandbox_loop'
          : officialSchedule
          ? marketAvailable
            ? 'official_schedule_market_prediction'
            : 'official_schedule_prediction_blocked'
          : 'schedule_guardrails',
        label: sampleSandbox
          ? '样例闭环沙盒'
          : officialSchedule
          ? marketAvailable
            ? '官方赛程审计 + 盘口预判'
            : '官方赛程审计 + 盘口待接入'
          : '赛程源审计',
        confidence: sampleSandbox
          ? `第一阶段样例库已跑通 ${matches.length} 场：${verifiedSnapshotsAvailable} 条样例盘口快照、${matches.filter((match) => match.hasPrediction).length} 条预测、${matches.filter((match) => match.resultSummary).length} 条合成赛果。`
          : officialSchedule
          ? `FIFA 官方赛程已结构化 ${officialSchedule.matchCount} 场；${marketConfidence}；阵容和新闻输入未齐前只作为预判，不作为投注建议`
          : '模型闭环可用；2026 真实赛程预测已阻断未核实来源',
        warning: sampleSandbox
          ? '当前为样例闭环演示模式：用于验证产品、数据库、模型接口、串关和复盘流程，不代表真实 2026 世界杯赛程或投注建议。'
          : officialSchedule
          ? marketAvailable
            ? '网页比赛列表来自 FIFA 官方赛程；概率来自已入库盘口快照和本地模型，仍需阵容、伤停、天气和新闻复核。'
            : '网页比赛列表来自 FIFA 官方赛程；但概率、盘口、串关、冠军概率仍未作为 2026 真实预测输出。'
          : '本地种子库仍是演示用占位槽位；第三方缓存里的 2026 未来赛程已不进入预测或网页。官方 FIFA 赛程结构化接入前，不要把列表中的占位比赛当作真实赛程。',
        sources: {
          teams: sampleSandbox
            ? 'server/data/sampleData.mjs 样例 48 队 + seeded Elo/Glicko/攻防状态'
            : officialSchedule
            ? 'FIFA 官方赛程球队代码 + 中立强度占位，仅用于列表和分组展示'
            : 'server/data/sampleData.mjs fixed fallback teams + seeded random Elo/Glicko',
          schedule: sampleSandbox
            ? '样例 2026 赛制结构：12 组、72 场小组赛、32 场淘汰赛槽位，共 104 场'
            : officialSchedule
            ? `${officialSchedule.file} 已解析 FIFA 官方 ${officialSchedule.matchCount} 场并写入本地 matches`
            : '2026 预测只接受官方 FIFA 赛程源；未核实缓存已停用，本地 matches 为非官方结构占位',
          odds: oddsSources.length > 0
            ? oddsSources
            : marketAudit?.sources?.length
              ? marketAudit.sources.map((source) => ({
                  provider: source.provider,
                  source_type: source.sourceType,
                  count: source.importedRows ?? 0,
                  status: source.status,
                  complete_candidates: source.completeCandidates ?? 0
                }))
              : '未接入官方赔率，2026 比赛不生成盘口快照',
          results: sampleSandbox
            ? 'server/db/seed.mjs 合成样例赛果，用于区分胜平负、赢盘/输盘、大小球、冷门类型和校准闭环'
            : officialSchedule
            ? '未接入真实赛果；2026 官方赛程不生成合成赛果'
            : 'server/db/seed.mjs 合成赛果，仅用于校准与复盘演示'
        },
        officialSchedule,
        marketAudit,
        friendlyLedger,
        previewAudit,
        modelChangeImpact,
        promotionGate,
        evidenceManifest
      },
      modelVersions,
      validationReports: {
        international: readJsonReport('international-model-evaluation.json'),
        historical: readJsonReport('historical-model-evaluation.json'),
        majorTournament: readJsonReport('major-tournament-audit.json'),
        modelIteration: readJsonReport('model-iteration-audit.json'),
        evidenceManifest
      },
      groups,
      champions,
      knockoutPaths,
      parlays,
      calibration,
      tagRules
    };
  }

  buildCalibrationSummary() {
    const rows = this.db
      .prepare(
        `SELECT
          m.match_no,
          ht.name_zh AS home_team_name,
          at.name_zh AS away_team_name,
          m.home_placeholder,
          m.away_placeholder,
          p.recommended_pick,
          p.confidence,
          p.value_score,
          p.expected_home_goals,
          p.expected_away_goals,
          (
            SELECT sp.home_goals
            FROM score_probabilities sp
            WHERE sp.prediction_id = p.id
            ORDER BY sp.probability DESC, sp.id ASC
            LIMIT 1
          ) AS top_score_home_goals,
          (
            SELECT sp.away_goals
            FROM score_probabilities sp
            WHERE sp.prediction_id = p.id
            ORDER BY sp.probability DESC, sp.id ASC
            LIMIT 1
          ) AS top_score_away_goals,
          o.asian_line,
          r.home_score,
          r.away_score,
          r.result_1x2,
          r.handicap_result,
          r.total_result,
          r.upset_type
         FROM results r
         JOIN matches m ON m.id = r.match_id
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         LEFT JOIN predictions p ON p.match_id = m.id
         LEFT JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
         ORDER BY m.match_no`
      )
      .all();

    if (rows.length === 0) {
      return {
        sampleSize: 0,
        resultAccuracy: 0,
        handicapAccuracy: 0,
        upsetBreakdown: [],
        recent: []
      };
    }

    const evaluatedRows = rows.filter((row) => row.recommended_pick != null && row.result_1x2 != null);
    const handicapEvaluatedRows = evaluatedRows.filter((row) => asianPickIsCorrect(row) != null);
    const resultHits = evaluatedRows.filter((row) => row.recommended_pick === row.result_1x2).length;
    const handicapHits = handicapEvaluatedRows.filter((row) => asianPickIsCorrect(row)).length;
    const upsetCounts = new Map();
    for (const row of rows) {
      upsetCounts.set(row.upset_type, (upsetCounts.get(row.upset_type) ?? 0) + 1);
    }

    return {
      sampleSize: rows.length,
      evaluatedSampleSize: evaluatedRows.length,
      resultAccuracy: evaluatedRows.length ? percent(resultHits / evaluatedRows.length) : null,
      handicapAccuracy: handicapEvaluatedRows.length ? percent(handicapHits / handicapEvaluatedRows.length) : null,
      upsetBreakdown: Array.from(upsetCounts, ([name, count]) => ({
        name,
        count,
        share: percent(count / rows.length)
      })),
      recent: rows.slice(0, 10).map((row) => ({
        matchNo: row.match_no,
        fixture: `${row.home_team_name ?? row.home_placeholder} vs ${row.away_team_name ?? row.away_placeholder}`,
        score: `${row.home_score}-${row.away_score}`,
        pick: row.recommended_pick,
        result1x2: row.result_1x2,
        handicapResult: row.handicap_result,
        upsetType: row.upset_type,
        confidence: percent(row.confidence),
        valueScore: row.value_score
      }))
    };
  }

  buildGroupTables(matches) {
    const teamRows = this.db.prepare('SELECT * FROM teams ORDER BY group_name, seed_rank').all();
    const groupMap = new Map();
    for (const team of teamRows) {
      if (!groupMap.has(team.group_name)) groupMap.set(team.group_name, []);
      groupMap.get(team.group_name).push({
        code: team.code,
        team: team.name_zh,
        seedRank: team.seed_rank,
        elo: Math.round(team.elo),
        glicko_phi: team.glicko_phi,
        attack: team.attack,
        defense: team.defense,
        form: team.form,
        strengthScore: teamStrengthScore(team),
        pts: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        advanceProbability: 0
      });
    }

    const groupMatchModels = [];
    const groupMatches = matches.filter((item) => item.stage === 'group');
    for (const match of groupMatches) {
      const rows = groupMap.get(match.groupName);
      if (!rows) continue;
      const home = rows.find((row) => row.team === match.homeTeam);
      const away = rows.find((row) => row.team === match.awayTeam);
      if (!home || !away) continue;

      const hasPrediction =
        match.hasPrediction &&
        isFiniteNumber(match.probabilities?.home) &&
        isFiniteNumber(match.probabilities?.draw) &&
        isFiniteNumber(match.probabilities?.away);
      const settled =
        match.status === 'finished' &&
        match.resultSummary &&
        match.resultSummary.homeScore != null &&
        match.resultSummary.awayScore != null &&
        Number.isInteger(Number(match.resultSummary.homeScore)) &&
        Number.isInteger(Number(match.resultSummary.awayScore));
      const strength = hasPrediction ? null : estimateStrength(home, away, { stage: 'group', match_no: match.matchNo });
      const probabilities = settled
        ? normalizeProbabilities([
            match.resultSummary.homeScore > match.resultSummary.awayScore ? 1 : 0,
            match.resultSummary.homeScore === match.resultSummary.awayScore ? 1 : 0,
            match.resultSummary.homeScore < match.resultSummary.awayScore ? 1 : 0
          ])
        : hasPrediction
        ? normalizeProbabilities([match.probabilities.home, match.probabilities.draw, match.probabilities.away])
        : normalizeProbabilities([strength.homeWin, strength.draw, strength.awayWin]);
      const model = {
        groupName: match.groupName,
        home,
        away,
        probabilities,
        homeScore: settled ? Number(match.resultSummary.homeScore) : null,
        awayScore: settled ? Number(match.resultSummary.awayScore) : null,
        homeExpectedGoals: settled
          ? Number(match.resultSummary.homeScore)
          : hasPrediction && isFiniteNumber(match.expectedGoals?.home)
            ? match.expectedGoals.home
            : strength.homeExpectedGoals,
        awayExpectedGoals: settled
          ? Number(match.resultSummary.awayScore)
          : hasPrediction && isFiniteNumber(match.expectedGoals?.away)
            ? match.expectedGoals.away
            : strength.awayExpectedGoals,
        settled,
        source: settled ? 'official_result' : hasPrediction ? 'market_prediction' : 'team_strength_prior'
      };
      groupMatchModels.push(model);
      if (settled) applySettledMatchStats(model);
      else applyExpectedMatchStats(model);
    }

    const simulationCount = groupMatchModels.length ? 16000 : 0;
    const random = seededUnit(20260609);
    for (let trial = 0; trial < simulationCount; trial += 1) {
      const standingsByGroup = new Map(
        [...groupMap.entries()].map(([groupName, rows]) => [
          groupName,
          new Map(rows.map((row) => [row.team, emptyStanding(row)]))
        ])
      );

      for (const model of groupMatchModels) {
        const standings = standingsByGroup.get(model.groupName);
        if (!standings) continue;
        if (model.settled) applySettledSimulatedMatch(model, standings);
        else applySimulatedMatch(model, standings, random);
      }

      const thirdPlaced = [];
      for (const [groupName, standings] of standingsByGroup.entries()) {
        const sorted = [...standings.values()].sort(compareStanding);
        for (const row of sorted.slice(0, 2)) {
          const sourceRow = groupMap.get(groupName)?.find((item) => item.team === row.team);
          if (sourceRow) sourceRow.advanceProbability += 1;
        }
        if (sorted[2]) thirdPlaced.push({ ...sorted[2], groupName });
      }

      thirdPlaced.sort(compareStanding);
      for (const row of thirdPlaced.slice(0, 8)) {
        const sourceRow = groupMap.get(row.groupName)?.find((item) => item.team === row.team);
        if (sourceRow) sourceRow.advanceProbability += 1;
      }
    }

    return Array.from(groupMap, ([groupName, rows]) => {
      const sorted = rows
        .map((row) => ({
          ...row,
          pts: roundOne(row.pts),
          gf: roundOne(row.gf),
          ga: roundOne(row.ga),
          gd: roundOne(row.gf - row.ga),
          advanceProbability: simulationCount ? percent(row.advanceProbability / simulationCount) : 0
        }))
        .sort(
          (a, b) =>
            b.pts - a.pts ||
            b.gd - a.gd ||
            b.gf - a.gf ||
            b.advanceProbability - a.advanceProbability ||
            b.strengthScore - a.strengthScore ||
            a.seedRank - b.seedRank
        );
      return {
        groupName,
        method:
          'group_stage_simulation_top2_plus_best8_thirds',
        simulationCount,
        rows: sorted.map((row, index) => ({
          ...row,
          rank: index + 1
        }))
      };
    });
  }

  buildChampionProbabilities() {
    const predictionCount = this.db.prepare('SELECT COUNT(*) AS count FROM predictions').get().count;
    if (predictionCount === 0) return [];

    const teams = this.db.prepare('SELECT * FROM teams ORDER BY elo DESC').all();
    const scores = teams.map((team) => ({
      team: team.name_zh,
      groupName: team.group_name,
      score: Math.exp((team.elo - 1600) / 245) * (0.82 + team.form * 0.35),
      elo: team.elo
    }));
    const total = scores.reduce((sum, item) => sum + item.score, 0);
    return scores
      .map((item, index) => ({
        rank: index + 1,
        team: item.team,
        groupName: item.groupName,
        championProbability: percent(item.score / total),
        finalProbability: percent(Math.min(0.42, (item.score / total) * 3.4)),
        semifinalProbability: percent(Math.min(0.68, (item.score / total) * 6.3)),
        elo: Math.round(item.elo)
      }))
      .slice(0, 16);
  }

  buildKnockoutPaths(matches) {
    return matches
      .filter((match) => match.stage !== 'group')
      .map((match) => ({
        matchNo: match.matchNo,
        stage: match.stage,
        roundLabel: match.roundLabel,
        fixture: `${match.homeTeam} vs ${match.awayTeam}`,
        hasPrediction: match.hasPrediction,
        pick: match.recommendedPick ?? '待接入',
        confidence: percent(match.confidence),
        upsetRisk: percent(match.upsetRisk),
        valueScore: match.valueScore
      }));
  }

  buildParlays(matches, marketAudit = null) {
    if (matches.some((match) => match.status === 'official_schedule_prediction_blocked' || !match.hasPrediction)) {
      return [];
    }
    const sampleSandbox = isSampleSandboxMatches(matches);

    const sporttery = marketAudit?.sources?.find((source) => String(source.provider ?? '').includes('Sporttery'));
    const sportteryByMatchNo = new Map(
      (sporttery?.sample ?? [])
        .filter((entry) => entry.officialMatchNo != null)
        .map((entry) => [Number(entry.officialMatchNo), entry])
    );
    if (!sampleSandbox && sportteryByMatchNo.size === 0) return [];

    const legCandidates = matches
      .filter((match) => match.hasPrediction && (sampleSandbox || sportteryByMatchNo.has(Number(match.matchNo))))
      .flatMap((match) =>
        sampleSandbox
          ? this.buildSampleLegCandidates(match)
          : this.buildSportteryLegCandidates(match, sportteryByMatchNo.get(Number(match.matchNo)))
      )
      .filter((leg) => leg && this.parlayLegEligible(leg))
      .sort((a, b) => b.edge - a.edge || b.probability - a.probability || a.matchNo - b.matchNo);

    const bestByMatch = [];
    const seenMatches = new Set();
    for (const leg of legCandidates) {
      if (seenMatches.has(leg.matchNo)) continue;
      seenMatches.add(leg.matchNo);
      bestByMatch.push(leg);
    }

    const combos = [];
    const addCombo = (type, name, legs, mode, riskBudget) => {
      if (!legs.length) return;
      const pools = [...new Set(legs.map((leg) => leg.pool).filter(Boolean))];
      const probability = legs.reduce((product, leg) => product * leg.probability, 1);
      const impliedOdds = legs.reduce((product, leg) => product * leg.odds, 1);
      const valueScore = probability * impliedOdds - 1;
      const totalStake = 2;
      const estimatedReturn = impliedOdds * totalStake;
      combos.push({
        id: `${type}-${combos.length + 1}`,
        type,
        name,
        mode,
        riskBudget,
        probability: percent(probability),
        impliedOdds: Math.round(impliedOdds * 100) / 100,
        valueScore: Math.round(valueScore * 1000) / 1000,
        calculator: {
          source: sampleSandbox ? '样例串关计算器 HAD/HHAD/TTG/CRS' : 'Sporttery 体彩计算器 HAD/HHAD/TTG/CRS',
          passType: mode,
          ticketType: pools.length > 1 ? '混合过关' : (pools[0] ?? mode),
          legCount: legs.length,
          poolCount: pools.length,
          poolMix: pools.join(' + '),
          betCount: 1,
          multiple: 1,
          stakePerBet: totalStake,
          totalStake,
          estimatedReturn: Math.round(estimatedReturn * 100) / 100,
          netProfit: Math.round((estimatedReturn - totalStake) * 100) / 100,
          formula: `1注 × ${totalStake}元 × ${Math.round(impliedOdds * 100) / 100}`,
          allUpEligible: legs.every((leg) => leg.allUpEligible),
          singleEligible: legs.length === 1 && legs[0].singleEligible
        },
        legs: legs.map((leg) => ({
          matchNo: leg.matchNo,
          matchNum: leg.matchNum,
          fixture: leg.fixture,
          pool: leg.pool,
          pick: leg.pick,
          odds: leg.odds,
          probability: percent(leg.probability),
          edge: Math.round(leg.edge * 1000) / 1000,
          confidence: percent(leg.confidence),
          risk: leg.riskLevel,
          calculatorStatus: leg.calculatorStatus
        }))
      });
    };

    for (const leg of bestByMatch.filter((item) => item.singleEligible).slice(0, 4)) {
      addCombo('single', '单关观察', [leg], '单关', leg.edge >= 0.12 ? '低仓位' : '观察');
    }

    if (!combos.some((combo) => combo.type === 'single')) {
      for (const leg of bestByMatch.filter((item) => item.edge >= 0.08).slice(0, 2)) {
        addCombo('anchor', '稳胆单场参考', [leg], '单场参考', '过关胆');
      }
    }

    const twoLegs = bestByMatch
      .filter((leg) => leg.allUpEligible && leg.confidence >= 0.52)
      .slice(0, 6);
    for (let index = 0; index < twoLegs.length - 1; index += 2) {
      addCombo('all-up-2', '2串1 观察', twoLegs.slice(index, index + 2), '2串1', '低仓位');
    }

    const mixedPoolPairs = [
      ['胜平负', '总进球'],
      ['让球胜平负', '总进球'],
      ['胜平负', '让球胜平负'],
      ['胜平负', '比分'],
      ['总进球', '比分'],
      ['让球胜平负', '比分']
    ];
    for (const pools of mixedPoolPairs) {
      const mixedLegs = this.pickMixedPoolLegs(legCandidates, pools);
      if (mixedLegs.length === pools.length) {
        addCombo(
          'mixed',
          `${this.shortPoolMixLabel(pools)} 混合2串1`,
          mixedLegs,
          '混合过关 2串1',
          pools.includes('比分') ? '小额观察' : '低仓位'
        );
      }
    }

    const mixedPoolTriples = [
      ['胜平负', '让球胜平负', '总进球'],
      ['胜平负', '总进球', '比分'],
      ['让球胜平负', '总进球', '比分']
    ];
    for (const pools of mixedPoolTriples) {
      const mixedLegs = this.pickMixedPoolLegs(legCandidates, pools);
      if (mixedLegs.length === pools.length) {
        addCombo(
          'mixed',
          `${this.shortPoolMixLabel(pools)} 混合3串1`,
          mixedLegs,
          '混合过关 3串1',
          pools.includes('比分') ? '小额观察' : '小额观察'
        );
      }
    }

    for (const pool of ['胜平负', '让球胜平负', '总进球', '比分']) {
      const poolLegs = [];
      const seenPoolMatches = new Set();
      for (const leg of legCandidates.filter((item) => item.pool === pool)) {
        if (seenPoolMatches.has(leg.matchNo)) continue;
        seenPoolMatches.add(leg.matchNo);
        poolLegs.push(leg);
      }
      const topPoolLeg = poolLegs[0];
      if (topPoolLeg && topPoolLeg.edge >= 0.02) {
        addCombo(`pool-anchor-${pool}`, `${pool}单场参考`, [topPoolLeg], '单场参考', pool === '比分' ? '小额观察' : '过关胆');
      }
      if (poolLegs.length >= 2) {
        addCombo(`pool-2-${pool}`, `${pool} 2串1`, poolLegs.slice(0, 2), '2串1', pool === '比分' ? '小额观察' : '低仓位');
      }
    }

    return combos
      .sort((a, b) => b.valueScore - a.valueScore || b.probability - a.probability)
      .slice(0, 24);
  }

  pickMixedPoolLegs(legCandidates, pools) {
    const selected = [];
    const usedMatches = new Set();
    for (const pool of pools) {
      const leg = legCandidates
        .filter((item) => item.pool === pool && item.allUpEligible && !usedMatches.has(item.matchNo))
        .sort((a, b) => b.edge + b.confidence * 0.18 - (a.edge + a.confidence * 0.18))[0];
      if (!leg) return [];
      selected.push(leg);
      usedMatches.add(leg.matchNo);
    }
    return selected;
  }

  shortPoolMixLabel(pools) {
    const labels = {
      胜平负: '胜平负',
      让球胜平负: '让球',
      总进球: '进球数',
      比分: '比分'
    };
    return pools.map((pool) => labels[pool] ?? pool).join(' + ');
  }

  parlayLegEligible(leg) {
    if (!leg || !Number.isFinite(leg.probability) || !Number.isFinite(leg.odds)) return false;
    if (leg.odds < 1.25 || leg.riskScore > 0.66) return false;
    const minProbability = {
      胜平负: 0.28,
      让球胜平负: 0.30,
      总进球: 0.11,
      比分: 0.045
    }[leg.pool] ?? 0.3;
    const minEdge = leg.pool === '比分' ? -0.02 : -0.08;
    return leg.probability >= minProbability && leg.edge >= minEdge;
  }

  sampleDecimalOdds(probability, margin = 0.92, min = 1.25, max = 18) {
    const number = Number(probability);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.round(Math.min(max, Math.max(min, 1 / Math.max(0.01, number * margin))) * 100) / 100;
  }

  buildSampleLegCandidates(match) {
    const common = {
      matchNo: match.matchNo,
      matchNum: `S${String(match.matchNo).padStart(3, '0')}`,
      fixture: `${match.homeTeam} vs ${match.awayTeam}`,
      confidence: Number(match.confidence ?? 0),
      riskScore: Number(match.upsetRisk ?? 0),
      riskLevel: match.riskLevel,
      singleEligible: true,
      allUpEligible: true,
      calculatorStatus: '样例单关/过关'
    };
    const candidates = [];
    const add = (pool, key, pick, probability, odds) => {
      if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) return;
      candidates.push({
        ...common,
        pool,
        key,
        pick,
        probability,
        odds,
        edge: probability * odds - 1
      });
    };

    add('胜平负', 'h', '主胜', Number(match.probabilities?.home), Number(match.odds?.home));
    add('胜平负', 'd', '平局', Number(match.probabilities?.draw), Number(match.odds?.draw));
    add('胜平负', 'a', '客胜', Number(match.probabilities?.away), Number(match.odds?.away));

    const hhadLine = Number(match.odds?.asianLine ?? 0);
    const hhad = this.hhadDistributionFromScores(match.scoreCandidates, hhadLine);
    add('让球胜平负', 'h', `让胜 ${this.signedLine(hhadLine)}`, hhad?.home, this.sampleDecimalOdds(hhad?.home, 0.9, 1.28, 8));
    add('让球胜平负', 'd', `让平 ${this.signedLine(hhadLine)}`, hhad?.draw, this.sampleDecimalOdds(hhad?.draw, 0.86, 2.2, 12));
    add('让球胜平负', 'a', `让负 ${this.signedLine(hhadLine)}`, hhad?.away, this.sampleDecimalOdds(hhad?.away, 0.9, 1.28, 8));

    for (const goal of match.goalCandidates ?? []) {
      const totalGoals = Number(goal.totalGoals);
      const probability = Number(goal.probability);
      if (!Number.isFinite(totalGoals) || !Number.isFinite(probability)) continue;
      const key = totalGoals >= 7 ? 's7' : `s${totalGoals}`;
      const label = totalGoals >= 7 ? '7+球' : `${totalGoals}球`;
      add('总进球', key, label, probability, this.sampleDecimalOdds(probability, 0.82, 1.6, 18));
    }

    for (const score of (match.scoreCandidates ?? []).slice(0, 8)) {
      const homeGoals = Number(score.homeGoals);
      const awayGoals = Number(score.awayGoals);
      const probability = Number(score.probability);
      if (![homeGoals, awayGoals, probability].every(Number.isFinite)) continue;
      const key = this.correctScoreKey(homeGoals, awayGoals);
      if (!key) continue;
      add('比分', key, `${homeGoals}-${awayGoals}`, probability, this.sampleDecimalOdds(probability, 0.76, 4.5, 36));
    }

    return candidates.filter((candidate) => candidate.edge > -0.08);
  }

  buildSportteryLegCandidates(match, entry) {
    if (!entry || entry.status !== 'Selling') return [];
    const singleEligible = Number(entry.bettingSingle ?? 0) === 1;
    const allUpEligible = entry.bettingAllUp == null ? true : Number(entry.bettingAllUp) !== -1;
    const common = {
      matchNo: match.matchNo,
      matchNum: entry.matchNum,
      fixture: `${match.homeTeam} vs ${match.awayTeam}`,
      confidence: Number(match.confidence ?? 0),
      riskScore: Number(match.upsetRisk ?? 0),
      riskLevel: match.riskLevel,
      singleEligible,
      allUpEligible,
      calculatorStatus: singleEligible ? '支持单关' : '过关/混合'
    };
    const candidates = [];
    const add = (pool, key, pick, probability, odds) => {
      if (!Number.isFinite(probability) || !Number.isFinite(odds) || odds <= 1) return;
      candidates.push({
        ...common,
        pool,
        key,
        pick,
        probability,
        odds,
        edge: probability * odds - 1
      });
    };

    add('胜平负', 'h', '主胜', Number(match.probabilities?.home), Number(entry.had?.h));
    add('胜平负', 'd', '平局', Number(match.probabilities?.draw), Number(entry.had?.d));
    add('胜平负', 'a', '客胜', Number(match.probabilities?.away), Number(entry.had?.a));

    const hhadLine = Number(entry.hhad?.goalLine);
    const hhad = this.hhadDistributionFromScores(match.scoreCandidates, hhadLine);
    add('让球胜平负', 'h', `让胜 ${this.signedLine(hhadLine)}`, hhad?.home, Number(entry.hhad?.h));
    add('让球胜平负', 'd', `让平 ${this.signedLine(hhadLine)}`, hhad?.draw, Number(entry.hhad?.d));
    add('让球胜平负', 'a', `让负 ${this.signedLine(hhadLine)}`, hhad?.away, Number(entry.hhad?.a));

    for (const goal of match.goalCandidates ?? []) {
      const totalGoals = Number(goal.totalGoals);
      const probability = Number(goal.probability);
      if (!Number.isFinite(totalGoals) || !Number.isFinite(probability)) continue;
      const key = totalGoals >= 7 ? 's7' : `s${totalGoals}`;
      const label = totalGoals >= 7 ? '7+球' : `${totalGoals}球`;
      add('总进球', key, label, probability, Number(entry.ttg?.[key]));
    }

    for (const score of (match.scoreCandidates ?? []).slice(0, 8)) {
      const homeGoals = Number(score.homeGoals);
      const awayGoals = Number(score.awayGoals);
      const probability = Number(score.probability);
      if (![homeGoals, awayGoals, probability].every(Number.isFinite)) continue;
      const key = this.correctScoreKey(homeGoals, awayGoals);
      if (!key) continue;
      add('比分', key, `${homeGoals}-${awayGoals}`, probability, Number(entry.crs?.[key]));
    }

    return candidates.filter((candidate) => candidate.edge > -0.08);
  }

  correctScoreKey(homeGoals, awayGoals) {
    if (homeGoals >= 0 && homeGoals <= 5 && awayGoals >= 0 && awayGoals <= 5) {
      if (homeGoals <= 2 || awayGoals <= 2 || homeGoals === awayGoals) {
        return `s0${homeGoals}s0${awayGoals}`;
      }
    }
    if (homeGoals > awayGoals) return 's1sh';
    if (homeGoals === awayGoals) return 's1sd';
    return 's1sa';
  }

  hhadDistributionFromScores(scores = [], line) {
    if (!Number.isFinite(Number(line))) return null;
    const totals = { home: 0, draw: 0, away: 0 };
    for (const score of scores ?? []) {
      const margin = Number(score.homeGoals) - Number(score.awayGoals) + Number(line);
      const probability = Number(score.probability);
      if (!Number.isFinite(margin) || !Number.isFinite(probability)) continue;
      if (margin > 0) totals.home += probability;
      else if (margin < 0) totals.away += probability;
      else totals.draw += probability;
    }
    const total = totals.home + totals.draw + totals.away;
    if (total <= 0) return null;
    return {
      home: totals.home / total,
      draw: totals.draw / total,
      away: totals.away / total
    };
  }

  signedLine(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return number > 0 ? `+${number}` : String(number);
  }

  refresh() {
    return refreshPredictions(this.db);
  }

  refreshOdds() {
    return refreshMarketOdds({ db: this.db });
  }

  seed(input = {}) {
    return seedDatabase(this.db, { mode: input.mode });
  }

  addReview(input) {
    const now = new Date().toISOString();
    const latestModel = this.db.prepare('SELECT id FROM model_versions ORDER BY id DESC LIMIT 1').get();
    const statement = this.db.prepare(`
      INSERT INTO reviews (match_id, model_version_id, created_at, reviewer, actual_result, handicap_result, model_error, calibration_action, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = statement.run(
      input.matchId,
      latestModel?.id ?? null,
      now,
      input.reviewer || 'personal',
      input.actualResult || '',
      input.handicapResult || '',
      input.modelError || '',
      input.calibrationAction || '',
      input.note || ''
    );
    return { id: Number(result.lastInsertRowid), createdAt: now };
  }

  getPersonalGuesses() {
    const rows = this.db
      .prepare(
        `SELECT
          g.*,
          m.match_no,
          m.stage,
          m.group_name,
          m.round_label,
          m.kickoff_utc,
          m.venue,
          m.home_placeholder,
          m.away_placeholder,
          ht.name_zh AS home_team_name,
          at.name_zh AS away_team_name,
          r.home_score,
          r.away_score,
          r.result_1x2,
          r.handicap_result,
          r.settled_at
         FROM personal_guesses g
         JOIN matches m ON m.id = g.match_id
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         LEFT JOIN results r ON r.match_id = m.id
         ORDER BY datetime(g.created_at) DESC, g.id DESC`
      )
      .all()
      .map(mapPersonalGuess);
    return {
      guesses: rows,
      stats: buildGuessStats(rows)
    };
  }

  addPersonalGuess(input) {
    const matchId = Number(input.matchId);
    if (!Number.isInteger(matchId)) throw new Error('请选择一场世界杯比赛');
    const match = this.db.prepare('SELECT id FROM matches WHERE id = ?').get(matchId);
    if (!match) throw new Error('比赛不存在');

    const guessInputs = Array.isArray(input.guesses)
      ? input.guesses
      : [{ marketType: input.marketType ?? 'result', pickKey: input.pickKey }];
    const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5)));
    const now = new Date().toISOString();
    const rows = guessInputs
      .map((guess) => {
        const marketType = String(guess.marketType ?? '');
        const normalized = normalizeGuessPick(marketType, guess.pickKey);
        return normalized ? { marketType, ...normalized } : null;
      })
      .filter(Boolean);
    if (!rows.length) throw new Error('请至少填写一个有效猜测');

    const statement = this.db.prepare(
      `INSERT INTO personal_guesses
        (match_id, created_at, updated_at, market_type, pick_key, pick_label, confidence, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertedIds = [];
    this.db.exec('SAVEPOINT personal_guess_insert');
    try {
      for (const row of rows) {
        const result = statement.run(
          matchId,
          now,
          now,
          row.marketType,
          row.pickKey,
          row.pickLabel,
          confidence,
          String(input.note ?? '').slice(0, 500)
        );
        insertedIds.push(Number(result.lastInsertRowid));
      }
      this.db.exec('RELEASE personal_guess_insert');
    } catch (error) {
      this.db.exec('ROLLBACK TO personal_guess_insert');
      this.db.exec('RELEASE personal_guess_insert');
      throw error;
    }
    return {
      id: insertedIds[0],
      ids: insertedIds,
      createdAt: now,
      ledger: this.getPersonalGuesses()
    };
  }

  deletePersonalGuess(id) {
    const result = this.db.prepare('DELETE FROM personal_guesses WHERE id = ?').run(Number(id));
    return {
      deleted: result.changes > 0,
      ledger: this.getPersonalGuesses()
    };
  }

  recordImport(input) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT INTO import_runs (run_type, started_at, finished_at, source, status, rows_affected, snapshot_key, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runType || 'manual-import',
      now,
      now,
      input.source || 'manual-json',
      'accepted',
      Number(input.rowsAffected || 0),
      input.snapshotKey || `manual-${Date.now()}`,
      input.note || '第一阶段仅记录导入审计，真实解析器后续接入。'
    );
    return { id: Number(result.lastInsertRowid), createdAt: now };
  }
}
