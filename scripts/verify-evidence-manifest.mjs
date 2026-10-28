#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../server/db/connection.mjs';
import { officialResults } from '../server/data/officialResults.mjs';
import { predictionUsableSourceSqlList } from '../server/services/oddsSourcePolicy.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const OUTPUT_JSON = path.join(ROOT_DIR, 'reports/evidence-manifest.json');
const OUTPUT_MD = path.join(ROOT_DIR, 'reports/evidence-manifest.md');

const CORE_FILES = [
  'data/research/international-results/results.csv',
  'data/research/worldcup-2026/FWC26-Match-Schedule_English.pdf',
  'data/research/worldcup-2026/official-schedule.json',
  'data/research/worldcup-2026/odds-source-audit.json',
  'reports/historical-model-evaluation.json',
  'reports/international-model-evaluation.json',
  'reports/major-tournament-audit.json',
  'reports/friendly-prediction-ledger.json',
  'reports/group-advancement-audit.json',
  'reports/preview-decision-audit.json',
  'reports/model-change-impact-audit.json',
  'reports/model-iteration-audit.json',
  'reports/promotion-gate-audit.json'
];

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function rel(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

function abs(relativePath) {
  return path.join(ROOT_DIR, relativePath);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(abs(relativePath), 'utf8'));
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function fileRecord(relativePath) {
  const filePath = abs(relativePath);
  if (!fs.existsSync(filePath)) {
    return {
      path: relativePath,
      exists: false
    };
  }
  const stat = fs.statSync(filePath);
  return {
    path: relativePath,
    exists: true,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256File(filePath)
  };
}

function countCsvRows(relativePath) {
  const text = fs.readFileSync(abs(relativePath), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  if (!text) return 0;
  return Math.max(0, text.split('\n').length - 1);
}

function generatedAt(report) {
  const value = report?.generatedAt ?? report?.generated_at;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function generatedAfter(left, right) {
  const leftTime = generatedAt(left);
  const rightTime = generatedAt(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime >= rightTime;
}

function stageCountsFromDb(db) {
  return Object.fromEntries(
    db.prepare('SELECT stage, COUNT(*) AS count FROM matches GROUP BY stage ORDER BY stage').all().map((row) => [
      row.stage,
      row.count
    ])
  );
}

function tableCounts(db) {
  const tables = ['teams', 'matches', 'odds_snapshots', 'predictions', 'results', 'match_tags', 'import_runs'];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
}

function renderMarkdown(report) {
  const lines = [
    '# Evidence Manifest',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This manifest ties the local data files, report files, and SQLite state together with SHA-256 fingerprints and cross-checks. It is the final reproducibility guard for the current prediction workbench state.',
    '',
    '## Summary',
    '',
    '| Item | Value |',
    '| --- | ---: |',
    `| Core files | ${report.files.core.length} |`,
    `| Football-data CSV files | ${report.files.footballData.count} |`,
    `| DB matches | ${report.database.counts.matches} |`,
    `| DB odds snapshots | ${report.database.counts.odds_snapshots} |`,
    `| DB verified odds snapshots | ${report.database.verifiedOddsSnapshotCount} |`,
    `| DB predictions | ${report.database.counts.predictions} |`,
    `| DB results | ${report.database.counts.results} |`,
    `| Promotion status | ${report.reports.promotion.status} |`,
    '',
    '## Guardrails',
    '',
    '| Guardrail | Status |',
    '| --- | --- |',
    ...Object.entries(report.guardrails).map(([key, value]) => `| ${key} | ${value ? 'pass' : 'fail'} |`),
    '',
    '## Core Files',
    '',
    '| File | Bytes | SHA-256 |',
    '| --- | ---: | --- |',
    ...report.files.core.map((file) => `| ${file.path} | ${file.bytes ?? '--'} | ${file.sha256 ?? 'missing'} |`)
  ];
  return `${lines.join('\n')}\n`;
}

for (const relativePath of CORE_FILES) {
  check(fs.existsSync(abs(relativePath)), `missing core evidence file: ${relativePath}`);
}

let manifest = {
  ok: false,
  generatedAt: new Date().toISOString(),
  file: 'reports/evidence-manifest.json',
  markdown: 'reports/evidence-manifest.md',
  failures
};

if (CORE_FILES.every((relativePath) => fs.existsSync(abs(relativePath)))) {
  const officialSchedule = readJson('data/research/worldcup-2026/official-schedule.json');
  const oddsAudit = readJson('data/research/worldcup-2026/odds-source-audit.json');
  const historical = readJson('reports/historical-model-evaluation.json');
  const international = readJson('reports/international-model-evaluation.json');
  const major = readJson('reports/major-tournament-audit.json');
  const friendly = readJson('reports/friendly-prediction-ledger.json');
  const groupAdvancement = readJson('reports/group-advancement-audit.json');
  const preview = readJson('reports/preview-decision-audit.json');
  const impact = readJson('reports/model-change-impact-audit.json');
  const iteration = readJson('reports/model-iteration-audit.json');
  const promotion = readJson('reports/promotion-gate-audit.json');
  const footballDataFiles = Array.isArray(historical.files)
    ? historical.files.map((file) => path.relative(ROOT_DIR, file.filePath)).sort()
    : [];
  const footballDataRecords = footballDataFiles.map(fileRecord);
  const footballDataAggregateHash = crypto
    .createHash('sha256')
    .update(footballDataRecords.map((record) => `${record.path}:${record.sha256}`).join('\n'))
    .digest('hex');

  const db = openDatabase();
  const counts = tableCounts(db);
  const dbStageCounts = stageCountsFromDb(db);
  const predictedMatchCount = db.prepare('SELECT COUNT(DISTINCT match_id) AS count FROM predictions').get().count;
  const oddsMatchCount = db.prepare('SELECT COUNT(DISTINCT match_id) AS count FROM odds_snapshots').get().count;
  const verifiedOddsSnapshotCount = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.source_type IN (${predictionUsableSourceSqlList()})
         AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
         AND datetime(os.captured_at) < datetime(m.kickoff_utc)`
    )
    .get().count;
  const verifiedOddsMatchCount = db
    .prepare(
      `SELECT COUNT(DISTINCT match_id) AS count
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.source_type IN (${predictionUsableSourceSqlList()})
         AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
         AND datetime(os.captured_at) < datetime(m.kickoff_utc)`
    )
    .get().count;
  const unverifiedPredictionRows = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM predictions p
       JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
       WHERE o.source_type NOT IN (${predictionUsableSourceSqlList()})`
    )
    .get().count;
  const officialResultEntries = officialResults.map((entry) => ({
    matchNo: Number(entry.matchNo),
    homeScore: Number(entry.homeScore),
    awayScore: Number(entry.awayScore)
  }));
  const officialResultMatchNos = officialResultEntries.map((entry) => entry.matchNo);
  const resultRows = db
    .prepare(
      `SELECT m.match_no, m.status, r.home_score, r.away_score, r.result_1x2, r.handicap_result, r.total_result
       FROM results r
       JOIN matches m ON m.id = r.match_id`
    )
    .all();
  const resultByMatchNo = new Map(resultRows.map((row) => [Number(row.match_no), row]));
  const knownOfficialResultRows = officialResultEntries.filter((entry) => {
    const row = resultByMatchNo.get(entry.matchNo);
    return (
      row?.status === 'finished' &&
      Number(row.home_score) === entry.homeScore &&
      Number(row.away_score) === entry.awayScore &&
      row.result_1x2 != null &&
      row.handicap_result != null &&
      row.total_result != null
    );
  }).length;
  const unexpectedResultRows = resultRows.filter((row) => !officialResultMatchNos.includes(Number(row.match_no))).length;
  db.close();

  const historicalSourceRows = historical.files?.reduce((sum, file) => sum + Number(file.rows ?? 0), 0) ?? null;
  const internationalCsvRows = countCsvRows('data/research/international-results/results.csv');
  const officialGroupMatches = Number(officialSchedule.stage_counts?.group_stage ?? 0);
  const scheduleStageCountsMapped = {
    group: officialSchedule.stage_counts?.group_stage,
    round32: officialSchedule.stage_counts?.round_of_32,
    round16: officialSchedule.stage_counts?.round_of_16,
    quarterfinal: officialSchedule.stage_counts?.quarter_final,
    semifinal: officialSchedule.stage_counts?.semi_final,
    third_place: officialSchedule.stage_counts?.third_place,
    final: officialSchedule.stage_counts?.final
  };

  const guardrails = {
    coreFilesExist: CORE_FILES.every((relativePath) => fs.existsSync(abs(relativePath))),
    coreFilesHashed: CORE_FILES.every((relativePath) => fileRecord(relativePath).sha256?.length === 64),
    footballDataFilesPresent: footballDataRecords.length === 25 && footballDataRecords.every((record) => record.exists),
    footballDataRowsMatchReport:
      historicalSourceRows === historical.evaluation?.overall?.blended?.matches &&
      historicalSourceRows === historical.evaluation?.overall?.market_only?.matches,
    internationalRowsMatchCsv: international.source_rows === internationalCsvRows,
    officialScheduleMatchesAlign:
      officialSchedule.status === 'official_schedule_parsed' &&
      officialSchedule.match_count === 104 &&
      officialSchedule.fixtures?.length === 104 &&
      counts.matches === 104,
    officialScheduleStageCountsAlign:
      Object.entries(scheduleStageCountsMapped).every(([stage, count]) => Number(dbStageCounts[stage] ?? 0) === Number(count ?? -1)) &&
      officialGroupMatches === 72,
    oddsSnapshotsAlign:
      oddsAudit.status === 'complete_market_odds_imported' &&
      Number(oddsAudit.importSummary?.databaseSnapshotsAvailable ?? 0) === counts.odds_snapshots &&
      Number(oddsAudit.importSummary?.verifiedSnapshotsAvailable ?? 0) === verifiedOddsSnapshotCount &&
      Number(preview.availableSnapshots ?? 0) === verifiedOddsSnapshotCount,
    predictionsAlign:
      Number(preview.predictionCount ?? -1) === counts.predictions &&
      counts.predictions > 0 &&
      predictedMatchCount > 0 &&
      predictedMatchCount <= verifiedOddsMatchCount &&
      unverifiedPredictionRows === 0,
    officialResultsScoped:
      counts.results === officialResultEntries.length &&
      knownOfficialResultRows === officialResultEntries.length &&
      unexpectedResultRows === 0 &&
      international.source_quarantine?.uses_international_results_2026_fixtures === false &&
      international.future_predictions?.length === 0,
    downstreamReportsOk:
      major.ok === true &&
      friendly.ok === true &&
      groupAdvancement.ok === true &&
      preview.ok === true &&
      impact.ok === true &&
      iteration.ok === true &&
      promotion.ok === true,
    promotionStatusPreviewOnly: promotion.status === 'preview_only_no_promotion',
    generationOrderValid:
      generatedAfter(major, international) &&
      generatedAfter(friendly, international) &&
      generatedAfter(groupAdvancement, international) &&
      generatedAfter(iteration, impact) &&
      generatedAfter(iteration, friendly) &&
      generatedAfter(iteration, major) &&
      generatedAfter(iteration, groupAdvancement) &&
      generatedAfter(promotion, iteration) &&
      generatedAfter(promotion, preview),
    noDirectRecommendation:
      Number(iteration.summary?.canDrive2026Recommendation ?? 1) === 0 &&
      promotion.status === 'preview_only_no_promotion' &&
      preview.guardrails?.noStandaloneBettingAdvice === true &&
      preview.guardrails?.parlaysBlockedUntilFullInputs === true,
    groupAdvancementRecomputed:
      groupAdvancement.guardrails?.totalSlotsReconcile === true &&
      groupAdvancement.guardrails?.belgiumNoLongerTemplateLow === true &&
      groupAdvancement.guardrails?.spainNoLongerTemplateLow === true &&
      Number(groupAdvancement.focus?.belgium?.advanceProbability ?? 0) >= 75 &&
      Number(groupAdvancement.focus?.spain?.advanceProbability ?? 0) >= 90
  };

  for (const [key, value] of Object.entries(guardrails)) {
    check(value === true, `evidence manifest guardrail failed: ${key}`);
  }

  manifest = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    file: 'reports/evidence-manifest.json',
    markdown: 'reports/evidence-manifest.md',
    method:
      '记录核心数据、报告和 SQLite 当前状态的 SHA-256 指纹及口径对齐检查；用于证明页面和推荐门槛来自同一批可追溯证据。',
    files: {
      core: CORE_FILES.map(fileRecord),
      footballData: {
        count: footballDataRecords.length,
        aggregateSha256: footballDataAggregateHash,
        rows: historicalSourceRows,
        files: footballDataRecords
      }
    },
    database: {
      counts,
      stageCounts: dbStageCounts,
      predictedMatchCount,
      oddsMatchCount,
      verifiedOddsSnapshotCount,
      verifiedOddsMatchCount,
      unverifiedPredictionRows,
      knownOfficialResultRows,
      unexpectedResultRows
    },
    reports: {
      historical: {
        generatedAt: historical.generated_at,
        sourceRows: historicalSourceRows,
        seasons: historical.seasons,
        leagues: historical.leagues,
        marketLogLoss: historical.evaluation?.overall?.market_only?.log_loss,
        blendedLogLoss: historical.evaluation?.overall?.blended?.log_loss
      },
      international: {
        generatedAt: international.generated_at,
        sourceRows: international.source_rows,
        csvRows: internationalCsvRows,
        evaluatedMatches: international.evaluated_matches,
        futurePredictions: international.future_predictions?.length,
        quarantinedWorldCupRows: international.source_quarantine?.unscored_2026_world_cup_rows
      },
      officialSchedule: {
        generatedAt: officialSchedule.generated_at,
        matchCount: officialSchedule.match_count,
        dateSpanEt: officialSchedule.date_span_et,
        stageCounts: officialSchedule.stage_counts
      },
      groupAdvancement: {
        generatedAt: groupAdvancement.generatedAt,
        simulationCount: groupAdvancement.summary?.simulationCount,
        totalAdvanceProbability: groupAdvancement.summary?.totalAdvanceProbability,
        belgium: groupAdvancement.focus?.belgium,
        spain: groupAdvancement.focus?.spain
      },
      odds: {
        generatedAt: oddsAudit.generatedAt,
        status: oddsAudit.status,
        verifiedSnapshotsAvailable: oddsAudit.importSummary?.verifiedSnapshotsAvailable,
        rowsImported: oddsAudit.importSummary?.rowsImported
      },
      preview: {
        generatedAt: preview.generatedAt,
        predictionCount: preview.predictionCount,
        availableSnapshots: preview.availableSnapshots,
        tierCounts: preview.tierCounts
      },
      promotion: {
        generatedAt: promotion.generatedAt,
        ok: promotion.ok,
        status: promotion.status,
        checks: promotion.checks?.length
      }
    },
    guardrails,
    failures
  };
}

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(OUTPUT_MD, renderMarkdown(manifest));

if (failures.length > 0) {
  console.error(`Evidence manifest failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, OUTPUT_JSON)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: path.relative(ROOT_DIR, OUTPUT_JSON),
      database: manifest.database.counts,
      guardrails: manifest.guardrails
    },
    null,
    2
  )
);
