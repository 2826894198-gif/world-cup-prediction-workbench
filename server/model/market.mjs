import { clamp, normalize, round } from './math.mjs';

export const PROVIDER_RELIABILITY_EVIDENCE = {
  PS: {
    code: 'PS',
    label: 'Pinnacle',
    rows: 8058,
    overallLogLoss: 0.966,
    stabilityScore: 0.9741,
    seasonCoverage: 5,
    leagueCoverage: 5,
    note: 'consistently top tier'
  },
  B365: {
    code: 'B365',
    label: 'bet365',
    rows: 8907,
    overallLogLoss: 0.969,
    stabilityScore: 0.9798,
    seasonCoverage: 5,
    leagueCoverage: 5,
    note: 'cross-segment stable'
  },
  BFE: {
    code: 'BFE',
    label: 'Betfair Exchange',
    rows: 3396,
    overallLogLoss: 0.9679,
    stabilityScore: 0.9904,
    seasonCoverage: 2,
    leagueCoverage: 5,
    note: 'limited comparable coverage'
  },
  WH: {
    code: 'WH',
    label: 'William Hill',
    rows: 6729,
    overallLogLoss: 0.9679,
    stabilityScore: 0.9947,
    seasonCoverage: 4,
    leagueCoverage: 5,
    note: 'volatile by segment'
  }
};

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function capturedTime(row) {
  const time = new Date(row?.captured_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function outcomeFavorite(probabilities) {
  const [home, draw, away] = probabilities;
  if (home >= draw && home >= away) return 'home';
  if (away >= home && away >= draw) return 'away';
  return 'draw';
}

function providerEvidenceCode(provider) {
  const normalizedProvider = String(provider ?? '').toLowerCase();
  if (normalizedProvider.includes('pinnacle')) return 'PS';
  if (normalizedProvider.includes('bet365')) return 'B365';
  if (normalizedProvider.includes('betfair exchange')) return 'BFE';
  if (normalizedProvider.includes('william hill')) return 'WH';
  return null;
}

export function providerReliability(provider) {
  const code = providerEvidenceCode(provider);
  const evidence = code ? PROVIDER_RELIABILITY_EVIDENCE[code] : null;
  if (!evidence || finiteNumber(evidence.stabilityScore) == null) {
    return {
      provider,
      matched: false,
      code: null,
      label: null,
      weight: 1,
      rows: 0,
      note: 'no historical provider match'
    };
  }
  return {
    provider,
    matched: true,
    code: evidence.code,
    label: evidence.label,
    weight: round(clamp(1 / evidence.stabilityScore, 0.92, 1.08)),
    rows: evidence.rows,
    overallLogLoss: evidence.overallLogLoss,
    stabilityScore: evidence.stabilityScore,
    seasonCoverage: evidence.seasonCoverage,
    leagueCoverage: evidence.leagueCoverage,
    note: evidence.note
  };
}

function neutralProviderReliability(provider) {
  return {
    provider,
    matched: false,
    code: null,
    label: null,
    weight: 1,
    rows: 0,
    note: 'neutralized for ablation'
  };
}

export function marketFromOdds(snapshot) {
  const implied = [1 / snapshot.home_odds, 1 / snapshot.draw_odds, 1 / snapshot.away_odds];
  const [home, draw, away] = normalize(implied);
  const favorite = outcomeFavorite([home, draw, away]);
  const overBias = clamp((snapshot.total_line - 2.25) / 2 + (snapshot.under_water - snapshot.over_water) * 0.18, -0.18, 0.18);
  const asianBias = clamp((snapshot.asian_away_water - snapshot.asian_home_water) * 0.22 + snapshot.asian_line * 0.035, -0.12, 0.12);

  return {
    home: round(home),
    draw: round(draw),
    away: round(away),
    favorite,
    overBias: round(overBias),
    asianBias: round(asianBias)
  };
}

function marketMovementFromSnapshots(snapshots = [], favorite = null) {
  const byProvider = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.provider) continue;
    if (![snapshot.home_odds, snapshot.draw_odds, snapshot.away_odds].every((value) => finiteNumber(value) != null)) continue;
    if (!byProvider.has(snapshot.provider)) byProvider.set(snapshot.provider, []);
    byProvider.get(snapshot.provider).push(snapshot);
  }

  const providerMovements = [];
  for (const [provider, providerSnapshots] of byProvider.entries()) {
    const ordered = providerSnapshots.toSorted(
      (left, right) =>
        capturedTime(left) - capturedTime(right) ||
        Number(left.id ?? 0) - Number(right.id ?? 0)
    );
    if (ordered.length < 2) continue;
    const firstSnapshot = ordered[0];
    const latestSnapshot = ordered.at(-1);
    const firstMarket = marketFromOdds(firstSnapshot);
    const latestMarket = marketFromOdds(latestSnapshot);
    const deltas = {
      home: latestMarket.home - firstMarket.home,
      draw: latestMarket.draw - firstMarket.draw,
      away: latestMarket.away - firstMarket.away
    };
    const reliability = providerReliability(provider);
    const favoriteKey = favorite ?? latestMarket.favorite;
    const capturedSpanHours = Math.max(0, (capturedTime(latestSnapshot) - capturedTime(firstSnapshot)) / 3_600_000);
    providerMovements.push({
      provider,
      snapshots: ordered.length,
      firstCapturedAt: firstSnapshot.captured_at,
      latestCapturedAt: latestSnapshot.captured_at,
      capturedSpanHours: round(capturedSpanHours, 2),
      firstFavorite: firstMarket.favorite,
      latestFavorite: latestMarket.favorite,
      deltas,
      maxAbsMove: Math.max(Math.abs(deltas.home), Math.abs(deltas.draw), Math.abs(deltas.away)),
      favoriteDelta: deltas[favoriteKey],
      reliability
    });
  }

  if (providerMovements.length === 0) {
    return {
      supplied: false,
      method: 'opening_to_latest_by_provider',
      providerCount: 0,
      matchedProviderCount: 0,
      deltas: null,
      favoriteDelta: null,
      favoriteDirection: 'insufficient',
      providers: []
    };
  }

  const weightSum = providerMovements.reduce((sum, item) => sum + item.reliability.weight, 0);
  const weightedDelta = (key) =>
    providerMovements.reduce((sum, item) => sum + item.deltas[key] * item.reliability.weight, 0) /
    Math.max(0.0001, weightSum);
  const deltas = {
    home: weightedDelta('home'),
    draw: weightedDelta('draw'),
    away: weightedDelta('away')
  };
  const strongestOutcome = ['home', 'draw', 'away'].toSorted(
    (left, right) => Math.abs(deltas[right]) - Math.abs(deltas[left])
  )[0];
  const favoriteDelta = favorite ? deltas[favorite] : deltas[strongestOutcome];
  const favoriteDirection =
    favoriteDelta > 0.01 ? 'strengthened' : favoriteDelta < -0.01 ? 'weakened' : 'flat';
  const earliest = providerMovements
    .map((item) => item.firstCapturedAt)
    .toSorted()[0];
  const latest = providerMovements
    .map((item) => item.latestCapturedAt)
    .toSorted()
    .at(-1);

  return {
    supplied: true,
    method: 'opening_to_latest_by_provider',
    providerCount: providerMovements.length,
    matchedProviderCount: providerMovements.filter((item) => item.reliability.matched).length,
    firstCapturedAt: earliest,
    latestCapturedAt: latest,
    deltas: {
      home: round(deltas.home),
      draw: round(deltas.draw),
      away: round(deltas.away)
    },
    strongestOutcome,
    strongestDelta: round(deltas[strongestOutcome]),
    maxAbsProbabilityMove: round(Math.max(Math.abs(deltas.home), Math.abs(deltas.draw), Math.abs(deltas.away))),
    avgProviderAbsProbabilityMove: round(
      providerMovements.reduce((sum, item) => sum + item.maxAbsMove, 0) / providerMovements.length
    ),
    favoriteDelta: round(favoriteDelta),
    favoriteDirection,
    providers: providerMovements.map((item) => ({
      provider: item.provider,
      snapshots: item.snapshots,
      firstCapturedAt: item.firstCapturedAt,
      latestCapturedAt: item.latestCapturedAt,
      capturedSpanHours: item.capturedSpanHours,
      firstFavorite: item.firstFavorite,
      latestFavorite: item.latestFavorite,
      deltas: {
        home: round(item.deltas.home),
        draw: round(item.deltas.draw),
        away: round(item.deltas.away)
      },
      maxAbsMove: round(item.maxAbsMove),
      favoriteDelta: round(item.favoriteDelta),
      reliability: item.reliability
    }))
  };
}

