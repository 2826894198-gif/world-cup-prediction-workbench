# 仓库状态

- 整理日期：2026-10-28（Asia/Shanghai）。
- 当前阶段：本地研究原型；含合成样例模式、来源审计与历史评估工具。
- 来源：本地项目的选择性源码导出；原目录与原 Git 历史保留，首次 GitHub 快照不包含原目录全部历史。
- 本次只做源码归类、文档、配置可移植性和演示数据整理；没有执行生产部署或真实业务操作。
- 依赖、构建产物、备份、凭据与真实业务数据未纳入；原 CI/CD 不自动启用，以免上传源码触发部署。
- 本次检查见 [VALIDATION.md](VALIDATION.md)；原始文档记录的历史测试不计为本次重跑。

## 已知限制

- seed 和 seed:sample 会重置该目录的 SQLite 业务表；不能对需要保留的研究数据库直接执行
- 合成样例、历史回测、受控预判和真实赛果各有不同证据边界，不把界面概率表述为已证明的预测能力或盈利能力
- 外部赔率、新闻、阵容与赛程资料会过期，本轮未联网复核；既有审计报告只表示其记录时的状态
- 历史评估和 verify 全套入口依赖额外研究数据与 reports；源码包不携带全部第三方网页、脚本缓存和原始数据
- 后端面向本地研究，未据此证明公开服务的身份验证、权限与运维能力
- 本轮未重新运行模型验证、历史回测或视觉验收

## 本次调整

- 见源码及项目原始说明。

## Staging validation - 2026-10-28

- README command blocks; renamed a result-mapping variable without changing behavior.
- JS/MJS syntax: 48 files passed.
- In-memory esbuild bundle: 2 output files.
- SQLite in-memory sample seed: 104 synthetic fixtures and prediction rows.
- Four concept/historical sample screenshots inspected; no personal account information found.
- Gitleaks 8.30.1 default-rule scan: zero findings. This is not a full security audit.

## 本次验证

详见 [实际验证结果](VALIDATION.md)。
