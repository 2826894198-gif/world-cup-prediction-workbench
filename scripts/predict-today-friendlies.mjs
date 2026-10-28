#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildScoreModel } from '../server/model/poisson.mjs';
import { clamp, normalize, round } from '../server/model/math.mjs';
import { buildMarketOutputs } from '../src/lib/marketOutputs.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const INTERNATIONAL_REPORT = path.join(ROOT_DIR, 'reports/international-model-evaluation.json');
const OUTPUT_JSON = path.join(ROOT_DIR, 'reports/today-friendly-predictions.json');
const OUTPUT_MD = path.join(ROOT_DIR, 'reports/today-friendly-predictions.md');

const TODAY = '2026-06-09';
const SOURCES = [
  {
    name: 'BBC Sport',
    url: 'https://www.bbc.co.uk/sport/football/scores-fixtures/2026-06-09',
    note: 'BBC page states all listed times are UK time and subject to change.'
  },
  {
    name: 'Sports Mole',
    url: 'https://www.sportsmole.co.uk/football/international-friendlies/fixtures.html',
    note: 'Used as a second fixture/status cross-check.'
  },
  {
    name: 'FootyStats',
    url: 'https://footystats.org/international/international-friendlies/fixtures',
    note: 'Used only as single-source public odds/status reference; not treated as complete盘口.'
  },
  {
    name: 'Soccerbase',
    url: 'https://www.soccerbase.com/matches/results.sd?date=2026-06-09',
    note: 'Used as a third fixture cross-check for the core international-friendly slate.'
  }
];

