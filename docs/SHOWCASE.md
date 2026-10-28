# 世界杯概率研究工作台 · 项目展示

## 一句话介绍

让预测有据可查：从比赛输入、模型分析到结果复盘，保留完整研究路径。

## 项目价值

将球队强度、进球分布、市场概率、数据来源和赛后复盘组织在同一工作台中的足球赛事研究原型。

## 最值得展示的能力

- React 比赛表格、筛选排序、单场检查器及小组、淘汰赛、冠军概率等分析视图
- 球队强度、Poisson 比分分布、赔率去水和低权重规则修正组成的分层预测流水线
- SQLite 保存比赛、赔率快照、预测版本、结果、复盘与导入记录

## 展示依据

- package.json
- docs/phase-one-plan.md
- docs/data-source-audit.md
- server/model/index.mjs
- server/model/poisson.mjs
- server/services/oddsSourcePolicy.mjs
- server/services/probabilityUncertainty.mjs
- scripts/verify-model-integrity.mjs
- scripts/verify-evidence-manifest.mjs

## 说明范围

当前阶段：本地研究原型；含合成样例模式、来源审计与历史评估工具。

- seed 和 seed:sample 会重置该目录的 SQLite 业务表；不能对需要保留的研究数据库直接执行
- 合成样例、历史回测、受控预判和真实赛果各有不同证据边界，不把界面概率表述为已证明的预测能力或盈利能力
- 外部赔率、新闻、阵容与赛程资料会过期，本轮未联网复核；既有审计报告只表示其记录时的状态
- 历史评估和 verify 全套入口依赖额外研究数据与 reports；源码包不携带全部第三方网页、脚本缓存和原始数据
- 后端面向本地研究，未据此证明公开服务的身份验证、权限与运维能力
- 本轮未重新运行模型验证、历史回测或视觉验收

对外演示使用合成数据。源码、演示、历史验收记录与实时线上状态分别说明；任何效果数字都需要可追溯的测量记录。
