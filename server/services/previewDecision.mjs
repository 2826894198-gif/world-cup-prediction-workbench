export const PREVIEW_DECISION_THRESHOLDS = {
  candidate: {
    minValueScore: 0.04,
    minConfidence: 0.52,
    maxUpsetRisk: 0.45
  },
  watch: {
    minValueScoreExclusive: 0,
    minConfidence: 0.44,
    maxUpsetRisk: 0.54
  },
  marketClose: {
    minValueScore: -0.05
  }
};

export const PREVIEW_MARKET_QUALITY_THRESHOLDS = {
  candidate: {
    minProviderCount: 2,
    maxLatestAgeHours: 72,
    maxProviderDisagreement: 0.08
  },
  watch: {
    minProviderCount: 2,
    maxLatestAgeHours: 96,
    maxProviderDisagreement: 0.1
  }
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function dateTime(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function evaluateMarketQuality(input = null) {
  if (!input) {
    return {
      supplied: false,
      candidateReady: true,
      watchReady: true,
      blockedReasons: []
    };
  }
  const providerCount = Number(input.providerCount ?? 0);
  const maxProviderDisagreement = Number(input.maxProviderDisagreement ?? input.maxProbabilityRange ?? 0);
  const capturedTime = dateTime(input.latestCapturedAt ?? input.capturedAt);
  const generatedTime = dateTime(input.generatedAt) ?? Date.now();
  const latestAgeHours =
    capturedTime == null || generatedTime == null ? null : Math.max(0, (generatedTime - capturedTime) / 3_600_000);

  const candidateChecks = {
    providerCount: providerCount >= PREVIEW_MARKET_QUALITY_THRESHOLDS.candidate.minProviderCount,
    latestAge:
      latestAgeHours == null || latestAgeHours <= PREVIEW_MARKET_QUALITY_THRESHOLDS.candidate.maxLatestAgeHours,
    providerDisagreement:
      Number.isFinite(maxProviderDisagreement) &&
      maxProviderDisagreement <= PREVIEW_MARKET_QUALITY_THRESHOLDS.candidate.maxProviderDisagreement
  };
  const watchChecks = {
    providerCount: providerCount >= PREVIEW_MARKET_QUALITY_THRESHOLDS.watch.minProviderCount,
    latestAge: latestAgeHours == null || latestAgeHours <= PREVIEW_MARKET_QUALITY_THRESHOLDS.watch.maxLatestAgeHours,
    providerDisagreement:
      Number.isFinite(maxProviderDisagreement) &&
      maxProviderDisagreement <= PREVIEW_MARKET_QUALITY_THRESHOLDS.watch.maxProviderDisagreement
  };
  const blockedReasons = [];
  if (!watchChecks.providerCount) blockedReasons.push('provider_count');
  if (!watchChecks.latestAge) blockedReasons.push('latest_snapshot_age');
  if (!watchChecks.providerDisagreement) blockedReasons.push('provider_disagreement');

  return {
    supplied: true,
    providerCount,
    latestAgeHours: latestAgeHours == null ? null : round(latestAgeHours, 2),
    maxProviderDisagreement: Number.isFinite(maxProviderDisagreement) ? round(maxProviderDisagreement, 4) : null,
    candidateReady: Object.values(candidateChecks).every(Boolean),
    watchReady: Object.values(watchChecks).every(Boolean),
    candidateChecks,
    watchChecks,
    blockedReasons
  };
}

function applyMarketQuality(decision, quality) {
  if (!quality?.supplied) return decision;
  if (decision.tier === 'candidate') {
    if (quality.candidateReady) return { ...decision, marketQuality: quality };
    if (quality.watchReady) {
      return {
        tier: 'watch',
        label: '盘口质量观察',
        tone: 'watch',
        action: '观察',
        marketQuality: quality
      };
    }
    return {
      tier: 'blocked',
      label: '盘口质量阻断',
      tone: 'muted',
      action: '待复核',
      marketQuality: quality
    };
  }
  if (decision.tier === 'watch' && !quality.watchReady) {
    return {
      tier: 'blocked',
      label: '盘口质量阻断',
      tone: 'muted',
      action: '待复核',
      marketQuality: quality
    };
  }
  return { ...decision, marketQuality: quality };
}

function normalizedMarketQuality(input) {
  if (input?.supplied === true && 'candidateReady' in input && 'watchReady' in input) return input;
  return evaluateMarketQuality(input);
}

export function previewDecision(valueScore, confidence, upsetRisk, marketQualityInput = null) {
  const marketQuality = normalizedMarketQuality(marketQualityInput);
  if (!isFiniteNumber(valueScore) || !isFiniteNumber(confidence) || !isFiniteNumber(upsetRisk)) {
    return {
      tier: 'blocked',
      label: '待接入',
      tone: 'muted',
      action: '等待盘口',
      marketQuality
    };
  }
  if (
    valueScore >= PREVIEW_DECISION_THRESHOLDS.candidate.minValueScore &&
    confidence >= PREVIEW_DECISION_THRESHOLDS.candidate.minConfidence &&
    upsetRisk <= PREVIEW_DECISION_THRESHOLDS.candidate.maxUpsetRisk
  ) {
    return applyMarketQuality({
      tier: 'candidate',
      label: '正价值候选',
      tone: 'positive',
      action: '候选'
    }, marketQuality);
  }
  if (
    valueScore > PREVIEW_DECISION_THRESHOLDS.watch.minValueScoreExclusive &&
    confidence >= PREVIEW_DECISION_THRESHOLDS.watch.minConfidence &&
    upsetRisk <= PREVIEW_DECISION_THRESHOLDS.watch.maxUpsetRisk
  ) {
    return applyMarketQuality({
      tier: 'watch',
      label: '小样本观察',
      tone: 'watch',
      action: '观察'
    }, marketQuality);
  }
  if (valueScore >= PREVIEW_DECISION_THRESHOLDS.marketClose.minValueScore) {
    return {
      tier: 'market_close',
      label: '贴近盘口',
      tone: 'neutral',
      action: '贴盘',
      marketQuality
    };
  }
  return {
    tier: 'negative',
    label: '负价值不追',
    tone: 'avoid',
    action: '不追',
    marketQuality
  };
}
