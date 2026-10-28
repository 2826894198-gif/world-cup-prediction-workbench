import { percent, signed, stageName } from './format.js';
import { buildMarketOutputs } from './marketOutputs.js';

const POSTER_WIDTH = 1200;
const POSTER_HEIGHT = 1600;
const CARD_RADIUS = 30;
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});
const DAY_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short'
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasPrediction(match) {
  return match?.hasPrediction ?? match?.recommendedPick != null;
}

function dateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function recommendationScore(match) {
  const tone = match.previewDecision?.tone;
  const toneScore = tone === 'positive' ? 18 : tone === 'watch' ? 8 : tone === 'avoid' ? -16 : 0;
  const riskPenalty = match.riskLevel === '高' ? 14 : match.riskLevel === '中' ? 6 : 0;
  return (
    Number(match.confidence ?? 0) * 100 +
    Number(match.valueScore ?? 0) * 84 -
    Number(match.upsetRisk ?? 0) * 34 +
    toneScore -
    riskPenalty
  );
}

function pickSlate(matches, today = new Date()) {
  const predictedMatches = matches.filter(hasPrediction);
  const todayKey = dateKey(today);
  const todayMatches = predictedMatches.filter((match) => dateKey(match.kickoffUtc) === todayKey);
  const upcomingMatches = predictedMatches.filter((match) => dateKey(match.kickoffUtc) >= todayKey);
  const fallbackKey = upcomingMatches.length
    ? dateKey(upcomingMatches.toSorted((left, right) => new Date(left.kickoffUtc) - new Date(right.kickoffUtc))[0].kickoffUtc)
    : dateKey(predictedMatches[0]?.kickoffUtc);
  const slateKey = todayMatches.length ? todayKey : fallbackKey;
  const slateMatches = predictedMatches
    .filter((match) => dateKey(match.kickoffUtc) === slateKey)
    .toSorted((left, right) => recommendationScore(right) - recommendationScore(left) || new Date(left.kickoffUtc) - new Date(right.kickoffUtc));

  return {
    matches: slateMatches.slice(0, 4),
    isToday: slateKey === todayKey,
    slateKey,
    dayLabel: slateMatches[0]?.kickoffUtc ? DAY_FORMATTER.format(new Date(slateMatches[0].kickoffUtc)) : DAY_FORMATTER.format(today)
  };
}

function scoreText(match) {
  const scores = match.scoreCandidates ?? [];
  return scores
    .slice(0, 2)
    .map((score) => `${score.homeGoals}-${score.awayGoals}`)
    .join(' / ') || '--';
}

function goalsText(outputs) {
  const labels = (outputs.goalCount?.candidates ?? [])
    .map((candidate) => candidate?.label)
    .filter(Boolean)
    .slice(0, 2);
  return labels.length ? labels.join(' / ') : outputs.goalCount?.label ?? '--';
}

function buildPosterRows(matches, marketAudit) {
  return matches.map((match) => {
    const outputs = buildMarketOutputs(match, marketAudit);
    return {
      match,
      outputs,
      title: `${match.homeTeam} vs ${match.awayTeam}`,
      round: `${match.roundLabel ?? stageName(match.stage)} · #${match.matchNo}`,
      time: DATE_FORMATTER.format(new Date(match.kickoffUtc)),
      pick: outputs.moneyline?.label ?? match.recommendedPick ?? '观察',
      confidence: percent(match.confidence, 1),
      score: scoreText(match),
      goals: goalsText(outputs),
      sporttery: outputs.sporttery?.label ?? '待接入',
      handicap: outputs.handicap?.label ?? '观察',
      value: signed(match.valueScore, 2),
      risk: match.riskLevel ?? '未评估',
      reason: [
        outputs.moneyline?.metric ? `胜平负 ${outputs.moneyline.metric}` : '',
        outputs.total?.metric ? `大小球 ${outputs.total.metric}` : '',
        outputs.sporttery?.detail ? outputs.sporttery.detail : ''
      ]
        .filter(Boolean)
        .join(' · ')
    };
  });
}

