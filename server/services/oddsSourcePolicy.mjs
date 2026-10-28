export const TRUSTED_ODDS_SOURCE_TYPES = [
  'official_sporttery_calculator',
  'european_bookmaker_public_snapshot',
  'european_bookmaker_api'
];

export const SECONDARY_ODDS_SOURCE_TYPES = ['dongqiudi_odds_index'];

export const SAMPLE_ODDS_SOURCE_TYPES = ['sample_sandbox_snapshot'];

export const PREDICTION_USABLE_ODDS_SOURCE_TYPES = [
  ...TRUSTED_ODDS_SOURCE_TYPES,
  ...SECONDARY_ODDS_SOURCE_TYPES
];

const TRUSTED_SET = new Set(TRUSTED_ODDS_SOURCE_TYPES);
const SECONDARY_SET = new Set(SECONDARY_ODDS_SOURCE_TYPES);
const SAMPLE_SET = new Set(SAMPLE_ODDS_SOURCE_TYPES);
const PREDICTION_USABLE_SET = new Set(PREDICTION_USABLE_ODDS_SOURCE_TYPES);

export function isTrustedOddsSource(sourceType) {
  return TRUSTED_SET.has(sourceType);
}

export function isSecondaryOddsSource(sourceType) {
  return SECONDARY_SET.has(sourceType);
}

export function isSampleOddsSource(sourceType) {
  return SAMPLE_SET.has(sourceType);
}

export function isPredictionUsableOddsSource(sourceType, { allowSample = false } = {}) {
  return PREDICTION_USABLE_SET.has(sourceType) || (allowSample && SAMPLE_SET.has(sourceType));
}

export function oddsSourceTier(sourceType) {
  if (isTrustedOddsSource(sourceType)) return 'trusted_direct';
  if (isSecondaryOddsSource(sourceType)) return 'secondary_index';
  if (isSampleOddsSource(sourceType)) return 'sample';
  return 'unverified';
}

export function predictionUsableSourceSqlList() {
  return PREDICTION_USABLE_ODDS_SOURCE_TYPES.map((sourceType) => `'${sourceType}'`).join(', ');
}

export function trustedSourceSqlList() {
  return TRUSTED_ODDS_SOURCE_TYPES.map((sourceType) => `'${sourceType}'`).join(', ');
}

export function secondarySourceSqlList() {
  return SECONDARY_ODDS_SOURCE_TYPES.map((sourceType) => `'${sourceType}'`).join(', ');
}

export function preferredPredictionSnapshots(snapshots = [], { allowSample = false } = {}) {
  const trusted = snapshots.filter((snapshot) => isTrustedOddsSource(snapshot.source_type));
  if (trusted.length > 0) return trusted;

  const secondary = snapshots.filter((snapshot) => isSecondaryOddsSource(snapshot.source_type));
  if (secondary.length > 0) return secondary;

  if (!allowSample) return [];
  return snapshots.filter((snapshot) => isSampleOddsSource(snapshot.source_type));
}
