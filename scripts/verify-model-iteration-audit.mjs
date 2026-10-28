#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const HISTORICAL_REPORT = path.join(ROOT_DIR, 'reports/historical-model-evaluation.json');
const INTERNATIONAL_REPORT = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const MAJOR_TOURNAMENT_AUDIT = path.join(ROOT_DIR, 'reports/major-tournament-audit.json');
const FRIENDLY_LEDGER = path.join(ROOT_DIR, 'reports/friendly-prediction-ledger.json');
const MODEL_CHANGE_IMPACT_AUDIT = path.join(ROOT_DIR, 'reports/model-change-impact-audit.json');
const PREVIEW_AUDIT = path.join(ROOT_DIR, 'reports/preview-decision-audit.json');
const PROMOTION_GATE = path.join(ROOT_DIR, 'reports/promotion-gate-audit.json');
const OUTPUT_JSON = path.join(ROOT_DIR, 'reports/model-iteration-audit.json');
const OUTPUT_MD = path.join(ROOT_DIR, 'reports/model-iteration-audit.md');

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function round(value, precision = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function pct(value, precision = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(precision)}%` : '--';
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function metricLift(baseline, candidate) {
  const base = Number(baseline);
  const next = Number(candidate);
  return Number.isFinite(base) && Number.isFinite(next) ? round(base - next, 4) : null;
}

function accuracyLift(candidate, baseline) {
  const next = Number(candidate);
  const base = Number(baseline);
  return Number.isFinite(base) && Number.isFinite(next) ? round(next - base, 4) : null;
}

function addIteration(rows, row) {
  rows.push({
    ...row,
    canDrive2026Recommendation: row.decision === 'accept_for_review' ? Boolean(row.canDrive2026Recommendation) : false
  });
}

function renderMarkdown(report) {
  const lines = [
    '# 模型迭代审计',
    '',
    `生成时间: ${report.generatedAt}`,
    '',
    '该报告把国际赛、五大联赛市场、友谊赛、大赛和 2026 预判审计放在同一个迭代账本里。目标是记录哪些改动可以继续复核，哪些只能观察，哪些必须阻断，避免把一次回测结果固定成结论。',
    '',
    '## 摘要',
    '',
    '| 状态 | 数量 |',
    '| --- | ---: |',
    `| 可进入复核 | ${report.summary.acceptForReview} |`,
    `| 仅观察 | ${report.summary.monitorOnly} |`,
    `| 阻断/拒绝 | ${report.summary.rejectOrBlock} |`,
    `| 可直接驱动 2026 推荐 | ${report.summary.canDrive2026Recommendation} |`,
    '',
    '## 迭代表',
    '',
    '| 项目 | 状态 | 证据 | 2026 影响 |',
    '| --- | --- | --- | --- |',
    ...report.iterations.map((row) => {
      const impact = row.canDrive2026Recommendation ? '可驱动推荐' : '不可单独驱动推荐';
      return `| ${row.label} | ${row.decision} | ${row.evidence} | ${impact} |`;
    }),
    '',
    '## 守门条件',
    '',
    '| 条件 | 状态 |',
    '| --- | --- |',
    ...Object.entries(report.guardrails).map(([key, value]) => `| ${key} | ${value ? 'pass' : 'fail'} |`)
  ];
  return `${lines.join('\n')}\n`;
}

for (const filePath of [
  HISTORICAL_REPORT,
  INTERNATIONAL_REPORT,
  MAJOR_TOURNAMENT_AUDIT,
  FRIENDLY_LEDGER,
  MODEL_CHANGE_IMPACT_AUDIT,
  PREVIEW_AUDIT,
  PROMOTION_GATE
]) {
  check(fs.existsSync(filePath), `missing required report: ${path.relative(ROOT_DIR, filePath)}`);
}

let output = {
  ok: false,
  generatedAt: new Date().toISOString(),
  file: 'reports/model-iteration-audit.json',
  markdown: 'reports/model-iteration-audit.md',
  failures
};

if (failures.length === 0) {
  const historical = readJson(HISTORICAL_REPORT);
  const international = readJson(INTERNATIONAL_REPORT);
  const majorTournament = readJson(MAJOR_TOURNAMENT_AUDIT);
  const friendly = readJson(FRIENDLY_LEDGER);
  const impact = readJson(MODEL_CHANGE_IMPACT_AUDIT);
  const preview = readJson(PREVIEW_AUDIT);
  const promotion = readJson(PROMOTION_GATE);

  const historicalOverall = historical.evaluation?.overall ?? {};
  const internationalOverall = international.evaluation?.overall ?? {};
  const historicalDecision = historicalOverall.decision_accuracy ?? {};
  const primaryMovement = historical.evaluation?.primary_market_movement ?? {};
  const valueResearch = historicalOverall.value_research ?? {};
  const worldCup = majorTournament.summary?.worldCup ?? {};
  const friendlyLatest = friendly.summary?.latest24 ?? {};
  const friendlyFull = friendly.summary?.fullWindow ?? {};
  const friendlyGate = friendly.summary?.promotionGate ?? {};
  const previewTierCounts = preview.tierCounts ?? {};
  const impactGuardrails = impact.guardrails ?? {};

  const marketLogLoss = Number(historicalOverall.market_only?.log_loss);
  const blendedLogLoss = Number(historicalOverall.blended?.log_loss);
  const modelLogLoss = Number(historicalOverall.model_only?.log_loss);
  const marketAccuracy = Number(historicalDecision.market?.accuracy);
  const adaptiveAccuracy = Number(historicalDecision.adaptive?.accuracy);
  const movementAccuracy = Number(historicalDecision.movement_adaptive?.accuracy);
  const internationalPrimaryLogLoss = Number(internationalOverall.primary?.log_loss);
  const internationalEloLogLoss = Number(internationalOverall.elo?.log_loss);
  const internationalGoalLogLoss = Number(internationalOverall.goal?.log_loss);
  const worldCupPrimaryLogLoss = Number(worldCup.primary?.logLoss);
  const worldCupEloLogLoss = Number(worldCup.elo?.logLoss);
  const worldCupPrimaryAccuracy = Number(worldCup.primary?.accuracy);
  const worldCupEloAccuracy = Number(worldCup.elo?.accuracy);
  const friendlyAccuracyDelta = Number(friendlyLatest.accuracy) - Number(friendlyFull.accuracy);

  const iterations = [];

  addIteration(iterations, {
    key: 'international_primary_selector',
    label: '国际赛主选择器',
    decision: metricLift(internationalEloLogLoss, internationalPrimaryLogLoss) >= 0 ? 'monitor_only' : 'reject_or_block',
    evidence: `主 LL ${round(internationalPrimaryLogLoss)} vs Elo LL ${round(internationalEloLogLoss)}，LL 改善 ${round(
      metricLift(internationalEloLogLoss, internationalPrimaryLogLoss)
    )}`,
    reason: '整体国际赛提升很薄，只能作为在线选择器继续观察，不能单独决定推荐。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'world_cup_blend_rule',
    label: '世界杯融合层',
    decision:
      metricLift(worldCupEloLogLoss, worldCupPrimaryLogLoss) > 0 && accuracyLift(worldCupPrimaryAccuracy, worldCupEloAccuracy) >= 0
        ? 'accept_for_review'
        : 'monitor_only',
    evidence: `世界杯 LL ${round(worldCupPrimaryLogLoss)} vs Elo ${round(worldCupEloLogLoss)}，准确率 ${pct(
      worldCupPrimaryAccuracy,
      1
    )} vs ${pct(worldCupEloAccuracy, 1)}`,
    reason: '只允许进入 2026 逻辑复核；仍需盘口和阵容输入才能转成预判推荐。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'international_goal_only',
    label: '国家队进球模型单独层',
    decision: internationalGoalLogLoss > internationalEloLogLoss ? 'reject_or_block' : 'monitor_only',
    evidence: `进球模型 LL ${round(internationalGoalLogLoss)} vs Elo LL ${round(internationalEloLogLoss)}`,
    reason: '进球模型不能单独替代 Elo/融合层。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'club_market_prior',
    label: '五大联赛市场先验',
    decision: marketLogLoss <= blendedLogLoss && modelLogLoss > marketLogLoss ? 'accept_for_review' : 'monitor_only',
    evidence: `市场 LL ${round(marketLogLoss)}，混合 LL ${round(blendedLogLoss)}，模型 LL ${round(modelLogLoss)}`,
    reason: '市场概率必须作为强先验；本地模型不能强行覆盖盘口。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'adaptive_picker',
    label: '自适应择边',
    decision: accuracyLift(adaptiveAccuracy, marketAccuracy) > 0 && accuracyLift(adaptiveAccuracy, marketAccuracy) < 0.01
      ? 'monitor_only'
      : 'reject_or_block',
    evidence: `市场 ${pct(marketAccuracy, 2)}，自适应 ${pct(adaptiveAccuracy, 2)}，提升 ${pct(
      accuracyLift(adaptiveAccuracy, marketAccuracy),
      2
    )}`,
    reason: '提升太薄，只能作为复核信号，不能成为固定推单规则。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'movement_aware_picker',
    label: '盘口移动择边',
    decision: accuracyLift(movementAccuracy, marketAccuracy) > 0 && accuracyLift(movementAccuracy, marketAccuracy) < 0.01
      ? 'monitor_only'
      : 'reject_or_block',
    evidence: `市场 ${pct(marketAccuracy, 2)}，移动择边 ${pct(movementAccuracy, 2)}，开盘/收盘样本 ${
      primaryMovement.rows ?? '--'
    }`,
    reason: '盘口移动可以守门和解释风险，但不能静默改变推荐层级。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'value_threshold_research',
    label: '价值阈值研究',
    decision: Number(valueResearch.paper_roi) < 0 ? 'reject_or_block' : 'monitor_only',
    evidence: `纸面 ROI ${pct(valueResearch.paper_roi, 2)}，候选 ${valueResearch.candidates ?? '--'}`,
    reason: '真实走步 ROI 为负，禁止将价值阈值晋级为推荐规则。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'friendly_short_window',
    label: '世界杯前友谊赛短窗',
    decision: ['hold', 'eligible_for_model_review'].includes(friendlyGate.decision) ? 'monitor_only' : 'reject_or_block',
    evidence: `最新 24 场 ${friendlyLatest.hits}/${friendlyLatest.matches}，全窗口 ${friendlyFull.matches} 场，准确率差 ${pct(
      friendlyAccuracyDelta,
      2
    )}`,
    reason: '友谊赛信号最多进入模型复核；没有赔率、阵容和新闻输入时不能直接驱动推荐。',
    canDrive2026Recommendation: false
  });

  addIteration(iterations, {
    key: 'provider_weight_and_movement_impact',
    label: '机构权重和盘口移动修正',
    decision: impact.ok && impactGuardrails.noPickChanges && impactGuardrails.noTierChanges ? 'monitor_only' : 'reject_or_block',
    evidence: `选项变化 ${
      impact.comparisons?.reduce((sum, row) => sum + Number(row.pickChanges ?? 0), 0) ?? '--'
    }，分层变化 ${impact.comparisons?.reduce((sum, row) => sum + Number(row.tierChanges ?? 0), 0) ?? '--'}`,
    reason: '只作为弱修正和审计解释，不允许强行制造推荐。',
    canDrive2026Recommendation: false
  });

  const accepted = iterations.filter((row) => row.decision === 'accept_for_review');
  const monitor = iterations.filter((row) => row.decision === 'monitor_only');
  const rejected = iterations.filter((row) => row.decision === 'reject_or_block');
  const canDriveRecommendation = iterations.filter((row) => row.canDrive2026Recommendation);

  const guardrails = {
    reportsPresent: true,
    finiteCoreMetrics: [
      marketLogLoss,
      blendedLogLoss,
      modelLogLoss,
      marketAccuracy,
      adaptiveAccuracy,
      movementAccuracy,
      internationalPrimaryLogLoss,
      internationalEloLogLoss,
      internationalGoalLogLoss,
      worldCupPrimaryLogLoss,
      worldCupEloLogLoss
    ].every(finite),
    marketPriorRequired: marketLogLoss <= blendedLogLoss && modelLogLoss > marketLogLoss,
    valueResearchBlocksPromotion: Number(valueResearch.paper_roi) < 0,
    adaptiveLiftThin:
      accuracyLift(adaptiveAccuracy, marketAccuracy) >= 0 && accuracyLift(adaptiveAccuracy, marketAccuracy) < 0.01,
    movementLiftThin:
      accuracyLift(movementAccuracy, marketAccuracy) >= 0 && accuracyLift(movementAccuracy, marketAccuracy) < 0.01,
    worldCupBlendOnlyForReview: accepted.some((row) => row.key === 'world_cup_blend_rule') && canDriveRecommendation.length === 0,
    friendlySignalMarketBlocked:
      ['hold', 'eligible_for_model_review'].includes(friendlyGate.decision) &&
      friendly.summary?.promotionGate?.canDriveMarketRecommendation === false,
    providerMovementBounded: impact.ok === true && impactGuardrails.noPickChanges === true && impactGuardrails.noTierChanges === true,
    previewCandidatesRemainGated:
      Number(previewTierCounts.candidate ?? 0) >= 0 &&
      preview.guardrails?.noStandaloneBettingAdvice === true &&
      preview.guardrails?.parlaysBlockedUntilFullInputs === true,
    promotionStillPreviewOnly:
      ['preview_only_no_promotion', 'promotion_gate_failed'].includes(promotion.status) &&
      promotion.checks?.some((row) => row.key === 'no_standalone_betting_advice') !== false &&
      promotion.checks?.some((row) => row.key === 'parlays_blocked_until_full_inputs') !== false,
    noIterationDirectlyDrivesRecommendation: canDriveRecommendation.length === 0
  };

  for (const [key, value] of Object.entries(guardrails)) {
    check(value === true, `model iteration guardrail failed: ${key}`);
  }

  output = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    file: 'reports/model-iteration-audit.json',
    markdown: 'reports/model-iteration-audit.md',
    method:
      '汇总已生成的 walk-forward、消融、盘口、友谊赛和 2026 预判报告；每个模型层必须有赛前证据才能进入复核，且不能单独驱动推荐。',
    summary: {
      totalIterations: iterations.length,
      acceptForReview: accepted.length,
      monitorOnly: monitor.length,
      rejectOrBlock: rejected.length,
      canDrive2026Recommendation: canDriveRecommendation.length
    },
    guardrails,
    iterations,
    sourceReports: [
      'reports/historical-model-evaluation.json',
      'reports/international-model-evaluation.json',
      'reports/major-tournament-audit.json',
      'reports/friendly-prediction-ledger.json',
      'reports/model-change-impact-audit.json',
      'reports/preview-decision-audit.json',
      'reports/promotion-gate-audit.json'
    ],
    failures
  };
}

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(OUTPUT_MD, renderMarkdown(output));

if (failures.length > 0) {
  console.error(`Model iteration audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, OUTPUT_JSON)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: path.relative(ROOT_DIR, OUTPUT_JSON),
      summary: output.summary,
      guardrails: output.guardrails
    },
    null,
    2
  )
);
