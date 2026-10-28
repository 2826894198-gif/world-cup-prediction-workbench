import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const groups = Array.from({ length: 12 }, (_, index) =>
  String.fromCharCode('A'.charCodeAt(0) + index)
);

export const venues = [
  '纽约都会体育场',
  '洛杉矶索菲球场',
  '达拉斯AT&T球场',
  '墨西哥城阿兹特克',
  '多伦多BMO球场',
  '温哥华BC体育场',
  '迈阿密硬石球场',
  '西雅图流明球场',
  '亚特兰大奔驰球场',
  '休斯敦NRG球场',
  '堪萨斯箭头球场',
  '费城林肯金融球场'
];

export const sampleScheduleNotice =
  '已接入 FIFA 官方 2026 赛程结构；本地数据库只展示赛程审计，未接入官方赔率、阵容和新闻前不生成 2026 预测。';

const placeholderVenue = '非官方赛程占位，待 FIFA 官方结构化接入';
const officialScheduleStatus = 'official_schedule_prediction_blocked';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(dirname(__dirname));
const officialScheduleFile = join(rootDir, 'data', 'research', 'worldcup-2026', 'official-schedule.json');
const internationalEvaluationFile = join(rootDir, 'reports', 'international-model-evaluation.json');

function useOfficialSchedule(options = {}) {
  return options.mode !== 'sample';
}

const names = [
  '阿根廷',
  '法国',
  '巴西',
  '英格兰',
  '西班牙',
  '德国',
  '葡萄牙',
  '荷兰',
  '比利时',
  '意大利',
  '乌拉圭',
  '克罗地亚',
  '墨西哥',
  '美国',
  '加拿大',
  '日本',
  '韩国',
  '澳大利亚',
  '摩洛哥',
  '塞内加尔',
  '尼日利亚',
  '埃及',
  '喀麦隆',
  '加纳',
  '哥伦比亚',
  '厄瓜多尔',
  '智利',
  '秘鲁',
  '瑞士',
  '丹麦',
  '瑞典',
  '波兰',
  '奥地利',
  '土耳其',
  '塞尔维亚',
  '捷克',
  '沙特',
  '伊朗',
  '卡塔尔',
  '阿联酋',
  '乌兹别克斯坦',
  '中国',
  '南非',
  '突尼斯',
  '阿尔及利亚',
  '巴拿马',
  '哥斯达黎加',
  '牙买加'
];

