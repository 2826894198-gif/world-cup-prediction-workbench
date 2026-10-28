import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clamp, normalize, round } from '../server/model/math.mjs';
import { buildScoreModel } from '../server/model/poisson.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT_DIR, 'data', 'research', 'football-data');
const REPORT_DIR = path.join(ROOT_DIR, 'reports');
const JSON_REPORT = path.join(REPORT_DIR, 'historical-model-evaluation.json');
const MARKDOWN_REPORT = path.join(REPORT_DIR, 'historical-model-evaluation.md');

const DEFAULT_SEASONS = ['2122', '2223', '2324', '2425', '2526'];
const DEFAULT_LEAGUES = {
  E0: { name: 'Premier League', country: 'England' },
  SP1: { name: 'La Liga', country: 'Spain' },
  D1: { name: 'Bundesliga', country: 'Germany' },
  I1: { name: 'Serie A', country: 'Italy' },
  F1: { name: 'Ligue 1', country: 'France' }
};

const OUTCOMES = ['H', 'D', 'A'];
const OUTCOME_LABELS = ['home', 'draw', 'away'];
const DATA_SOURCE = 'https://www.football-data.co.uk/';
const PROVIDERS = [
  { code: 'Avg', label: 'Market average' },
  { code: 'Max', label: 'Market maximum' },
  { code: 'B365', label: 'bet365' },
  { code: 'PS', label: 'Pinnacle' },
  { code: 'BW', label: 'Bet&Win' },
  { code: 'IW', label: 'Interwetten' },
  { code: 'WH', label: 'William Hill' },
  { code: 'VC', label: 'VC Bet' },
  { code: 'BMGM', label: 'BetMGM' },
  { code: 'BV', label: 'BetVictor' },
  { code: 'CL', label: 'Coral' },
  { code: 'LB', label: 'Ladbrokes' },
  { code: 'BFE', label: 'Betfair Exchange' },
  { code: 'BFD', label: 'Betfair Sportsbook' }
];
const VALUE_SENSITIVITY_GRID = [
  { key: 'edge_02_prob_34', label: 'Edge > 2%, P >= 34%', minEdge: 0.02, minProbability: 0.34 },
  { key: 'edge_04_prob_34', label: 'Edge > 4%, P >= 34%', minEdge: 0.04, minProbability: 0.34 },
  { key: 'edge_06_prob_36', label: 'Edge > 6%, P >= 36%', minEdge: 0.06, minProbability: 0.36 },
  { key: 'edge_08_prob_38', label: 'Edge > 8%, P >= 38%', minEdge: 0.08, minProbability: 0.38 },
  { key: 'edge_10_prob_40', label: 'Edge > 10%, P >= 40%', minEdge: 0.1, minProbability: 0.4 }
];

function readOption(name, fallback = undefined) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value === name || value.startsWith(prefix));
  if (!arg) return fallback;
  if (arg === name) return true;
  return arg.slice(prefix.length);
}

function readNumberOption(name, fallback) {
  const value = Number.parseFloat(readOption(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

const OVERRIDE_MIN_MATCHES = readNumberOption('--override-min-matches', 160);
const OVERRIDE_EDGE = readNumberOption('--override-edge', 0.024);
const OVERRIDE_MARGIN = readNumberOption('--override-margin', 0.03);
const OVERRIDE_MAX_MARKET_WEIGHT = readNumberOption('--override-max-market-weight', 0.8);
const MOVEMENT_GUARD_BLOCK_THRESHOLD = readNumberOption('--movement-guard-block-threshold', -0.015);
const MOVEMENT_SUPPORT_EDGE = readNumberOption('--movement-support-edge', 0.018);
const MOVEMENT_SUPPORT_FLOOR = readNumberOption('--movement-support-floor', 0.006);
const PROVIDER_SEGMENT_MIN_ROWS = readNumberOption('--provider-segment-min-rows', 150);
const PROVIDER_CODES = new Set(PROVIDERS.map((provider) => provider.code));
const PRIMARY_PROVIDER_ORDER = String(readOption('--primary-providers', 'BFE,Avg,Max,B365,PS'))
  .split(',')
  .map((code) => code.trim())
  .filter((code) => PROVIDER_CODES.has(code));

if (!PRIMARY_PROVIDER_ORDER.length) {
  throw new Error('No valid providers in --primary-providers');
}

function seasonLabel(season) {
  return `20${season.slice(0, 2)}/20${season.slice(2)}`;
}

function csvUrl(season, leagueCode) {
  return `https://www.football-data.co.uk/mmz4281/${season}/${leagueCode}.csv`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index]?.trim() ?? '';
    });
    return item;
  });
}

function numeric(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseKickoff(row) {
  const rawDate = row.Date;
  if (!rawDate) return null;
  const dateParts = rawDate.split(/[/-]/).map((value) => Number.parseInt(value, 10));
  if (dateParts.length !== 3 || dateParts.some((value) => !Number.isFinite(value))) return null;
  const [day, month, rawYear] = dateParts;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const timeParts = row.Time?.split(':').map((value) => Number.parseInt(value, 10)) ?? [];
  const hour = Number.isFinite(timeParts[0]) ? timeParts[0] : 12;
  const minute = Number.isFinite(timeParts[1]) ? timeParts[1] : 0;
  return Date.UTC(year, month - 1, day, hour, minute);
}

function outcomeFromRow(row) {
  if (OUTCOMES.includes(row.FTR)) return row.FTR;
  const homeGoals = numeric(row.FTHG);
  const awayGoals = numeric(row.FTAG);
  if (homeGoals === null || awayGoals === null) return null;
  if (homeGoals > awayGoals) return 'H';
  if (homeGoals < awayGoals) return 'A';
  return 'D';
}

function tripletsForProvider(code, phase = 'any') {
  const closing = [`${code}CH`, `${code}CD`, `${code}CA`];
  const opening = [`${code}H`, `${code}D`, `${code}A`];
  const triplets = phase === 'closing' ? [closing] : phase === 'opening' ? [opening] : [closing, opening];

  if (code === 'Avg') {
    return phase === 'closing'
      ? [['AvgCH', 'AvgCD', 'AvgCA']]
      : phase === 'opening'
        ? [['AvgH', 'AvgD', 'AvgA']]
        : [
            ['AvgCH', 'AvgCD', 'AvgCA'],
            ['AvgH', 'AvgD', 'AvgA']
          ];
  }

  if (code === 'Max') {
    return phase === 'closing'
      ? [['MaxCH', 'MaxCD', 'MaxCA']]
      : phase === 'opening'
        ? [['MaxH', 'MaxD', 'MaxA']]
        : [
            ['MaxCH', 'MaxCD', 'MaxCA'],
            ['MaxH', 'MaxD', 'MaxA']
          ];
  }

  return triplets;
}

function extractOdds(row, providerCode = 'Avg', phase = 'any') {
  for (const triplet of tripletsForProvider(providerCode, phase)) {
    const odds = triplet.map((column) => numeric(row[column]));
    if (odds.every((value) => value !== null && value > 1.01)) {
      return {
        provider: providerCode,
        phase: triplet[0].endsWith('CH') ? 'closing' : 'opening',
        columns: triplet,
        odds
      };
    }
  }
  return null;
}

function primaryOdds(row) {
  for (const code of PRIMARY_PROVIDER_ORDER) {
    const odds = extractOdds(row, code);
    if (odds) return odds;
  }
  return null;
}

function oddsToProbabilities(odds) {
  const implied = odds.map((value) => 1 / value);
  const overround = implied.reduce((sum, value) => sum + value, 0) - 1;
  return {
    probabilities: normalize(implied),
    overround
  };
}

function argMax(values) {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) bestIndex = index;
  }
  return bestIndex;
}

function logLoss(probabilities, actualIndex) {
  return -Math.log(clamp(probabilities[actualIndex], 1e-6, 1));
}

function brierScore(probabilities, actualIndex) {
  return probabilities.reduce((sum, probability, index) => {
    const target = index === actualIndex ? 1 : 0;
    return sum + (probability - target) ** 2;
  }, 0);
}

function makeMetrics() {
  return {
    matches: 0,
    logLoss: 0,
    brier: 0,
    accuracy: 0,
    confidence: 0,
    predictionSums: [0, 0, 0],
    actualCounts: [0, 0, 0],
    bins: Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, accuracy: 0 }))
  };
}

