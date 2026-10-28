#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, round } from '../server/model/math.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const REPORT_DIR = path.join(ROOT_DIR, 'reports');

const DEFAULT_DATE = '2026-06-09';
const DEFAULT_HOME = '中国';
const DEFAULT_AWAY = '泰国';
const BASE_URL = 'https://www.dongqiudi.com';

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function parseNumber(value) {
  if (value == null || value === '' || value === '-') return null;
  const number = Number(String(value).replace(/[+,]/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
}

function oddsProbabilities(pool) {
  const values = [pool?.homeWin, pool?.draw, pool?.awayWin].map(parseNumber);
  if (values.some((value) => value == null || value <= 1)) return null;
  const [home, draw, away] = normalize(values.map((value) => 1 / value));
  return { home: round(home), draw: round(draw), away: round(away) };
}

function previousDayStart(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d} 16:00:00`;
}

function splitTriplet(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((part) => part.trim());
}

function parseInlineOdds(scoreOdds) {
  const parseSet = (rows) => {
    if (!Array.isArray(rows) || rows.length < 3) return null;
    const [asiaHome, asiaLine, asiaAway] = splitTriplet(rows[0]);
    const [euroHome, euroDraw, euroAway] = splitTriplet(rows[1]);
    const [sizeOver, sizeLine, sizeUnder] = splitTriplet(rows[2]);
    return {
      asia: {
        homeWater: parseNumber(asiaHome),
        line: parseNumber(asiaLine),
        awayWater: parseNumber(asiaAway)
      },
      euro: {
        homeWin: parseNumber(euroHome),
        draw: parseNumber(euroDraw),
        awayWin: parseNumber(euroAway)
      },
      size: {
        overWater: parseNumber(sizeOver),
        line: parseNumber(sizeLine),
        underWater: parseNumber(sizeUnder)
      }
    };
  };

  return {
    origin: parseSet(scoreOdds?.origin),
    spot: parseSet(scoreOdds?.spot),
    instant: parseSet(scoreOdds?.instant)
  };
}

function compactOddsRows(rows) {
  return (rows ?? []).map((row) => ({
    name: row.name,
    area: row.area,
    cid: row.cid,
    fixedOdds: row.fixed_odds,
    begin: row.begin,
    now: row.now
  }));
}

function findRows(rows, matcher) {
  return compactOddsRows((rows ?? []).filter(matcher));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://www.dongqiudi.com/match',
      'user-agent': 'WorldCupPredictionWorkbench/0.1 dongqiudi-odds-scraper'
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}\n${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON parse failed for ${url}: ${error.message}\n${text.slice(0, 240)}`);
  }
}

async function fetchImportantRows(dateText) {
  const start = previousDayStart(dateText);
  const params = new URLSearchParams({
    start,
    init: '1',
    platform: 'www',
    version: '576',
    _t: String(Math.floor(Date.now() / 30_000))
  });
  const url = `${BASE_URL}/api/data/tab/new/important?${params.toString()}`;
  const json = await fetchJson(url);
  return { url, start, rows: json.list ?? [], raw: json };
}

async function fetchScheduleRows(dateText) {
  const start = previousDayStart(dateText);
  const params = new URLSearchParams({
    language: 'zh-CN',
    tab_type: 'schedule',
    cmp_type: 'soccer',
    start
  });
  const url = `${BASE_URL}/magicball/v1/list/schedule_list?${params.toString()}`;
  const json = await fetchJson(url);
  return { url, start, rows: json.data?.matches ?? [], raw: json };
}

async function fetchOddsIndex(matchId) {
  const params = new URLSearchParams({
    cmp_type: 'soccer',
    app: 'dqd',
    lang: 'zh-cn',
    platform: 'ios'
  });
  const url = `${BASE_URL}/sport-data/soccer/biz/dqd/v1/match/odds/index/${matchId}?${params.toString()}`;
  const json = await fetchJson(url);
  return { url, raw: json };
}

