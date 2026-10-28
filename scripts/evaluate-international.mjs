#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScoreModel } from '../server/model/poisson.mjs';
import { clamp, normalize, round } from '../server/model/math.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data', 'research', 'international-results');
const REPORT_DIR = path.join(ROOT_DIR, 'reports');
const CACHE_FILE = path.join(DATA_DIR, 'results.csv');
const REPORT_JSON = path.join(REPORT_DIR, 'international-model-evaluation.json');
const REPORT_MD = path.join(REPORT_DIR, 'international-model-evaluation.md');
const PREDICTION_LEDGER_JSON = path.join(REPORT_DIR, 'international-model-prediction-ledger.json');

const DATA_URL =
  'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const SOURCE_PAGE = 'https://github.com/martj42/international_results';
const OFFICIAL_2026_SCHEDULE_SOURCE =
  'https://inside.fifa.com/organisation/media-releases/updated-world-cup-2026-match-schedule-venues-kick-off-times-104-matches';
const OFFICIAL_2026_SCHEDULE_PAGE =
  'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums';
const OFFICIAL_2026_SCHEDULE_PDF =
  'https://digitalhub.fifa.com/asset/4b5d4417-3343-4732-9cdf-14b6662af407/FWC26-Match-Schedule_English.pdf';
const OFFICIAL_2026_SCHEDULE_FILE = path.join(
  ROOT_DIR,
  'data',
  'research',
  'worldcup-2026',
  'official-schedule.json',
);

const OUTCOMES = ['H', 'D', 'A'];
const DEFAULT_WARMUP_START = '1990-01-01';
const DEFAULT_EVAL_START = '2002-01-01';
const DEFAULT_FRIENDLY_AUDIT_START = '2026-01-01';
const DEFAULT_FRIENDLY_AUDIT_END = '2026-06-10';
const DEFAULT_FRIENDLY_AUDIT_LIMIT = 24;
const FRIENDLY_PROMOTION_PRIOR_CYCLE_MIN = 6;
const FRIENDLY_PROMOTION_FULL_WINDOW_MATCH_MIN = 100;
const FRIENDLY_PROMOTION_ACCURACY_DELTA_MAX = 0.08;
const FRIENDLY_PROMOTION_ACCURACY_Z_MAX = 2;
const WORLD_CUP_FRIENDLY_AUDIT_WINDOWS = [
  {
    edition: '2002 World Cup',
    tournament_start_date: '2002-05-31',
    start_date: '2002-01-01',
    end_date: '2002-05-30',
  },
  {
    edition: '2006 World Cup',
    tournament_start_date: '2006-06-09',
    start_date: '2006-01-01',
    end_date: '2006-06-08',
  },
  {
    edition: '2010 World Cup',
    tournament_start_date: '2010-06-11',
    start_date: '2010-01-01',
    end_date: '2010-06-10',
  },
  {
    edition: '2014 World Cup',
    tournament_start_date: '2014-06-12',
    start_date: '2014-01-01',
    end_date: '2014-06-11',
  },
  {
    edition: '2018 World Cup',
    tournament_start_date: '2018-06-14',
    start_date: '2018-01-01',
    end_date: '2018-06-13',
  },
  {
    edition: '2022 World Cup',
    tournament_start_date: '2022-11-20',
    start_date: '2022-01-01',
    end_date: '2022-11-19',
  },
  {
    edition: '2026 World Cup',
    tournament_start_date: '2026-06-11',
    start_date: DEFAULT_FRIENDLY_AUDIT_START,
    end_date: DEFAULT_FRIENDLY_AUDIT_END,
  },
];

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  if (!arg) return fallback;
  return arg.slice(prefix.length);
}

function readNumberOption(name, fallback) {
  const value = Number(readOption(name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  if (!headers) return [];

  return records
    .filter((record) => record.length === headers.length)
    .map((record) =>
      Object.fromEntries(headers.map((header, index) => [header.trim(), record[index]?.trim() ?? ''])),
    );
}

async function ensureData(refresh = false) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!refresh) {
    try {
      const cached = await fs.readFile(CACHE_FILE, 'utf8');
      if (cached.includes('date,home_team,away_team')) return cached;
    } catch {
      // Cache miss, fetch below.
    }
  }

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch international results: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  await fs.writeFile(CACHE_FILE, text);
  return text;
}

