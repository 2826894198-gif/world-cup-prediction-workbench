export function percent(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `${(value * 100).toFixed(digits)}%`;
}

export function signed(value, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(digits)}`;
}

export function formatDateTime(value) {
  if (!value) return '--';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

export function stageName(stage) {
  const names = {
    group: '小组赛',
    round32: '32强',
    round16: '16强',
    quarterfinal: '1/4决赛',
    semifinal: '半决赛',
    third_place: '三四名',
    final: '决赛'
  };
  return names[stage] || stage;
}

export function riskClass(level) {
  if (level === '高') return 'risk-high';
  if (level === '中') return 'risk-mid';
  return 'risk-low';
}

export function probabilityColor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'quiet';
  if (value >= 0.58) return 'strong';
  if (value >= 0.42) return 'medium';
  return 'quiet';
}