function matchImportantRow(rows, home, away) {
  const normalizedHome = normalizeName(home);
  const normalizedAway = normalizeName(away);
  return rows.find((row) => {
    const left = normalizeName(row.team_A_name);
    const right = normalizeName(row.team_B_name);
    return left === normalizedHome && right === normalizedAway;
  });
}

function matchScheduleRow(rows, matchId, home, away) {
  const normalizedHome = normalizeName(home);
  const normalizedAway = normalizeName(away);
  return rows.find((row) => String(row.match_id) === String(matchId)) ??
    rows.find((row) => {
      const left = normalizeName(row.team_A?.name);
      const right = normalizeName(row.team_B?.name);
      return left === normalizedHome && right === normalizedAway;
    });
}

function summarize(report) {
  const avgBegin = report.oddsIndex.average?.begin ?? null;
  const avgNow = report.oddsIndex.average?.now ?? null;
  return {
    euroCompanies: report.oddsIndex.counts.euro,
    asiaCompanies: report.oddsIndex.counts.asia,
    sizeCompanies: report.oddsIndex.counts.size,
    averageBegin: avgBegin,
    averageNow: avgNow,
    averageBeginProbabilities: oddsProbabilities(avgBegin),
    averageNowProbabilities: oddsProbabilities(avgNow),
    inlineSpot: report.scheduleInlineOdds?.spot ?? null,
    inlineOrigin: report.scheduleInlineOdds?.origin ?? null,
    inlineInstant: report.scheduleInlineOdds?.instant ?? null,
    officialSporttery: report.oddsIndex.sportteryOfficial[0] ?? null,
    sportteryHandicap: report.oddsIndex.sportteryHandicap[0] ?? null,
    macauEuro: report.oddsIndex.macauEuro[0] ?? null,
    macauAsia: report.oddsIndex.macauAsia[0] ?? null,
    macauSize: report.oddsIndex.macauSize[0] ?? null,
    hongKongEuro: report.oddsIndex.hongKongEuro[0] ?? null,
    hongKongAsia: report.oddsIndex.hongKongAsia[0] ?? null,
    hongKongSize: report.oddsIndex.hongKongSize[0] ?? null
  };
}

