# 数据来源与准确性审核

审核日期：2026-06-12

## 结论

当前 2026 世界杯赛程层已从 FIFA 官方赛程页、Inside FIFA 发布页和官方 PDF 解析为本地结构化数据：104 场比赛，日期范围为 2026-06-11 至 2026-07-19，覆盖 16 个赛区。应用内比赛列表不再使用第三方缓存赛程或合成赛程。

但 2026 预测层仍保持受控预判：只有存在完整、可追溯赛前盘口快照的场次才显示预判；阵容新闻、伤停、天气和临场输入未齐前，不放开串关、投注建议或公开产品口径。这是数据质量保护，不是模型结论。已完赛结果只进入 `results` 和复盘/小组表，不反向生成赛前预测。

## 官方赛程来源

- FIFA 官方赛程页：https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums
- Inside FIFA 104 场赛程发布页：https://inside.fifa.com/organisation/media-releases/updated-world-cup-2026-match-schedule-venues-kick-off-times-104-matches
- FIFA 官方赛程 PDF：https://digitalhub.fifa.com/asset/4b5d4417-3343-4732-9cdf-14b6662af407/FWC26-Match-Schedule_English.pdf
- 本地 PDF 缓存：`data/research/worldcup-2026/FWC26-Match-Schedule_English.pdf`
- 本地结构化赛程：`data/research/worldcup-2026/official-schedule.json`
- 解析器：`scripts/parse-official-2026-schedule.py`

## 当前本地来源

- 赛程：从 FIFA 官方 PDF 解析，包含比赛编号、阶段、ET 日期和开球时间、UTC 时间、赛区、小组、球队代码或淘汰赛占位符。
- 球队：小组赛球队来自官方 fixture team codes；当前仅用于显示和建表，未声称完整替代官方参赛队资料库。
- 球队强度：`server/data/sampleData.mjs` 对官方 fixture codes 建立中立占位强度，目的是让 UI 可显示球队卡片；该强度不生成 2026 预测。
- 赔率盘口：当前 SQLite 中有 469 条盘口相关快照，其中 141 条为 `european_bookmaker_public_snapshot`，可作为受控预判输入；328 条 `dongqiudi_odds_index` 只保留为盘口索引/审计参考，不作为预测源。
- 预测快照：当前 16 场有受控预判，均需继续补阵容、新闻和临场输入；Match 1 已标记为 `finished`；其余无完整输入的场次状态保持 `official_schedule_prediction_blocked`。
- 赛果复盘：Match 1 已按公开赛果手动写入 `results`，墨西哥 2-0 南非；其余 103 场不生成合成赛果。
- 赛果来源：ESPN/AP/Guardian 交叉确认；本地结构化源为 `server/data/officialResults.mjs`，导入器为 `server/db/officialResults.mjs`。
- 非官方缓存：`martj42/international_results` 中未来 2026 世界杯行只作为问题样本记录，不进入训练、预测或页面输出。

## 非官方未来行隔离

`martj42/international_results` 是历史国家队赛果源，不是 2026 世界杯官方赛程源。该缓存中出现的 2026 世界杯缺比分行会被 `scripts/evaluate-international.mjs` 写入 `source_quarantine`，规则如下：

- 只要比分缺失，就在热身、逐场评估、赛前友谊赛审计和未来预测输出之前隔离。
- 2026 世界杯赛程只信任 `data/research/worldcup-2026/official-schedule.json`，该文件由 FIFA 官方页面、发布页和 PDF 审计。
- `future_predictions` 必须保持 0 行，直到接入真实赔率、阵容新闻、伤停和赛前状态输入。
- `scripts/verify-model-integrity.mjs` 会强制检查隔离行数、隔离样本、官方来源和“不使用第三方 2026 fixture”的布尔字段。

## 关键官方锚点