export function marketConsensusFromSnapshots(snapshots = [], options = {}) {
  const useProviderWeights = options.useProviderWeights !== false;
  const includeMovement = options.includeMovement !== false;
  const latestByProvider = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.provider) continue;
    if (
      ![snapshot.home_odds, snapshot.draw_odds, snapshot.away_odds].every((value) => finiteNumber(value) != null)
    ) {
      continue;
    }
    const current = latestByProvider.get(snapshot.provider);
    if (!current || capturedTime(snapshot) > capturedTime(current) || (capturedTime(snapshot) === capturedTime(current) && snapshot.id > current.id)) {
      latestByProvider.set(snapshot.provider, snapshot);
    }
  }

  const providerSnapshots = [...latestByProvider.values()].sort(
    (left, right) => capturedTime(left) - capturedTime(right) || String(left.provider).localeCompare(String(right.provider))
  );
  if (providerSnapshots.length === 0) {
    return {
      method: 'equal_provider_average',
      providerCount: 0,
      matchedProviderCount: 0,
      snapshotCount: snapshots.length,
      home: null,
      draw: null,
      away: null,
      favorite: null,
      maxProbabilityRange: null,
      avgProbabilityRange: null,
      latestCapturedAt: null,
      oldestProviderCapturedAt: null,
      primaryAgreement: null,
      providerWeightRange: null,
      movement: {
        supplied: false,
        method: 'opening_to_latest_by_provider',
        providerCount: 0,
        matchedProviderCount: 0,
        deltas: null,
        favoriteDelta: null,
        favoriteDirection: 'insufficient',
        providers: []
      },
      providers: []
    };
  }

  const providerMarkets = providerSnapshots.map((snapshot) => ({
    snapshot,
    market: marketFromOdds(snapshot),
    reliability: useProviderWeights ? providerReliability(snapshot.provider) : neutralProviderReliability(snapshot.provider)
  }));
  const weightSum = providerMarkets.reduce((sum, item) => sum + item.reliability.weight, 0);
  const average = (key) =>
    providerMarkets.reduce((sum, item) => sum + item.market[key] * item.reliability.weight, 0) /
    Math.max(0.0001, weightSum);
  const range = (key) => {
    const values = providerMarkets.map((item) => item.market[key]);
    return Math.max(...values) - Math.min(...values);
  };
  const home = average('home');
  const draw = average('draw');
  const away = average('away');
  const normalized = normalize([home, draw, away]);
  const ranges = [range('home'), range('draw'), range('away')];
  const favorite = outcomeFavorite(normalized);
  const primary = snapshots.at(-1);
  const primaryMarket = primary ? marketFromOdds(primary) : null;
  const latestCapturedAt = providerSnapshots.at(-1)?.captured_at ?? null;
  const oldestProviderCapturedAt = providerSnapshots.at(0)?.captured_at ?? null;
  const matchedProviderCount = providerMarkets.filter((item) => item.reliability.matched).length;
  const weightValues = providerMarkets.map((item) => item.reliability.weight);
  const movement = includeMovement
    ? marketMovementFromSnapshots(snapshots, favorite)
    : {
        supplied: false,
        method: 'opening_to_latest_by_provider',
        providerCount: 0,
        matchedProviderCount: 0,
        deltas: null,
        favoriteDelta: null,
        favoriteDirection: 'disabled',
        providers: []
      };

  return {
    method: useProviderWeights && matchedProviderCount > 0 ? 'historical_provider_weighted' : 'equal_provider_average',
    providerCount: providerSnapshots.length,
    matchedProviderCount,
    snapshotCount: snapshots.length,
    home: round(normalized[0]),
    draw: round(normalized[1]),
    away: round(normalized[2]),
    favorite,
    maxProbabilityRange: round(Math.max(...ranges)),
    avgProbabilityRange: round(ranges.reduce((sum, value) => sum + value, 0) / ranges.length),
    latestCapturedAt,
    oldestProviderCapturedAt,
    primaryAgreement: primaryMarket ? primaryMarket.favorite === favorite : null,
    providerWeightRange: {
      min: round(Math.min(...weightValues)),
      max: round(Math.max(...weightValues))
    },
    movement,
    homeOddsRange: {
      min: round(Math.min(...providerSnapshots.map((snapshot) => snapshot.home_odds)), 2),
      max: round(Math.max(...providerSnapshots.map((snapshot) => snapshot.home_odds)), 2)
    },
    drawOddsRange: {
      min: round(Math.min(...providerSnapshots.map((snapshot) => snapshot.draw_odds)), 2),
      max: round(Math.max(...providerSnapshots.map((snapshot) => snapshot.draw_odds)), 2)
    },
    awayOddsRange: {
      min: round(Math.min(...providerSnapshots.map((snapshot) => snapshot.away_odds)), 2),
      max: round(Math.max(...providerSnapshots.map((snapshot) => snapshot.away_odds)), 2)
    },
    providers: providerSnapshots.map((snapshot) => ({
      provider: snapshot.provider,
      capturedAt: snapshot.captured_at,
      homeOdds: snapshot.home_odds,
      drawOdds: snapshot.draw_odds,
      awayOdds: snapshot.away_odds,
      reliability: useProviderWeights ? providerReliability(snapshot.provider) : neutralProviderReliability(snapshot.provider)
    }))
  };
}

