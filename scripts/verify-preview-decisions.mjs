#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { marketConsensusFromSnapshots } from '../server/model/market.mjs';
import {
  evaluateMarketQuality,
  previewDecision,
  PREVIEW_DECISION_THRESHOLDS,
  PREVIEW_MARKET_QUALITY_THRESHOLDS
} from '../server/services/previewDecision.mjs';
import {
  buildProbabilityUncertainty,
  PROBABILITY_UNCERTAINTY_DEFAULTS
} from '../server/services/probabilityUncertainty.mjs';
import {
  isPredictionUsableOddsSource,
  preferredPredictionSnapshots
} from '../server/services/oddsSourcePolicy.mjs';
import { Repository } from '../server/services/repository.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const DB_PATH = path.join(ROOT_DIR, 'data/worldcup.sqlite');
const ODDS_AUDIT_PATH = path.join(ROOT_DIR, 'data/research/worldcup-2026/odds-source-audit.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports/preview-decision-audit.json');
const INTERNATIONAL_REPORT_PATH = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const PRIMARY_PROVIDER_ORDER = [
  'OddsLab/Pinnacle',
  'OddsLab/Betfair Exchange',
  'OddsLab/Bet365',
  'OddsLab/BetOnline.ag',
  'OddsLab/1xBet'
];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

function pickKeyFromLabel(label) {
  if (label === '主胜') return 'home';
  if (label === '客胜') return 'away';
  if (label === '平局') return 'draw';
  return null;
}

function scoreOutcomeKey(score) {
  if (!score) return null;
  if (score.home_goals > score.away_goals) return 'home';
  if (score.home_goals < score.away_goals) return 'away';
  return 'draw';
}

function scoreText(score) {
  return score ? `${score.home_goals}-${score.away_goals}` : null;
}

function readCalibrationError() {
  if (!fs.existsSync(INTERNATIONAL_REPORT_PATH)) return PROBABILITY_UNCERTAINTY_DEFAULTS.calibrationError;
  try {
    const report = readJson(INTERNATIONAL_REPORT_PATH);
    const value = Number(report?.evaluation?.overall?.primary?.calibration_error);
    return Number.isFinite(value) ? value : PROBABILITY_UNCERTAINTY_DEFAULTS.calibrationError;
  } catch {
    return PROBABILITY_UNCERTAINTY_DEFAULTS.calibrationError;
  }
}

function checkProbabilityInterval(matchNo, key, point, interval) {
  check(Boolean(interval), `match ${matchNo} missing ${key} probability interval`);
  if (!interval) return;
  check(Number.isFinite(Number(interval.low)) && Number.isFinite(Number(interval.high)), `match ${matchNo} has invalid ${key} interval numbers`);
  check(interval.low >= 0 && interval.high <= 1 && interval.low <= interval.high, `match ${matchNo} ${key} interval is out of range`);
  check(point >= interval.low && point <= interval.high, `match ${matchNo} ${key} interval does not contain point probability`);
}

function checkProviderReliability(matchNo, consensus) {
  check(
    consensus.method === 'historical_provider_weighted' || consensus.method === 'equal_provider_average',
    `match ${matchNo} has invalid consensus method: ${consensus.method}`,
  );
  check(
    Number.isFinite(Number(consensus.matchedProviderCount)) && consensus.matchedProviderCount >= 0,
    `match ${matchNo} has invalid matched provider count`,
  );
  const providers = consensus.providers ?? [];
  check(providers.length === consensus.providerCount, `match ${matchNo} consensus provider details do not match provider count`);
  for (const provider of providers) {
    const reliability = provider.reliability ?? {};
    check(
      Number.isFinite(Number(reliability.weight)) && reliability.weight > 0,
      `match ${matchNo} provider ${provider.provider} has invalid reliability weight`,
    );
    if (!reliability.matched) {
      check(
        Math.abs(Number(reliability.weight) - 1) <= 0.0001,
        `match ${matchNo} provider ${provider.provider} lacks historical evidence but is not neutral-weighted`,
      );
    }
  }
  const matched = providers.filter((provider) => provider.reliability?.matched).length;
  check(matched === consensus.matchedProviderCount, `match ${matchNo} matched provider count is inconsistent`);
}

