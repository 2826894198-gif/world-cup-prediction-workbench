#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const HISTORICAL_REPORT = path.join(ROOT_DIR, 'reports/historical-model-evaluation.json');
const INTERNATIONAL_REPORT = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const MAJOR_TOURNAMENT_AUDIT = path.join(ROOT_DIR, 'reports/major-tournament-audit.json');
const PREVIEW_AUDIT = path.join(ROOT_DIR, 'reports/preview-decision-audit.json');
const FRIENDLY_LEDGER_AUDIT = path.join(ROOT_DIR, 'reports/friendly-prediction-ledger.json');
const MODEL_CHANGE_IMPACT_AUDIT = path.join(ROOT_DIR, 'reports/model-change-impact-audit.json');
const MODEL_ITERATION_AUDIT = path.join(ROOT_DIR, 'reports/model-iteration-audit.json');
const OUTPUT_REPORT = path.join(ROOT_DIR, 'reports/promotion-gate-audit.json');

const CALIBRATION_THRESHOLDS = {
  historicalBlendedEceMax: 0.03,
  historicalMarketEceMax: 0.03,
  internationalPrimaryEceMax: 0.08,
  friendlyLatest24EceBlockMin: 0.15,
  friendlyFullWindowEceMax: 0.08
};

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

function metric(report, pathParts) {
  return pathParts.reduce((value, key) => value?.[key], report);
}

check(fs.existsSync(HISTORICAL_REPORT), `missing historical report: ${path.relative(ROOT_DIR, HISTORICAL_REPORT)}`);
check(fs.existsSync(INTERNATIONAL_REPORT), `missing international report: ${path.relative(ROOT_DIR, INTERNATIONAL_REPORT)}`);
check(fs.existsSync(MAJOR_TOURNAMENT_AUDIT), `missing major tournament audit: ${path.relative(ROOT_DIR, MAJOR_TOURNAMENT_AUDIT)}`);
check(fs.existsSync(PREVIEW_AUDIT), `missing preview audit: ${path.relative(ROOT_DIR, PREVIEW_AUDIT)}`);
check(fs.existsSync(FRIENDLY_LEDGER_AUDIT), `missing friendly ledger: ${path.relative(ROOT_DIR, FRIENDLY_LEDGER_AUDIT)}`);
check(
  fs.existsSync(MODEL_CHANGE_IMPACT_AUDIT),
  `missing model change impact audit: ${path.relative(ROOT_DIR, MODEL_CHANGE_IMPACT_AUDIT)}`
);
check(fs.existsSync(MODEL_ITERATION_AUDIT), `missing model iteration audit: ${path.relative(ROOT_DIR, MODEL_ITERATION_AUDIT)}`);

let output = {
  ok: false,
  generatedAt: new Date().toISOString(),
  status: 'missing_inputs',
  report: 'reports/promotion-gate-audit.json'
};