function setupCanvas() {
  const canvas = document.createElement('canvas');
  const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = POSTER_WIDTH * ratio;
  canvas.height = POSTER_HEIGHT * ratio;
  canvas.style.width = `${POSTER_WIDTH}px`;
  canvas.style.height = `${POSTER_HEIGHT}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  return { canvas, ctx };
}

function roundRect(ctx, x, y, width, height, radius = CARD_RADIUS) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, width, height, radius, strokeStyle, lineWidth = 1) {
  roundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text ?? '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const chars = String(text ?? '').split('');
  const lines = [];
  let current = '';
  chars.forEach((char) => {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  lines.slice(0, maxLines).forEach((line, index) => {
    const suffix = index === maxLines - 1 && lines.length > maxLines ? '...' : '';
    ctx.fillText(truncateText(ctx, `${line}${suffix}`, maxWidth), x, y + index * lineHeight);
  });
}

function drawBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  gradient.addColorStop(0, '#061524');
  gradient.addColorStop(0.45, '#0a2d3e');
  gradient.addColorStop(1, '#071019');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  ctx.strokeStyle = 'rgba(141, 210, 235, 0.12)';
  ctx.lineWidth = 2;
  for (let x = 80; x < POSTER_WIDTH; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, POSTER_HEIGHT);
    ctx.stroke();
  }
  for (let y = 90; y < POSTER_HEIGHT; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(POSTER_WIDTH, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(126, 234, 201, 0.16)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(POSTER_WIDTH - 70, 160, 260, 0.78 * Math.PI, 1.72 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(130, POSTER_HEIGHT - 130, 220, -0.36 * Math.PI, 0.58 * Math.PI);
  ctx.stroke();
}

function drawBadge(ctx, text, x, y, fill = 'rgba(30, 126, 187, 0.24)', color = '#dff7ff') {
  ctx.font = '700 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  const width = Math.ceil(ctx.measureText(text).width) + 32;
  fillRoundRect(ctx, x, y, width, 44, 22, fill);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 16, y + 30);
  return width;
}

function drawMetric(ctx, label, value, x, y, width) {
  fillRoundRect(ctx, x, y, width, 112, 22, 'rgba(255, 255, 255, 0.075)');
  strokeRoundRect(ctx, x, y, width, 112, 22, 'rgba(163, 219, 241, 0.16)');
  ctx.fillStyle = '#95b7c9';
  ctx.font = '700 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(label, x + 24, y + 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 44px Inter, "PingFang SC", sans-serif';
  ctx.fillText(value, x + 24, y + 84);
}

function drawHeader(ctx, slate, rows) {
  const logo = ctx.createLinearGradient(62, 58, 194, 122);
  logo.addColorStop(0, '#ffe16e');
  logo.addColorStop(0.42, '#19c488');
  logo.addColorStop(1, '#1978f0');
  fillRoundRect(ctx, 62, 58, 132, 64, 18, logo);
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(88, 96);
  ctx.lineTo(112, 96);
  ctx.lineTo(126, 78);
  ctx.lineTo(142, 106);
  ctx.lineTo(166, 80);
  ctx.stroke();

  ctx.fillStyle = '#8fd2ea';
  ctx.font = '700 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('世界杯预测 · 官方赛程工作台', 222, 86);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 72px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(slate.isToday ? '今日推荐' : '最近赛程推荐', 220, 158);
  ctx.fillStyle = '#9ac0d2';
  ctx.font = '500 27px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${slate.dayLabel} · 本地时间 · 模型盘口合成`, 222, 206);

  drawBadge(ctx, slate.isToday ? 'TODAY PICKS' : 'NEXT SLATE', 900, 72, 'rgba(126, 234, 201, 0.18)', '#adffe4');

  const avgConfidence = rows.length
    ? percent(rows.reduce((sum, row) => sum + Number(row.match.confidence ?? 0), 0) / rows.length, 1)
    : '--';
  drawMetric(ctx, '推荐场次', `${rows.length}`, 72, 260, 310);
  drawMetric(ctx, '平均信心', avgConfidence, 412, 260, 310);
  drawMetric(ctx, '正价值', `${rows.filter((row) => Number(row.match.valueScore ?? 0) > 0).length}`, 752, 260, 310);
}

