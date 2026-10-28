import { pathToFileURL } from 'node:url';

import { officialResults } from '../data/officialResults.mjs';
import { applySchema, openDatabase } from './connection.mjs';

function resultLabel(homeScore, awayScore) {
  if (homeScore > awayScore) return '主胜';
  if (homeScore < awayScore) return '客胜';
  return '平局';
}

function isSampleSandbox(db) {
  const totalMatches = db.prepare('SELECT COUNT(*) AS count FROM matches').get().count;
  if (totalMatches === 0) return false;
  const sampleMatches = db
    .prepare("SELECT COUNT(*) AS count FROM matches WHERE status = 'sample_placeholder'")
    .get().count;
  return sampleMatches === totalMatches;
}

function latestOddsForMatch(db, matchId) {
  return db
    .prepare(
      `SELECT *
       FROM odds_snapshots
       WHERE match_id = ?
       ORDER BY datetime(captured_at) DESC, id DESC
       LIMIT 1`
    )
    .get(matchId);
}

function marketSettlement(result, latestOdds) {
  if (!latestOdds) {
    return {
      handicapResult: '盘口待结算',
      totalResult: '大小球待结算',
      upsetType: '官方赛果'
    };
  }

  const margin = result.homeScore - result.awayScore;
  const handicapMargin = margin + Number(latestOdds.asian_line ?? 0);
  const handicapResult =
    Math.abs(handicapMargin) < 0.001 ? '走水' : handicapMargin > 0 ? '主队赢盘' : '主队输盘';
  const totalMargin = result.homeScore + result.awayScore - Number(latestOdds.total_line ?? 0);
  const totalResult = Math.abs(totalMargin) < 0.001 ? '走水' : totalMargin > 0 ? '大球' : '小球';
  const marketFavorite = Number(latestOdds.home_odds) <= Number(latestOdds.away_odds) ? '主胜' : '客胜';
  const favoriteCovered =
    marketFavorite === '主胜' ? handicapResult === '主队赢盘' : handicapResult === '主队输盘';
  const upsetType =
    result.result1x2 !== '平局' && result.result1x2 !== marketFavorite
      ? '赛果冷门'
      : !favoriteCovered
        ? '盘口冷门'
        : '常规结果';

  return { handicapResult, totalResult, upsetType };
}

function normalizeResult(entry) {
  const homeScore = Number(entry.homeScore);
  const awayScore = Number(entry.awayScore);
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    throw new Error(`Invalid official result score for match ${entry.matchNo}`);
  }
  return {
    ...entry,
    matchNo: Number(entry.matchNo),
    homeScore,
    awayScore,
    result1x2: entry.result1x2 ?? resultLabel(homeScore, awayScore),
    settledAt: entry.settledAt ?? new Date().toISOString()
  };
}

function sourceNote(entry) {
  const urls = Array.isArray(entry.sourceUrls) ? entry.sourceUrls.filter(Boolean) : [];
  const source = entry.source ? `来源：${entry.source}` : '来源：官方赛果手动录入';
  const links = urls.length ? `；链接：${urls.join(' | ')}` : '';
  return `${entry.note ?? ''}${entry.note ? '；' : ''}${source}${links}`;
}

export function applyOfficialResults(db = openDatabase(), results = officialResults) {
  applySchema(db);
  const startedAt = new Date().toISOString();
  const entries = results.map(normalizeResult);
  const snapshotKey = `official-results-2026-${entries.map((entry) => `m${entry.matchNo}`).join('-') || 'empty'}-v1`;

  if (entries.length === 0) {
    return {
      applied: 0,
      missing: [],
      skipped: false,
      snapshot_key: snapshotKey,
      note: '没有待导入官方赛果。'
    };
  }

  if (isSampleSandbox(db)) {
    return {
      applied: 0,
      missing: entries.map((entry) => entry.matchNo),
      skipped: true,
      snapshot_key: snapshotKey,
      note: '当前数据库为样例闭环沙盒，跳过真实赛果导入。'
    };
  }

  const selectMatch = db.prepare('SELECT id, match_no FROM matches WHERE match_no = ?');
  const upsertResult = db.prepare(
    `INSERT INTO results (
      match_id, home_score, away_score, result_1x2, handicap_result, total_result, upset_type, settled_at, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id) DO UPDATE SET
      home_score = excluded.home_score,
      away_score = excluded.away_score,
      result_1x2 = excluded.result_1x2,
      handicap_result = excluded.handicap_result,
      total_result = excluded.total_result,
      upset_type = excluded.upset_type,
      settled_at = excluded.settled_at,
      note = excluded.note`
  );
  const updateMatch = db.prepare("UPDATE matches SET status = 'finished' WHERE id = ?");
  const insertImport = db.prepare(
    `INSERT INTO import_runs (run_type, started_at, finished_at, source, status, rows_affected, snapshot_key, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let applied = 0;
  const missing = [];

  db.exec('BEGIN');
  try {
    for (const entry of entries) {
      const match = selectMatch.get(entry.matchNo);
      if (!match) {
        missing.push(entry.matchNo);
        continue;
      }
      const settlement = marketSettlement(entry, latestOddsForMatch(db, match.id));
      upsertResult.run(
        match.id,
        entry.homeScore,
        entry.awayScore,
        entry.result1x2,
        settlement.handicapResult,
        settlement.totalResult,
        settlement.upsetType,
        entry.settledAt,
        sourceNote(entry)
      );
      updateMatch.run(match.id);
      applied += 1;
    }

    const finishedAt = new Date().toISOString();
    insertImport.run(
      'result_import',
      startedAt,
      finishedAt,
      'official-result-manual',
      missing.length ? 'partial_success' : 'success',
      applied,
      snapshotKey,
      missing.length
        ? `导入 ${applied} 条官方赛果；缺失 match_no：${missing.join(', ')}。`
        : `导入 ${applied} 条官方赛果；胜平负结果与盘口/大小球结算分开保存。`
    );
    db.exec('COMMIT');

    return {
      applied,
      missing,
      skipped: false,
      snapshot_key: snapshotKey,
      finished_at: finishedAt
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  const result = applyOfficialResults(db);
  console.log(JSON.stringify(result, null, 2));
  db.close();
}