function addPrediction(metrics, probabilities, actualIndex) {
  const predictedIndex = argMax(probabilities);
  const confidence = probabilities[predictedIndex];
  const binIndex = Math.min(9, Math.floor(confidence * 10));

  metrics.matches += 1;
  metrics.logLoss += logLoss(probabilities, actualIndex);
  metrics.brier += brierScore(probabilities, actualIndex);
  metrics.accuracy += predictedIndex === actualIndex ? 1 : 0;
  metrics.confidence += confidence;
  metrics.actualCounts[actualIndex] += 1;
  probabilities.forEach((probability, index) => {
    metrics.predictionSums[index] += probability;
  });
  metrics.bins[binIndex].count += 1;
  metrics.bins[binIndex].confidence += confidence;
  metrics.bins[binIndex].accuracy += predictedIndex === actualIndex ? 1 : 0;
}

function makePickMetrics() {
  return {
    matches: 0,
    correct: 0,
    overrides: 0,
    predictionCounts: [0, 0, 0],
    actualCounts: [0, 0, 0]
  };
}

function addPick(metrics, predictedIndex, actualIndex, didOverride = false) {
  metrics.matches += 1;
  metrics.correct += predictedIndex === actualIndex ? 1 : 0;
  metrics.overrides += didOverride ? 1 : 0;
  metrics.predictionCounts[predictedIndex] += 1;
  metrics.actualCounts[actualIndex] += 1;
}

function finalizePickMetrics(metrics) {
  if (!metrics.matches) {
    return {
      matches: 0,
      accuracy: null,
      overrides: 0,
      override_rate: null,
      prediction_share: { home: null, draw: null, away: null }
    };
  }

  const predictionShare = {};
  OUTCOME_LABELS.forEach((label, index) => {
    predictionShare[label] = round(metrics.predictionCounts[index] / metrics.matches, 4);
  });

  return {
    matches: metrics.matches,
    accuracy: round(metrics.correct / metrics.matches, 4),
    overrides: metrics.overrides,
    override_rate: round(metrics.overrides / metrics.matches, 4),
    prediction_share: predictionShare
  };
}

function finalizeMetrics(metrics) {
  if (!metrics.matches) {
    return {
      matches: 0,
      log_loss: null,
      brier: null,
      accuracy: null,
      avg_confidence: null,
      calibration_error: null,
      reliability_bins: [],
      outcome_bias: { home: null, draw: null, away: null }
    };
  }

  let calibrationError = 0;
  for (const bin of metrics.bins) {
    if (!bin.count) continue;
    const avgConfidence = bin.confidence / bin.count;
    const accuracy = bin.accuracy / bin.count;
    calibrationError +=
      (bin.count / metrics.matches) *
      Math.abs(avgConfidence - accuracy);
  }

  const bins = metrics.bins
    .map((bin, index) => {
      if (!bin.count) return null;
      const avgConfidence = bin.confidence / bin.count;
      const accuracy = bin.accuracy / bin.count;
      return {
        lower: round(index / 10, 1),
        upper: round((index + 1) / 10, 1),
        count: bin.count,
        share: round(bin.count / metrics.matches, 4),
        avg_confidence: round(avgConfidence, 4),
        accuracy: round(accuracy, 4),
        gap: round(avgConfidence - accuracy, 4)
      };
    })
    .filter(Boolean);

  const outcomeBias = {};
  OUTCOME_LABELS.forEach((label, index) => {
    outcomeBias[label] = round(
      metrics.predictionSums[index] / metrics.matches - metrics.actualCounts[index] / metrics.matches,
      4
    );
  });

  return {
    matches: metrics.matches,
    log_loss: round(metrics.logLoss / metrics.matches, 4),
    brier: round(metrics.brier / metrics.matches, 4),
    accuracy: round(metrics.accuracy / metrics.matches, 4),
    avg_confidence: round(metrics.confidence / metrics.matches, 4),
    calibration_error: round(calibrationError, 4),
    reliability_bins: bins,
    outcome_bias: outcomeBias
  };
}

function makeProviderMetrics(provider) {
  return {
    provider: provider.code,
    label: provider.label,
    oddsRows: 0,
    overround: 0,
    favoriteHits: 0,
    metrics: makeMetrics()
  };
}

function addProviderPrediction(providerMetrics, probabilities, odds, overround, actualIndex) {
  providerMetrics.oddsRows += 1;
  providerMetrics.overround += overround;
  providerMetrics.favoriteHits += argMax(probabilities) === actualIndex ? 1 : 0;
  addPrediction(providerMetrics.metrics, probabilities, actualIndex);
}

function finalizeProviderMetrics(providerMetrics) {
  const finalized = finalizeMetrics(providerMetrics.metrics);
  return {
    provider: providerMetrics.provider,
    label: providerMetrics.label,
    rows: providerMetrics.oddsRows,
    log_loss: finalized.log_loss,
    brier: finalized.brier,
    accuracy: finalized.accuracy,
    favorite_hit_rate: providerMetrics.oddsRows
      ? round(providerMetrics.favoriteHits / providerMetrics.oddsRows, 4)
      : null,
    avg_overround: providerMetrics.oddsRows
      ? round(providerMetrics.overround / providerMetrics.oddsRows, 4)
      : null,
    outcome_bias: finalized.outcome_bias
  };
}

function makeProviderSegmentBucket(label) {
  return {
    label,
    providers: new Map(PROVIDERS.map((provider) => [provider.code, makeProviderMetrics(provider)]))
  };
}

function getProviderSegmentBucket(segments, key, label) {
  if (!segments.has(key)) segments.set(key, makeProviderSegmentBucket(label));
  return segments.get(key);
}