function drawFeaturedCard(ctx, row, y) {
  const cardGradient = ctx.createLinearGradient(72, y, 1128, y + 410);
  cardGradient.addColorStop(0, 'rgba(251, 253, 255, 0.97)');
  cardGradient.addColorStop(1, 'rgba(221, 242, 247, 0.92)');
  fillRoundRect(ctx, 72, y, 1056, 410, 34, cardGradient);
  strokeRoundRect(ctx, 72, y, 1056, 410, 34, 'rgba(255,255,255,0.62)', 2);

  drawBadge(ctx, '主推场次', 112, y + 38, 'rgba(20, 121, 232, 0.14)', '#126ed0');
  ctx.fillStyle = '#71889b';
  ctx.font = '700 25px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(row.round, 112, y + 130);
  ctx.fillStyle = '#102133';
  ctx.font = '900 56px "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(ctx, row.title, 112, y + 196, 620, 62, 2);

  ctx.fillStyle = '#5d7082';
  ctx.font = '600 25px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${row.time} · ${row.match.venue ?? '赛地待确认'}`, 112, y + 318);

  fillRoundRect(ctx, 785, y + 52, 286, 134, 28, '#102133');
  ctx.fillStyle = '#8ef0cb';
  ctx.font = '700 24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('推荐方向', 815, y + 92);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 58px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(truncateText(ctx, row.pick, 220), 815, y + 158);

  const metricY = y + 228;
  [['比分', row.score], ['进球', row.goals], ['信心', row.confidence]].forEach(([label, value], index) => {
    const x = 785 + index * 96;
    fillRoundRect(ctx, x, metricY, 84, 98, 18, 'rgba(16, 33, 51, 0.08)');
    ctx.fillStyle = '#647687';
    ctx.font = '700 21px "PingFang SC", sans-serif';
    ctx.fillText(label, x + 18, metricY + 32);
    ctx.fillStyle = '#102133';
    ctx.font = '900 26px Inter, "PingFang SC", sans-serif';
    wrapText(ctx, value, x + 18, metricY + 70, 54, 28, 1);
  });
}

function drawCompactCard(ctx, row, x, y, width, height) {
  fillRoundRect(ctx, x, y, width, height, 28, 'rgba(255, 255, 255, 0.09)');
  strokeRoundRect(ctx, x, y, width, height, 28, 'rgba(162, 215, 238, 0.18)');

  ctx.fillStyle = '#83d7f7';
  ctx.font = '800 23px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(row.time, x + 26, y + 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 29px "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(ctx, row.title, x + 26, y + 92, width - 52, 34, 2);
  ctx.fillStyle = '#8fb4ca';
  ctx.font = '600 20px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(truncateText(ctx, row.round, width - 52), x + 26, y + 154);

  fillRoundRect(ctx, x + 26, y + 176, width - 52, 62, 20, 'rgba(126, 234, 201, 0.12)');
  ctx.fillStyle = '#94ffe0';
  ctx.font = '700 21px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('推荐', x + 48, y + 202);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 31px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(truncateText(ctx, row.pick, width - 160), x + 132, y + 205);

  const statY = y + height - 54;
  [
    ['比分', row.score],
    ['进球', row.goals],
    ['信心', row.confidence]
  ].forEach(([label, value], index) => {
    const columnWidth = (width - 52) / 3;
    const columnX = x + 26 + index * columnWidth;
    ctx.fillStyle = '#83a7bb';
    ctx.font = '700 18px "PingFang SC", sans-serif';
    ctx.fillText(label, columnX, statY);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 24px Inter, "PingFang SC", sans-serif';
    ctx.fillText(truncateText(ctx, value, columnWidth - 10), columnX, statY + 34);
  });
}

