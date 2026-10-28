#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = process.cwd();
const MODEL_LEDGER = join(ROOT_DIR, 'reports/international-model-prediction-ledger.json');
const OUTPUT_JSON = join(ROOT_DIR, 'reports/auxiliary-model-pretest.json');
const OUTPUT_MD = join(ROOT_DIR, 'reports/auxiliary-model-pretest.md');

const SCENARIOS = [
  {
    key: 'worldcup_2022',
    label: '2022 World Cup',
    marketReport: join(ROOT_DIR, 'reports/worldcup-2022-market-backtest.json'),
    tournament: 'FIFA World Cup',
    startDate: '2022-11-20',
    endDate: '2022-12-18',
    expectedRows: 64
  },
  {
    key: 'euro_2024',
    label: 'Euro 2024',
    marketReport: join(ROOT_DIR, 'reports/euro-2024-market-backtest.json'),
    tournament: 'UEFA Euro',
    startDate: '2024-06-14',
    endDate: '2024-07-14',
    expectedRows: 51
  }
];

const MODEL_PICK = { H: 'home', D: 'draw', A: 'away' };
const OUTCOMES = ['home', 'draw', 'away'];

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--';
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function rowKey(row) {
  return `${row.date}|${row.home ?? row.home_team}|${row.away ?? row.away_team}`;
}

function bestPick(probabilities) {
  return OUTCOMES.reduce((best, key) => (
    Number(probabilities?.[key] ?? 0) > Number(probabilities?.[best] ?? 0) ? key : best
  ), 'home');
}