function checkMarketMovement(matchNo, consensus) {
  const movement = consensus.movement;
  check(Boolean(movement), `match ${matchNo} missing market movement audit`);
  if (!movement) return;
  check(movement.method === 'opening_to_latest_by_provider', `match ${matchNo} has invalid movement method`);
  check(Number.isFinite(Number(movement.providerCount)) && movement.providerCount >= 0, `match ${matchNo} has invalid movement provider count`);
  const providers = movement.providers ?? [];
  check(providers.length === movement.providerCount, `match ${matchNo} movement providers do not match provider count`);
  if (!movement.supplied) {
    check(movement.providerCount === 0, `match ${matchNo} movement is unsupplied but provider count is not zero`);
    return;
  }
  check(['strengthened', 'weakened', 'flat'].includes(movement.favoriteDirection), `match ${matchNo} movement has invalid favorite direction`);
  for (const key of ['home', 'draw', 'away']) {
    check(
      Number.isFinite(Number(movement.deltas?.[key])) && Math.abs(Number(movement.deltas[key])) <= 1,
      `match ${matchNo} movement has invalid ${key} delta`,
    );
  }
  check(
    Number.isFinite(Number(movement.maxAbsProbabilityMove)) && movement.maxAbsProbabilityMove >= 0,
    `match ${matchNo} has invalid movement max probability move`,
  );
  for (const provider of providers) {
    check(Number(provider.snapshots) >= 2, `match ${matchNo} movement provider ${provider.provider} has fewer than two snapshots`);
    check(Number.isFinite(Number(provider.favoriteDelta)), `match ${matchNo} movement provider ${provider.provider} has invalid favorite delta`);
  }
}

function providerRank(provider) {
  const index = PRIMARY_PROVIDER_ORDER.indexOf(provider);
  return index >= 0 ? index : PRIMARY_PROVIDER_ORDER.length + 1;
}