if (
  fs.existsSync(HISTORICAL_REPORT) &&
  fs.existsSync(INTERNATIONAL_REPORT) &&
  fs.existsSync(MAJOR_TOURNAMENT_AUDIT) &&
  fs.existsSync(PREVIEW_AUDIT) &&
  fs.existsSync(FRIENDLY_LEDGER_AUDIT) &&
  fs.existsSync(MODEL_CHANGE_IMPACT_AUDIT) &&
  fs.existsSync(MODEL_ITERATION_AUDIT)
) {
  const historical = readJson(HISTORICAL_REPORT);
  const international = readJson(INTERNATIONAL_REPORT);
  const majorTournament = readJson(MAJOR_TOURNAMENT_AUDIT);
  const preview = readJson(PREVIEW_AUDIT);
  const friendlyLedger = readJson(FRIENDLY_LEDGER_AUDIT);
  const impact = readJson(MODEL_CHANGE_IMPACT_AUDIT);
  const iteration = readJson(MODEL_ITERATION_AUDIT);

  const historicalOverall = metric(historical, ['evaluation', 'overall']);
  const marketOnly = historicalOverall?.market_only;
  const blended = historicalOverall?.blended;
  const modelOnly = historicalOverall?.model_only;
  const decisionAccuracy = historicalOverall?.decision_accuracy ?? {};
  const valueResearch = historicalOverall?.value_research ?? {};
  const valueSensitivity = Array.isArray(historicalOverall?.value_sensitivity)
    ? historicalOverall.value_sensitivity
    : [];
  const valueSensitivityBySeason = Array.isArray(metric(historical, ['evaluation', 'by_season']))
    ? historical.evaluation.by_season.map((season) => ({
        season: season.season_label,
        rows: Array.isArray(season.value_sensitivity) ? season.value_sensitivity : []
      }))
    : [];
  const primaryMovement = metric(historical, ['evaluation', 'primary_market_movement']);
  const internationalPrimary = metric(international, ['evaluation', 'overall', 'primary']);
  const friendlyLatest24 = metric(international, ['friendly_audit', 'primary']);
  const friendlyFullWindow = metric(international, ['friendly_audit', 'full_window', 'primary']);

  const marketLogLoss = Number(marketOnly?.log_loss);
  const blendedLogLoss = Number(blended?.log_loss);
  const modelLogLoss = Number(modelOnly?.log_loss);
  const marketCalibrationError = Number(marketOnly?.calibration_error);
  const blendedCalibrationError = Number(blended?.calibration_error);
  const modelCalibrationError = Number(modelOnly?.calibration_error);
  const marketAccuracy = Number(decisionAccuracy.market?.accuracy);
  const adaptiveAccuracy = Number(decisionAccuracy.adaptive?.accuracy);
  const movementAdaptiveAccuracy = Number(decisionAccuracy.movement_adaptive?.accuracy);
  const valueRoi = Number(valueResearch.paper_roi);
  const closingPickLift = Number(primaryMovement?.closing_pick_lift);
  const internationalAccuracy = Number(internationalPrimary?.accuracy);
  const internationalCalibrationGap = Number(internationalPrimary?.calibration_gap);
  const internationalCalibrationError = Number(internationalPrimary?.calibration_error);
  const friendlyLatest24CalibrationError = Number(friendlyLatest24?.calibration_error);
  const friendlyFullWindowCalibrationError = Number(friendlyFullWindow?.calibration_error);
  const candidateCount = Number(preview.tierCounts?.candidate ?? 0);
  const watchCount = Number(preview.tierCounts?.watch ?? 0);
  const negativeCount = Number(preview.tierCounts?.negative ?? 0);
  const predictionCount = Number(preview.predictionCount ?? 0);

  [
    ['historical market log loss', marketLogLoss],
    ['historical blended log loss', blendedLogLoss],
    ['historical model log loss', modelLogLoss],
    ['historical market calibration error', marketCalibrationError],
    ['historical blended calibration error', blendedCalibrationError],
    ['historical model calibration error', modelCalibrationError],
    ['historical market accuracy', marketAccuracy],
    ['historical adaptive accuracy', adaptiveAccuracy],
    ['historical movement adaptive accuracy', movementAdaptiveAccuracy],
    ['historical value ROI', valueRoi],
    ['closing pick lift', closingPickLift],
    ['international accuracy', internationalAccuracy],
    ['international calibration gap', internationalCalibrationGap],
    ['international calibration error', internationalCalibrationError],
    ['friendly latest-24 calibration error', friendlyLatest24CalibrationError],
    ['friendly full-window calibration error', friendlyFullWindowCalibrationError]
  ].forEach(([label, value]) => check(finiteNumber(value), `${label} must be finite`));

  const marketBeatsBlend = marketLogLoss <= blendedLogLoss;
  const modelIsWeakerThanMarket = modelLogLoss > marketLogLoss;
  const adaptiveLift = adaptiveAccuracy - marketAccuracy;
  const movementAdaptiveLift = movementAdaptiveAccuracy - marketAccuracy;
  const valueResearchNegative = valueRoi < 0;
  const productionThreshold = valueSensitivity.find((row) => row.key === 'edge_04_prob_34') ?? null;
  const robustPositiveThresholds = valueSensitivity.filter(
    (row) => Number(row.paper_roi) >= 0.02 && Number(row.candidates) >= 1000
  );
  const stablePositiveThresholds = valueSensitivity.filter((row) => {
    const seasonRows = valueSensitivityBySeason
      .map((season) => season.rows.find((item) => item.key === row.key))
      .filter(Boolean);
    const positiveSeasons = seasonRows.filter((item) => Number(item.paper_roi) > 0).length;
    return seasonRows.length >= 4 && positiveSeasons >= Math.ceil(seasonRows.length * 0.8);
  });
  const edgeIsThin = adaptiveLift < 0.01 && movementAdaptiveLift < 0.01;
  const closingMarketMatters = closingPickLift > 0;
  const noStandaloneAdvice = Boolean(preview.guardrails?.noStandaloneBettingAdvice);
  const parlaysBlocked = Boolean(preview.guardrails?.parlaysBlockedUntilFullInputs);
  const majorGuardrails = majorTournament.guardrails ?? {};
  const majorTournamentAudited =
    majorTournament.ok === true &&
    Number(majorTournament.summary?.majorMatches ?? 0) >= 800 &&
    Number(majorTournament.summary?.editionCount ?? 0) >= 20 &&
    majorGuardrails.requiredCompetitionsPresent === true &&
    majorGuardrails.requiredStagesPresent === true &&
    majorGuardrails.stageCountsReconcile === true &&
    majorGuardrails.sampleSizesAdequate === true &&
    majorGuardrails.editionCoverage === true &&
    majorGuardrails.metricsFinite === true &&
    majorGuardrails.futurePredictionsBlocked === true &&
    majorGuardrails.unscored2026RowsQuarantined === true;
  const friendlyLedgerGuardrails = friendlyLedger.guardrails ?? {};
  const friendlyLedgerRecorded =
    friendlyLedger.ok === true &&
    Number(friendlyLedger.summary?.latest24?.matches ?? 0) === 24 &&
    Number(friendlyLedger.summary?.worldCupRelated?.matches ?? 0) >= 8 &&
    friendlyLedgerGuardrails.latest24RowsRecorded === true &&
    friendlyLedgerGuardrails.latestAccuracyRecomputed === true &&
    friendlyLedgerGuardrails.incompleteWorldCupRowsQuarantined === true &&
    friendlyLedgerGuardrails.friendlySignalMarketBlocked === true;
  const impactGuardrails = impact.guardrails ?? {};
  const modelChangeImpactBounded =
    impact.ok === true &&
    impactGuardrails.noPickChanges === true &&
    impactGuardrails.noTierChanges === true &&
    impactGuardrails.candidateCountStable === true &&
    impactGuardrails.watchCountStable === true &&
    impactGuardrails.confidenceDeltaBounded === true &&
    impactGuardrails.upsetRiskDeltaBounded === true;
  const iterationGuardrails = iteration.guardrails ?? {};
  const modelIterationAudited =
    iteration.ok === true &&
    Number(iteration.summary?.totalIterations ?? 0) >= 8 &&
    Number(iteration.summary?.canDrive2026Recommendation ?? 1) === 0 &&
    iterationGuardrails.marketPriorRequired === true &&
    iterationGuardrails.valueResearchBlocksPromotion === true &&
    iterationGuardrails.worldCupBlendOnlyForReview === true &&
    iterationGuardrails.friendlySignalMarketBlocked === true &&
    iterationGuardrails.providerMovementBounded === true &&
    iterationGuardrails.noIterationDirectlyDrivesRecommendation === true;

  const checks = [
    {
      key: 'market_prior_required',
      passed: marketBeatsBlend && modelIsWeakerThanMarket,
      detail: `market LL ${round(marketLogLoss)} vs blend ${round(blendedLogLoss)}, model ${round(modelLogLoss)}`
    },
    {
      key: 'historical_value_roi_blocks_promotion',
      passed: valueResearchNegative,
      detail: `paper ROI ${round(valueRoi, 4)}, current candidates ${candidateCount}`
    },
    {
      key: 'production_threshold_negative_roi',
      passed: Boolean(productionThreshold) && Number(productionThreshold.paper_roi) < 0,
      detail: productionThreshold
        ? `${productionThreshold.key} ROI ${round(productionThreshold.paper_roi, 4)}, candidates ${productionThreshold.candidates}`
        : 'production threshold row missing'
    },
    {
      key: 'no_stable_positive_threshold_grid',
      passed: robustPositiveThresholds.length === 0 && stablePositiveThresholds.length === 0,
      detail: `robust positive rows ${robustPositiveThresholds.length}, stable positive rows ${stablePositiveThresholds.length}`
    },
    {
      key: 'adaptive_lift_too_thin_for_standalone_edge',
      passed: edgeIsThin,
      detail: `adaptive lift ${round(adaptiveLift, 4)}, movement lift ${round(movementAdaptiveLift, 4)}`
    },
    {
      key: 'closing_market_movement_respected',
      passed: closingMarketMatters,
      detail: `closing pick lift ${round(closingPickLift, 4)}`
    },
    {
      key: 'historical_market_probability_calibrated',
      passed:
        marketCalibrationError <= CALIBRATION_THRESHOLDS.historicalMarketEceMax &&
        blendedCalibrationError <= CALIBRATION_THRESHOLDS.historicalBlendedEceMax,
      detail: `market ECE ${round(marketCalibrationError, 4)}, blend ECE ${round(blendedCalibrationError, 4)}`
    },
    {
      key: 'international_primary_probability_calibrated',
      passed: internationalCalibrationError <= CALIBRATION_THRESHOLDS.internationalPrimaryEceMax,
      detail: `international primary ECE ${round(internationalCalibrationError, 4)}`
    },
    {
      key: 'major_tournament_walk_forward_audited',
      passed: majorTournamentAudited,
      detail: `major matches ${majorTournament.summary?.majorMatches ?? '--'}, editions ${
        majorTournament.summary?.editionCount ?? '--'
      }, stages ${majorTournament.summary?.stageCount ?? '--'}`
    },
    {
      key: 'friendly_short_window_calibration_blocks_promotion',
      passed:
        friendlyLatest24CalibrationError >= CALIBRATION_THRESHOLDS.friendlyLatest24EceBlockMin &&
        friendlyFullWindowCalibrationError <= CALIBRATION_THRESHOLDS.friendlyFullWindowEceMax,
      detail: `latest-24 ECE ${round(friendlyLatest24CalibrationError, 4)}, full-window ECE ${round(
        friendlyFullWindowCalibrationError,
        4
      )}, candidates ${candidateCount}`
    },
    {
      key: 'friendly_prediction_ledger_recorded',
      passed: friendlyLedgerRecorded,
      detail: `latest ${friendlyLedger.summary?.latest24?.hits ?? '--'}/${friendlyLedger.summary?.latest24?.matches ?? '--'}, WC-related ${
        friendlyLedger.summary?.worldCupRelated?.hits ?? '--'
      }/${friendlyLedger.summary?.worldCupRelated?.matches ?? '--'}, decision ${
        friendlyLedger.summary?.promotionGate?.decision ?? '--'
      }`
    },
    {
      key: 'preview_audit_passed',
      passed: preview.ok === true && predictionCount > 0,
      detail: `preview rows ${predictionCount}, watch ${watchCount}, negative ${negativeCount}`
    },
    {
      key: 'preview_candidates_remain_gated',
      passed:
        candidateCount >= 0 &&
        noStandaloneAdvice &&
        parlaysBlocked &&
        Number(iteration.summary?.canDrive2026Recommendation ?? 1) === 0,
      detail: `candidate ${candidateCount}, standalone advice ${noStandaloneAdvice}, parlays blocked ${parlaysBlocked}`
    },
    {
      key: 'model_change_impact_bounded',
      passed: modelChangeImpactBounded,
      detail: `pick changes ${impact.comparisons?.reduce((sum, row) => sum + Number(row.pickChanges ?? 0), 0) ?? '--'}, tier changes ${
        impact.comparisons?.reduce((sum, row) => sum + Number(row.tierChanges ?? 0), 0) ?? '--'
      }`
    },
    {
      key: 'model_iteration_audit_passed',
      passed: modelIterationAudited,
      detail: `iterations ${iteration.summary?.totalIterations ?? '--'}, direct recommendation ${
        iteration.summary?.canDrive2026Recommendation ?? '--'
      }`
    },
    {
      key: 'no_standalone_betting_advice',
      passed: noStandaloneAdvice,
      detail: 'preview output remains prediction-tiered, not betting advice'
    },
    {
      key: 'parlays_blocked_until_full_inputs',
      passed: parlaysBlocked,
      detail: 'lineups, injuries, weather, and news are not complete'
    }
  ];

  for (const item of checks) {
    check(item.passed, `promotion gate failed: ${item.key} (${item.detail})`);
  }

  output = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    status: failures.length === 0 ? 'preview_only_no_promotion' : 'promotion_gate_failed',
    report: 'reports/promotion-gate-audit.json',
    calibrationThresholds: CALIBRATION_THRESHOLDS,
    conclusion:
      failures.length === 0
        ? '历史走步证据不足以支持单独正价值推荐；当前 2026 输出只能保留预判分层，候选不晋级投注建议或串关。'
        : '历史证据、当前预判或串关守门存在不一致，禁止晋级。',
    checks,
    evidence: {
      historical: {
        dataSource: historical.data_source,
        seasons: historical.seasons,
        leagues: historical.leagues,
        matches: blended?.matches ?? null,
        marketLogLoss: round(marketLogLoss),
        blendedLogLoss: round(blendedLogLoss),
        modelLogLoss: round(modelLogLoss),
        marketAccuracy: round(marketAccuracy),
        adaptiveAccuracy: round(adaptiveAccuracy),
        adaptiveLift: round(adaptiveLift),
        movementAdaptiveAccuracy: round(movementAdaptiveAccuracy),
        movementAdaptiveLift: round(movementAdaptiveLift),
        valueResearchRoi: round(valueRoi, 4),
        calibration: {
          marketEce: round(marketCalibrationError, 4),
          blendedEce: round(blendedCalibrationError, 4),
          modelEce: round(modelCalibrationError, 4)
        },
        valueSensitivity: valueSensitivity.map((row) => ({
          key: row.key,
          label: row.label,
          candidates: row.candidates,
          hitRate: round(row.hit_rate, 4),
          avgEdge: round(row.avg_edge, 4),
          paperRoi: round(row.paper_roi, 4),
          positiveSeasons: valueSensitivityBySeason
            .map((season) => season.rows.find((item) => item.key === row.key))
            .filter((item) => Number(item?.paper_roi) > 0).length
        })),
        robustPositiveThresholds: robustPositiveThresholds.map((row) => row.key),
        stablePositiveThresholds: stablePositiveThresholds.map((row) => row.key),
        closingPickLift: round(closingPickLift, 4)
      },
      international: {
        dataSource: international.data_source,
        matches: internationalPrimary?.matches ?? null,
        primaryAccuracy: round(internationalAccuracy),
        calibrationGap: round(internationalCalibrationGap),
        calibrationError: round(internationalCalibrationError),
        friendlyLatest24CalibrationError: round(friendlyLatest24CalibrationError, 4),
        friendlyFullWindowCalibrationError: round(friendlyFullWindowCalibrationError, 4),
        futurePredictions: Array.isArray(international.future_predictions) ? international.future_predictions.length : null
      },
      majorTournament: {
        ok: majorTournament.ok === true,
        summary: majorTournament.summary,
        guardrails: majorTournament.guardrails,
        decision: majorTournament.decision,
        file: majorTournament.file
      },
      friendlyLedger: {
        ok: friendlyLedger.ok === true,
        summary: friendlyLedger.summary,
        guardrails: friendlyLedger.guardrails,
        file: friendlyLedger.file
      },
      modelChangeImpact: {
        ok: impact.ok === true,
        summaries: impact.summaries,
        comparisons: impact.comparisons,
        guardrails: impact.guardrails
      },
      modelIteration: {
        ok: iteration.ok === true,
        summary: iteration.summary,
        guardrails: iteration.guardrails,
        iterations: iteration.iterations,
        file: iteration.file
      },
      preview: {
        predictionCount,
        availableSnapshots: Number(preview.availableSnapshots ?? 0),
        tierCounts: {
          candidate: candidateCount,
          watch: watchCount,
          negative: negativeCount,
          marketClose: Number(preview.tierCounts?.market_close ?? 0)
        }
      }
    }
  };
}

fs.mkdirSync(path.dirname(OUTPUT_REPORT), { recursive: true });
fs.writeFileSync(OUTPUT_REPORT, `${JSON.stringify(output, null, 2)}\n`);

if (failures.length > 0) {
  console.error(`Promotion gate verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, OUTPUT_REPORT)}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  status: output.status,
  report: output.report,
  candidateCount: output.evidence.preview.tierCounts.candidate,
  watchCount: output.evidence.preview.tierCounts.watch,
  negativeCount: output.evidence.preview.tierCounts.negative,
  valueResearchRoi: output.evidence.historical.valueResearchRoi,
  adaptiveLift: output.evidence.historical.adaptiveLift
}, null, 2));
