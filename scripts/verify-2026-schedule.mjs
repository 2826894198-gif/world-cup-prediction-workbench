#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { officialResults } from '../server/data/officialResults.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const SCHEDULE_PATH = path.join(ROOT_DIR, 'data/research/worldcup-2026/official-schedule.json');
const ODDS_AUDIT_PATH = path.join(ROOT_DIR, 'data/research/worldcup-2026/odds-source-audit.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const DB_PATH = path.join(ROOT_DIR, 'data/worldcup.sqlite');
const OFFICIAL_PAGE =
  'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums';
const OFFICIAL_RELEASE =
  'https://inside.fifa.com/organisation/media-releases/updated-world-cup-2026-match-schedule-venues-kick-off-times-104-matches';
const OFFICIAL_PDF =
  'https://digitalhub.fifa.com/asset/4b5d4417-3343-4732-9cdf-14b6662af407/FWC26-Match-Schedule_English.pdf';
const EXPECTED_SETTLED_RESULT = {
  match_no: 1,
  home_score: 2,
  away_score: 0,
  result_1x2: '主胜',
};
const EXPECTED_FINISHED_MATCHES = officialResults.length;

const failures = [];

function fail(message) {
  failures.push(message);
}

function check(condition, message) {
  if (!condition) fail(message);
}

function same(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, got ${actual ?? 'undefined'}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function side(fixture, name) {
  return fixture[`${name}_code`] ?? fixture[`${name}_placeholder`];
}

function verifyCounts(actual, expected, label) {
  const actualKeys = Object.keys(actual ?? {}).sort();
  const expectedKeys = Object.keys(expected).sort();
  same(actualKeys.join(','), expectedKeys.join(','), `${label} keys`);
  for (const key of expectedKeys) {
    same(actual?.[key], expected[key], `${label}.${key}`);
  }
}

function verifyFixture(fixture, expected) {
  check(Boolean(fixture), `match ${expected.match_no} is missing`);
  if (!fixture) return;
  same(fixture.stage, expected.stage, `match ${expected.match_no} stage`);
  same(fixture.date_et, expected.date_et, `match ${expected.match_no} date_et`);
  same(fixture.kickoff_et, expected.kickoff_et, `match ${expected.match_no} kickoff_et`);
  same(fixture.venue, expected.venue, `match ${expected.match_no} venue`);
  if (expected.home) same(side(fixture, 'home'), expected.home, `match ${expected.match_no} home`);
  if (expected.away) same(side(fixture, 'away'), expected.away, `match ${expected.match_no} away`);
  if (expected.group_name) same(fixture.group_name, expected.group_name, `match ${expected.match_no} group`);
}

function verifySchedule() {
  check(fs.existsSync(SCHEDULE_PATH), `missing official schedule file: ${path.relative(ROOT_DIR, SCHEDULE_PATH)}`);
  if (!fs.existsSync(SCHEDULE_PATH)) return null;

  const schedule = readJson(SCHEDULE_PATH);
  const fixtures = Array.isArray(schedule.fixtures) ? schedule.fixtures : [];
  same(schedule.status, 'official_schedule_parsed', 'schedule status');
  same(schedule.source_page, OFFICIAL_PAGE, 'schedule source_page');
  same(schedule.source_release, OFFICIAL_RELEASE, 'schedule source_release');
  same(schedule.source_pdf, OFFICIAL_PDF, 'schedule source_pdf');
  same(schedule.match_count, 104, 'schedule match_count');
  same(fixtures.length, 104, 'schedule fixtures.length');
  same(schedule.date_span_et?.[0], '2026-06-11', 'schedule date_span start');
  same(schedule.date_span_et?.[1], '2026-07-19', 'schedule date_span end');
  same(schedule.venue_count, 16, 'schedule venue_count');
  verifyCounts(
    schedule.stage_counts,
    {
      group_stage: 72,
      round_of_32: 16,
      round_of_16: 8,
      quarter_final: 4,
      semi_final: 2,
      third_place: 1,
      final: 1,
    },
    'schedule stage_counts',
  );

  const numbers = fixtures.map((fixture) => fixture.match_no).sort((a, b) => a - b);
  same(numbers.length, 104, 'schedule match_no count');
  for (let index = 0; index < 104; index += 1) {
    same(numbers[index], index + 1, `schedule match_no[${index}]`);
  }

  const byNo = new Map(fixtures.map((fixture) => [fixture.match_no, fixture]));
  [
    { match_no: 1, stage: 'group_stage', date_et: '2026-06-11', kickoff_et: '15:00', venue: 'Mexico City', home: 'MEX', away: 'RSA', group_name: 'A' },
    { match_no: 2, stage: 'group_stage', date_et: '2026-06-11', kickoff_et: '22:00', venue: 'Guadalajara', home: 'KOR', away: 'CZE', group_name: 'A' },
    { match_no: 3, stage: 'group_stage', date_et: '2026-06-12', kickoff_et: '15:00', venue: 'Toronto', home: 'CAN', away: 'BIH', group_name: 'B' },
    { match_no: 4, stage: 'group_stage', date_et: '2026-06-12', kickoff_et: '21:00', venue: 'Los Angeles', home: 'USA', away: 'PAR', group_name: 'D' },
    { match_no: 5, stage: 'group_stage', date_et: '2026-06-13', kickoff_et: '21:00', venue: 'Boston', home: 'HAI', away: 'SCO', group_name: 'C' },
    { match_no: 6, stage: 'group_stage', date_et: '2026-06-13', kickoff_et: '00:00', venue: 'Vancouver', home: 'AUS', away: 'TUR', group_name: 'D' },
    { match_no: 7, stage: 'group_stage', date_et: '2026-06-13', kickoff_et: '18:00', venue: 'New York New Jersey', home: 'BRA', away: 'MAR', group_name: 'C' },
    { match_no: 8, stage: 'group_stage', date_et: '2026-06-13', kickoff_et: '15:00', venue: 'San Francisco Bay Area', home: 'QAT', away: 'SUI', group_name: 'B' },
    { match_no: 73, stage: 'round_of_32', date_et: '2026-06-28', kickoff_et: '15:00', venue: 'Los Angeles', home: 'RSA', away: 'CAN' },
    { match_no: 74, stage: 'round_of_32', date_et: '2026-06-29', kickoff_et: '16:30', venue: 'Boston', home: 'GER', away: 'PAR' },
    { match_no: 88, stage: 'round_of_32', date_et: '2026-07-03', kickoff_et: '14:00', venue: 'Dallas', home: 'AUS', away: 'EGY' },
    { match_no: 89, stage: 'round_of_16', date_et: '2026-07-04', kickoff_et: '17:00', venue: 'Philadelphia', home: 'W74', away: 'W77' },
    { match_no: 97, stage: 'quarter_final', date_et: '2026-07-09', kickoff_et: '16:00', venue: 'Boston', home: 'W89', away: 'W90' },
    { match_no: 101, stage: 'semi_final', date_et: '2026-07-14', kickoff_et: '15:00', venue: 'Dallas', home: 'W97', away: 'W98' },
    { match_no: 102, stage: 'semi_final', date_et: '2026-07-15', kickoff_et: '15:00', venue: 'Atlanta', home: 'W99', away: 'W100' },
    { match_no: 103, stage: 'third_place', date_et: '2026-07-18', kickoff_et: '17:00', venue: 'Miami', home: 'Loser Match 101', away: 'Loser Match 102' },
    { match_no: 104, stage: 'final', date_et: '2026-07-19', kickoff_et: '15:00', venue: 'New York New Jersey', home: 'Winner Match 101', away: 'Winner Match 102' },
  ].forEach((expected) => verifyFixture(byNo.get(expected.match_no), expected));

  return schedule;
}

function verifyReport() {
  check(fs.existsSync(REPORT_PATH), `missing international report: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  if (!fs.existsSync(REPORT_PATH)) return;
  const report = readJson(REPORT_PATH);
  same(report.future_fixture_audit?.status, 'official_schedule_parsed_predictions_blocked', 'report future_fixture_audit.status');
  same(report.future_fixture_audit?.official_source, OFFICIAL_PAGE, 'report official_source');
  same(report.future_fixture_audit?.official_release, OFFICIAL_RELEASE, 'report official_release');
  same(report.future_fixture_audit?.official_pdf, OFFICIAL_PDF, 'report official_pdf');
  same(report.future_fixture_audit?.official_schedule?.match_count, 104, 'report official_schedule.match_count');
  same(report.future_predictions?.length, 0, 'report future_predictions.length');
}

function dbCount(db, tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function verifyDb() {
  check(fs.existsSync(DB_PATH), `missing sqlite db: ${path.relative(ROOT_DIR, DB_PATH)}; run npm run seed`);
  if (!fs.existsSync(DB_PATH)) return { predictions: 0, odds: 0, results: 0 };

  const db = new DatabaseSync(DB_PATH);
  try {
    const predictionRows = dbCount(db, 'predictions');
    const oddsRows = dbCount(db, 'odds_snapshots');
    const resultRows = dbCount(db, 'results');
    same(dbCount(db, 'matches'), 104, 'db matches count');
    check(resultRows >= 1, 'db results count should include imported official results for review');

    if (oddsRows === 0 || predictionRows === 0) {
      same(predictionRows, 0, 'db predictions count before market odds');
      same(oddsRows, 0, 'db odds_snapshots count before market odds');
    } else {
      check(fs.existsSync(ODDS_AUDIT_PATH), `missing odds audit file: ${path.relative(ROOT_DIR, ODDS_AUDIT_PATH)}`);
      if (fs.existsSync(ODDS_AUDIT_PATH)) {
        const oddsAudit = readJson(ODDS_AUDIT_PATH);
        same(oddsAudit.status, 'complete_market_odds_imported', 'odds audit status');
        const trustedOddsRows = db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM odds_snapshots os
             JOIN matches m ON m.id = os.match_id
             WHERE os.source_type IN ('official_sporttery_calculator', 'dongqiudi_odds_index', 'european_bookmaker_public_snapshot', 'european_bookmaker_api')
               AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
               AND datetime(os.captured_at) < datetime(m.kickoff_utc)`,
          )
          .get().count;
        check(
          Number(oddsAudit.importSummary?.databaseSnapshotsAvailable ?? 0) >= oddsRows,
          'odds audit databaseSnapshotsAvailable must cover stored odds snapshots',
        );
        check(
          Number(oddsAudit.importSummary?.verifiedSnapshotsAvailable ?? 0) >= trustedOddsRows,
          'odds audit verifiedSnapshotsAvailable must cover trusted odds snapshots',
        );
        check(
          String(oddsAudit.recommendationPolicy ?? '').includes('不能作为单独投注建议'),
          'odds audit recommendationPolicy must keep betting-advice guardrail',
        );
      }

      const predictedMatchRows = db.prepare('SELECT COUNT(DISTINCT match_id) AS count FROM predictions').get().count;
      const oddsMatchRows = db.prepare('SELECT COUNT(DISTINCT match_id) AS count FROM odds_snapshots').get().count;
      check(predictedMatchRows <= oddsMatchRows, 'predictions must not cover matches without odds snapshots');

      const unverifiedPredictionRows = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM predictions p
           JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
           WHERE o.source_type NOT IN ('official_sporttery_calculator', 'dongqiudi_odds_index', 'european_bookmaker_public_snapshot', 'european_bookmaker_api')`,
        )
        .get().count;
      same(unverifiedPredictionRows, 0, 'predictions using unverified odds source');

      const invalidProbabilityRows = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM predictions
           WHERE calibrated_home_prob < 0 OR calibrated_home_prob > 1
              OR calibrated_draw_prob < 0 OR calibrated_draw_prob > 1
              OR calibrated_away_prob < 0 OR calibrated_away_prob > 1
              OR ABS(calibrated_home_prob + calibrated_draw_prob + calibrated_away_prob - 1) > 0.002`,
        )
        .get().count;
      same(invalidProbabilityRows, 0, 'prediction probability rows');
    }

    const statuses = Object.fromEntries(
      db.prepare('SELECT status, COUNT(*) AS count FROM matches GROUP BY status').all().map((row) => [
        row.status,
        row.count,
      ]),
    );
    same(statuses.finished, EXPECTED_FINISHED_MATCHES, 'db match status counts.finished');
    same(Number(statuses.result_pending ?? 0), 0, 'db match status counts.result_pending');
    const openedFutureMatches = Number(statuses.scheduled ?? 0);
    const blockedFutureMatches = Number(statuses.official_schedule_prediction_blocked ?? 0);
    same(openedFutureMatches + blockedFutureMatches, 104 - EXPECTED_FINISHED_MATCHES, 'db future match status count');
    const scheduledWithoutPrediction = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM matches m
         LEFT JOIN predictions p ON p.match_id = m.id
         WHERE m.status = 'scheduled'
           AND p.id IS NULL`,
      )
      .get().count;
    same(scheduledWithoutPrediction, 0, 'scheduled opened-market matches without prediction');

    const stageCounts = Object.fromEntries(
      db.prepare('SELECT stage, COUNT(*) AS count FROM matches GROUP BY stage ORDER BY stage').all().map((row) => [
        row.stage,
        row.count,
      ]),
    );
    verifyCounts(
      stageCounts,
      {
        group: 72,
        round32: 16,
        round16: 8,
        quarterfinal: 4,
        semifinal: 2,
        third_place: 1,
        final: 1,
      },
      'db stage counts',
    );

    const firstMatch = db
      .prepare('SELECT match_no, home_placeholder, away_placeholder, venue, status FROM matches WHERE match_no = 1')
      .get();
    same(firstMatch?.home_placeholder, null, 'db match 1 home_placeholder');
    same(firstMatch?.away_placeholder, null, 'db match 1 away_placeholder');
    same(firstMatch?.venue, 'Mexico City', 'db match 1 venue');
    same(firstMatch?.status, 'finished', 'db match 1 status');

    const settledResult = db
      .prepare(
        `SELECT m.match_no, r.home_score, r.away_score, r.result_1x2, r.handicap_result, r.total_result
         FROM results r
         JOIN matches m ON m.id = r.match_id
         WHERE m.match_no = ?`,
      )
      .get(EXPECTED_SETTLED_RESULT.match_no);
    same(settledResult?.home_score, EXPECTED_SETTLED_RESULT.home_score, 'db match 1 home_score');
    same(settledResult?.away_score, EXPECTED_SETTLED_RESULT.away_score, 'db match 1 away_score');
    same(settledResult?.result_1x2, EXPECTED_SETTLED_RESULT.result_1x2, 'db match 1 result_1x2');
    check(Boolean(settledResult?.handicap_result), 'db match 1 handicap_result should be explicit');
    check(Boolean(settledResult?.total_result), 'db match 1 total_result should be explicit');

    const finalMatch = db.prepare('SELECT match_no, home_placeholder, away_placeholder, venue FROM matches WHERE match_no = 104').get();
    same(finalMatch?.home_placeholder, 'Winner Match 101', 'db match 104 home_placeholder');
    same(finalMatch?.away_placeholder, 'Winner Match 102', 'db match 104 away_placeholder');
    same(finalMatch?.venue, 'New York New Jersey', 'db match 104 venue');
    return { predictions: predictionRows, odds: oddsRows, results: resultRows };
  } finally {
    db.close();
  }
}

verifySchedule();
verifyReport();
const dbStats = verifyDb();

if (failures.length > 0) {
  console.error(`2026 schedule verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('2026 schedule verification passed');
console.log(
  JSON.stringify(
    {
      schedule: path.relative(ROOT_DIR, SCHEDULE_PATH),
      fixtures: 104,
      dateSpanEt: ['2026-06-11', '2026-07-19'],
      dbPredictionRows: dbStats.predictions,
      dbOddsRows: dbStats.odds,
      dbResultRows: dbStats.results,
    },
    null,
    2,
  ),
);
