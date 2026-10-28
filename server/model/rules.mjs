import { clamp, round } from './math.mjs';

export function evaluateRules(match, snapshots, rules) {
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2) ?? latest;
  const tags = [];
  const homeOddsDrop = previous.home_odds - latest.home_odds;
  const awayOddsDrop = previous.away_odds - latest.away_odds;
  const homeWaterDrop = previous.asian_home_water - latest.asian_home_water;
  const lineMove = latest.asian_line - previous.asian_line;
  const totalMove = latest.total_line - previous.total_line;
  const favoriteGap = Math.abs(latest.home_odds - latest.away_odds);
  const oddsSpread = Math.max(latest.home_odds, latest.draw_odds, latest.away_odds) - Math.min(latest.home_odds, latest.draw_odds, latest.away_odds);

  const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));
  const add = (code, confidence, note) => {
    const rule = ruleByCode.get(code);
    if (rule) {
      tags.push({
        rule,
        confidence: round(clamp(confidence, 0.35, 0.96)),
        note
      });
    }
  };

  if (latest.asian_line >= 1.25 || latest.asian_line <= -1.25) {
    add('floor', 0.58 + Math.abs(latest.asian_line) * 0.08, `盘口楼层达到 ${latest.asian_line}`);
  }
  if ([0.25, 0.5, 0.75, 1, 1.25].includes(Math.abs(latest.asian_line))) {
    add('line_band', 0.56 + Math.abs(lineMove) * 0.12, `当前盘口位于 ${latest.asian_line} 敏感区间`);
  }
  if (homeOddsDrop > 0.12 && homeWaterDrop > 0.04) {
    add('max_push', 0.64 + homeOddsDrop * 0.22, '热门方向赔率与水位同步下探');
  }
  if (lineMove < -0.25 || (homeOddsDrop < -0.08 && homeWaterDrop < -0.04)) {
    add('hard_pullback', 0.62 + Math.abs(lineMove) * 0.15, '早盘方向发生明显回撤');
  }
  if (Math.abs(lineMove) < 0.01 && latest.asian_home_water >= 0.91 && latest.asian_home_water <= 0.99) {
    add('stuck_band', 0.6, '盘口停留在临界水位');
  }
  if ((homeOddsDrop > 0.08 && latest.asian_home_water > previous.asian_home_water) || (awayOddsDrop > 0.08 && latest.asian_away_water > previous.asian_away_water)) {
    add('yaodao', 0.65, '欧赔与亚盘水位方向不一致');
  }
  if (favoriteGap > 1.25 && oddsSpread > 2.4) {
    add('wdl_shape', 0.61, '胜平负结构明显偏向一侧');
  }
  if (oddsSpread < 0.9) {
    add('balanced_shape', 0.58, '三项结构接近，中庸盘面');
  }
  if (homeOddsDrop > 0.03 && homeOddsDrop <= 0.12 && Math.abs(lineMove) <= 0.25) {
    add('small_flow', 0.62, '热门方向小幅顺势');
  }
  if (homeOddsDrop > 0.16 || awayOddsDrop > 0.16 || Math.abs(totalMove) >= 0.5) {
    add('big_flow', 0.63, '赔率或总进球盘口出现大幅顺势');
  }
  if (match.match_no % 7 === 0 || (latest.home_odds < 1.7 && latest.draw_odds > 4.1)) {
    add('hot_rebate', 0.57, '热赛返还走势触发');
  }

  const factor = tags.reduce((sum, item) => {
    const code = item.rule.code;
    if (['small_flow', 'wdl_shape'].includes(code)) return sum + item.rule.impact_strength * item.confidence;
    if (['max_push', 'hard_pullback', 'yaodao', 'big_flow', 'hot_rebate'].includes(code)) {
      return sum - item.rule.impact_strength * item.confidence;
    }
    return sum;
  }, 0);

  return {
    tags,
    factor: round(clamp(factor, -0.16, 0.14))
  };
}
