import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_JSON = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const OFFICIAL_SCHEDULE_JSON = path.join(ROOT_DIR, 'data/research/worldcup-2026/official-schedule.json');
const RESULTS_CSV = path.join(ROOT_DIR, 'data/research/international-results/results.csv');

const DATA_SOURCE_PAGE = 'https://github.com/martj42/international_results';
const DATA_RAW_CSV = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const OFFICIAL_PAGE =
  'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums';
const OFFICIAL_RELEASE =
  'https://inside.fifa.com/organisation/media-releases/updated-world-cup-2026-match-schedule-venues-kick-off-times-104-matches';
const OFFICIAL_PDF =
  'https://digitalhub.fifa.com/asset/4b5d4417-3343-4732-9cdf-14b6662af407/FWC26-Match-Schedule_English.pdf';

const EXPECTED_STAGE_COUNTS = {
  group_stage: 72,
  round_of_32: 16,
  round_of_16: 8,
  quarter_final: 4,
  semi_final: 2,
  third_place: 1,
  final: 1,
};

const REQUIRED_COMPETITION_GROUPS = [
  'FIFA World Cup',
  'UEFA Euro',
  'Copa America',
  'Friendly',
];

const REQUIRED_MAJOR_STAGES = [
  'FIFA World Cup - Group stage',
  'FIFA World Cup - Knockout',
  'UEFA Euro - Group stage',
  'UEFA Euro - Knockout',
  'Copa America - Group stage',
  'Copa America - Knockout',
];

const WORLD_CUP_FRIENDLY_WINDOWS = new Map([
  ['2002 World Cup', { start: '2002-01-01', end: '2002-05-30', opener: '2002-05-31' }],
  ['2006 World Cup', { start: '2006-01-01', end: '2006-06-08', opener: '2006-06-09' }],
  ['2010 World Cup', { start: '2010-01-01', end: '2010-06-10', opener: '2010-06-11' }],
  ['2014 World Cup', { start: '2014-01-01', end: '2014-06-11', opener: '2014-06-12' }],
  ['2018 World Cup', { start: '2018-01-01', end: '2018-06-13', opener: '2018-06-14' }],
  ['2022 World Cup', { start: '2022-01-01', end: '2022-11-19', opener: '2022-11-20' }],
  ['2026 World Cup', { start: '2026-01-01', end: '2026-06-10', opener: '2026-06-11' }],
]);

const errors = [];

function fail(message) {
  errors.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function same(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function close(actual, expected, label, tolerance = 0.0005) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    fail(`${label}: expected ${expected} +/- ${tolerance}, got ${actual}`);
  }
}