const FIXTURES = [
  { timeUk: '03:00', home: 'Peru', away: 'Spain', status: 'finished', result: '1-3', sourceNotes: ['BBC', 'Soccerbase', 'FootyStats'] },
  { timeUk: '07:00', home: 'Vanuatu', away: 'Fiji', status: 'finished', result: '2-2', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'] },
  { timeUk: '10:00', home: 'Ethiopia', away: 'Malawi', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 2.5, draw: 3.2, away: 2.9 } },
  { timeUk: '12:30', home: 'Philippines', away: 'Myanmar', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 1.45, draw: 3.88, away: 5.7 } },
  { timeUk: '12:35', home: 'China', away: 'Thailand', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats'], odds: { home: 1.88, draw: 3, away: 3.7 } },
  { timeUk: '13:00', home: 'Cambodia', away: 'Hong Kong', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 3.26, draw: 3.49, away: 2.19 } },
  { timeUk: '14:00', home: 'Indonesia', away: 'Mozambique', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats'], odds: { home: 1.33, draw: 4.75, away: 8 } },
  { timeUk: '15:30', home: 'Kyrgyzstan', away: 'Palestine', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 2.6, draw: 3.05, away: 2.43 } },
  { timeUk: '16:00', home: 'Armenia', away: 'Moldova', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats'], odds: { home: 1.67, draw: 3.62, away: 5.2 } },
  { timeUk: '16:00', home: 'Tajikistan', away: 'India', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 1.68, draw: 3.45, away: 4.6 } },
  { timeUk: '17:00', home: 'DR Congo', away: 'Chile', status: 'cancelled_or_postponed', sourceNotes: ['Sports Mole P-P', 'FootyStats CANC', 'BBC/Soccerbase still list fixture'], odds: { home: 2.36, draw: 3.2, away: 3.2 } },
  { timeUk: '17:00', home: 'Tanzania', away: 'Rwanda', status: 'cancelled_or_postponed', sourceNotes: ['BBC cancelled', 'Sports Mole/Soccerbase still list fixture'] },
  { timeUk: '17:00', home: 'Liberia', away: 'Sierra Leone', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 2.51, draw: 3.06, away: 2.9 } },
  { timeUk: '17:30', home: 'Belarus', away: 'Burkina Faso', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats'], odds: { home: 2.9, draw: 3.3, away: 2.4 } },
  { timeUk: '18:00', home: 'Russia', away: 'Trinidad and Tobago', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats'], odds: { home: 1.01, draw: 16, away: 25 } },
  { timeUk: '18:00', home: 'Hungary', away: 'Kazakhstan', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats'], odds: { home: 1.23, draw: 5.65, away: 9.9 } },
  { timeUk: '19:00', home: 'Azerbaijan', away: 'San Marino', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'Soccerbase', 'FootyStats odds appear directionally inconsistent'], odds: null },
  { timeUk: '19:00', home: 'Togo', away: 'Benin', status: 'scheduled', sourceNotes: ['BBC', 'Sports Mole', 'FootyStats'], odds: { home: 2.33, draw: 2.77, away: 3.01 } },
  { timeUk: '20:00', home: 'Central African Republic', away: 'Angola', status: 'scheduled', sourceNotes: ['BBC lists CAR vs Angola', 'Sports Mole listed Angola vs CAR earlier; final BBC ordering used'], odds: { home: 1.65, draw: 3.7, away: 5.5 } },
  { timeUk: 'TBC', home: 'Oman', away: 'Kuwait', status: 'cancelled_or_tbc', sourceNotes: ['BBC TBC', 'Sports Mole/FootyStats show postponed/cancelled'], odds: { home: 1.82, draw: 3.45, away: 4.15 } },
  { timeUk: '01:00', home: 'Botswana', away: 'Niger', status: 'cancelled', sourceNotes: ['BBC cancelled'] },
  { timeUk: '01:00', home: 'Comoros', away: 'Equatorial Guinea', status: 'cancelled', sourceNotes: ['BBC/Sports Mole/FootyStats cancelled'] },
  { timeUk: '01:00', home: 'Mauritania', away: 'Liberia', status: 'cancelled', sourceNotes: ['BBC/Sports Mole/FootyStats cancelled'] },
  { timeUk: '15:00', home: 'Bahrain', away: 'Syria', status: 'cancelled', sourceNotes: ['BBC/FootyStats cancelled'] }
];

const TEAM_ALIASES = new Map([
  ['burkina', 'burkina faso'],
  ['burkina faso', 'burkina faso'],
  ['central african republic', 'central african republic'],
  ['car', 'central african republic'],
  ['congo dr', 'dr congo'],
  ['dr congo', 'dr congo'],
  ['democratic republic of congo', 'dr congo'],
  ['football union of russia', 'russia'],
  ['hong kong', 'hong kong'],
  ['kyrgyz republic', 'kyrgyzstan'],
  ['trinidad', 'trinidad and tobago'],
  ['trinidad & tobago', 'trinidad and tobago'],
  ['trinidad and tobago', 'trinidad and tobago']
]);

function normalizeName(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

function pct(value, digits = 1) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '--';
}

function pickKey(probabilities) {
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  const max = Math.max(...values);
  const index = values.indexOf(max);
  return index === 0 ? 'home' : index === 1 ? 'draw' : 'away';
}

function pickLabel(key) {
  if (key === 'home') return '主胜';
  if (key === 'away') return '客胜';
  return '平局';
}

function oppositeWeakness(team) {
  return clamp(2 - Number(team?.defense ?? 1), 0.58, 1.32);
}

function impliedOddsProbabilities(odds) {
  if (!odds?.home || !odds?.draw || !odds?.away) return null;
  const raw = [1 / odds.home, 1 / odds.draw, 1 / odds.away];
  const [home, draw, away] = normalize(raw);
  return { home, draw, away };
}

function blendProbabilities(modelProbabilities, odds) {
  const market = impliedOddsProbabilities(odds);
  if (!market) return { probabilities: modelProbabilities, market, marketWeight: 0, marketConflict: false };
  const modelPick = pickKey(modelProbabilities);
  const marketPick = pickKey(market);
  if (modelPick !== marketPick) {
    return { probabilities: modelProbabilities, market, marketWeight: 0, marketConflict: true };
  }
  const marketWeight = 0.12;
  const [home, draw, away] = normalize([
    modelProbabilities.home * (1 - marketWeight) + market.home * marketWeight,
    modelProbabilities.draw * (1 - marketWeight) + market.draw * marketWeight,
    modelProbabilities.away * (1 - marketWeight) + market.away * marketWeight
  ]);
  return { probabilities: { home, draw, away }, market, marketWeight, marketConflict: false };
}

function predictFixture(fixture, strengths, globalNeutralGoals) {
  const home = strengths.get(normalizeName(fixture.home));
  const away = strengths.get(normalizeName(fixture.away));
  if (!home || !away) {
    return {
      ...fixture,
      predictionAvailable: false,
      missingTeams: [!home ? fixture.home : null, !away ? fixture.away : null].filter(Boolean)
    };
  }

  const homeEdge = fixture.neutral ? 0 : 42;
  const eloDiff = Number(home.elo) - Number(away.elo) + homeEdge;
  const nonDrawHome = 1 / (1 + 10 ** (-eloDiff / 400));
  const baseDraw = clamp(0.292 - Math.abs(eloDiff) / 1850, 0.17, 0.315);
  const elo = normalize([nonDrawHome * (1 - baseDraw), baseDraw, (1 - nonDrawHome) * (1 - baseDraw)]);
  const eloGoalScale = clamp(Math.exp(eloDiff / 1450), 0.65, 1.55);
  const homeLambda = clamp(globalNeutralGoals * Number(home.attack) * oppositeWeakness(away) * eloGoalScale, 0.2, 3.4);
  const awayLambda = clamp(globalNeutralGoals * Number(away.attack) * oppositeWeakness(home) / eloGoalScale, 0.16, 3.2);
  const scoreModel = buildScoreModel(homeLambda, awayLambda);
  const goalOutcome = normalize([scoreModel.homeWin, scoreModel.draw, scoreModel.awayWin]);
  const modelValues = normalize(elo.map((value, index) => value * 0.3 + goalOutcome[index] * 0.7));
  const modelProbabilities = { home: modelValues[0], draw: modelValues[1], away: modelValues[2] };
  const { probabilities, market, marketWeight, marketConflict } = blendProbabilities(modelProbabilities, fixture.odds);
  const pick = pickKey(probabilities);
  const maxProbability = Math.max(probabilities.home, probabilities.draw, probabilities.away);
  const confidence = clamp(0.34 + (maxProbability - 0.333) * 1.05 + Math.min(home.matches, away.matches, 80) / 80 * 0.08, 0.28, 0.86);
  const scoreCandidates = scoreModel.scoreProbabilities.map((score) => ({
    homeGoals: score.home_goals,
    awayGoals: score.away_goals,
    probability: score.probability
  }));
  const goalCandidates = scoreModel.goalProbabilities.map((goal) => ({
    totalGoals: goal.total_goals,
    probability: goal.probability
  }));
  const matchForOutputs = {
    matchNo: `friendly-${fixture.timeUk}-${fixture.home}-${fixture.away}`,
    recommendedPick: pickLabel(pick),
    probabilities,
    expectedGoals: {
      home: round(scoreModel.expectedHomeGoals, 3),
      away: round(scoreModel.expectedAwayGoals, 3)
    },
    scoreCandidates,
    goalCandidates,
    scores: scoreCandidates,
    goals: goalCandidates,
    odds: {}
  };
  const outputs = buildMarketOutputs(matchForOutputs, null, {
    scores: scoreCandidates,
    goals: goalCandidates
  });

  const modelPick = pickKey(modelProbabilities);
  const eloPick = pickKey({ home: elo[0], draw: elo[1], away: elo[2] });
  const goalPick = pickKey({ home: goalOutcome[0], draw: goalOutcome[1], away: goalOutcome[2] });
  const marketPick = market ? pickKey(market) : null;
  const riskFlags = [];
  if (eloPick !== goalPick) riskFlags.push(`Elo层倾向${pickLabel(eloPick)}，进球层倾向${pickLabel(goalPick)}`);
  if (marketPick && marketPick !== modelPick) riskFlags.push(`单源欧赔倾向${pickLabel(marketPick)}，强度模型倾向${pickLabel(modelPick)}`);
  if (maxProbability < 0.45) riskFlags.push('胜平负分布接近');
  if (Math.abs(probabilities.home - probabilities.away) < 0.08) riskFlags.push('两边胜率接近');

  return {
    ...fixture,
    predictionAvailable: true,
    source: 'international_strength_poisson_with_single_source_odds_reference',
    modelInput: {
      homeTeam: { team: home.team, elo: home.elo, attack: home.attack, defense: home.defense, matches: home.matches },
      awayTeam: { team: away.team, elo: away.elo, attack: away.attack, defense: away.defense, matches: away.matches },
      globalNeutralGoals,
      marketWeight,
      marketConflict
    },
    expectedGoals: matchForOutputs.expectedGoals,
    probabilities: {
      home: round(probabilities.home, 4),
      draw: round(probabilities.draw, 4),
      away: round(probabilities.away, 4)
    },
    marketProbabilities: market
      ? { home: round(market.home, 4), draw: round(market.draw, 4), away: round(market.away, 4) }
      : null,
    pick,
    pickLabel: pickLabel(pick),
    confidence: round(confidence, 4),
    risk: riskFlags.length ? '中' : confidence >= 0.62 ? '低' : '中',
    riskFlags,
    goalCount: {
      label: outputs.goalCount.label,
      candidates: outputs.goalCount.candidates
    },
    score: {
      label: outputs.score.label,
      candidates: outputs.score.candidates
    },
    reasons: [
      `${fixture.home} Elo ${round(home.elo, 1)} vs ${fixture.away} Elo ${round(away.elo, 1)}，期望进球 ${round(scoreModel.expectedHomeGoals, 2)}-${round(scoreModel.expectedAwayGoals, 2)}。`,
      `胜平负模型概率：主 ${pct(probabilities.home)}，平 ${pct(probabilities.draw)}，客 ${pct(probabilities.away)}。`,
      `剧本输出：${outputs.goalCount.label}，比分优先 ${outputs.score.label}；${outputs.score.detail}。`,
      market
        ? marketConflict
          ? `单一外部欧赔与强度模型不同向，未改变主模型方向；不是完整盘口模型。`
          : `单一外部欧赔同向，轻权重纳入 ${Math.round(marketWeight * 100)}%；不是完整盘口模型。`
        : '无可靠同场盘口，未使用盘口层。'
    ]
  };
}

function renderMarkdown(report) {
  const activeRows = report.predictions.filter((row) => row.predictionAvailable);
  const skippedRows = report.fixtures.filter((row) => row.status !== 'scheduled');
  const lines = [
    '# 今日国际友谊赛预测',
    '',
    `生成时间: ${report.generatedAt}`,
    `比赛日期: ${report.date}`,
    '',
    '口径：男子国际友谊赛；已完赛、取消、延期和 TBC 场次不生成赛前预测。单一公开欧赔只作轻权重参考，不等同于完整盘口模型。',
    '',
    '## 来源',
    '',
    ...report.sources.map((source) => `- ${source.name}: ${source.url} (${source.note})`),
    '',
    '## 预测',
    '',
    '| UK time | Match | Pick | Probabilities | Goals | Scores | Risk | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...activeRows.map((row) => (
      `| ${row.timeUk} | ${row.home} vs ${row.away} | ${row.pickLabel} | 主 ${pct(row.probabilities.home)} / 平 ${pct(row.probabilities.draw)} / 客 ${pct(row.probabilities.away)} | ${row.goalCount.label} | ${row.score.candidates.map((item) => `${item.primary ? '*' : ''}${item.label}`).join(' / ')} | ${row.risk} | ${row.reasons[0]} |`
    )),
    '',
    '## 未预测场次',
    '',
    ...skippedRows.map((row) => `- ${row.timeUk} ${row.home} vs ${row.away}: ${row.status}${row.result ? ` (${row.result})` : ''}`)
  ];
  return `${lines.join('\n')}\n`;
}

