import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase, applySchema, json } from './connection.mjs';
import { buildMatches, buildTeams, modelVersion, sampleModelVersion, tagRules } from '../data/sampleData.mjs';
import { buildSyntheticOdds } from '../model/market.mjs';
import { estimateStrength, resolveTeams } from '../model/strength.mjs';
import { applyOfficialResults } from './officialResults.mjs';
import { refreshPredictions } from './refresh.mjs';

function hashSnapshot(matchId, capturedAt, odds) {
  return createHash('sha1').update(JSON.stringify({ matchId, capturedAt, odds })).digest('hex').slice(0, 16);
}

function resetTables(db) {
  db.exec(`
    DELETE FROM reviews;
    DELETE FROM results;
    DELETE FROM match_tags;
    DELETE FROM goal_probabilities;
    DELETE FROM score_probabilities;
    DELETE FROM predictions;
    DELETE FROM odds_snapshots;
    DELETE FROM tag_rules;
    DELETE FROM model_versions;
    DELETE FROM matches;
    DELETE FROM teams;
    DELETE FROM import_runs;
  `);
}

function deterministicUnit(...parts) {
  const hash = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 8);
  return Number.parseInt(hash, 16) / 0xffffffff;
}

function buildSampleResult(match, home, away, latestOdds) {
  const strength = estimateStrength(home, away, match);
  const homeNoise = (deterministicUnit(match.match_no, 'home') - 0.5) * 1.9;
  const awayNoise = (deterministicUnit(match.match_no, 'away') - 0.5) * 1.7;
  const lateGoal = deterministicUnit(match.match_no, 'late') > 0.82 ? 1 : 0;
  const homeScore = Math.max(0, Math.min(5, Math.round(strength.homeExpectedGoals + homeNoise + lateGoal)));
  const awayScore = Math.max(0, Math.min(5, Math.round(strength.awayExpectedGoals + awayNoise)));
  const margin = homeScore - awayScore;
  const result1x2 = margin > 0 ? '主胜' : margin < 0 ? '客胜' : '平局';
  const handicapMargin = margin - latestOdds.asian_line;
  const handicapResult =
    Math.abs(handicapMargin) < 0.001 ? '走水' : handicapMargin > 0 ? '主队赢盘' : '主队输盘';
  const totalMargin = homeScore + awayScore - latestOdds.total_line;
  const totalResult = Math.abs(totalMargin) < 0.001 ? '走水' : totalMargin > 0 ? '大球' : '小球';
  const marketFavorite = latestOdds.home_odds <= latestOdds.away_odds ? '主胜' : '客胜';
  const favoriteCovered =
    marketFavorite === '主胜' ? handicapResult === '主队赢盘' : handicapResult === '主队输盘';
  const upsetType =
    result1x2 !== '平局' && result1x2 !== marketFavorite
      ? '赛果冷门'
      : !favoriteCovered
        ? '盘口冷门'
        : '常规结果';
  const settledAt = new Date(new Date(match.kickoff_utc).getTime() + 2 * 60 * 60 * 1000).toISOString();

  return {
    homeScore,
    awayScore,
    result1x2,
    handicapResult,
    totalResult,
    upsetType,
    settledAt,
    note: '合成样例复盘数据，仅用于验证赛果、赢盘/输盘、大小球和校准闭环，不代表真实 2026 世界杯结果。'
  };
}

function normalizeSeedMode(mode) {
  return mode === 'sample' ? 'sample' : 'official';
}

function isPredictionEligible(match) {
  return match.status !== 'official_schedule_prediction_blocked';
}

function sampleCapturedAt(match, index) {
  const base = new Date('2026-06-10T08:00:00.000Z').getTime();
  return new Date(base + (match.match_no * 5 + index) * 60 * 1000).toISOString();
}