function renderMarkdown(report) {
  const summary = report.summary;
  const row = report.match;
  const inline = summary.inlineSpot;
  const avgNow = summary.averageNow;
  const avgBegin = summary.averageBegin;
  const sporttery = summary.officialSporttery;
  const sportteryH = summary.sportteryHandicap;
  const macauEuro = summary.macauEuro;
  const macauAsia = summary.macauAsia;
  const macauSize = summary.macauSize;
  const hongKongEuro = summary.hongKongEuro;
  const hongKongAsia = summary.hongKongAsia;
  const hongKongSize = summary.hongKongSize;
  const probabilityText = summary.averageNowProbabilities
    ? `主 ${pct(summary.averageNowProbabilities.home)} / 平 ${pct(summary.averageNowProbabilities.draw)} / 客 ${pct(summary.averageNowProbabilities.away)}`
    : '--';

  return [
    '# 懂球帝盘口抓取',
    '',
    `生成时间: ${report.generatedAt}`,
    `比赛: ${row.home} vs ${row.away}`,
    `Match ID: ${row.matchId}`,
    `开球: ${row.startPlay}`,
    `赛果: ${row.score}`,
    '',
    '## 来源',
    '',
    `- 懂球帝赛程: ${report.sources.importantUrl}`,
    `- 懂球帝赛程盘口快照: ${report.sources.scheduleUrl}`,
    `- 懂球帝指数接口: ${report.sources.oddsIndexUrl}`,
    `- 懂球帝比赛页: https://www.dongqiudi.com/match/${row.matchId}`,
    '',
    '## 抓取结果',
    '',
    `- 欧指公司数: ${summary.euroCompanies}`,
    `- 亚盘公司数: ${summary.asiaCompanies}`,
    `- 大小球公司数: ${summary.sizeCompanies}`,
    `- 平均欧指初盘: ${avgBegin?.homeWin ?? '--'} / ${avgBegin?.draw ?? '--'} / ${avgBegin?.awayWin ?? '--'}`,
    `- 平均欧指即时: ${avgNow?.homeWin ?? '--'} / ${avgNow?.draw ?? '--'} / ${avgNow?.awayWin ?? '--'}，归一化概率 ${probabilityText}`,
    `- 赛程内嵌现盘欧指: ${inline?.euro?.homeWin ?? '--'} / ${inline?.euro?.draw ?? '--'} / ${inline?.euro?.awayWin ?? '--'}`,
    `- 赛程内嵌现盘亚盘: ${inline?.asia?.homeWater ?? '--'} / ${inline?.asia?.line ?? '--'} / ${inline?.asia?.awayWater ?? '--'}`,
    `- 赛程内嵌现盘大小球: ${inline?.size?.overWater ?? '--'} / ${inline?.size?.line ?? '--'} / ${inline?.size?.underWater ?? '--'}`,
    '',
    '## 重点行',
    '',
    `- 竞彩官方: 初 ${sporttery?.begin?.homeWin ?? '--'} / ${sporttery?.begin?.draw ?? '--'} / ${sporttery?.begin?.awayWin ?? '--'} -> 即 ${sporttery?.now?.homeWin ?? '--'} / ${sporttery?.now?.draw ?? '--'} / ${sporttery?.now?.awayWin ?? '--'}`,
    `- 竞彩让球: 初 ${sportteryH?.begin?.homeWin ?? '--'} / ${sportteryH?.begin?.draw ?? '--'} / ${sportteryH?.begin?.awayWin ?? '--'} -> 即 ${sportteryH?.now?.homeWin ?? '--'} / ${sportteryH?.now?.draw ?? '--'} / ${sportteryH?.now?.awayWin ?? '--'}，让球 ${sportteryH?.fixedOdds ?? '--'}`,
    `- 澳门欧指: 初 ${macauEuro?.begin?.homeWin ?? '--'} / ${macauEuro?.begin?.draw ?? '--'} / ${macauEuro?.begin?.awayWin ?? '--'} -> 即 ${macauEuro?.now?.homeWin ?? '--'} / ${macauEuro?.now?.draw ?? '--'} / ${macauEuro?.now?.awayWin ?? '--'}`,
    `- 澳门亚盘: 初 ${macauAsia?.begin?.homeWin ?? '--'} / ${macauAsia?.begin?.draw ?? '--'} / ${macauAsia?.begin?.awayWin ?? '--'} -> 即 ${macauAsia?.now?.homeWin ?? '--'} / ${macauAsia?.now?.draw ?? '--'} / ${macauAsia?.now?.awayWin ?? '--'}`,
    `- 澳门大小球: 初 ${macauSize?.begin?.homeWin ?? '--'} / ${macauSize?.begin?.draw ?? '--'} / ${macauSize?.begin?.awayWin ?? '--'} -> 即 ${macauSize?.now?.homeWin ?? '--'} / ${macauSize?.now?.draw ?? '--'} / ${macauSize?.now?.awayWin ?? '--'}`,
    `- 香港欧指: 初 ${hongKongEuro?.begin?.homeWin ?? '--'} / ${hongKongEuro?.begin?.draw ?? '--'} / ${hongKongEuro?.begin?.awayWin ?? '--'} -> 即 ${hongKongEuro?.now?.homeWin ?? '--'} / ${hongKongEuro?.now?.draw ?? '--'} / ${hongKongEuro?.now?.awayWin ?? '--'}`,
    `- 香港亚盘/大小球: ${hongKongAsia || hongKongSize ? '有抓到行，见 JSON 明细' : '本场未抓到香港来源行'}`,
    '',
    '## 备注',
    '',
    '这份报告只记录抓到的公开页面/API数据，不自动写入正式盘口模型。正式入库仍需独立确认来源稳定性、字段方向和抓取合规性。'
  ].join('\n');
}