if (!fs.existsSync(INTERNATIONAL_REPORT)) {
  throw new Error('missing reports/international-model-evaluation.json; run evaluate-international first');
}

const international = JSON.parse(fs.readFileSync(INTERNATIONAL_REPORT, 'utf8'));
const rows = international.current_team_strengths?.teams;
if (!Array.isArray(rows)) throw new Error('international report does not contain current_team_strengths.teams');

const strengths = new Map(rows.map((row) => [normalizeName(row.team), row]));
const globalNeutralGoals = Number(international.current_team_strengths?.global_neutral_goals_ewma ?? 1.4);
const predictions = FIXTURES
  .filter((fixture) => fixture.status === 'scheduled')
  .map((fixture) => predictFixture(fixture, strengths, globalNeutralGoals));
const report = {
  ok: predictions.every((row) => row.predictionAvailable),
  generatedAt: new Date().toISOString(),
  date: TODAY,
  timezoneNote: 'Source fixture times are UK time where BBC is used; Beijing time is UK time +7 hours on 2026-06-09.',
  file: 'reports/today-friendly-predictions.json',
  markdown: 'reports/today-friendly-predictions.md',
  method:
    'Uses current international team strength priors from reports/international-model-evaluation.json, a neutral-goal Poisson score model, Elo draw calibration, and a small single-source odds reference where present.',
  sources: SOURCES,
  fixtures: FIXTURES,
  predictions,
  summary: {
    scheduled: predictions.length,
    predicted: predictions.filter((row) => row.predictionAvailable).length,
    skipped: FIXTURES.filter((row) => row.status !== 'scheduled').length,
    lowRisk: predictions.filter((row) => row.risk === '低').length,
    mediumRisk: predictions.filter((row) => row.risk === '中').length,
    unavailable: predictions.filter((row) => !row.predictionAvailable)
  }
};

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(OUTPUT_MD, renderMarkdown(report));

console.log(JSON.stringify({
  ok: report.ok,
  report: 'reports/today-friendly-predictions.json',
  markdown: 'reports/today-friendly-predictions.md',
  summary: report.summary,
  top: predictions
    .filter((row) => row.predictionAvailable)
    .toSorted((left, right) => right.confidence - left.confidence)
    .slice(0, 6)
    .map((row) => ({
      match: `${row.home} vs ${row.away}`,
      pick: row.pickLabel,
      confidence: row.confidence,
      score: row.score.label,
      goals: row.goalCount.label
    }))
}, null, 2));