- Match 1：MEX vs RSA，2026-06-11 15:00 ET，Mexico City；已完赛，墨西哥 2-0 南非，胜平负结果为主胜。当前未接入该场真实赛前盘口时，赢盘/输盘和大小球只标记为待结算。
- Match 2：KOR vs CZE，2026-06-11 22:00 ET，Guadalajara。
- Match 3：CAN vs BIH，2026-06-12 15:00 ET，Toronto。
- Match 4：USA vs PAR，2026-06-12 21:00 ET，Los Angeles。
- Match 73：2A vs 2B，2026-06-28 15:00 ET，Los Angeles。
- Match 89：W74 vs W77，2026-07-04 17:00 ET，Philadelphia。
- Match 101：W97 vs W98，2026-07-14 15:00 ET，Dallas。
- Match 102：W99 vs W100，2026-07-15 15:00 ET，Atlanta。
- Match 104：Winner Match 101 vs Winner Match 102，2026-07-19 15:00 ET，New York New Jersey。

完整校验锚点记录在 `data/research/worldcup-2026/source-audit.json` 和 `scripts/verify-2026-schedule.mjs`。

## 真实历史评估来源

- 国家队赛果：`scripts/evaluate-international.mjs` 从 https://github.com/martj42/international_results 获取男子国家队已完赛结果，并缓存到 `data/research/international-results/results.csv`。
- 评估方式：从 1990-01-01 起热身，从 2002-01-01 起逐场走步评估；每场比赛先预测，再用实际比分更新 Elo、进球均值、平局校准和在线模型选择器。
- 消融检查：报告拆分 Elo-only、进球模型、原始混合、全局平局校准、生产用混合层和在线主模型，避免把事后组合当成固定结论。
- 大赛阶段检查：世界杯、欧洲杯和美洲杯正赛再拆成小组赛与淘汰赛切片，用于判断 2026 应用场景是否合理；阶段标签只进入报告，不作为预测特征。
- 防泄漏规则：比分缺失或未来赛程行不进入训练和评估；官方 2026 赛程单独解析和审计。
- 当前输出：`reports/international-model-evaluation.md` 与 `reports/international-model-evaluation.json`。

## 五大联赛代理评估来源

- 俱乐部赛果和赔率：`scripts/evaluate-historical.mjs` 从 https://www.football-data.co.uk/ 使用 2021/22 至 2025/26 的英超、西甲、德甲、意甲和法甲 CSV，并缓存到 `data/research/football-data/`。
- 覆盖范围：25 个 CSV，五个赛季乘五个联赛；当前报告包含 8,907 场已评估比赛。
- 评估方式：每个联赛内逐场走步，先用赛前状态和盘口概率预测，再用实际比分更新球队状态、进球均值、Elo、平局校准和在线选择器。
- 盘口供应商检查：报告拆分 Market average、Market maximum、bet365、Pinnacle、Betfair Exchange 等 provider 的 log loss、命中率、overround、赛季稳定性和联赛稳定性。
- 开盘到收盘检查：对有 opening/closing odds 的比赛记录概率移动、log loss lift、pick change rate 和改判净准确率，用于判断市场变化是否能作为赛前信号。
- 使用边界：五大联赛数据只作为“赔率市场和模型融合习惯”的代理验证，不直接替代国家队、世界杯赛制、国家队阵容和中立场数据。
- 当前输出：`reports/historical-model-evaluation.md` 与 `reports/historical-model-evaluation.json`。

## 准确性评级

- 2026 赛程准确性：高。来源为 FIFA 官方页面和 PDF，本地校验 104 场、比赛编号 1-104、阶段计数、日期范围、16 个赛区和关键场次锚点。
- 2026 预测准确性：受控预判。已有完整盘口快照的 16 场可以展示概率和盘口输出；缺少完整输入的场次继续阻断。
- 真实赔率准确性：中低。已有公开盘口快照进入 SQLite，但仍需补 provider 原始记录、阵容新闻、伤停和临场更新审计。
- 应用内 2026 准确率：当前只有 Match 1 一个已完赛可回看样本，赛前预判命中主胜且盘口方向命中；样本量为 1，不能外推为稳定模型准确率。
- 独立历史回测能力：中。已有真实国际赛逐场走步验证，也有五大联赛真实赔率代理评估；但 2026 世界杯层还没有加入真实赛前赔率、球员、伤停、旅行休整和阵容新闻。

