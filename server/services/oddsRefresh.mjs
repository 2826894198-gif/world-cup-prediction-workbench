import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refreshPredictions } from '../db/refresh.mjs';
import {
  predictionUsableSourceSqlList,
  secondarySourceSqlList,
  trustedSourceSqlList
} from './oddsSourcePolicy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = dirname(dirname(__dirname));
const RESEARCH_DIR = join(ROOT_DIR, 'data', 'research', 'worldcup-2026');
export const ODDS_AUDIT_FILE = join(RESEARCH_DIR, 'odds-source-audit.json');
const OFFICIAL_2026_SCHEDULE_FILE = join(RESEARCH_DIR, 'official-schedule.json');

const SPORTTERY_CALCULATOR_URL = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry';
const SPORTTERY_PAGE_URL = 'https://www.lottery.gov.cn/jc/jsq/zqspf/';
const DONGQIUDI_BASE_URL = 'https://www.dongqiudi.com';
const DONGQIUDI_IMPORTANT_URL = `${DONGQIUDI_BASE_URL}/api/data/tab/new/important`;
const HKJC_CONFIG_URL = 'https://bet.hkjc.com/Config/FootballConfig.js';
const HKJC_BETTING_INFO_URL = 'https://special.hkjc.com/e-win/en-US/betting-info/football/same-game-all-up/';
const MACAU_SLOT_URL = 'https://www.macauslot.com/';
const MACAU_SLOT_INFO_URL = 'https://www.macaotourism.gov.mo/zh-hans/shows-and-entertainment/gaming/soccer-basketball-lottery';
const ODDSLAB_LEAGUE_URL = 'https://market.oddslab.gg/leagues/world-cup-2026';
const ODDS_API_DOC_URL = 'https://the-odds-api.com/liveapi/guides/v4/';
const ODDS_API_SPORT_KEY = process.env.ODDS_API_SPORT_KEY || 'soccer_fifa_world_cup';
const EUROPEAN_PUBLIC_PAGE_PROBES = [
  {
    provider: 'Oddschecker',
    url: 'https://www.oddschecker.com/football/world-cup'
  },
  {
    provider: 'BetVictor',
    url: 'https://www.betvictor.com/en-gb/sports/240/meetings/296647110/events'
  },
  {
    provider: 'Stake',
    url: 'https://stake.com/sports/soccer/international/world-cup'
  }
];

const TEAM_ALIASES = new Map(
  [
    ['ALG', '阿尔及利亚', 'Algeria'],
    ['ARG', '阿根廷', 'Argentina'],
    ['AUS', '澳大利亚', 'Australia'],
    ['AUT', '奥地利', 'Austria'],
    ['BEL', '比利时', 'Belgium'],
    ['BIH', '波黑', 'Bosnia & Herzegovina', 'Bosnia and Herzegovina'],
    ['BRA', '巴西', 'Brazil'],
    ['CAN', '加拿大', 'Canada'],
    ['CIV', '科特迪瓦', 'Ivory Coast', "Cote d'Ivoire", 'Côte d’Ivoire', "Côte d'Ivoire"],
    ['COD', '刚果民主共和国', 'DR Congo', 'Congo DR', 'Democratic Republic of the Congo'],
    ['COL', '哥伦比亚', 'Colombia'],
    ['CPV', '佛得角', 'Cape Verde', 'Cabo Verde'],
    ['CRO', '克罗地亚', 'Croatia'],
    ['CUW', '库拉索', 'Curacao', 'Curaçao'],
    ['CZE', '捷克', 'Czech Republic', 'Czechia'],
    ['ECU', '厄瓜多尔', 'Ecuador'],
    ['EGY', '埃及', 'Egypt'],
    ['ENG', '英格兰', 'England'],
    ['ESP', '西班牙', 'Spain'],
    ['FRA', '法国', 'France'],
    ['GER', '德国', 'Germany'],
    ['GHA', '加纳', 'Ghana'],
    ['HAI', '海地', 'Haiti'],
    ['IRN', '伊朗', 'Iran'],
    ['IRQ', '伊拉克', 'Iraq'],
    ['JOR', '约旦', 'Jordan'],
    ['JPN', '日本', 'Japan'],
    ['KOR', '韩国', 'South Korea', 'Korea Republic', 'Republic of Korea'],
    ['KSA', '沙特', '沙特阿拉伯', 'Saudi Arabia', 'Saudi'],
    ['MAR', '摩洛哥', 'Morocco'],
    ['MEX', '墨西哥', 'Mexico'],
    ['NED', '荷兰', 'Netherlands'],
    ['NOR', '挪威', 'Norway'],
    ['NZL', '新西兰', 'New Zealand'],
    ['PAN', '巴拿马', 'Panama'],
    ['PAR', '巴拉圭', 'Paraguay'],
    ['POR', '葡萄牙', 'Portugal'],
    ['QAT', '卡塔尔', 'Qatar'],
    ['RSA', '南非', 'South Africa'],
    ['SCO', '苏格兰', 'Scotland'],
    ['SEN', '塞内加尔', 'Senegal'],
    ['SUI', '瑞士', 'Switzerland'],
    ['SWE', '瑞典', 'Sweden'],
    ['TUN', '突尼斯', 'Tunisia'],
    ['TUR', '土耳其', 'Turkey', 'Turkiye', 'Türkiye'],
    ['URU', '乌拉圭', 'Uruguay'],
    ['USA', '美国', 'USA', 'US', 'United States', 'United States of America'],
    ['UZB', '乌兹别克斯坦', 'Uzbekistan']
  ].flatMap(([code, ...names]) => names.map((name) => [normalizeName(name), code]))
);

