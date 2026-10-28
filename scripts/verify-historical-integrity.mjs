import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_JSON = path.join(ROOT_DIR, 'reports/historical-model-evaluation.json');
const DATA_DIR = path.join(ROOT_DIR, 'data/research/football-data');

const DATA_SOURCE = 'https://www.football-data.co.uk/';
const EXPECTED_SEASONS = ['2122', '2223', '2324', '2425', '2526'];
const EXPECTED_LEAGUES = {
  E0: { name: 'Premier League' },
  SP1: { name: 'La Liga' },
  D1: { name: 'Bundesliga' },
  I1: { name: 'Serie A' },
  F1: { name: 'Ligue 1' },
};
const EXPECTED_PRIMARY_PROVIDERS = ['BFE', 'Avg', 'Max', 'B365', 'PS'];
const REQUIRED_DECISION_KEYS = ['market', 'blended', 'model', 'adaptive', 'movement_adaptive'];
const OUTCOME_LABELS = ['home', 'draw', 'away'];

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

function finiteNumber(value, label) {
  check(Number.isFinite(value), `${label} must be finite, got ${value}`);
}

function inUnitInterval(value, label) {
  check(Number.isFinite(value) && value >= 0 && value <= 1, `${label} must be in [0, 1], got ${value}`);
}

