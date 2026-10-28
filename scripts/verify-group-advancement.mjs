#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from '../server/db/connection.mjs';
import { Repository } from '../server/services/repository.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');
const OUTPUT_JSON = path.join(ROOT_DIR, 'reports/group-advancement-audit.json');

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function findTeam(groups, groupName, code) {
  return groups
    .find((group) => group.groupName === groupName)
    ?.rows.find((row) => row.code === code);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value ?? 0) * factor) / factor;
}

const db = openDatabase();
let summary;
try {
  const repository = new Repository(db);
  summary = repository.getSummary();
} finally {
  db.close();
}

const groups = Array.isArray(summary.groups) ? summary.groups : [];
const belgium = findTeam(groups, 'G', 'BEL');
const spain = findTeam(groups, 'H', 'ESP');
const groupG = groups.find((group) => group.groupName === 'G');
const groupH = groups.find((group) => group.groupName === 'H');
const totalAdvanceProbability = groups.reduce(
  (sum, group) => sum + group.rows.reduce((groupSum, row) => groupSum + Number(row.advanceProbability ?? 0), 0),
  0
);
const simulationCounts = groups.map((group) => Number(group.simulationCount ?? 0));
const methodSet = new Set(groups.map((group) => group.method));

check(groups.length === 12, '必须输出 12 个官方小组');
check(methodSet.size === 1 && methodSet.has('group_stage_simulation_top2_plus_best8_thirds'), '小组出线必须使用前二+最佳第三模拟方法');
check(simulationCounts.every((count) => count >= 10000), '每组模拟次数必须至少 10000');
check(Math.abs(totalAdvanceProbability - 3200) <= 8, `全赛事晋级概率总和应接近 3200%，实际 ${round(totalAdvanceProbability, 2)}%`);
check(belgium?.rank <= 2, '比利时在 G 组期望排名应进入前二');
check(spain?.rank === 1, '西班牙在 H 组期望排名应为第一');
check(Number(belgium?.advanceProbability ?? 0) >= 75, '比利时晋级 32 强概率不应落在旧模板低位');
check(Number(spain?.advanceProbability ?? 0) >= 90, '西班牙晋级 32 强概率不应落在旧模板低位');
check(Number(belgium?.pts ?? 0) > 0 && Number(spain?.pts ?? 0) > 0, 'G/H 组必须基于赛前概率生成期望积分');
check(Number(belgium?.elo ?? 1600) !== 1600 && Number(spain?.elo ?? 1600) !== 1600, '比利时和西班牙不能继续使用中立 1600 强度');

const report = {
  ok: failures.length === 0,
  generatedAt: new Date().toISOString(),
  file: 'reports/group-advancement-audit.json',
  method:
    '复算小组赛 72 场：已入库盘口场次使用市场预判概率，其余场次使用国际赛当前强度先验；每次模拟取小组前二和 12 个第三名中的最佳 8 队晋级 32 强。',
  summary: {
    groups: groups.length,
    simulationCount: simulationCounts[0] ?? 0,
    totalAdvanceProbability: round(totalAdvanceProbability, 2),
    expectedKnockoutSlots: 32
  },
  focus: {
    groupG,
    groupH,
    belgium: belgium
      ? {
          rank: belgium.rank,
          advanceProbability: belgium.advanceProbability,
          pts: belgium.pts,
          gd: belgium.gd,
          elo: belgium.elo
        }
      : null,
    spain: spain
      ? {
          rank: spain.rank,
          advanceProbability: spain.advanceProbability,
          pts: spain.pts,
          gd: spain.gd,
          elo: spain.elo
        }
      : null
  },
  guardrails: {
    officialGroupCount: groups.length === 12,
    simulationMethodApplied: methodSet.has('group_stage_simulation_top2_plus_best8_thirds'),
    enoughSimulationRuns: simulationCounts.every((count) => count >= 10000),
    totalSlotsReconcile: Math.abs(totalAdvanceProbability - 3200) <= 8,
    belgiumNoLongerTemplateLow: Number(belgium?.advanceProbability ?? 0) >= 75,
    spainNoLongerTemplateLow: Number(spain?.advanceProbability ?? 0) >= 90,
    strengthPriorsApplied:
      Number(belgium?.elo ?? 1600) !== 1600 &&
      Number(spain?.elo ?? 1600) !== 1600
  },
  failures
};

fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);

if (failures.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      report: report.file,
      belgium: report.focus.belgium,
      spain: report.focus.spain,
      totalAdvanceProbability: report.summary.totalAdvanceProbability
    },
    null,
    2
  )
);
