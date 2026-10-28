import { clamp, round } from '../model/math.mjs';

export const PROBABILITY_UNCERTAINTY_DEFAULTS = {
  calibrationError: 0.0464,
  minMargin: 0.03,
  maxMargin: 0.16,
  providerDisagreementWeight: 0.5,
  staleCandidatePenalty: 0.02,
  staleWatchPenalty: 0.04
};

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function interval(value, margin) {
  return {
    low: round(clamp(value - margin, 0, 1)),
    high: round(clamp(value + margin, 0, 1))
  };
}

export function buildProbabilityUncertainty(probabilities = {}, context = {}) {
  const home = finiteNumber(probabilities.home);
  const draw = finiteNumber(probabilities.draw);
  const away = finiteNumber(probabilities.away);
  if ([home, draw, away].some((value) => value == null)) return null;

  const calibrationError = clamp(
    finiteNumber(context.calibrationError) ?? PROBABILITY_UNCERTAINTY_DEFAULTS.calibrationError,
    0,
    0.2
  );
  const providerDisagreement = clamp(
    finiteNumber(context.providerDisagreement ?? context.maxProviderDisagreement ?? context.maxProbabilityRange) ?? 0,
    0,
    0.25
  );
  const latestAgeHours = finiteNumber(context.latestAgeHours);
  const staleCandidatePenalty =
    context.candidateReady === false ? PROBABILITY_UNCERTAINTY_DEFAULTS.staleCandidatePenalty : 0;
  const staleWatchPenalty =
    context.watchReady === false ? PROBABILITY_UNCERTAINTY_DEFAULTS.staleWatchPenalty : 0;
  const agePenalty =
    latestAgeHours != null && latestAgeHours > 72
      ? clamp(((latestAgeHours - 72) / 72) * 0.01, 0, 0.02)
      : 0;
  const margin = round(
    clamp(
      calibrationError +
        providerDisagreement * PROBABILITY_UNCERTAINTY_DEFAULTS.providerDisagreementWeight +
        staleCandidatePenalty +
        staleWatchPenalty +
        agePenalty,
      PROBABILITY_UNCERTAINTY_DEFAULTS.minMargin,
      PROBABILITY_UNCERTAINTY_DEFAULTS.maxMargin
    )
  );

  return {
    method: 'calibration_provider_freshness_v1',
    margin,
    basis: {
      calibrationError: round(calibrationError),
      providerDisagreement: round(providerDisagreement),
      providerDisagreementWeight: PROBABILITY_UNCERTAINTY_DEFAULTS.providerDisagreementWeight,
      latestAgeHours: latestAgeHours == null ? null : round(latestAgeHours, 2),
      staleCandidatePenalty: round(staleCandidatePenalty),
      staleWatchPenalty: round(staleWatchPenalty),
      agePenalty: round(agePenalty)
    },
    intervals: {
      home: interval(home, margin),
      draw: interval(draw, margin),
      away: interval(away, margin)
    }
  };
}
