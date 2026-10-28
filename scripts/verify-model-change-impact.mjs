#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../server/db/connection.mjs';
import { marketConsensusFromSnapshots } from '../server/model/market.mjs';
import { predictMatch } from '../server/model/index.mjs';
import { evaluateMarketQuality, previewDecision } from '../server/services/previewDecision.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports/model-change-impact-audit.json');
const PRIMARY_PROVIDER_ORDER = [
  'OddsLab/Pinnacle',
  'OddsLab/Betfair Exchange',
  'OddsLab/Bet365',
  'OddsLab/BetOnline.ag',
  'OddsLab/1xBet'
];
const MAX_CONFIDENCE_DELTA = 0.05;
const MAX_UPSET_RISK_DELTA = 0.06;

const VARIANTS = [
  {
    key: 'current',
    label: '历史权重 + 盘口移动',
    options: {}
  },
  {
    key: 'weighted_no_movement',
    label: '历史权重，关闭盘口移动修正',
    options: { includeMovement: false }
  },
  {
    key: 'equal_with_movement',
    label: '等权机构，保留盘口移动',
    options: { useProviderWeights: false }
  },
  {
    key: 'equal_no_movement',
    label: '等权机构，关闭盘口移动',
    options: { useProviderWeights: false, includeMovement: false }
  }
];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function round(value, precision = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function providerRank(provider) {
  const index = PRIMARY_PROVIDER_ORDER.indexOf(provider);
  return index >= 0 ? index : PRIMARY_PROVIDER_ORDER.length + 1;
}

function capturedTime(row) {
  const time = new Date(row.captured_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function predictionSnapshotOrder(snapshots) {
  return snapshots.toSorted(
    (left, right) =>
      capturedTime(left) - capturedTime(right) ||
      providerRank(right.provider) - providerRank(left.provider) ||
      String(left.provider).localeCompare(String(right.provider))
  );
}

function allByMatch(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.match_id)) map.set(row.match_id, []);
    map.get(row.match_id).push(row);
  }
  for (const [matchId, snapshots] of map.entries()) {
    map.set(matchId, predictionSnapshotOrder(snapshots));
  }
  return map;
}

function probabilitiesFromPrediction(prediction) {
  return {
    home: prediction.calibrated_home_prob,
    draw: prediction.calibrated_draw_prob,
    away: prediction.calibrated_away_prob
  };
}

function maxProbabilityDelta(left, right) {
  return Math.max(
    Math.abs(Number(left.home) - Number(right.home)),
    Math.abs(Number(left.draw) - Number(right.draw)),
    Math.abs(Number(left.away) - Number(right.away))
  );
}

function tierCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.decision.tier] = (counts[row.decision.tier] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizeVariant(rows) {
  const counts = tierCounts(rows);
  const movementRows = rows.filter((row) => row.marketConsensus?.movement?.providerCount >= 2);
  const matchedProviderRows = rows.filter((row) => row.marketConsensus?.matchedProviderCount > 0);
  return {
    predictionCount: rows.length,
    tierCounts: counts,
    candidateCount: counts.candidate ?? 0,
    watchCount: counts.watch ?? 0,
    negativeCount: counts.negative ?? 0,
    movementRows: movementRows.length,
    matchedProviderRows: matchedProviderRows.length,
    avgConfidence: round(rows.reduce((sum, row) => sum + row.confidence, 0) / Math.max(1, rows.length)),
    avgUpsetRisk: round(rows.reduce((sum, row) => sum + row.upsetRisk, 0) / Math.max(1, rows.length))
  };
}

function compareRows(currentRows, variantRows, variantKey) {
  const byMatch = new Map(variantRows.map((row) => [row.matchNo, row]));
  let pickChanges = 0;
  let tierChanges = 0;
  let maxProbDelta = 0;
  let maxConfidenceDelta = 0;
  let maxUpsetRiskDelta = 0;
  const changedRows = [];

  for (const current of currentRows) {
    const variant = byMatch.get(current.matchNo);
    if (!variant) continue;
    const probabilityDelta = maxProbabilityDelta(current.probabilities, variant.probabilities);
    const confidenceDelta = Math.abs(current.confidence - variant.confidence);
    const upsetRiskDelta = Math.abs(current.upsetRisk - variant.upsetRisk);
    maxProbDelta = Math.max(maxProbDelta, probabilityDelta);
    maxConfidenceDelta = Math.max(maxConfidenceDelta, confidenceDelta);
    maxUpsetRiskDelta = Math.max(maxUpsetRiskDelta, upsetRiskDelta);
    if (current.pick !== variant.pick) pickChanges += 1;
    if (current.decision.tier !== variant.decision.tier) tierChanges += 1;
    if (current.pick !== variant.pick || current.decision.tier !== variant.decision.tier || confidenceDelta > 0.01) {
      changedRows.push({
        matchNo: current.matchNo,
        fixture: current.fixture,
        current: {
          pick: current.pick,
          tier: current.decision.tier,
          confidence: current.confidence,
          upsetRisk: current.upsetRisk,
          probabilities: current.probabilities
        },
        variant: {
          key: variantKey,
          pick: variant.pick,
          tier: variant.decision.tier,
          confidence: variant.confidence,
          upsetRisk: variant.upsetRisk,
          probabilities: variant.probabilities
        },
        deltas: {
          probability: round(probabilityDelta),
          confidence: round(confidenceDelta),
          upsetRisk: round(upsetRiskDelta)
        }
      });
    }
  }

  return {
    variant: variantKey,
    pickChanges,
    tierChanges,
    maxProbabilityDelta: round(maxProbDelta),
    maxConfidenceDelta: round(maxConfidenceDelta),
    maxUpsetRiskDelta: round(maxUpsetRiskDelta),
    changedRows: changedRows.slice(0, 12)
  };
}

function rowFixture(match, teamById) {
  const home = teamById.get(match.home_team_id)?.name_zh ?? match.home_placeholder;
  const away = teamById.get(match.away_team_id)?.name_zh ?? match.away_placeholder;
  return `${home} vs ${away}`;
}

function buildVariantRows({ matches, teamById, snapshotsByMatch, rules, modelVersion, variant }) {
  const rows = [];
  for (const match of matches) {
    const snapshots = snapshotsByMatch.get(match.id) ?? [];
    if (snapshots.length === 0) continue;
    const result = predictMatch(match, teamById, snapshots, rules, modelVersion, variant.options);
    const prediction = result.prediction;
    const consensus = marketConsensusFromSnapshots(snapshots, variant.options);
    const marketQuality = evaluateMarketQuality({
      providerCount: consensus.providerCount,
      latestCapturedAt: consensus.latestCapturedAt ?? result.latestOdds?.captured_at,
      maxProviderDisagreement: consensus.maxProbabilityRange,
      generatedAt: new Date().toISOString()
    });
    const decision = previewDecision(prediction.value_score, prediction.confidence, prediction.upset_risk, marketQuality);
    rows.push({
      matchNo: match.match_no,
      fixture: rowFixture(match, teamById),
      pick: prediction.recommended_pick,
      probabilities: probabilitiesFromPrediction(prediction),
      confidence: prediction.confidence,
      upsetRisk: prediction.upset_risk,
      valueScore: prediction.value_score,
      decision,
      marketConsensus: {
        method: consensus.method,
        providerCount: consensus.providerCount,
        matchedProviderCount: consensus.matchedProviderCount,
        maxProbabilityRange: consensus.maxProbabilityRange,
        movement: consensus.movement
      }
    });
  }
  return rows;
}

const db = openDatabase();
let report;

try {
  const matches = db.prepare('SELECT * FROM matches ORDER BY match_no').all();
  const teams = db.prepare('SELECT * FROM teams ORDER BY id').all();
  const snapshots = db.prepare('SELECT * FROM odds_snapshots ORDER BY match_id, captured_at, id').all();
  const rules = db.prepare('SELECT * FROM tag_rules ORDER BY id').all();
  const modelVersion = db.prepare('SELECT * FROM model_versions ORDER BY id DESC LIMIT 1').get();
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const snapshotsByMatch = allByMatch(snapshots);
  const context = { matches, teamById, snapshotsByMatch, rules, modelVersion };

  check(Boolean(modelVersion), 'missing model version for impact audit');
  check(snapshots.length > 0, 'impact audit requires odds snapshots');

  const variantRows = Object.fromEntries(
    VARIANTS.map((variant) => [variant.key, buildVariantRows({ ...context, variant })])
  );
  const currentRows = variantRows.current ?? [];
  const comparisons = VARIANTS.filter((variant) => variant.key !== 'current').map((variant) =>
    compareRows(currentRows, variantRows[variant.key] ?? [], variant.key)
  );

  for (const [key, rows] of Object.entries(variantRows)) {
    check(rows.length === currentRows.length, `variant ${key} prediction count changed`);
  }

  for (const comparison of comparisons) {
    check(comparison.pickChanges === 0, `variant ${comparison.variant} changed ${comparison.pickChanges} picks`);
    check(comparison.tierChanges === 0, `variant ${comparison.variant} changed ${comparison.tierChanges} tiers`);
    check(
      comparison.maxConfidenceDelta <= MAX_CONFIDENCE_DELTA,
      `variant ${comparison.variant} moved confidence too far: ${comparison.maxConfidenceDelta}`
    );
    check(
      comparison.maxUpsetRiskDelta <= MAX_UPSET_RISK_DELTA,
      `variant ${comparison.variant} moved upset risk too far: ${comparison.maxUpsetRiskDelta}`
    );
  }

  const variantSummaries = Object.fromEntries(
    VARIANTS.map((variant) => [variant.key, { label: variant.label, ...summarizeVariant(variantRows[variant.key] ?? []) }])
  );

  check(
    variantSummaries.current.candidateCount === variantSummaries.equal_no_movement.candidateCount,
    'current model changed candidate count relative to equal/no-movement ablation'
  );
  check(
    variantSummaries.current.watchCount === variantSummaries.equal_no_movement.watchCount,
    'current model changed watch count relative to equal/no-movement ablation'
  );

  report = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    purpose:
      '验证历史机构权重和盘口移动只作为弱修正信号，不会强行改变预测选项、分层或推荐结论。',
    modelVersion: modelVersion
      ? {
          id: modelVersion.id,
          code: modelVersion.code,
          name: modelVersion.name
        }
      : null,
    variants: VARIANTS,
    summaries: variantSummaries,
    comparisons,
    guardrails: {
      samePredictionCount: Object.values(variantRows).every((rows) => rows.length === currentRows.length),
      noPickChanges: comparisons.every((comparison) => comparison.pickChanges === 0),
      noTierChanges: comparisons.every((comparison) => comparison.tierChanges === 0),
      confidenceDeltaBounded: comparisons.every((comparison) => comparison.maxConfidenceDelta <= MAX_CONFIDENCE_DELTA),
      upsetRiskDeltaBounded: comparisons.every((comparison) => comparison.maxUpsetRiskDelta <= MAX_UPSET_RISK_DELTA),
      candidateCountStable:
        variantSummaries.current.candidateCount === variantSummaries.equal_no_movement.candidateCount,
      watchCountStable: variantSummaries.current.watchCount === variantSummaries.equal_no_movement.watchCount
    },
    currentRows: currentRows.map((row) => ({
      matchNo: row.matchNo,
      fixture: row.fixture,
      pick: row.pick,
      tier: row.decision.tier,
      confidence: row.confidence,
      upsetRisk: row.upsetRisk,
      valueScore: row.valueScore,
      marketConsensus: row.marketConsensus
    }))
  };
} finally {
  db.close();
}

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`Model change impact verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: path.relative(ROOT_DIR, REPORT_PATH),
      current: report.summaries.current,
      guardrails: report.guardrails
    },
    null,
    2
  )
);