function summarizeProviderSegmentMap(segments) {
  return Array.from(segments.entries())
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      providers: Array.from(bucket.providers.values())
        .map(finalizeProviderMetrics)
        .filter((provider) => provider.rows > 0)
        .sort((a, b) => a.log_loss - b.log_loss)
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function providerSegmentFor(segment, providerCode, minRows = PROVIDER_SEGMENT_MIN_ROWS) {
  const row = segment.providers.find((provider) => provider.provider === providerCode);
  if (!row || row.rows < minRows || row.log_loss === null) return null;
  return {
    segment_key: segment.key,
    segment_label: segment.label,
    ...row
  };
}

function rangeStats(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return { min: null, max: null, range: null, avg: null };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return {
    min: round(min, 4),
    max: round(max, 4),
    range: round(max - min, 4),
    avg: round(finite.reduce((sum, value) => sum + value, 0) / finite.length, 4)
  };
}

function countTopSegments(segments, providerCode, topN = 3, minRows = PROVIDER_SEGMENT_MIN_ROWS) {
  return segments.reduce((count, segment) => {
    const ranked = segment.providers
      .filter((provider) => provider.rows >= minRows && provider.log_loss !== null)
      .sort((a, b) => a.log_loss - b.log_loss)
      .slice(0, topN);
    return count + (ranked.some((provider) => provider.provider === providerCode) ? 1 : 0);
  }, 0);
}

function buildProviderRobustness(providerTendencies, bySeasonSegments, byLeagueSegments, latestSeasonKey) {
  return providerTendencies
    .map((provider) => {
      const seasonRows = bySeasonSegments
        .map((segment) => providerSegmentFor(segment, provider.provider))
        .filter(Boolean);
      const leagueRows = byLeagueSegments
        .map((segment) => providerSegmentFor(segment, provider.provider))
        .filter(Boolean);
      const seasonStats = rangeStats(seasonRows.map((row) => row.log_loss));
      const leagueStats = rangeStats(leagueRows.map((row) => row.log_loss));
      const latestSeason = seasonRows.find((row) => row.segment_key === latestSeasonKey) ?? null;
      const top3SeasonCount = countTopSegments(bySeasonSegments, provider.provider);
      const top3LeagueCount = countTopSegments(byLeagueSegments, provider.provider);
      const coveragePenalty =
        Math.max(0, bySeasonSegments.length - seasonRows.length) * 0.004 +
        Math.max(0, byLeagueSegments.length - leagueRows.length) * 0.003;
      const volatilityPenalty = ((seasonStats.range ?? 0.08) * 0.22) + ((leagueStats.range ?? 0.06) * 0.15);
      const recentPenalty =
        Number.isFinite(latestSeason?.log_loss) && Number.isFinite(provider.log_loss)
          ? Math.max(0, latestSeason.log_loss - provider.log_loss) * 0.25
          : 0.012;
      const top3Share = bySeasonSegments.length ? top3SeasonCount / bySeasonSegments.length : 0;
      const stabilityScore =
        provider.log_loss === null
          ? null
          : round(provider.log_loss + coveragePenalty + volatilityPenalty + recentPenalty - top3Share * 0.004, 4);
      let note = 'cross-segment stable';
      if (seasonRows.length < Math.min(3, bySeasonSegments.length) || leagueRows.length < Math.min(3, byLeagueSegments.length)) {
        note = 'limited comparable coverage';
      } else if ((seasonStats.range ?? 0) > 0.045 || (leagueStats.range ?? 0) > 0.04) {
        note = 'volatile by segment';
      } else if (latestSeason && provider.log_loss !== null && latestSeason.log_loss - provider.log_loss > 0.025) {
        note = 'recent season weaker';
      } else if (top3SeasonCount >= Math.ceil(seasonRows.length * 0.6)) {
        note = 'consistently top tier';
      }

      return {
        provider: provider.provider,
        label: provider.label,
        rows: provider.rows,
        overall_log_loss: provider.log_loss,
        avg_overround: provider.avg_overround,
        season_coverage: seasonRows.length,
        league_coverage: leagueRows.length,
        season_log_loss: seasonStats,
        league_log_loss: leagueStats,
        latest_season: latestSeason
          ? {
              season: latestSeason.segment_key,
              label: latestSeason.segment_label,
              rows: latestSeason.rows,
              log_loss: latestSeason.log_loss,
              accuracy: latestSeason.accuracy
            }
          : null,
        top3_season_count: top3SeasonCount,
        top3_league_count: top3LeagueCount,
        stability_score: stabilityScore,
        note
      };
    })
    .sort((a, b) => (a.stability_score ?? Number.POSITIVE_INFINITY) - (b.stability_score ?? Number.POSITIVE_INFINITY));
}

function makeMovementMetrics(provider) {
  return {
    provider: provider.code,
    label: provider.label,
    matches: 0,
    pickChanges: 0,
    changedToCorrect: 0,
    changedFromCorrect: 0,
    closingFavoriteStrengthened: 0,
    closingFavoriteStrengthenedHits: 0,
    avgAbsProbabilityMove: 0,
    actualProbabilityMove: 0,
    opening: makeMetrics(),
    closing: makeMetrics()
  };
}

function getMarketMovement(row, providerCode) {
  const openingOdds = extractOdds(row, providerCode, 'opening');
  const closingOdds = extractOdds(row, providerCode, 'closing');
  if (!openingOdds || !closingOdds) return null;

  const openingMarket = oddsToProbabilities(openingOdds.odds);
  const closingMarket = oddsToProbabilities(closingOdds.odds);
  return {
    provider: providerCode,
    openingOdds,
    closingOdds,
    openingProbabilities: openingMarket.probabilities,
    closingProbabilities: closingMarket.probabilities,
    probabilityMove: closingMarket.probabilities.map(
      (probability, index) => probability - openingMarket.probabilities[index]
    )
  };
}

function addMovementPrediction(metrics, movement, actualIndex) {
  if (!movement) return;
  const openingPick = argMax(movement.openingProbabilities);
  const closingPick = argMax(movement.closingProbabilities);
  const openingHit = openingPick === actualIndex;
  const closingHit = closingPick === actualIndex;

  metrics.matches += 1;
  metrics.avgAbsProbabilityMove +=
    movement.probabilityMove.reduce((sum, value) => sum + Math.abs(value), 0) / movement.probabilityMove.length;
  metrics.actualProbabilityMove += movement.probabilityMove[actualIndex];

  if (openingPick !== closingPick) {
    metrics.pickChanges += 1;
    if (!openingHit && closingHit) metrics.changedToCorrect += 1;
    if (openingHit && !closingHit) metrics.changedFromCorrect += 1;
  }

  if (movement.probabilityMove[closingPick] > 0) {
    metrics.closingFavoriteStrengthened += 1;
    if (closingHit) metrics.closingFavoriteStrengthenedHits += 1;
  }

  addPrediction(metrics.opening, movement.openingProbabilities, actualIndex);
  addPrediction(metrics.closing, movement.closingProbabilities, actualIndex);
}

function finalizeMovementMetrics(metrics) {
  const opening = finalizeMetrics(metrics.opening);
  const closing = finalizeMetrics(metrics.closing);
  return {
    provider: metrics.provider,
    label: metrics.label,
    rows: metrics.matches,
    opening_log_loss: opening.log_loss,
    closing_log_loss: closing.log_loss,
    closing_log_loss_lift:
      opening.log_loss !== null && closing.log_loss !== null ? round(opening.log_loss - closing.log_loss, 4) : null,
    opening_pick_accuracy: opening.accuracy,
    closing_pick_accuracy: closing.accuracy,
    closing_pick_lift:
      opening.accuracy !== null && closing.accuracy !== null ? round(closing.accuracy - opening.accuracy, 4) : null,
    pick_change_rate: metrics.matches ? round(metrics.pickChanges / metrics.matches, 4) : null,
    changed_pick_net_accuracy:
      metrics.pickChanges ? round((metrics.changedToCorrect - metrics.changedFromCorrect) / metrics.pickChanges, 4) : null,
    avg_abs_probability_move: metrics.matches ? round(metrics.avgAbsProbabilityMove / metrics.matches, 4) : null,
    avg_actual_probability_move: metrics.matches ? round(metrics.actualProbabilityMove / metrics.matches, 4) : null,
    strengthened_closing_favorite_hit_rate: metrics.closingFavoriteStrengthened
      ? round(metrics.closingFavoriteStrengthenedHits / metrics.closingFavoriteStrengthened, 4)
      : null
  };
}

function getTeam(state, teamName) {
  if (!state.teams.has(teamName)) {
    const initialHomeGoals = state.homeGoals;
    const initialAwayGoals = state.awayGoals;
    state.teams.set(teamName, {
      elo: 1500,
      matches: 0,
      homeMatches: 0,
      awayMatches: 0,
      goalsFor: 1.28,
      goalsAgainst: 1.28,
      homeGoalsFor: initialHomeGoals,
      homeGoalsAgainst: initialAwayGoals,
      awayGoalsFor: initialAwayGoals,
      awayGoalsAgainst: initialHomeGoals,
      points: 1.35
    });
  }
  return state.teams.get(teamName);
}

function makeLeagueState() {
  return {
    teams: new Map(),
    matches: 0,
    homeGoals: 1.45,
    awayGoals: 1.15,
    modelLogLossEwma: Math.log(3),
    marketLogLossEwma: Math.log(3),
    marketPickHitEwma: 0.52,
    blendedPickHitEwma: 0.52,
    modelPickHitEwma: 0.49,
    drawPredEwma: 0.27,
    drawActualEwma: 0.27
  };
}

function predictFromState(state, match, marketProbabilities) {
  const home = getTeam(state, match.homeTeam);
  const away = getTeam(state, match.awayTeam);
  const readiness = clamp(Math.min(home.homeMatches, away.awayMatches) / 8, 0, 1);
  const fallbackReadiness = clamp(Math.min(home.matches, away.matches) / 14, 0, 1);
  const homeAttackSignal =
    home.homeMatches > 0 ? home.homeGoalsFor : home.goalsFor * fallbackReadiness + state.homeGoals * (1 - fallbackReadiness);
  const homeDefenceSignal =
    home.homeMatches > 0
      ? home.homeGoalsAgainst
      : home.goalsAgainst * fallbackReadiness + state.awayGoals * (1 - fallbackReadiness);
  const awayAttackSignal =
    away.awayMatches > 0 ? away.awayGoalsFor : away.goalsFor * fallbackReadiness + state.awayGoals * (1 - fallbackReadiness);
  const awayDefenceSignal =
    away.awayMatches > 0
      ? away.awayGoalsAgainst
      : away.goalsAgainst * fallbackReadiness + state.homeGoals * (1 - fallbackReadiness);
  const homeAttack = readiness > 0 ? clamp(homeAttackSignal / state.homeGoals, 0.64, 1.58) : 1;
  const awayAttack = readiness > 0 ? clamp(awayAttackSignal / state.awayGoals, 0.64, 1.58) : 1;
  const homeDefenceWeakness =
    readiness > 0 ? clamp(homeDefenceSignal / state.awayGoals, 0.64, 1.58) : 1;
  const awayDefenceWeakness =
    readiness > 0 ? clamp(awayDefenceSignal / state.homeGoals, 0.64, 1.58) : 1;
  const eloHomeAdvantage = 58;
  const eloScale = Math.exp(((home.elo + eloHomeAdvantage) - away.elo) / 1240);
  const homeLambda = clamp(state.homeGoals * homeAttack * awayDefenceWeakness * eloScale, 0.25, 3.7);
  const awayLambda = clamp(state.awayGoals * awayAttack * homeDefenceWeakness / eloScale, 0.2, 3.3);
  const scoreModel = buildScoreModel(homeLambda, awayLambda);
  const modelProbabilities = normalize([scoreModel.homeWin, scoreModel.draw, scoreModel.awayWin]);

  let adaptiveMarketWeight = 0.72;
  if (state.matches >= 40) {
    const skillTemperature = 0.12;
    const modelSkill = Math.exp(-state.modelLogLossEwma / skillTemperature);
    const marketSkill = Math.exp(-state.marketLogLossEwma / skillTemperature);
    adaptiveMarketWeight = marketSkill / (marketSkill + modelSkill);

    const lossGap = state.modelLogLossEwma - state.marketLogLossEwma;
    if (lossGap > 0) {
      adaptiveMarketWeight = Math.max(adaptiveMarketWeight, 0.68 + clamp(lossGap * 1.3, 0, 0.18));
    }
  }

  const earlySeasonFloor = 0.88 - readiness * 0.2;
  const marketWeight = clamp(Math.max(adaptiveMarketWeight, earlySeasonFloor), 0.42, 0.92);
  let blended = normalize(
    modelProbabilities.map(
      (probability, index) => probability * (1 - marketWeight) + marketProbabilities[index] * marketWeight
    )
  );

  const drawAdjustment = clamp((state.drawActualEwma - state.drawPredEwma) * 0.3, -0.035, 0.035);
  const adjustedDraw = clamp(blended[1] + drawAdjustment, 0.16, 0.36);
  const remaining = Math.max(0.0001, 1 - adjustedDraw);
  const sideTotal = Math.max(0.0001, blended[0] + blended[2]);
  blended = [blended[0] / sideTotal * remaining, adjustedDraw, blended[2] / sideTotal * remaining];

  return {
    modelProbabilities,
    marketProbabilities,
    blendedProbabilities: blended,
    marketWeight,
    readiness,
    expectedGoals: {
      home: round(homeLambda, 3),
      away: round(awayLambda, 3)
    },
    mostLikelyScore: scoreModel.scoreProbabilities[0]
  };
}

function chooseAdaptivePick(state, prediction) {
  const marketPick = argMax(prediction.marketProbabilities);
  const blendedPick = argMax(prediction.blendedProbabilities);
  if (marketPick === blendedPick) {
    return { index: marketPick, source: 'agreement', didOverride: false };
  }

  const blendedAccuracyEdge = state.blendedPickHitEwma - state.marketPickHitEwma;
  const blendedMargin =
    prediction.blendedProbabilities[blendedPick] - prediction.blendedProbabilities[marketPick];
  const enoughEvidence = state.matches >= OVERRIDE_MIN_MATCHES;
  const shouldOverride =
    enoughEvidence &&
    blendedAccuracyEdge > OVERRIDE_EDGE &&
    blendedMargin > OVERRIDE_MARGIN &&
    prediction.marketWeight < OVERRIDE_MAX_MARKET_WEIGHT;

  return {
    index: shouldOverride ? blendedPick : marketPick,
    source: shouldOverride ? 'adaptive_blend' : 'market_guardrail',
    didOverride: shouldOverride
  };
}

function chooseMovementAwarePick(state, prediction, movement) {
  const basePick = chooseAdaptivePick(state, prediction);
  const marketPick = argMax(prediction.marketProbabilities);
  const blendedPick = argMax(prediction.blendedProbabilities);
  if (marketPick === blendedPick || !movement) return basePick;

  const blendedAccuracyEdge = state.blendedPickHitEwma - state.marketPickHitEwma;
  const blendedMargin =
    prediction.blendedProbabilities[blendedPick] - prediction.blendedProbabilities[marketPick];
  const blendedMove = movement.probabilityMove[blendedPick];
  const marketMove = movement.probabilityMove[marketPick];
  const movementEdge = blendedMove - marketMove;
  const enoughEvidence = state.matches >= OVERRIDE_MIN_MATCHES;

  if (basePick.didOverride) {
    const closingMarketMovedAgainstBlend =
      blendedMove < MOVEMENT_GUARD_BLOCK_THRESHOLD && movementEdge < MOVEMENT_GUARD_BLOCK_THRESHOLD;
    return closingMarketMovedAgainstBlend
      ? {
          index: marketPick,
          source: 'movement_guardrail',
          didOverride: false
        }
      : {
          index: basePick.index,
          source: 'movement_confirmed_adaptive',
          didOverride: true
        };
  }

  const movementSupportedOverride =
    enoughEvidence &&
    blendedAccuracyEdge > OVERRIDE_EDGE * 0.75 &&
    blendedMargin > OVERRIDE_MARGIN &&
    prediction.marketWeight < OVERRIDE_MAX_MARKET_WEIGHT &&
    blendedMove > MOVEMENT_SUPPORT_FLOOR &&
    movementEdge > MOVEMENT_SUPPORT_EDGE;

  return {
    index: movementSupportedOverride ? blendedPick : basePick.index,
    source: movementSupportedOverride ? 'movement_supported_adaptive' : basePick.source,
    didOverride: movementSupportedOverride
  };
}

function updateState(state, match, prediction, actualIndex) {
  const home = getTeam(state, match.homeTeam);
  const away = getTeam(state, match.awayTeam);
  const homeGoals = match.homeGoals;
  const awayGoals = match.awayGoals;
  const result = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
  const expectedHome = 1 / (1 + 10 ** ((away.elo - (home.elo + 58)) / 400));
  const margin = Math.max(1, Math.abs(homeGoals - awayGoals));
  const multiplier = Math.log(margin + 1) * (2.2 / (Math.abs(home.elo - away.elo) * 0.001 + 2.2));
  const kFactor = 23;
  const delta = kFactor * multiplier * (result - expectedHome);

  home.elo += delta;
  away.elo -= delta;

  const alpha = 0.16;
  home.goalsFor = home.matches ? home.goalsFor * (1 - alpha) + homeGoals * alpha : homeGoals;
  home.goalsAgainst = home.matches ? home.goalsAgainst * (1 - alpha) + awayGoals * alpha : awayGoals;
  home.points = home.points * (1 - alpha) + (result === 1 ? 3 : result === 0.5 ? 1 : 0) * alpha;
  away.goalsFor = away.matches ? away.goalsFor * (1 - alpha) + awayGoals * alpha : awayGoals;
  away.goalsAgainst = away.matches ? away.goalsAgainst * (1 - alpha) + homeGoals * alpha : homeGoals;
  away.points = away.points * (1 - alpha) + (result === 0 ? 3 : result === 0.5 ? 1 : 0) * alpha;
  home.homeGoalsFor = home.homeMatches
    ? home.homeGoalsFor * (1 - alpha) + homeGoals * alpha
    : homeGoals;
  home.homeGoalsAgainst = home.homeMatches
    ? home.homeGoalsAgainst * (1 - alpha) + awayGoals * alpha
    : awayGoals;
  away.awayGoalsFor = away.awayMatches
    ? away.awayGoalsFor * (1 - alpha) + awayGoals * alpha
    : awayGoals;
  away.awayGoalsAgainst = away.awayMatches
    ? away.awayGoalsAgainst * (1 - alpha) + homeGoals * alpha
    : homeGoals;
  home.matches += 1;
  away.matches += 1;
  home.homeMatches += 1;
  away.awayMatches += 1;

  const leagueAlpha = 0.03;
  state.homeGoals = state.homeGoals * (1 - leagueAlpha) + homeGoals * leagueAlpha;
  state.awayGoals = state.awayGoals * (1 - leagueAlpha) + awayGoals * leagueAlpha;
  state.modelLogLossEwma =
    state.modelLogLossEwma * 0.96 + logLoss(prediction.modelProbabilities, actualIndex) * 0.04;
  state.marketLogLossEwma =
    state.marketLogLossEwma * 0.96 + logLoss(prediction.marketProbabilities, actualIndex) * 0.04;
  state.marketPickHitEwma =
    state.marketPickHitEwma * 0.96 + (argMax(prediction.marketProbabilities) === actualIndex ? 1 : 0) * 0.04;
  state.blendedPickHitEwma =
    state.blendedPickHitEwma * 0.96 + (argMax(prediction.blendedProbabilities) === actualIndex ? 1 : 0) * 0.04;
  state.modelPickHitEwma =
    state.modelPickHitEwma * 0.96 + (argMax(prediction.modelProbabilities) === actualIndex ? 1 : 0) * 0.04;
  state.drawPredEwma = state.drawPredEwma * 0.97 + prediction.blendedProbabilities[1] * 0.03;
  state.drawActualEwma = state.drawActualEwma * 0.97 + (actualIndex === 1 ? 1 : 0) * 0.03;
  state.matches += 1;
}

function makeValueTracker() {
  return {
    candidates: 0,
    stake: 0,
    returned: 0
  };
}

function makeValueSensitivityTracker() {
  return VALUE_SENSITIVITY_GRID.map((rule) => ({
    ...rule,
    candidates: 0,
    hits: 0,
    stake: 0,
    returned: 0,
    edgeTotal: 0
  }));
}

function updateValueTracker(tracker, probabilities, odds, actualIndex) {
  const edges = probabilities.map((probability, index) => probability * odds[index] - 1);
  const bestIndex = argMax(edges);
  if (edges[bestIndex] <= 0.04 || probabilities[bestIndex] < 0.34) return;
  tracker.candidates += 1;
  tracker.stake += 1;
  if (bestIndex === actualIndex) tracker.returned += odds[bestIndex];
}

function updateValueSensitivityTracker(trackers, probabilities, odds, actualIndex) {
  const edges = probabilities.map((probability, index) => probability * odds[index] - 1);
  const bestIndex = argMax(edges);
  const bestEdge = edges[bestIndex];
  const bestProbability = probabilities[bestIndex];
  for (const tracker of trackers) {
    if (bestEdge <= tracker.minEdge || bestProbability < tracker.minProbability) continue;
    tracker.candidates += 1;
    tracker.stake += 1;
    tracker.edgeTotal += bestEdge;
    if (bestIndex === actualIndex) {
      tracker.hits += 1;
      tracker.returned += odds[bestIndex];
    }
  }
}

function finalizeValueTracker(tracker) {
  return {
    candidates: tracker.candidates,
    paper_stake: tracker.stake,
    paper_return: round(tracker.returned, 4),
    paper_roi: tracker.stake ? round((tracker.returned - tracker.stake) / tracker.stake, 4) : null
  };
}

function finalizeValueSensitivityTracker(trackers) {
  return trackers.map((tracker) => ({
    key: tracker.key,
    label: tracker.label,
    min_edge: tracker.minEdge,
    min_probability: tracker.minProbability,
    candidates: tracker.candidates,
    hit_rate: tracker.candidates ? round(tracker.hits / tracker.candidates, 4) : null,
    avg_edge: tracker.candidates ? round(tracker.edgeTotal / tracker.candidates, 4) : null,
    paper_stake: tracker.stake,
    paper_return: round(tracker.returned, 4),
    paper_roi: tracker.stake ? round((tracker.returned - tracker.stake) / tracker.stake, 4) : null
  }));
}

async function downloadCsv(season, leagueCode) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, `${season}-${leagueCode}.csv`);
  const noCache = readOption('--refresh', false);

  if (!noCache) {
    try {
      const cached = await fs.readFile(filePath, 'utf8');
      if (cached.trim()) return { text: cached, filePath, cached: true };
    } catch {
      // Cache miss; fetch below.
    }
  }

  const url = csvUrl(season, leagueCode);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const text = await response.text();
  await fs.writeFile(filePath, text);
  return { text, filePath, cached: false };
}