export function seedDatabase(db = openDatabase(), options = {}) {
  const mode = normalizeSeedMode(options.mode ?? process.env.WC_SEED_MODE);
  const sampleMode = mode === 'sample';
  applySchema(db);
  resetTables(db);

  const teams = buildTeams({ mode });
  const matches = buildMatches(teams, { mode });
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const predictionEligibleMatches = matches.filter(isPredictionEligible);
  const blockedPredictionMatches = matches.length - predictionEligibleMatches.length;
  const activeModelVersion = sampleMode ? sampleModelVersion : modelVersion;

  const insertTeam = db.prepare(`
    INSERT INTO teams (id, code, name_zh, confederation, group_name, seed_rank, elo, glicko_mu, glicko_phi, attack, defense, form)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMatch = db.prepare(`
    INSERT INTO matches (id, match_no, stage, group_name, round_label, kickoff_utc, venue, home_team_id, away_team_id, home_placeholder, away_placeholder, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertModel = db.prepare(`
    INSERT INTO model_versions (code, name, created_at, weights_json, calibration_json, accuracy_json, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRule = db.prepare(`
    INSERT INTO tag_rules (code, name, category, trigger_condition, impact_direction, impact_strength, historical_hit_rate, review_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOdds = db.prepare(`
    INSERT INTO odds_snapshots (
      match_id, captured_at, provider, home_odds, draw_odds, away_odds, asian_line,
      asian_home_water, asian_away_water, total_line, over_water, under_water, source_type, snapshot_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertResult = db.prepare(`
    INSERT INTO results (
      match_id, home_score, away_score, result_1x2, handicap_result, total_result, upset_type, settled_at, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertImport = db.prepare(`
    INSERT INTO import_runs (run_type, started_at, finished_at, source, status, rows_affected, snapshot_key, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const team of teams) {
      insertTeam.run(
        team.id,
        team.code,
        team.name_zh,
        team.confederation,
        team.group_name,
        team.seed_rank,
        team.elo,
        team.glicko_mu,
        team.glicko_phi,
        team.attack,
        team.defense,
        team.form
      );
    }

    for (const match of matches) {
      insertMatch.run(
        match.id,
        match.match_no,
        match.stage,
        match.group_name,
        match.round_label,
        match.kickoff_utc,
        match.venue,
        match.home_team_id,
        match.away_team_id,
        match.home_placeholder,
        match.away_placeholder,
        match.status
      );
    }

    insertModel.run(
      activeModelVersion.code,
      activeModelVersion.name,
      activeModelVersion.created_at,
      json(activeModelVersion.weights_json),
      json(activeModelVersion.calibration_json),
      json(activeModelVersion.accuracy_json),
      activeModelVersion.notes
    );

    for (const rule of tagRules) {
      insertRule.run(
        rule.code,
        rule.name,
        rule.category,
        rule.trigger_condition,
        rule.impact_direction,
        rule.impact_strength,
        rule.historical_hit_rate,
        rule.review_summary
      );
    }

    for (const match of predictionEligibleMatches) {
      const { home, away } = resolveTeams(match, teamById);
      const kickoff = new Date(match.kickoff_utc).getTime();
      const offsets = [72, 24, 4];
      let latestOdds = null;
      for (let index = 0; index < offsets.length; index += 1) {
        const capturedAt = sampleMode
          ? sampleCapturedAt(match, index)
          : new Date(kickoff - offsets[index] * 60 * 60 * 1000).toISOString();
        const odds = buildSyntheticOdds(match, home, away, index);
        latestOdds = odds;
        insertOdds.run(
          match.id,
          capturedAt,
          'sample-market',
          odds.home_odds,
          odds.draw_odds,
          odds.away_odds,
          odds.asian_line,
          odds.asian_home_water,
          odds.asian_away_water,
          odds.total_line,
          odds.over_water,
          odds.under_water,
          sampleMode ? 'sample_sandbox_snapshot' : 'seed',
          hashSnapshot(match.id, capturedAt, odds)
        );
      }
      const result = buildSampleResult(match, home, away, latestOdds);
      insertResult.run(
        match.id,
        result.homeScore,
        result.awayScore,
        result.result1x2,
        result.handicapResult,
        result.totalResult,
        result.upsetType,
        result.settledAt,
        result.note
      );
    }

    const now = new Date().toISOString();
    insertImport.run(
      'seed',
      now,
      now,
      sampleMode
        ? 'sample-sandbox-full-loop'
        : blockedPredictionMatches > 0
        ? 'official-fifa-schedule-seed-with-prediction-block'
        : 'local-sample-generator-with-schedule-guardrails',
      'success',
      teams.length + matches.length + predictionEligibleMatches.length,
      sampleMode
        ? 'sample-sandbox-2026-full-loop-v1'
        : blockedPredictionMatches > 0
          ? 'official-schedule-2026-prediction-blocked-v1'
          : 'sample-2026-guarded-v1',
      sampleMode
        ? '重建第一阶段样例闭环库：104 场样例赛程、样例盘口、预测快照、合成赛果和复盘校准全部写入；不代表真实 2026 世界杯结论。'
        : blockedPredictionMatches > 0
        ? '重建 FIFA 官方 2026 赛程和规则审计链路；未接入官方赔率、阵容新闻和赛前输入前，不生成 2026 预测、盘口快照或合成赛果。'
        : '重建样例球队、非官方占位赛程、赔率、规则和合成赛果；该 fallback 不作为真实 2026 预测。'
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const officialResultImport = sampleMode ? null : applyOfficialResults(db);
  const refresh = refreshPredictions(db);
  return {
    mode,
    teams: teams.length,
    matches: matches.length,
    blocked_predictions: blockedPredictionMatches,
    official_results: officialResultImport?.applied ?? 0,
    ...refresh
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1];
  const result = seedDatabase(db, { mode: modeArg });
  console.log(JSON.stringify(result, null, 2));
  db.close();
}
