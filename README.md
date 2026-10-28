# 世界杯概率研究工作台

**让预测有据可查：从比赛输入、模型分析到结果复盘，保留完整研究路径。**

将球队强度、进球分布、市场概率、数据来源和赛后复盘组织在同一工作台中的足球赛事研究原型。

> 当前阶段：本地研究原型；含合成样例模式、来源审计与历史评估工具。本仓库为 2026-10-28 整理的源码快照，原项目继续保留在本地。

## 项目亮点

- React 比赛表格、筛选排序、单场检查器及小组、淘汰赛、冠军概率等分析视图
- 球队强度、Poisson 比分分布、赔率去水和低权重规则修正组成的分层预测流水线
- SQLite 保存比赛、赔率快照、预测版本、结果、复盘与导入记录
- 样例种子支持独立重建演示闭环；官方赛程输入与预测可用性分开处理
- 赔率来源分级、预判决策、概率不确定性和模型变更影响的检查入口

## 技术实现

React 19 · Vite 7 · JavaScript ES Modules · Node.js node:sqlite · SQLite · Lucide React · Python 赛程解析工具

- src/main.jsx
- src/App.jsx
- server/index.mjs
- server/model/index.mjs
- server/db/schema.sql
- scripts/dev.mjs

## 快速开始

需要支持 `node:sqlite` 的 Node.js（建议 22.13 或以上）。在新克隆的演示目录运行：

```bash
pnpm install --frozen-lockfile
pnpm seed:sample
pnpm dev
```

`seed:sample` 会重建当前目录的研究数据库，样例结果为合成数据。前端默认 `http://127.0.0.1:5173`，API 默认端口 `4177`。构建前端：

```bash
pnpm build
```

完整历史验证依赖另行准备的来源数据和报告；这个源码快照只包含必要结构化赛程与审计样例。

## 目录导航

```text
data/
docs/
index.html
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/
server/
src/
vite.config.js
```

## 交付状态与证据

- package.json
- docs/phase-one-plan.md
- docs/data-source-audit.md
- server/model/index.mjs
- server/model/poisson.mjs
- server/services/oddsSourcePolicy.mjs
- server/services/probabilityUncertainty.mjs
- scripts/verify-model-integrity.mjs
- scripts/verify-evidence-manifest.mjs

- seed 和 seed:sample 会重置该目录的 SQLite 业务表；不能对需要保留的研究数据库直接执行
- 合成样例、历史回测、受控预判和真实赛果各有不同证据边界，不把界面概率表述为已证明的预测能力或盈利能力
- 外部赔率、新闻、阵容与赛程资料会过期，本轮未联网复核；既有审计报告只表示其记录时的状态
- 历史评估和 verify 全套入口依赖额外研究数据与 reports；源码包不携带全部第三方网页、脚本缓存和原始数据
- 后端面向本地研究，未据此证明公开服务的身份验证、权限与运维能力
- 本轮未重新运行模型验证、历史回测或视觉验收

本次整理的核验结果见 [仓库状态](docs/REPOSITORY_STATUS.md)，项目介绍口径见 [展示说明](docs/SHOWCASE.md)。

## 协作与使用

- 安装依赖前核对项目所需运行时，配置文件使用示例值；凭据和真实业务数据不进入 Git。
- 提交与反馈请见 [CONTRIBUTING.md](CONTRIBUTING.md)；敏感问题处理见 [SECURITY.md](SECURITY.md)。
- 许可证与第三方资源见 [RIGHTS.md](RIGHTS.md)。公开访问不等于获得所有素材的再分发许可。
