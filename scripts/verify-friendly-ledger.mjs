#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const INTERNATIONAL_REPORT = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const OFFICIAL_SCHEDULE = path.join(ROOT_DIR, 'data/research/worldcup-2026/official-schedule.json');
const OUTPUT_JSON = path.join(ROOT_DIR, 'reports/friendly-prediction-ledger.json');
const OUTPUT_MD = path.join(ROOT_DIR, 'reports/friendly-prediction-ledger.md');

const TEAM_ALIASES = {
  ALG: ['Algeria'],
  ARG: ['Argentina'],
  AUS: ['Australia'],
  AUT: ['Austria'],
  BEL: ['Belgium'],
  BIH: ['Bosnia and Herzegovina', 'Bosnia & Herzegovina', 'Bosnia'],
  BRA: ['Brazil'],
  CAN: ['Canada'],
  CIV: ['Ivory Coast', "Côte d'Ivoire", 'Cote d Ivoire'],
  COD: ['DR Congo', 'Democratic Republic of Congo'],
  COL: ['Colombia'],
  CPV: ['Cape Verde'],
  CRO: ['Croatia'],
  CUW: ['Curaçao', 'Curacao'],
  CZE: ['Czech Republic', 'Czechia'],
  ECU: ['Ecuador'],
  EGY: ['Egypt'],
  ENG: ['England'],
  ESP: ['Spain'],
  FRA: ['France'],
  GER: ['Germany'],
  GHA: ['Ghana'],
  HAI: ['Haiti'],
  IRN: ['Iran'],
  IRQ: ['Iraq'],
  JOR: ['Jordan'],
  JPN: ['Japan'],
  KOR: ['South Korea', 'Korea Republic'],
  KSA: ['Saudi Arabia'],
  MAR: ['Morocco'],
  MEX: ['Mexico'],
  NED: ['Netherlands'],
  NOR: ['Norway'],
  NZL: ['New Zealand'],
  PAN: ['Panama'],
  PAR: ['Paraguay'],
  POR: ['Portugal'],
  QAT: ['Qatar'],
  RSA: ['South Africa'],
  SCO: ['Scotland'],
  SEN: ['Senegal'],
  SUI: ['Switzerland'],
  SWE: ['Sweden'],
  TUN: ['Tunisia'],
  TUR: ['Turkey'],
  URU: ['Uruguay'],
  USA: ['United States', 'USA'],
  UZB: ['Uzbekistan']
};

const OUTCOME_KEYS = ['home', 'draw', 'away'];
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

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function buildAliasIndex(officialCodes) {
  const index = new Map();
  for (const code of officialCodes) {
    for (const alias of TEAM_ALIASES[code] ?? [code]) {
      index.set(normalizeName(alias), code);
    }
  }
  return index;
}

function outcomeLabel(outcome, row) {
  if (outcome === 'H') return row.home_team;
  if (outcome === 'A') return row.away_team;
  if (outcome === 'D') return 'Draw';
  return '--';
}

function outcomeProbability(probabilities, outcome) {
  if (outcome === 'H') return probabilities?.home;
  if (outcome === 'D') return probabilities?.draw;
  if (outcome === 'A') return probabilities?.away;
  return null;
}

function probabilitySum(probabilities) {
  return OUTCOME_KEYS.reduce((sum, key) => sum + Number(probabilities?.[key] ?? 0), 0);
}

function maxProbability(probabilities) {
  return Math.max(...OUTCOME_KEYS.map((key) => Number(probabilities?.[key] ?? 0)));
}

function parseScoreLabel(score) {
  const match = /^(\d+)-(\d+)$/.exec(String(score ?? '').trim());
  if (!match) return null;
  const homeGoals = Number(match[1]);
  const awayGoals = Number(match[2]);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  return {
    homeGoals,
    awayGoals,
    totalGoals: homeGoals + awayGoals,
    label: `${homeGoals}-${awayGoals}`
  };
}

function candidateScoreLabel(candidate) {
  const homeGoals = Number(candidate?.home_goals);
  const awayGoals = Number(candidate?.away_goals);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
  return `${homeGoals}-${awayGoals}`;
}

