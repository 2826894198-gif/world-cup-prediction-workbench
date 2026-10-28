#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';

const ROOT_DIR = process.cwd();
const RESULTS_CSV = join(ROOT_DIR, 'data/research/international-results/results.csv');
const ODDS_LINKS_JSON = join(ROOT_DIR, 'data/research/worldcup-2022/oddsportal-2022-final-links.json');
const CACHE_FILE = join(ROOT_DIR, 'data/research/worldcup-2022/oddsportal-market-backtest-cache.json');
const OUTPUT_JSON = join(ROOT_DIR, 'reports/worldcup-2022-market-backtest.json');
const OUTPUT_MD = join(ROOT_DIR, 'reports/worldcup-2022-market-backtest.md');

const DAT_KEY = 'J*8sQ!p$7aD_fR2yW@gHn*3bVp#sAdLd_k';
const DAT_SALT = '5b9a8f2c3e6d1a4b7c8e9d0f1a2b3c4d';
const GEO = 'JP';
const LANG = 'en';
const XHASH = 'yjed3';
const PROVIDERS = ['417', '500', '550', '575', '44'];
const MARKET = {
  moneyline: 1,
  totals: 2,
  handicap: 5
};

const TEAM_SLUGS = {
  Argentina: ['argentina'],
  Australia: ['australia'],
  Belgium: ['belgium'],
  Brazil: ['brazil'],
  Cameroon: ['cameroon'],
  Canada: ['canada'],
  'Costa Rica': ['costa-rica'],
  Croatia: ['croatia'],
  Denmark: ['denmark'],
  Ecuador: ['ecuador'],
  England: ['england'],
  France: ['france'],
  Germany: ['germany'],
  Ghana: ['ghana'],
  Iran: ['iran'],
  Japan: ['japan'],
  Mexico: ['mexico'],
  Morocco: ['morocco'],
  Netherlands: ['netherlands'],
  Poland: ['poland'],
  Portugal: ['portugal'],
  Qatar: ['qatar'],
  'Saudi Arabia': ['saudi-arabia'],
  Senegal: ['senegal'],
  Serbia: ['serbia'],
  Spain: ['spain'],
  Switzerland: ['switzerland'],
  Tunisia: ['tunisia'],
  Uruguay: ['uruguay'],
  'South Korea': ['south-korea'],
  'United States': ['usa', 'united-states'],
  Wales: ['wales']
};

const MANUAL_LINKS = [
  {
    text: 'Finished Qatar 0 - 2 Ecuador',
    href: 'https://www.oddsportal.com/football/h2h/ecuador-8tbm8Tri/qatar-zqzHL77i/#jsidfnm5'
  }
];