export function buildSyntheticOdds(match, home, away, index = 0) {
  const diff = (home.elo - away.elo) / 400;
  const drift = Math.sin((match.match_no + 1) * (index + 2)) * 0.055;
  const homeProb = clamp(0.38 + diff * 0.19 + drift, 0.16, 0.72);
  const drawProb = clamp(0.255 - Math.abs(diff) * 0.035 + Math.cos(match.match_no + index) * 0.012, 0.18, 0.31);
  const awayProb = clamp(1 - homeProb - drawProb, 0.12, 0.68);
  const margin = 1.055 + ((match.match_no + index) % 5) * 0.006;
  const normalized = normalize([homeProb, drawProb, awayProb]);
  const asianLineRaw = (home.elo - away.elo) / 185;
  const asianLine = Math.round(clamp(asianLineRaw, -2.25, 2.25) * 4) / 4;
  const totalLine = Math.round(clamp(2.25 + (home.attack + away.attack - 1.98) * 0.9 + drift, 1.75, 3.75) * 4) / 4;

  return {
    home_odds: round(1 / (normalized[0] * margin), 2),
    draw_odds: round(1 / (normalized[1] * margin), 2),
    away_odds: round(1 / (normalized[2] * margin), 2),
    asian_line: asianLine,
    asian_home_water: round(clamp(0.84 + (0.5 - normalized[0]) * 0.28 + drift, 0.72, 1.08), 2),
    asian_away_water: round(clamp(0.86 + (normalized[0] - 0.5) * 0.26 - drift, 0.72, 1.08), 2),
    total_line: totalLine,
    over_water: round(clamp(0.86 - (totalLine - 2.5) * 0.08 + drift, 0.74, 1.06), 2),
    under_water: round(clamp(0.88 + (totalLine - 2.5) * 0.08 - drift, 0.74, 1.06), 2)
  };
}
