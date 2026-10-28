export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function normalize(probabilities) {
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return probabilities.map(() => 1 / probabilities.length);
  }
  return probabilities.map((value) => value / total);
}

export function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

export function poisson(k, lambda) {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.exp(-lambda) * lambda ** k) / factorial;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state / 4294967296;
  };
}