function mapScoreReview(row) {
  const model = row.score_model ?? null;
  const actualScore = parseScoreLabel(row.score);
  const goalCandidates = Array.isArray(model?.goal_candidates)
    ? model.goal_candidates
        .map((candidate, index) => {
          const totalGoals = Number(candidate?.total_goals);
          if (!Number.isFinite(totalGoals)) return null;
          return {
            totalGoals,
            probability: round(candidate?.probability, 4),
            primary: candidate?.primary === true || index === 0
          };
        })
        .filter(Boolean)
    : [];
  const scoreCandidates = Array.isArray(model?.score_candidates)
    ? model.score_candidates
        .map((candidate, index) => {
          const homeGoals = Number(candidate?.home_goals);
          const awayGoals = Number(candidate?.away_goals);
          const label = candidateScoreLabel(candidate);
          if (!label || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;
          return {
            score: label,
            homeGoals,
            awayGoals,
            totalGoals: homeGoals + awayGoals,
            probability: round(candidate?.probability, 4),
            primary: candidate?.primary === true || index === 0,
            projected: candidate?.projected === true
          };
        })
        .filter(Boolean)
    : [];
  const generated = Boolean(model) && goalCandidates.length > 0 && scoreCandidates.length > 0;
  const actualTotalGoals = actualScore?.totalGoals ?? null;
  const actualScoreLabel = actualScore?.label ?? row.score ?? null;

  return {
    generated,
    expectedGoals: {
      home: round(model?.expected_home_goals, 3),
      away: round(model?.expected_away_goals, 3),
      total: round(model?.expected_total_goals, 3)
    },
    actualTotalGoals,
    actualScore: actualScoreLabel,
    goalCandidates,
    scoreCandidates,
    goalPrimaryHit:
      generated && Number.isFinite(actualTotalGoals)
        ? goalCandidates[0]?.totalGoals === actualTotalGoals
        : null,
    goalCandidateHit:
      generated && Number.isFinite(actualTotalGoals)
        ? goalCandidates.some((candidate) => candidate.totalGoals === actualTotalGoals)
        : null,
    scorePrimaryHit:
      generated && actualScoreLabel
        ? scoreCandidates[0]?.score === actualScoreLabel
        : null,
    scoreCandidateHit:
      generated && actualScoreLabel
        ? scoreCandidates.some((candidate) => candidate.score === actualScoreLabel)
        : null
  };
}

function buildOfficialTeamContext(schedule) {
  const fixtures = Array.isArray(schedule.fixtures) ? schedule.fixtures : [];
  const teamMap = new Map();

  for (const fixture of fixtures) {
    for (const side of ['home', 'away']) {
      const code = fixture[`${side}_code`];
      const opponentCode = fixture[side === 'home' ? 'away_code' : 'home_code'];
      if (!code) continue;
      if (!teamMap.has(code)) {
        teamMap.set(code, {
          code,
          groupName: fixture.group_name ?? null,
          aliases: TEAM_ALIASES[code] ?? [code],
          fixtures: []
        });
      }
      teamMap.get(code).fixtures.push({
        matchNo: fixture.match_no,
        opponentCode: opponentCode ?? null,
        dateEt: fixture.date_et,
        kickoffUtc: fixture.kickoff_utc,
        venue: fixture.venue,
        stage: fixture.stage,
        groupName: fixture.group_name ?? null
      });
    }
  }

  return teamMap;
}

function summarizeRows(rows) {
  const matches = rows.length;
  const hits = rows.filter((row) => row.correct).length;
  const scoreRows = rows.filter((row) => row.scoreReview?.generated);
  const goalPrimaryHits = scoreRows.filter((row) => row.scoreReview.goalPrimaryHit).length;
  const goalCandidateHits = scoreRows.filter((row) => row.scoreReview.goalCandidateHit).length;
  const scorePrimaryHits = scoreRows.filter((row) => row.scoreReview.scorePrimaryHit).length;
  const scoreCandidateHits = scoreRows.filter((row) => row.scoreReview.scoreCandidateHit).length;
  const avgConfidence =
    matches > 0 ? rows.reduce((sum, row) => sum + Number(row.confidence ?? 0), 0) / matches : null;
  const avgActualProbability =
    matches > 0 ? rows.reduce((sum, row) => sum + Number(row.actualProbability ?? 0), 0) / matches : null;
  return {
    matches,
    hits,
    misses: matches - hits,
    accuracy: matches > 0 ? round(hits / matches, 4) : null,
    avgConfidence: round(avgConfidence, 4),
    avgActualProbability: round(avgActualProbability, 4),
    scoreReview: {
      rows: scoreRows.length,
      goalPrimaryHits,
      goalCandidateHits,
      scorePrimaryHits,
      scoreCandidateHits,
      goalPrimaryAccuracy: scoreRows.length > 0 ? round(goalPrimaryHits / scoreRows.length, 4) : null,
      goalCandidateAccuracy: scoreRows.length > 0 ? round(goalCandidateHits / scoreRows.length, 4) : null,
      scorePrimaryAccuracy: scoreRows.length > 0 ? round(scorePrimaryHits / scoreRows.length, 4) : null,
      scoreCandidateAccuracy: scoreRows.length > 0 ? round(scoreCandidateHits / scoreRows.length, 4) : null
    }
  };
}

function mapFriendlyRow(row, aliasIndex, officialTeamMap) {
  const homeCode = aliasIndex.get(normalizeName(row.home_team)) ?? null;
  const awayCode = aliasIndex.get(normalizeName(row.away_team)) ?? null;
  const involvedCodes = [homeCode, awayCode].filter(Boolean);
  const probabilities = row.primary_probabilities ?? {};

  return {
    date: row.date,
    tournament: row.tournament,
    fixture: `${row.home_team} vs ${row.away_team}`,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    score: row.score,
    pick: row.pick,
    pickLabel: outcomeLabel(row.pick, row),
    actual: row.actual,
    actualLabel: outcomeLabel(row.actual, row),
    correct: row.correct === true,
    confidence: round(maxProbability(probabilities), 4),
    actualProbability: round(outcomeProbability(probabilities, row.actual), 4),
    primarySource: row.primary_source,
    probabilities: {
      home: round(probabilities.home, 4),
      draw: round(probabilities.draw, 4),
      away: round(probabilities.away, 4)
    },
    scoreReview: mapScoreReview(row),
    worldCupRelevance: {
      involved: involvedCodes.length > 0,
      homeCode,
      awayCode,
      involvedCodes,
      officialFixtures: involvedCodes.map((code) => ({
        code,
        groupName: officialTeamMap.get(code)?.groupName ?? null,
        nextFixtures: (officialTeamMap.get(code)?.fixtures ?? []).slice(0, 3)
      }))
    }
  };
}

function renderMarkdown(report) {
  const lines = [
    '# 友谊赛赛前预测核对账本',
    '',
    `生成时间: ${report.generatedAt}`,
    '',
    '这份账本记录世界杯前友谊赛的赛前预测和赛后核对。预测在每场赛果进入模型状态更新前生成；这只是验证工件，不是投注建议。',
    '',
    '## 摘要',
    '',
    '| Window | Matches | Hits | Accuracy | Avg confidence | Goal candidates | Score candidates |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| Latest 24 friendlies | ${report.summary.latest24.matches} | ${report.summary.latest24.hits} | ${pct(report.summary.latest24.accuracy)} | ${pct(report.summary.latest24.avgConfidence)} | ${report.summary.latest24.scoreReview.goalCandidateHits}/${report.summary.latest24.scoreReview.rows} | ${report.summary.latest24.scoreReview.scoreCandidateHits}/${report.summary.latest24.scoreReview.rows} |`,
    `| 2026 World Cup related latest rows | ${report.summary.worldCupRelated.matches} | ${report.summary.worldCupRelated.hits} | ${pct(report.summary.worldCupRelated.accuracy)} | ${pct(report.summary.worldCupRelated.avgConfidence)} | ${report.summary.worldCupRelated.scoreReview.goalCandidateHits}/${report.summary.worldCupRelated.scoreReview.rows} | ${report.summary.worldCupRelated.scoreReview.scoreCandidateHits}/${report.summary.worldCupRelated.scoreReview.rows} |`,
    `| Full 2026 friendly window | ${report.summary.fullWindow.matches} | ${report.summary.fullWindow.hits ?? '--'} | ${pct(report.summary.fullWindow.accuracy)} | ${pct(report.summary.fullWindow.avgConfidence)} | -- | -- |`,
    '',
    '## 守门条件',
    '',
    '| Guardrail | Status |',
    '| --- | --- |',
    ...Object.entries(report.guardrails).map(([key, value]) => `| ${key} | ${value ? 'pass' : 'fail'} |`),
    '',
    '## 最新 24 场逐场账本',
    '',
    '| Date | Match | Score | Pick | Actual | Hit | Goal candidates | Score candidates | WC teams | Confidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: |',
    ...report.matches.map((row) => {
      const wcTeams = row.worldCupRelevance.involvedCodes.length
        ? row.worldCupRelevance.involvedCodes.join(', ')
        : '--';
      const goalCandidates = row.scoreReview.generated
        ? row.scoreReview.goalCandidates.map((candidate) => `${candidate.totalGoals}g`).join(' / ')
        : '--';
      const scoreCandidates = row.scoreReview.generated
        ? row.scoreReview.scoreCandidates.map((candidate) => candidate.score).join(' / ')
        : '--';
      return `| ${row.date} | ${row.fixture} | ${row.score} | ${row.pickLabel} | ${row.actualLabel} | ${
        row.correct ? 'yes' : 'no'
      } | ${goalCandidates} | ${scoreCandidates} | ${wcTeams} | ${pct(row.confidence)} |`;
    })
  ];
  return `${lines.join('\n')}\n`;
}

function unscoredWorldCupRowsAreQuarantined(sourceQuarantine) {
  const unscoredRows = Number(sourceQuarantine.unscored_2026_world_cup_rows ?? 0);
  const incompleteWorldCupRows = Number(sourceQuarantine.incomplete_rows_by_tournament?.['FIFA World Cup'] ?? 0);
  return (
    sourceQuarantine.uses_international_results_2026_fixtures === false &&
    Number.isInteger(unscoredRows) &&
    unscoredRows >= 0 &&
    incompleteWorldCupRows === unscoredRows
  );
}

check(fs.existsSync(INTERNATIONAL_REPORT), `missing international report: ${path.relative(ROOT_DIR, INTERNATIONAL_REPORT)}`);
check(fs.existsSync(OFFICIAL_SCHEDULE), `missing official schedule: ${path.relative(ROOT_DIR, OFFICIAL_SCHEDULE)}`);

let output = {
  ok: false,
  generatedAt: new Date().toISOString(),
  file: 'reports/friendly-prediction-ledger.json',
  markdown: 'reports/friendly-prediction-ledger.md',
  failures
};

if (fs.existsSync(INTERNATIONAL_REPORT) && fs.existsSync(OFFICIAL_SCHEDULE)) {
  const international = readJson(INTERNATIONAL_REPORT);
  const schedule = readJson(OFFICIAL_SCHEDULE);
  const audit = international.friendly_audit ?? {};
  const gate = international.friendly_window_stability?.promotion_gate ?? {};
  const sourceQuarantine = international.source_quarantine ?? {};
  const officialTeamMap = buildOfficialTeamContext(schedule);
  const aliasIndex = buildAliasIndex(officialTeamMap.keys());
  const rawRows = Array.isArray(audit.matches) ? audit.matches : [];
  const matches = rawRows.map((row) => mapFriendlyRow(row, aliasIndex, officialTeamMap));
  const relatedRows = matches.filter((row) => row.worldCupRelevance.involved);
  const recomputed = summarizeRows(matches);
  const relatedSummary = summarizeRows(relatedRows);
  const fullWindowPrimary = audit.full_window?.primary ?? {};
  const fullWindow = {
    matches: audit.full_window?.evaluated_matches ?? fullWindowPrimary.matches ?? null,
    hits: null,
    accuracy: fullWindowPrimary.accuracy ?? null,
    avgConfidence: fullWindowPrimary.avg_confidence ?? null,
    calibrationError: fullWindowPrimary.calibration_error ?? null,
    logLoss: fullWindowPrimary.log_loss ?? null
  };
  const probabilityRowsValid = matches.every((row) => {
    const sum = probabilitySum(row.probabilities);
    return (
      OUTCOME_KEYS.every((key) => Number.isFinite(row.probabilities[key])) &&
      Math.abs(sum - 1) <= 0.002 &&
      Number.isFinite(row.confidence) &&
      Number.isFinite(row.actualProbability)
    );
  });
  const scoreRowsValid = matches.every((row) => (
    row.scoreReview?.generated === true &&
    Number.isFinite(row.scoreReview.actualTotalGoals) &&
    row.scoreReview.goalCandidates.length >= 2 &&
    row.scoreReview.scoreCandidates.length >= 3 &&
    typeof row.scoreReview.goalCandidateHit === 'boolean' &&
    typeof row.scoreReview.scoreCandidateHit === 'boolean'
  ));
  const latestAccuracyMatchesReport =
    Number.isFinite(audit.primary?.accuracy) && Math.abs(recomputed.accuracy - audit.primary.accuracy) <= 0.0005;

  const guardrails = {
    sourceReportPresent: true,
    officialSchedulePresent: schedule.status === 'official_schedule_parsed' && schedule.match_count === 104,
    latest24RowsRecorded: matches.length === 24 && audit.evaluated_matches === 24,
    fullWindowGuardrailApplied: Number(audit.full_window?.evaluated_matches ?? 0) >= 100,
    probabilityRowsValid,
    scoreRowsValid,
    latestAccuracyRecomputed: latestAccuracyMatchesReport,
    worldCupRelatedRowsPresent: relatedRows.length >= 8,
    incompleteWorldCupRowsQuarantined: unscoredWorldCupRowsAreQuarantined(sourceQuarantine),
    friendlySignalMarketBlocked:
      ['hold', 'eligible_for_model_review'].includes(gate.decision) &&
      gate.can_drive_market_recommendation === false
  };

  check(audit.tournament === 'Friendly', 'friendly_audit.tournament must be Friendly');
  check(audit.selection === 'latest_completed_matches_in_window', 'friendly audit must use latest completed rows');
  check(guardrails.officialSchedulePresent, 'official schedule must be parsed and contain 104 matches');
  check(guardrails.latest24RowsRecorded, 'friendly ledger must record exactly latest 24 completed rows');
  check(guardrails.fullWindowGuardrailApplied, 'friendly full-window guardrail must include at least 100 matches');
  check(guardrails.probabilityRowsValid, 'friendly rows must include valid 1X2 probabilities');
  check(guardrails.scoreRowsValid, 'friendly rows must include generated pre-match goal and score candidates');
  check(guardrails.latestAccuracyRecomputed, 'friendly latest-24 accuracy must recompute from row hits');
  check(guardrails.worldCupRelatedRowsPresent, 'friendly latest-24 should include enough official 2026 team rows');
  check(guardrails.incompleteWorldCupRowsQuarantined, 'unscored 2026 World Cup rows must stay quarantined');
  check(guardrails.friendlySignalMarketBlocked, 'friendly signal must not drive market recommendations without odds and lineups');

  output = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    file: 'reports/friendly-prediction-ledger.json',
    markdown: 'reports/friendly-prediction-ledger.md',
    source: {
      report: 'reports/international-model-evaluation.json',
      dataset: international.data_source?.name,
      raw: international.data_source?.raw_csv,
      schedule: 'data/research/worldcup-2026/official-schedule.json'
    },
    method:
      '使用 2026 世界杯前窗口最新 24 场已完赛友谊赛；每场预测都来自国际赛 walk-forward 报告中“赛果更新模型状态之前”的预测快照。',
    window: {
      startDate: audit.start_date,
      endDate: audit.end_date,
      requestedLimit: audit.requested_limit,
      selection: audit.selection,
      availableMatches: audit.available_matches,
      evaluatedMatches: audit.evaluated_matches
    },
    summary: {
      latest24: {
        ...recomputed,
        reportedAccuracy: audit.primary?.accuracy ?? null,
        logLoss: audit.primary?.log_loss ?? null,
        calibrationError: audit.primary?.calibration_error ?? null
      },
      worldCupRelated: relatedSummary,
      fullWindow,
      promotionGate: {
        decision: gate.decision ?? null,
        promoteFriendlySignal: gate.promote_2026_friendly_signal ?? null,
        canDriveMarketRecommendation: gate.can_drive_market_recommendation ?? null,
        blockedReasons: gate.blocked_reasons ?? []
      }
    },
    guardrails,
    matches,
    failures
  };
}

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(OUTPUT_MD, renderMarkdown(output));

if (failures.length > 0) {
  console.error(`Friendly ledger verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`Report: ${path.relative(ROOT_DIR, OUTPUT_JSON)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: path.relative(ROOT_DIR, OUTPUT_JSON),
      latest24: output.summary.latest24,
      worldCupRelated: output.summary.worldCupRelated,
      promotionGate: output.summary.promotionGate
    },
    null,
    2
  )
);
