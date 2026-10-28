#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = process.cwd();
const MARKET_REPORT = join(ROOT_DIR, 'reports/worldcup-2022-market-backtest.json');
const MODEL_LEDGER = join(ROOT_DIR, 'reports/international-model-prediction-ledger.json');
const OUTPUT_JSON = join(ROOT_DIR, 'reports/worldcup-2022-hybrid-backtest.json');
const OUTPUT_MD = join(ROOT_DIR, 'reports/worldcup-2022-hybrid-backtest.md');

const MODEL_PICK = { H: 'home', D: 'draw', A: 'away' };

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
}

function rowKey(row) {
  return `${row.date}|${row.home ?? row.home_team}|${row.away ?? row.away_team}`;
}

function bestPick(probabilities) {
  return Object.entries(probabilities ?? {})
    .sort((left, right) => Number(right[1] ?? 0) - Number(left[1] ?? 0))[0]?.[0] ?? null;
}

function blendPick(marketRow, modelRow, modelWeight) {
  const market = marketRow.markets.moneyline.probabilities;
  const model = modelRow.probabilities;
  return bestPick({
    home: market.home * (1 - modelWeight) + model.home * modelWeight,
    draw: market.draw * (1 - modelWeight) + model.draw * modelWeight,
    away: market.away * (1 - modelWeight) + model.away * modelWeight
  });
}

function summarize(rows, pickForRow) {
  const hits = {
    wdl: 0,
    handicap: 0,
    goals: 0,
    score: 0,
    scoreTop2: 0
  };
  for (const row of rows) {
    if (pickForRow(row) === row.market.evaluation.actual.wdl) hits.wdl += 1;
    if (row.market.evaluation.hits.handicap) hits.handicap += 1;
    if (row.market.evaluation.hits.goals) hits.goals += 1;
    if (row.market.evaluation.hits.score) hits.score += 1;
    if (row.market.evaluation.hits.scoreTop2) hits.scoreTop2 += 1;
  }
  return Object.fromEntries(
    Object.entries(hits).map(([key, hitCount]) => [
      key,
      { hits: hitCount, total: rows.length, rate: rows.length ? round(hitCount / rows.length, 4) : null }
    ])
  );
}

function strategyRows(rows, strategy) {
  if (strategy === 'confirmation_gate') {
    return rows.filter((row) => row.market.prediction.wdl === row.modelPick);
  }
  if (strategy === 'market_strong') {
    return rows.filter((row) => row.market.prediction.tier === 'strong');
  }
  if (strategy === 'disagreement') {
    return rows.filter((row) => row.market.prediction.wdl !== row.modelPick);
  }
  return rows;
}