const confederations = [
  'CONMEBOL',
  'UEFA',
  'CONMEBOL',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'CONMEBOL',
  'UEFA',
  'CONCACAF',
  'CONCACAF',
  'CONCACAF',
  'AFC',
  'AFC',
  'AFC',
  'CAF',
  'CAF',
  'CAF',
  'CAF',
  'CAF',
  'CAF',
  'CONMEBOL',
  'CONMEBOL',
  'CONMEBOL',
  'CONMEBOL',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'UEFA',
  'AFC',
  'AFC',
  'AFC',
  'AFC',
  'AFC',
  'AFC',
  'CAF',
  'CAF',
  'CAF',
  'CONCACAF',
  'CONCACAF',
  'CONCACAF'
];

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function round(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function plainText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeName(value) {
  return plainText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const officialTeamNamesZh = {
  ALG: '阿尔及利亚',
  ARG: '阿根廷',
  AUS: '澳大利亚',
  AUT: '奥地利',
  BEL: '比利时',
  BIH: '波黑',
  BRA: '巴西',
  CAN: '加拿大',
  CIV: '科特迪瓦',
  COD: '刚果民主共和国',
  COL: '哥伦比亚',
  CPV: '佛得角',
  CRO: '克罗地亚',
  CUW: '库拉索',
  CZE: '捷克',
  ECU: '厄瓜多尔',
  EGY: '埃及',
  ENG: '英格兰',
  ESP: '西班牙',
  FRA: '法国',
  GER: '德国',
  GHA: '加纳',
  HAI: '海地',
  IRN: '伊朗',
  IRQ: '伊拉克',
  JOR: '约旦',
  JPN: '日本',
  KOR: '韩国',
  KSA: '沙特',
  MAR: '摩洛哥',
  MEX: '墨西哥',
  NED: '荷兰',
  NOR: '挪威',
  NZL: '新西兰',
  PAN: '巴拿马',
  PAR: '巴拉圭',
  POR: '葡萄牙',
  QAT: '卡塔尔',
  RSA: '南非',
  SCO: '苏格兰',
  SEN: '塞内加尔',
  SUI: '瑞士',
  SWE: '瑞典',
  TUN: '突尼斯',
  TUR: '土耳其',
  URU: '乌拉圭',
  USA: '美国',
  UZB: '乌兹别克斯坦'
};

const officialTeamNamesEn = {
  ALG: 'Algeria',
  ARG: 'Argentina',
  AUS: 'Australia',
  AUT: 'Austria',
  BEL: 'Belgium',
  BIH: 'Bosnia and Herzegovina',
  BRA: 'Brazil',
  CAN: 'Canada',
  CIV: 'Ivory Coast',
  COD: 'DR Congo',
  COL: 'Colombia',
  CPV: 'Cape Verde',
  CRO: 'Croatia',
  CUW: 'Curaçao',
  CZE: 'Czech Republic',
  ECU: 'Ecuador',
  EGY: 'Egypt',
  ENG: 'England',
  ESP: 'Spain',
  FRA: 'France',
  GER: 'Germany',
  GHA: 'Ghana',
  HAI: 'Haiti',
  IRN: 'Iran',
  IRQ: 'Iraq',
  JOR: 'Jordan',
  JPN: 'Japan',
  KOR: 'South Korea',
  KSA: 'Saudi Arabia',
  MAR: 'Morocco',
  MEX: 'Mexico',
  NED: 'Netherlands',
  NOR: 'Norway',
  NZL: 'New Zealand',
  PAN: 'Panama',
  PAR: 'Paraguay',
  POR: 'Portugal',
  QAT: 'Qatar',
  RSA: 'South Africa',
  SCO: 'Scotland',
  SEN: 'Senegal',
  SUI: 'Switzerland',
  SWE: 'Sweden',
  TUN: 'Tunisia',
  TUR: 'Turkey',
  URU: 'Uruguay',
  USA: 'United States',
  UZB: 'Uzbekistan'
};

const officialConfederations = {
  ALG: 'CAF',
  ARG: 'CONMEBOL',
  AUS: 'AFC',
  AUT: 'UEFA',
  BEL: 'UEFA',
  BIH: 'UEFA',
  BRA: 'CONMEBOL',
  CAN: 'CONCACAF',
  CIV: 'CAF',
  COD: 'CAF',
  COL: 'CONMEBOL',
  CPV: 'CAF',
  CRO: 'UEFA',
  CUW: 'CONCACAF',
  CZE: 'UEFA',
  ECU: 'CONMEBOL',
  EGY: 'CAF',
  ENG: 'UEFA',
  ESP: 'UEFA',
  FRA: 'UEFA',
  GER: 'UEFA',
  GHA: 'CAF',
  HAI: 'CONCACAF',
  IRN: 'AFC',
  IRQ: 'AFC',
  JOR: 'AFC',
  JPN: 'AFC',
  KOR: 'AFC',
  KSA: 'AFC',
  MAR: 'CAF',
  MEX: 'CONCACAF',
  NED: 'UEFA',
  NOR: 'UEFA',
  NZL: 'OFC',
  PAN: 'CONCACAF',
  PAR: 'CONMEBOL',
  POR: 'UEFA',
  QAT: 'AFC',
  RSA: 'CAF',
  SCO: 'UEFA',
  SEN: 'CAF',
  SUI: 'UEFA',
  SWE: 'UEFA',
  TUN: 'CAF',
  TUR: 'UEFA',
  URU: 'CONMEBOL',
  USA: 'CONCACAF',
  UZB: 'AFC'
};

const officialStageMap = {
  group_stage: 'group',
  round_of_32: 'round32',
  round_of_16: 'round16',
  quarter_final: 'quarterfinal',
  semi_final: 'semifinal',
  third_place: 'third_place',
  final: 'final'
};

const officialRoundLabels = {
  group_stage: '小组赛',
  round_of_32: '32强淘汰赛',
  round_of_16: '16强淘汰赛',
  quarter_final: '1/4决赛',
  semi_final: '半决赛',
  third_place: '三四名决赛',
  final: '决赛'
};

function groupSortIndex(groupName) {
  const index = groups.indexOf(groupName);
  return index >= 0 ? index : groups.length;
}

function loadOfficialSchedule() {
  if (!existsSync(officialScheduleFile)) return null;
  const schedule = JSON.parse(readFileSync(officialScheduleFile, 'utf8'));
  if (schedule.status !== 'official_schedule_parsed') return null;
  if (schedule.match_count !== 104 || schedule.fixtures?.length !== 104) return null;
  return schedule;
}

function collectOfficialTeamEntries(schedule) {
  const byCode = new Map();
  for (const fixture of schedule.fixtures) {
    if (fixture.stage !== 'group_stage') continue;
    for (const side of ['home', 'away']) {
      const code = fixture[`${side}_code`];
      if (!code || byCode.has(code)) continue;
      byCode.set(code, {
        code,
        group_name: fixture.group_name,
        first_match_no: fixture.match_no
      });
    }
  }

  return [...byCode.values()].sort((a, b) => {
    const groupDiff = groupSortIndex(a.group_name) - groupSortIndex(b.group_name);
    if (groupDiff !== 0) return groupDiff;
    return a.first_match_no - b.first_match_no || a.code.localeCompare(b.code);
  });
}

function loadInternationalStrengths() {
  if (!existsSync(internationalEvaluationFile)) return new Map();
  try {
    const report = JSON.parse(readFileSync(internationalEvaluationFile, 'utf8'));
    const rows = report.current_team_strengths?.teams;
    if (!Array.isArray(rows)) return new Map();
    return new Map(rows.map((row) => [row.normalized_name ?? normalizeName(row.team), row]));
  } catch {
    return new Map();
  }
}

function strengthForCode(code, strengths) {
  const englishName = officialTeamNamesEn[code] ?? code;
  return strengths.get(normalizeName(englishName)) ?? null;
}

function buildOfficialTeams(schedule) {
  const strengths = loadInternationalStrengths();
  return collectOfficialTeamEntries(schedule).map((entry, index) => ({
    id: index + 1,
    code: entry.code,
    name_zh: officialTeamNamesZh[entry.code] ?? entry.code,
    confederation: officialConfederations[entry.code] ?? 'FIFA',
    group_name: entry.group_name,
    seed_rank: index + 1,
    elo: round(1600 + ((strengthForCode(entry.code, strengths)?.elo ?? 1500) - 1500) * 1.05, 1),
    glicko_mu: round(1500 + ((strengthForCode(entry.code, strengths)?.elo ?? 1500) - 1500) * 0.9, 1),
    glicko_phi: round(clamp(132 - Math.min(strengthForCode(entry.code, strengths)?.matches ?? 0, 80) * 0.55, 76, 132), 1),
    attack: round(strengthForCode(entry.code, strengths)?.attack ?? 1),
    defense: round(strengthForCode(entry.code, strengths)?.defense ?? 1),
    form: round(strengthForCode(entry.code, strengths)?.form ?? 0.5)
  }));
}

function officialRoundLabel(fixture) {
  if (fixture.stage === 'group_stage') return `${fixture.group_name}组小组赛`;
  return officialRoundLabels[fixture.stage] ?? fixture.round_label ?? fixture.stage;
}

function buildOfficialMatches(schedule, teams) {
  const teamByCode = new Map(teams.map((team) => [team.code, team]));
  return [...schedule.fixtures]
    .sort((a, b) => a.match_no - b.match_no)
    .map((fixture, index) => ({
      id: index + 1,
      match_no: fixture.match_no,
      stage: officialStageMap[fixture.stage] ?? fixture.stage,
      group_name: fixture.group_name ?? null,
      round_label: officialRoundLabel(fixture),
      kickoff_utc: fixture.kickoff_utc,
      venue: fixture.venue,
      home_team_id: fixture.home_code ? (teamByCode.get(fixture.home_code)?.id ?? null) : null,
      away_team_id: fixture.away_code ? (teamByCode.get(fixture.away_code)?.id ?? null) : null,
      home_placeholder: fixture.home_code ? null : (fixture.home_placeholder ?? null),
      away_placeholder: fixture.away_code ? null : (fixture.away_placeholder ?? null),
      status: officialScheduleStatus
    }));
}

export function buildTeams(options = {}) {
  const officialSchedule = useOfficialSchedule(options) ? loadOfficialSchedule() : null;
  if (officialSchedule) return buildOfficialTeams(officialSchedule);

  const random = seededRandom(20260611);
  return names.map((name, index) => {
    const groupIndex = Math.floor(index / 4);
    const seedRank = index + 1;
    const eliteLift = Math.max(0, 22 - seedRank) * 13;
    const elo = 1515 + eliteLift + (random() - 0.5) * 80;
    const attack = 0.82 + (elo - 1500) / 680 + (random() - 0.5) * 0.16;
    const defense = 0.88 + (elo - 1500) / 760 + (random() - 0.5) * 0.14;
    return {
      id: index + 1,
      code: `T${String(index + 1).padStart(2, '0')}`,
      name_zh: name,
      confederation: confederations[index],
      group_name: groups[groupIndex],
      seed_rank: seedRank,
      elo: round(elo, 1),
      glicko_mu: round(1500 + (elo - 1500) * 0.9, 1),
      glicko_phi: round(78 + random() * 55, 1),
      attack: round(attack),
      defense: round(defense),
      form: round(0.48 + random() * 0.22)
    };
  });
}

const groupPairings = [
  [0, 1],
  [2, 3],
  [0, 2],
  [1, 3],
  [0, 3],
  [1, 2]
];

function kickoff(baseDate, matchIndex) {
  const date = new Date(baseDate.getTime() + matchIndex * 3.5 * 60 * 60 * 1000);
  return date.toISOString();
}

export function buildMatches(teams, options = {}) {
  const officialSchedule = useOfficialSchedule(options) ? loadOfficialSchedule() : null;
  if (officialSchedule) return buildOfficialMatches(officialSchedule, teams);

  const matches = [];
  const baseDate = new Date('2026-06-11T19:00:00.000Z');
  let matchNo = 1;

  for (const groupName of groups) {
    const groupTeams = teams.filter((team) => team.group_name === groupName);
    for (const [homeIndex, awayIndex] of groupPairings) {
      matches.push({
        id: matchNo,
        match_no: matchNo,
        stage: 'group',
        group_name: groupName,
        round_label: `${groupName}组小组赛`,
        kickoff_utc: kickoff(baseDate, matchNo - 1),
        venue: placeholderVenue,
        home_team_id: groupTeams[homeIndex].id,
        away_team_id: groupTeams[awayIndex].id,
        home_placeholder: null,
        away_placeholder: null,
        status: 'sample_placeholder'
      });
      matchNo += 1;
    }
  }

  const thirdSlots = Array.from({ length: 8 }, (_, index) => `最佳第三${index + 1}`);
  const roundOf32Home = groups.flatMap((groupName) => [`${groupName}组第1`, `${groupName}组第2`]).slice(0, 16);
  const roundOf32Away = [...groups.map((groupName) => `${groupName}组第2`), ...thirdSlots].slice(0, 16);

  for (let index = 0; index < 16; index += 1) {
    matches.push({
      id: matchNo,
      match_no: matchNo,
      stage: 'round32',
      group_name: null,
      round_label: '32强淘汰赛',
      kickoff_utc: kickoff(baseDate, matchNo - 1),
      venue: placeholderVenue,
      home_team_id: null,
      away_team_id: null,
      home_placeholder: roundOf32Home[index],
      away_placeholder: roundOf32Away[15 - index],
      status: 'sample_placeholder'
    });
    matchNo += 1;
  }

  const knockoutRounds = [
    ['round16', '16强淘汰赛', 8],
    ['quarterfinal', '1/4决赛', 4],
    ['semifinal', '半决赛', 2]
  ];

  let previousStart = 73;
  let previousCount = 16;
  for (const [stage, roundLabel, count] of knockoutRounds) {
    for (let index = 0; index < count; index += 1) {
      const left = previousStart + index * 2;
      const right = Math.min(previousStart + index * 2 + 1, previousStart + previousCount - 1);
      matches.push({
        id: matchNo,
        match_no: matchNo,
        stage,
        group_name: null,
        round_label: roundLabel,
        kickoff_utc: kickoff(baseDate, matchNo - 1),
        venue: placeholderVenue,
        home_team_id: null,
        away_team_id: null,
        home_placeholder: `${left}胜者`,
        away_placeholder: `${right}胜者`,
        status: 'sample_placeholder'
      });
      matchNo += 1;
    }
    previousStart = matchNo - count;
    previousCount = count;
  }

  const semifinalLeft = previousStart;
  const semifinalRight = Math.min(previousStart + 1, previousStart + previousCount - 1);
  const medalMatches = [
    ['third_place', '三四名决赛', `${semifinalLeft}负者`, `${semifinalRight}负者`],
    ['final', '决赛', `${semifinalLeft}胜者`, `${semifinalRight}胜者`]
  ];

  for (const [stage, roundLabel, homePlaceholder, awayPlaceholder] of medalMatches) {
    matches.push({
      id: matchNo,
      match_no: matchNo,
      stage,
      group_name: null,
      round_label: roundLabel,
      kickoff_utc: kickoff(baseDate, matchNo - 1),
      venue: placeholderVenue,
      home_team_id: null,
      away_team_id: null,
      home_placeholder: homePlaceholder,
      away_placeholder: awayPlaceholder,
      status: 'sample_placeholder'
    });
    matchNo += 1;
  }

  return matches;
}

export const tagRules = [
  ['floor', '楼层', '盘口结构', '强队处于高热楼层且主胜赔率持续压低', '提高热度风险', 0.08, 0.56, '需要结合水位回补判断'],
  ['line_band', '盘口区间', '盘口结构', '亚盘处于 0.25/0.5/0.75 敏感区间', '提示盘口临界', 0.06, 0.58, '适合复盘盘口临界值'],
  ['max_push', '极度拉满', '水位走势', '热门方向水位连续下探且赔率结构同步收窄', '提高回撤风险', 0.11, 0.53, '容易出现热度过载'],
  ['hard_pullback', '极度回盘', '水位走势', '早盘深开后临场明显回撤', '降低热门信心', 0.12, 0.57, '复盘区分真实伤停和市场保护'],
  ['stuck_band', '卡区间', '盘口结构', '盘口长时间停留在临界线附近', '增加不确定性', 0.07, 0.55, '常见于平局或一球小胜结构'],
  ['yaodao', '妖刀', '异常走势', '赔率方向和亚盘水位方向出现矛盾', '提高异常风险', 0.13, 0.51, '只做风险标签，不直接反向'],
  ['wdl_shape', '胜平负结构', '欧赔结构', '胜平负概率曲线出现明显不对称', '提示赛果倾向', 0.05, 0.61, '需要和进球模型交叉'],
  ['balanced_shape', '中庸结构', '欧赔结构', '三项赔率接近且市场没有强方向', '降低串关价值', 0.05, 0.54, '更适合观察临场'],
  ['small_flow', '小顺结构', '走势结构', '热门方向小幅顺势但未过热', '轻微提高信心', 0.06, 0.62, '命中率较稳定但收益有限'],
  ['big_flow', '大顺结构', '走势结构', '赔率、水位、盘口同向大幅顺势', '提高波动风险', 0.1, 0.52, '需防范诱导性顺势'],
  ['hot_rebate', '热赛返走势', '热度结构', '热门赛事临场返还率异常抬升', '提高赛果冷门风险', 0.11, 0.5, '需区分赛果冷门和盘口冷门']
].map(([code, name, category, trigger_condition, impact_direction, impact_strength, historical_hit_rate, review_summary]) => ({
  code,
  name,
  category,
  trigger_condition,
  impact_direction,
  impact_strength,
  historical_hit_rate,
  review_summary
}));

export const modelVersion = {
  code: 'official-schedule-gate-v0.2',
  name: '官方赛程审计闸门 v0.2',
  created_at: '2026-06-08T04:00:00.000Z',
  weights_json: {
    official_schedule: 1,
    strength: 0,
    goal_model: 0,
    market: 0,
    factors: 0,
    calibration: 0
  },
  calibration_json: {
    method: 'prediction_blocked_until_verified_inputs',
    required_inputs: ['official_fixture', 'market_odds', 'squad_news', 'pre_match_form'],
    future_fixture_source: 'FIFA official 2026 schedule PDF'
  },
  accuracy_json: {
    source: 'prediction_blocked',
    sample_size: 0,
    reason: '2026 官方赛程已结构化，但未接入官方赔率、阵容新闻和赛前状态输入；因此不生成 2026 概率、盘口或合成赛果。'
  },
  notes: '只负责把 FIFA 官方 2026 赛程写入本地审计链路；在赔率、阵容新闻和赛前输入接入前，阻断 2026 预测输出。'
};

export const sampleModelVersion = {
  code: 'sample-hybrid-loop-v1.0',
  name: '样例混合预测闭环 v1.0',
  created_at: '2026-06-11T00:00:00.000Z',
  weights_json: {
    strength: 0.34,
    goal_model: 0.28,
    market: 0.26,
    factors: 0.08,
    calibration: 0.04
  },
  calibration_json: {
    method: 'synthetic_walkthrough_calibration',
    draw_floor: 0.18,
    draw_ceiling: 0.34,
    score_matrix: 'poisson_dixon_coles',
    market_source: 'sample_sandbox_snapshot'
  },
  accuracy_json: {
    source: 'synthetic_sample_results',
    sample_size: 0,
    reason: '初始化后由本地样例赛果刷新准确率；只用于第一阶段闭环演示，不代表真实 2026 世界杯预测。'
  },
  notes:
    '第一阶段样例闭环模型：Elo/Glicko、Poisson/Dixon-Coles、样例盘口、经验标签和校准层全部启用，用于本地 104 场全流程演示。'
};