function drawInsightPanel(ctx, rows, x, y, width, height) {
  fillRoundRect(ctx, x, y, width, height, 28, 'rgba(126, 234, 201, 0.1)');
  strokeRoundRect(ctx, x, y, width, height, 28, 'rgba(126, 234, 201, 0.2)');
  ctx.fillStyle = '#94ffe0';
  ctx.font = '800 25px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('传播看点', x + 28, y + 50);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 38px "PingFang SC", "Microsoft YaHei", sans-serif';
  const main = rows[0];
  ctx.fillText(main ? `${main.pick}主线` : '暂无主线', x + 28, y + 102);
  ctx.fillStyle = '#9ebdd1';
  ctx.font = '500 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  wrapText(
    ctx,
    main ? `${main.title} 以比分 ${main.score} 和 ${main.goals} 做传播主视觉，盘口层同步参考 ${main.handicap}。` : '当前日期缺少可展示的模型推荐。',
    x + 28,
    y + 148,
    width - 56,
    32,
    3
  );
}

function drawFooter(ctx, rows) {
  const y = 1428;
  fillRoundRect(ctx, 72, y, 1056, 96, 28, 'rgba(8, 21, 34, 0.72)');
  strokeRoundRect(ctx, 72, y, 1056, 96, 28, 'rgba(159, 217, 239, 0.16)');
  ctx.fillStyle = '#eff8ff';
  ctx.font = '800 27px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('模型观点', 110, y + 40);
  ctx.fillStyle = '#9ebdd1';
  ctx.font = '500 22px "PingFang SC", "Microsoft YaHei", sans-serif';
  const line = rows[0]
    ? `${rows[0].title}：${rows[0].pick}，比分 ${rows[0].score}，${rows[0].reason}`
    : '暂无可生成的推荐场次。';
  ctx.fillText(truncateText(ctx, line, 900), 110, y + 75);

  ctx.fillStyle = '#65879c';
  ctx.font = '500 18px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('仅作赛前研究与复盘展示，不作为任何投注承诺。', 72, 1568);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片生成失败'));
    }, 'image/png', 0.98);
  });
}

export async function generateRecommendationPoster({ matches, summary, marketAudit }) {
  const slate = pickSlate(matches);
  const rows = buildPosterRows(slate.matches, marketAudit);
  if (!rows.length) {
    throw new Error('当前没有可生成推荐图的预测场次');
  }

  const { canvas, ctx } = setupCanvas();
  drawBackground(ctx);
  drawHeader(ctx, slate, rows, summary);
  drawFeaturedCard(ctx, rows[0], 420);

  const compactRows = rows.slice(1);
  const compactY = 874;
  const compactHeight = 246;
  const compactGap = 24;
  compactRows.forEach((row, index) => {
    const x = index % 2 === 0 ? 72 : 612;
    const y = compactY + Math.floor(index / 2) * (compactHeight + compactGap);
    drawCompactCard(ctx, row, x, y, 516, compactHeight);
  });
  if (compactRows.length === 0) {
    drawInsightPanel(ctx, rows, 72, compactY, 1056, 246);
  } else if (compactRows.length === 1) {
    drawInsightPanel(ctx, rows, 612, compactY, 516, compactHeight);
  } else if (compactRows.length === 2) {
    drawInsightPanel(ctx, rows, 72, compactY + compactHeight + compactGap, 1056, 246);
  }
  drawFooter(ctx, rows);

  const blob = await canvasToBlob(canvas);
  const imageUrl = URL.createObjectURL(blob);
  return {
    blob,
    imageUrl,
    fileName: `worldcup-recommendation-${slate.slateKey || dateKey(new Date())}.png`,
    meta: {
      count: rows.length,
      isToday: slate.isToday,
      dayLabel: slate.dayLabel,
      title: slate.isToday ? '今日推荐' : '最近赛程推荐'
    }
  };
}