function sha1(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

function redactUrl(url, secret) {
  if (!secret) return url;
  return String(url).replaceAll(encodeURIComponent(secret), '***').replaceAll(secret, '***');
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  const normalized = Number(String(value).replace(/[+,]/g, '').trim());
  return Number.isFinite(normalized) ? normalized : null;
}

function roundNumber(value, precision = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function normalizeProbabilities(values) {
  const parsed = values.map((value) => Math.max(0, Number(value) || 0));
  const total = parsed.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return parsed.map(() => null);
  return parsed.map((value) => value / total);
}

function localDateParts(date, timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readOfficialSchedule() {
  if (!existsSync(OFFICIAL_2026_SCHEDULE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(OFFICIAL_2026_SCHEDULE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function auditWindow(db) {
  const firstKickoff =
    db
      .prepare(
        `SELECT kickoff_utc
         FROM matches
         WHERE status = 'official_schedule_prediction_blocked'
         ORDER BY kickoff_utc
         LIMIT 1`
      )
      .get()?.kickoff_utc ??
    readOfficialSchedule()?.fixtures?.[0]?.kickoff_utc ??
    '2026-06-12T03:00:00Z';
  const firstLocalDate = localDateParts(new Date(firstKickoff));
  const scheduleFallbackFrom = addDays(firstLocalDate, -4);
  const todayLocal = localDateParts(new Date());
  const todayYear = Number(todayLocal.slice(0, 4));
  const from =
    process.env.ODDS_AUDIT_FROM ||
    (todayYear === 2026 ? todayLocal : scheduleFallbackFrom);
  const days = Number(process.env.ODDS_AUDIT_DAYS || 7);
  return {
    from,
    to: process.env.ODDS_AUDIT_TO || addDays(from, Math.max(1, Math.min(14, days - 1))),
    firstOfficialKickoffUtc: firstKickoff,
    timeZone: 'Asia/Shanghai'
  };
}

async function fetchText(url, timeoutMs = 20_000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,text/javascript,text/html;q=0.9,*/*;q=0.8',
        'user-agent': 'WorldCupPredictionWorkbench/0.1 odds-source-audit',
        ...headers
      },
      signal: controller.signal
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text, url };
  } catch (error) {
    return { ok: false, status: 0, text: '', url, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 20_000, headers = {}) {
  const result = await fetchText(url, timeoutMs, headers);
  if (!result.ok) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.text) };
  } catch (error) {
    return { ...result, ok: false, json: null, error: `JSON parse failed: ${error.message}` };
  }
}

function sportteryPoolComplete(pool, requireGoalLine = false) {
  if (!pool || typeof pool !== 'object') return false;
  const hasOdds = [pool.h, pool.d, pool.a].every((value) => parseNumber(value) != null);
  if (!requireGoalLine) return hasOdds;
  return hasOdds && parseNumber(pool.goalLineValue ?? pool.goalLine) != null;
}

function sportteryCapturedAt(pool, fallbackDate, fallbackTime = '00:00:00') {
  const date = pool?.updateDate ?? fallbackDate;
  const time = pool?.updateTime ?? fallbackTime;
  if (!date || !time) return null;
  const normalizedTime = String(time).length === 5 ? `${time}:00` : time;
  const captured = new Date(`${date}T${normalizedTime}+08:00`);
  return Number.isNaN(captured.valueOf()) ? null : captured.toISOString();
}

function flattenSportteryRows(value) {
  return (value.matchInfoList ?? []).flatMap((group) =>
    (group.subMatchList ?? []).map((row) => ({
      ...row,
      groupBusinessDate: group.businessDate
    }))
  );
}

function sportterySample(row, match = null) {
  return {
    matchId: row.matchId,
    matchNum: row.matchNumStr,
    league: row.leagueAllName ?? row.leagueAbbName,
    matchDate: row.matchDate,
    matchTime: row.matchTime,
    home: row.homeTeamAllName ?? row.homeTeamAbbName,
    away: row.awayTeamAllName ?? row.awayTeamAbbName,
    officialMatchNo: match?.match_no ?? null,
    bettingSingle: Number(row.bettingSingle ?? 0),
    bettingAllUp: Number(row.bettingAllUp ?? 0),
    had: {
      h: parseNumber(row.had?.h),
      d: parseNumber(row.had?.d),
      a: parseNumber(row.had?.a),
      capturedAt: sportteryCapturedAt(row.had, row.matchDate, row.matchTime)
    },
    hhad: {
      goalLine: parseNumber(row.hhad?.goalLineValue ?? row.hhad?.goalLine),
      h: parseNumber(row.hhad?.h),
      d: parseNumber(row.hhad?.d),
      a: parseNumber(row.hhad?.a),
      capturedAt: sportteryCapturedAt(row.hhad, row.matchDate, row.matchTime)
    },
    ttg: {
      s0: parseNumber(row.ttg?.s0),
      s1: parseNumber(row.ttg?.s1),
      s2: parseNumber(row.ttg?.s2),
      s3: parseNumber(row.ttg?.s3),
      s4: parseNumber(row.ttg?.s4),
      s5: parseNumber(row.ttg?.s5),
      s6: parseNumber(row.ttg?.s6),
      s7: parseNumber(row.ttg?.s7),
      capturedAt: sportteryCapturedAt(row.ttg, row.matchDate, row.matchTime)
    },
    crs: row.crs ?? {},
    hafu: row.hafu ?? {},
    status: row.matchStatus
  };
}

function sportteryLastUpdateIso(value) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(' ', 'T')}+08:00`);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function sportteryMatchKickoffIso(row) {
  if (!row?.matchDate || !row?.matchTime) return null;
  const normalizedTime = String(row.matchTime).length === 5 ? `${row.matchTime}:00` : row.matchTime;
  const date = new Date(`${row.matchDate}T${normalizedTime}+08:00`);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function sportteryTtgTotals(ttg) {
  const odds = Array.from({ length: 8 }, (_, index) => parseNumber(ttg?.[`s${index}`]));
  if (odds.some((odd) => odd == null || odd <= 1)) return null;
  const raw = odds.map((odd) => 1 / odd);
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(rawTotal) || rawTotal <= 0) return null;
  const normalized = raw.map((value) => value / rawTotal);
  const underProbability = normalized.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const overProbability = normalized.slice(3).reduce((sum, value) => sum + value, 0);
  if (underProbability <= 0 || overProbability <= 0) return null;
  return {
    totalLine: 2.5,
    overWater: roundNumber(1 / overProbability, 2),
    underWater: roundNumber(1 / underProbability, 2)
  };
}

function sportterySnapshotFromRow(row, match, capturedAt) {
  const total = sportteryTtgTotals(row.ttg);
  const snapshot = {
    matchId: match?.id,
    capturedAt:
      capturedAt ??
      sportteryCapturedAt(row.had, row.matchDate, row.matchTime) ??
      sportteryCapturedAt(row.hhad, row.matchDate, row.matchTime),
    provider: `Sporttery 体彩/${row.matchNumStr ?? row.matchId}`,
    homeOdds: parseNumber(row.had?.h),
    drawOdds: parseNumber(row.had?.d),
    awayOdds: parseNumber(row.had?.a),
    asianLine: parseNumber(row.hhad?.goalLineValue ?? row.hhad?.goalLine),
    asianHomeWater: parseNumber(row.hhad?.h),
    asianAwayWater: parseNumber(row.hhad?.a),
    totalLine: total?.totalLine ?? null,
    overWater: total?.overWater ?? null,
    underWater: total?.underWater ?? null,
    sourceType: 'official_sporttery_calculator'
  };
  snapshot.snapshotHash = sha1(snapshot);
  return snapshot;
}

function teamsBySportteryCode(db) {
  const map = new Map();
  for (const row of db.prepare('SELECT id, code, name_zh FROM teams').all()) {
    map.set(row.code, row);
    map.set(canonicalName(row.name_zh), row);
  }
  return map;
}

function sportteryTeam(row, side, teamsByCode) {
  const name =
    side === 'home'
      ? row.homeTeamAllName ?? row.homeTeamAbbName
      : row.awayTeamAllName ?? row.awayTeamAbbName;
  return teamsByCode.get(canonicalName(name)) ?? null;
}

function matchOfficialFixtureByKickoff(row, matches) {
  const kickoffIso = sportteryMatchKickoffIso(row);
  if (!kickoffIso) return null;
  const target = new Date(kickoffIso).getTime();
  const candidates = matches.filter((match) => {
    const kickoff = new Date(match.kickoff_utc).getTime();
    return Number.isFinite(kickoff) && Math.abs(kickoff - target) <= 15 * 60 * 1000;
  });
  return (
    candidates.find((match) => match.home_placeholder || match.away_placeholder || !match.home_team_id || !match.away_team_id) ??
    candidates[0] ??
    null
  );
}

function syncSportteryResolvedFixture(db, match, row, teamsByCode) {
  if (!match) return null;
  const homeTeam = sportteryTeam(row, 'home', teamsByCode);
  const awayTeam = sportteryTeam(row, 'away', teamsByCode);
  if (!homeTeam || !awayTeam) return match;
  const shouldUpdate =
    !match.home_team_id ||
    !match.away_team_id ||
    match.home_placeholder ||
    match.away_placeholder ||
    match.status === 'official_schedule_prediction_blocked';
  if (!shouldUpdate) return match;

  const nextStatus = match.status === 'official_schedule_prediction_blocked' ? 'scheduled' : match.status;
  db.prepare(
    `UPDATE matches
     SET home_team_id = ?,
         away_team_id = ?,
         home_placeholder = NULL,
         away_placeholder = NULL,
         status = ?
     WHERE id = ?`
  ).run(homeTeam.id, awayTeam.id, nextStatus, match.id);

  match.home_team_id = homeTeam.id;
  match.away_team_id = awayTeam.id;
  match.home_placeholder = null;
  match.away_placeholder = null;
  match.home_name = homeTeam.name_zh;
  match.away_name = awayTeam.name_zh;
  match.status = nextStatus;
  return match;
}

async function refreshSporttery(db, window) {
  const params = new URLSearchParams({
    channel: 'c',
    poolCode: 'had,hhad,crs,ttg,hafu'
  });
  const url = `${SPORTTERY_CALCULATOR_URL}?${params.toString()}`;
  const result = await fetchJson(url, 20_000, {
    accept: 'application/json, text/plain, */*',
    origin: 'https://www.lottery.gov.cn',
    referer: SPORTTERY_PAGE_URL,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });
  const value = result.json?.value ?? {};
  const official = officialMatches(db);
  const teamsByCode = teamsBySportteryCode(db);
  const capturedAt = sportteryLastUpdateIso(value.lastUpdateTime);
  const rows = flattenSportteryRows(value);
  const windowRows = rows.filter((row) => dateInRange(row.matchDate, window.from, window.to));
  const worldCupRows = windowRows.filter((row) =>
    /世界杯|World Cup|FIFA/i.test(`${row.leagueAbbName ?? ''} ${row.leagueAllName ?? ''} ${row.matchName ?? ''}`)
  );
  const matchedRows = [];
  const spfHhadRows = [];
  const samples = [];
  const snapshots = [];

  for (const row of worldCupRows) {
    const event = {
      home_team: row.homeTeamAllName ?? row.homeTeamAbbName,
      away_team: row.awayTeamAllName ?? row.awayTeamAbbName
    };
    const match = syncSportteryResolvedFixture(
      db,
      matchOfficialFixture(event, official) ?? matchOfficialFixtureByKickoff(row, official),
      row,
      teamsByCode
    );
    if (match) matchedRows.push(row);
    const hasSpfHhad = sportteryPoolComplete(row.had) && sportteryPoolComplete(row.hhad, true);
    if (match && hasSpfHhad) spfHhadRows.push(row);
    if (match) {
      samples.push(sportterySample(row, match));
      const snapshot = sportterySnapshotFromRow(row, match, capturedAt);
      if (isCompleteSnapshot(snapshot)) snapshots.push(snapshot);
    }
  }

  return {
    provider: 'Sporttery 体彩',
    sourceType: 'official_sporttery_calculator',
    url,
    publicPage: SPORTTERY_PAGE_URL,
    status: result.ok
      ? snapshots.length > 0
        ? 'official_sporttery_complete_snapshots'
        : spfHhadRows.length > 0
          ? 'official_spf_hhad_candidates_found_missing_totals'
        : worldCupRows.length > 0
          ? 'reachable_worldcup_rows_missing_complete_spf_hhad'
          : 'reachable_no_worldcup_market'
      : 'fetch_failed',
    reachable: result.ok,
    httpStatus: result.status,
    rowsSeen: rows.length,
    candidateRows: matchedRows.length,
    completeCandidates: snapshots.length,
    spfHhadCandidates: spfHhadRows.length,
    importedRows: 0,
    observedLastUpdateTime: value.lastUpdateTime ?? null,
    notes: [
      '官方计算器页面调用 getMatchCalculatorV1.qry；该接口可读取 HAD 胜平负和 HHAD 让球胜平负赔率。',
      '体彩 TTG 总进球数池按 0/1/2 与 3+ 的隐含概率转换为 2.5 球大小球等价赔率，用于满足模型完整盘口输入。'
    ],
    error: result.error ?? null,
    sample: samples,
    snapshots
  };
}

function dongqiudiImportantStart(dateText) {
  return `${addDays(dateText, -1)} 16:00:00`;
}

function dqdOddsIndexUrl(matchId) {
  const params = new URLSearchParams({
    cmp_type: 'soccer',
    app: 'dqd',
    lang: 'zh-cn',
    platform: 'ios'
  });
  return `${DONGQIUDI_BASE_URL}/sport-data/soccer/biz/dqd/v1/match/odds/index/${matchId}?${params.toString()}`;
}

const DQD_ASIAN_LINE_TEXT = new Map([
  ['平手', 0],
  ['平/半', 0.25],
  ['半球', 0.5],
  ['半/一', 0.75],
  ['一球', 1],
  ['一/球半', 1.25],
  ['球半', 1.5],
  ['球半/两', 1.75],
  ['两球', 2],
  ['两/两半', 2.25],
  ['两半', 2.5],
  ['两半/三', 2.75],
  ['三球', 3],
  ['三/三半', 3.25],
  ['三半', 3.5],
  ['三半/四', 3.75],
  ['四球', 4]
]);

function parseDqdLineText(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return null;
  const numeric = parseNumber(text);
  if (numeric != null) return numeric;
  const slashNumeric = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(text);
  if (slashNumeric) return (Number(slashNumeric[1]) + Number(slashNumeric[2])) / 2;
  return DQD_ASIAN_LINE_TEXT.get(text) ?? null;
}

function signedDqdAsianLine(euroRow, asiaRow) {
  const magnitude = parseDqdLineText(asiaRow?.now?.draw);
  if (magnitude == null) return null;
  if (magnitude === 0) return 0;
  const homeOdds = parseNumber(euroRow?.now?.homeWin);
  const awayOdds = parseNumber(euroRow?.now?.awayWin);
  if (homeOdds == null || awayOdds == null) return null;
  return homeOdds <= awayOdds ? -magnitude : magnitude;
}

function parseDqdTimestamp(value, window, fallbackIso) {
  const text = String(value ?? '').trim();
  if (!text) return fallbackIso;
  const year = window.from.slice(0, 4);
  const normalized = `${year}-${text.length === 11 ? `${text}:00` : text}+08:00`;
  const date = new Date(normalized.replace(' ', 'T'));
  return Number.isNaN(date.valueOf()) ? fallbackIso : date.toISOString();
}

function dqdProviderKey(row) {
  return normalizeName(row?.name);
}

function dqdRowsByProvider(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = dqdProviderKey(row);
    if (key && !map.has(key)) map.set(key, row);
  }
  return map;
}

function dqdSnapshotFromRows(match, euroRow, asiaRow, sizeRow, window, phase = 'now') {
  const euro = euroRow?.[phase];
  const asia = asiaRow?.[phase];
  const size = sizeRow?.[phase];
  const homeOdds = parseNumber(euro?.homeWin);
  const drawOdds = parseNumber(euro?.draw);
  const awayOdds = parseNumber(euro?.awayWin);
  const asianLine = phase === 'now'
    ? signedDqdAsianLine(euroRow, asiaRow)
    : (() => {
        const magnitude = parseDqdLineText(asia?.draw);
        if (magnitude == null) return null;
        if (magnitude === 0) return 0;
        return homeOdds <= awayOdds ? -magnitude : magnitude;
      })();
  const totalLine = parseDqdLineText(size?.draw);
  const capturedAt = parseDqdTimestamp(euro?.ts || asia?.ts || size?.ts, window, new Date().toISOString());
  const snapshot = {
    matchId: match.id,
    capturedAt,
    provider: `Dongqiudi/${euroRow.name}`,
    homeOdds,
    drawOdds,
    awayOdds,
    asianLine,
    asianHomeWater: parseNumber(asia?.homeWin),
    asianAwayWater: parseNumber(asia?.awayWin),
    totalLine,
    overWater: parseNumber(size?.homeWin),
    underWater: parseNumber(size?.awayWin),
    sourceType: 'dongqiudi_odds_index'
  };
  snapshot.snapshotHash = sha1({ ...snapshot, phase });
  return snapshot;
}

function dqdSnapshotsFromOddsIndex(raw, match, window) {
  const asiaByProvider = dqdRowsByProvider(raw?.asia);
  const sizeByProvider = dqdRowsByProvider(raw?.size);
  const snapshots = [];

  for (const euroRow of raw?.euro ?? []) {
    if (parseNumber(euroRow.fixed_odds) !== 0) continue;
    const key = dqdProviderKey(euroRow);
    const asiaRow = asiaByProvider.get(key);
    const sizeRow = sizeByProvider.get(key);
    if (!asiaRow || !sizeRow) continue;
    for (const phase of ['begin', 'now']) {
      const snapshot = dqdSnapshotFromRows(match, euroRow, asiaRow, sizeRow, window, phase);
      if (isCompleteSnapshot(snapshot)) snapshots.push(snapshot);
    }
  }

  return snapshots;
}

function dqdSportteryHandicapSample(raw) {
  const row = (raw?.euro ?? []).find((item) => item.name === '竞彩让球');
  if (!row) return null;
  return {
    fixedOdds: parseNumber(row.fixed_odds),
    begin: {
      h: parseNumber(row.begin?.homeWin),
      d: parseNumber(row.begin?.draw),
      a: parseNumber(row.begin?.awayWin),
      ts: row.begin?.ts ?? null
    },
    now: {
      h: parseNumber(row.now?.homeWin),
      d: parseNumber(row.now?.draw),
      a: parseNumber(row.now?.awayWin),
      ts: row.now?.ts ?? null
    }
  };
}

async function refreshDongqiudi(db, window) {
  const start = dongqiudiImportantStart(window.from);
  const params = new URLSearchParams({
    start,
    init: '1',
    platform: 'www',
    version: '576',
    _t: String(Math.floor(Date.now() / 30_000))
  });
  const url = `${DONGQIUDI_IMPORTANT_URL}?${params.toString()}`;
  const result = await fetchJson(url);
  const rows = Array.isArray(result.json?.list) ? result.json.list : [];
  const official = officialMatches(db);
  const snapshots = [];
  const samples = [];
  let matchedRows = 0;
  let oddsIndexReachable = 0;
  const maxMatches = Math.max(1, Math.min(40, Number(process.env.DONGQIUDI_MATCH_LIMIT || 20)));

  const worldCupRows = rows
    .filter((row) => /世界杯|World Cup|FIFA/i.test(`${row.competition_name ?? ''} ${row.match_title ?? ''}`))
    .filter((row) => dateInRange(String(row.start_play ?? '').slice(0, 10), window.from, window.to));

  for (const row of worldCupRows.slice(0, maxMatches)) {
    const match = matchOfficialFixture(
      { home_team: row.team_A_name, away_team: row.team_B_name },
      official
    );
    if (!match) {
      samples.push({
        matchId: row.match_id,
        fixture: `${row.team_A_name ?? '未知'} vs ${row.team_B_name ?? '未知'}`,
        startPlay: row.start_play,
        matchNo: null,
        status: 'unmatched_official_fixture'
      });
      continue;
    }
    matchedRows += 1;
    const oddsUrl = dqdOddsIndexUrl(row.match_id);
    const oddsResult = await fetchJson(oddsUrl);
    if (oddsResult.ok) oddsIndexReachable += 1;
    const oddsRaw = oddsResult.json ?? {};
    const matchSnapshots = oddsResult.ok ? dqdSnapshotsFromOddsIndex(oddsRaw, match, window) : [];
    snapshots.push(...matchSnapshots);
    samples.push({
      matchId: row.match_id,
      matchNo: match.match_no,
      fixture: `${row.team_A_name} vs ${row.team_B_name}`,
      competition: row.competition_name,
      startPlay: row.start_play,
      oddsIndexUrl: oddsUrl,
      oddsIndexStatus: oddsResult.status,
      euroRows: oddsRaw.euro?.length ?? 0,
      asiaRows: oddsRaw.asia?.length ?? 0,
      sizeRows: oddsRaw.size?.length ?? 0,
      completeSnapshots: matchSnapshots.length,
      sportteryHandicap: dqdSportteryHandicapSample(oddsRaw)
    });
  }

  return {
    source: {
      provider: 'Dongqiudi 懂球帝',
      sourceType: 'dongqiudi_odds_index',
      url,
      publicPage: DONGQIUDI_BASE_URL,
      status: result.ok
        ? snapshots.length > 0
          ? 'complete_market_candidates_found'
          : worldCupRows.length > 0
            ? 'reachable_worldcup_rows_missing_complete_market'
            : 'reachable_no_worldcup_market'
        : result.status === 403
          ? 'blocked_http_403'
          : 'fetch_failed',
      reachable: result.ok,
      httpStatus: result.status,
      rowsSeen: rows.length,
      candidateRows: matchedRows,
      completeCandidates: snapshots.length,
      importedRows: 0,
      oddsIndexReachable,
      notes: [
        '通过懂球帝 important 公开列表定位世界杯 match_id，再读取 odds/index 指数接口。',
        '只按同一公司名同时存在欧指、亚盘和大小球三类字段的行写入 odds_snapshots；竞彩让球行保留在 sample 中用于让球审计。'
      ],
      error: result.error ?? null,
      sample: samples.slice(0, 10)
    },
    snapshots
  };
}

async function refreshHkjc() {
  const result = await fetchText(HKJC_CONFIG_URL);
  const poolCodes = ['HAD_POO_NEW', 'HHA_POO_NEW', 'ALLODDS_POO_NEW', 'CHP_POO_NEW'].filter((code) =>
    result.text.includes(code)
  );
  return {
    provider: 'HKJC 香港赛马会',
    sourceType: 'official_site_config',
    url: HKJC_CONFIG_URL,
    publicPage: HKJC_BETTING_INFO_URL,
    status: result.ok && poolCodes.length > 0 ? 'public_pool_config_detected_mapping_required' : 'fetch_failed',
    reachable: result.ok,
    httpStatus: result.status,
    rowsSeen: 0,
    candidateRows: poolCodes.length,
    completeCandidates: 0,
    importedRows: 0,
    notes: [
      poolCodes.length > 0 ? `检测到官方足球池配置：${poolCodes.join(', ')}` : '未能检测到公开池配置。',
      '官网页面可验证 HAD、Handicap、HiLo 等玩法存在；但动态 odds feed 还需稳定映射和合规抓取后才写入。'
    ],
    error: result.error ?? null,
    sample: []
  };
}

async function refreshMacauSlot() {
  const result = await fetchText(MACAU_SLOT_URL);
  const challengeDetected = /arg1=|acw_sc|aliyun|waf|__jsl|challenge/i.test(result.text);
  return {
    provider: 'Macau Slot 澳门彩票',
    sourceType: 'official_site_waf_probe',
    url: MACAU_SLOT_URL,
    publicPage: MACAU_SLOT_INFO_URL,
    status: result.ok
      ? challengeDetected
        ? 'reachable_waf_challenge_no_machine_readable_market'
        : 'reachable_no_verified_worldcup_market_adapter'
      : 'fetch_failed',
    reachable: result.ok,
    httpStatus: result.status,
    rowsSeen: 0,
    candidateRows: 0,
    completeCandidates: 0,
    importedRows: 0,
    notes: [
      '澳门彩票娱乐官网可访问，但当前返回 WAF/脚本挑战页面时不能稳定解析官方盘口。',
      '未拿到欧赔、让球和大小球三类完整字段前，只记录审计状态，不写入 odds_snapshots。'
    ],
    error: result.error ?? null,
    sample: [
      {
        challengeDetected,
        bytes: result.text.length,
        title: /<title>([^<]*)/i.exec(result.text)?.[1] ?? null
      }
    ]
  };
}

function classifyProbe(result) {
  const title = /<title>([^<]*)/i.exec(result.text)?.[1] ?? null;
  const lower = result.text.toLowerCase();
  if (result.status === 403 && lower.includes('cloudflare')) return { status: 'blocked_cloudflare', title };
  if (result.status === 403 && /prohibited|forbidden|access denied/i.test(result.text)) return { status: 'blocked_or_geo_restricted', title };
  if (result.status === 403) return { status: 'blocked_http_403', title };
  if (result.ok) return { status: 'reachable_public_page_no_machine_adapter', title };
  return { status: 'fetch_failed', title };
}

async function refreshEuropeanPublicPages() {
  const probes = await Promise.all(
    EUROPEAN_PUBLIC_PAGE_PROBES.map(async (probe) => {
      const result = await fetchText(probe.url);
      const classification = classifyProbe(result);
      return {
        provider: probe.provider,
        url: probe.url,
        reachable: result.ok,
        httpStatus: result.status,
        status: classification.status,
        title: classification.title,
        bytes: result.text.length,
        error: result.error ?? null
      };
    })
  );
  const reachable = probes.some((probe) => probe.reachable);
  return {
    provider: 'European public bookmaker pages',
    sourceType: 'public_page_probe',
    url: EUROPEAN_PUBLIC_PAGE_PROBES[0].url,
    status: probes.some((probe) => probe.status.startsWith('blocked'))
      ? 'probed_blocked_public_pages_no_import'
      : 'probed_no_direct_import',
    reachable,
    httpStatus: null,
    rowsSeen: probes.length,
    candidateRows: 0,
    completeCandidates: 0,
    importedRows: 0,
    notes: [
      '直接抓取公开 bookmaker 页面时可能遇到 Cloudflare、地域限制或登录态限制。',
      '这些页面只作为来源可达性审计；没有结构化完整盘口时不写入模型。'
    ],
    sample: probes
  };
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function canonicalName(value) {
  const normalized = normalizeName(value);
  return TEAM_ALIASES.get(normalized) ?? normalized;
}

function dateInRange(dateText, from, to) {
  return typeof dateText === 'string' && dateText >= from && dateText <= to;
}

function decodeNextFlight(html) {
  const chunks = [];
  const pattern = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g;
  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`));
    } catch {
      // Ignore malformed chunks; the audit will report zero candidates if no props parse cleanly.
    }
  }
  return chunks.join('');
}

function extractBalancedJson(text, marker) {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseNextProps(html, marker) {
  const flight = decodeNextFlight(html);
  const jsonText = extractBalancedJson(flight, marker);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function oddsLabMatchUrl(match) {
  const key = String(match.key ?? match.matchKey ?? '')
    .trim()
    .replaceAll('_', '-');
  return key ? `${ODDSLAB_LEAGUE_URL}/matches/${key}` : null;
}

function officialMatches(db) {
  return db
    .prepare(
      `SELECT
        m.id,
        m.match_no,
        m.stage,
        m.kickoff_utc,
        m.home_team_id,
        m.away_team_id,
        COALESCE(ht.name_zh, m.home_placeholder) AS home_name,
        COALESCE(at.name_zh, m.away_placeholder) AS away_name,
        m.home_placeholder,
        m.away_placeholder,
        m.status
       FROM matches m
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
       ORDER BY m.match_no`
    )
    .all();
}

function matchOfficialFixture(event, matches) {
  const eventHome = canonicalName(event.home_team);
  const eventAway = canonicalName(event.away_team);
  if (!eventHome || !eventAway) return null;
  return (
    matches.find((match) => {
      const home = canonicalName(match.home_name);
      const away = canonicalName(match.away_name);
      return home && away && home === eventHome && away === eventAway;
    }) ??
    matches.find((match) => {
      const home = canonicalName(match.home_placeholder);
      const away = canonicalName(match.away_placeholder);
      return home && away && home === eventHome && away === eventAway;
    }) ??
    null
  );
}

function marketByKey(bookmaker, key) {
  return bookmaker.markets?.find((market) => market.key === key) ?? null;
}

function outcomePrice(market, name) {
  const normalized = canonicalName(name);
  const outcome = market?.outcomes?.find((item) => canonicalName(item.name) === normalized);
  return parseNumber(outcome?.price);
}

function drawPrice(market) {
  const outcome = market?.outcomes?.find((item) => /draw|tie|平/i.test(item.name));
  return parseNumber(outcome?.price);
}

function spreadOutcome(market, name) {
  const normalized = canonicalName(name);
  return market?.outcomes?.find((item) => canonicalName(item.name) === normalized) ?? null;
}

function totalOutcome(market, label) {
  return market?.outcomes?.find((item) => String(item.name).toLowerCase() === label) ?? null;
}

function finiteNumber(value) {
  const number = parseNumber(value);
  return Number.isFinite(number) ? number : null;
}

function decimalMarketScore(firstPrice, secondPrice, target = 1.92) {
  return Math.abs(firstPrice - secondPrice) + Math.abs((firstPrice + secondPrice) / 2 - target) * 0.25;
}

function chooseSpreadPair(market, homeName, awayName) {
  const outcomes = market?.outcomes ?? [];
  const homeCode = canonicalName(homeName);
  const awayCode = canonicalName(awayName);
  const homeOutcomes = outcomes.filter((outcome) => canonicalName(outcome.name) === homeCode);
  const awayOutcomes = outcomes.filter((outcome) => canonicalName(outcome.name) === awayCode);
  const pairs = [];

  for (const home of homeOutcomes) {
    for (const away of awayOutcomes) {
      const homePoint = finiteNumber(home.point);
      const awayPoint = finiteNumber(away.point);
      const homePrice = finiteNumber(home.price);
      const awayPrice = finiteNumber(away.price);
      if ([homePoint, awayPoint, homePrice, awayPrice].some((value) => value == null)) continue;
      if (Math.abs(homePoint + awayPoint) > 0.001) continue;
      pairs.push({
        asianLine: homePoint,
        asianHomeWater: homePrice,
        asianAwayWater: awayPrice,
        score: decimalMarketScore(homePrice, awayPrice) + Math.abs(Math.abs(homePoint) - 1) * 0.03
      });
    }
  }

  return pairs.sort((left, right) => left.score - right.score)[0] ?? null;
}

function chooseTotalPair(market) {
  const overOutcomes = (market?.outcomes ?? []).filter((outcome) => String(outcome.name).toLowerCase() === 'over');
  const underOutcomes = (market?.outcomes ?? []).filter((outcome) => String(outcome.name).toLowerCase() === 'under');
  const pairs = [];

  for (const over of overOutcomes) {
    for (const under of underOutcomes) {
      const overPoint = finiteNumber(over.point);
      const underPoint = finiteNumber(under.point);
      const overPrice = finiteNumber(over.price);
      const underPrice = finiteNumber(under.price);
      if ([overPoint, underPoint, overPrice, underPrice].some((value) => value == null)) continue;
      if (Math.abs(overPoint - underPoint) > 0.001) continue;
      pairs.push({
        totalLine: overPoint,
        overWater: overPrice,
        underWater: underPrice,
        score: decimalMarketScore(overPrice, underPrice) + Math.abs(overPoint - 2.5) * 0.02
      });
    }
  }

  return pairs.sort((left, right) => left.score - right.score)[0] ?? null;
}

function snapshotFromOddsApiEvent(event, bookmaker, match) {
  const h2h = marketByKey(bookmaker, 'h2h_3_way') ?? marketByKey(bookmaker, 'h2h');
  const spreads = marketByKey(bookmaker, 'spreads');
  const totals = marketByKey(bookmaker, 'totals');
  const homeOdds = outcomePrice(h2h, event.home_team);
  const awayOdds = outcomePrice(h2h, event.away_team);
  const drawOdds = drawPrice(h2h);
  const homeSpread = spreadOutcome(spreads, event.home_team);
  const awaySpread = spreadOutcome(spreads, event.away_team);
  const over = totalOutcome(totals, 'over');
  const under = totalOutcome(totals, 'under');
  const capturedAt = bookmaker.last_update ?? event.commence_time ?? new Date().toISOString();
  const snapshot = {
    matchId: match.id,
    capturedAt,
    provider: `The Odds API/${bookmaker.title ?? bookmaker.key}`,
    homeOdds,
    drawOdds,
    awayOdds,
    asianLine: parseNumber(homeSpread?.point),
    asianHomeWater: parseNumber(homeSpread?.price),
    asianAwayWater: parseNumber(awaySpread?.price),
    totalLine: parseNumber(over?.point ?? under?.point),
    overWater: parseNumber(over?.price),
    underWater: parseNumber(under?.price),
    sourceType: 'european_bookmaker_api'
  };
  snapshot.snapshotHash = sha1(snapshot);
  return snapshot;
}

function snapshotFromOddsLabBookmaker(event, bookmaker, match, metadata) {
  const h2h = marketByKey(bookmaker, 'h2h_3_way') ?? marketByKey(bookmaker, 'h2h');
  const spreads = marketByKey(bookmaker, 'spreads') ?? marketByKey(bookmaker, 'alternate_spreads');
  const totals = marketByKey(bookmaker, 'totals') ?? marketByKey(bookmaker, 'alternate_totals');
  const spread = chooseSpreadPair(spreads, event.home_team, event.away_team);
  const total = chooseTotalPair(totals);
  const capturedAt = metadata?.timestamp ?? bookmaker.last_update ?? event.commenceTime ?? new Date().toISOString();
  const snapshot = {
    matchId: match.id,
    capturedAt,
    provider: `OddsLab/${bookmaker.title ?? bookmaker.key ?? 'unknown'}`,
    homeOdds: outcomePrice(h2h, event.home_team),
    drawOdds: drawPrice(h2h),
    awayOdds: outcomePrice(h2h, event.away_team),
    asianLine: spread?.asianLine ?? null,
    asianHomeWater: spread?.asianHomeWater ?? null,
    asianAwayWater: spread?.asianAwayWater ?? null,
    totalLine: total?.totalLine ?? null,
    overWater: total?.overWater ?? null,
    underWater: total?.underWater ?? null,
    sourceType: 'european_bookmaker_public_snapshot'
  };
  snapshot.snapshotHash = sha1(snapshot);
  return snapshot;
}

function isCompleteSnapshot(snapshot) {
  return [
    snapshot.matchId,
    snapshot.capturedAt,
    snapshot.provider,
    snapshot.homeOdds,
    snapshot.drawOdds,
    snapshot.awayOdds,
    snapshot.asianLine,
    snapshot.asianHomeWater,
    snapshot.asianAwayWater,
    snapshot.totalLine,
    snapshot.overWater,
    snapshot.underWater,
    snapshot.sourceType,
    snapshot.snapshotHash
  ].every((value) => value !== null && value !== undefined && value !== '');
}

async function refreshOddsLab(db, window) {
  const result = await fetchText(ODDSLAB_LEAGUE_URL);
  const leagueProps = result.ok ? parseNextProps(result.text, '{"matches":') : null;
  const leagueMatches = Array.isArray(leagueProps?.matches) ? leagueProps.matches : [];
  const official = officialMatches(db);
  const snapshots = [];
  const samples = [];
  let matchedRows = 0;
  const maxMatches = Math.max(1, Math.min(40, Number(process.env.ODDSLAB_MATCH_LIMIT || 16)));
  const candidateMatches = leagueMatches
    .filter((leagueMatch) => {
      const kickoff = leagueMatch.kickoffTime ? new Date(leagueMatch.kickoffTime) : null;
      const localDate =
        kickoff && !Number.isNaN(kickoff.valueOf())
          ? localDateParts(kickoff, window.timeZone)
          : String(leagueMatch.matchDate ?? '').slice(0, 10);
      return dateInRange(localDate, window.from, window.to);
    })
    .slice(0, maxMatches);

  const pageResults = await Promise.all(
    candidateMatches.map(async (leagueMatch) => {
      const url = oddsLabMatchUrl(leagueMatch);
      if (!url) return { leagueMatch, url: null, result: null, props: null };
      const page = await fetchText(url);
      return {
        leagueMatch,
        url,
        result: page,
        props: page.ok ? parseNextProps(page.text, '{"snapshots":') : null
      };
    })
  );

  for (const page of pageResults) {
    const props = page.props;
    const snapshotEntries = Object.entries(props?.snapshots ?? {});
    const event = {
      home_team: props?.homeTeam ?? page.leagueMatch.homeTeam,
      away_team: props?.awayTeam ?? page.leagueMatch.awayTeam,
      commenceTime: props?.kickoffTime ?? page.leagueMatch.kickoffTime
    };
    const match = matchOfficialFixture(event, official);
    if (match) matchedRows += 1;

    let completeSnapshots = 0;
    for (const [, snapshot] of snapshotEntries) {
      const odds = snapshot?.odds ?? {};
      const oddsEvent = {
        home_team: odds.homeTeam ?? event.home_team,
        away_team: odds.awayTeam ?? event.away_team,
        commenceTime: odds.commenceTime ?? event.commenceTime
      };
      const officialMatch = match ?? matchOfficialFixture(oddsEvent, official);
      if (!officialMatch) continue;
      for (const bookmaker of odds.bookmakers ?? []) {
        const candidate = snapshotFromOddsLabBookmaker(oddsEvent, bookmaker, officialMatch, snapshot.metadata);
        if (isCompleteSnapshot(candidate)) {
          snapshots.push(candidate);
          completeSnapshots += 1;
        }
      }
    }

    samples.push({
      matchNo: match?.match_no ?? null,
      fixture: `${event.home_team ?? '未知'} vs ${event.away_team ?? '未知'}`,
      kickoffTime: event.commenceTime ?? null,
      url: page.url,
      httpStatus: page.result?.status ?? null,
      snapshotsSeen: snapshotEntries.length,
      completeSnapshots
    });
  }

  return {
    source: {
      provider: 'OddsLab public odds archive',
      sourceType: 'european_bookmaker_public_snapshot',
      url: ODDSLAB_LEAGUE_URL,
      status: result.ok
        ? snapshots.length > 0
          ? 'complete_market_candidates_found'
          : candidateMatches.length > 0
            ? 'reachable_no_complete_worldcup_market'
            : 'reachable_no_window_matches'
        : 'fetch_failed',
      reachable: result.ok,
      httpStatus: result.status,
      rowsSeen: leagueMatches.length,
      candidateRows: matchedRows,
      completeCandidates: snapshots.length,
      importedRows: 0,
      notes: [
        '公开页面内含赛前盘口快照；只写入同一 bookmaker 同一快照中胜平负、让球/亚盘、大小球三类字段完整的数据。',
        `本轮按 ${window.from} 至 ${window.to} 窗口解析，最多抓取 ${maxMatches} 场，provider 会保留为 OddsLab/底层公司名。`
      ],
      error: result.error ?? null,
      sample: samples.slice(0, 8)
    },
    snapshots
  };
}

async function refreshOddsApi(db) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return {
      source: {
        provider: 'The Odds API',
        sourceType: 'european_bookmaker_api',
        url: ODDS_API_DOC_URL,
        status: 'requires_api_key',
        reachable: null,
        httpStatus: null,
        rowsSeen: 0,
        candidateRows: 0,
        completeCandidates: 0,
        importedRows: 0,
        notes: [
          '未设置 ODDS_API_KEY，欧洲/英国 bookmaker 聚合接口未请求。',
          '该 API 文档支持 odds endpoint 的 regions 和 h2h/spreads/totals 市场；配置 key 后才尝试写入完整盘口。'
        ],
        sample: []
      },
      snapshots: []
    };
  }

  const params = new URLSearchParams({
    apiKey,
    regions: process.env.ODDS_API_REGIONS || 'eu,uk',
    markets: process.env.ODDS_API_MARKETS || 'h2h,spreads,totals',
    oddsFormat: 'decimal',
    dateFormat: 'iso'
  });
  const url = `https://api.the-odds-api.com/v4/sports/${ODDS_API_SPORT_KEY}/odds/?${params.toString()}`;
  const auditUrl = redactUrl(url, apiKey);
  const result = await fetchJson(url);
  const rows = Array.isArray(result.json) ? result.json : [];
  const matches = officialMatches(db);
  const snapshots = [];
  const samples = [];
  let matchedRows = 0;

  for (const event of rows) {
    const match = matchOfficialFixture(event, matches);
    if (!match) {
      samples.push({
        home: event.home_team,
        away: event.away_team,
        commenceTime: event.commence_time,
        bookmakers: event.bookmakers?.length ?? 0,
        matchNo: null
      });
      continue;
    }
    matchedRows += 1;
    for (const bookmaker of event.bookmakers ?? []) {
      const snapshot = snapshotFromOddsApiEvent(event, bookmaker, match);
      if (isCompleteSnapshot(snapshot)) snapshots.push(snapshot);
    }
    samples.push({
      home: event.home_team,
      away: event.away_team,
      commenceTime: event.commence_time,
      bookmakers: event.bookmakers?.length ?? 0,
      matchNo: match.match_no
    });
  }

  return {
    source: {
      provider: 'The Odds API',
      sourceType: 'european_bookmaker_api',
      url: auditUrl,
      status: result.ok
        ? snapshots.length > 0
          ? 'complete_market_candidates_found'
          : 'reachable_no_complete_worldcup_market'
        : 'fetch_failed',
      reachable: result.ok,
      httpStatus: result.status,
      rowsSeen: rows.length,
      candidateRows: matchedRows,
      completeCandidates: snapshots.length,
      importedRows: 0,
      notes: [
        `请求 sport=${ODDS_API_SPORT_KEY}, regions=${params.get('regions')}, markets=${params.get('markets')}。`,
        '只有同一 bookmaker 同时包含胜平负、让球和大小球时才写入本地 odds_snapshots。'
      ],
      error: result.error ?? null,
      sample: samples.slice(0, 5)
    },
    snapshots
  };
}

function insertSnapshots(db, snapshots) {
  if (snapshots.length === 0) return { insertedRows: 0, skippedRows: 0 };
  const insert = db.prepare(`
    INSERT OR IGNORE INTO odds_snapshots (
      match_id, captured_at, provider, home_odds, draw_odds, away_odds, asian_line,
      asian_home_water, asian_away_water, total_line, over_water, under_water,
      source_type, snapshot_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let insertedRows = 0;
  let skippedRows = 0;
  db.exec('BEGIN');
  try {
    for (const snapshot of snapshots) {
      if (!isCompleteSnapshot(snapshot)) {
        skippedRows += 1;
        continue;
      }
      const result = insert.run(
        snapshot.matchId,
        snapshot.capturedAt,
        snapshot.provider,
        snapshot.homeOdds,
        snapshot.drawOdds,
        snapshot.awayOdds,
        snapshot.asianLine,
        snapshot.asianHomeWater,
        snapshot.asianAwayWater,
        snapshot.totalLine,
        snapshot.overWater,
        snapshot.underWater,
        snapshot.sourceType,
        snapshot.snapshotHash
      );
      if (result.changes > 0) insertedRows += 1;
      else skippedRows += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { insertedRows, skippedRows };
}

function writeAudit(audit) {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  writeFileSync(ODDS_AUDIT_FILE, `${JSON.stringify(audit, null, 2)}\n`);
}

function readPreviousEuroHandicapRecommendations() {
  if (!existsSync(ODDS_AUDIT_FILE)) {
    return {
      generatedAt: null,
      rows: []
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(ODDS_AUDIT_FILE, 'utf8'));
    return {
      generatedAt: parsed.euroHandicapRecommendations?.generatedAt ?? parsed.generatedAt ?? null,
      rows: Array.isArray(parsed.euroHandicapRecommendations?.rows)
        ? parsed.euroHandicapRecommendations.rows
        : []
    };
  } catch {
    return {
      generatedAt: null,
      rows: []
    };
  }
}

function recordImportRun(db, audit) {
  const now = audit.generatedAt;
  const snapshotKey = `odds-audit-${sha1(audit)}`;
  db.prepare(
    `INSERT INTO import_runs (run_type, started_at, finished_at, source, status, rows_affected, snapshot_key, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'odds-source-audit',
    audit.startedAt,
    now,
    'sporttery-calculator+dongqiudi+hkjc+macau+public-bookmaker-pages+oddslab+the-odds-api',
    audit.status === 'complete_market_odds_imported' ? 'success' : 'blocked',
    audit.importSummary.rowsImported,
    snapshotKey,
    audit.recommendationPolicy
  );
}

function sportterySampleByMatchNo(source) {
  const map = new Map();
  for (const sample of source?.sample ?? []) {
    if (sample.officialMatchNo != null) map.set(Number(sample.officialMatchNo), sample);
  }
  return map;
}

function hhadKeyForScore(score, line) {
  const homeGoals = Number(score.home_goals);
  const awayGoals = Number(score.away_goals);
  const adjusted = homeGoals - awayGoals + Number(line);
  if (!Number.isFinite(adjusted)) return null;
  if (adjusted > 0) return 'home';
  if (adjusted < 0) return 'away';
  return 'draw';
}

function oddsForKey(pool, key) {
  if (key === 'home') return parseNumber(pool?.h);
  if (key === 'draw') return parseNumber(pool?.d);
  if (key === 'away') return parseNumber(pool?.a);
  return null;
}

function labelForHhadKey(key) {
  if (key === 'home') return '让胜';
  if (key === 'draw') return '让平';
  if (key === 'away') return '让负';
  return '观察';
}

function labelForMoneylineKey(key) {
  if (key === 'home') return '主胜';
  if (key === 'draw') return '平局';
  if (key === 'away') return '客胜';
  return '观察';
}

function edgeFor(probability, odds) {
  if (!Number.isFinite(probability) || !Number.isFinite(odds)) return null;
  return probability * odds - 1;
}

function receivingSideText(line, home, away) {
  if (line < 0) return `${away} 受让 +${Math.abs(line)}`;
  if (line > 0) return `${home} 受让 +${Math.abs(line)}`;
  return '平手盘';
}

function buildHhadDistribution(scores, line) {
  const totals = { home: 0, draw: 0, away: 0 };
  for (const score of scores) {
    const key = hhadKeyForScore(score, line);
    const probability = Number(score.probability);
    if (!key || !Number.isFinite(probability)) continue;
    totals[key] += probability;
  }
  const [home, draw, away] = normalizeProbabilities([totals.home, totals.draw, totals.away]);
  if ([home, draw, away].some((value) => value == null)) return null;
  return { home, draw, away };
}

function buildEuroHandicapRecommendations(db, sportterySource) {
  const sportteryByMatchNo = sportterySampleByMatchNo(sportterySource);
  if (sportteryByMatchNo.size === 0) {
    return {
      status: 'blocked_no_sporttery_hhad',
      generatedAt: new Date().toISOString(),
      guardrail: '没有体彩 HHAD 样本，不能生成欧赔让球候选。',
      rows: []
    };
  }

  const rows = db
    .prepare(
      `SELECT
        m.id,
        m.match_no,
        COALESCE(ht.name_zh, m.home_placeholder) AS home_name,
        COALESCE(at.name_zh, m.away_placeholder) AS away_name,
        p.id AS prediction_id,
        p.calibrated_home_prob,
        p.calibrated_draw_prob,
        p.calibrated_away_prob,
        p.expected_home_goals,
        p.expected_away_goals,
        p.confidence,
        p.upset_risk,
        p.value_score
       FROM matches m
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
       JOIN predictions p ON p.match_id = m.id
       ORDER BY m.match_no`
    )
    .all();
  const scoreStatement = db.prepare(
    `SELECT home_goals, away_goals, probability
     FROM score_probabilities
     WHERE prediction_id = ?
     ORDER BY probability DESC`
  );
  const recommendationRows = [];

  for (const row of rows) {
    const sporttery = sportteryByMatchNo.get(Number(row.match_no));
    const line = parseNumber(sporttery?.hhad?.goalLine);
    if (!sporttery || line == null) continue;
    const scores = scoreStatement.all(row.prediction_id);
    const distribution = buildHhadDistribution(scores, line);
    if (!distribution) continue;

    const hhadCandidates = ['home', 'draw', 'away']
      .map((key) => {
        const odds = oddsForKey(sporttery.hhad, key);
        const probability = distribution[key];
        return {
          key,
          label: labelForHhadKey(key),
          odds,
          modelProbability: roundNumber(probability),
          edge: roundNumber(edgeFor(probability, odds), 4)
        };
      })
      .filter((candidate) => candidate.odds != null && candidate.edge != null);
    const receivingKeys = line < 0 ? new Set(['draw', 'away']) : line > 0 ? new Set(['home', 'draw']) : new Set(['home', 'draw', 'away']);
    const receivingPick =
      hhadCandidates
        .filter((candidate) => receivingKeys.has(candidate.key))
        .sort((left, right) => right.edge - left.edge || right.modelProbability - left.modelProbability)[0] ?? null;
    const bestHhad = hhadCandidates
      .toSorted((left, right) => right.edge - left.edge || right.modelProbability - left.modelProbability)[0] ?? null;

    const moneylineCandidates = [
      ['home', row.calibrated_home_prob],
      ['draw', row.calibrated_draw_prob],
      ['away', row.calibrated_away_prob]
    ]
      .map(([key, probability]) => {
        const odds = oddsForKey(sporttery.had, key);
        return {
          key,
          label: labelForMoneylineKey(key),
          odds,
          modelProbability: roundNumber(probability),
          edge: roundNumber(edgeFor(Number(probability), odds), 4)
        };
      })
      .filter((candidate) => candidate.odds != null && candidate.edge != null);
    const moneylinePick = moneylineCandidates
      .toSorted((left, right) => right.edge - left.edge || right.modelProbability - left.modelProbability)[0] ?? null;

    if (!receivingPick && !bestHhad && !moneylinePick) continue;
    const candidateEdge = Number(receivingPick?.edge ?? bestHhad?.edge ?? -1);
    const tier = candidateEdge >= 0.04 && Number(row.confidence) >= 0.48 ? 'candidate' : candidateEdge >= -0.02 ? 'watch' : 'avoid';
    recommendationRows.push({
      matchNo: row.match_no,
      fixture: `${row.home_name} vs ${row.away_name}`,
      matchNum: sporttery.matchNum,
      tier,
      receivingSide: receivingSideText(line, row.home_name, row.away_name),
      handicapLine: line,
      handicapPick: receivingPick
        ? {
            ...receivingPick,
            text: `${receivingSideText(line, row.home_name, row.away_name)} · ${receivingPick.label}`
          }
        : null,
      bestHandicapPick: bestHhad,
      moneylinePick,
      model: {
        confidence: roundNumber(row.confidence),
        upsetRisk: roundNumber(row.upset_risk),
        valueScore: roundNumber(row.value_score),
        expectedGoals: {
          home: roundNumber(row.expected_home_goals, 2),
          away: roundNumber(row.expected_away_goals, 2)
        }
      },
      source: {
        provider: 'Sporttery 体彩 HHAD',
        hadCapturedAt: sporttery.had?.capturedAt ?? null,
        hhadCapturedAt: sporttery.hhad?.capturedAt ?? null
      }
    });
  }

  const sortedRows = recommendationRows
    .sort((left, right) => {
      const rank = { candidate: 0, watch: 1, avoid: 2 };
      return (
        rank[left.tier] - rank[right.tier] ||
        Number(right.handicapPick?.edge ?? -99) - Number(left.handicapPick?.edge ?? -99) ||
        Number(left.matchNo) - Number(right.matchNo)
      );
    })
    .slice(0, 16);

  return {
    status: sortedRows.length > 0 ? 'generated_from_model_and_sporttery_hhad' : 'blocked_no_prediction_overlap',
    generatedAt: new Date().toISOString(),
    guardrail: '候选基于已入库盘口模型、比分分布和体彩 HHAD 欧赔；阵容、伤停、天气和新闻未复核前只作为观察清单，不作为投注指令。',
    rows: sortedRows,
    tierCounts: sortedRows.reduce(
      (counts, row) => ({
        ...counts,
        [row.tier]: (counts[row.tier] ?? 0) + 1
      }),
      { candidate: 0, watch: 0, avoid: 0 }
    )
  };
}

function recommendationKey(row) {
  return [
    row?.matchNo ?? '',
    row?.handicapPick?.key ?? row?.bestHandicapPick?.key ?? '',
    row?.handicapLine ?? ''
  ].join('|');
}

function recommendationComparable(row) {
  return {
    matchNo: row.matchNo,
    fixture: row.fixture,
    tier: row.tier,
    receivingSide: row.receivingSide,
    handicapLine: row.handicapLine,
    handicapPick: {
      key: row.handicapPick?.key ?? null,
      label: row.handicapPick?.label ?? null,
      odds: row.handicapPick?.odds ?? null,
      modelProbability: row.handicapPick?.modelProbability ?? null,
      edge: row.handicapPick?.edge ?? null,
      text: row.handicapPick?.text ?? null
    },
    moneylinePick: row.moneylinePick
      ? {
          key: row.moneylinePick.key,
          label: row.moneylinePick.label,
          odds: row.moneylinePick.odds,
          modelProbability: row.moneylinePick.modelProbability,
          edge: row.moneylinePick.edge
        }
      : null,
    model: row.model ?? null
  };
}

function changedFields(previous, current) {
  const changes = [];
  const checks = [
    ['tier', previous?.tier, current?.tier],
    ['receivingSide', previous?.receivingSide, current?.receivingSide],
    ['pick', previous?.handicapPick?.label, current?.handicapPick?.label],
    ['odds', previous?.handicapPick?.odds, current?.handicapPick?.odds],
    ['modelProbability', previous?.handicapPick?.modelProbability, current?.handicapPick?.modelProbability],
    ['edge', previous?.handicapPick?.edge, current?.handicapPick?.edge],
    ['confidence', previous?.model?.confidence, current?.model?.confidence],
    ['upsetRisk', previous?.model?.upsetRisk, current?.model?.upsetRisk]
  ];
  for (const [field, before, after] of checks) {
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field, before, after });
  }
  return changes;
}

function buildRecommendationDiff(previous, current) {
  const previousRows = previous?.rows ?? [];
  const currentRows = current?.rows ?? [];
  const previousByKey = new Map(previousRows.map((row) => [recommendationKey(row), row]));
  const currentByKey = new Map(currentRows.map((row) => [recommendationKey(row), row]));
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  for (const row of currentRows) {
    const key = recommendationKey(row);
    const before = previousByKey.get(key);
    if (!before) {
      added.push(recommendationComparable(row));
      continue;
    }
    const changes = changedFields(before, row);
    if (changes.length) {
      changed.push({
        key,
        matchNo: row.matchNo,
        fixture: row.fixture,
        before: recommendationComparable(before),
        after: recommendationComparable(row),
        changes
      });
    } else {
      unchanged += 1;
    }
  }

  for (const row of previousRows) {
    const key = recommendationKey(row);
    if (!currentByKey.has(key)) removed.push(recommendationComparable(row));
  }

  return {
    comparedWithGeneratedAt: previous?.generatedAt ?? null,
    currentGeneratedAt: current?.generatedAt ?? null,
    added,
    removed,
    changed,
    unchanged,
    summary: {
      previousRows: previousRows.length,
      currentRows: currentRows.length,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged
    }
  };
}

export async function refreshMarketOdds({ db }) {
  const startedAt = new Date().toISOString();
  const previousEuroHandicapRecommendations = readPreviousEuroHandicapRecommendations();
  const window = auditWindow(db);
  const [sporttery, dongqiudiResult, hkjc, macau, europeanPublic, oddsLabResult, oddsApiResult] = await Promise.all([
    refreshSporttery(db, window),
    refreshDongqiudi(db, window),
    refreshHkjc(),
    refreshMacauSlot(),
    refreshEuropeanPublicPages(),
    refreshOddsLab(db, window),
    refreshOddsApi(db)
  ]);
  const sportterySnapshots = (sporttery.snapshots ?? []).filter(isCompleteSnapshot);
  const dongqiudiSnapshots = dongqiudiResult.snapshots.filter(isCompleteSnapshot);
  const oddsLabSnapshots = oddsLabResult.snapshots.filter(isCompleteSnapshot);
  const oddsApiSnapshots = oddsApiResult.snapshots.filter(isCompleteSnapshot);
  const sportteryInsert = insertSnapshots(db, sportterySnapshots);
  const dongqiudiInsert = insertSnapshots(db, dongqiudiSnapshots);
  const oddsLabInsert = insertSnapshots(db, oddsLabSnapshots);
  const oddsApiInsert = insertSnapshots(db, oddsApiSnapshots);
  sporttery.importedRows = sportteryInsert.insertedRows;
  dongqiudiResult.source.importedRows = dongqiudiInsert.insertedRows;
  oddsLabResult.source.importedRows = oddsLabInsert.insertedRows;
  oddsApiResult.source.importedRows = oddsApiInsert.insertedRows;
  delete sporttery.snapshots;

  const rowsImported = sportteryInsert.insertedRows + dongqiudiInsert.insertedRows + oddsLabInsert.insertedRows + oddsApiInsert.insertedRows;
  const completeCandidates = sportterySnapshots.length + dongqiudiSnapshots.length + oddsLabSnapshots.length + oddsApiSnapshots.length;
  const trustedCompleteCandidates = sportterySnapshots.length + oddsLabSnapshots.length + oddsApiSnapshots.length;
  const secondaryCompleteCandidates = dongqiudiSnapshots.length;
  const skippedRows = sportteryInsert.skippedRows + dongqiudiInsert.skippedRows + oddsLabInsert.skippedRows + oddsApiInsert.skippedRows;
  const databaseSnapshotsAvailable = db.prepare('SELECT COUNT(*) AS count FROM odds_snapshots').get().count;
  const verifiedSnapshotsAvailable = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.source_type IN (${predictionUsableSourceSqlList()})
         AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
         AND datetime(os.captured_at) < datetime(m.kickoff_utc)`
    )
    .get().count;
  const trustedSnapshotsAvailable = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.source_type IN (${trustedSourceSqlList()})
         AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
         AND datetime(os.captured_at) < datetime(m.kickoff_utc)`
    )
    .get().count;
  const secondarySnapshotsAvailable = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM odds_snapshots os
       JOIN matches m ON m.id = os.match_id
       WHERE os.source_type IN (${secondarySourceSqlList()})
         AND datetime(os.captured_at) <= datetime('now', '+15 minutes')
         AND datetime(os.captured_at) < datetime(m.kickoff_utc)`
    )
    .get().count;
  const marketAvailable = trustedCompleteCandidates > 0 || trustedSnapshotsAvailable > 0 || verifiedSnapshotsAvailable > 0;
  const predictionRefresh = marketAvailable ? refreshPredictions(db) : null;
  const euroHandicapRecommendations = marketAvailable
    ? buildEuroHandicapRecommendations(db, sporttery)
    : {
        status: 'blocked_no_verified_market_odds',
        generatedAt: new Date().toISOString(),
        guardrail: '未写入完整盘口快照，欧赔让球候选保持阻断。',
        rows: [],
        tierCounts: { candidate: 0, watch: 0, avoid: 0 }
      };
  const recommendationDiff = buildRecommendationDiff(previousEuroHandicapRecommendations, euroHandicapRecommendations);
  const generatedAt = new Date().toISOString();
  const sources = [sporttery, dongqiudiResult.source, hkjc, macau, europeanPublic, oddsLabResult.source, oddsApiResult.source];
  const audit = {
    generatedAt,
    startedAt,
    status: marketAvailable ? 'complete_market_odds_imported' : 'blocked_no_verified_market_odds',
    targetWindow: window,
    sourcePolicy:
      '只把带 provider、captured_at、snapshot_hash，且胜平负、让球/亚盘水位、大小球水位完整的赛前盘口写入 odds_snapshots；体彩官方计算器和欧洲归档/API源为可信直连预测源，体彩 TTG 总进球数池转换为 2.5 球大小球等价赔率，懂球帝指数按同公司欧指+亚盘+大小球拼成完整快照，作为多公司指数补充和无直连源时的兜底。',
    sources,
    importSummary: {
      rowsImported,
      completeCandidates,
      trustedCompleteCandidates,
      secondaryCompleteCandidates,
      skippedRows,
      databaseSnapshotsAvailable,
      verifiedSnapshotsAvailable,
      trustedSnapshotsAvailable,
      secondarySnapshotsAvailable,
      sourceCount: sources.length,
      predictionRefresh
    },
    euroHandicapRecommendations,
    recommendationDiff,
    recommendationPolicy:
      marketAvailable
        ? '已存在完整赛前盘口；欧赔让球候选仅作为赛前观察清单，对应比赛仍需阵容、伤停、天气和新闻核验，不能作为单独投注建议。'
        : '未写入任何完整赛前盘口；不生成赛前推荐、价值分、串关或盘口标签。'
  };
  writeAudit(audit);
  recordImportRun(db, audit);
  return audit;
}
