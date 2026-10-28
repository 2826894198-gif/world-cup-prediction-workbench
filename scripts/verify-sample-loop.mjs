#!/usr/bin/env node

import { openDatabase } from '../server/db/connection.mjs';
import { Repository } from '../server/services/repository.mjs';

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function count(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function grouped(db, sql) {
  return Object.fromEntries(db.prepare(sql).all().map((row) => [row.key, row.count]));
}

const db = openDatabase();

try {
  const counts = {
    teams: count(db, 'teams'),
    matches: count(db, 'matches'),
    oddsSnapshots: count(db, 'odds_snapshots'),
    predictions: count(db, 'predictions'),
    scoreProbabilities: count(db, 'score_probabilities'),
    goalProbabilities: count(db, 'goal_probabilities'),
    tagRules: count(db, 'tag_rules'),
    matchTags: count(db, 'match_tags'),
    results: count(db, 'results'),
    reviews: count(db, 'reviews'),
    importRuns: count(db, 'import_runs')
  };

  check(counts.teams === 48, `expected 48 teams, got ${counts.teams}`);
  check(counts.matches === 104, `expected 104 matches, got ${counts.matches}`);
  check(counts.oddsSnapshots === 312, `expected 312 sample odds snapshots, got ${counts.oddsSnapshots}`);
  check(counts.predictions === 104, `expected 104 predictions, got ${counts.predictions}`);
  check(counts.results === 104, `expected 104 sample results, got ${counts.results}`);
  check(counts.tagRules === 11, `expected 11 tag rules, got ${counts.tagRules}`);
  check(counts.matchTags > 0, 'expected rule-engine match tags');
  check(counts.scoreProbabilities >= 104 * 10, 'expected score probability rows for every match');
  check(counts.goalProbabilities >= 104 * 7, 'expected goal probability rows for every match');

  const statuses = grouped(db, 'SELECT status AS key, COUNT(*) AS count FROM matches GROUP BY status');
  check(Object.keys(statuses).length === 1 && statuses.sample_placeholder === 104, 'sample loop must use sample_placeholder status for all matches');

  const sourceTypes = grouped(db, 'SELECT source_type AS key, COUNT(*) AS count FROM odds_snapshots GROUP BY source_type');
  check(Object.keys(sourceTypes).length === 1 && sourceTypes.sample_sandbox_snapshot === 312, 'sample loop must use only sample_sandbox_snapshot odds');

  const latestModel = db.prepare('SELECT code, accuracy_json FROM model_versions ORDER BY id DESC LIMIT 1').get();
  check(latestModel?.code === 'sample-hybrid-loop-v1.0', `expected sample model, got ${latestModel?.code ?? 'none'}`);
  const accuracy = JSON.parse(latestModel?.accuracy_json ?? '{}');
  check(accuracy.sample_size === 104, `expected accuracy sample_size 104, got ${accuracy.sample_size ?? 'none'}`);
  check(Number.isFinite(accuracy.result_accuracy), 'expected finite result accuracy');
  check(Number.isFinite(accuracy.handicap_direction_accuracy), 'expected finite handicap accuracy');

  const invalidProbabilityRows = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM predictions
       WHERE calibrated_home_prob < 0 OR calibrated_home_prob > 1
          OR calibrated_draw_prob < 0 OR calibrated_draw_prob > 1
          OR calibrated_away_prob < 0 OR calibrated_away_prob > 1
          OR ABS(calibrated_home_prob + calibrated_draw_prob + calibrated_away_prob - 1) > 0.002`
    )
    .get().count;
  check(invalidProbabilityRows === 0, `invalid probability rows: ${invalidProbabilityRows}`);

  const resultRows = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM results
       WHERE result_1x2 IS NULL OR handicap_result IS NULL OR total_result IS NULL OR upset_type IS NULL`
    )
    .get().count;
  check(resultRows === 0, `incomplete result rows: ${resultRows}`);

  const upsetTypes = grouped(db, 'SELECT upset_type AS key, COUNT(*) AS count FROM results GROUP BY upset_type');
  check(Object.keys(upsetTypes).length >= 2, 'expected multiple upset types to distinguish result and handicap risk');

  const repo = new Repository(db);
  const summary = repo.getSummary();
  check(summary.dataQuality?.mode === 'sample_sandbox_loop', `summary mode mismatch: ${summary.dataQuality?.mode}`);
  check(summary.counts.matches === 104, 'summary match count mismatch');
  check(summary.counts.predictedMatches === 104, 'summary predicted match count mismatch');
  check(summary.counts.results === 104, 'summary result count mismatch');
  check(summary.dataQuality?.marketAudit?.importSummary?.verifiedSnapshotsAvailable === 312, 'summary sample snapshot count mismatch');
  check(summary.groups?.length === 12, 'expected 12 group tables');
  check(summary.knockoutPaths?.length === 32, 'expected 32 knockout paths');
  check(summary.champions?.length > 0, 'expected champion probabilities in sample mode');
  check(summary.parlays?.length > 0, 'expected parlay candidates in sample mode');
  check(summary.calibration?.sampleSize === 104, 'expected calibration sample size 104');

  const detail = repo.getMatchDetail(1);
  check(detail?.hasPrediction === true, 'match detail should have prediction');
  check((detail?.scores?.length ?? 0) >= 6, 'match detail should expose score probabilities');
  check((detail?.goals?.length ?? 0) >= 7, 'match detail should expose goal probabilities');
  check((detail?.oddsHistory?.length ?? 0) === 3, 'match detail should expose three odds snapshots');
  check(detail?.result?.result1x2, 'match detail should expose result review');

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, failures, counts, statuses, sourceTypes }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: summary.dataQuality.mode,
        counts,
        accuracy,
        parlays: summary.parlays.length,
        groups: summary.groups.length,
        champions: summary.champions.length,
        knockoutPaths: summary.knockoutPaths.length,
        upsetTypes
      },
      null,
      2
    )
  );
} finally {
  db.close();
}