function sortedEquals(actual, expected, label) {
  const left = [...(actual ?? [])].sort();
  const right = [...expected].sort();
  same(JSON.stringify(left), JSON.stringify(right), label);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function countCsvDataRows(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const rows = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  return Math.max(0, rows.length - 1);
}

function seasonLabel(season) {
  return `20${season.slice(0, 2)}/20${season.slice(2)}`;
}

function verifyMetric(metric, label, expectedMatches = null) {
  check(metric && typeof metric === 'object', `${label} is missing`);
  if (!metric || typeof metric !== 'object') return;

  if (expectedMatches !== null) same(metric.matches, expectedMatches, `${label}.matches`);
  check(Number.isInteger(metric.matches) && metric.matches >= 0, `${label}.matches must be a non-negative integer`);
  finiteNumber(metric.log_loss, `${label}.log_loss`);
  check(metric.log_loss >= 0 && metric.log_loss <= 3.5, `${label}.log_loss is out of sanity range`);
  check(Number.isFinite(metric.brier) && metric.brier >= 0 && metric.brier <= 2, `${label}.brier is out of range`);
  inUnitInterval(metric.accuracy, `${label}.accuracy`);
  inUnitInterval(metric.avg_confidence, `${label}.avg_confidence`);
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

  check(metric.outcome_bias && typeof metric.outcome_bias === 'object', `${label}.outcome_bias is missing`);
  if (metric.outcome_bias && typeof metric.outcome_bias === 'object') {
    for (const outcome of OUTCOME_LABELS) {
      check(
        Number.isFinite(metric.outcome_bias[outcome]) &&
          metric.outcome_bias[outcome] >= -1 &&
          metric.outcome_bias[outcome] <= 1,
        `${label}.outcome_bias.${outcome} is out of range`,
      );
    }
    const biasSum = OUTCOME_LABELS.reduce((sum, outcome) => sum + metric.outcome_bias[outcome], 0);
    close(biasSum, 0, `${label}.outcome_bias sum`, 0.0025);
  }
}

function verifyPredictionShare(share, label) {
  check(share && typeof share === 'object', `${label} is missing`);
  if (!share || typeof share !== 'object') return;

  for (const outcome of OUTCOME_LABELS) {
    inUnitInterval(share[outcome], `${label}.${outcome}`);
  }
  const sum = OUTCOME_LABELS.reduce((total, outcome) => total + share[outcome], 0);
  close(sum, 1, `${label} sum`, 0.0025);
}

function verifyDecisionMetrics(decisions, label, expectedMatches) {
  check(decisions && typeof decisions === 'object', `${label} is missing`);
  if (!decisions || typeof decisions !== 'object') return;

  for (const key of REQUIRED_DECISION_KEYS) {
    const row = decisions[key];
    check(row && typeof row === 'object', `${label}.${key} is missing`);
    if (!row || typeof row !== 'object') continue;
    same(row.matches, expectedMatches, `${label}.${key}.matches`);
    inUnitInterval(row.accuracy, `${label}.${key}.accuracy`);
    check(Number.isInteger(row.overrides) && row.overrides >= 0, `${label}.${key}.overrides must be non-negative`);
    inUnitInterval(row.override_rate, `${label}.${key}.override_rate`);
    close(row.overrides / row.matches, row.override_rate, `${label}.${key}.override_rate from overrides`, 0.0006);
    verifyPredictionShare(row.prediction_share, `${label}.${key}.prediction_share`);
  }
}

function verifyEvaluationBucket(bucket, label, expectedMatches = null) {
  check(bucket && typeof bucket === 'object', `${label} is missing`);
  if (!bucket || typeof bucket !== 'object') return;

  const matches = expectedMatches ?? bucket.blended?.matches;
  check(Number.isInteger(matches) && matches > 0, `${label}.matches must be positive`);
  verifyMetric(bucket.blended, `${label}.blended`, matches);
  verifyMetric(bucket.model_only, `${label}.model_only`, matches);
  verifyMetric(bucket.market_only, `${label}.market_only`, matches);
  verifyDecisionMetrics(bucket.decision_accuracy, `${label}.decision_accuracy`, matches);
  inUnitInterval(bucket.avg_market_weight, `${label}.avg_market_weight`);

  const value = bucket.value_research;
  check(value && typeof value === 'object', `${label}.value_research is missing`);
  if (value && typeof value === 'object') {
    check(Number.isInteger(value.candidates) && value.candidates >= 0, `${label}.value_research.candidates is invalid`);
    finiteNumber(value.paper_stake, `${label}.value_research.paper_stake`);
    finiteNumber(value.paper_return, `${label}.value_research.paper_return`);
    finiteNumber(value.paper_roi, `${label}.value_research.paper_roi`);
  }

  check(Array.isArray(bucket.value_sensitivity), `${label}.value_sensitivity must be an array`);
  if (Array.isArray(bucket.value_sensitivity)) {
    check(bucket.value_sensitivity.length >= 3, `${label}.value_sensitivity must include multiple thresholds`);
    for (const [index, row] of bucket.value_sensitivity.entries()) {
      const rowLabel = `${label}.value_sensitivity[${index}]`;
      check(typeof row.key === 'string' && row.key.length > 0, `${rowLabel}.key is missing`);
      check(typeof row.label === 'string' && row.label.length > 0, `${rowLabel}.label is missing`);
      check(Number.isFinite(row.min_edge) && row.min_edge >= 0, `${rowLabel}.min_edge is invalid`);
      check(Number.isFinite(row.min_probability) && row.min_probability >= 0 && row.min_probability <= 1, `${rowLabel}.min_probability is invalid`);
      check(Number.isInteger(row.candidates) && row.candidates >= 0, `${rowLabel}.candidates is invalid`);
      if (row.candidates > 0) {
        inUnitInterval(row.hit_rate, `${rowLabel}.hit_rate`);
        finiteNumber(row.avg_edge, `${rowLabel}.avg_edge`);
        finiteNumber(row.paper_roi, `${rowLabel}.paper_roi`);
      }
      finiteNumber(row.paper_stake, `${rowLabel}.paper_stake`);
      finiteNumber(row.paper_return, `${rowLabel}.paper_return`);
    }
  }
}

function verifyProviderMetric(provider, label) {
  check(provider && typeof provider === 'object', `${label} provider row is missing`);
  if (!provider || typeof provider !== 'object') return;

  check(typeof provider.provider === 'string' && provider.provider.length > 0, `${label}.provider is missing`);
  check(typeof provider.label === 'string' && provider.label.length > 0, `${label}.label is missing`);
  check(Number.isInteger(provider.rows) && provider.rows > 0, `${label}.rows must be positive`);
  finiteNumber(provider.log_loss, `${label}.log_loss`);
  check(provider.log_loss >= 0 && provider.log_loss <= 3.5, `${label}.log_loss is out of sanity range`);
  check(Number.isFinite(provider.brier) && provider.brier >= 0 && provider.brier <= 2, `${label}.brier is out of range`);
  inUnitInterval(provider.accuracy, `${label}.accuracy`);
  inUnitInterval(provider.favorite_hit_rate, `${label}.favorite_hit_rate`);
  check(
    Number.isFinite(provider.avg_overround) && provider.avg_overround >= -0.2 && provider.avg_overround <= 0.5,
    `${label}.avg_overround is out of range`,
  );

  check(provider.outcome_bias && typeof provider.outcome_bias === 'object', `${label}.outcome_bias is missing`);
  if (provider.outcome_bias && typeof provider.outcome_bias === 'object') {
    for (const outcome of OUTCOME_LABELS) {
      check(
        Number.isFinite(provider.outcome_bias[outcome]) &&
          provider.outcome_bias[outcome] >= -1 &&
          provider.outcome_bias[outcome] <= 1,
        `${label}.outcome_bias.${outcome} is out of range`,
      );
    }
  }
}

function verifyProviderSegments(segments, label, expectedSegmentKeys) {
  check(Array.isArray(segments), `${label} must be an array`);
  if (!Array.isArray(segments)) return;

  sortedEquals(
    segments.map((segment) => segment.key),
    expectedSegmentKeys,
    `${label}.keys`,
  );

  for (const segment of segments) {
    check(typeof segment.label === 'string' && segment.label.length > 0, `${label}.${segment.key}.label is missing`);
    check(Array.isArray(segment.providers) && segment.providers.length > 0, `${label}.${segment.key}.providers is empty`);
    if (Array.isArray(segment.providers)) {
      segment.providers.forEach((provider, index) => verifyProviderMetric(provider, `${label}.${segment.key}.providers[${index}]`));
    }
  }
}

function verifyRangeStats(stats, label) {
  check(stats && typeof stats === 'object', `${label} is missing`);
  if (!stats || typeof stats !== 'object') return;
  for (const key of ['min', 'max', 'range', 'avg']) {
    finiteNumber(stats[key], `${label}.${key}`);
  }
  check(stats.min <= stats.max, `${label}.min must be <= max`);
  close(stats.max - stats.min, stats.range, `${label}.range`, 0.0006);
}

function verifyProviderRobustness(rows, expectedSeasonCount, expectedLeagueCount) {
  check(Array.isArray(rows) && rows.length > 0, 'provider_robustness must be a non-empty array');
  if (!Array.isArray(rows)) return;

  rows.forEach((row, index) => {
    const label = `provider_robustness[${index}]`;
    check(typeof row.provider === 'string' && row.provider.length > 0, `${label}.provider is missing`);
    check(Number.isInteger(row.rows) && row.rows > 0, `${label}.rows must be positive`);
    finiteNumber(row.overall_log_loss, `${label}.overall_log_loss`);
    check(
      Number.isInteger(row.season_coverage) && row.season_coverage >= 0 && row.season_coverage <= expectedSeasonCount,
      `${label}.season_coverage is invalid`,
    );
    check(
      Number.isInteger(row.league_coverage) && row.league_coverage >= 0 && row.league_coverage <= expectedLeagueCount,
      `${label}.league_coverage is invalid`,
    );
    verifyRangeStats(row.season_log_loss, `${label}.season_log_loss`);
    verifyRangeStats(row.league_log_loss, `${label}.league_log_loss`);
    check(Number.isInteger(row.top3_season_count) && row.top3_season_count >= 0, `${label}.top3_season_count is invalid`);
    check(Number.isInteger(row.top3_league_count) && row.top3_league_count >= 0, `${label}.top3_league_count is invalid`);
    finiteNumber(row.stability_score, `${label}.stability_score`);
    check(typeof row.note === 'string' && row.note.length > 0, `${label}.note is missing`);

    if (row.latest_season) {
      same(row.latest_season.season, EXPECTED_SEASONS.at(-1), `${label}.latest_season.season`);
      same(row.latest_season.label, seasonLabel(EXPECTED_SEASONS.at(-1)), `${label}.latest_season.label`);
      check(Number.isInteger(row.latest_season.rows) && row.latest_season.rows > 0, `${label}.latest_season.rows invalid`);
      finiteNumber(row.latest_season.log_loss, `${label}.latest_season.log_loss`);
      inUnitInterval(row.latest_season.accuracy, `${label}.latest_season.accuracy`);
    }
  });
}

function verifyMovement(row, label, totalMatches, options = {}) {
  check(row && typeof row === 'object', `${label} is missing`);
  if (!row || typeof row !== 'object') return;

  const minRows = options.requireHighCoverage ? totalMatches * 0.9 : 0;
  check(Number.isInteger(row.rows) && row.rows > minRows, `${label}.rows should be greater than ${minRows}`);
  finiteNumber(row.opening_log_loss, `${label}.opening_log_loss`);
  finiteNumber(row.closing_log_loss, `${label}.closing_log_loss`);
  finiteNumber(row.closing_log_loss_lift, `${label}.closing_log_loss_lift`);
  close(row.opening_log_loss - row.closing_log_loss, row.closing_log_loss_lift, `${label}.closing_log_loss_lift`, 0.0006);
  inUnitInterval(row.opening_pick_accuracy, `${label}.opening_pick_accuracy`);
  inUnitInterval(row.closing_pick_accuracy, `${label}.closing_pick_accuracy`);
  close(row.closing_pick_accuracy - row.opening_pick_accuracy, row.closing_pick_lift, `${label}.closing_pick_lift`, 0.0006);
  inUnitInterval(row.pick_change_rate, `${label}.pick_change_rate`);
  check(
    Number.isFinite(row.changed_pick_net_accuracy) &&
      row.changed_pick_net_accuracy >= -1 &&
      row.changed_pick_net_accuracy <= 1,
    `${label}.changed_pick_net_accuracy is out of range`,
  );
  inUnitInterval(row.avg_abs_probability_move, `${label}.avg_abs_probability_move`);
  check(
    Number.isFinite(row.avg_actual_probability_move) &&
      row.avg_actual_probability_move >= -1 &&
      row.avg_actual_probability_move <= 1,
    `${label}.avg_actual_probability_move is out of range`,
  );
  inUnitInterval(row.strengthened_closing_favorite_hit_rate, `${label}.strengthened_closing_favorite_hit_rate`);
}

function verifyProbabilityObject(probabilities, label) {
  check(probabilities && typeof probabilities === 'object', `${label} is missing`);
  if (!probabilities || typeof probabilities !== 'object') return;

  for (const outcome of OUTCOME_LABELS) {
    inUnitInterval(probabilities[outcome], `${label}.${outcome}`);
  }
  const sum = OUTCOME_LABELS.reduce((total, outcome) => total + probabilities[outcome], 0);
  close(sum, 1, `${label} sum`, 0.0025);
}

function verifySamplePredictions(rows) {
  check(Array.isArray(rows) && rows.length > 0, 'sample_predictions must be a non-empty array');
  if (!Array.isArray(rows)) return;

  let previousDate = '';
  rows.forEach((row, index) => {
    const label = `sample_predictions[${index}]`;
    check(/^\d{4}-\d{2}-\d{2}$/.test(row.date), `${label}.date must be YYYY-MM-DD`);
    check(row.date >= previousDate, `${label}.date must be sorted ascending`);
    previousDate = row.date;
    check(typeof row.season === 'string' && row.season.length > 0, `${label}.season is missing`);
    check(typeof row.league === 'string' && row.league.length > 0, `${label}.league is missing`);
    check(typeof row.match === 'string' && row.match.length > 0, `${label}.match is missing`);
    check(['H', 'D', 'A'].includes(row.predicted), `${label}.predicted must be H/D/A`);
    check(['H', 'D', 'A'].includes(row.selected), `${label}.selected must be H/D/A`);
    check(['H', 'D', 'A'].includes(row.movementSelected), `${label}.movementSelected must be H/D/A`);
    check(['H', 'D', 'A'].includes(row.actual), `${label}.actual must be H/D/A`);
    verifyProbabilityObject(row.probabilities, `${label}.probabilities`);
    inUnitInterval(row.marketWeight, `${label}.marketWeight`);
    check(Array.isArray(row.oddsColumns) && row.oddsColumns.length === 3, `${label}.oddsColumns must contain a triplet`);
    if (row.marketMovement) {
      for (const outcome of OUTCOME_LABELS) {
        check(
          Number.isFinite(row.marketMovement[outcome]) && row.marketMovement[outcome] >= -1 && row.marketMovement[outcome] <= 1,
          `${label}.marketMovement.${outcome} is out of range`,
        );
      }
      const moveSum = OUTCOME_LABELS.reduce((total, outcome) => total + row.marketMovement[outcome], 0);
      close(moveSum, 0, `${label}.marketMovement sum`, 0.0025);
    }
  });
}

async function verifyFiles(report) {
  check(Array.isArray(report.files), 'files must be an array');
  if (!Array.isArray(report.files)) return { fileRowTotal: 0, rowsBySeason: new Map(), rowsByLeague: new Map() };

  same(report.files.length, EXPECTED_SEASONS.length * Object.keys(EXPECTED_LEAGUES).length, 'files.length');

  const filesByKey = new Map(report.files.map((file) => [`${file.season}-${file.leagueCode}`, file]));
  const rowsBySeason = new Map();
  const rowsByLeague = new Map();
  let fileRowTotal = 0;

  for (const season of EXPECTED_SEASONS) {
    for (const [leagueCode, league] of Object.entries(EXPECTED_LEAGUES)) {
      const key = `${season}-${leagueCode}`;
      const file = filesByKey.get(key);
      check(Boolean(file), `missing file entry ${key}`);
      if (!file) continue;

      same(file.season, season, `${key}.season`);
      same(file.leagueCode, leagueCode, `${key}.leagueCode`);
      same(file.league, league.name, `${key}.league`);
      check(typeof file.filePath === 'string' && file.filePath.endsWith(`${key}.csv`), `${key}.filePath is invalid`);
      check(typeof file.cached === 'boolean', `${key}.cached must be boolean`);

      const csvPath = path.resolve(file.filePath);
      same(csvPath, path.join(DATA_DIR, `${key}.csv`), `${key}.filePath`);
      const localRows = await countCsvDataRows(csvPath);
      same(file.rows, localRows, `${key}.rows vs local csv`);
      check(file.rows > 0, `${key}.rows must be positive`);

      fileRowTotal += file.rows;
      rowsBySeason.set(season, (rowsBySeason.get(season) ?? 0) + file.rows);
      rowsByLeague.set(leagueCode, (rowsByLeague.get(leagueCode) ?? 0) + file.rows);
    }
  }

  return { fileRowTotal, rowsBySeason, rowsByLeague };
}

function verifyScope(report) {
  same(report.data_source, DATA_SOURCE, 'data_source');
  sortedEquals(report.seasons, EXPECTED_SEASONS, 'seasons');
  sortedEquals(report.leagues, Object.keys(EXPECTED_LEAGUES), 'leagues');

  const generatedDate = String(report.generated_at ?? '').slice(0, 10);
  check(/^\d{4}-\d{2}-\d{2}$/.test(generatedDate), 'generated_at must contain an ISO date');
}

function verifyEvaluation(report, rowAudit) {
  const evaluation = report.evaluation ?? {};
  const overallMatches = rowAudit.fileRowTotal;

  verifyEvaluationBucket(evaluation.overall, 'evaluation.overall', overallMatches);
  same(evaluation.overall?.blended?.matches, overallMatches, 'overall matches vs source rows');

  check(Array.isArray(evaluation.by_league), 'evaluation.by_league must be an array');
  if (Array.isArray(evaluation.by_league)) {
    sortedEquals(
      evaluation.by_league.map((bucket) => bucket.league_code),
      Object.keys(EXPECTED_LEAGUES),
      'by_league.codes',
    );
    for (const bucket of evaluation.by_league) {
      const expectedRows = rowAudit.rowsByLeague.get(bucket.league_code);
      const expectedLeague = EXPECTED_LEAGUES[bucket.league_code];
      same(bucket.league, expectedLeague?.name, `by_league.${bucket.league_code}.league`);
      verifyEvaluationBucket(bucket, `by_league.${bucket.league_code}`, expectedRows);
    }
  }

  check(Array.isArray(evaluation.by_season), 'evaluation.by_season must be an array');
  if (Array.isArray(evaluation.by_season)) {
    sortedEquals(
      evaluation.by_season.map((bucket) => bucket.season),
      EXPECTED_SEASONS,
      'by_season.keys',
    );
    for (const bucket of evaluation.by_season) {
      const expectedRows = rowAudit.rowsBySeason.get(bucket.season);
      same(bucket.season_label, seasonLabel(bucket.season), `by_season.${bucket.season}.season_label`);
      verifyEvaluationBucket(bucket, `by_season.${bucket.season}`, expectedRows);
    }
  }

  check(Array.isArray(evaluation.primary_odds_provider_order), 'primary_odds_provider_order must be an array');
  same(
    JSON.stringify(evaluation.primary_odds_provider_order),
    JSON.stringify(EXPECTED_PRIMARY_PROVIDERS),
    'primary_odds_provider_order',
  );

  const providerCounts = evaluation.primary_odds_provider_counts ?? {};
  const primaryProviderTotal = Object.values(providerCounts).reduce((sum, value) => sum + value, 0);
  same(primaryProviderTotal, overallMatches, 'primary_odds_provider_counts total');
  for (const [provider, count] of Object.entries(providerCounts)) {
    check(EXPECTED_PRIMARY_PROVIDERS.includes(provider), `unexpected primary provider count: ${provider}`);
    check(Number.isInteger(count) && count > 0, `primary_odds_provider_counts.${provider} must be positive`);
  }

  check(Array.isArray(evaluation.provider_tendencies) && evaluation.provider_tendencies.length > 0, 'provider_tendencies empty');
  if (Array.isArray(evaluation.provider_tendencies)) {
    evaluation.provider_tendencies.forEach((provider, index) => verifyProviderMetric(provider, `provider_tendencies[${index}]`));
    for (const provider of ['Avg', 'Max', 'B365', 'PS', 'BFE']) {
      check(evaluation.provider_tendencies.some((row) => row.provider === provider), `provider_tendencies missing ${provider}`);
    }
  }

  verifyProviderSegments(evaluation.provider_by_season, 'provider_by_season', EXPECTED_SEASONS);
  verifyProviderSegments(evaluation.provider_by_league, 'provider_by_league', Object.keys(EXPECTED_LEAGUES));
  same(evaluation.provider_segment_min_rows, 150, 'provider_segment_min_rows');
  verifyProviderRobustness(evaluation.provider_robustness, EXPECTED_SEASONS.length, Object.keys(EXPECTED_LEAGUES).length);

  verifyMovement(evaluation.primary_market_movement, 'primary_market_movement', overallMatches, { requireHighCoverage: true });
  check(Array.isArray(evaluation.market_movement_by_provider), 'market_movement_by_provider must be an array');
  if (Array.isArray(evaluation.market_movement_by_provider)) {
    evaluation.market_movement_by_provider.forEach((row, index) =>
      verifyMovement(row, `market_movement_by_provider[${index}]`, overallMatches),
    );
  }

  const adaptiveConfig = evaluation.adaptive_pick_config ?? {};
  same(adaptiveConfig.override_min_matches, 160, 'adaptive_pick_config.override_min_matches');
  check(Number.isFinite(adaptiveConfig.override_edge), 'adaptive_pick_config.override_edge must be finite');
  check(Number.isFinite(adaptiveConfig.override_margin), 'adaptive_pick_config.override_margin must be finite');
  check(Number.isFinite(adaptiveConfig.override_max_market_weight), 'adaptive_pick_config.override_max_market_weight must be finite');
  check(Number.isFinite(adaptiveConfig.movement_guard_block_threshold), 'adaptive_pick_config.movement_guard_block_threshold must be finite');
  check(Number.isFinite(adaptiveConfig.movement_support_edge), 'adaptive_pick_config.movement_support_edge must be finite');
  check(Number.isFinite(adaptiveConfig.movement_support_floor), 'adaptive_pick_config.movement_support_floor must be finite');

  verifySamplePredictions(evaluation.sample_predictions);
}

const report = await readJson(REPORT_JSON);
verifyScope(report);
const rowAudit = await verifyFiles(report);
verifyEvaluation(report, rowAudit);

if (errors.length) {
  console.error('Historical model integrity verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const summary = {
  data_source: report.data_source,
  seasons: report.seasons.length,
  leagues: report.leagues.length,
  files: report.files.length,
  source_rows: rowAudit.fileRowTotal,
  overall_accuracy: report.evaluation.overall.blended.accuracy,
  overall_log_loss: report.evaluation.overall.blended.log_loss,
  market_log_loss: report.evaluation.overall.market_only.log_loss,
  adaptive_pick_accuracy: report.evaluation.overall.decision_accuracy.adaptive.accuracy,
  primary_movement_rows: report.evaluation.primary_market_movement.rows,
};

console.log(JSON.stringify(summary, null, 2));
