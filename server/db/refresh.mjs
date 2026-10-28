import { openDatabase } from './connection.mjs';
import { predictMatch } from '../model/index.mjs';
import {
  isPredictionUsableOddsSource,
  preferredPredictionSnapshots
} from '../services/oddsSourcePolicy.mjs';
import { pathToFileURL } from 'node:url';

const MARKET_PREVIEW_MODEL = {
  code: 'official-market-preview-v0.1',
  name: '官方赛程 + 完整盘口预判 v0.1',
  weights: {
    strength: 0.22,
    goal_model: 0.18,
    market: 0.52,
    factors: 0.08
  },
  calibration: {
    method: 'market_prior_preview',
    draw_floor: 0.18,
    draw_ceiling: 0.34
  },
  accuracy: {
    source: 'pending_2026_results',
    sample_size: 0,
    reason: '2026 世界杯尚未完赛；当前只基于完整赛前盘口快照、球队强度和规则标签生成预判，赛后才能滚动校准。'
  },
  notes:
    '仅在存在完整赛前盘口快照时用于预判展示；阵容、伤停、天气和新闻输入未齐前，不输出串关或投注建议。'
};

const PRIMARY_PROVIDER_ORDER = [
  'OddsLab/Pinnacle',
  'OddsLab/Betfair Exchange',
  'OddsLab/Bet365',
  'OddsLab/BetOnline.ag',
  'OddsLab/1xBet'
];

function providerRank(provider) {
  const index = PRIMARY_PROVIDER_ORDER.indexOf(provider);
  return index >= 0 ? index : PRIMARY_PROVIDER_ORDER.length + 1;
}

function capturedTime(row) {
  const time = new Date(row.captured_at).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isSampleSandbox(db) {
  const sampleMatches = db
    .prepare("SELECT COUNT(*) AS count FROM matches WHERE status = 'sample_placeholder'")
    .get().count;
  const totalMatches = db.prepare('SELECT COUNT(*) AS count FROM matches').get().count;
  return totalMatches > 0 && sampleMatches === totalMatches;
}

function isUsableSnapshot(row, cutoffTime, allowSampleSnapshots = false) {
  const time = capturedTime(row);
  const kickoffTime = new Date(row.kickoff_utc).getTime();
  const sourceAllowed = isPredictionUsableOddsSource(row.source_type, { allowSample: allowSampleSnapshots });
  const beforeKickoff = Number.isFinite(kickoffTime) ? time < kickoffTime : true;
  return time > 0 && time <= cutoffTime && beforeKickoff && sourceAllowed;
}

function readJsonObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function finiteNumber(value) {
  return Number.isFinite(Number(value));
}

function canPredictWithModel(modelVersion) {
  if (!modelVersion) return false;
  const weights = readJsonObject(modelVersion.weights_json);
  const totalWeight = ['strength', 'goal_model', 'market', 'factors'].reduce(
    (sum, key) => sum + (finiteNumber(weights[key]) ? Number(weights[key]) : 0),
    0
  );
  const calibration = readJsonObject(modelVersion.calibration_json);
  return totalWeight > 0 && finiteNumber(calibration.draw_floor) && finiteNumber(calibration.draw_ceiling);
}

function ensureMarketPreviewModel(db) {
  const existing = db.prepare('SELECT * FROM model_versions WHERE code = ?').get(MARKET_PREVIEW_MODEL.code);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO model_versions (code, name, created_at, weights_json, calibration_json, accuracy_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    MARKET_PREVIEW_MODEL.code,
    MARKET_PREVIEW_MODEL.name,
    new Date().toISOString(),
    JSON.stringify(MARKET_PREVIEW_MODEL.weights),
    JSON.stringify(MARKET_PREVIEW_MODEL.calibration),
    JSON.stringify(MARKET_PREVIEW_MODEL.accuracy),
    MARKET_PREVIEW_MODEL.notes
  );
  return db.prepare('SELECT * FROM model_versions WHERE code = ?').get(MARKET_PREVIEW_MODEL.code);
}

function selectPredictionModel(db, hasSnapshots) {
  const latest = db.prepare('SELECT * FROM model_versions ORDER BY id DESC LIMIT 1').get();
  if (!hasSnapshots || canPredictWithModel(latest)) return latest;
  return ensureMarketPreviewModel(db);
}

function syncMatchLifecycle(db, now) {
  return db
    .prepare(
      `UPDATE matches
       SET status = 'result_pending'
       WHERE datetime(kickoff_utc) < datetime(?)
         AND status != 'finished'
         AND NOT EXISTS (
           SELECT 1
           FROM results r
           WHERE r.match_id = matches.id
         )`
    )
    .run(now).changes;
}

function allByMatch(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.match_id)) map.set(row.match_id, []);
    map.get(row.match_id).push(row);
  }
  for (const snapshots of map.values()) {
    snapshots.sort(
      (left, right) =>
        capturedTime(left) - capturedTime(right) ||
        providerRank(right.provider) - providerRank(left.provider) ||
        String(left.provider).localeCompare(String(right.provider))
    );
  }
  return map;
}