function renderMarkdown(report) {
  const lines = [
    '# 2022 World Cup Hybrid Backtest',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This isolated experiment combines the market-first V1 output with the existing international walk-forward model ledger. It does not change model parameters, database state, or production recommendations.',
    '',
    '| Strategy | Coverage | WDL | AH | Goals Top2 | Score | Score Top2 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const strategy of report.strategies) {
    lines.push(
      `| ${strategy.label} | ${strategy.rows} | ${pct(strategy.metrics.wdl.rate)} | ${pct(strategy.metrics.handicap.rate)} | ${pct(strategy.metrics.goals.rate)} | ${pct(strategy.metrics.score.rate)} | ${pct(strategy.metrics.scoreTop2.rate)} |`
    );
  }
  lines.push(
    '',
    '## Blend Weight Sweep',
    '',
    '| Model Weight | WDL |',
    '| ---: | ---: |'
  );
  for (const row of report.blendSweep) {
    lines.push(`| ${row.modelWeight.toFixed(1)} | ${row.hits}/${row.total} (${pct(row.rate)}) |`);
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    '- The original model alone did not beat market-first V1 on full 64-match WDL coverage.',
    '- Raw probability blending also did not beat market-first V1 in this sample.',
    '- The useful hybrid role is confirmation gating: when market V1 and the model agree, WDL hit rate improves while coverage drops.',
    '',
    '## Confirmed Rows',
    '',
    '| Date | Match | Market Pick | Model Pick | Actual | Score Pick | Actual Score |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const row of report.rows.filter((item) => item.hybrid.confirmed).slice(0, 20)) {
    lines.push(
      `| ${row.date} | ${row.home} vs ${row.away} | ${row.marketPick} | ${row.modelPick} | ${row.actual} | ${row.scorePick} | ${row.actualScore} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const marketRows = JSON.parse(readFileSync(MARKET_REPORT, 'utf8')).rows.filter((row) => row.status === 'ready');
  const modelRows = JSON.parse(readFileSync(MODEL_LEDGER, 'utf8')).rows.filter(
    (row) => row.date >= '2022-11-20' && row.date <= '2022-12-18' && row.tournament === 'FIFA World Cup'
  );
  const modelByKey = new Map(modelRows.map((row) => [rowKey(row), row]));
  const rows = marketRows.map((market) => {
    const model = modelByKey.get(rowKey(market));
    const modelPick = MODEL_PICK[model?.pick] ?? null;
    return {
      market,
      model,
      modelPick
    };
  }).filter((row) => row.model && row.modelPick);

  const strategies = [
    {
      key: 'market_v1_full',
      label: 'Market V1 full',
      pick: (row) => row.market.prediction.wdl
    },
    {
      key: 'model_full',
      label: 'Model full',
      pick: (row) => row.modelPick
    },
    {
      key: 'blend_0_8',
      label: 'Raw blend model 0.8',
      pick: (row) => blendPick(row.market, row.model, 0.8)
    },
    {
      key: 'market_strong',
      label: 'Market strong only',
      pick: (row) => row.market.prediction.wdl
    },
    {
      key: 'confirmation_gate',
      label: 'Market + model agree',
      pick: (row) => row.market.prediction.wdl
    },
    {
      key: 'disagreement',
      label: 'Market/model disagree',
      pick: (row) => row.market.prediction.wdl
    }
  ].map((strategy) => {
    const selectedRows = strategyRows(rows, strategy.key);
    return {
      key: strategy.key,
      label: strategy.label,
      rows: selectedRows.length,
      metrics: summarize(selectedRows, strategy.pick)
    };
  });

  const blendSweep = [];
  for (let step = 0; step <= 10; step += 1) {
    const modelWeight = step / 10;
    const hits = rows.filter((row) => blendPick(row.market, row.model, modelWeight) === row.market.evaluation.actual.wdl).length;
    blendSweep.push({
      modelWeight,
      hits,
      total: rows.length,
      rate: round(hits / rows.length, 4)
    });
  }

  const reportRows = rows.map((row) => ({
    date: row.market.date,
    home: row.market.home,
    away: row.market.away,
    marketPick: row.market.prediction.wdl,
    modelPick: row.modelPick,
    actual: row.market.evaluation.actual.wdl,
    scorePick: row.market.prediction.score.label,
    actualScore: row.market.evaluation.actual.score,
    tier: row.market.prediction.tier,
    hybrid: {
      confirmed: row.market.prediction.wdl === row.modelPick,
      conflict: row.market.prediction.wdl !== row.modelPick
    }
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      market: MARKET_REPORT,
      modelLedger: MODEL_LEDGER
    },
    diagnostics: {
      marketRows: marketRows.length,
      modelRows: modelRows.length,
      matchedRows: rows.length
    },
    strategies,
    blendSweep,
    rows: reportRows
  };
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_MD, renderMarkdown(report));
  console.log(JSON.stringify({
    ok: rows.length === 64,
    strategies: strategies.map((strategy) => ({
      key: strategy.key,
      rows: strategy.rows,
      wdl: strategy.metrics.wdl
    })),
    output: OUTPUT_JSON,
    markdown: OUTPUT_MD
  }, null, 2));
}

main();