function parseDate(raw) {
  const [year, month, day] = raw.split('-').map((value) => Number(value));
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseScore(raw) {
  if (raw === null || raw === undefined || raw === '' || raw.toUpperCase() === 'NA') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function plainText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeName(value) {
  return plainText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function classifyTournament(tournament) {
  const plain = plainText(tournament);
  const lower = plain.toLowerCase();

  if (plain === 'FIFA World Cup') {
    return {
      group: 'FIFA World Cup',
      majorFinal: true,
      importance: 1.24,
    };
  }
  if (plain === 'UEFA Euro') {
    return {
      group: 'UEFA Euro',
      majorFinal: true,
      importance: 1.16,
    };
  }
  if (plain === 'Copa America') {
    return {
      group: 'Copa America',
      majorFinal: true,
      importance: 1.13,
    };
  }
  if (plain === 'FIFA World Cup qualification') {
    return {
      group: 'FIFA World Cup qualification',
      majorFinal: false,
      importance: 0.94,
    };
  }
  if (plain === 'UEFA Euro qualification') {
    return {
      group: 'UEFA Euro qualification',
      majorFinal: false,
      importance: 0.9,
    };
  }
  if (lower.includes('qualification')) {
    return {
      group: 'Other qualification',
      majorFinal: false,
      importance: 0.84,
    };
  }
  if (plain === 'Friendly') {
    return {
      group: 'Friendly',
      majorFinal: false,
      importance: 0.55,
    };
  }
  if (
    lower.includes('cup') ||
    lower.includes('championship') ||
    lower.includes('nations league') ||
    lower.includes('olympic')
  ) {
    return {
      group: 'Other tournaments',
      majorFinal: false,
      importance: 1.0,
    };
  }
  return {
    group: 'Other internationals',
    majorFinal: false,
    importance: 0.76,
  };
}

function toMatch(row, rowIndex) {
  const date = parseDate(row.date);
  const homeScore = parseScore(row.home_score);
  const awayScore = parseScore(row.away_score);
  const tournamentInfo = classifyTournament(row.tournament);
  const hasScore = homeScore !== null && awayScore !== null;

  return {
    id: rowIndex + 1,
    date,
    dateKey: row.date,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    homeScore,
    awayScore,
    hasScore,
    tournament: row.tournament,
    city: row.city,
    country: row.country,
    neutral: row.neutral === 'TRUE',
    outcome: hasScore ? (homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D') : null,
    ...tournamentInfo,
  };
}

function matchIdentityKey(match) {
  return [
    match.dateKey,
    normalizeName(match.homeTeam),
    normalizeName(match.awayTeam),
    match.hasScore ? String(match.homeScore) : '',
    match.hasScore ? String(match.awayScore) : '',
    plainText(match.tournament).toLowerCase(),
    match.neutral ? 'neutral' : 'home-away',
  ].join('|');
}

function locationLabel(match) {
  return [match.city, match.country].filter(Boolean).join(', ') || 'n/a';
}

function dedupeMatches(matches) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];

  for (const match of matches) {
    const key = matchIdentityKey(match);
    const kept = seen.get(key);
    if (kept) {
      duplicates.push({
        key,
        kept_id: kept.id,
        duplicate_id: match.id,
        date: match.dateKey,
        tournament: match.tournament,
        home_team: match.homeTeam,
        away_team: match.awayTeam,
        score: match.hasScore ? `${match.homeScore}-${match.awayScore}` : 'n/a',
        kept_location: locationLabel(kept),
        duplicate_location: locationLabel(match),
        neutral: match.neutral,
      });
      continue;
    }

    seen.set(key, match);
    unique.push(match);
  }

  return { matches: unique, duplicates };
}

function countBy(matches, keyFn) {
  return matches.reduce((counts, match) => {
    const key = keyFn(match) || 'Unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function dateSpan(matches) {
  if (!matches.length) return null;
  const sorted = [...matches].sort((a, b) => a.date - b.date || a.id - b.id);
  return [sorted[0].dateKey, sorted[sorted.length - 1].dateKey];
}

function isUnverified2026WorldCupFixture(match) {
  return (
    !match.hasScore &&
    plainText(match.tournament) === 'FIFA World Cup' &&
    match.date?.getUTCFullYear() === 2026
  );
}

function summarizeMissingScoreRow(match) {
  return {
    date: match.dateKey,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    city: match.city,
    country: match.country,
    tournament: match.tournament,
    score_status: 'missing_score',
  };
}

function buildSourceQuarantine({
  sourceRows,
  rawMatches,
  duplicateRows,
  completedMatches,
  incompleteMatches,
  unverifiedFutureWorldCupFixtures,
  officialScheduleAudit,
}) {
  return {
    source_dataset: 'martj42/international_results',
    source_url: SOURCE_PAGE,
    raw_csv: DATA_URL,
    trusted_2026_fixture_source: officialScheduleAudit?.source_page ?? OFFICIAL_2026_SCHEDULE_PAGE,
    trusted_2026_fixture_file: path.relative(ROOT_DIR, OFFICIAL_2026_SCHEDULE_FILE),
    uses_international_results_2026_fixtures: false,
    training_and_evaluation_policy: 'completed_rows_only',
    rule:
      'Rows without complete scores are quarantined before warmup, walk-forward evaluation, friendly audit, and future prediction output. The official 2026 FIFA fixture adapter is the only trusted 2026 World Cup schedule source.',
    raw_rows: sourceRows,
    usable_rows: rawMatches.length,
    duplicate_rows_removed: duplicateRows.length,
    completed_rows: completedMatches.length,
    incomplete_rows: incompleteMatches.length,
    incomplete_rows_by_tournament: countBy(incompleteMatches, (match) => plainText(match.tournament)),
    unscored_2026_world_cup_rows: unverifiedFutureWorldCupFixtures.length,
    unscored_2026_world_cup_date_span: dateSpan(unverifiedFutureWorldCupFixtures),
    sample_unscored_2026_world_cup_rows: unverifiedFutureWorldCupFixtures
      .slice(0, 8)
      .map(summarizeMissingScoreRow),
  };
}

function defaultTeam() {
  return {
    elo: 1500,
    matches: 0,
    goalsFor: 1.15,
    goalsAgainst: 1.15,
  };
}

function makeState() {
  return {
    matches: 0,
    teams: new Map(),
    groups: new Map(),
    homeGoals: 1.34,
    awayGoals: 1.03,
    neutralGoals: 1.12,
    eloLogLossEwma: Math.log(3),
    goalLogLossEwma: Math.log(3),
    blendLogLossEwma: Math.log(3),
    drawPredEwma: 0.27,
    drawActualEwma: 0.27,
  };
}

function makeGroupPerformance() {
  return {
    count: 0,
    eloLogLossEwma: Math.log(3),
    blendLogLossEwma: Math.log(3),
    drawPredEwma: 0.27,
    drawActualEwma: 0.27,
  };
}

function getTeam(state, name) {
  if (!state.teams.has(name)) state.teams.set(name, defaultTeam());
  return state.teams.get(name);
}

function getGroupPerformance(state, group) {
  if (!state.groups.has(group)) state.groups.set(group, makeGroupPerformance());
  return state.groups.get(group);
}

function sigmoidElo(diff) {
  return 1 / (1 + 10 ** (-diff / 430));
}

function homeAdvantage(match) {
  if (match.neutral) return 0;
  const hostCountry = normalizeName(match.country);
  const homeTeam = normalizeName(match.homeTeam);
  if (hostCountry && hostCountry === homeTeam) return 70;
  return 45;
}

function outcomeIndex(outcome) {
  return OUTCOMES.indexOf(outcome);
}

function logLoss(probabilities, outcome) {
  return -Math.log(Math.max(probabilities[outcomeIndex(outcome)], 1e-12));
}

function argmax(values) {
  return values.reduce((bestIndex, value, index) => (value > values[bestIndex] ? index : bestIndex), 0);
}

function pickOutcome(probabilities) {
  return OUTCOMES[argmax(probabilities)];
}

function choosePrimaryProbabilities(state, match, elo, blended) {
  const group = getGroupPerformance(state, match.group);
  const groupReady = group.count >= (match.majorFinal ? 40 : 120);
  const groupBlendBetter = group.blendLogLossEwma + 0.004 < group.eloLogLossEwma;
  const worldCupBlendCompetitive = group.blendLogLossEwma <= group.eloLogLossEwma + 0.018;
  const globalBlendBetter = state.blendLogLossEwma + 0.004 < state.eloLogLossEwma;
  const preferBlend = groupReady
    ? match.group === 'FIFA World Cup'
      ? worldCupBlendCompetitive
      : groupBlendBetter
    : match.majorFinal || globalBlendBetter;
  return {
    probabilities: preferBlend ? blended : elo,
    source: preferBlend ? 'blend' : 'elo',
  };
}

function makeMetrics() {
  return {
    count: 0,
    logLoss: 0,
    brier: 0,
    correct: 0,
    confidence: 0,
    drawProbability: 0,
    drawActual: 0,
    bins: Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, accuracy: 0 })),
  };
}

function addMetrics(metrics, probabilities, outcome) {
  const actualIndex = outcomeIndex(outcome);
  const predictedIndex = argmax(probabilities);
  const confidence = probabilities[predictedIndex];
  const binIndex = Math.min(9, Math.floor(confidence * 10));
  metrics.count += 1;
  metrics.logLoss += logLoss(probabilities, outcome);
  metrics.correct += predictedIndex === actualIndex ? 1 : 0;
  metrics.confidence += confidence;
  metrics.drawProbability += probabilities[1];
  metrics.drawActual += outcome === 'D' ? 1 : 0;
  metrics.brier += probabilities.reduce((sum, probability, index) => {
    const actual = index === actualIndex ? 1 : 0;
    return sum + (probability - actual) ** 2;
  }, 0);
  metrics.bins[binIndex].count += 1;
  metrics.bins[binIndex].confidence += confidence;
  metrics.bins[binIndex].accuracy += predictedIndex === actualIndex ? 1 : 0;
}

function finalizeMetrics(metrics) {
  if (!metrics.count) {
    return {
      matches: 0,
      log_loss: null,
      brier: null,
      accuracy: null,
      avg_confidence: null,
      draw_probability: null,
      draw_actual: null,
      calibration_gap: null,
      calibration_error: null,
      reliability_bins: [],
    };
  }
  const accuracy = metrics.correct / metrics.count;
  const avgConfidence = metrics.confidence / metrics.count;
  let calibrationError = 0;
  const reliabilityBins = metrics.bins
    .map((bin, index) => {
      if (!bin.count) return null;
      const binConfidence = bin.confidence / bin.count;
      const binAccuracy = bin.accuracy / bin.count;
      calibrationError += (bin.count / metrics.count) * Math.abs(binConfidence - binAccuracy);
      return {
        lower: round(index / 10, 1),
        upper: round((index + 1) / 10, 1),
        count: bin.count,
        share: round(bin.count / metrics.count, 4),
        avg_confidence: round(binConfidence, 4),
        accuracy: round(binAccuracy, 4),
        gap: round(binConfidence - binAccuracy, 4),
      };
    })
    .filter(Boolean);
  return {
    matches: metrics.count,
    log_loss: round(metrics.logLoss / metrics.count, 4),
    brier: round(metrics.brier / metrics.count, 4),
    accuracy: round(accuracy, 4),
    avg_confidence: round(avgConfidence, 4),
    draw_probability: round(metrics.drawProbability / metrics.count, 4),
    draw_actual: round(metrics.drawActual / metrics.count, 4),
    calibration_gap: round(avgConfidence - accuracy, 4),
    calibration_error: round(calibrationError, 4),
    reliability_bins: reliabilityBins,
  };
}

function makeBucket() {
  return {
    primary: makeMetrics(),
    rawBlend: makeMetrics(),
    globalDrawBlend: makeMetrics(),
    blended: makeMetrics(),
    elo: makeMetrics(),
    goal: makeMetrics(),
    goalWeight: 0,
    primaryBlendCount: 0,
  };
}

function addBucket(bucket, prediction, outcome) {
  addMetrics(bucket.primary, prediction.primary, outcome);
  addMetrics(bucket.rawBlend, prediction.rawBlend, outcome);
  addMetrics(bucket.globalDrawBlend, prediction.globalDrawBlend, outcome);
  addMetrics(bucket.blended, prediction.blended, outcome);
  addMetrics(bucket.elo, prediction.elo, outcome);
  addMetrics(bucket.goal, prediction.goal, outcome);
  bucket.goalWeight += prediction.goalWeight;
  if (prediction.primarySource === 'blend') bucket.primaryBlendCount += 1;
}

function finalizeBucket(bucket) {
  const primary = finalizeMetrics(bucket.primary);
  const rawBlend = finalizeMetrics(bucket.rawBlend);
  const globalDrawBlend = finalizeMetrics(bucket.globalDrawBlend);
  const blended = finalizeMetrics(bucket.blended);
  const elo = finalizeMetrics(bucket.elo);
  const goal = finalizeMetrics(bucket.goal);
  return {
    matches: blended.matches,
    primary,
    raw_blend: rawBlend,
    global_draw_blend: globalDrawBlend,
    blended,
    elo,
    goal,
    avg_goal_weight: bucket.blended.count ? round(bucket.goalWeight / bucket.blended.count, 4) : null,
    primary_blend_share: bucket.primary.count ? round(bucket.primaryBlendCount / bucket.primary.count, 4) : null,
  };
}

function readinessFor(home, away) {
  return clamp(Math.min(home.matches, away.matches) / 16, 0, 1);
}

function teamAttack(team, globalGoals) {
  if (!team.matches) return 1;
  return clamp(team.goalsFor / Math.max(globalGoals, 0.25), 0.62, 1.65);
}

function opponentWeakness(team, globalGoals) {
  if (!team.matches) return 1;
  return clamp(team.goalsAgainst / Math.max(globalGoals, 0.25), 0.62, 1.7);
}

function currentTeamAttack(team, globalGoals) {
  if (!team.matches) return 1;
  return clamp(team.goalsFor / Math.max(globalGoals, 0.25), 0.7, 1.42);
}

function currentTeamDefense(team, globalGoals) {
  if (!team.matches) return 1;
  return clamp(2 - team.goalsAgainst / Math.max(globalGoals, 0.25), 0.7, 1.42);
}

function currentTeamForm(team) {
  if (!team.matches) return 0.5;
  return clamp(0.5 + (team.elo - 1500) / 900, 0.35, 0.78);
}

function summarizeCurrentTeamStrengths(state, latestCompletedDate) {
  const globalGoals = state.neutralGoals;
  const teams = [...state.teams.entries()]
    .map(([team, value]) => ({
      team,
      normalized_name: normalizeName(team),
      matches: value.matches,
      elo: round(value.elo, 1),
      goals_for_ewma: round(value.goalsFor, 3),
      goals_against_ewma: round(value.goalsAgainst, 3),
      attack: round(currentTeamAttack(value, globalGoals), 3),
      defense: round(currentTeamDefense(value, globalGoals), 3),
      form: round(currentTeamForm(value), 3),
    }))
    .sort((left, right) => right.elo - left.elo || left.team.localeCompare(right.team));

  return {
    method:
      'Final walk-forward state after completed international rows only; Elo, attack, defense and form are used as current national-team strength priors for official 2026 group simulations.',
    generated_from_completed_rows: true,
    latest_completed_date: latestCompletedDate ?? null,
    global_neutral_goals_ewma: round(globalGoals, 3),
    teams,
  };
}

function adjustDrawProbability(probabilities, drawAdjustment) {
  if (Math.abs(drawAdjustment) <= 0.001) return probabilities;
  const adjustedDraw = clamp(probabilities[1] + drawAdjustment, 0.13, 0.36);
  const nonDrawTotal = probabilities[0] + probabilities[2];
  if (nonDrawTotal <= 0) return probabilities;
  return normalize([
    probabilities[0] * ((1 - adjustedDraw) / nonDrawTotal),
    adjustedDraw,
    probabilities[2] * ((1 - adjustedDraw) / nonDrawTotal),
  ]);
}

function predictMatch(state, match) {
  const home = getTeam(state, match.homeTeam);
  const away = getTeam(state, match.awayTeam);
  const readiness = readinessFor(home, away);
  const homeEdge = homeAdvantage(match);
  const eloDiff = home.elo - away.elo + homeEdge;

  const nonDrawHome = sigmoidElo(eloDiff);
  const baseDraw = clamp(0.292 - Math.abs(eloDiff) / 1850, 0.17, 0.315);
  const elo = normalize([nonDrawHome * (1 - baseDraw), baseDraw, (1 - nonDrawHome) * (1 - baseDraw)]);

  const baseHomeGoals = match.neutral ? state.neutralGoals : state.homeGoals;
  const baseAwayGoals = match.neutral ? state.neutralGoals : state.awayGoals;
  const homeAttack = teamAttack(home, baseHomeGoals);
  const awayAttack = teamAttack(away, baseAwayGoals);
  const homeWeakness = opponentWeakness(home, baseAwayGoals);
  const awayWeakness = opponentWeakness(away, baseHomeGoals);
  const eloGoalScale = clamp(Math.exp(eloDiff / 1450), 0.65, 1.55);
  const homeLambda = clamp(baseHomeGoals * homeAttack * awayWeakness * eloGoalScale, 0.2, 3.4);
  const awayLambda = clamp(baseAwayGoals * awayAttack * homeWeakness / eloGoalScale, 0.16, 3.2);
  const score = buildScoreModel(homeLambda, awayLambda);
  const goal = normalize([score.homeWin, score.draw, score.awayWin]);

  let adaptiveGoalWeight = match.majorFinal ? 0.24 : 0.08;
  if (state.matches >= 250) {
    const temperature = 0.16;
    const eloSkill = Math.exp(-state.eloLogLossEwma / temperature);
    const goalSkill = Math.exp(-state.goalLogLossEwma / temperature);
    adaptiveGoalWeight = goalSkill / (goalSkill + eloSkill);
    if (state.goalLogLossEwma > state.eloLogLossEwma) {
      adaptiveGoalWeight = Math.min(adaptiveGoalWeight, match.majorFinal ? 0.22 : 0.08);
    }
  }

  const earlyGoalWeight = (match.majorFinal ? 0.12 : 0.04) + readiness * (match.majorFinal ? 0.16 : 0.08);
  const importanceNudge = match.majorFinal ? 0.02 : 0;
  const goalWeight = clamp(
    (adaptiveGoalWeight + earlyGoalWeight) / 2 + importanceNudge,
    0.02,
    match.majorFinal ? 0.36 : 0.18,
  );
  const rawBlend = normalize(
    elo.map((probability, index) => probability * (1 - goalWeight) + goal[index] * goalWeight),
  );

  const group = getGroupPerformance(state, match.group);
  const groupDrawReady = !match.majorFinal && group.count >= 90;
  const globalDrawAdjustment = clamp((state.drawActualEwma - state.drawPredEwma) * 0.18, -0.035, 0.035);
  const groupDrawAdjustment = groupDrawReady
    ? (group.drawActualEwma - group.drawPredEwma) * 0.18
    : 0;
  const globalDrawBlend = adjustDrawProbability(rawBlend, globalDrawAdjustment);
  const productionDrawAdjustment = match.majorFinal
    ? 0
    : clamp(globalDrawAdjustment + groupDrawAdjustment, -0.035, 0.035);
  const blended = adjustDrawProbability(
    rawBlend,
    productionDrawAdjustment,
  );

  const primaryChoice = choosePrimaryProbabilities(state, match, elo, blended);

  return {
    primary: primaryChoice.probabilities,
    primarySource: primaryChoice.source,
    elo,
    goal,
    rawBlend,
    globalDrawBlend,
    blended,
    goalWeight,
    expectedHomeNoDraw: sigmoidElo(eloDiff),
    eloDiff,
    homeLambda,
    awayLambda,
    scoreModel: score,
    pick: pickOutcome(primaryChoice.probabilities),
  };
}

function updateState(state, match, prediction) {
  const home = getTeam(state, match.homeTeam);
  const away = getTeam(state, match.awayTeam);
  const importance = match.importance;
  const actualHome = match.homeScore > match.awayScore ? 1 : match.homeScore === match.awayScore ? 0.5 : 0;
  const margin = Math.abs(match.homeScore - match.awayScore);
  const marginFactor = margin <= 1 ? 1 : Math.log(margin + 1) * 1.15;
  const kFactor = 18 * importance * marginFactor;
  const expectedHome = prediction.expectedHomeNoDraw;
  const eloDelta = kFactor * (actualHome - expectedHome);
  home.elo += eloDelta;
  away.elo -= eloDelta;

  const teamAlpha = clamp(0.07 * importance, 0.045, 0.12);
  home.goalsFor = home.goalsFor * (1 - teamAlpha) + match.homeScore * teamAlpha;
  home.goalsAgainst = home.goalsAgainst * (1 - teamAlpha) + match.awayScore * teamAlpha;
  away.goalsFor = away.goalsFor * (1 - teamAlpha) + match.awayScore * teamAlpha;
  away.goalsAgainst = away.goalsAgainst * (1 - teamAlpha) + match.homeScore * teamAlpha;
  home.matches += 1;
  away.matches += 1;

  const globalAlpha = clamp(0.012 * importance, 0.006, 0.02);
  if (match.neutral) {
    const averageNeutralGoals = (match.homeScore + match.awayScore) / 2;
    state.neutralGoals = state.neutralGoals * (1 - globalAlpha) + averageNeutralGoals * globalAlpha;
  } else {
    state.homeGoals = state.homeGoals * (1 - globalAlpha) + match.homeScore * globalAlpha;
    state.awayGoals = state.awayGoals * (1 - globalAlpha) + match.awayScore * globalAlpha;
  }

  const outcome = match.outcome;
  const lossAlpha = 0.035;
  state.eloLogLossEwma =
    state.eloLogLossEwma * (1 - lossAlpha) + logLoss(prediction.elo, outcome) * lossAlpha;
  state.goalLogLossEwma =
    state.goalLogLossEwma * (1 - lossAlpha) + logLoss(prediction.goal, outcome) * lossAlpha;
  state.blendLogLossEwma =
    state.blendLogLossEwma * (1 - lossAlpha) + logLoss(prediction.blended, outcome) * lossAlpha;
  const group = getGroupPerformance(state, match.group);
  const groupLossAlpha = 0.05;
  group.eloLogLossEwma =
    group.eloLogLossEwma * (1 - groupLossAlpha) + logLoss(prediction.elo, outcome) * groupLossAlpha;
  group.blendLogLossEwma =
    group.blendLogLossEwma * (1 - groupLossAlpha) +
    logLoss(prediction.blended, outcome) * groupLossAlpha;
  group.drawPredEwma =
    group.drawPredEwma * (1 - groupLossAlpha) + prediction.blended[1] * groupLossAlpha;
  group.drawActualEwma =
    group.drawActualEwma * (1 - groupLossAlpha) + (outcome === 'D' ? 1 : 0) * groupLossAlpha;
  group.count += 1;
  state.drawPredEwma = state.drawPredEwma * 0.965 + prediction.blended[1] * 0.035;
  state.drawActualEwma = state.drawActualEwma * 0.965 + (outcome === 'D' ? 1 : 0) * 0.035;
  state.matches += 1;
}

function ensureMapBucket(map, key) {
  if (!map.has(key)) map.set(key, makeBucket());
  return map.get(key);
}

function majorKey(match) {
  if (!match.majorFinal) return null;
  return `${match.tournament} ${match.date.getUTCFullYear()}`;
}

function majorStageGroupCount(tournament, totalMatches) {
  const plain = plainText(tournament);
  if (plain === 'FIFA World Cup' && totalMatches === 104) return 72;
  if (plain === 'FIFA World Cup' && totalMatches === 64) return 48;
  if (plain === 'FIFA World Cup' && totalMatches > 0 && totalMatches < 72) return totalMatches;
  if (plain === 'UEFA Euro' && totalMatches === 31) return 24;
  if (plain === 'UEFA Euro' && totalMatches === 51) return 36;
  if (plain === 'Copa America' && totalMatches === 32) return 24;
  if (plain === 'Copa America' && totalMatches === 28) return 20;
  if (plain === 'Copa America' && totalMatches === 26) return 18;
  return null;
}

function majorStageLabel(match, editionIndex, editionTotal) {
  if (!match.majorFinal) return null;
  const groupCount = majorStageGroupCount(match.tournament, editionTotal);
  if (groupCount === null) return 'Unknown stage';
  return editionIndex < groupCount ? 'Group stage' : 'Knockout';
}

function buildMajorEditionMeta(matches) {
  const editions = new Map();
  for (const match of matches) {
    const key = majorKey(match);
    if (!key) continue;
    if (!editions.has(key)) editions.set(key, []);
    editions.get(key).push(match);
  }

  const meta = new Map();
  for (const [editionKey, editionMatches] of editions.entries()) {
    const sortedMatches = [...editionMatches].sort((a, b) => a.date - b.date || a.id - b.id);
    const editionTotal = sortedMatches.length;
    sortedMatches.forEach((match, editionIndex) => {
      const stageLabel = majorStageLabel(match, editionIndex, editionTotal);
      meta.set(match.id, {
        editionKey,
        editionIndex,
        editionTotal,
        stageLabel,
        stageKey: `${match.group} - ${stageLabel}`,
      });
    });
  }
  return meta;
}

function makePredictionRow(match, prediction) {
  return {
    date: match.dateKey,
    tournament: match.tournament,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    actual: match.outcome,
    score: `${match.homeScore}-${match.awayScore}`,
    pick: prediction.pick,
    probabilities: {
      home: round(prediction.primary[0], 4),
      draw: round(prediction.primary[1], 4),
      away: round(prediction.primary[2], 4),
    },
    primary_source: prediction.primarySource,
  };
}

function probabilityObject(probabilities) {
  return {
    home: round(probabilities[0], 4),
    draw: round(probabilities[1], 4),
    away: round(probabilities[2], 4),
  };
}

function scoreOutcome(score) {
  if (score.home_goals > score.away_goals) return 'H';
  if (score.home_goals < score.away_goals) return 'A';
  return 'D';
}

function scoreLabel(score) {
  return `${score.home_goals}-${score.away_goals}`;
}

function uniqueScores(scores) {
  const seen = new Set();
  return scores.filter((score) => {
    const label = scoreLabel(score);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

function projectedScoreForTotal(pick, totalGoals, expectedHome, expectedAway) {
  const candidates = [];
  for (let homeGoals = 0; homeGoals <= totalGoals; homeGoals += 1) {
    const awayGoals = totalGoals - homeGoals;
    const score = { home_goals: homeGoals, away_goals: awayGoals, probability: null, projected: true };
    if (scoreOutcome(score) === pick) candidates.push(score);
  }
  return candidates.sort((left, right) => {
    const leftDistance = (left.home_goals - expectedHome) ** 2 + (left.away_goals - expectedAway) ** 2;
    const rightDistance = (right.home_goals - expectedHome) ** 2 + (right.away_goals - expectedAway) ** 2;
    return leftDistance - rightDistance;
  })[0] ?? null;
}

function scoreCandidateBundle(prediction) {
  const scoreModel = prediction.scoreModel;
  if (!scoreModel) return null;
  const goalCandidates = [...(scoreModel.goalProbabilities ?? [])]
    .sort((left, right) => right.probability - left.probability || left.total_goals - right.total_goals)
    .slice(0, 2)
    .map((goal, index) => ({
      total_goals: goal.total_goals,
      probability: round(goal.probability, 4),
      primary: index === 0
    }));
  const directionScores = (scoreModel.scoreProbabilities ?? []).filter((score) => scoreOutcome(score) === prediction.pick);
  const alignedScores = goalCandidates
    .map((goal) => (
      directionScores
        .filter((score) => score.home_goals + score.away_goals === goal.total_goals)
        .sort((left, right) => right.probability - left.probability)[0] ??
      projectedScoreForTotal(prediction.pick, goal.total_goals, scoreModel.expectedHomeGoals, scoreModel.expectedAwayGoals)
    ))
    .filter(Boolean);
  const scoreCandidates = uniqueScores([...alignedScores, ...directionScores, ...(scoreModel.scoreProbabilities ?? [])])
    .slice(0, 3)
    .map((score, index) => ({
      home_goals: score.home_goals,
      away_goals: score.away_goals,
      probability: Number.isFinite(score.probability) ? round(score.probability, 4) : null,
      primary: index === 0,
      projected: score.projected === true
    }));
  return {
    expected_home_goals: round(scoreModel.expectedHomeGoals, 3),
    expected_away_goals: round(scoreModel.expectedAwayGoals, 3),
    expected_total_goals: round(scoreModel.expectedTotalGoals, 3),
    goal_candidates: goalCandidates,
    score_candidates: scoreCandidates
  };
}

function makeFriendlyAuditCandidate(match, prediction) {
  return {
    date: match.dateKey,
    tournament: match.tournament,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    actual: match.outcome,
    score: `${match.homeScore}-${match.awayScore}`,
    pick: prediction.pick,
    correct: prediction.pick === match.outcome,
    primary_source: prediction.primarySource,
    primary_probabilities: probabilityObject(prediction.primary),
    elo_probabilities: probabilityObject(prediction.elo),
    blended_probabilities: probabilityObject(prediction.blended),
    score_model: scoreCandidateBundle(prediction),
    _primary: prediction.primary,
    _elo: prediction.elo,
    _blended: prediction.blended,
  };
}

function makeFuturePredictionRow(match, prediction) {
  return {
    date: match.dateKey,
    tournament: match.tournament,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    city: match.city,
    country: match.country,
    neutral: match.neutral,
    pick: prediction.pick,
    probabilities: {
      home: round(prediction.primary[0], 4),
      draw: round(prediction.primary[1], 4),
      away: round(prediction.primary[2], 4),
    },
    blended_probabilities: {
      home: round(prediction.blended[0], 4),
      draw: round(prediction.blended[1], 4),
      away: round(prediction.blended[2], 4),
    },
    primary_source: prediction.primarySource,
  };
}

function describeOutcome(outcome, home, away) {
  if (outcome === 'H') return home;
  if (outcome === 'A') return away;
  return 'Draw';
}

function pct(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${round(value * 100, 2)}%`;
}

function numberOrNa(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function pctRange(min, max) {
  if (min === null || min === undefined || max === null || max === undefined) return 'n/a';
  return `${pct(min)} to ${pct(max)}`;
}

function numberRange(min, max) {
  if (min === null || min === undefined || max === null || max === undefined) return 'n/a';
  return `${numberOrNa(min)} to ${numberOrNa(max)}`;
}

function compactMetric(metric) {
  return {
    matches: metric.matches,
    log_loss: metric.log_loss,
    accuracy: metric.accuracy,
    brier: metric.brier,
    avg_confidence: metric.avg_confidence,
    calibration_gap: metric.calibration_gap,
    calibration_error: metric.calibration_error,
    reliability_bins: metric.reliability_bins,
    draw_probability: metric.draw_probability,
    draw_actual: metric.draw_actual,
  };
}

function inDateKeyRange(dateKey, startDate, endDate) {
  return (!startDate || dateKey >= startDate) && (!endDate || dateKey <= endDate);
}

function buildFriendlyMetricSet(rows) {
  const primary = makeMetrics();
  const elo = makeMetrics();
  const blended = makeMetrics();

  for (const row of rows) {
    addMetrics(primary, row._primary, row.actual);
    addMetrics(elo, row._elo, row.actual);
    addMetrics(blended, row._blended, row.actual);
  }

  return {
    primary: compactMetric(finalizeMetrics(primary)),
    elo: compactMetric(finalizeMetrics(elo)),
    blended: compactMetric(finalizeMetrics(blended)),
  };
}

function buildFriendlyAudit(rows, options) {
  const sortedRows = rows
    .filter((row) => inDateKeyRange(row.date, options.startDate, options.endDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : sortedRows.length;
  const selectedRows = sortedRows.slice(-limit);
  const selectedMetrics = buildFriendlyMetricSet(selectedRows);
  const fullWindowMetrics = buildFriendlyMetricSet(sortedRows);

  return {
    tournament: 'Friendly',
    start_date: options.startDate,
    end_date: options.endDate,
    requested_limit: options.limit,
    selection: 'latest_completed_matches_in_window',
    duplicate_guard: 'date_team_score_tournament_neutral',
    source_duplicate_rows_removed: options.duplicateRowsRemoved ?? 0,
    available_matches: sortedRows.length,
    evaluated_matches: selectedRows.length,
    primary: selectedMetrics.primary,
    elo: selectedMetrics.elo,
    blended: selectedMetrics.blended,
    full_window: {
      selection: 'all_completed_matches_in_window',
      evaluated_matches: sortedRows.length,
      primary: fullWindowMetrics.primary,
      elo: fullWindowMetrics.elo,
      blended: fullWindowMetrics.blended,
    },
    matches: selectedRows.map(({ _primary, _elo, _blended, ...row }) => row),
  };
}

function buildPreWorldCupFriendlyAudits(rows, options) {
  return WORLD_CUP_FRIENDLY_AUDIT_WINDOWS.map((window) => {
    const audit = buildFriendlyAudit(rows, {
      startDate: window.start_date,
      endDate: window.end_date,
      limit: options.limit,
      duplicateRowsRemoved: options.duplicateRowsRemoved,
    });
    return {
      edition: window.edition,
      tournament_start_date: window.tournament_start_date,
      window_rule: 'calendar_year_to_day_before_opener_latest_completed_matches',
      ...audit,
    };
  });
}

function average(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (cleanValues.length === 0) return null;
  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function sampleStdDev(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (cleanValues.length < 2) return null;
  const mean = average(cleanValues);
  const variance =
    cleanValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (cleanValues.length - 1);
  return Math.sqrt(variance);
}

function metricRange(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (cleanValues.length === 0) return { min: null, max: null };
  return {
    min: Math.min(...cleanValues),
    max: Math.max(...cleanValues),
  };
}

function roundOrNull(value, digits = 4) {
  return Number.isFinite(value) ? round(value, digits) : null;
}

function zScore(value, mean, stddev) {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(stddev) || stddev === 0) {
    return null;
  }
  return (value - mean) / stddev;
}

function makePromotionCheck(key, label, passed, observed, threshold) {
  return {
    key,
    label,
    passed: Boolean(passed),
    observed,
    threshold,
  };
}

function summarizeFriendlyMetricWindow(audits, selector) {
  const priorAudits = audits.filter((audit) => !String(audit.edition).includes('2026'));
  const currentAudit = audits.find((audit) => String(audit.edition).includes('2026')) ?? null;
  const priorMetrics = priorAudits
    .map(selector)
    .filter((metric) => metric?.matches > 0 && Number.isFinite(metric.accuracy));
  const currentMetric = currentAudit ? selector(currentAudit) : null;
  const priorAccuracies = priorMetrics.map((metric) => metric.accuracy);
  const priorLogLosses = priorMetrics.map((metric) => metric.log_loss).filter(Number.isFinite);
  const priorAccuracyMean = average(priorAccuracies);
  const priorAccuracyStddev = sampleStdDev(priorAccuracies);
  const priorLogLossMean = average(priorLogLosses);
  const priorLogLossStddev = sampleStdDev(priorLogLosses);
  const priorAccuracyRange = metricRange(priorAccuracies);
  const priorLogLossRange = metricRange(priorLogLosses);

  return {
    prior_cycle_count: priorMetrics.length,
    prior_matches_min: priorMetrics.length ? Math.min(...priorMetrics.map((metric) => metric.matches)) : null,
    prior_matches_max: priorMetrics.length ? Math.max(...priorMetrics.map((metric) => metric.matches)) : null,
    prior_accuracy_mean: roundOrNull(priorAccuracyMean),
    prior_accuracy_stddev: roundOrNull(priorAccuracyStddev),
    prior_accuracy_min: roundOrNull(priorAccuracyRange.min),
    prior_accuracy_max: roundOrNull(priorAccuracyRange.max),
    prior_log_loss_mean: roundOrNull(priorLogLossMean),
    prior_log_loss_stddev: roundOrNull(priorLogLossStddev),
    prior_log_loss_min: roundOrNull(priorLogLossRange.min),
    prior_log_loss_max: roundOrNull(priorLogLossRange.max),
    current_matches: currentMetric?.matches ?? null,
    current_accuracy: currentMetric?.accuracy ?? null,
    current_log_loss: currentMetric?.log_loss ?? null,
    current_accuracy_z: roundOrNull(
      zScore(currentMetric?.accuracy, priorAccuracyMean, priorAccuracyStddev),
      2,
    ),
    current_log_loss_z: roundOrNull(zScore(currentMetric?.log_loss, priorLogLossMean, priorLogLossStddev), 2),
  };
}

function buildFriendlyPromotionGate(latest24, fullWindow, comparison) {
  const latestPriorCycles = latest24?.prior_cycle_count ?? 0;
  const fullPriorCycles = fullWindow?.prior_cycle_count ?? 0;
  const fullMatches = fullWindow?.current_matches ?? null;
  const accuracyDelta = comparison?.accuracy_delta;
  const accuracyDeltaAbs = Number.isFinite(accuracyDelta) ? Math.abs(accuracyDelta) : null;
  const latestAccuracyZ = latest24?.current_accuracy_z;
  const latestAccuracyZAbs = Number.isFinite(latestAccuracyZ) ? Math.abs(latestAccuracyZ) : null;
  const fullAccuracy = fullWindow?.current_accuracy;
  const fullAccuracyInPriorRange =
    Number.isFinite(fullAccuracy) &&
    Number.isFinite(fullWindow?.prior_accuracy_min) &&
    Number.isFinite(fullWindow?.prior_accuracy_max) &&
    fullAccuracy >= fullWindow.prior_accuracy_min &&
    fullAccuracy <= fullWindow.prior_accuracy_max;

  const checks = [
    makePromotionCheck(
      'latest_prior_cycles',
      'Latest-24 prior cycles',
      latestPriorCycles >= FRIENDLY_PROMOTION_PRIOR_CYCLE_MIN,
      latestPriorCycles,
      `>= ${FRIENDLY_PROMOTION_PRIOR_CYCLE_MIN}`,
    ),
    makePromotionCheck(
      'all_window_prior_cycles',
      'All-window prior cycles',
      fullPriorCycles >= FRIENDLY_PROMOTION_PRIOR_CYCLE_MIN,
      fullPriorCycles,
      `>= ${FRIENDLY_PROMOTION_PRIOR_CYCLE_MIN}`,
    ),
    makePromotionCheck(
      'all_window_sample_size',
      'All-window sample size',
      Number.isFinite(fullMatches) && fullMatches >= FRIENDLY_PROMOTION_FULL_WINDOW_MATCH_MIN,
      fullMatches,
      `>= ${FRIENDLY_PROMOTION_FULL_WINDOW_MATCH_MIN}`,
    ),
    makePromotionCheck(
      'latest_vs_all_accuracy_delta',
      'Latest-vs-all accuracy delta',
      Number.isFinite(accuracyDeltaAbs) &&
        accuracyDeltaAbs <= FRIENDLY_PROMOTION_ACCURACY_DELTA_MAX,
      roundOrNull(accuracyDeltaAbs),
      `<= ${pct(FRIENDLY_PROMOTION_ACCURACY_DELTA_MAX)}`,
    ),
    makePromotionCheck(
      'latest_accuracy_z',
      'Latest-24 accuracy z-score',
      Number.isFinite(latestAccuracyZAbs) && latestAccuracyZAbs <= FRIENDLY_PROMOTION_ACCURACY_Z_MAX,
      roundOrNull(latestAccuracyZ, 2),
      `|z| <= ${FRIENDLY_PROMOTION_ACCURACY_Z_MAX}`,
    ),
    makePromotionCheck(
      'all_window_accuracy_prior_range',
      'All-window accuracy prior range',
      fullAccuracyInPriorRange,
      roundOrNull(fullAccuracy),
      pctRange(fullWindow?.prior_accuracy_min, fullWindow?.prior_accuracy_max),
    ),
  ];
  const passed = checks.every((check) => check.passed);

  return {
    signal: 'pre_world_cup_friendlies',
    decision: passed ? 'eligible_for_model_review' : 'hold',
    promote_2026_friendly_signal: passed,
    can_drive_market_recommendation: false,
    market_recommendation_dependency: 'verified pre-match odds, lineups, and complete provider metadata',
    thresholds: {
      prior_cycle_min: FRIENDLY_PROMOTION_PRIOR_CYCLE_MIN,
      full_window_match_min: FRIENDLY_PROMOTION_FULL_WINDOW_MATCH_MIN,
      latest_vs_all_accuracy_delta_max: FRIENDLY_PROMOTION_ACCURACY_DELTA_MAX,
      latest_accuracy_z_abs_max: FRIENDLY_PROMOTION_ACCURACY_Z_MAX,
    },
    checks,
    blocked_reasons: checks.filter((check) => !check.passed).map((check) => check.key),
    recommendation: passed
      ? 'The friendly signal may enter model-review experiments, but it still cannot produce betting recommendations without verified odds and lineups.'
      : 'Do not promote the 2026 latest-24 friendly result into a fixed rule or betting recommendation; keep it as a short-term diagnostic until the all-window check agrees.',
  };
}

function summarizeFriendlyWindowStability(audits) {
  if (!Array.isArray(audits) || audits.length === 0) return null;
  const latest24 = summarizeFriendlyMetricWindow(audits, (audit) => audit.primary);
  const fullWindow = summarizeFriendlyMetricWindow(audits, (audit) => audit.full_window?.primary);
  const latestAudit = audits.find((audit) => String(audit.edition).includes('2026')) ?? null;
  const latestMetric = latestAudit?.primary ?? null;
  const fullMetric = latestAudit?.full_window?.primary ?? null;
  const accuracyDelta =
    latestMetric && fullMetric && Number.isFinite(latestMetric.accuracy) && Number.isFinite(fullMetric.accuracy)
      ? latestMetric.accuracy - fullMetric.accuracy
      : null;
  const logLossDelta =
    latestMetric && fullMetric && Number.isFinite(latestMetric.log_loss) && Number.isFinite(fullMetric.log_loss)
      ? latestMetric.log_loss - fullMetric.log_loss
      : null;
  const comparison = {
    latest_matches: latestMetric?.matches ?? null,
    full_window_matches: fullMetric?.matches ?? null,
    accuracy_delta: roundOrNull(accuracyDelta),
    log_loss_delta: roundOrNull(logLossDelta),
  };

  return {
    rule:
      'Latest-24 is retained for cycle comparability, but 2026 promotion decisions must also pass the all-match same-window sample and prior-cycle variance check.',
    latest_24: latest24,
    full_window: fullWindow,
    latest_vs_full_2026: comparison,
    promotion_gate: buildFriendlyPromotionGate(latest24, fullWindow, comparison),
    interpretation:
      'Treat a strong latest-24 friendly result as a short-term signal only. It is not enough to change the 2026 model rule unless the larger same-window sample and historical cycle range support the same direction.',
  };
}

function summarizeBucket(bucket) {
  return {
    matches: bucket.matches,
    primary: compactMetric(bucket.primary),
    raw_blend: compactMetric(bucket.raw_blend),
    global_draw_blend: compactMetric(bucket.global_draw_blend),
    blended: compactMetric(bucket.blended),
    elo: compactMetric(bucket.elo),
    goal: compactMetric(bucket.goal),
    avg_goal_weight: bucket.avg_goal_weight,
    primary_blend_share: bucket.primary_blend_share,
  };
}

function renderCompetitionTable(entries) {
  const lines = [
    '| Competition group | Matches | Primary LL | Blend share | Primary acc | Blended LL | Blended acc | Elo LL | Goal LL | Draw pred | Draw actual |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [name, bucket] of entries) {
    lines.push(
      `| ${name} | ${bucket.matches} | ${numberOrNa(bucket.primary.log_loss)} | ${pct(
        bucket.primary_blend_share,
      )} | ${pct(bucket.primary.accuracy)} | ${numberOrNa(bucket.blended.log_loss)} | ${pct(
        bucket.blended.accuracy,
      )} | ${numberOrNa(bucket.elo.log_loss)} | ${numberOrNa(bucket.goal.log_loss)} | ${pct(
        bucket.blended.draw_probability,
      )} | ${pct(
        bucket.blended.draw_actual,
      )} |`,
    );
  }
  return lines.join('\n');
}

function renderAblationTable(report) {
  const competitionEntries = report.evaluation.by_competition;
  const worldCupBucket = competitionEntries.find(([name]) => name === 'FIFA World Cup')?.[1] ?? null;
  const rows = [
    ['All internationals', report.evaluation.overall],
    ['FIFA World Cup finals', worldCupBucket],
  ].filter(([, bucket]) => bucket);
  const lines = [
    '| Scope | Elo LL | Goal LL | Raw blend LL | Global draw LL | Production blend LL | Primary LL | Elo acc | Raw blend acc | Production blend acc | Primary acc |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const [scope, bucket] of rows) {
    lines.push(
      `| ${scope} | ${numberOrNa(bucket.elo.log_loss)} | ${numberOrNa(
        bucket.goal.log_loss,
      )} | ${numberOrNa(bucket.raw_blend.log_loss)} | ${numberOrNa(
        bucket.global_draw_blend.log_loss,
      )} | ${numberOrNa(bucket.blended.log_loss)} | ${numberOrNa(
        bucket.primary.log_loss,
      )} | ${pct(bucket.elo.accuracy)} | ${pct(bucket.raw_blend.accuracy)} | ${pct(
        bucket.blended.accuracy,
      )} | ${pct(bucket.primary.accuracy)} |`,
    );
  }

  return lines.join('\n');
}

function renderMajorTable(entries) {
  const lines = [
    '| Major finals edition | Matches | Primary LL | Blend share | Primary acc | Blended LL | Blended acc | Elo LL | Goal LL | Draw pred | Draw actual |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [name, bucket] of entries) {
    lines.push(
      `| ${name} | ${bucket.matches} | ${numberOrNa(bucket.primary.log_loss)} | ${pct(
        bucket.primary_blend_share,
      )} | ${pct(bucket.primary.accuracy)} | ${numberOrNa(bucket.blended.log_loss)} | ${pct(
        bucket.blended.accuracy,
      )} | ${numberOrNa(bucket.elo.log_loss)} | ${numberOrNa(bucket.goal.log_loss)} | ${pct(
        bucket.blended.draw_probability,
      )} | ${pct(bucket.blended.draw_actual)} |`,
    );
  }
  return lines.join('\n');
}

function renderMajorStageTable(entries) {
  const lines = [
    '| Major finals stage | Matches | Primary LL | Blend share | Primary acc | Blended LL | Blended acc | Elo LL | Goal LL | Draw pred | Draw actual |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [name, bucket] of entries) {
    lines.push(
      `| ${name} | ${bucket.matches} | ${numberOrNa(bucket.primary.log_loss)} | ${pct(
        bucket.primary_blend_share,
      )} | ${pct(bucket.primary.accuracy)} | ${numberOrNa(bucket.blended.log_loss)} | ${pct(
        bucket.blended.accuracy,
      )} | ${numberOrNa(bucket.elo.log_loss)} | ${numberOrNa(bucket.goal.log_loss)} | ${pct(
        bucket.blended.draw_probability,
      )} | ${pct(bucket.blended.draw_actual)} |`,
    );
  }
  return lines.join('\n');
}

function renderSamplePredictions(rows) {
  const lines = [
    '| Date | Competition | Match | Pick | Actual | Score | P(H) | P(D) | P(A) | Source |',
    '|---|---|---|---|---|---:|---:|---:|---:|---|',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.date} | ${row.tournament} | ${row.home_team} vs ${row.away_team} | ${describeOutcome(
        row.pick,
        row.home_team,
        row.away_team,
      )} | ${describeOutcome(row.actual, row.home_team, row.away_team)} | ${row.score} | ${pct(
        row.probabilities.home,
      )} | ${pct(row.probabilities.draw)} | ${pct(row.probabilities.away)} | ${row.primary_source} |`,
    );
  }
  return lines.join('\n');
}

function renderFriendlyAudit(audit) {
  if (!audit || !audit.evaluated_matches) {
    return 'No completed Friendly rows were available in the selected pre-World-Cup audit window.';
  }

  const metricLines = [
    '| Model layer | Matches | Accuracy | Log loss | Avg confidence | Calibration gap | Draw pred | Draw actual |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    `| Primary selector | ${audit.primary.matches} | ${pct(audit.primary.accuracy)} | ${numberOrNa(
      audit.primary.log_loss,
    )} | ${pct(audit.primary.avg_confidence)} | ${pct(audit.primary.calibration_gap)} | ${pct(
      audit.primary.draw_probability,
    )} | ${pct(audit.primary.draw_actual)} |`,
    `| Elo-only | ${audit.elo.matches} | ${pct(audit.elo.accuracy)} | ${numberOrNa(
      audit.elo.log_loss,
    )} | ${pct(audit.elo.avg_confidence)} | ${pct(audit.elo.calibration_gap)} | ${pct(
      audit.elo.draw_probability,
    )} | ${pct(audit.elo.draw_actual)} |`,
    `| Blended | ${audit.blended.matches} | ${pct(audit.blended.accuracy)} | ${numberOrNa(
      audit.blended.log_loss,
    )} | ${pct(audit.blended.avg_confidence)} | ${pct(audit.blended.calibration_gap)} | ${pct(
      audit.blended.draw_probability,
    )} | ${pct(audit.blended.draw_actual)} |`,
  ];
  const fullWindow = audit.full_window;
  const fullWindowLines = fullWindow?.evaluated_matches
    ? [
        '| Model layer | Matches | Accuracy | Log loss | Avg confidence | Calibration gap | Draw pred | Draw actual |',
        '|---|---:|---:|---:|---:|---:|---:|---:|',
        `| Primary selector | ${fullWindow.primary.matches} | ${pct(
          fullWindow.primary.accuracy,
        )} | ${numberOrNa(fullWindow.primary.log_loss)} | ${pct(
          fullWindow.primary.avg_confidence,
        )} | ${pct(fullWindow.primary.calibration_gap)} | ${pct(
          fullWindow.primary.draw_probability,
        )} | ${pct(fullWindow.primary.draw_actual)} |`,
        `| Elo-only | ${fullWindow.elo.matches} | ${pct(fullWindow.elo.accuracy)} | ${numberOrNa(
          fullWindow.elo.log_loss,
        )} | ${pct(fullWindow.elo.avg_confidence)} | ${pct(fullWindow.elo.calibration_gap)} | ${pct(
          fullWindow.elo.draw_probability,
        )} | ${pct(fullWindow.elo.draw_actual)} |`,
        `| Blended | ${fullWindow.blended.matches} | ${pct(
          fullWindow.blended.accuracy,
        )} | ${numberOrNa(fullWindow.blended.log_loss)} | ${pct(
          fullWindow.blended.avg_confidence,
        )} | ${pct(fullWindow.blended.calibration_gap)} | ${pct(
          fullWindow.blended.draw_probability,
        )} | ${pct(fullWindow.blended.draw_actual)} |`,
      ]
    : [];

  const rowLines = [
    '| Date | Match | Pick | Actual | Score | Correct | P(H) | P(D) | P(A) | Source |',
    '|---|---|---|---|---:|---|---:|---:|---:|---|',
  ];
  for (const row of audit.matches) {
    rowLines.push(
      `| ${row.date} | ${row.home_team} vs ${row.away_team} | ${describeOutcome(
        row.pick,
        row.home_team,
        row.away_team,
      )} | ${describeOutcome(row.actual, row.home_team, row.away_team)} | ${row.score} | ${
        row.correct ? 'yes' : 'no'
      } | ${pct(row.primary_probabilities.home)} | ${pct(row.primary_probabilities.draw)} | ${pct(
        row.primary_probabilities.away,
      )} | ${row.primary_source} |`,
    );
  }

  return [
    `Window: ${audit.start_date} to ${audit.end_date}; selected ${audit.evaluated_matches} latest completed Friendly rows from ${audit.available_matches} available rows. Predictions were captured before each result updated model state. Duplicate guard removed ${audit.source_duplicate_rows_removed ?? 0} source rows before this window was evaluated.`,
    '',
    'Latest-window metrics:',
    '',
    metricLines.join('\n'),
    ...(fullWindowLines.length
      ? [
          '',
          `Full-window guardrail: all ${fullWindow.evaluated_matches} completed Friendly rows in the same window are evaluated as the larger-sample check. This prevents the latest ${audit.requested_limit} rows from being promoted by themselves.`,
          '',
          fullWindowLines.join('\n'),
        ]
      : []),
    '',
    rowLines.join('\n'),
  ].join('\n');
}

function renderPreWorldCupFriendlyAudits(audits) {
  if (!Array.isArray(audits) || audits.length === 0) {
    return 'No pre-World-Cup friendly audit windows were generated.';
  }

  const requestedLimit =
    audits.find((audit) => Number.isFinite(audit.requested_limit))?.requested_limit ??
    DEFAULT_FRIENDLY_AUDIT_LIMIT;
  const lines = [
    '| World Cup cycle | Window | Tournament opens | Selected / available | Primary acc | Primary LL | Elo acc | Elo LL | Blended acc | Blended LL | Avg confidence | Calibration gap | Draw pred | Draw actual |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  const fullWindowLines = [
    '| World Cup cycle | All-window matches | Primary acc | Primary LL | Elo acc | Elo LL | Blended acc | Blended LL | Avg confidence | Calibration gap | Draw pred | Draw actual |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const audit of audits) {
    lines.push(
      `| ${audit.edition} | ${audit.start_date} to ${audit.end_date} | ${audit.tournament_start_date} | ${audit.evaluated_matches} / ${audit.available_matches} | ${pct(
        audit.primary.accuracy,
      )} | ${numberOrNa(audit.primary.log_loss)} | ${pct(audit.elo.accuracy)} | ${numberOrNa(
        audit.elo.log_loss,
      )} | ${pct(audit.blended.accuracy)} | ${numberOrNa(audit.blended.log_loss)} | ${pct(
        audit.primary.avg_confidence,
      )} | ${pct(audit.primary.calibration_gap)} | ${pct(audit.primary.draw_probability)} | ${pct(
        audit.primary.draw_actual,
      )} |`,
    );
    const fullWindow = audit.full_window;
    fullWindowLines.push(
      `| ${audit.edition} | ${fullWindow?.evaluated_matches ?? 0} | ${pct(
        fullWindow?.primary?.accuracy,
      )} | ${numberOrNa(fullWindow?.primary?.log_loss)} | ${pct(
        fullWindow?.elo?.accuracy,
      )} | ${numberOrNa(fullWindow?.elo?.log_loss)} | ${pct(
        fullWindow?.blended?.accuracy,
      )} | ${numberOrNa(fullWindow?.blended?.log_loss)} | ${pct(
        fullWindow?.primary?.avg_confidence,
      )} | ${pct(fullWindow?.primary?.calibration_gap)} | ${pct(
        fullWindow?.primary?.draw_probability,
      )} | ${pct(fullWindow?.primary?.draw_actual)} |`,
    );
  }

  return [
    `Same-rule stability check: for each World Cup cycle, take the latest ${requestedLimit} completed Friendly matches in the tournament-year lead-in window before the opener. This keeps the 2026 friendly audit comparable with prior cycles.`,
    '',
    lines.join('\n'),
    '',
    'All-window guardrail: evaluate every completed Friendly match in the same lead-in window, so the latest-window result cannot become standalone proof.',
    '',
    fullWindowLines.join('\n'),
  ].join('\n');
}

function renderPromotionGateObserved(check) {
  if (check?.observed === null || check?.observed === undefined) return 'n/a';
  if (String(check.key).includes('accuracy_delta') || String(check.key).includes('accuracy_prior_range')) {
    return pct(check.observed);
  }
  if (String(check.key).includes('z')) return numberOrNa(check.observed);
  return String(check.observed);
}

function renderFriendlyPromotionGate(gate) {
  if (!gate) return 'No promotion gate was generated.';
  const checkRows = Array.isArray(gate.checks) ? gate.checks : [];
  const lines = [
    '| Check | Observed | Threshold | Result |',
    '|---|---:|---:|---|',
    ...checkRows.map(
      (check) =>
        `| ${check.label ?? check.key} | ${renderPromotionGateObserved(check)} | ${
          check.threshold ?? 'n/a'
        } | ${check.passed ? 'pass' : 'block'} |`,
    ),
  ];

  return [
    `Decision: ${gate.decision ?? 'n/a'}; promote friendly signal: ${
      gate.promote_2026_friendly_signal ? 'yes' : 'no'
    }; market recommendation from this signal alone: ${gate.can_drive_market_recommendation ? 'yes' : 'no'}.`,
    `Blocked reasons: ${gate.blocked_reasons?.length ? gate.blocked_reasons.join(', ') : 'none'}.`,
    '',
    lines.join('\n'),
    '',
    gate.recommendation ?? '',
  ].join('\n');
}

function renderFriendlyWindowStability(summary) {
  if (!summary) return 'No friendly window stability summary was generated.';

  const rows = [
    ['Latest 24', summary.latest_24],
    ['All-window', summary.full_window],
  ];
  const lines = [
    '| Scope | Prior cycles | Prior match range | Prior acc avg | Prior acc range | 2026 matches | 2026 acc | 2026 acc z | Prior LL avg | Prior LL range | 2026 LL | 2026 LL z |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [scope, metric] of rows) {
    lines.push(
      `| ${scope} | ${metric?.prior_cycle_count ?? 0} | ${numberRange(
        metric?.prior_matches_min,
        metric?.prior_matches_max,
      )} | ${pct(metric?.prior_accuracy_mean)} | ${pctRange(
        metric?.prior_accuracy_min,
        metric?.prior_accuracy_max,
      )} | ${metric?.current_matches ?? 'n/a'} | ${pct(metric?.current_accuracy)} | ${numberOrNa(
        metric?.current_accuracy_z,
      )} | ${numberOrNa(metric?.prior_log_loss_mean)} | ${numberRange(
        metric?.prior_log_loss_min,
        metric?.prior_log_loss_max,
      )} | ${numberOrNa(metric?.current_log_loss)} | ${numberOrNa(metric?.current_log_loss_z)} |`,
    );
  }

  const latestVsFull = summary.latest_vs_full_2026 ?? {};
  const comparison = [
    '| 2026 comparison | Latest-window | All-window | Delta latest minus all |',
    '|---|---:|---:|---:|',
    `| Matches | ${latestVsFull.latest_matches ?? 'n/a'} | ${
      latestVsFull.full_window_matches ?? 'n/a'
    } | n/a |`,
    `| Primary accuracy | ${pct(summary.latest_24?.current_accuracy)} | ${pct(
      summary.full_window?.current_accuracy,
    )} | ${pct(latestVsFull.accuracy_delta)} |`,
    `| Primary log loss | ${numberOrNa(summary.latest_24?.current_log_loss)} | ${numberOrNa(
      summary.full_window?.current_log_loss,
    )} | ${numberOrNa(latestVsFull.log_loss_delta)} |`,
  ];

  return [
    summary.rule,
    '',
    lines.join('\n'),
    '',
    comparison.join('\n'),
    '',
    'Promotion gate:',
    '',
    renderFriendlyPromotionGate(summary.promotion_gate),
    '',
    summary.interpretation,
  ].join('\n');
}

function renderDuplicateAudit(report) {
  const removed = report.duplicate_rows_removed ?? 0;
  if (!removed) {
    return 'No duplicate source rows were removed by the current guard.';
  }

  const sampleRows = report.duplicate_samples ?? [];
  const sampleTable =
    sampleRows.length > 0
      ? [
          '| Date | Match | Score | Tournament | Kept row/location | Removed row/location | Neutral |',
          '|---|---|---:|---|---|---|---|',
          ...sampleRows.map(
            (row) =>
              `| ${row.date} | ${row.home_team} vs ${row.away_team} | ${row.score} | ${row.tournament} | ${row.kept_id} / ${row.kept_location} | ${row.duplicate_id} / ${row.duplicate_location} | ${row.neutral ? 'yes' : 'no'} |`,
          ),
        ].join('\n')
      : 'No duplicate sample rows were recorded.';

  return [
    `Removed ${removed} duplicate source row${removed === 1 ? '' : 's'} before warmup, evaluation, and friendly audit. The duplicate key is date + normalized teams + score + tournament + neutral/home-away flag; city and venue are excluded so corrected location labels do not create a second match.`,
    '',
    sampleTable,
  ].join('\n');
}

function renderSourceQuarantine(report) {
  const quarantine = report.source_quarantine;
  if (!quarantine) return 'No source quarantine audit was recorded.';

  const tournamentCounts = quarantine.incomplete_rows_by_tournament ?? {};
  const countRows = Object.entries(tournamentCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `| ${name} | ${count} |`);
  const countTable =
    countRows.length > 0
      ? ['| Tournament | Quarantined rows |', '|---|---:|', ...countRows].join('\n')
      : 'No missing-score rows were found.';

  const sampleRows = quarantine.sample_unscored_2026_world_cup_rows ?? [];
  const sampleTable =
    sampleRows.length > 0
      ? [
          '| Date | Cached fixture | Location | Tournament | Score status |',
          '|---|---|---|---|---|',
          ...sampleRows.map((row) => {
            const location = [row.city, row.country].filter(Boolean).join(', ') || 'n/a';
            return `| ${row.date} | ${row.home_team} vs ${row.away_team} | ${location} | ${row.tournament} | ${row.score_status} |`;
          }),
        ].join('\n')
      : 'No unscored 2026 World Cup cache samples were recorded.';

  const span = quarantine.unscored_2026_world_cup_date_span?.join(' to ') ?? 'n/a';

  return [
    quarantine.rule,
    '',
    `- Training/evaluation policy: ${quarantine.training_and_evaluation_policy}`,
    `- Uses martj42 2026 World Cup fixtures for schedule/predictions: ${
      quarantine.uses_international_results_2026_fixtures ? 'yes' : 'no'
    }`,
    `- Trusted 2026 fixture source: ${quarantine.trusted_2026_fixture_source}`,
    `- Trusted 2026 fixture file: ${quarantine.trusted_2026_fixture_file}`,
    `- Missing-score rows quarantined: ${quarantine.incomplete_rows}`,
    `- Unscored 2026 World Cup rows in cache: ${quarantine.unscored_2026_world_cup_rows}`,
    `- Unscored 2026 World Cup cache date span: ${span}`,
    '',
    countTable,
    '',
    sampleTable,
  ].join('\n');
}

function renderFuturePredictions(rows) {
  const lines = [
    '| Date | Match | Venue | Pick | P(H) | P(D) | P(A) | Source |',
    '|---|---|---|---|---:|---:|---:|---|',
  ];
  for (const row of rows) {
    const venue = [row.city, row.country].filter(Boolean).join(', ');
    lines.push(
      `| ${row.date} | ${row.home_team} vs ${row.away_team} | ${venue} | ${describeOutcome(
        row.pick,
        row.home_team,
        row.away_team,
      )} | ${pct(row.probabilities.home)} | ${pct(row.probabilities.draw)} | ${pct(
        row.probabilities.away,
      )} | ${row.primary_source} |`,
    );
  }
  return lines.join('\n');
}

function officialFixtureName(fixture) {
  const home = fixture.home_code ?? fixture.home_placeholder ?? 'TBD';
  const away = fixture.away_code ?? fixture.away_placeholder ?? 'TBD';
  return `${home} vs ${away}`;
}

function summarizeOfficialFixture(fixture) {
  return {
    match_no: fixture.match_no,
    stage: fixture.stage,
    round_label: fixture.round_label,
    date_et: fixture.date_et,
    kickoff_et: fixture.kickoff_et,
    kickoff_utc: fixture.kickoff_utc,
    venue: fixture.venue,
    fixture: officialFixtureName(fixture),
    home_code: fixture.home_code,
    away_code: fixture.away_code,
    home_placeholder: fixture.home_placeholder,
    away_placeholder: fixture.away_placeholder,
  };
}

async function readOfficialScheduleAudit() {
  try {
    const parsed = JSON.parse(await fs.readFile(OFFICIAL_2026_SCHEDULE_FILE, 'utf8'));
    const fixtures = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
    const sampleMatchNumbers = new Set([1, 2, 3, 4, 5, 6, 7, 8, 73, 74, 88, 89, 97, 101, 102, 103, 104]);
    const sampleFixtures = fixtures
      .filter((fixture) => sampleMatchNumbers.has(fixture.match_no))
      .map(summarizeOfficialFixture);
    return {
      status: parsed.status ?? 'official_schedule_parsed',
      file: path.relative(ROOT_DIR, OFFICIAL_2026_SCHEDULE_FILE),
      match_count: parsed.match_count ?? fixtures.length,
      date_span_et: parsed.date_span_et,
      stage_counts: parsed.stage_counts,
      venue_count: parsed.venue_count,
      time_basis: parsed.time_basis,
      source_page: parsed.source_page ?? OFFICIAL_2026_SCHEDULE_PAGE,
      source_release: parsed.source_release ?? OFFICIAL_2026_SCHEDULE_SOURCE,
      source_pdf: parsed.source_pdf ?? OFFICIAL_2026_SCHEDULE_PDF,
      local_pdf: parsed.local_pdf,
      parser: parsed.parser,
      sample_fixtures: sampleFixtures,
    };
  } catch (error) {
    return {
      status: 'official_schedule_missing',
      file: path.relative(ROOT_DIR, OFFICIAL_2026_SCHEDULE_FILE),
      error: error.message,
    };
  }
}

function renderFixtureAudit(audit, predictionCount) {
  const sampleRows = audit?.sample_ignored_rows ?? [];
  const officialSchedule = audit?.official_schedule;
  const officialRows = officialSchedule?.sample_fixtures ?? [];
  const officialTable =
    officialRows.length > 0
      ? [
          '| Match | Date ET | Kickoff ET | Fixture | Venue | Round |',
          '|---:|---|---|---|---|---|',
          ...officialRows.map(
            (row) =>
              `| ${row.match_no} | ${row.date_et} | ${row.kickoff_et} | ${row.fixture} | ${row.venue} | ${row.round_label} |`,
          ),
        ].join('\n')
      : 'No official structured fixture samples are available.';
  const sampleTable =
    sampleRows.length > 0
      ? [
          '| Date | Cached fixture | Location | Tournament |',
          '|---|---|---|---|',
          ...sampleRows.map((row) => {
            const location = [row.city, row.country].filter(Boolean).join(', ') || 'n/a';
            return `| ${row.date} | ${row.home_team} vs ${row.away_team} | ${location} | ${row.tournament} |`;
          }),
        ].join('\n')
      : 'No cached future fixture rows were found.';

  return `The cached martj42 file contains future-dated 2026 FIFA World Cup rows, but it is not an official fixture feed and these rows have been found to disagree with FIFA's published 2026 schedule. They are now ignored instead of predicted.

- Audit status: ${audit?.status ?? 'not_checked'}
- Official structured fixtures parsed: ${officialSchedule?.match_count ?? 0}
- Official date span (ET): ${officialSchedule?.date_span_et?.join(' to ') ?? 'not parsed'}
- Official schedule file: ${officialSchedule?.file ?? path.relative(ROOT_DIR, OFFICIAL_2026_SCHEDULE_FILE)}
- Ignored cached fixture rows: ${audit?.ignored_rows ?? 0}
- Prediction rows emitted: ${predictionCount}
- Official schedule page: ${audit?.official_source ?? OFFICIAL_2026_SCHEDULE_PAGE}
- Official schedule release: ${audit?.official_release ?? OFFICIAL_2026_SCHEDULE_SOURCE}
- Official schedule PDF: ${audit?.official_pdf ?? OFFICIAL_2026_SCHEDULE_PDF}
- Reason: ${audit?.reason ?? 'No audit reason recorded.'}

Official structured schedule samples:

${officialTable}

Sample ignored cached rows:

${sampleTable}`;
}

function renderMarkdown(report) {
  const overall = report.evaluation.overall;
  const competitionEntries = report.evaluation.by_competition.map(([name, bucket]) => [
    name,
    bucket,
  ]);
  const majorEntries = report.evaluation.major_finals.map(([name, bucket]) => [name, bucket]);
  const majorStageEntries = report.evaluation.major_stages.map(([name, bucket]) => [name, bucket]);
  const futurePreviewRows = report.future_predictions.slice(0, 24);
  const fixtureAudit = report.future_fixture_audit;
  const worldCupBucket = competitionEntries.find(([name]) => name === 'FIFA World Cup')?.[1];
  const worldCupRead = worldCupBucket
    ? `On FIFA World Cup finals only, the blended national-team layer currently has ${numberOrNa(
        worldCupBucket.blended.log_loss,
      )} log loss and ${pct(worldCupBucket.blended.accuracy)} accuracy, compared with ${numberOrNa(
        worldCupBucket.elo.log_loss,
      )} log loss and ${pct(worldCupBucket.elo.accuracy)} accuracy for Elo-only. For 2026 scenario generation, this row is more relevant than the all-international aggregate because it isolates the tournament environment.`
    : 'No FIFA World Cup finals rows were available in this evaluation window.';

  return `# International Model Evaluation

Generated: ${report.generated_at}

Source: ${report.data_source.name} (${report.data_source.license})

Raw source: ${report.data_source.url}

Cached file: \`${path.relative(ROOT_DIR, report.data_source.cached_file)}\`

## Scope

- Dataset rows: ${report.source_rows}
- Usable rows after duplicate guard: ${report.usable_rows}
- Duplicate source rows removed before modeling: ${report.duplicate_rows_removed}
- Completed historical rows: ${report.completed_rows}
- Rows skipped because score is missing or future-dated in the source: ${report.incomplete_rows}
- Warmup start: ${report.warmup_start_date}
- Evaluation start: ${report.eval_start_date}
- Warmup matches before evaluation: ${report.warmup_matches}
- Evaluated matches: ${report.evaluated_matches}
- Latest completed match in cache: ${report.latest_completed_date}
- Latest raw fixture date in cache: ${report.latest_raw_date}
- Unverified cached 2026 World Cup fixture rows ignored: ${fixtureAudit?.ignored_rows ?? 0}
- Official 2026 schedule source for future adapter: ${fixtureAudit?.official_source ?? OFFICIAL_2026_SCHEDULE_PAGE}

## Method

This is a chronological walk-forward check on real men's international match results. For each match the script predicts before seeing the score, evaluates the prediction after the result, and then updates team strength, goal rates, home/neutral effect, and adaptive blend weights. It uses no betting odds, no squad news, and no future results.

Source rows are de-duplicated before warmup, evaluation, and friendly audit using date, normalized teams, score, tournament, and neutral/home-away flag. City and venue are deliberately excluded from the duplicate key because the current cache contains at least one repeated result with a corrected location label.

The current version also adds a guarded competition-group draw calibration for non-major competitions. Major finals skip draw calibration because the walk-forward ablation shows raw blended probabilities are more stable than global draw adjustment on World Cup, Euro, and Copa America finals samples.

For FIFA World Cup finals, the primary selector now keeps the blended national-team layer when its pre-match rolling log loss is within 0.018 of Elo-only. This is a target-scope rule driven by walk-forward evidence from World Cup finals and their stage slices; other competition groups still use the stricter rolling selector.

It now splits major finals into group-stage and knockout slices for validation. That split is a reporting check, not a hidden feature given to the prediction engine, so it helps judge whether the 2026 application is logically reasonable without leaking match outcomes.

The pre-World-Cup friendly audit is compared against the same latest-24 rule from prior World Cup cycles and against every completed Friendly match in the same lead-in window. The latest-24 view keeps cycles comparable; the all-window view is the larger-sample guardrail that stops a short hot run from being promoted into a fixed rule.

The point is feasibility and logic validation, not a claim of betting edge. It is a national-team layer that can later be blended with market odds, squad availability, club-form signals, and 2026 draw information. The primary row is an online selector that chooses between Elo-only and blended probabilities using pre-match rolling performance, not a hindsight choice after the result. The ablation table keeps raw blend, global draw calibration, production blend, and primary selection separate so each layer can be accepted or rejected by walk-forward evidence.

## Source Duplicate Guard

${renderDuplicateAudit(report)}

## Source Quarantine Guard

${renderSourceQuarantine(report)}

## Overall

| Metric | Value |
|---|---:|
| Matches | ${overall.matches} |
| Primary log loss | ${numberOrNa(overall.primary.log_loss)} |
| Primary accuracy | ${pct(overall.primary.accuracy)} |
| Primary blend share | ${pct(overall.primary_blend_share)} |
| Raw blend log loss | ${numberOrNa(overall.raw_blend.log_loss)} |
| Global draw blend log loss | ${numberOrNa(overall.global_draw_blend.log_loss)} |
| Blended log loss | ${numberOrNa(overall.blended.log_loss)} |
| Elo-only log loss | ${numberOrNa(overall.elo.log_loss)} |
| Goal-model log loss | ${numberOrNa(overall.goal.log_loss)} |
| Blended accuracy | ${pct(overall.blended.accuracy)} |
| Elo-only accuracy | ${pct(overall.elo.accuracy)} |
| Goal-model accuracy | ${pct(overall.goal.accuracy)} |
| Average model confidence | ${pct(overall.blended.avg_confidence)} |
| Calibration gap | ${pct(overall.blended.calibration_gap)} |
| Draw probability | ${pct(overall.blended.draw_probability)} |
| Actual draw rate | ${pct(overall.blended.draw_actual)} |
| Average goal-model weight | ${pct(overall.avg_goal_weight)} |

## Ablation Check

${renderAblationTable(report)}

## By Competition

${renderCompetitionTable(competitionEntries)}

## 2026 World Cup Read

${worldCupRead}

## Major Finals

${renderMajorTable(majorEntries)}

## Major Stage Split

${renderMajorStageTable(majorStageEntries)}

## Recent Major Samples

${renderSamplePredictions(report.sample_predictions)}

## Pre-World-Cup Friendly Audit

${renderFriendlyAudit(report.friendly_audit)}

## Historical Pre-World-Cup Friendly Windows

${renderPreWorldCupFriendlyAudits(report.pre_world_cup_friendly_audits)}

## Friendly Window Stability Guardrail

${renderFriendlyWindowStability(report.friendly_window_stability)}

## 2026 Fixture Source Audit

${renderFixtureAudit(fixtureAudit, report.future_predictions.length)}

${futurePreviewRows.length > 0 ? renderFuturePredictions(futurePreviewRows) : 'No 2026 fixture predictions are emitted until market odds, squad/news, and pre-match form inputs are connected to the official FIFA fixtures.'}

## Interpretation

- The international model is deliberately independent of odds. It measures whether team-strength and scoring logic have usable predictive signal before market information is added.
- The ablation check is the acceptance gate for changes: a layer should not be promoted for 2026 use unless it improves the relevant walk-forward slice or has a clear calibration reason.
- Major finals have small samples, so year-by-year and stage-level accuracy can swing sharply. Log loss and draw calibration are more useful than raw hit rate when comparing versions.
- The friendly audit should be read cycle-by-cycle. A good 2026 latest-24 result is useful, but it is only a short-term signal unless the all-window sample and prior-cycle distribution point the same way.
- Rows with missing scores are kept out of training and evaluation. The official FIFA 2026 schedule is parsed separately; future 2026 World Cup rows from non-official caches are treated as unverified input and ignored, and 2026 prediction output stays blocked until market odds, squad/news, and pre-match form adapters are connected.
- This does not yet include squad selection, injuries, travel/rest, tactical matchups, or live market priors. Those should be added as separate feature layers and checked with the same walk-forward discipline.
`;
}

function sortedCompetitionEntries(map) {
  const priority = new Map(
    [
      'FIFA World Cup',
      'UEFA Euro',
      'Copa America',
      'FIFA World Cup qualification',
      'UEFA Euro qualification',
      'Other qualification',
      'Other tournaments',
      'Friendly',
      'Other internationals',
    ].map((name, index) => [name, index]),
  );
  return [...map.entries()].sort((a, b) => {
    const priorityDiff = (priority.get(a[0]) ?? 99) - (priority.get(b[0]) ?? 99);
    if (priorityDiff !== 0) return priorityDiff;
    return b[1].matches - a[1].matches;
  });
}

function sortedMajorEntries(map) {
  return [...map.entries()].sort((a, b) => {
    const [tournamentA, yearA] = a[0].match(/^(.*) (\d{4})$/)?.slice(1) ?? [a[0], '0'];
    const [tournamentB, yearB] = b[0].match(/^(.*) (\d{4})$/)?.slice(1) ?? [b[0], '0'];
    if (tournamentA !== tournamentB) return tournamentA.localeCompare(tournamentB);
    return Number(yearA) - Number(yearB);
  });
}

function sortedMajorStageEntries(map) {
  const order = new Map([
    ['FIFA World Cup - Group stage', 0],
    ['FIFA World Cup - Knockout', 1],
    ['UEFA Euro - Group stage', 2],
    ['UEFA Euro - Knockout', 3],
    ['Copa America - Group stage', 4],
    ['Copa America - Knockout', 5],
  ]);
  return [...map.entries()].sort((a, b) => {
    const orderDiff = (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a[0].localeCompare(b[0]);
  });
}

async function main() {
  const warmupStartDate = readOption('--warmup-start-date', DEFAULT_WARMUP_START);
  const evalStartDate = readOption('--eval-start-date', DEFAULT_EVAL_START);
  const friendlyAuditStartDate = readOption('--friendly-audit-start-date', DEFAULT_FRIENDLY_AUDIT_START);
  const friendlyAuditEndDate = readOption('--friendly-audit-end-date', DEFAULT_FRIENDLY_AUDIT_END);
  const friendlyAuditLimit = readNumberOption('--friendly-audit-limit', DEFAULT_FRIENDLY_AUDIT_LIMIT);
  const warmupStart = parseDate(warmupStartDate);
  const evalStart = parseDate(evalStartDate);
  const friendlyAuditStart = parseDate(friendlyAuditStartDate);
  const friendlyAuditEnd = parseDate(friendlyAuditEndDate);
  if (!warmupStart || !evalStart || !friendlyAuditStart || !friendlyAuditEnd) {
    throw new Error('Invalid date option.');
  }

  const text = await ensureData(hasFlag('--refresh'));
  const rows = parseCsv(text);
  const parsedMatches = rows.map(toMatch).filter((match) => match.date);
  const { matches: rawMatches, duplicates: duplicateRows } = dedupeMatches(parsedMatches);
  const completedMatches = rawMatches
    .filter((match) => match.hasScore)
    .sort((a, b) => a.date - b.date || a.id - b.id);
  const incompleteMatches = rawMatches
    .filter((match) => !match.hasScore)
    .sort((a, b) => a.date - b.date || a.id - b.id);
  const modelingMatches = completedMatches.filter((match) => match.date >= warmupStart);
  const majorEditionMeta = buildMajorEditionMeta(completedMatches);
  const unverifiedFutureWorldCupFixtures = incompleteMatches
    .filter(isUnverified2026WorldCupFixture)
    .sort((a, b) => a.date - b.date || a.id - b.id);
  const officialScheduleAudit = await readOfficialScheduleAudit();
  const hasOfficialSchedule =
    officialScheduleAudit?.status === 'official_schedule_parsed' &&
    officialScheduleAudit.match_count === 104;
  const sourceQuarantine = buildSourceQuarantine({
    sourceRows: rows.length,
    rawMatches,
    duplicateRows,
    completedMatches,
    incompleteMatches,
    unverifiedFutureWorldCupFixtures,
    officialScheduleAudit,
  });
  const futureFixtureAudit = {
    status: hasOfficialSchedule
      ? 'official_schedule_parsed_predictions_blocked'
      : 'ignored_unverified_cache',
    official_source: officialScheduleAudit?.source_page ?? OFFICIAL_2026_SCHEDULE_PAGE,
    official_release: officialScheduleAudit?.source_release ?? OFFICIAL_2026_SCHEDULE_SOURCE,
    official_pdf: officialScheduleAudit?.source_pdf ?? OFFICIAL_2026_SCHEDULE_PDF,
    official_schedule: officialScheduleAudit,
    ignored_rows: unverifiedFutureWorldCupFixtures.length,
    reason: hasOfficialSchedule
      ? 'FIFA official 2026 schedule is parsed and audited, but prediction output remains blocked until market odds, squad/news inputs, and pre-match form adapters are connected. Non-official cached future rows remain ignored.'
      : "martj42 cached future FIFA World Cup rows are not an official FIFA fixture feed and were found to disagree with FIFA's published 2026 schedule; they are excluded from prediction output and UI until an official fixture adapter is imported.",
    sample_ignored_rows: unverifiedFutureWorldCupFixtures.slice(0, 8).map((match) => ({
      date: match.dateKey,
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      city: match.city,
      country: match.country,
      tournament: match.tournament,
    })),
  };
  const incompleteRows = incompleteMatches.length;
  const latestCompleted = completedMatches[completedMatches.length - 1];
  const latestRaw = [...rawMatches].sort((a, b) => b.date - a.date || b.id - a.id)[0];

  const state = makeState();
  const overall = makeBucket();
  const byCompetition = new Map();
  const majorFinals = new Map();
  const majorStages = new Map();
  const samplePredictions = [];
  const predictionLedger = [];
  const friendlyAuditCandidates = [];
  let warmupMatches = 0;
  let evaluatedMatches = 0;

  for (const match of modelingMatches) {
    const prediction = predictMatch(state, match);
    const isEvaluation = match.date >= evalStart;

    if (isEvaluation) {
      evaluatedMatches += 1;
      addBucket(overall, prediction, match.outcome);
      addBucket(ensureMapBucket(byCompetition, match.group), prediction, match.outcome);
      const key = majorKey(match);
      if (key) {
        addBucket(ensureMapBucket(majorFinals, key), prediction, match.outcome);
        const stageMeta = majorEditionMeta.get(match.id);
        if (stageMeta?.stageKey) {
          addBucket(ensureMapBucket(majorStages, stageMeta.stageKey), prediction, match.outcome);
        }
        predictionLedger.push(makePredictionRow(match, prediction));
        samplePredictions.push(makePredictionRow(match, prediction));
        if (samplePredictions.length > 16) samplePredictions.shift();
      }
      if (match.group === 'Friendly') {
        friendlyAuditCandidates.push(makeFriendlyAuditCandidate(match, prediction));
      }
    } else {
      warmupMatches += 1;
    }

    updateState(state, match, prediction);
  }

  const finalizedOverall = summarizeBucket(finalizeBucket(overall));
  const finalizedCompetition = sortedCompetitionEntries(byCompetition).map(([name, bucket]) => [
    name,
    summarizeBucket(finalizeBucket(bucket)),
  ]);
  const finalizedMajors = sortedMajorEntries(majorFinals).map(([name, bucket]) => [
    name,
    summarizeBucket(finalizeBucket(bucket)),
  ]);
  const finalizedMajorStages = sortedMajorStageEntries(majorStages).map(([name, bucket]) => [
    name,
    summarizeBucket(finalizeBucket(bucket)),
  ]);
  const futurePredictions = [];
  const friendlyAudit = buildFriendlyAudit(friendlyAuditCandidates, {
    startDate: friendlyAuditStartDate,
    endDate: friendlyAuditEndDate,
    limit: friendlyAuditLimit,
    duplicateRowsRemoved: duplicateRows.length,
  });
  const preWorldCupFriendlyAudits = buildPreWorldCupFriendlyAudits(friendlyAuditCandidates, {
    limit: friendlyAuditLimit,
    duplicateRowsRemoved: duplicateRows.length,
  });
  const friendlyWindowStability = summarizeFriendlyWindowStability(preWorldCupFriendlyAudits);

  const report = {
    generated_at: new Date().toISOString(),
    data_source: {
      name: 'martj42/international_results',
      url: SOURCE_PAGE,
      raw_csv: DATA_URL,
      cached_file: CACHE_FILE,
      license: 'CC0-1.0',
    },
    warmup_start_date: warmupStartDate,
    eval_start_date: evalStartDate,
    source_rows: rows.length,
    usable_rows: rawMatches.length,
    duplicate_rows_removed: duplicateRows.length,
    duplicate_samples: duplicateRows.slice(0, 12),
    completed_rows: completedMatches.length,
    incomplete_rows: incompleteRows,
    source_quarantine: sourceQuarantine,
    warmup_matches: warmupMatches,
    evaluated_matches: evaluatedMatches,
    latest_completed_date: latestCompleted?.dateKey ?? null,
    latest_raw_date: latestRaw?.dateKey ?? null,
    evaluation: {
      overall: finalizedOverall,
      by_competition: finalizedCompetition,
      major_finals: finalizedMajors,
      major_stages: finalizedMajorStages,
    },
    current_team_strengths: summarizeCurrentTeamStrengths(state, latestCompleted?.dateKey),
    friendly_audit: friendlyAudit,
    pre_world_cup_friendly_audits: preWorldCupFriendlyAudits,
    friendly_window_stability: friendlyWindowStability,
    sample_predictions: samplePredictions,
    future_fixture_audit: futureFixtureAudit,
    future_predictions: futurePredictions,
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(REPORT_MD, renderMarkdown(report));
  if (process.env.EXPORT_INTERNATIONAL_LEDGER === '1') {
    await fs.writeFile(PREDICTION_LEDGER_JSON, `${JSON.stringify({
      generated_at: report.generated_at,
      rows: predictionLedger,
    }, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT_DIR, PREDICTION_LEDGER_JSON)}`);
  }

  console.log(`Wrote ${path.relative(ROOT_DIR, REPORT_MD)}`);
  console.log(`Wrote ${path.relative(ROOT_DIR, REPORT_JSON)}`);
  console.log(
    `International walk-forward: ${evaluatedMatches} evaluated matches, primary accuracy ${pct(
      finalizedOverall.primary.accuracy,
    )}, primary log loss ${numberOrNa(finalizedOverall.primary.log_loss)}, blended log loss ${numberOrNa(
      finalizedOverall.blended.log_loss,
    )}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