function inUnitInterval(value, label) {
  check(Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be in [0, 1], got ${value}`);
}

function finiteNumber(value, label) {
  check(Number.isFinite(value), `${label} must be finite, got ${value}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function countCsvDataRows(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const rows = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  return Math.max(0, rows.length - 1);
}

function asMap(entries, label) {
  check(Array.isArray(entries), `${label} must be an array of [name, bucket] entries`);
  return new Map(Array.isArray(entries) ? entries : []);
}

function verifyMetric(metric, label, expectedMatches = null) {
  check(metric && typeof metric === 'object', `${label} metric is missing`);
  if (!metric || typeof metric !== 'object') return;

  if (expectedMatches !== null) same(metric.matches, expectedMatches, `${label}.matches`);
  check(Number.isInteger(metric.matches) && metric.matches >= 0, `${label}.matches must be a non-negative integer`);
  finiteNumber(metric.log_loss, `${label}.log_loss`);
  check(metric.log_loss >= 0 && metric.log_loss <= 3.5, `${label}.log_loss is out of sanity range`);
  inUnitInterval(metric.accuracy, `${label}.accuracy`);
  check(Number.isFinite(metric.brier) && metric.brier >= 0 && metric.brier <= 2, `${label}.brier is out of range`);
  inUnitInterval(metric.avg_confidence, `${label}.avg_confidence`);
  check(
    Number.isFinite(metric.calibration_gap) && metric.calibration_gap >= -1 && metric.calibration_gap <= 1,
    `${label}.calibration_gap is out of range`,
  );
  inUnitInterval(metric.calibration_error, `${label}.calibration_error`);
  check(Array.isArray(metric.reliability_bins), `${label}.reliability_bins must be an array`);
  if (Array.isArray(metric.reliability_bins)) {
    check(metric.reliability_bins.length > 0, `${label}.reliability_bins must not be empty`);
    const binTotal = metric.reliability_bins.reduce((sum, bin) => sum + Number(bin.count ?? 0), 0);
    same(binTotal, metric.matches, `${label}.reliability_bins count total`);
    for (const [index, bin] of metric.reliability_bins.entries()) {
      const binLabel = `${label}.reliability_bins[${index}]`;
      inUnitInterval(bin.lower, `${binLabel}.lower`);
      inUnitInterval(bin.upper, `${binLabel}.upper`);
      check(bin.upper > bin.lower, `${binLabel}.upper must be greater than lower`);
      check(Number.isInteger(bin.count) && bin.count > 0, `${binLabel}.count must be positive`);
      inUnitInterval(bin.share, `${binLabel}.share`);
      inUnitInterval(bin.avg_confidence, `${binLabel}.avg_confidence`);
      inUnitInterval(bin.accuracy, `${binLabel}.accuracy`);
      check(Number.isFinite(bin.gap) && bin.gap >= -1 && bin.gap <= 1, `${binLabel}.gap is out of range`);
    }
  }
  inUnitInterval(metric.draw_probability, `${label}.draw_probability`);
  inUnitInterval(metric.draw_actual, `${label}.draw_actual`);
}

function verifyBucket(bucket, label) {
  check(bucket && typeof bucket === 'object', `${label} bucket is missing`);
  if (!bucket || typeof bucket !== 'object') return;

  check(Number.isInteger(bucket.matches) && bucket.matches > 0, `${label}.matches must be positive`);
  for (const layer of ['primary', 'raw_blend', 'global_draw_blend', 'blended', 'elo', 'goal']) {
    verifyMetric(bucket[layer], `${label}.${layer}`, bucket.matches);
  }
  inUnitInterval(bucket.avg_goal_weight, `${label}.avg_goal_weight`);
  inUnitInterval(bucket.primary_blend_share, `${label}.primary_blend_share`);
}

function verifyProbabilityObject(probabilities, label) {
  check(probabilities && typeof probabilities === 'object', `${label} probabilities are missing`);
  if (!probabilities || typeof probabilities !== 'object') return;

  inUnitInterval(probabilities.home, `${label}.home`);
  inUnitInterval(probabilities.draw, `${label}.draw`);
  inUnitInterval(probabilities.away, `${label}.away`);
  close(probabilities.home + probabilities.draw + probabilities.away, 1, `${label} probability sum`, 0.0025);
}

function parseScore(score, label) {
  const match = String(score ?? '').match(/^(\d+)-(\d+)$/);
  check(Boolean(match), `${label}.score must be n-n, got ${JSON.stringify(score)}`);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function outcomeFromScore(score, label) {
  const parsed = parseScore(score, label);
  if (!parsed) return null;
  const [home, away] = parsed;
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

function verifyOutcomeRow(row, label) {
  check(row && typeof row === 'object', `${label} row is missing`);
  if (!row || typeof row !== 'object') return;

  check(/^\d{4}-\d{2}-\d{2}$/.test(row.date), `${label}.date must be YYYY-MM-DD`);
  check(['H', 'D', 'A'].includes(row.actual), `${label}.actual must be H/D/A`);
  check(['H', 'D', 'A'].includes(row.pick), `${label}.pick must be H/D/A`);
  same(outcomeFromScore(row.score, label), row.actual, `${label}.actual from score`);
  if ('correct' in row) same(row.correct, row.pick === row.actual, `${label}.correct`);
}

function verifyFriendlyAudit(audit, label, { requireWindow = true } = {}) {
  check(audit && typeof audit === 'object', `${label} is missing`);
  if (!audit || typeof audit !== 'object') return;

  same(audit.tournament, 'Friendly', `${label}.tournament`);
  same(audit.selection, 'latest_completed_matches_in_window', `${label}.selection`);
  same(audit.duplicate_guard, 'date_team_score_tournament_neutral', `${label}.duplicate_guard`);
  check(Number.isInteger(audit.requested_limit) && audit.requested_limit > 0, `${label}.requested_limit must be positive`);
  check(Number.isInteger(audit.available_matches), `${label}.available_matches must be an integer`);
  check(Number.isInteger(audit.evaluated_matches), `${label}.evaluated_matches must be an integer`);
  check(audit.available_matches >= audit.evaluated_matches, `${label}.available_matches must cover selected rows`);
  same(audit.evaluated_matches, Math.min(audit.requested_limit, audit.available_matches), `${label}.selected row count rule`);

  verifyMetric(audit.primary, `${label}.primary`, audit.evaluated_matches);
  verifyMetric(audit.elo, `${label}.elo`, audit.evaluated_matches);
  verifyMetric(audit.blended, `${label}.blended`, audit.evaluated_matches);

  const rows = Array.isArray(audit.matches) ? audit.matches : [];
  same(rows.length, audit.evaluated_matches, `${label}.matches.length`);
  let previousDate = '';
  rows.forEach((row, index) => {
    const rowLabel = `${label}.matches[${index}]`;
    verifyOutcomeRow(row, rowLabel);
    same(row.tournament, 'Friendly', `${rowLabel}.tournament`);
    check(row.date >= audit.start_date && row.date <= audit.end_date, `${rowLabel}.date must be inside audit window`);
    check(row.date >= previousDate, `${rowLabel}.date must be sorted ascending`);
    previousDate = row.date;
    verifyProbabilityObject(row.primary_probabilities, `${rowLabel}.primary_probabilities`);
    verifyProbabilityObject(row.elo_probabilities, `${rowLabel}.elo_probabilities`);
    verifyProbabilityObject(row.blended_probabilities, `${rowLabel}.blended_probabilities`);
  });

  const fullWindow = audit.full_window;
  check(fullWindow && typeof fullWindow === 'object', `${label}.full_window is missing`);
  if (fullWindow && typeof fullWindow === 'object') {
    same(fullWindow.selection, 'all_completed_matches_in_window', `${label}.full_window.selection`);
    same(fullWindow.evaluated_matches, audit.available_matches, `${label}.full_window.evaluated_matches`);
    verifyMetric(fullWindow.primary, `${label}.full_window.primary`, fullWindow.evaluated_matches);
    verifyMetric(fullWindow.elo, `${label}.full_window.elo`, fullWindow.evaluated_matches);
    verifyMetric(fullWindow.blended, `${label}.full_window.blended`, fullWindow.evaluated_matches);
  }

  if (requireWindow) {
    const window = WORLD_CUP_FRIENDLY_WINDOWS.get(label);
    if (window) {
      same(audit.start_date, window.start, `${label}.start_date`);
      same(audit.end_date, window.end, `${label}.end_date`);
      same(audit.tournament_start_date, window.opener, `${label}.tournament_start_date`);
      check(audit.end_date < audit.tournament_start_date, `${label}.end_date must be before opener`);
    }
  }
}

function sameSelectedFriendlyRows(left, right) {
  const leftRows = left?.matches ?? [];
  const rightRows = right?.matches ?? [];
  if (leftRows.length !== rightRows.length) return false;
  return leftRows.every((row, index) => {
    const other = rightRows[index];
    return (
      row.date === other?.date &&
      row.home_team === other?.home_team &&
      row.away_team === other?.away_team &&
      row.score === other?.score &&
      row.pick === other?.pick &&
      row.actual === other?.actual
    );
  });
}

function verifyReportScope(report, sourceRows) {
  same(report.data_source?.name, 'martj42/international_results', 'data_source.name');
  same(report.data_source?.url, DATA_SOURCE_PAGE, 'data_source.url');
  same(report.data_source?.raw_csv, DATA_RAW_CSV, 'data_source.raw_csv');
  same(report.data_source?.license, 'CC0-1.0', 'data_source.license');
  same(path.resolve(report.data_source?.cached_file ?? ''), RESULTS_CSV, 'data_source.cached_file');
  same(report.source_rows, sourceRows, 'source_rows vs cached CSV');
  same(report.warmup_start_date, '1990-01-01', 'warmup_start_date');
  same(report.eval_start_date, '2002-01-01', 'eval_start_date');

  check(report.source_rows > 40000, 'source_rows should be a real historical result dataset');
  same(report.usable_rows + report.duplicate_rows_removed, report.source_rows, 'duplicate accounting');
  same(report.completed_rows + report.incomplete_rows, report.usable_rows, 'completed/incomplete accounting');
  check(report.warmup_matches > 0, 'warmup_matches must be positive');
  check(report.evaluated_matches > 20000, 'evaluated_matches should cover the walk-forward sample');
  check(report.completed_rows > report.warmup_matches + report.evaluated_matches, 'pre-warmup completed rows should remain outside modeling');

  const generatedDate = String(report.generated_at ?? '').slice(0, 10);
  check(/^\d{4}-\d{2}-\d{2}$/.test(generatedDate), 'generated_at must contain an ISO date');
  check(report.latest_completed_date <= generatedDate, 'latest_completed_date cannot be after report generation date');
  check(report.latest_raw_date >= report.latest_completed_date, 'latest_raw_date must be at least latest_completed_date');
}

function verifySourceQuarantine(report) {
  const quarantine = report.source_quarantine ?? {};
  check(quarantine && typeof quarantine === 'object', 'source_quarantine is missing');
  if (!quarantine || typeof quarantine !== 'object') return;

  same(quarantine.source_dataset, 'martj42/international_results', 'source_quarantine.source_dataset');
  same(quarantine.source_url, DATA_SOURCE_PAGE, 'source_quarantine.source_url');
  same(quarantine.raw_csv, DATA_RAW_CSV, 'source_quarantine.raw_csv');
  same(quarantine.trusted_2026_fixture_source, OFFICIAL_PAGE, 'source_quarantine.trusted_2026_fixture_source');
  same(
    quarantine.trusted_2026_fixture_file,
    'data/research/worldcup-2026/official-schedule.json',
    'source_quarantine.trusted_2026_fixture_file',
  );
  same(
    quarantine.uses_international_results_2026_fixtures,
    false,
    'source_quarantine.uses_international_results_2026_fixtures',
  );
  same(quarantine.training_and_evaluation_policy, 'completed_rows_only', 'source_quarantine.training_and_evaluation_policy');
  check(
    String(quarantine.rule ?? '').includes('quarantined') &&
      String(quarantine.rule ?? '').includes('future prediction output') &&
      String(quarantine.rule ?? '').includes('official 2026 FIFA fixture adapter'),
    'source_quarantine.rule must explain missing-score quarantine and official 2026 schedule policy',
  );

  same(quarantine.raw_rows, report.source_rows, 'source_quarantine.raw_rows');
  same(quarantine.usable_rows, report.usable_rows, 'source_quarantine.usable_rows');
  same(quarantine.duplicate_rows_removed, report.duplicate_rows_removed, 'source_quarantine.duplicate_rows_removed');
  same(quarantine.completed_rows, report.completed_rows, 'source_quarantine.completed_rows');
  same(quarantine.incomplete_rows, report.incomplete_rows, 'source_quarantine.incomplete_rows');

  const byTournament = quarantine.incomplete_rows_by_tournament ?? {};
  check(byTournament && typeof byTournament === 'object', 'source_quarantine.incomplete_rows_by_tournament is missing');
  const quarantinedTotal = Object.values(byTournament).reduce((sum, count) => sum + Number(count ?? 0), 0);
  same(quarantinedTotal, report.incomplete_rows, 'source_quarantine tournament count total');
  check(
    Number.isInteger(quarantine.unscored_2026_world_cup_rows) &&
      quarantine.unscored_2026_world_cup_rows > 0,
    'source_quarantine.unscored_2026_world_cup_rows must expose cached unscored World Cup rows',
  );
  same(
    byTournament['FIFA World Cup'],
    quarantine.unscored_2026_world_cup_rows,
    'source_quarantine FIFA World Cup missing-score count',
  );

  const span = quarantine.unscored_2026_world_cup_date_span;
  check(Array.isArray(span) && span.length === 2, 'source_quarantine.unscored_2026_world_cup_date_span must be [start, end]');
  if (Array.isArray(span) && span.length === 2) {
    check(span[0] >= '2026-06-11' && span[0] <= '2026-07-19', 'source_quarantine unscored span start must be inside 2026 World Cup dates');
    check(span[1] >= span[0] && span[1] <= '2026-07-19', 'source_quarantine unscored span end must be inside 2026 World Cup dates');
  }

  const samples = Array.isArray(quarantine.sample_unscored_2026_world_cup_rows)
    ? quarantine.sample_unscored_2026_world_cup_rows
    : [];
  check(samples.length > 0, 'source_quarantine sample_unscored_2026_world_cup_rows must not be empty');
  samples.forEach((row, index) => {
    const label = `source_quarantine.sample_unscored_2026_world_cup_rows[${index}]`;
    check(/^\d{4}-\d{2}-\d{2}$/.test(row.date), `${label}.date must be YYYY-MM-DD`);
    check(row.date >= '2026-06-11' && row.date <= '2026-07-19', `${label}.date must be inside 2026 World Cup dates`);
    same(row.tournament, 'FIFA World Cup', `${label}.tournament`);
    same(row.score_status, 'missing_score', `${label}.score_status`);
    check(Boolean(row.home_team) && Boolean(row.away_team), `${label} must contain team names`);
  });
}

function verifyEvaluation(report) {
  const evaluation = report.evaluation ?? {};
  verifyBucket(evaluation.overall, 'evaluation.overall');
  same(evaluation.overall?.matches, report.evaluated_matches, 'overall matches vs report.evaluated_matches');

  const byCompetition = asMap(evaluation.by_competition, 'evaluation.by_competition');
  for (const name of REQUIRED_COMPETITION_GROUPS) {
    check(byCompetition.has(name), `missing competition bucket: ${name}`);
  }
  let competitionTotal = 0;
  for (const [name, bucket] of byCompetition.entries()) {
    verifyBucket(bucket, `competition.${name}`);
    competitionTotal += bucket.matches;
  }
  same(competitionTotal, evaluation.overall?.matches, 'competition match total');

  const majorStages = asMap(evaluation.major_stages, 'evaluation.major_stages');
  for (const name of REQUIRED_MAJOR_STAGES) {
    check(majorStages.has(name), `missing major stage bucket: ${name}`);
  }
  for (const [name, bucket] of majorStages.entries()) {
    verifyBucket(bucket, `major_stage.${name}`);
  }

  for (const tournament of ['FIFA World Cup', 'UEFA Euro', 'Copa America']) {
    const competition = byCompetition.get(tournament);
    const group = majorStages.get(`${tournament} - Group stage`);
    const knockout = majorStages.get(`${tournament} - Knockout`);
    same((group?.matches ?? 0) + (knockout?.matches ?? 0), competition?.matches, `${tournament} stage total`);
  }
}

function verifySamplePredictions(report) {
  const rows = Array.isArray(report.sample_predictions) ? report.sample_predictions : [];
  check(rows.length > 0, 'sample_predictions must not be empty');
  rows.forEach((row, index) => {
    verifyOutcomeRow(row, `sample_predictions[${index}]`);
    verifyProbabilityObject(row.probabilities, `sample_predictions[${index}].probabilities`);
    check(
      ['FIFA World Cup', 'UEFA Euro', 'Copa América', 'Copa America'].includes(row.tournament),
      `sample_predictions[${index}].tournament should be a major finals sample`,
    );
  });
}

function verifyFriendlyWindows(report) {
  const audit = report.friendly_audit;
  verifyFriendlyAudit(audit, 'friendly_audit', { requireWindow: false });
  same(audit?.start_date, '2026-01-01', 'friendly_audit.start_date');
  same(audit?.end_date, '2026-06-10', 'friendly_audit.end_date');
  same(audit?.requested_limit, 24, 'friendly_audit.requested_limit');
  check(audit?.available_matches >= 100, 'friendly_audit should include a substantial 2026 all-window sample');
  check(audit?.evaluated_matches === 24, 'friendly_audit should select the latest 24 completed rows');

  const audits = Array.isArray(report.pre_world_cup_friendly_audits) ? report.pre_world_cup_friendly_audits : [];
  same(audits.length, WORLD_CUP_FRIENDLY_WINDOWS.size, 'pre_world_cup_friendly_audits.length');

  const byEdition = new Map();
  audits.forEach((cycleAudit) => {
    byEdition.set(cycleAudit.edition, cycleAudit);
    verifyFriendlyAudit(cycleAudit, cycleAudit.edition);
    same(cycleAudit.window_rule, 'calendar_year_to_day_before_opener_latest_completed_matches', `${cycleAudit.edition}.window_rule`);
  });

  for (const edition of WORLD_CUP_FRIENDLY_WINDOWS.keys()) {
    check(byEdition.has(edition), `missing pre-World-Cup friendly audit: ${edition}`);
  }

  check(
    sameSelectedFriendlyRows(audit, byEdition.get('2026 World Cup')),
    'friendly_audit must match the 2026 row in pre_world_cup_friendly_audits',
  );

  const stability = report.friendly_window_stability;
  check(stability && typeof stability === 'object', 'friendly_window_stability is missing');
  if (!stability || typeof stability !== 'object') return;

  same(stability.latest_24?.prior_cycle_count, 6, 'friendly_window_stability.latest_24.prior_cycle_count');
  same(stability.full_window?.prior_cycle_count, 6, 'friendly_window_stability.full_window.prior_cycle_count');
  same(stability.latest_24?.current_matches, audit.evaluated_matches, 'stability latest current_matches');
  same(stability.full_window?.current_matches, audit.full_window?.evaluated_matches, 'stability full current_matches');
  same(stability.latest_vs_full_2026?.latest_matches, audit.evaluated_matches, 'stability latest_vs_full latest_matches');
  same(stability.latest_vs_full_2026?.full_window_matches, audit.full_window?.evaluated_matches, 'stability latest_vs_full full_window_matches');
  inUnitInterval(stability.latest_24?.prior_accuracy_mean, 'stability.latest_24.prior_accuracy_mean');
  inUnitInterval(stability.full_window?.prior_accuracy_mean, 'stability.full_window.prior_accuracy_mean');
  finiteNumber(stability.latest_24?.current_log_loss, 'stability.latest_24.current_log_loss');
  finiteNumber(stability.full_window?.current_log_loss, 'stability.full_window.current_log_loss');
  check(
    Math.abs(stability.latest_vs_full_2026?.accuracy_delta ?? 0) > 0.02,
    'latest-vs-full comparison should expose short-window sensitivity instead of hiding it',
  );

  const gate = stability.promotion_gate;
  check(gate && typeof gate === 'object', 'friendly_window_stability.promotion_gate is missing');
  if (!gate || typeof gate !== 'object') return;

  same(gate.signal, 'pre_world_cup_friendlies', 'friendly promotion gate signal');
  check(
    ['hold', 'eligible_for_model_review'].includes(gate.decision),
    `friendly promotion gate decision: expected hold or eligible_for_model_review, got ${JSON.stringify(gate.decision)}`,
  );
  same(
    gate.promote_2026_friendly_signal,
    gate.decision === 'eligible_for_model_review',
    'friendly promotion gate promote_2026_friendly_signal',
  );
  same(gate.can_drive_market_recommendation, false, 'friendly promotion gate can_drive_market_recommendation');
  check(
    typeof gate.market_recommendation_dependency === 'string' &&
      gate.market_recommendation_dependency.includes('odds') &&
      gate.market_recommendation_dependency.includes('lineups'),
    'friendly promotion gate must state market recommendation data dependencies',
  );
  const gateChecks = Array.isArray(gate.checks) ? gate.checks : [];
  check(gateChecks.length >= 6, 'friendly promotion gate checks missing');
  const checks = new Map(gateChecks.map((item) => [item.key, item]));
  for (const key of [
    'latest_prior_cycles',
    'all_window_prior_cycles',
    'all_window_sample_size',
    'latest_vs_all_accuracy_delta',
    'latest_accuracy_z',
    'all_window_accuracy_prior_range',
  ]) {
    check(checks.has(key), `friendly promotion gate missing check: ${key}`);
  }
  const failedChecks = [...checks.values()].filter((item) => item.passed === false).map((item) => item.key);
  if (gate.decision === 'hold') {
    check(failedChecks.length > 0, 'friendly promotion gate hold decision must have failed checks');
    check(
      Array.isArray(gate.blocked_reasons) && failedChecks.every((key) => gate.blocked_reasons.includes(key)),
      'friendly promotion gate blocked_reasons must include failed checks',
    );
  } else {
    check(failedChecks.length === 0, 'friendly promotion gate review eligibility requires all checks to pass');
    check(Array.isArray(gate.blocked_reasons) && gate.blocked_reasons.length === 0, 'eligible friendly gate must not carry blocked reasons');
  }
  check(
    typeof gate.recommendation === 'string' &&
      gate.recommendation.includes('friendly signal') &&
      gate.recommendation.includes('recommendations'),
    'friendly promotion gate recommendation must describe model-review and market-recommendation limits',
  );
}

function verifyFutureGuard(report, officialSchedule) {
  const futurePredictions = Array.isArray(report.future_predictions) ? report.future_predictions : null;
  check(Array.isArray(futurePredictions), 'future_predictions must be an array');
  same(futurePredictions?.length, 0, 'future_predictions.length');

  const audit = report.future_fixture_audit ?? {};
  same(audit.status, 'official_schedule_parsed_predictions_blocked', 'future_fixture_audit.status');
  same(audit.official_source, OFFICIAL_PAGE, 'future_fixture_audit.official_source');
  same(audit.official_release, OFFICIAL_RELEASE, 'future_fixture_audit.official_release');
  same(audit.official_pdf, OFFICIAL_PDF, 'future_fixture_audit.official_pdf');
  same(
    audit.ignored_rows,
    report.source_quarantine?.unscored_2026_world_cup_rows,
    'future_fixture_audit.ignored_rows vs source_quarantine.unscored_2026_world_cup_rows',
  );
  check(
    String(audit.reason ?? '').includes('blocked') && String(audit.reason ?? '').includes('market odds'),
    'future_fixture_audit.reason must explain that prediction output is blocked until real inputs are connected',
  );

  const scheduleAudit = audit.official_schedule ?? {};
  same(scheduleAudit.status, 'official_schedule_parsed', 'future_fixture_audit.official_schedule.status');
  same(scheduleAudit.match_count, 104, 'future_fixture_audit.official_schedule.match_count');
  same(scheduleAudit.venue_count, 16, 'future_fixture_audit.official_schedule.venue_count');
  same(scheduleAudit.source_page, OFFICIAL_PAGE, 'future_fixture_audit.official_schedule.source_page');
  same(scheduleAudit.source_release, OFFICIAL_RELEASE, 'future_fixture_audit.official_schedule.source_release');
  same(scheduleAudit.source_pdf, OFFICIAL_PDF, 'future_fixture_audit.official_schedule.source_pdf');
  same(JSON.stringify(scheduleAudit.stage_counts), JSON.stringify(EXPECTED_STAGE_COUNTS), 'future_fixture_audit.official_schedule.stage_counts');
  same(JSON.stringify(scheduleAudit.date_span_et), JSON.stringify(['2026-06-11', '2026-07-19']), 'future_fixture_audit.official_schedule.date_span_et');

  same(officialSchedule.status, 'official_schedule_parsed', 'official-schedule.json.status');
  same(officialSchedule.match_count, 104, 'official-schedule.json.match_count');
  same(officialSchedule.venue_count, 16, 'official-schedule.json.venue_count');
  same(officialSchedule.source_page, OFFICIAL_PAGE, 'official-schedule.json.source_page');
  same(officialSchedule.source_release, OFFICIAL_RELEASE, 'official-schedule.json.source_release');
  same(officialSchedule.source_pdf, OFFICIAL_PDF, 'official-schedule.json.source_pdf');
  same(JSON.stringify(officialSchedule.stage_counts), JSON.stringify(EXPECTED_STAGE_COUNTS), 'official-schedule.json.stage_counts');
  same(JSON.stringify(officialSchedule.date_span_et), JSON.stringify(['2026-06-11', '2026-07-19']), 'official-schedule.json.date_span_et');

  const fixtures = Array.isArray(officialSchedule.fixtures) ? officialSchedule.fixtures : [];
  same(fixtures.length, 104, 'official-schedule.json.fixtures.length');
  const matchNumbers = fixtures.map((fixture) => fixture.match_no).sort((a, b) => a - b);
  matchNumbers.forEach((matchNo, index) => same(matchNo, index + 1, `official match_no[${index}]`));
}

async function main() {
  const [report, officialSchedule, sourceRows] = await Promise.all([
    readJson(REPORT_JSON),
    readJson(OFFICIAL_SCHEDULE_JSON),
    countCsvDataRows(RESULTS_CSV),
  ]);

  verifyReportScope(report, sourceRows);
  verifySourceQuarantine(report);
  verifyEvaluation(report);
  verifySamplePredictions(report);
  verifyFriendlyWindows(report);
  verifyFutureGuard(report, officialSchedule);

  if (errors.length > 0) {
    console.error(`Model integrity verification failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('Model integrity verification passed.');
  console.log(
    JSON.stringify(
      {
        source_rows: report.source_rows,
        evaluated_matches: report.evaluated_matches,
        overall_primary_accuracy: report.evaluation.overall.primary.accuracy,
        overall_primary_log_loss: report.evaluation.overall.primary.log_loss,
        friendly_2026_latest_24_accuracy: report.friendly_audit.primary.accuracy,
        friendly_2026_latest_24_log_loss: report.friendly_audit.primary.log_loss,
        friendly_2026_all_window_matches: report.friendly_audit.full_window.evaluated_matches,
        prior_friendly_cycles: report.friendly_window_stability.latest_24.prior_cycle_count,
        quarantined_2026_world_cup_rows: report.source_quarantine.unscored_2026_world_cup_rows,
        future_predictions: report.future_predictions.length,
        official_2026_fixtures: report.future_fixture_audit.official_schedule.match_count,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