function blendProbabilities(market, auxiliary, auxiliaryWeight) {
  const probabilities = {};
  for (const key of OUTCOMES) {
    probabilities[key] =
      Number(market?.[key] ?? 0) * (1 - auxiliaryWeight) +
      Number(auxiliary?.[key] ?? 0) * auxiliaryWeight;
  }
  const total = OUTCOMES.reduce((sum, key) => sum + probabilities[key], 0);
  if (total <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return Object.fromEntries(OUTCOMES.map((key) => [key, probabilities[key] / total]));
}

function logLoss(probabilities, actual) {
  return -Math.log(Math.max(Number(probabilities?.[actual] ?? 0), 1e-9));
}

function summarize(rows, { pickForRow, probabilityForRow = null }) {
  const selected = rows.filter((row) => row.selected !== false);
  const hits = selected.filter((row) => pickForRow(row) === row.actual).length;
  const logLossSum = probabilityForRow
    ? selected.reduce((sum, row) => sum + logLoss(probabilityForRow(row), row.actual), 0)
    : null;

  return {
    rows: selected.length,
    coverage_rate: rows.length ? round(selected.length / rows.length, 4) : null,
    hits,
    accuracy: selected.length ? round(hits / selected.length, 4) : null,
    log_loss: selected.length && logLossSum !== null ? round(logLossSum / selected.length, 4) : null
  };
}

function selectedRows(rows, selector) {
  return rows.map((row) => ({ ...row, selected: selector(row) }));
}

function buildRows(scenario, modelRows) {
  const marketRows = readJson(scenario.marketReport).rows.filter((row) => row.status === 'ready');
  const scenarioModelRows = modelRows.filter(
    (row) =>
      row.date >= scenario.startDate &&
      row.date <= scenario.endDate &&
      row.tournament === scenario.tournament
  );
  const modelByKey = new Map(scenarioModelRows.map((row) => [rowKey(row), row]));

  return marketRows
    .map((market) => {
      const model = modelByKey.get(rowKey(market));
      const auxiliaryPick = MODEL_PICK[model?.pick] ?? null;
      if (!model || !auxiliaryPick) return null;
      const marketProbabilities = market.markets.moneyline.probabilities;
      const auxiliaryProbabilities = model.probabilities;
      return {
        date: market.date,
        home: market.home,
        away: market.away,
        tier: market.prediction.tier,
        market_pick: market.prediction.wdl,
        market_favorite: bestPick(marketProbabilities),
        auxiliary_pick: auxiliaryPick,
        actual: market.evaluation.actual.wdl,
        market_probabilities: marketProbabilities,
        auxiliary_probabilities: auxiliaryProbabilities,
        market_row: market,
        auxiliary_row: model
      };
    })
    .filter(Boolean);
}

function buildStrategies(rows) {
  const strategies = [
    {
      key: 'market_v1_full',
      label: 'Market V1 full',
      rowSet: rows,
      pickForRow: (row) => row.market_pick,
      probabilityForRow: (row) => row.market_probabilities
    },
    {
      key: 'market_favorite_full',
      label: 'Market probability favorite',
      rowSet: rows,
      pickForRow: (row) => row.market_favorite,
      probabilityForRow: (row) => row.market_probabilities
    },
    {
      key: 'auxiliary_full',
      label: 'Auxiliary national model full',
      rowSet: rows,
      pickForRow: (row) => row.auxiliary_pick,
      probabilityForRow: (row) => row.auxiliary_probabilities
    },
    {
      key: 'market_auxiliary_agree',
      label: 'Market + auxiliary agree',
      rowSet: selectedRows(rows, (row) => row.market_pick === row.auxiliary_pick),
      pickForRow: (row) => row.market_pick,
      probabilityForRow: (row) => row.market_probabilities
    },
    {
      key: 'strong_market_auxiliary_agree',
      label: 'Strong market + auxiliary agree',
      rowSet: selectedRows(rows, (row) => row.tier === 'strong' && row.market_pick === row.auxiliary_pick),
      pickForRow: (row) => row.market_pick,
      probabilityForRow: (row) => row.market_probabilities
    },
    {
      key: 'market_auxiliary_disagree_market_side',
      label: 'Disagreement, keep market side',
      rowSet: selectedRows(rows, (row) => row.market_pick !== row.auxiliary_pick),
      pickForRow: (row) => row.market_pick,
      probabilityForRow: (row) => row.market_probabilities
    },
    {
      key: 'market_auxiliary_disagree_auxiliary_side',
      label: 'Disagreement, take auxiliary side',
      rowSet: selectedRows(rows, (row) => row.market_pick !== row.auxiliary_pick),
      pickForRow: (row) => row.auxiliary_pick,
      probabilityForRow: (row) => row.auxiliary_probabilities
    }
  ];

  const sweep = [];
  for (let step = 0; step <= 10; step += 1) {
    const auxiliaryWeight = step / 10;
    const key = `blend_aux_${String(step).padStart(2, '0')}`;
    const label = `Blend auxiliary ${Math.round(auxiliaryWeight * 100)}%`;
    const probabilityForRow = (row) => blendProbabilities(
      row.market_probabilities,
      row.auxiliary_probabilities,
      auxiliaryWeight
    );
    sweep.push({
      key,
      label,
      auxiliary_weight: auxiliaryWeight,
      ...summarize(rows, {
        pickForRow: (row) => bestPick(probabilityForRow(row)),
        probabilityForRow
      })
    });
  }

  return {
    strategies: strategies.map((strategy) => ({
      key: strategy.key,
      label: strategy.label,
      ...summarize(strategy.rowSet, strategy)
    })),
    blend_sweep: sweep
  };
}

function evaluateScenario(scenario, modelRows) {
  const rows = buildRows(scenario, modelRows);
  const { strategies, blend_sweep: blendSweep } = buildStrategies(rows);
  const market = strategies.find((strategy) => strategy.key === 'market_v1_full');
  const agreement = strategies.find((strategy) => strategy.key === 'market_auxiliary_agree');
  const bestFullBlend = blendSweep
    .filter((row) => row.coverage_rate === 1)
    .sort((left, right) => right.accuracy - left.accuracy || left.log_loss - right.log_loss)[0];

  return {
    ...scenario,
    diagnostics: {
      expected_rows: scenario.expectedRows,
      matched_rows: rows.length,
      complete: rows.length === scenario.expectedRows
    },
    baseline_market_accuracy: market?.accuracy ?? null,
    agreement_accuracy_lift: agreement?.accuracy !== null && market?.accuracy !== null
      ? round(agreement.accuracy - market.accuracy, 4)
      : null,
    agreement_coverage_rate: agreement?.coverage_rate ?? null,
    best_full_blend: bestFullBlend,
    strategies,
    blend_sweep: blendSweep,
    sample_conflicts: rows
      .filter((row) => row.market_pick !== row.auxiliary_pick)
      .slice(0, 12)
      .map((row) => ({
        date: row.date,
        match: `${row.home} vs ${row.away}`,
        tier: row.tier,
        market_pick: row.market_pick,
        auxiliary_pick: row.auxiliary_pick,
        actual: row.actual
      }))
  };
}

function aggregateScenarios(scenarios) {
  const rows = [];
  for (const scenario of scenarios) {
    const strategyByKey = new Map(scenario.strategies.map((strategy) => [strategy.key, strategy]));
    for (const [key, strategy] of strategyByKey.entries()) {
      if (!rows.some((row) => row.key === key)) {
        rows.push({
          key,
          label: strategy.label,
          rows: 0,
          hits: 0,
          scenario_count: 0
        });
      }
      const aggregate = rows.find((row) => row.key === key);
      aggregate.rows += strategy.rows;
      aggregate.hits += strategy.hits;
      aggregate.scenario_count += 1;
    }
  }

  return rows.map((row) => ({
    ...row,
    accuracy: row.rows ? round(row.hits / row.rows, 4) : null
  }));
}

function renderMarkdown(report) {
  const lines = [
    '# Auxiliary Model Pretest',
    '',
    `Generated: ${report.generated_at}`,
    '',
    'This report connects the existing international national-team walk-forward model as an auxiliary reference to the market-first tournament backtests. It is a pretest only: no production model weights or database predictions are changed.',
    '',
    '## Verdict',
    '',
    report.verdict,
    '',
    '## Scenario Summary',
    '',
    '| Scenario | Rows | Market V1 | Agree gate | Lift | Coverage | Best full blend |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |'
  ];

  for (const scenario of report.scenarios) {
    const agreement = scenario.strategies.find((strategy) => strategy.key === 'market_auxiliary_agree');
    lines.push(
      `| ${scenario.label} | ${scenario.diagnostics.matched_rows}/${scenario.diagnostics.expected_rows} | ${pct(scenario.baseline_market_accuracy)} | ${pct(agreement?.accuracy)} | ${pct(scenario.agreement_accuracy_lift)} | ${pct(scenario.agreement_coverage_rate)} | ${scenario.best_full_blend.label}: ${pct(scenario.best_full_blend.accuracy)} |`
    );
  }

  lines.push(
    '',
    '## Aggregate Strategy Check',
    '',
    '| Strategy | Rows | Hits | Accuracy |',
    '| --- | ---: | ---: | ---: |'
  );
  for (const row of report.aggregate_strategies) {
    lines.push(`| ${row.label} | ${row.rows} | ${row.hits} | ${pct(row.accuracy)} |`);
  }

  for (const scenario of report.scenarios) {
    lines.push(
      '',
      `## ${scenario.label}`,
      '',
      '| Strategy | Rows | Coverage | Hits | Accuracy | Log loss |',
      '| --- | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const strategy of scenario.strategies) {
      lines.push(
        `| ${strategy.label} | ${strategy.rows} | ${pct(strategy.coverage_rate)} | ${strategy.hits} | ${pct(strategy.accuracy)} | ${strategy.log_loss ?? '--'} |`
      );
    }

    lines.push(
      '',
      '### Full-Coverage Blend Sweep',
      '',
      '| Auxiliary weight | Hits | Accuracy | Log loss |',
      '| ---: | ---: | ---: | ---: |'
    );
    for (const row of scenario.blend_sweep) {
      lines.push(`| ${Math.round(row.auxiliary_weight * 100)}% | ${row.hits}/${row.rows} | ${pct(row.accuracy)} | ${row.log_loss ?? '--'} |`);
    }
  }

  lines.push(
    '',
    '## Policy Note',
    '',
    '- Promote the auxiliary model as a confirmation and risk-control layer, not as a full replacement.',
    '- Full probability blending is treated as diagnostic until it beats the market baseline across multiple tournament samples.',
    '- When market and auxiliary disagree, current evidence says downgrade confidence rather than automatically switching sides.'
  );

  return `${lines.join('\n')}\n`;
}

function main() {
  const modelRows = readJson(MODEL_LEDGER).rows;
  const scenarios = SCENARIOS.map((scenario) => evaluateScenario(scenario, modelRows));
  const aggregateStrategies = aggregateScenarios(scenarios);
  const marketAggregate = aggregateStrategies.find((row) => row.key === 'market_v1_full');
  const agreementAggregate = aggregateStrategies.find((row) => row.key === 'market_auxiliary_agree');
  const agreementLift =
    agreementAggregate?.accuracy !== null && marketAggregate?.accuracy !== null
      ? round(agreementAggregate.accuracy - marketAggregate.accuracy, 4)
      : null;
  const verdict =
    agreementLift > 0
      ? `Auxiliary confirmation improves selected-match WDL hit rate by ${pct(agreementLift)} versus full market V1 on the combined 2022 World Cup + Euro 2024 sample, but coverage drops to ${pct(agreementAggregate.rows / marketAggregate.rows)}. It should be connected as a promotion/downgrade signal, not as an automatic override.`
      : 'Auxiliary confirmation does not improve the combined selected-match hit rate enough to promote. Keep it as a diagnostic only.';

  const report = {
    generated_at: new Date().toISOString(),
    source: {
      market_reports: SCENARIOS.map((scenario) => scenario.marketReport),
      auxiliary_ledger: MODEL_LEDGER,
      auxiliary_description:
        'Existing international national-team walk-forward model: Elo, goal/Poisson layer, tournament group selector, no betting odds.'
    },
    verdict,
    scenarios,
    aggregate_strategies: aggregateStrategies
  };

  writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(OUTPUT_MD, renderMarkdown(report));
  console.log(JSON.stringify({
    ok: scenarios.every((scenario) => scenario.diagnostics.complete),
    verdict,
    scenarios: scenarios.map((scenario) => ({
      key: scenario.key,
      rows: scenario.diagnostics.matched_rows,
      market: scenario.baseline_market_accuracy,
      agreement_lift: scenario.agreement_accuracy_lift,
      agreement_coverage: scenario.agreement_coverage_rate,
      best_full_blend: {
        label: scenario.best_full_blend.label,
        accuracy: scenario.best_full_blend.accuracy,
        log_loss: scenario.best_full_blend.log_loss
      }
    })),
    output: OUTPUT_JSON,
    markdown: OUTPUT_MD
  }, null, 2));
}

main();