## 验证命令

```bash
python3 scripts/parse-official-2026-schedule.py
node scripts/evaluate-historical.mjs
node scripts/evaluate-international.mjs
node --experimental-sqlite server/db/seed.mjs
node --experimental-sqlite scripts/import-official-results.mjs
node scripts/verify-historical-integrity.mjs
node scripts/verify-model-integrity.mjs
node --experimental-sqlite scripts/verify-2026-schedule.mjs
node node_modules/vite/bin/vite.js build
```

如果 `npm` 在 PATH 中，也可以使用 `package.json` 中的别名：`npm run evaluate:historical`、`npm run evaluate:international`、`npm run seed`、`npm run import:results`、`npm run verify:historical`、`npm run verify:model`、`npm run verify:schedule`、`npm run verify`、`npm run build`。

五大联赛完整性校验（`node scripts/verify-historical-integrity.mjs` 或 `npm run verify:historical`）会检查：

- football-data.co.uk 来源 URL、五个赛季、五大联赛、25 个本地 CSV 和报告行数是否完全对应。
- 每个赛季和每个联赛的逐场评估样本数是否等于原始 CSV 行数。
- 市场、模型、混合、adaptive pick 和 movement-aware pick 的 log loss、Brier、准确率、校准和概率分布是否自洽。
- Avg、Max、bet365、Pinnacle、Betfair Exchange 等关键 provider 是否存在，primary provider 覆盖数是否等于总评估场次。
- 开盘到收盘的盘口移动指标是否覆盖大多数比赛，并校验 lift 字段是否由 opening/closing 指标直接计算得出。
- 样本预测行的胜平负概率是否归一，实际结果、选择结果和盘口列是否结构有效。

模型完整性校验（`node scripts/verify-model-integrity.mjs` 或 `npm run verify:model`）会检查：

- 国际赛原始 CSV 来源、缓存行数、授权声明、热身窗口和逐场评估窗口。
- 世界杯、欧洲杯、美洲杯、友谊赛等切片的样本量、概率归一、log loss、Brier、校准和准确率字段。
- 2026 世界杯前友谊赛的最新 24 场样本、181 场完整窗口，以及 2002-2022 六届赛前友谊赛对照窗口。
- 每条审计样本的赛前概率、实际比分、胜平负结果和预测选择是否一致。
- 上游未来 2026 世界杯缺比分行是否被 `source_quarantine` 隔离，且没有被当成官方赛程、训练数据或预测输入。
- 2026 官方赛程预测是否仍为阻断状态，并与官方赛程 JSON 的 104 场、阶段计数、日期范围和来源 URL 保持一致。

官方赛程数据库校验（`node --experimental-sqlite scripts/verify-2026-schedule.mjs` 或 `npm run verify:schedule`）会检查：

- `official-schedule.json` 的官方来源、104 场、日期范围、阶段计数和关键场次。
- `reports/international-model-evaluation.json` 中 2026 未来预测数量为 0。
- SQLite 中 `matches` 为 104 行，Match 1 状态为 `finished` 且 `results` 为墨西哥 2-0 南非；当前官方库有 469 条盘口相关快照、16 条受控预判。
- 预判只能使用可信盘口快照；未接入完整盘口、阵容、伤停、新闻和临场输入的场次继续阻断。

## 下一步真实数据优先级

1. 接入可追溯赔率源，保留 provider、盘口类型、采集时间、原始快照和 implied probability。
2. 接入官方或可靠阵容、伤停、停赛、赛前新闻和球员状态来源。
3. 接入赛前友谊赛、旅行休整、俱乐部负荷和主客/中立场因素，作为独立 feature layer。
4. 对每个新 feature layer 做逐场走步验证，只有在相关切片上改善 log loss、Brier 或校准时才提升权重。
5. 2026 比赛开赛后只用赛前已知数据预测，再用赛果复盘，不允许回看后固定结论。