function actualResultIndex(result) {
  if (result === '主胜') return 0;
  if (result === '平局') return 1;
  if (result === '客胜') return 2;
  return -1;
}

function asianResultKey(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number > 0) return 'home';
  if (number < 0) return 'away';
  return 'push';
}

function asianRecommendedSide(adjustedMargin, line, rawMargin) {
  if (!Number.isFinite(adjustedMargin)) return null;
  if (adjustedMargin > 0) return 'home';
  if (adjustedMargin < 0) return 'away';
  if (line < 0) return 'away';
  if (line > 0) return 'home';
  if (rawMargin > 0) return 'home';
  if (rawMargin < 0) return 'away';
  return null;
}

function pickIsHandicapCorrect(row) {
  const line = Number(row.asian_line);
  const homeScore = Number(row.home_score);
  const awayScore = Number(row.away_score);
  const topScoreHome = Number(row.top_score_home_goals);
  const topScoreAway = Number(row.top_score_away_goals);
  const expectedHome = Number(row.expected_home_goals);
  const expectedAway = Number(row.expected_away_goals);
  const predictedMargin =
    [topScoreHome, topScoreAway].every(Number.isFinite)
      ? topScoreHome - topScoreAway
      : [expectedHome, expectedAway].every(Number.isFinite)
        ? expectedHome - expectedAway
        : null;
  const predictedKey =
    predictedMargin == null ? null : asianRecommendedSide(predictedMargin + line, line, predictedMargin);
  if (![line, homeScore, awayScore].every(Number.isFinite) || !predictedKey) return false;
  return predictedKey === asianResultKey(homeScore - awayScore + line);
}

function updateAccuracyMetrics(db, modelVersionId, generatedAt) {
  const rows = db
    .prepare(
      `SELECT
        p.recommended_pick,
        p.calibrated_home_prob,
        p.calibrated_draw_prob,
        p.calibrated_away_prob,
        p.expected_home_goals,
        p.expected_away_goals,
        (
          SELECT sp.home_goals
          FROM score_probabilities sp
          WHERE sp.prediction_id = p.id
          ORDER BY sp.probability DESC, sp.id ASC
          LIMIT 1
        ) AS top_score_home_goals,
        (
          SELECT sp.away_goals
          FROM score_probabilities sp
          WHERE sp.prediction_id = p.id
          ORDER BY sp.probability DESC, sp.id ASC
          LIMIT 1
        ) AS top_score_away_goals,
        p.confidence,
        o.asian_line,
        r.home_score,
        r.away_score,
        r.result_1x2,
        r.handicap_result
       FROM predictions p
       JOIN results r ON r.match_id = p.match_id
       JOIN odds_snapshots o ON o.id = p.odds_snapshot_id
       WHERE p.model_version_id = ?`
    )
    .all(modelVersionId);

  if (rows.length === 0) return null;

  let resultHits = 0;
  let handicapHits = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  let calibrationTotal = 0;

  for (const row of rows) {
    const probs = [row.calibrated_home_prob, row.calibrated_draw_prob, row.calibrated_away_prob];
    const actualIndex = actualResultIndex(row.result_1x2);
    if (actualIndex < 0) continue;
    const correct = row.recommended_pick === row.result_1x2 ? 1 : 0;
    resultHits += correct;
    if (pickIsHandicapCorrect(row)) handicapHits += 1;
    brierTotal += probs.reduce((sum, prob, index) => sum + (prob - (index === actualIndex ? 1 : 0)) ** 2, 0);
    logLossTotal += -Math.log(Math.max(0.001, probs[actualIndex]));
    calibrationTotal += Math.abs(row.confidence - correct);
  }

  const sampleSize = rows.length;
  const metrics = {
    source: 'synthetic_sample_results',
    sample_size: sampleSize,
    result_accuracy: Math.round((resultHits / sampleSize) * 1000) / 1000,
    handicap_direction_accuracy: Math.round((handicapHits / sampleSize) * 1000) / 1000,
    brier_1x2: Math.round((brierTotal / sampleSize) * 1000) / 1000,
    log_loss: Math.round((logLossTotal / sampleSize) * 1000) / 1000,
    calibration_error: Math.round((calibrationTotal / sampleSize) * 1000) / 1000,
    generated_at: generatedAt
  };

  db.prepare('UPDATE model_versions SET accuracy_json = ? WHERE id = ?').run(JSON.stringify(metrics), modelVersionId);
  return metrics;
}

