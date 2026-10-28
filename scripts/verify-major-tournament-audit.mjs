#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const INTERNATIONAL_REPORT = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const OUTPUT_JSON = path.join(ROOT_DIR, 'reports/major-tournament-audit.json');
const OUTPUT_MD = path.join(ROOT_DIR, 'reports/major-tournament-audit.md');

const REQUIRED_COMPETITIONS = [
  ['FIFA World Cup', { minMatches: 300, minEditions: 6 }],
  ['UEFA Euro', { minMatches: 200, minEditions: 6 }],
  ['Copa America', { minMatches: 180, minEditions: 8 }]
];

const REQUIRED_STAGES = [
  'FIFA World Cup - Group stage',
  'FIFA World Cup - Knockout',
  'UEFA Euro - Group stage',
  'UEFA Euro - Knockout',
  'Copa America - Group stage',
  'Copa America - Knockout'
];

const COMPETITION_LABELS = {
  'FIFA World Cup': '世界杯',
  'UEFA Euro': '欧洲杯',
  'Copa America': '美洲杯'
};

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

function pct(value, precision = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(precision)}%` : '--';
}

function finiteMetric(metric) {
  return (
    metric &&
    Number.isInteger(metric.matches) &&
    metric.matches > 0 &&
    Number.isFinite(metric.log_loss) &&
    metric.log_loss >= 0 &&
    metric.log_loss <= 1.5 &&
    Number.isFinite(metric.accuracy) &&
    metric.accuracy >= 0 &&
    metric.accuracy <= 1 &&
    Number.isFinite(metric.calibration_error) &&
    metric.calibration_error >= 0 &&
    metric.calibration_error <= 0.5 &&
    Number.isFinite(metric.avg_confidence) &&
    metric.avg_confidence >= 0 &&
    metric.avg_confidence <= 1
  );
}

function compactBucket(name, bucket) {
  const primary = bucket?.primary ?? {};
  const elo = bucket?.elo ?? {};
  const blended = bucket?.blended ?? {};
  const goal = bucket?.goal ?? {};
  return {
    key: name,
    label: COMPETITION_LABELS[name] ?? name,
    matches: bucket?.matches ?? primary.matches ?? null,
    primary: {
      matches: primary.matches ?? null,
      accuracy: round(primary.accuracy),
      logLoss: round(primary.log_loss),
      calibrationError: round(primary.calibration_error),
      avgConfidence: round(primary.avg_confidence),
      drawProbability: round(primary.draw_probability),
      drawActual: round(primary.draw_actual)
    },
    elo: {
      accuracy: round(elo.accuracy),
      logLoss: round(elo.log_loss),
      calibrationError: round(elo.calibration_error)
    },
    blended: {
      accuracy: round(blended.accuracy),
      logLoss: round(blended.log_loss),
      calibrationError: round(blended.calibration_error)
    },
    goal: {
      accuracy: round(goal.accuracy),
      logLoss: round(goal.log_loss),
      calibrationError: round(goal.calibration_error)
    },
    primaryBlendShare: round(bucket?.primary_blend_share),
    avgGoalWeight: round(bucket?.avg_goal_weight)
  };
}

function competitionFromEdition(editionName) {
  if (editionName.startsWith('Copa América ')) return 'Copa America';
  return REQUIRED_COMPETITIONS.find(([name]) => editionName.startsWith(`${name} `))?.[0] ?? null;
}

function competitionFromStage(stageName) {
  return REQUIRED_COMPETITIONS.find(([name]) => stageName.startsWith(`${name} - `))?.[0] ?? null;
}

function stageLabel(stageName) {
  if (stageName.endsWith('Group stage')) return '小组赛';
  if (stageName.endsWith('Knockout')) return '淘汰赛';
  return stageName;
}

function renderMarkdown(report) {
  const lines = [
    '# 大赛走步审计',
    '',
    `生成时间: ${report.generatedAt}`,
    '',
    '该报告派生自国际赛 walk-forward 评估，集中核对世界杯、欧洲杯和美洲杯历史正赛样本。阶段拆分只用于验证，不作为预测引擎的赛果泄漏特征。',
    '',
    '## 摘要',
    '',
    '| 项目 | 数值 |',
    '| --- | ---: |',
    `| 大赛总样本 | ${report.summary.majorMatches} |`,
    `| 赛事届数 | ${report.summary.editionCount} |`,
    `| 阶段切片 | ${report.summary.stageCount} |`,
    `| 世界杯主模型 | ${pct(report.summary.worldCup?.primary?.accuracy)} / LL ${report.summary.worldCup?.primary?.logLoss ?? '--'} |`,
    '',
    '## 赛事层',
    '',
    '| 赛事 | 场次 | 主模型命中 | 主模型 LL | Elo LL | ECE | 平局预测/实际 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.competitions.map((row) =>
      `| ${row.label} | ${row.matches} | ${pct(row.primary.accuracy)} | ${row.primary.logLoss} | ${
        row.elo.logLoss
      } | ${pct(row.primary.calibrationError)} | ${pct(row.primary.drawProbability)} / ${pct(row.primary.drawActual)} |`
    ),
    '',
    '## 阶段层',
    '',
    '| 阶段 | 场次 | 命中率 | LL | ECE |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.stages.map((row) =>
      `| ${row.label} ${row.stageLabel} | ${row.matches} | ${pct(row.primary.accuracy)} | ${
        row.primary.logLoss
      } | ${pct(row.primary.calibrationError)} |`
    ),
    '',
    '## 守门条件',
    '',
    '| 条件 | 状态 |',
    '| --- | --- |',
    ...Object.entries(report.guardrails).map(([key, value]) => `| ${key} | ${value ? 'pass' : 'fail'} |`)
  ];
  return `${lines.join('\n')}\n`;
}

function unscoredWorldCupRowsAreQuarantined(sourceQuarantine, futureAudit) {
  const unscoredRows = Number(sourceQuarantine.unscored_2026_world_cup_rows ?? 0);
  const incompleteWorldCupRows = Number(sourceQuarantine.incomplete_rows_by_tournament?.['FIFA World Cup'] ?? 0);
  const ignoredRows = Number(futureAudit.ignored_rows ?? 0);
  return (
    sourceQuarantine.uses_international_results_2026_fixtures === false &&
    Number.isInteger(unscoredRows) &&
    unscoredRows >= 0 &&
    incompleteWorldCupRows === unscoredRows &&
    ignoredRows === unscoredRows
  );
}

check(fs.existsSync(INTERNATIONAL_REPORT), `missing international report: ${path.relative(ROOT_DIR, INTERNATIONAL_REPORT)}`);

let output = {
  ok: false,
  generatedAt: new Date().toISOString(),
  file: 'reports/major-tournament-audit.json',
  markdown: 'reports/major-tournament-audit.md',
  failures
};

if (fs.existsSync(INTERNATIONAL_REPORT)) {
  const international = readJson(INTERNATIONAL_REPORT);
  const byCompetition = new Map(international.evaluation?.by_competition ?? []);
  const majorFinals = new Map(international.evaluation?.major_finals ?? []);
  const majorStages = new Map(international.evaluation?.major_stages ?? []);
  const sourceQuarantine = international.source_quarantine ?? {};
  const futureAudit = international.future_fixture_audit ?? {};

  const competitions = REQUIRED_COMPETITIONS.map(([name]) => compactBucket(name, byCompetition.get(name)));
  const stages = REQUIRED_STAGES.map((name) => {
    const competition = competitionFromStage(name);
    return {
      ...compactBucket(name, majorStages.get(name)),
      competition,
      label: COMPETITION_LABELS[competition] ?? competition,
      stageLabel: stageLabel(name)
    };
  });
  const editions = [...majorFinals.entries()].map(([name, bucket]) => {
    const competition = competitionFromEdition(name);
    return {
      ...compactBucket(name, bucket),
      competition,
      label: `${COMPETITION_LABELS[competition] ?? competition} ${name.replace(`${competition} `, '')}`
    };
  });
  const editionsByCompetition = Object.fromEntries(
    REQUIRED_COMPETITIONS.map(([name]) => [
      name,
      editions.filter((edition) => edition.competition === name).length
    ])
  );
  const stageSumsByCompetition = Object.fromEntries(
    REQUIRED_COMPETITIONS.map(([name]) => [
      name,
      stages
        .filter((stage) => stage.competition === name)
        .reduce((sum, stage) => sum + Number(stage.matches ?? 0), 0)
    ])
  );
  const competitionMap = new Map(competitions.map((row) => [row.key, row]));
  const stageCountsReconcile = REQUIRED_COMPETITIONS.every(([name]) => {
    const competitionMatches = Number(competitionMap.get(name)?.matches ?? 0);
    return competitionMatches > 0 && stageSumsByCompetition[name] === competitionMatches;
  });
  const metricsFinite = [...competitions, ...stages, ...editions].every((row) => {
    const original =
      byCompetition.get(row.key) ?? majorStages.get(row.key) ?? majorFinals.get(row.key) ?? null;
    return finiteMetric(original?.primary) && finiteMetric(original?.elo) && finiteMetric(original?.blended);
  });
  const sampleSizesAdequate = REQUIRED_COMPETITIONS.every(([name, requirement]) => {
    const row = competitionMap.get(name);
    return Number(row?.matches ?? 0) >= requirement.minMatches;
  });
  const editionCoverage = REQUIRED_COMPETITIONS.every(
    ([name, requirement]) => Number(editionsByCompetition[name] ?? 0) >= requirement.minEditions
  );
  const worldCup = competitionMap.get('FIFA World Cup');
  const worldCupBlendAudited =
    Number(worldCup?.primaryBlendShare ?? 0) >= 0.95 &&
    Number(worldCup?.primary?.logLoss ?? Infinity) <= Number(worldCup?.elo?.logLoss ?? Infinity);

  const guardrails = {
    sourceReportPresent: true,
    requiredCompetitionsPresent: REQUIRED_COMPETITIONS.every(([name]) => byCompetition.has(name)),
    requiredStagesPresent: REQUIRED_STAGES.every((name) => majorStages.has(name)),
    stageCountsReconcile,
    sampleSizesAdequate,
    editionCoverage,
    metricsFinite,
    worldCupBlendAudited,
    futurePredictionsBlocked: Array.isArray(international.future_predictions) && international.future_predictions.length === 0,
    unscored2026RowsQuarantined: unscoredWorldCupRowsAreQuarantined(sourceQuarantine, futureAudit),
    officialScheduleParsed: futureAudit.status === 'official_schedule_parsed_predictions_blocked'
  };

  for (const [name] of REQUIRED_COMPETITIONS) {
    check(byCompetition.has(name), `missing competition audit: ${name}`);
  }
  for (const stage of REQUIRED_STAGES) {
    check(majorStages.has(stage), `missing major stage audit: ${stage}`);
  }
  check(guardrails.stageCountsReconcile, 'major stage counts must reconcile with competition totals');
  check(guardrails.sampleSizesAdequate, 'major competition sample sizes are below minimum');
  check(guardrails.editionCoverage, 'major edition coverage is below minimum');
  check(guardrails.metricsFinite, 'major tournament metrics must be finite and in sanity range');
  check(guardrails.worldCupBlendAudited, 'World Cup blend rule must be auditable and not worse than Elo LL');
  check(guardrails.futurePredictionsBlocked, 'international future predictions must remain blocked');
  check(guardrails.unscored2026RowsQuarantined, 'unscored 2026 World Cup rows must remain quarantined');
  check(guardrails.officialScheduleParsed, 'official 2026 schedule audit must be parsed and predictions blocked');

  output = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    file: 'reports/major-tournament-audit.json',
    markdown: 'reports/major-tournament-audit.md',
    source: {
      report: 'reports/international-model-evaluation.json',
      dataset: international.data_source?.name,
      raw: international.data_source?.raw_csv
    },
    method:
      '从国际赛 walk-forward 报告派生世界杯、欧洲杯和美洲杯正赛审计；每场比赛预测发生在对应赛果更新模型状态之前。',
    decision: {
      canSupport2026LogicReview: true,
      canPromoteStandaloneRecommendation: false,
      reason:
        '大赛样本能验证模型方向和阶段表现，但样本量与校准波动不足以单独生成投注推荐；仍需盘口、阵容、伤停、天气和新闻输入。'
    },
    summary: {
      majorMatches: competitions.reduce((sum, row) => sum + Number(row.matches ?? 0), 0),
      editionCount: editions.length,
      stageCount: stages.length,
      stageSumsByCompetition,
      editionsByCompetition,
      worldCup
    },
    guardrails,
    competitions,
    stages,
    editions,
    failures
  };
}

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(OUTPUT_MD, renderMarkdown(output));

if (failures.length > 0) {
  console.error(`Major tournament audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, OUTPUT_JSON)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: path.relative(ROOT_DIR, OUTPUT_JSON),
      majorMatches: output.summary.majorMatches,
      editionCount: output.summary.editionCount,
      stageCount: output.summary.stageCount,
      worldCup: output.summary.worldCup?.primary,
      guardrails: output.guardrails
    },
    null,
    2
  )
);