async function loadMatches(seasons, leagueCodes) {
  const matches = [];
  const files = [];

  for (const season of seasons) {
    for (const leagueCode of leagueCodes) {
      const league = DEFAULT_LEAGUES[leagueCode];
      if (!league) throw new Error(`Unknown league code: ${leagueCode}`);
      const { text, filePath, cached } = await downloadCsv(season, leagueCode);
      const rows = parseCsv(text);
      files.push({
        season,
        leagueCode,
        league: league.name,
        rows: rows.length,
        cached,
        filePath
      });

      for (const row of rows) {
        const kickoff = parseKickoff(row);
        const homeGoals = numeric(row.FTHG);
        const awayGoals = numeric(row.FTAG);
        const outcome = outcomeFromRow(row);
        const odds = primaryOdds(row);

        if (
          !kickoff ||
          !row.HomeTeam ||
          !row.AwayTeam ||
          homeGoals === null ||
          awayGoals === null ||
          !outcome ||
          !odds
        ) {
          continue;
        }

        matches.push({
          id: `${season}-${leagueCode}-${row.Date}-${row.HomeTeam}-${row.AwayTeam}`,
          season,
          seasonLabel: seasonLabel(season),
          leagueCode,
          league: league.name,
          country: league.country,
          kickoff,
          homeTeam: row.HomeTeam,
          awayTeam: row.AwayTeam,
          homeGoals,
          awayGoals,
          outcome,
          row,
          odds
        });
      }
    }
  }

  matches.sort((a, b) => a.kickoff - b.kickoff || a.id.localeCompare(b.id));
  return { matches, files };
}