function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readWorldCupResults() {
  return readFileSync(RESULTS_CSV, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map(parseCsvLine)
    .filter((row) => row[5] === 'FIFA World Cup' && row[0] >= '2022-11-20' && row[0] <= '2022-12-18')
    .map((row, index) => ({
      matchNo: index + 1,
      date: row[0],
      home: row[1],
      away: row[2],
      homeGoals: Number(row[3]),
      awayGoals: Number(row[4]),
      neutral: row[8] === 'TRUE'
    }));
}

function parseH2hSlugs(href) {
  const match = href.match(/\/h2h\/([^/]+)\/([^/]+)\//);
  if (!match) return [];
  return [match[1], match[2]].map((slug) => slug.replace(/-[A-Za-z0-9]+$/, '').toLowerCase());
}

function linkKeyForTeams(home, away) {
  return [home, away]
    .map((team) => team.toLowerCase())
    .sort()
    .join('|');
}

function teamMatchesSlug(team, slug) {
  return (TEAM_SLUGS[team] ?? [team.toLowerCase().replace(/\s+/g, '-')]).some((alias) => slug === alias);
}

function readLinks() {
  const saved = JSON.parse(readFileSync(ODDS_LINKS_JSON, 'utf8'));
  const links = [...saved, ...MANUAL_LINKS];
  const byPair = new Map();
  for (const link of links) {
    const slugs = parseH2hSlugs(link.href);
    if (slugs.length !== 2) continue;
    const pairKey = slugs.slice().sort().join('|');
    byPair.set(pairKey, link);
  }
  return byPair;
}

function findLinkForMatch(match, linksByPair) {
  const homeSlugs = TEAM_SLUGS[match.home] ?? [];
  const awaySlugs = TEAM_SLUGS[match.away] ?? [];
  for (const homeSlug of homeSlugs) {
    for (const awaySlug of awaySlugs) {
      const link = linksByPair.get([homeSlug, awaySlug].sort().join('|'));
      if (link) return link;
    }
  }
  for (const link of linksByPair.values()) {
    const [left, right] = parseH2hSlugs(link.href);
    if (
      (teamMatchesSlug(match.home, left) && teamMatchesSlug(match.away, right)) ||
      (teamMatchesSlug(match.home, right) && teamMatchesSlug(match.away, left))
    ) {
      return link;
    }
  }
  return null;
}

function eventIdFromHref(href) {
  return href.split('#')[1] ?? null;
}

async function decryptDat(text) {
  const decoded = Buffer.from(text.trim(), 'base64').toString('utf8');
  if (!decoded.includes(':')) return decoded;
  const [payloadB64, ivHex] = decoded.split(':');
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map((value) => parseInt(value, 16)));
  const encoder = new TextEncoder();
  const baseKey = await webcrypto.subtle.importKey('raw', encoder.encode(DAT_KEY), { name: 'PBKDF2' }, false, [
    'deriveKey'
  ]);
  const key = await webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(DAT_SALT), iterations: 1000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-CBC', length: 256 },
    false,
    ['decrypt']
  );
  const plain = Buffer.from(
    await webcrypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, new Uint8Array(Buffer.from(payloadB64, 'base64')))
  );
  return (plain[0] === 31 && plain[1] === 139 ? gunzipSync(plain) : plain).toString('utf8');
}

async function fetchJsonDat(url, referer) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: '*/*',
          referer,
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36'
        }
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return JSON.parse(await decryptDat(text));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError;
}

function marketUrl(eventId, bettingType) {
  return `https://www.oddsportal.com/match-event/1-1-${eventId}-${bettingType}-2-${XHASH}.dat?geo=${GEO}&lang=${LANG}`;
}

function providerOrder(data, bettingType) {
  return [
    ...new Set([
      ...(data?.d?.nav?.[String(bettingType)]?.['2'] ?? []),
      ...(data?.d?.nav?.[String(bettingType)]?.['3'] ?? []),
      ...PROVIDERS
    ])
  ];
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
}

function normalizeProbabilities(values) {
  const implied = values.map((value) => (Number.isFinite(value) && value > 1 ? 1 / value : 0));
  const total = implied.reduce((sum, value) => sum + value, 0);
  return total > 0 ? implied.map((value) => value / total) : [null, null, null];
}

function twoWayOdds(row, provider) {
  const odds = row?.odds?.[provider];
  if (Array.isArray(odds)) return [numberOrNull(odds[0]), numberOrNull(odds[1])];
  if (odds && typeof odds === 'object') return [numberOrNull(odds[0]), numberOrNull(odds[1])];
  return [null, null];
}

function twoWayOpeningOdds(row, provider) {
  const odds = row?.openingOdd?.[provider];
  if (Array.isArray(odds)) return [numberOrNull(odds[0]), numberOrNull(odds[1])];
  if (odds && typeof odds === 'object') return [numberOrNull(odds[0]), numberOrNull(odds[1])];
  return [null, null];
}

function twoWayTime(row, provider, field) {
  const values = row?.[field]?.[provider];
  if (Array.isArray(values)) return Math.max(...values.map(Number).filter(Number.isFinite));
  if (values && typeof values === 'object') return Math.max(...Object.values(values).map(Number).filter(Number.isFinite));
  return null;
}