export function refreshPredictions(db = openDatabase()) {
  const now = new Date().toISOString();
  const snapshotCutoff = new Date(now).getTime() + 15 * 60 * 1000;
  const lifecycleUpdates = syncMatchLifecycle(db, now);
  const sampleSandbox = isSampleSandbox(db);
  const teams = db.prepare('SELECT * FROM teams ORDER BY id').all();
  const matches = db.prepare('SELECT * FROM matches ORDER BY match_no').all();
  const rules = db.prepare('SELECT * FROM tag_rules ORDER BY id').all();
  const snapshots = db
    .prepare(
      `SELECT o.*, m.kickoff_utc
       FROM odds_snapshots o
       JOIN matches m ON m.id = o.match_id
       ORDER BY o.match_id, o.captured_at`
    )
    .all()
    .filter((snapshot) => isUsableSnapshot(snapshot, snapshotCutoff, sampleSandbox));
  const modelVersion = selectPredictionModel(db, snapshots.length > 0);
  const snapshotByMatch = allByMatch(snapshots);
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const ruleIdByCode = new Map(rules.map((rule) => [rule.code, rule.id]));

  const insertPrediction = db.prepare(`
    INSERT INTO predictions (
      match_id, model_version_id, odds_snapshot_id, generated_at,
      home_win_prob, draw_prob, away_win_prob,
      calibrated_home_prob, calibrated_draw_prob, calibrated_away_prob,
      expected_home_goals, expected_away_goals, confidence, upset_risk, value_score,
      recommended_pick, risk_level, explanation
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertScore = db.prepare(`
    INSERT INTO score_probabilities (prediction_id, home_goals, away_goals, probability)
    VALUES (?, ?, ?, ?)
  `);
  const insertGoal = db.prepare(`
    INSERT INTO goal_probabilities (prediction_id, total_goals, probability)
    VALUES (?, ?, ?)
  `);
  const insertTag = db.prepare(`
    INSERT INTO match_tags (match_id, tag_rule_id, source, triggered_at, confidence, note, review_result)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImport = db.prepare(`
    INSERT INTO import_runs (run_type, started_at, finished_at, source, status, rows_affected, snapshot_key, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const openPredictedFutureMatches = db.prepare(`
    UPDATE matches
    SET status = 'scheduled'
    WHERE status = 'official_schedule_prediction_blocked'
      AND datetime(kickoff_utc) > datetime(?)
      AND EXISTS (
        SELECT 1
        FROM predictions p
        WHERE p.match_id = matches.id
      )
  `);

  let predictionCount = 0;
  let tagCount = 0;

  db.exec('BEGIN');
  try {
    db.exec(`
      DELETE FROM match_tags;
      DELETE FROM goal_probabilities;
      DELETE FROM score_probabilities;
      DELETE FROM predictions;
    `);

    for (const match of matches) {
      const matchSnapshots = snapshotByMatch.get(match.id) ?? [];
      if (matchSnapshots.length === 0) continue;
      const predictionSnapshots = preferredPredictionSnapshots(matchSnapshots, { allowSample: sampleSandbox });
      if (predictionSnapshots.length === 0) continue;
      const result = predictMatch(match, teamById, predictionSnapshots, rules, modelVersion);
      const latestSnapshot = predictionSnapshots.at(-1);
      const inserted = insertPrediction.run(
        match.id,
        modelVersion.id,
        latestSnapshot.id,
        now,
        result.prediction.home_win_prob,
        result.prediction.draw_prob,
        result.prediction.away_win_prob,
        result.prediction.calibrated_home_prob,
        result.prediction.calibrated_draw_prob,
        result.prediction.calibrated_away_prob,
        result.prediction.expected_home_goals,
        result.prediction.expected_away_goals,
        result.prediction.confidence,
        result.prediction.upset_risk,
        result.prediction.value_score,
        result.prediction.recommended_pick,
        result.prediction.risk_level,
        result.prediction.explanation
      );
      const predictionId = Number(inserted.lastInsertRowid);
      predictionCount += 1;

      for (const score of result.scoreProbabilities.slice(0, 16)) {
        insertScore.run(predictionId, score.home_goals, score.away_goals, score.probability);
      }

      for (const goal of result.goalProbabilities) {
        insertGoal.run(predictionId, goal.total_goals, goal.probability);
      }

      for (const tag of result.tags) {
        const tagRuleId = ruleIdByCode.get(tag.rule.code);
        if (!tagRuleId) continue;
        insertTag.run(match.id, tagRuleId, 'rule-engine', now, tag.confidence, tag.note, 'pending');
        tagCount += 1;
      }
    }

    const openedPredictionMatches = openPredictedFutureMatches.run(now).changes;
    const metrics = updateAccuracyMetrics(db, modelVersion.id, now);
    insertImport.run(
      'refresh',
      now,
      now,
      'manual-local-refresh-with-schedule-guardrails',
      'success',
      predictionCount,
      `prediction-${now}`,
      predictionCount > 0
        ? '基于完整赛前盘口快照刷新预判；欧洲直连/归档源优先，懂球帝同公司指数仅在无直连源时兜底；阵容、伤停、天气和新闻输入未齐，结果不作为投注建议。'
        : '未找到完整赛前盘口快照，未生成预测。'
    );
    db.exec('COMMIT');
    return {
      predictions: predictionCount,
      tags: tagCount,
      accuracy: metrics,
      lifecycleUpdates,
      openedPredictionMatches,
      generated_at: now
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  const result = refreshPredictions(db);
  console.log(JSON.stringify(result, null, 2));
  db.close();
}