function evaluate(matches) {
  const leagueStates = new Map();
  const overall = {
    blended: makeMetrics(),
    model: makeMetrics(),
    market: makeMetrics(),
    picks: {
      market: makePickMetrics(),
      blended: makePickMetrics(),
      model: makePickMetrics(),
      adaptive: makePickMetrics(),
      movementAdaptive: makePickMetrics()
    },
    marketWeight: 0,
    value: makeValueTracker(),
    valueSensitivity: makeValueSensitivityTracker()
  };
  const byLeague = new Map();
  const bySeason = new Map();
  const providers = new Map(PROVIDERS.map((provider) => [provider.code, makeProviderMetrics(provider)]));
  const providerBySeason = new Map();
  const providerByLeague = new Map();
  const providerMovements = new Map(PROVIDERS.map((provider) => [provider.code, makeMovementMetrics(provider)]));
  const primaryMovementMetrics = makeMovementMetrics({ code: 'primary', label: 'Primary selected provider' });
  const primaryProviderCounts = new Map();
  const samplePredictions = [];

  for (const match of matches) {
    if (!leagueStates.has(match.leagueCode)) leagueStates.set(match.leagueCode, makeLeagueState());
    if (!byLeague.has(match.leagueCode)) {
      byLeague.set(match.leagueCode, {
        leagueCode: match.leagueCode,
        league: match.league,
        blended: makeMetrics(),
        model: makeMetrics(),
        market: makeMetrics(),
        picks: {
          market: makePickMetrics(),
          blended: makePickMetrics(),
          model: makePickMetrics(),
          adaptive: makePickMetrics(),
          movementAdaptive: makePickMetrics()
        },
        marketWeight: 0,
        value: makeValueTracker(),
        valueSensitivity: makeValueSensitivityTracker()
      });
    }
    if (!bySeason.has(match.season)) {
      bySeason.set(match.season, {
        season: match.season,
        seasonLabel: match.seasonLabel,
        blended: makeMetrics(),
        model: makeMetrics(),
        market: makeMetrics(),
        picks: {
          market: makePickMetrics(),
          blended: makePickMetrics(),
          model: makePickMetrics(),
          adaptive: makePickMetrics(),
          movementAdaptive: makePickMetrics()
        },
        marketWeight: 0,
        value: makeValueTracker(),
        valueSensitivity: makeValueSensitivityTracker()
      });
    }

    const state = leagueStates.get(match.leagueCode);
    const market = oddsToProbabilities(match.odds.odds);
    const actualIndex = OUTCOMES.indexOf(match.outcome);
    const prediction = predictFromState(state, match, market.probabilities);
    const adaptivePick = chooseAdaptivePick(state, prediction);
    const primaryMovement = getMarketMovement(match.row, match.odds.provider);
    const movementAdaptivePick = chooseMovementAwarePick(state, prediction, primaryMovement);
    const leagueBucket = byLeague.get(match.leagueCode);
    const seasonBucket = bySeason.get(match.season);
    const leagueProviderBucket = getProviderSegmentBucket(providerByLeague, match.leagueCode, match.league);
    const seasonProviderBucket = getProviderSegmentBucket(providerBySeason, match.season, match.seasonLabel);

    primaryProviderCounts.set(match.odds.provider, (primaryProviderCounts.get(match.odds.provider) ?? 0) + 1);
    addMovementPrediction(primaryMovementMetrics, primaryMovement, actualIndex);

    for (const bucket of [overall, leagueBucket, seasonBucket]) {
      addPrediction(bucket.blended, prediction.blendedProbabilities, actualIndex);
      addPrediction(bucket.model, prediction.modelProbabilities, actualIndex);
      addPrediction(bucket.market, prediction.marketProbabilities, actualIndex);
      addPick(bucket.picks.market, argMax(prediction.marketProbabilities), actualIndex);
      addPick(bucket.picks.blended, argMax(prediction.blendedProbabilities), actualIndex);
      addPick(bucket.picks.model, argMax(prediction.modelProbabilities), actualIndex);
      addPick(bucket.picks.adaptive, adaptivePick.index, actualIndex, adaptivePick.didOverride);
      addPick(
        bucket.picks.movementAdaptive,
        movementAdaptivePick.index,
        actualIndex,
        movementAdaptivePick.didOverride
      );
      bucket.marketWeight += prediction.marketWeight;
      updateValueTracker(bucket.value, prediction.blendedProbabilities, match.odds.odds, actualIndex);
      updateValueSensitivityTracker(bucket.valueSensitivity, prediction.blendedProbabilities, match.odds.odds, actualIndex);
    }

    for (const provider of PROVIDERS) {
      const providerOdds = extractOdds(match.row, provider.code);
      if (!providerOdds) continue;
      const providerMarket = oddsToProbabilities(providerOdds.odds);
      addProviderPrediction(
        providers.get(provider.code),
        providerMarket.probabilities,
        providerOdds.odds,
        providerMarket.overround,
        actualIndex
      );
      addProviderPrediction(
        leagueProviderBucket.providers.get(provider.code),
        providerMarket.probabilities,
        providerOdds.odds,
        providerMarket.overround,
        actualIndex
      );
      addProviderPrediction(
        seasonProviderBucket.providers.get(provider.code),
        providerMarket.probabilities,
        providerOdds.odds,
        providerMarket.overround,
        actualIndex
      );

      addMovementPrediction(providerMovements.get(provider.code), getMarketMovement(match.row, provider.code), actualIndex);
    }

    if (samplePredictions.length < 12 || match.season === '2526') {
      samplePredictions.push({
        date: new Date(match.kickoff).toISOString().slice(0, 10),
        season: match.seasonLabel,
        league: match.league,
        match: `${match.homeTeam} ${match.homeGoals}-${match.awayGoals} ${match.awayTeam}`,
        predicted: OUTCOMES[argMax(prediction.blendedProbabilities)],
        selected: OUTCOMES[adaptivePick.index],
        selectedBy: adaptivePick.source,
        movementSelected: OUTCOMES[movementAdaptivePick.index],
        movementSelectedBy: movementAdaptivePick.source,
        actual: match.outcome,
        probabilities: {
          home: round(prediction.blendedProbabilities[0], 4),
          draw: round(prediction.blendedProbabilities[1], 4),
          away: round(prediction.blendedProbabilities[2], 4)
        },
        marketWeight: round(prediction.marketWeight, 3),
        marketMovement: primaryMovement
          ? {
              provider: primaryMovement.provider,
              home: round(primaryMovement.probabilityMove[0], 4),
              draw: round(primaryMovement.probabilityMove[1], 4),
              away: round(primaryMovement.probabilityMove[2], 4)
            }
          : null,
        oddsColumns: match.odds.columns
      });
      if (samplePredictions.length > 20) samplePredictions.shift();
    }

    updateState(state, match, prediction, actualIndex);
  }

  function finalizeBucket(bucket) {
    const matchesCount = bucket.blended.matches;
    return {
      blended: finalizeMetrics(bucket.blended),
      model_only: finalizeMetrics(bucket.model),
      market_only: finalizeMetrics(bucket.market),
      decision_accuracy: {
        market: finalizePickMetrics(bucket.picks.market),
        blended: finalizePickMetrics(bucket.picks.blended),
        model: finalizePickMetrics(bucket.picks.model),
        adaptive: finalizePickMetrics(bucket.picks.adaptive),
        movement_adaptive: finalizePickMetrics(bucket.picks.movementAdaptive)
      },
      avg_market_weight: matchesCount ? round(bucket.marketWeight / matchesCount, 4) : null,
      value_research: finalizeValueTracker(bucket.value),
      value_sensitivity: finalizeValueSensitivityTracker(bucket.valueSensitivity)
    };
  }

  const providerTendencies = Array.from(providers.values())
    .map(finalizeProviderMetrics)
    .filter((provider) => provider.rows > 0)
    .sort((a, b) => a.log_loss - b.log_loss);
  const providerBySeasonSegments = summarizeProviderSegmentMap(providerBySeason);
  const providerByLeagueSegments = summarizeProviderSegmentMap(providerByLeague);
  const latestSeasonKey = providerBySeasonSegments.at(-1)?.key ?? null;

  return {
    overall: finalizeBucket(overall),
    by_league: Array.from(byLeague.values()).map((bucket) => ({
      league_code: bucket.leagueCode,
      league: bucket.league,
      ...finalizeBucket(bucket)
    })),
    by_season: Array.from(bySeason.values()).map((bucket) => ({
      season: bucket.season,
      season_label: bucket.seasonLabel,
      ...finalizeBucket(bucket)
    })),
    provider_tendencies: providerTendencies,
    provider_by_season: providerBySeasonSegments,
    provider_by_league: providerByLeagueSegments,
    provider_robustness: buildProviderRobustness(
      providerTendencies,
      providerBySeasonSegments,
      providerByLeagueSegments,
      latestSeasonKey
    ),
    provider_segment_min_rows: PROVIDER_SEGMENT_MIN_ROWS,
    primary_market_movement: finalizeMovementMetrics(primaryMovementMetrics),
    market_movement_by_provider: Array.from(providerMovements.values())
      .map(finalizeMovementMetrics)
      .filter((provider) => provider.rows > 0)
      .sort((a, b) => b.closing_log_loss_lift - a.closing_log_loss_lift),
    primary_odds_provider_order: PRIMARY_PROVIDER_ORDER,
    primary_odds_provider_counts: Object.fromEntries(
      Array.from(primaryProviderCounts.entries()).sort((a, b) => b[1] - a[1])
    ),
    adaptive_pick_config: {
      override_min_matches: OVERRIDE_MIN_MATCHES,
      override_edge: OVERRIDE_EDGE,
      override_margin: OVERRIDE_MARGIN,
      override_max_market_weight: OVERRIDE_MAX_MARKET_WEIGHT,
      movement_guard_block_threshold: MOVEMENT_GUARD_BLOCK_THRESHOLD,
      movement_support_edge: MOVEMENT_SUPPORT_EDGE,
      movement_support_floor: MOVEMENT_SUPPORT_FLOOR
    },
    sample_predictions: samplePredictions
  };
}