function capturedTime(row) {
  const time = new Date(row.captured_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isUsableSnapshot(row, cutoffTime) {
  const time = capturedTime(row);
  const kickoffTime = new Date(row.kickoff_utc).getTime();
  const effectiveCutoff = Number.isFinite(kickoffTime) ? Math.min(cutoffTime, kickoffTime) : cutoffTime;
  return time > 0 && time < effectiveCutoff;
}

function isVerifiedSnapshot(row) {
  return isPredictionUsableOddsSource(row.source_type);
}

function expectedPrimarySnapshot(snapshots) {
  return preferredPredictionSnapshots(snapshots.filter(isVerifiedSnapshot))
    .toSorted(
      (left, right) =>
        capturedTime(right) - capturedTime(left) ||
        providerRank(left.provider) - providerRank(right.provider) ||
        String(right.provider).localeCompare(String(left.provider)),
    )
    .at(0);
}

function predictionSnapshotOrder(snapshots) {
  return snapshots.toSorted(
    (left, right) =>
      capturedTime(left) - capturedTime(right) ||
      providerRank(right.provider) - providerRank(left.provider) ||
      String(left.provider).localeCompare(String(right.provider)),
  );
}

function rowFixture(row) {
  return `${row.home_team_name ?? row.home_placeholder} vs ${row.away_team_name ?? row.away_placeholder}`;
}

check(fs.existsSync(DB_PATH), `missing database: ${path.relative(ROOT_DIR, DB_PATH)}`);
check(fs.existsSync(ODDS_AUDIT_PATH), `missing odds audit: ${path.relative(ROOT_DIR, ODDS_AUDIT_PATH)}`);

let report = {
  ok: false,
  generatedAt: new Date().toISOString(),
  thresholds: PREVIEW_DECISION_THRESHOLDS,
  marketQualityThresholds: PREVIEW_MARKET_QUALITY_THRESHOLDS,
  probabilityUncertaintyDefaults: PROBABILITY_UNCERTAINTY_DEFAULTS,
  providerPriority: PRIMARY_PROVIDER_ORDER,
  rows: [],
  tierCounts: {},
  guardrails: {}
};

if (fs.existsSync(DB_PATH) && fs.existsSync(ODDS_AUDIT_PATH)) {
  const oddsAudit = readJson(ODDS_AUDIT_PATH);
  const calibrationError = readCalibrationError();
  const db = new DatabaseSync(DB_PATH);
  const snapshotCutoff = Date.now() + 15 * 60 * 1000;
  try {
    const predictions = db
      .prepare(
        `SELECT
          p.*,
          m.match_no,
          m.status AS match_status,
          m.home_placeholder,
          m.away_placeholder,
          ht.name_zh AS home_team_name,
          at.name_zh AS away_team_name,
          os.provider,
          os.source_type,
          os.captured_at,
          os.snapshot_hash,
          os.home_odds,
          os.draw_odds,
          os.away_odds
         FROM predictions p
         JOIN matches m ON m.id = p.match_id
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         JOIN odds_snapshots os ON os.id = p.odds_snapshot_id
         ORDER BY m.match_no`
      )
      .all();

    check(predictions.length > 0, 'preview audit expects at least one prediction when verified odds are available');
    check(oddsAudit.status === 'complete_market_odds_imported', 'odds audit must be complete before preview decisions are allowed');
    check(
      String(oddsAudit.recommendationPolicy ?? '').includes('不能作为单独投注建议'),
      'odds audit must retain the no standalone betting advice guardrail',
    );

    const snapshotsByMatch = new Map();
    for (const snapshot of db
      .prepare(
        `SELECT os.*, m.kickoff_utc
         FROM odds_snapshots os
         JOIN matches m ON m.id = os.match_id
         ORDER BY os.match_id, os.captured_at`
      )
      .all()) {
      if (!isUsableSnapshot(snapshot, snapshotCutoff)) continue;
      if (!isVerifiedSnapshot(snapshot)) continue;
      if (!snapshotsByMatch.has(snapshot.match_id)) snapshotsByMatch.set(snapshot.match_id, []);
      snapshotsByMatch.get(snapshot.match_id).push(snapshot);
    }

    const availableVerifiedSnapshots = [...snapshotsByMatch.values()].reduce((sum, snapshots) => sum + snapshots.length, 0);
    const tierCounts = {};
    const rows = predictions.map((row) => {
      const probabilities = [row.calibrated_home_prob, row.calibrated_draw_prob, row.calibrated_away_prob];
      const probabilitySum = probabilities.reduce((sum, value) => sum + Number(value), 0);
      const selectedSnapshotPool = preferredPredictionSnapshots(snapshotsByMatch.get(row.match_id) ?? []);
      const matchSnapshots = predictionSnapshotOrder(selectedSnapshotPool);
      const consensus = marketConsensusFromSnapshots(matchSnapshots);
      const marketQuality = evaluateMarketQuality({
        providerCount: consensus.providerCount,
        latestCapturedAt: consensus.latestCapturedAt ?? row.captured_at,
        maxProviderDisagreement: consensus.maxProbabilityRange,
        generatedAt: row.generated_at
      });
      const decision = previewDecision(row.value_score, row.confidence, row.upset_risk, marketQuality);
      const scoreRows = db
        .prepare(
          `SELECT home_goals, away_goals, probability
           FROM score_probabilities
           WHERE prediction_id = ?
           ORDER BY probability DESC
           LIMIT 16`
        )
        .all(row.id);
      const globalPeakScore = scoreRows[0] ?? null;
      const directionalScore =
        scoreRows.find((score) => scoreOutcomeKey(score) === pickKeyFromLabel(row.recommended_pick)) ?? globalPeakScore;
      const probabilityUncertainty = buildProbabilityUncertainty(
        {
          home: row.calibrated_home_prob,
          draw: row.calibrated_draw_prob,
          away: row.calibrated_away_prob
        },
        {
          calibrationError,
          providerDisagreement: consensus.maxProbabilityRange,
          latestAgeHours: marketQuality.latestAgeHours,
          candidateReady: marketQuality.candidateReady,
          watchReady: marketQuality.watchReady
        }
      );
      tierCounts[decision.tier] = (tierCounts[decision.tier] ?? 0) + 1;

      check(
        isPredictionUsableOddsSource(row.source_type),
        `match ${row.match_no} prediction uses unverified odds source type: ${row.source_type}`,
      );
      check(probabilities.every((value) => Number.isFinite(Number(value)) && value >= 0 && value <= 1), `match ${row.match_no} has invalid probabilities`);
      check(Math.abs(probabilitySum - 1) <= 0.002, `match ${row.match_no} probabilities do not sum to 1`);

      check(selectedSnapshotPool.length > 0, `match ${row.match_no} has no odds snapshots`);
      check(
        selectedSnapshotPool.some((snapshot) => snapshot.id === row.odds_snapshot_id),
        `match ${row.match_no} selected snapshot is not in the verified pre-match snapshot pool`,
      );
      check(consensus.providerCount >= 1, `match ${row.match_no} missing provider consensus`);
      check(
        [consensus.home, consensus.draw, consensus.away].every((value) => Number.isFinite(Number(value)) && value >= 0 && value <= 1),
        `match ${row.match_no} has invalid provider consensus probabilities`,
      );
      check(
        Math.abs(Number(consensus.home) + Number(consensus.draw) + Number(consensus.away) - 1) <= 0.002,
        `match ${row.match_no} provider consensus probabilities do not sum to 1`,
      );
      check(
        Number.isFinite(Number(consensus.maxProbabilityRange)) && consensus.maxProbabilityRange >= 0,
        `match ${row.match_no} has invalid provider consensus range`,
      );
      checkProviderReliability(row.match_no, consensus);
      checkMarketMovement(row.match_no, consensus);
      check(
        marketQuality.watchReady || decision.tier !== 'watch',
        `match ${row.match_no} cannot remain watch when market quality watch checks fail`,
      );
      check(
        marketQuality.candidateReady || decision.tier !== 'candidate',
        `match ${row.match_no} cannot remain candidate when market quality candidate checks fail`,
      );
      check(scoreRows.length >= 6, `match ${row.match_no} must retain at least six score probabilities`);
      check(Boolean(globalPeakScore), `match ${row.match_no} missing global peak score`);
      check(Boolean(directionalScore), `match ${row.match_no} missing directional score`);
      check(
        !directionalScore || scoreOutcomeKey(directionalScore) === pickKeyFromLabel(row.recommended_pick),
        `match ${row.match_no} directional score does not match recommended pick`,
      );
      check(Boolean(probabilityUncertainty), `match ${row.match_no} missing probability uncertainty`);
      if (probabilityUncertainty) {
        check(
          Number.isFinite(Number(probabilityUncertainty.margin)) &&
            probabilityUncertainty.margin >= PROBABILITY_UNCERTAINTY_DEFAULTS.minMargin &&
            probabilityUncertainty.margin <= PROBABILITY_UNCERTAINTY_DEFAULTS.maxMargin,
          `match ${row.match_no} probability uncertainty margin is invalid`,
        );
        checkProbabilityInterval(row.match_no, 'home', row.calibrated_home_prob, probabilityUncertainty.intervals?.home);
        checkProbabilityInterval(row.match_no, 'draw', row.calibrated_draw_prob, probabilityUncertainty.intervals?.draw);
        checkProbabilityInterval(row.match_no, 'away', row.calibrated_away_prob, probabilityUncertainty.intervals?.away);
      }

      if (decision.tier === 'candidate') {
        check(row.value_score >= PREVIEW_DECISION_THRESHOLDS.candidate.minValueScore, `match ${row.match_no} candidate value score below threshold`);
        check(row.confidence >= PREVIEW_DECISION_THRESHOLDS.candidate.minConfidence, `match ${row.match_no} candidate confidence below threshold`);
        check(row.upset_risk <= PREVIEW_DECISION_THRESHOLDS.candidate.maxUpsetRisk, `match ${row.match_no} candidate upset risk above threshold`);
      }

      return {
        matchNo: row.match_no,
        fixture: rowFixture(row),
        pick: row.recommended_pick,
        provider: row.provider,
        sourceType: row.source_type,
        capturedAt: row.captured_at,
        probabilities: {
          home: round(row.calibrated_home_prob),
          draw: round(row.calibrated_draw_prob),
          away: round(row.calibrated_away_prob),
          sum: round(probabilitySum)
        },
        confidence: round(row.confidence),
        upsetRisk: round(row.upset_risk),
        valueScore: round(row.value_score, 3),
        decision,
        marketQuality,
        marketConsensus: {
          method: consensus.method,
          providerCount: consensus.providerCount,
          matchedProviderCount: consensus.matchedProviderCount,
          snapshotCount: consensus.snapshotCount,
          probabilities: {
            home: round(consensus.home),
            draw: round(consensus.draw),
            away: round(consensus.away)
          },
          favorite: consensus.favorite,
          primaryAgreement: consensus.primaryAgreement,
          maxProbabilityRange: round(consensus.maxProbabilityRange),
          avgProbabilityRange: round(consensus.avgProbabilityRange),
          providerWeightRange: consensus.providerWeightRange,
          movement: consensus.movement
            ? {
                supplied: consensus.movement.supplied,
                method: consensus.movement.method,
                providerCount: consensus.movement.providerCount,
                matchedProviderCount: consensus.movement.matchedProviderCount,
                deltas: consensus.movement.deltas,
                strongestOutcome: consensus.movement.strongestOutcome,
                strongestDelta: consensus.movement.strongestDelta,
                maxAbsProbabilityMove: consensus.movement.maxAbsProbabilityMove,
                avgProviderAbsProbabilityMove: consensus.movement.avgProviderAbsProbabilityMove,
                favoriteDelta: consensus.movement.favoriteDelta,
                favoriteDirection: consensus.movement.favoriteDirection,
                providers: (consensus.movement.providers ?? []).map((provider) => ({
                  provider: provider.provider,
                  snapshots: provider.snapshots,
                  favoriteDelta: provider.favoriteDelta,
                  maxAbsMove: provider.maxAbsMove,
                  firstCapturedAt: provider.firstCapturedAt,
                  latestCapturedAt: provider.latestCapturedAt,
                  historicalCode: provider.reliability?.code,
                  evidenceMatched: provider.reliability?.matched
                }))
              }
            : null,
          latestCapturedAt: consensus.latestCapturedAt,
          oldestProviderCapturedAt: consensus.oldestProviderCapturedAt,
          homeOddsRange: consensus.homeOddsRange,
          drawOddsRange: consensus.drawOddsRange,
          awayOddsRange: consensus.awayOddsRange,
          providers: (consensus.providers ?? []).map((provider) => ({
            provider: provider.provider,
            weight: round(provider.reliability?.weight),
            historicalCode: provider.reliability?.code,
            historicalLabel: provider.reliability?.label,
            evidenceRows: provider.reliability?.rows,
            evidenceMatched: provider.reliability?.matched,
            note: provider.reliability?.note
          }))
        },
        scoreModel: {
          globalPeak: {
            score: scoreText(globalPeakScore),
            probability: round(globalPeakScore?.probability)
          },
          directional: {
            score: scoreText(directionalScore),
            probability: round(directionalScore?.probability),
            outcome: scoreOutcomeKey(directionalScore)
          },
          topScores: scoreRows.slice(0, 6).map((score) => ({
            score: scoreText(score),
            probability: round(score.probability),
            outcome: scoreOutcomeKey(score)
          }))
        },
        probabilityUncertainty
      };
    });

    const globalPeakScores = rows.map((row) => row.scoreModel?.globalPeak?.score).filter(Boolean);
    const directionalScores = rows.map((row) => row.scoreModel?.directional?.score).filter(Boolean);
    check(
      new Set(globalPeakScores).size > 1,
      'score model global peaks collapsed to one repeated score across all preview rows',
    );
    check(
      !globalPeakScores.every((score) => score === '1-1'),
      'score model global peaks collapsed to 1-1 across all preview rows',
    );
    check(
      new Set(directionalScores).size > 1,
      'score model directional scores collapsed to one repeated score across all preview rows',
    );

    const repository = new Repository(db);
    const summary = repository.getSummary();
    const hasOfficialBlockedFixtures = db
      .prepare("SELECT COUNT(*) AS count FROM matches WHERE status = 'official_schedule_prediction_blocked'")
      .get().count > 0;
    check(summary.counts.predictedMatches === predictions.length, 'summary predicted match count must match predictions table');
    check(summary.counts.positiveValue === (tierCounts.candidate ?? 0), 'summary positive value count must equal candidate tier count');
    check(!hasOfficialBlockedFixtures || summary.parlays.length === 0, 'parlays must remain blocked while official schedule fixtures still lack full inputs');

    report = {
      ...report,
      ok: failures.length === 0,
      oddsAuditStatus: oddsAudit.status,
      predictionCount: predictions.length,
      availableSnapshots: availableVerifiedSnapshots,
      tierCounts,
      guardrails: {
        verifiedOddsOnly: true,
        providerPriorityApplied: true,
        providerConsensusMeasured: true,
        historicalProviderWeightsMeasured: rows.some((row) => row.marketConsensus?.matchedProviderCount > 0),
        marketMovementMeasured: rows.some((row) => row.marketConsensus?.movement?.supplied),
        marketQualityApplied: true,
        probabilityUncertaintyMeasured: true,
        scoreDistributionCalibrated: true,
        noStandaloneBettingAdvice: true,
        parlaysBlockedUntilFullInputs: hasOfficialBlockedFixtures
      },
      rows
    };
  } finally {
    db.close();
  }
}

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`Preview decision verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  report: path.relative(ROOT_DIR, REPORT_PATH),
  predictionCount: report.predictionCount,
  tierCounts: report.tierCounts,
  availableSnapshots: report.availableSnapshots
}, null, 2));
