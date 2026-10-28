#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

import { applySchema, openDatabase } from '../server/db/connection.mjs';
import { ODDS_AUDIT_FILE } from '../server/services/oddsRefresh.mjs';

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(existsSync(ODDS_AUDIT_FILE), `缺少盘口源审计文件: ${ODDS_AUDIT_FILE}`);

let audit = null;
let rawAudit = '';
if (existsSync(ODDS_AUDIT_FILE)) {
  rawAudit = readFileSync(ODDS_AUDIT_FILE, 'utf8');
  try {
    audit = JSON.parse(rawAudit);
  } catch (error) {
    failures.push(`盘口源审计 JSON 无法解析: ${error.message}`);
  }
}

if (audit) {
  const sources = Array.isArray(audit.sources) ? audit.sources : [];
  const importedRows = Number(audit.importSummary?.rowsImported ?? 0);
  const completeCandidates = Number(audit.importSummary?.completeCandidates ?? 0);
  const databaseSnapshotsAvailable = Number(audit.importSummary?.databaseSnapshotsAvailable ?? 0);
  const verifiedSnapshotsAvailable = Number(audit.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const secret = process.env.ODDS_API_KEY;
  const providerNames = sources.map((source) => source.provider).join(' | ');

  check(typeof audit.status === 'string' && audit.status.length > 0, '审计状态缺失');
  check(typeof audit.generatedAt === 'string' && audit.generatedAt.length > 0, '审计生成时间缺失');
  check(typeof audit.sourcePolicy === 'string' && audit.sourcePolicy.length > 0, '盘口源写入策略缺失');
  check(typeof audit.recommendationPolicy === 'string' && audit.recommendationPolicy.length > 0, '推荐阻断策略缺失');
  check(sources.length >= 7, '盘口源审计至少需要 Sporttery、懂球帝、HKJC、澳门、欧洲公开页、OddsLab、The Odds API');
  check(providerNames.includes('Sporttery'), '盘口源审计缺少 Sporttery 体彩');
  check(providerNames.includes('Dongqiudi'), '盘口源审计缺少 Dongqiudi 懂球帝');
  check(providerNames.includes('HKJC'), '盘口源审计缺少 HKJC');
  check(providerNames.includes('Macau Slot'), '盘口源审计缺少澳门彩票');
  check(providerNames.includes('European public bookmaker pages'), '盘口源审计缺少欧洲公开 bookmaker 页面探测');
  check(providerNames.includes('OddsLab'), '盘口源审计缺少 OddsLab 公开盘口快照源');
  check(providerNames.includes('The Odds API'), '盘口源审计缺少 The Odds API');
  check(Number.isFinite(importedRows) && importedRows >= 0, '入库行数必须是非负数');
  check(Number.isFinite(completeCandidates) && completeCandidates >= importedRows, '完整候选数不能小于入库行数');
  check(
    Number.isFinite(databaseSnapshotsAvailable) && databaseSnapshotsAvailable >= importedRows,
    '数据库盘口快照总数必须不少于本次入库行数'
  );
  check(
    Number.isFinite(verifiedSnapshotsAvailable) && verifiedSnapshotsAvailable >= 0,
    '可信盘口快照总数必须是非负数'
  );
  check(!/apiKey=(?!\*\*\*)[^&"\s]+/i.test(rawAudit), '审计文件中不能写出明文 apiKey 参数');
  if (secret) check(!rawAudit.includes(secret), '审计文件中不能泄露 ODDS_API_KEY');
  check(
    audit.euroHandicapRecommendations && typeof audit.euroHandicapRecommendations.status === 'string',
    '缺少欧赔让球候选审计'
  );
  check(
    Array.isArray(audit.euroHandicapRecommendations?.rows),
    '欧赔让球候选 rows 必须是数组'
  );

  for (const source of sources) {
    check(typeof source.provider === 'string' && source.provider.length > 0, '盘口源缺少 provider');
    check(typeof source.status === 'string' && source.status.length > 0, `${source.provider ?? '未知源'} 缺少状态`);
    check(typeof source.sourceType === 'string' && source.sourceType.length > 0, `${source.provider ?? '未知源'} 缺少 sourceType`);
    check(typeof source.url === 'string' && source.url.length > 0, `${source.provider ?? '未知源'} 缺少 URL`);
    for (const key of ['rowsSeen', 'candidateRows', 'completeCandidates', 'importedRows']) {
      check(Number.isFinite(Number(source[key])) && Number(source[key]) >= 0, `${source.provider ?? '未知源'} 的 ${key} 非法`);
    }
    if (['official_site_waf_probe', 'public_page_probe'].includes(source.sourceType)) {
      check(Number(source.importedRows) === 0, `${source.provider} 是审计探测源，不能直接写入盘口快照`);
    }
  }

  if (audit.status === 'blocked_no_verified_market_odds') {
    check(importedRows === 0, '阻断状态下不能写入新的盘口快照');
    check(verifiedSnapshotsAvailable === 0, '阻断状态下不能已有可用盘口快照');
  }

  if (audit.status === 'complete_market_odds_imported') {
    check(verifiedSnapshotsAvailable > 0, '完整盘口状态下数据库必须已有可用盘口快照');
    check(/阵容|伤停|新闻|核验/.test(audit.recommendationPolicy), '推荐策略必须保留阵容、伤停或新闻核验约束');
  }
}

const db = openDatabase();
applySchema(db);
try {
  const oddsCount = db.prepare('SELECT COUNT(*) AS count FROM odds_snapshots').get().count;
  const predictionsCount = db.prepare('SELECT COUNT(*) AS count FROM predictions').get().count;
  if (audit?.importSummary?.rowsImported > 0) {
    check(oddsCount >= audit.importSummary.rowsImported, '数据库盘口快照少于本次审计入库行数');
    check(predictionsCount > 0, '有完整盘口入库后应刷新预测输出');
  }
  if (audit?.status === 'complete_market_odds_imported') {
    check(oddsCount > 0, '完整盘口状态下 odds_snapshots 不能为空');
    check(predictionsCount > 0, '完整盘口状态下应刷新预测输出');
  }

  if (failures.length) {
    console.error(JSON.stringify({ ok: false, failures, oddsCount, predictionsCount }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: audit?.status,
          sources: audit?.sources?.map((source) => ({
            provider: source.provider,
            status: source.status,
            completeCandidates: source.completeCandidates,
            importedRows: source.importedRows
          })),
          oddsCount,
          databaseSnapshotsAvailable: audit?.importSummary?.databaseSnapshotsAvailable ?? null,
          verifiedSnapshotsAvailable: audit?.importSummary?.verifiedSnapshotsAvailable ?? null,
          predictionsCount
        },
        null,
        2
      )
    );
  }
} finally {
  db.close();
}