function formatPercent(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${round(value * 100, 2)}%`;
}

function formatNumber(value, precision = 4) {
  if (value === null || value === undefined) return 'n/a';
  return String(round(value, precision));
}

function formatRange(stats) {
  if (!stats || stats.range === null || stats.range === undefined) return 'n/a';
  return `${formatNumber(stats.min)}-${formatNumber(stats.max)} (${formatNumber(stats.range)})`;
}

function weightedPickAccuracy(items, key) {
  let correct = 0;
  let matches = 0;
  for (const item of items) {
    const metrics = item.decision_accuracy[key];
    correct += metrics.accuracy * metrics.matches;
    matches += metrics.matches;
  }
  return matches ? correct / matches : null;
}

function makeSeasonHoldout(evaluation) {
  if (evaluation.by_season.length < 2) return null;
  const holdout = evaluation.by_season.at(-1);
  const train = evaluation.by_season.slice(0, -1);
  const trainMarket = weightedPickAccuracy(train, 'market');
  const trainAdaptive = weightedPickAccuracy(train, 'adaptive');
  const trainMovementAdaptive = weightedPickAccuracy(train, 'movement_adaptive');
  const holdoutMarket = weightedPickAccuracy([holdout], 'market');
  const holdoutAdaptive = weightedPickAccuracy([holdout], 'adaptive');
  const holdoutMovementAdaptive = weightedPickAccuracy([holdout], 'movement_adaptive');

  return {
    train_label: `${train[0].season_label}-${train.at(-1).season_label}`,
    holdout_label: holdout.season_label,
    train_market: trainMarket,
    train_adaptive: trainAdaptive,
    train_lift: trainAdaptive - trainMarket,
    train_movement_adaptive: trainMovementAdaptive,
    train_movement_lift: trainMovementAdaptive - trainMarket,
    holdout_market: holdoutMarket,
    holdout_adaptive: holdoutAdaptive,
    holdout_lift: holdoutAdaptive - holdoutMarket,
    holdout_movement_adaptive: holdoutMovementAdaptive,
    holdout_movement_lift: holdoutMovementAdaptive - holdoutMarket
  };
}

function renderMarkdown({ generatedAt, seasons, leagues, files, evaluation }) {
  const scope = `${seasons.map(seasonLabel).join(', ')}; ${leagues
    .map((code) => DEFAULT_LEAGUES[code].name)
    .join(', ')}`;
  const holdout = makeSeasonHoldout(evaluation);
  const holdoutSection = holdout
    ? `
## Recent-Season Robustness Check

This is a stability check, not proof of future edge. It compares the adaptive picker with the market favorite on the newest season after the earlier seasons have already warmed up the league/team state.

| Window | Market pick | Adaptive pick | Adaptive lift | Movement-aware pick | Movement-aware lift |
| --- | ---: | ---: | ---: | ---: | ---: |
| ${holdout.train_label} | ${formatPercent(holdout.train_market)} | ${formatPercent(
        holdout.train_adaptive
      )} | ${formatPercent(holdout.train_lift)} | ${formatPercent(
        holdout.train_movement_adaptive
      )} | ${formatPercent(holdout.train_movement_lift)} |
| ${holdout.holdout_label} | ${formatPercent(holdout.holdout_market)} | ${formatPercent(
        holdout.holdout_adaptive
      )} | ${formatPercent(holdout.holdout_lift)} | ${formatPercent(
        holdout.holdout_movement_adaptive
      )} | ${formatPercent(holdout.holdout_movement_lift)} |
`
    : '';
  const rows = evaluation.by_league
    .map(
      (item) =>
        `| ${item.league} | ${item.blended.matches} | ${formatNumber(item.blended.log_loss)} | ${formatNumber(
          item.market_only.log_loss
        )} | ${formatNumber(item.model_only.log_loss)} | ${formatPercent(item.blended.accuracy)} | ${formatPercent(
          item.avg_market_weight
        )} | ${formatNumber(item.value_research.paper_roi)} |`
    )
    .join('\n');
  const decisionRows = evaluation.by_league
    .map(
      (item) =>
        `| ${item.league} | ${formatPercent(item.decision_accuracy.market.accuracy)} | ${formatPercent(
          item.decision_accuracy.blended.accuracy
        )} | ${formatPercent(item.decision_accuracy.model.accuracy)} | ${formatPercent(
          item.decision_accuracy.adaptive.accuracy
        )} | ${formatPercent(item.decision_accuracy.movement_adaptive.accuracy)} | ${
          item.decision_accuracy.adaptive.overrides
        } | ${item.decision_accuracy.movement_adaptive.overrides} |`
    )
    .join('\n');
  const providerRows = evaluation.provider_tendencies
    .slice(0, 12)
    .map(
      (item) =>
        `| ${item.label} | ${item.rows} | ${formatNumber(item.log_loss)} | ${formatNumber(
          item.avg_overround
        )} | ${formatPercent(item.favorite_hit_rate)} | ${formatNumber(item.outcome_bias.home)} | ${formatNumber(
          item.outcome_bias.draw
        )} | ${formatNumber(item.outcome_bias.away)} |`
    )
    .join('\n');
  const providerRobustnessRows = (evaluation.provider_robustness ?? [])
    .slice(0, 12)
    .map(
      (item) =>
        `| ${item.label} | ${item.rows} | ${formatNumber(item.overall_log_loss)} | ${
          item.season_coverage
        } | ${formatRange(item.season_log_loss)} | ${formatNumber(item.latest_season?.log_loss)} | ${
          item.league_coverage
        } | ${formatRange(item.league_log_loss)} | ${item.top3_season_count} | ${formatNumber(
          item.stability_score
        )} | ${item.note} |`
    )
    .join('\n');
  const providerSeasonSegments = evaluation.provider_by_season ?? [];
  const providerSeasonHeader = providerSeasonSegments.map((segment) => segment.label).join(' | ');
  const providerSeasonAlignment = providerSeasonSegments.map(() => '---:').join(' | ');
  const providerSeasonRows = (evaluation.provider_robustness ?? [])
    .slice(0, 8)
    .map((provider) => {
      const cells = providerSeasonSegments
        .map((segment) => {
          const row = segment.providers.find(
            (item) => item.provider === provider.provider && item.rows >= (evaluation.provider_segment_min_rows ?? 150)
          );
          return row ? `${formatNumber(row.log_loss)} (${row.rows})` : 'n/a';
        })
        .join(' | ');
      return `| ${provider.label} | ${cells} |`;
    })
    .join('\n');
  const primaryProviderRows = Object.entries(evaluation.primary_odds_provider_counts ?? {})
    .map(([provider, count]) => `| ${provider} | ${count} | ${formatPercent(count / evaluation.overall.blended.matches)} |`)
    .join('\n');
  const primaryMovement = evaluation.primary_market_movement;
  const movementRows = evaluation.market_movement_by_provider
    .slice(0, 12)
    .map(
      (item) =>
        `| ${item.label} | ${item.rows} | ${formatNumber(item.opening_log_loss)} | ${formatNumber(
          item.closing_log_loss
        )} | ${formatNumber(item.closing_log_loss_lift)} | ${formatPercent(
          item.opening_pick_accuracy
        )} | ${formatPercent(item.closing_pick_accuracy)} | ${formatPercent(
          item.closing_pick_lift
        )} | ${formatPercent(item.pick_change_rate)} | ${formatNumber(item.changed_pick_net_accuracy)} |`
    )
    .join('\n');
  const seasonRows = evaluation.by_season
    .map(
      (item) =>
        `| ${item.season_label} | ${item.blended.matches} | ${formatNumber(
          item.blended.log_loss
        )} | ${formatNumber(item.market_only.log_loss)} | ${formatNumber(
          item.model_only.log_loss
        )} | ${formatPercent(item.blended.accuracy)} | ${formatPercent(
          item.decision_accuracy.movement_adaptive.accuracy
        )} |`
    )
    .join('\n');

  return `# Historical Model Evaluation

Generated: ${generatedAt}

Data source: ${DATA_SOURCE}

Scope: ${scope}

Primary market source order: ${(evaluation.primary_odds_provider_order ?? PRIMARY_PROVIDER_ORDER).join(' > ')}

## Method

This run uses a walk-forward setup: every match is predicted from team state and odds available on that row, then the final score is used to update Elo, attack/defence form, league scoring level, draw calibration, and the model-vs-market blend. It is intentionally not a fixed backtest fitted on the full result set.

The blend is adaptive. Early in a season, market weight is high because club state is sparse. As evidence accumulates, each league's recent model log loss is compared with market log loss, and the blend moves toward the side that has been better calibrated. There is an online guardrail: when the independent football model is worse than the market, it is automatically down-weighted instead of forcing a fixed backtest conclusion into future matches.

The primary market probability now prefers the configured provider order above. The default uses Betfair Exchange where available, then falls back to market average and other complete odds columns. This is still treated as an input prior, not as ground truth, and the provider coverage table below shows exactly how many matches came from each source.

Provider ranking is also audited by season and league. A provider must clear the segment-size threshold of ${evaluation.provider_segment_min_rows ?? PROVIDER_SEGMENT_MIN_ROWS} matches before its segment log loss counts toward stability. This keeps the provider habit analysis flexible: full-sample performance is treated as evidence to monitor, not a fixed rule to force onto future World Cup matches.

The final pick is evaluated separately from probability calibration. The adaptive picker keeps the market favorite unless the blended model has accumulated better recent hit rate in that league and has enough margin to justify overriding the market. This keeps the logic walk-forward: the selector only uses evidence available before the match being predicted.

This run also measures opening-to-closing market movement. The movement-aware candidate uses only pre-match opening and closing probabilities: it blocks a model override when the closing market has moved clearly against that side, and it can allow a near-threshold override only when closing movement supports the blended side. It is reported beside the existing adaptive picker instead of replacing it silently.

Default adaptive-pick guardrails: minimum prior league matches ${OVERRIDE_MIN_MATCHES}, recent blended-vs-market hit-rate edge above ${formatPercent(
    OVERRIDE_EDGE
  )}, blended probability margin above ${formatPercent(
    OVERRIDE_MARGIN
  )}, and market-weight ceiling ${formatPercent(OVERRIDE_MAX_MARKET_WEIGHT)}.

## Overall

| Metric | Value |
| --- | ---: |
| Matches | ${evaluation.overall.blended.matches} |
| Blended log loss | ${formatNumber(evaluation.overall.blended.log_loss)} |
| Market-only log loss | ${formatNumber(evaluation.overall.market_only.log_loss)} |
| Model-only log loss | ${formatNumber(evaluation.overall.model_only.log_loss)} |
| Blended accuracy | ${formatPercent(evaluation.overall.blended.accuracy)} |
| Market pick accuracy | ${formatPercent(evaluation.overall.decision_accuracy.market.accuracy)} |
| Adaptive pick accuracy | ${formatPercent(evaluation.overall.decision_accuracy.adaptive.accuracy)} |
| Movement-aware pick accuracy | ${formatPercent(evaluation.overall.decision_accuracy.movement_adaptive.accuracy)} |
| Adaptive overrides | ${evaluation.overall.decision_accuracy.adaptive.overrides} |
| Movement-aware overrides | ${evaluation.overall.decision_accuracy.movement_adaptive.overrides} |
| Calibration error | ${formatNumber(evaluation.overall.blended.calibration_error)} |
| Average market weight | ${formatPercent(evaluation.overall.avg_market_weight)} |
| Research value candidates | ${evaluation.overall.value_research.candidates} |
| Research paper ROI | ${formatNumber(evaluation.overall.value_research.paper_roi)} |

## Primary Odds Coverage

| Provider | Matches used | Share |
| --- | ---: | ---: |
${primaryProviderRows}

${holdoutSection}
## By League

| League | Matches | Blended LL | Market LL | Model LL | Accuracy | Market weight | Paper ROI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Decision Accuracy

| League | Market pick | Blended pick | Model pick | Adaptive pick | Movement-aware pick | Adaptive overrides | Movement-aware overrides |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${decisionRows}

## By Season

| Season | Matches | Blended LL | Market LL | Model LL | Accuracy | Movement-aware pick |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${seasonRows}

## Provider Tendencies

Bias columns are average implied probability minus observed outcome rate. Positive draw bias means the provider priced draws higher than the realized draw rate in this sample.

| Provider | Rows | Log loss | Avg overround | Favorite hit | Home bias | Draw bias | Away bias |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${providerRows}

## Provider Robustness

The aggregate provider table is an audit input, not a fixed selector. This section slices each source by season and league; only segments with at least ${evaluation.provider_segment_min_rows ?? PROVIDER_SEGMENT_MIN_ROWS} rows count toward coverage and range.

| Provider | Rows | Overall LL | Season coverage | Season LL range | Latest season LL | League coverage | League LL range | Top-3 seasons | Stability score | Note |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${providerRobustnessRows}

### Provider Log Loss By Season

Cells show log loss with row count in parentheses. Segments below the size threshold are shown as n/a.

| Provider | ${providerSeasonHeader} |
| --- | ${providerSeasonAlignment} |
${providerSeasonRows}

## Opening To Closing Movement

Primary-source movement compares the opening and closing probabilities from the same provider selected by the primary source order.

| Metric | Value |
| --- | ---: |
| Rows with both opening and closing odds | ${primaryMovement.rows} |
| Opening log loss | ${formatNumber(primaryMovement.opening_log_loss)} |
| Closing log loss | ${formatNumber(primaryMovement.closing_log_loss)} |
| Closing log loss lift | ${formatNumber(primaryMovement.closing_log_loss_lift)} |
| Opening pick accuracy | ${formatPercent(primaryMovement.opening_pick_accuracy)} |
| Closing pick accuracy | ${formatPercent(primaryMovement.closing_pick_accuracy)} |
| Closing pick lift | ${formatPercent(primaryMovement.closing_pick_lift)} |
| Pick changed from open to close | ${formatPercent(primaryMovement.pick_change_rate)} |
| Changed-pick net accuracy | ${formatNumber(primaryMovement.changed_pick_net_accuracy)} |
| Avg absolute probability move | ${formatPercent(primaryMovement.avg_abs_probability_move)} |
| Avg actual-outcome probability move | ${formatPercent(primaryMovement.avg_actual_probability_move)} |
| Strengthened closing favorite hit rate | ${formatPercent(primaryMovement.strengthened_closing_favorite_hit_rate)} |

| Provider | Rows | Opening LL | Closing LL | Closing LL lift | Opening pick | Closing pick | Pick lift | Pick changed | Changed-pick net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${movementRows}

## Data Files

${files
  .map(
    (file) =>
      `- ${file.season} ${file.leagueCode} ${file.league}: ${file.rows} raw rows (${file.cached ? 'cache' : 'fetched'})`
  )
  .join('\n')}

## Implications For 2026 World Cup

- Use the market as a strong prior, but keep it separate from the football model so bookmaker/provider bias can be measured and corrected.
- Do not freeze coefficients from this run. For tournament use, run the same walk-forward process on international tournaments and qualifiers, then blend with current squad availability, rest/travel, confederation strength, and bookmaker movement.
- Treat club league data as a player/team-strength proxy, not as a direct replacement for national-team match data.
- For 2026, the next engineering step is to add international fixtures and team ratings, then run the same pre-match prediction ledger before any tournament match result is known.

This report is for model validation and research. It is not betting advice.
`;
}

async function main() {
  const seasons = String(readOption('--seasons', DEFAULT_SEASONS.join(',')))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const leagues = String(readOption('--leagues', Object.keys(DEFAULT_LEAGUES).join(',')))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const { matches, files } = await loadMatches(seasons, leagues);
  const evaluation = evaluate(matches);
  const generatedAt = new Date().toISOString();
  const payload = {
    generated_at: generatedAt,
    data_source: DATA_SOURCE,
    seasons,
    leagues,
    files,
    evaluation
  };

  await fs.writeFile(JSON_REPORT, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(MARKDOWN_REPORT, renderMarkdown({ generatedAt, seasons, leagues, files, evaluation }));

  const summaryRows = evaluation.by_league.map((item) => ({
    league: item.league,
    matches: item.blended.matches,
    blended_log_loss: item.blended.log_loss,
    market_log_loss: item.market_only.log_loss,
    model_log_loss: item.model_only.log_loss,
    accuracy: item.blended.accuracy,
    market_pick: item.decision_accuracy.market.accuracy,
    adaptive_pick: item.decision_accuracy.adaptive.accuracy,
    overrides: item.decision_accuracy.adaptive.overrides,
    market_weight: item.avg_market_weight,
    paper_roi: item.value_research.paper_roi
  }));

  console.table(summaryRows);
  console.log(`Overall blended log loss: ${evaluation.overall.blended.log_loss}`);
  console.log(`Overall market-only log loss: ${evaluation.overall.market_only.log_loss}`);
  console.log(`Overall model-only log loss: ${evaluation.overall.model_only.log_loss}`);
  console.log(`Overall market pick accuracy: ${evaluation.overall.decision_accuracy.market.accuracy}`);
  console.log(`Overall adaptive pick accuracy: ${evaluation.overall.decision_accuracy.adaptive.accuracy}`);
  console.log(`Markdown report: ${MARKDOWN_REPORT}`);
  console.log(`JSON report: ${JSON_REPORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