async function main() {
  const date = argValue('date', DEFAULT_DATE);
  const home = argValue('home', DEFAULT_HOME);
  const away = argValue('away', DEFAULT_AWAY);
  const forcedMatchId = argValue('match-id');

  const important = await fetchImportantRows(date);
  const importantRow = forcedMatchId
    ? important.rows.find((row) => String(row.match_id) === String(forcedMatchId))
    : matchImportantRow(important.rows, home, away);
  if (!importantRow) {
    throw new Error(`未在懂球帝重要赛程中找到 ${date} ${home} vs ${away}`);
  }

  const schedule = await fetchScheduleRows(date);
  const scheduleRow = matchScheduleRow(schedule.rows, importantRow.match_id, home, away);
  if (!scheduleRow) {
    throw new Error(`未在懂球帝赛程盘口快照中找到 match_id=${importantRow.match_id}`);
  }

  const oddsIndex = await fetchOddsIndex(importantRow.match_id);
  const oddsRaw = oddsIndex.raw;
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    date,
    match: {
      matchId: String(importantRow.match_id),
      home: importantRow.team_A_name,
      away: importantRow.team_B_name,
      competition: importantRow.competition_name,
      startPlay: importantRow.start_play,
      status: importantRow.status,
      score: `${importantRow.fs_A}-${importantRow.fs_B}`,
      halfTimeScore: `${importantRow.hts_A}-${importantRow.hts_B}`,
      sporttery: scheduleRow.sporttery_str ?? importantRow.zc_issue_num ?? ''
    },
    sources: {
      importantUrl: important.url,
      scheduleUrl: schedule.url,
      oddsIndexUrl: oddsIndex.url,
      matchPageUrl: `${BASE_URL}/match/${importantRow.match_id}`
    },
    scheduleInlineOdds: parseInlineOdds(scheduleRow.score_odds),
    oddsIndex: {
      hasOdds: Boolean(oddsRaw.has_odds),
      isSpecial: Boolean(oddsRaw.is_spe),
      counts: {
        euro: oddsRaw.euro?.length ?? 0,
        asia: oddsRaw.asia?.length ?? 0,
        size: oddsRaw.size?.length ?? 0
      },
      average: oddsRaw.avg ?? null,
      max: oddsRaw.max ?? null,
      min: oddsRaw.min ?? null,
      sportteryOfficial: findRows(oddsRaw.euro, (row) => row.name === '竞彩官方'),
      sportteryHandicap: findRows(oddsRaw.euro, (row) => row.name === '竞彩让球'),
      beidan: findRows(oddsRaw.euro, (row) => row.name === '北单SP'),
      macauEuro: findRows(oddsRaw.euro, (row) => row.area === '澳门' || String(row.name).startsWith('澳')),
      macauAsia: findRows(oddsRaw.asia, (row) => row.area === '澳门' || String(row.name).startsWith('澳')),
      macauSize: findRows(oddsRaw.size, (row) => row.area === '澳门' || String(row.name).startsWith('澳')),
      hongKongEuro: findRows(oddsRaw.euro, (row) => row.area === '香港' || String(row.name).includes('香港')),
      hongKongAsia: findRows(oddsRaw.asia, (row) => row.area === '香港' || String(row.name).includes('香港')),
      hongKongSize: findRows(oddsRaw.size, (row) => row.area === '香港' || String(row.name).includes('香港')),
      euro: compactOddsRows(oddsRaw.euro),
      asia: compactOddsRows(oddsRaw.asia),
      size: compactOddsRows(oddsRaw.size)
    }
  };
  report.summary = summarize(report);

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const slug = `${report.match.matchId}-${date}`;
  const jsonPath = path.join(REPORT_DIR, `dongqiudi-odds-${slug}.json`);
  const mdPath = path.join(REPORT_DIR, `dongqiudi-odds-${slug}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, `${renderMarkdown(report)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        match: report.match,
        summary: report.summary,
        files: {
          json: path.relative(ROOT_DIR, jsonPath),
          markdown: path.relative(ROOT_DIR, mdPath)
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