function marketBalanceScore(odds) {
  const [left, right] = odds;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
  const center = Math.abs(left - 1.92) + Math.abs(right - 1.92);
  const gap = Math.abs(left - right) * 1.8;
  const extreme = (left < 1.45 || right < 1.45 ? 1.2 : 0) + (left > 2.65 || right > 2.65 ? 0.8 : 0);
  return center + gap + extreme;
}

function entriesFor(data, bettingType) {
  return Object.values(data?.d?.oddsdata?.back ?? {}).filter((row) => row?.bettingTypeId === bettingType);
}

function chooseProvider(row, providers, opening = false) {
  let best = null;
  providers.forEach((provider, rank) => {
    const odds = opening ? twoWayOpeningOdds(row, provider) : twoWayOdds(row, provider);
    const score = marketBalanceScore(odds) + rank * 0.03;
    if (!best || score < best.score) best = { provider, odds, score };
  });
  return best?.score < Infinity ? best : null;
}

function selectTwoWayMarket(data, bettingType, linePenalty = () => 0) {
  const providers = providerOrder(data, bettingType);
  const rows = entriesFor(data, bettingType)
    .map((row) => ({ row, line: numberOrNull(row.handicapValue) }))
    .filter((entry) => Number.isFinite(entry.line));
  const current = rows
    .map((entry) => {
      const picked = chooseProvider(entry.row, providers, false);
      return picked ? { ...entry, ...picked, score: picked.score + linePenalty(entry.line) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score)[0];
  const opening = rows
    .map((entry) => {
      const picked = chooseProvider(entry.row, providers, true);
      return picked ? { ...entry, ...picked, score: picked.score + linePenalty(entry.line) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.score - right.score)[0];
  if (!current) return null;
  return {
    line: current.line,
    provider: current.provider,
    odds: current.odds,
    openingLine: opening?.line ?? current.line,
    openingProvider: opening?.provider ?? current.provider,
    openingOdds: opening?.odds ?? twoWayOpeningOdds(current.row, current.provider),
    openingTime: twoWayTime(opening?.row ?? current.row, opening?.provider ?? current.provider, 'openingChangeTime'),
    changeTime: twoWayTime(current.row, current.provider, 'changeTime')
  };
}

function extractMoneyline(data) {
  const row = entriesFor(data, MARKET.moneyline)[0];
  if (!row) return null;
  const providers = providerOrder(data, MARKET.moneyline);
  for (const provider of providers) {
    const odds = row.odds?.[provider];
    const opening = row.openingOdd?.[provider];
    const current = {
      home: numberOrNull(odds?.[0]),
      draw: numberOrNull(odds?.[1]),
      away: numberOrNull(odds?.[2])
    };
    if ([current.home, current.draw, current.away].every(Number.isFinite)) {
      const probabilities = normalizeProbabilities([current.home, current.draw, current.away]);
      return {
        provider,
        odds: current,
        openingOdds: {
          home: numberOrNull(opening?.[0]),
          draw: numberOrNull(opening?.[1]),
          away: numberOrNull(opening?.[2])
        },
        probabilities: {
          home: round(probabilities[0], 4),
          draw: round(probabilities[1], 4),
          away: round(probabilities[2], 4)
        },
        openingTime: row.openingChangeTime?.[provider]?.[0] ?? null,
        changeTime: row.changeTime?.[provider]?.[0] ?? null
      };
    }
  }
  return null;
}

function extractMarkets(raw) {
  const moneyline = extractMoneyline(raw.moneyline);
  const totals = selectTwoWayMarket(raw.totals, MARKET.totals, (line) => Math.abs(line - 2.5) * 0.05);
  const handicap = selectTwoWayMarket(raw.handicap, MARKET.handicap, (line) => Math.abs(Math.abs(line) - 1) * 0.03);
  return { moneyline, totals, handicap };
}

function bestPick(probabilities) {
  return Object.entries(probabilities ?? {})
    .sort((left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0))[0]?.[0] ?? null;
}

function expectedDepth(probability) {
  if (probability >= 0.69) return 1.25;
  if (probability >= 0.61) return 1;
  if (probability >= 0.55) return 0.5;
  if (probability >= 0.5) return 0.25;
  return 0;
}

function handicapSideOdds(handicap, side, opening = false) {
  const odds = opening ? handicap?.openingOdds : handicap?.odds;
  if (!odds) return null;
  return side === 'home' ? odds[0] : odds[1];
}

function analyzeHandicap(markets) {
  const probabilities = markets.moneyline?.probabilities ?? {};
  const favorite = (probabilities.home ?? 0) >= (probabilities.away ?? 0) ? 'home' : 'away';
  const favoriteProbability = probabilities[favorite] ?? 0;
  const line = markets.handicap?.line;
  const openingLine = markets.handicap?.openingLine;
  const favoriteLineOk = favorite === 'home' ? line <= 0 : line >= 0;
  const depth = Number.isFinite(line) ? Math.abs(line) : 0;
  const openingDepth = Number.isFinite(openingLine) ? Math.abs(openingLine) : depth;
  const lineMove = depth - openingDepth;
  const currentWater = handicapSideOdds(markets.handicap, favorite, false);
  const openingWater = handicapSideOdds(markets.handicap, favorite, true);
  const waterMove = Number.isFinite(currentWater) && Number.isFinite(openingWater) ? currentWater - openingWater : 0;
  const expected = expectedDepth(favoriteProbability);
  const shallow = favoriteLineOk && depth + 0.001 < expected;
  let lean = 'favorite_edge';
  if (depth <= 0.25) {
    lean = 'shallow_draw';
  } else if (currentWater < 1.86 || currentWater >= 2 || lineMove <= -0.24) {
    lean = 'underdog_cover';
  } else if (favoriteLineOk && depth >= 0.5 && lineMove >= 0.24 && currentWater >= 1.86 && currentWater < 2) {
    lean = 'favorite_cover';
  } else if (favoriteLineOk && depth >= 1.25 && currentWater >= 1.86 && currentWater < 1.94 && waterMove <= 0.08) {
    lean = 'favorite_cover';
  } else if (shallow && (currentWater >= 1.96 || waterMove > 0.06 || lineMove < -0.24)) {
    lean = 'underdog_cover';
  } else if (!favoriteLineOk && favoriteProbability >= 0.54) {
    lean = 'underdog_cover';
  }
  const underdog = favorite === 'home' ? 'away' : 'home';
  const favoriteCoverSignal =
    favoriteLineOk &&
    depth >= 0.5 &&
    lineMove >= 0.24 &&
    currentWater >= 1.86 &&
    currentWater < 2;
  const predictedHandicap = favoriteCoverSignal ? `${favorite}_cover` : `${underdog}_cover`;
  const tier = depth <= 0.25 || currentWater < 1.86
    ? 'watch'
    : depth >= 0.5 && currentWater >= 1.86 && lineMove >= -0.01
      ? 'strong'
      : 'candidate';
  return {
    favorite,
    underdog,
    favoriteProbability,
    line,
    openingLine,
    depth,
    openingDepth,
    lineMove,
    currentWater,
    openingWater,
    waterMove,
    expectedDepth: expected,
    lean,
    favoriteCoverSignal,
    predictedHandicap,
    tier
  };
}

function analyzeTotals(markets) {
  const total = markets.totals;
  const [over, under] = total?.odds ?? [];
  const [openingOver, openingUnder] = total?.openingOdds ?? [];
  const implied = normalizeProbabilities([over, under]);
  const overProbability = implied[0] ?? 0.5;
  const lineMove = Number.isFinite(total?.line) && Number.isFinite(total?.openingLine) ? total.line - total.openingLine : 0;
  const waterMove = Number.isFinite(over) && Number.isFinite(openingOver) ? over - openingOver : 0;
  const lean =
    lineMove >= 0.25 || overProbability >= 0.515 || waterMove < -0.05
      ? 'over'
      : lineMove <= -0.25 || overProbability <= 0.485 || waterMove > 0.08
        ? 'under'
        : total?.line >= 2.75
          ? 'under'
          : 'over';
  const line = Number.isFinite(total?.line) ? total.line : 2.5;
  const preferredGoals = line >= 3.25
    ? [3, 4]
    : line <= 1.75 && lean === 'under'
      ? [1, 2]
      : [2, 3];
  return {
    line,
    openingLine: total?.openingLine,
    lineMove,
    over,
    under,
    openingOver,
    openingUnder,
    overProbability,
    lean,
    preferredGoals
  };
}

function predictWdl(markets, handicapRead) {
  if (handicapRead.depth <= 0.25) return 'draw';
  if (handicapRead.currentWater < 1.86 || handicapRead.lineMove <= -0.24) return handicapRead.underdog;
  return handicapRead.favorite;
}

function scoreFor(outcome, goals, handicapRead) {
  if (outcome === 'draw') {
    if (goals <= 0) return [0, 0];
    if (goals <= 2) return [1, 1];
    return [2, 2];
  }
  const favoriteCover = handicapRead.lean === 'favorite_cover';
  const homeWins = outcome === 'home';
  let winnerGoals;
  let loserGoals;
  if (goals <= 1) {
    winnerGoals = 1;
    loserGoals = 0;
  } else if (goals === 2) {
    winnerGoals = 2;
    loserGoals = 0;
  } else if (goals === 3) {
    winnerGoals = favoriteCover ? 3 : 2;
    loserGoals = favoriteCover ? 0 : 1;
  } else {
    winnerGoals = favoriteCover ? goals - 1 : Math.ceil((goals + 1) / 2);
    loserGoals = goals - winnerGoals;
  }
  return homeWins ? [winnerGoals, loserGoals] : [loserGoals, winnerGoals];
}

function makePrediction(markets) {
  const handicap = analyzeHandicap(markets);
  const totals = analyzeTotals(markets);
  const wdl = predictWdl(markets, handicap);
  const scoreCandidates = totals.preferredGoals
    .map((goals) => scoreFor(wdl, goals, handicap))
    .map(([home, away]) => ({ home, away, label: `${home}-${away}` }));
  return {
    wdl,
    tier: handicap.tier,
    handicap,
    totals,
    goals: totals.preferredGoals,
    score: scoreCandidates[0],
    scoreCandidates
  };
}

function actualWdl(match) {
  if (match.homeGoals > match.awayGoals) return 'home';
  if (match.homeGoals < match.awayGoals) return 'away';
  return 'draw';
}

function actualHandicap(match, line) {
  const adjusted = match.homeGoals - match.awayGoals + (Number.isFinite(line) ? line : 0);
  if (adjusted > 0.001) return 'home_cover';
  if (adjusted < -0.001) return 'away_cover';
  return 'push';
}

function evaluate(match, prediction, markets) {
  const wdl = actualWdl(match);
  const handicap = actualHandicap(match, markets.handicap?.line);
  const totalGoals = match.homeGoals + match.awayGoals;
  const score = `${match.homeGoals}-${match.awayGoals}`;
  return {
    actual: { wdl, handicap, totalGoals, score },
    hits: {
      wdl: prediction.wdl === wdl,
      handicap: prediction.handicap.predictedHandicap === handicap,
      goals: prediction.goals.includes(totalGoals),
      score: prediction.score?.label === score,
      scoreTop2: prediction.scoreCandidates.some((candidate) => candidate.label === score)
    }
  };
}

function rate(rows, key) {
  const valid = rows.filter((row) => row.evaluation?.hits?.[key] != null);
  const hits = valid.filter((row) => row.evaluation.hits[key]).length;
  return { hits, total: valid.length, rate: valid.length ? round(hits / valid.length, 4) : null };
}

function metricBundle(rows) {
  return {
    wdl: rate(rows, 'wdl'),
    handicap: rate(rows, 'handicap'),
    goals: rate(rows, 'goals'),
    score: rate(rows, 'score'),
    scoreTop2: rate(rows, 'scoreTop2')
  };
}

function tierSummary(rows) {
  return ['strong', 'candidate', 'watch'].reduce((summary, tier) => {
    summary[tier] = metricBundle(rows.filter((row) => row.prediction?.tier === tier));
    return summary;
  }, {});
}

function marketSummary(markets) {
  return {
    moneyline: markets.moneyline,
    handicap: {
      provider: markets.handicap?.provider,
      line: markets.handicap?.line,
      odds: markets.handicap?.odds,
      openingLine: markets.handicap?.openingLine,
      openingOdds: markets.handicap?.openingOdds,
      openingTime: markets.handicap?.openingTime,
      changeTime: markets.handicap?.changeTime
    },
    totals: {
      provider: markets.totals?.provider,
      line: markets.totals?.line,
      odds: markets.totals?.odds,
      openingLine: markets.totals?.openingLine,
      openingOdds: markets.totals?.openingOdds,
      openingTime: markets.totals?.openingTime,
      changeTime: markets.totals?.changeTime
    }
  };
}

function formatTime(seconds) {
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16)
    : '--';
}

function renderMarkdown(report) {
  const lines = [
    '# 2022 World Cup Market-First Backtest',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This backtest starts from OddsPortal pre-match market streams: 1X2, Asian handicap, and totals. Results are checked after prediction generation against the local international-results ledger.',
    '',
    '| Market | Hits | Total | Rate |',
    '| --- | ---: | ---: | ---: |',
    `| 胜平负 | ${report.summary.wdl.hits} | ${report.summary.wdl.total} | ${pct(report.summary.wdl.rate)} |`,
    `| 让球胜平负 / 亚盘方向 | ${report.summary.handicap.hits} | ${report.summary.handicap.total} | ${pct(report.summary.handicap.rate)} |`,
    `| 球数 Top2 | ${report.summary.goals.hits} | ${report.summary.goals.total} | ${pct(report.summary.goals.rate)} |`,
    `| 比分单选 | ${report.summary.score.hits} | ${report.summary.score.total} | ${pct(report.summary.score.rate)} |`,
    `| 比分 Top2 | ${report.summary.scoreTop2.hits} | ${report.summary.scoreTop2.total} | ${pct(report.summary.scoreTop2.rate)} |`,
    '',
    '## Tier Summary',
    '',
    '| Tier | Matches | WDL | AH | Goals Top2 | Score | Score Top2 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const tier of ['strong', 'candidate', 'watch']) {
    const row = report.summaryByTier?.[tier];
    if (!row) continue;
    lines.push(
      `| ${tier} | ${row.wdl.total} | ${pct(row.wdl.rate)} | ${pct(row.handicap.rate)} | ${pct(row.goals.rate)} | ${pct(row.score.rate)} | ${pct(row.scoreTop2.rate)} |`
    );
  }
  lines.push(
    '',
    '## Sample Rows',
    '',
    '| Date | Match | Tier | Market Read | Goals | Score Pick | Actual | Hit |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const row of report.rows.slice(0, 16)) {
    const h = row.prediction.handicap;
    const t = row.prediction.totals;
    lines.push(
      `| ${row.date} | ${row.home} ${row.homeGoals}-${row.awayGoals} ${row.away} | ${row.prediction.tier} | ${h.lean}, AH ${h.openingLine} -> ${h.line}, fav water ${round(h.openingWater, 2)} -> ${round(h.currentWater, 2)} | ${t.openingLine} -> ${t.line}, ${row.prediction.goals.join('/')} | ${row.prediction.score.label} | ${row.evaluation.actual.score} | WDL ${row.evaluation.hits.wdl ? 'Y' : 'N'} / AH ${row.evaluation.hits.handicap ? 'Y' : 'N'} / G ${row.evaluation.hits.goals ? 'Y' : 'N'} / S ${row.evaluation.hits.score ? 'Y' : 'N'} |`
    );
  }
  lines.push('', '## Data Notes', '');
  lines.push(`- Matches linked: ${report.diagnostics.linkedMatches}/${report.diagnostics.totalMatches}.`);
  lines.push(`- Market rows fetched: ${report.diagnostics.completeMarkets}/${report.diagnostics.linkedMatches}.`);
  lines.push('- Opening and current timestamps are taken from OddsPortal `openingChangeTime` and `changeTime` in the decoded market stream.');
  lines.push('- 让球胜平负 here is evaluated on the selected Asian handicap line: home cover / push / away cover.');
  lines.push('');
  lines.push('## First Match Detail', '');
  const first = report.rows[0];
  if (first) {
    lines.push(
      `- ${first.home} vs ${first.away}: AH ${first.markets.handicap.openingLine} (${formatTime(first.markets.handicap.openingTime)}) -> ${first.markets.handicap.line} (${formatTime(first.markets.handicap.changeTime)}), totals ${first.markets.totals.openingLine} -> ${first.markets.totals.line}.`
    );
  }
  return `${lines.join('\n')}\n`;
}

async function fetchMarketsForLink(link) {
  const eventId = eventIdFromHref(link.href);
  if (!eventId) throw new Error('missing event id');
  const referer = link.href;
  const moneyline = await fetchJsonDat(marketUrl(eventId, MARKET.moneyline), referer);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const totals = await fetchJsonDat(marketUrl(eventId, MARKET.totals), referer);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const handicap = await fetchJsonDat(marketUrl(eventId, MARKET.handicap), referer);
  return { eventId, moneyline, totals, handicap };
}

async function main() {
  ensureDir(CACHE_FILE);
  ensureDir(OUTPUT_JSON);
  const results = readWorldCupResults();
  const linksByPair = readLinks();
  const cache = (() => {
    try {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    } catch {
      return {};
    }
  })();
  const rows = [];
  for (const match of results) {
    const link = findLinkForMatch(match, linksByPair);
    if (!link) {
      rows.push({ ...match, status: 'missing_link' });
      continue;
    }
    const cacheKey = eventIdFromHref(link.href);
    let raw = cache[cacheKey];
    if (!raw) {
      raw = await fetchMarketsForLink(link);
      cache[cacheKey] = raw;
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const markets = extractMarkets(raw);
    if (!markets.moneyline || !markets.totals || !markets.handicap) {
      rows.push({ ...match, status: 'incomplete_market', link: link.href, markets: marketSummary(markets) });
      continue;
    }
    const prediction = makePrediction(markets);
    const evaluation = evaluate(match, prediction, markets);
    rows.push({
      ...match,
      status: 'ready',
      link: link.href,
      eventId: raw.eventId,
      markets: marketSummary(markets),
      prediction,
      evaluation
    });
  }
  const readyRows = rows.filter((row) => row.status === 'ready');
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      results: RESULTS_CSV,
      odds: 'https://www.oddsportal.com/football/world/world-cup-2022/results/'
    },
    summary: metricBundle(readyRows),
    summaryByTier: tierSummary(readyRows),
    diagnostics: {
      totalMatches: results.length,
      linkedMatches: rows.filter((row) => row.status !== 'missing_link').length,
      completeMarkets: readyRows.length,
      missingLinks: rows.filter((row) => row.status === 'missing_link').map((row) => `${row.home}-${row.away}`),
      incompleteMarkets: rows.filter((row) => row.status === 'incomplete_market').map((row) => `${row.home}-${row.away}`)
    },
    rows
  };
  writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
  writeFileSync(OUTPUT_MD, renderMarkdown(report));
  console.log(
    JSON.stringify(
      {
        ok: report.diagnostics.completeMarkets === report.diagnostics.totalMatches,
        summary: report.summary,
        summaryByTier: report.summaryByTier,
        diagnostics: report.diagnostics,
        output: OUTPUT_JSON,
        markdown: OUTPUT_MD
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
