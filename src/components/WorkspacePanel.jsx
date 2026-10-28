import {
  Activity,
  AlertTriangle,
  BarChart3,
  Beaker,
  CheckCircle2,
  DatabaseZap,
  FileClock,
  GitCompare,
  Gauge,
  LineChart,
  RefreshCw,
  ServerCog,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trophy,
  XCircle
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { percent, signed, stageName } from '../lib/format.js';

function PanelHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="panel-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <Icon size={22} />
    </div>
  );
}

const knockoutStages = [
  { key: 'round32', title: '32强', gridSpan: 1 },
  { key: 'round16', title: '16强', gridSpan: 2 },
  { key: 'quarterfinal', title: '8强', gridSpan: 4 },
  { key: 'semifinal', title: '4强', gridSpan: 8 }
];

const centerStage = { key: 'final', title: '决赛' };

function toPercentNumber(value) {
  if (typeof value === 'number') return Math.max(0, Math.min(100, value));
  const parsed = Number.parseFloat(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function formatPathPercent(value) {
  if (value == null || value === '') return '--';
  const numericValue = toPercentNumber(value);
  const formatted = Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(1);
  return `${formatted}%`;
}

function pickLabel(path) {
  const rawPick = typeof path?.pick === 'string' ? path.pick.trim() : '';
  return rawPick || '待接入';
}

function hasUsablePrediction(path) {
  const label = pickLabel(path);
  if (label === '待接入') return false;
  if (path?.hasPrediction != null) return path.hasPrediction === true;
  return true;
}

function splitFixture(fixture) {
  const [home, away] = String(fixture).split(' vs ');
  return {
    home: home || fixture,
    away: away || ''
  };
}

function officialFixtureText(row) {
  if (!row) return 'TBD vs TBD';
  if (row.fixture) return row.fixture;
  if (row.label) return row.label;
  const home = row.home_code ?? row.homePlaceholder ?? row.home_placeholder;
  const away = row.away_code ?? row.awayPlaceholder ?? row.away_placeholder;
  if (home || away) return `${home ?? 'TBD'} vs ${away ?? 'TBD'}`;
  return 'TBD vs TBD';
}

function dateSpanText(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(' → ') : '--';
}

function metricTone(path) {
  const confidence = toPercentNumber(path.confidence);
  const risk = toPercentNumber(path.upsetRisk);
  if (risk >= 55) return 'danger';
  if (confidence >= 56) return 'strong';
  if (confidence >= 48) return 'steady';
  return 'watch';
}

function BracketCard({ path, isFinal = false }) {
  const fixture = splitFixture(path.fixture);
  const selectedPick = pickLabel(path);
  const hasPrediction = hasUsablePrediction(path);
  const confidence = hasPrediction ? toPercentNumber(path.confidence) : 0;
  const risk = hasPrediction ? toPercentNumber(path.upsetRisk) : 0;
  const confidenceLabel = hasPrediction ? formatPathPercent(path.confidence) : '--';
  const riskLabel = hasPrediction ? formatPathPercent(path.upsetRisk) : '--';
  return (
    <article
      className={`bracket-card ${hasPrediction ? metricTone(path) : 'blocked'} ${isFinal ? 'final-card' : ''}`}
      style={{ '--confidence': `${confidence}%`, '--risk': `${risk}%` }}
    >
      <header>
        <span>#{path.matchNo}</span>
        <strong>{stageName(path.stage)}</strong>
      </header>
      <div className="bracket-fixture">
        <span>{fixture.home}</span>
        <em>vs</em>
        <span>{fixture.away}</span>
      </div>
      <footer>
        <span>{selectedPick}</span>
        <i>{hasPrediction ? `信心 ${confidenceLabel}` : '未接入'}</i>
      </footer>
      <div className="bracket-meter" aria-label={`冷门风险 ${riskLabel}`}>
        <i />
      </div>
    </article>
  );
}

function BracketWingColumn({ stage, matches, side }) {
  return (
    <div className={`bracket-column ${side}`}>
      <div className={`bracket-stage-head ${side}`}>
        <strong>{stage.title}</strong>
        <span>{matches.length} 场</span>
      </div>
      <div className="bracket-stage-grid">
        {matches.map((path, index) => {
          const gridSpan = stage.gridSpan * 2;
          const linkClass = matches.length <= 1 ? 'link-single' : index % 2 === 0 ? 'link-top' : 'link-bottom';
          return (
            <div
              className={`bracket-slot ${side} ${linkClass}`}
              key={path.matchNo}
              style={{ gridRow: `${index * gridSpan + 1} / span ${gridSpan}` }}
            >
              <BracketCard path={path} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketCenter({ finalPath }) {
  return (
    <div className="bracket-center" aria-label="决赛中轴">
      <div className="bracket-stage-head center">
        <strong>{centerStage.title}</strong>
        <span>{finalPath ? '1 场' : '等待'}</span>
      </div>
      <div className="bracket-center-body">
        {finalPath ? (
          <BracketCard path={finalPath} isFinal />
        ) : (
          <div className="empty-panel compact">
            <strong>决赛待生成</strong>
            <span>等待官方淘汰赛槽位。</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function GroupsView({ groups }) {
  return (
    <section className="workspace-panel">
      <PanelHeader icon={Gauge} title="小组赛官方分组" subtitle="官方赛程 + 国家队历史强度 + 已有盘口快照复算；出线按前二和最佳 8 个第三晋级 32 强模拟。" />
      <div className="group-grid">
        {groups?.map((group) => (
          <article className="group-card" key={group.groupName}>
            <h2>{group.groupName}组</h2>
            <table>
              <thead>
                <tr>
                  <th>排</th>
                  <th>球队</th>
                  <th>分</th>
                  <th>净</th>
                  <th>出线</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.team}>
                    <td>{row.rank}</td>
                    <td>{row.team}</td>
                    <td>{row.pts}</td>
                    <td>{row.gd}</td>
                    <td>{row.advanceProbability}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
    </section>
  );
}

export function KnockoutView({ paths }) {
  const orderedPaths = [...(paths ?? [])].sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0));
  const stageWings = knockoutStages.map((stage) => {
    const matches = orderedPaths.filter((path) => path.stage === stage.key);
    const midpoint = Math.ceil(matches.length / 2);
    return {
      ...stage,
      left: matches.slice(0, midpoint),
      right: matches.slice(midpoint)
    };
  });
  const finalPath = orderedPaths.find((path) => path.stage === centerStage.key);
  const rightWingStages = [...stageWings].reverse();
  const leftMatchCount = stageWings.reduce((sum, stage) => sum + stage.left.length, 0);
  const rightMatchCount = stageWings.reduce((sum, stage) => sum + stage.right.length, 0);
  const thirdPlace = orderedPaths.find((path) => path.stage === 'third_place');
  const thirdPlaceHasPrediction = hasUsablePrediction(thirdPlace);
  const totalMatches = orderedPaths.length;
  const predictedPaths = orderedPaths.filter((path) => path.hasPrediction);
  const averageConfidence =
    predictedPaths.length > 0
      ? Math.round(predictedPaths.reduce((sum, path) => sum + toPercentNumber(path.confidence), 0) / predictedPaths.length)
      : null;

  return (
    <section className="workspace-panel">
      <PanelHeader icon={GitCompare} title="淘汰赛官方槽位" subtitle="来自 FIFA 官方淘汰赛槽位；未接入小组赛实时排名和预测输入前不推断晋级路径。" />
      <div className="knockout-overview">
        <article>
          <span>淘汰赛槽位</span>
          <strong>{totalMatches}</strong>
        </article>
        <article>
          <span>预测输出</span>
          <strong>{predictedPaths.length}</strong>
        </article>
        <article>
          <span>平均信心</span>
          <strong>{averageConfidence == null ? '--' : `${averageConfidence}%`}</strong>
        </article>
        <article className="wide">
          <span>左右半区</span>
          <strong>{leftMatchCount} / {rightMatchCount} 场 · 决赛 {finalPath ? `#${finalPath.matchNo}` : '等待'}</strong>
        </article>
      </div>
      <div className="bracket-scroll" aria-label="淘汰赛左右半区路径" role="region">
        <div className="bracket-board" aria-label="左半区通向中间决赛，右半区从中间决赛展开">
          <div className="bracket-half left" aria-label="左半区路径">
            {stageWings.map((stage) => (
              <BracketWingColumn
                key={`left-${stage.key}`}
                stage={stage}
                matches={stage.left}
                side="left"
              />
            ))}
          </div>
          <BracketCenter finalPath={finalPath} />
          <div className="bracket-half right" aria-label="右半区路径">
            {rightWingStages.map((stage) => (
              <BracketWingColumn
                key={`right-${stage.key}`}
                stage={stage}
                matches={stage.right}
                side="right"
              />
            ))}
          </div>
        </div>
      </div>
      {thirdPlace && (
        <div className="placement-strip">
          <div>
            <span>三四名决赛</span>
            <strong>#{thirdPlace.matchNo} {thirdPlace.fixture}</strong>
          </div>
          <em className={thirdPlaceHasPrediction ? '' : 'blocked-pick'}>{thirdPlace.pick}</em>
          <i>{thirdPlaceHasPrediction ? `信心 ${formatPathPercent(thirdPlace.confidence)}` : '预测待接入'}</i>
          <i>{thirdPlaceHasPrediction ? `风险 ${formatPathPercent(thirdPlace.upsetRisk)}` : '风险待评估'}</i>
        </div>
      )}
      <div className="bracket-legend">
        <span><i className="blocked" />待接入</span>
        <span><i className="strong" />高信心</span>
        <span><i className="steady" />均衡</span>
        <span><i className="danger" />高冷门风险</span>
      </div>
    </section>
  );
}

export function ChampionView({ champions }) {
  return (
    <section className="workspace-panel">
      <PanelHeader icon={Trophy} title="冠军概率" subtitle="未接入官方赔率、阵容和赛前输入前，冠军概率不输出。" />
      <div className="champion-list">
        {champions?.length ? champions.map((team) => (
          <article className="champion-row" key={team.team}>
            <span>{team.rank}</span>
            <div>
              <strong>{team.team}</strong>
              <small>{team.groupName}组 · Elo {team.elo}</small>
            </div>
            <div className="champion-bars">
              <label>
                冠军
                <i style={{ width: `${team.championProbability * 3}%` }} />
                <b>{team.championProbability}%</b>
              </label>
              <label>
                进决赛
                <i style={{ width: `${team.finalProbability * 2}%` }} />
                <b>{team.finalProbability}%</b>
              </label>
            </div>
          </article>
        )) : (
          <div className="empty-panel">
            <strong>冠军概率已阻断</strong>
            <span>等待可靠预测输入后再生成概率榜。</span>
          </div>
        )}
      </div>
    </section>
  );
}

const parlayPoolOptions = [
  ['all', '全部玩法'],
  ['胜平负', '胜平负'],
  ['让球胜平负', '让球'],
  ['总进球', '进球数'],
  ['比分', '比分']
];

const parlayModeOptions = [
  ['all', '全部组合'],
  ['anchor', '单场参考'],
  ['single', '单关'],
  ['all-up-2', '2串1'],
  ['mixed', '混合过关']
];

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parlaySummaryCards(parlays, options, type) {
  return options.map(([value, label]) => {
    const matching =
      value === 'all'
        ? parlays
        : parlays.filter((combo) =>
            type === 'pool'
              ? combo.legs?.some((leg) => leg.pool === value)
              : value === 'mixed'
                ? String(combo.type ?? '').startsWith('mixed')
                : combo.type === value
          );
    const legs = matching.flatMap((combo) =>
      type === 'pool' && value !== 'all'
        ? (combo.legs ?? []).filter((leg) => leg.pool === value)
        : combo.legs ?? []
    );
    const bestCombo = matching.toSorted(
      (left, right) => numberValue(right.valueScore, -99) - numberValue(left.valueScore, -99)
    )[0];
    const bestLeg = legs.toSorted(
      (left, right) => numberValue(right.edge, -99) - numberValue(left.edge, -99)
    )[0];
    return {
      value,
      label,
      comboCount: matching.length,
      legCount: legs.length,
      bestEdge: numberValue(bestLeg?.edge, null),
      bestValue: numberValue(bestCombo?.valueScore, null),
      bestText: bestLeg ? `${bestLeg.pool} · ${bestLeg.pick}` : '暂无候选'
    };
  });
}

function yuan(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(numeric % 1 === 0 ? 0 : 2)}元` : '--';
}

function parlayPoolMix(combo) {
  return combo?.calculator?.poolMix || [...new Set((combo?.legs ?? []).map((leg) => leg.pool))].join(' + ');
}

function strongestMetric(cards) {
  return Math.max(
    0.001,
    ...cards.map((card) => Math.max(numberValue(card.bestEdge), numberValue(card.bestValue), 0))
  );
}

function ParlayVisualFilter({ title, cards, activeValue, onChange }) {
  const maxMetric = strongestMetric(cards);
  return (
    <div className="parlay-visual-filter" aria-label={title}>
      <div className="parlay-filter-title">
        <span>{title}</span>
        <strong>{cards.find((card) => card.value === activeValue)?.label ?? '全部'}</strong>
      </div>
      <div className="parlay-filter-cards">
        {cards.map((card) => {
          const metric = Math.max(numberValue(card.bestEdge), numberValue(card.bestValue), 0);
          const strength = Math.max(4, Math.min(100, (metric / maxMetric) * 100));
          return (
            <button
              className={`parlay-filter-card ${activeValue === card.value ? 'active' : ''}`}
              key={card.value}
              onClick={() => onChange(card.value)}
              style={{ '--strength': `${strength}%` }}
              type="button"
            >
              <span>{card.label}</span>
              <strong>{card.comboCount}</strong>
              <small>{card.legCount} 腿 · 最佳 {card.bestEdge == null ? '--' : signed(card.bestEdge, 3)}</small>
              <em>{card.bestText}</em>
              <i aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ParlayView({ parlays }) {
  const [poolFilter, setPoolFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const poolCards = useMemo(
    () => parlaySummaryCards(parlays ?? [], parlayPoolOptions, 'pool'),
    [parlays]
  );
  const modeCards = useMemo(
    () => parlaySummaryCards(parlays ?? [], parlayModeOptions, 'mode'),
    [parlays]
  );
  const filteredParlays = useMemo(
    () =>
      (parlays ?? []).filter((combo) => {
        if (modeFilter !== 'all') {
          const isMixed = String(combo.type ?? '').startsWith('mixed');
          if (modeFilter === 'mixed' ? !isMixed : combo.type !== modeFilter) return false;
        }
        if (poolFilter === 'all') return true;
        return combo.legs?.some((leg) => leg.pool === poolFilter);
      }),
    [modeFilter, parlays, poolFilter]
  );

  return (
    <section className="workspace-panel">
      <PanelHeader icon={Target} title="串关组合筛选" subtitle="接入体彩计算器胜平负、让球、总进球和比分；按单关、2串1和混合过关输出观察组合。" />
      <div className="parlay-filter-board">
        <ParlayVisualFilter title="玩法分布" cards={poolCards} activeValue={poolFilter} onChange={setPoolFilter} />
        <ParlayVisualFilter title="组合类型" cards={modeCards} activeValue={modeFilter} onChange={setModeFilter} />
      </div>
      <div className="parlay-grid">
        {filteredParlays?.length ? filteredParlays.map((combo) => (
          <article className="parlay-card" key={combo.id}>
            <div className="parlay-head">
              <div>
                <strong>{combo.name}</strong>
                <small>{combo.calculator?.source ?? '体彩计算器'} · {combo.calculator?.passType ?? combo.mode}</small>
              </div>
              <span>{combo.calculator?.poolCount > 1 ? '真实混合' : combo.riskBudget}</span>
            </div>
            <div className="parlay-ticket">
              <div>
                <span>玩法组合</span>
                <strong>{parlayPoolMix(combo) || '--'}</strong>
              </div>
              <div>
                <span>过关方式</span>
                <strong>{combo.calculator?.passType ?? combo.mode}</strong>
              </div>
              <div>
                <span>注数/倍数</span>
                <strong>{combo.calculator?.betCount ?? 1}注 × {combo.calculator?.multiple ?? 1}倍</strong>
              </div>
              <div>
                <span>投入/返奖</span>
                <strong>{yuan(combo.calculator?.totalStake)} / {yuan(combo.calculator?.estimatedReturn)}</strong>
              </div>
            </div>
            {combo.legs.map((leg) => (
              <div className="leg-row" key={`${combo.id}-${leg.matchNo}`}>
                <span>{leg.matchNum ?? `#${leg.matchNo}`}</span>
                <p>{leg.fixture}</p>
                <strong>{leg.pool} · {leg.pick}</strong>
                <em>赔 {leg.odds} · 概 {leg.probability}% · {signed(leg.edge, 3)}</em>
              </div>
            ))}
            <footer>
              <span>组合概率 {combo.probability}%</span>
              <span>赔率 {combo.impliedOdds}</span>
              <strong>{signed(combo.valueScore, 3)}</strong>
            </footer>
          </article>
        )) : (
          <div className="empty-panel">
            <strong>串关组合已阻断</strong>
            <span>{parlays?.length ? '当前筛选下没有组合。' : '等待体彩计算器玩法、完整盘口和模型预测同时可用。'}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function reviewPercent(value, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? percent(value, digits) : '--';
}

function reviewNumber(value) {
  return Number.isFinite(Number(value)) ? String(value) : '--';
}

function friendlyLedgerRowKey(row, index) {
  return `${row.date}-${row.fixture}-${index}`;
}

function filterFriendlyRows(rows, filter) {
  if (filter === 'worldcup') return rows.filter((row) => row.worldCupRelevance?.involved);
  if (filter === 'hit') return rows.filter((row) => row.correct);
  if (filter === 'miss') return rows.filter((row) => !row.correct);
  return rows;
}

function friendlyHitSummary(rows) {
  const hits = rows.filter((row) => row.correct).length;
  const scoreRows = rows.filter((row) => friendlyScoreReview(row).generated);
  const goalPrimaryHits = scoreRows.filter((row) => friendlyScoreReview(row).goalPrimaryHit).length;
  const goalCandidateHits = scoreRows.filter((row) => friendlyScoreReview(row).goalCandidateHit).length;
  const scorePrimaryHits = scoreRows.filter((row) => friendlyScoreReview(row).scorePrimaryHit).length;
  const scoreCandidateHits = scoreRows.filter((row) => friendlyScoreReview(row).scoreCandidateHit).length;
  return {
    matches: rows.length,
    hits,
    misses: rows.length - hits,
    accuracy: rows.length ? hits / rows.length : null,
    scoreReview: {
      rows: scoreRows.length,
      goalPrimaryHits,
      goalCandidateHits,
      scorePrimaryHits,
      scoreCandidateHits,
      goalPrimaryAccuracy: scoreRows.length ? goalPrimaryHits / scoreRows.length : null,
      goalCandidateAccuracy: scoreRows.length ? goalCandidateHits / scoreRows.length : null,
      scorePrimaryAccuracy: scoreRows.length ? scorePrimaryHits / scoreRows.length : null,
      scoreCandidateAccuracy: scoreRows.length ? scoreCandidateHits / scoreRows.length : null
    }
  };
}

function confidenceBandRows(rows) {
  const bands = [
    { key: 'high', label: '高信心', test: (value) => value >= 0.6 },
    { key: 'mid', label: '中信心', test: (value) => value >= 0.5 && value < 0.6 },
    { key: 'low', label: '低信心', test: (value) => value < 0.5 }
  ];
  return bands.map((band) => {
    const bandRows = rows.filter((row) => band.test(Number(row.confidence ?? 0)));
    const summary = friendlyHitSummary(bandRows);
    return { ...band, ...summary };
  });
}

function flattenFriendlyFixtures(row) {
  const fixtures = row?.worldCupRelevance?.officialFixtures ?? [];
  return fixtures.flatMap((team) =>
    (team.nextFixtures ?? []).slice(0, 2).map((fixture) => ({
      ...fixture,
      teamCode: team.code,
      groupName: team.groupName
    }))
  );
}

function friendlyScoreReview(row) {
  return row?.scoreReview ?? {
    generated: false,
    goalCandidates: [],
    scoreCandidates: [],
    actualTotalGoals: null,
    goalPrimaryHit: null,
    goalCandidateHit: null,
    scorePrimaryHit: null,
    scoreCandidateHit: null,
    expectedGoals: {}
  };
}

function friendlyOutputClass(hit) {
  if (hit === true) return 'hit';
  if (hit === false) return 'miss';
  return 'pending';
}

function friendlyHitText(hit) {
  if (hit === true) return '命中';
  if (hit === false) return '未中';
  return '未生成';
}

function friendlyCandidateHitText(primaryHit, candidateHit) {
  if (primaryHit === true) return '优先命中';
  if (candidateHit === true) return '候选命中';
  if (candidateHit === false) return '未中';
  return '未生成';
}

function friendlyGoalCandidatesZh(candidates) {
  if (!candidates?.length) return '未生成';
  return candidates
    .map((candidate) => {
      const probability = typeof candidate.probability === 'number' ? ` ${reviewPercent(candidate.probability, 1)}` : '';
      return `${candidate.totalGoals}球${probability}`;
    })
    .join(' / ');
}

function friendlyScoreCandidatesZh(candidates) {
  if (!candidates?.length) return '未生成';
  return candidates
    .map((candidate) => {
      const probability = typeof candidate.probability === 'number' ? ` ${reviewPercent(candidate.probability, 1)}` : '';
      return `${candidate.score}${probability}`;
    })
    .join(' / ');
}

function friendlyLedgerOutputSummary(row) {
  const review = friendlyScoreReview(row);
  if (!review.generated) return '进球/比分未生成';
  return `进球${friendlyHitText(review.goalCandidateHit)} · 比分${friendlyHitText(review.scoreCandidateHit)}`;
}

function friendlyScoreReviewStatsText(summary) {
  const review = summary?.scoreReview;
  if (!review?.rows) return '比分候选未生成';
  return `比分候选 ${review.scoreCandidateHits}/${review.rows}`;
}

function officialReviewRowKey(row, index) {
  return `official-${row.matchNo}-${index}`;
}

function topOfficialGoalCandidates(row, limit = 3) {
  return (row?.goalCandidates ?? [])
    .filter((goal) => Number.isFinite(Number(goal.totalGoals)))
    .slice(0, limit);
}

function topOfficialScoreCandidates(row, limit = 3) {
  return (row?.scoreCandidates ?? [])
    .filter((score) => Number.isFinite(Number(score.homeGoals)) && Number.isFinite(Number(score.awayGoals)))
    .slice(0, limit);
}

function officialGoalCandidatesText(row, limit = 3) {
  const candidates = topOfficialGoalCandidates(row, limit);
  if (!candidates.length) return '未生成';
  return candidates
    .map((candidate) => {
      const probability = typeof candidate.probability === 'number' ? ` ${reviewPercent(candidate.probability, 1)}` : '';
      return `${candidate.totalGoals}球${probability}`;
    })
    .join(' / ');
}

function officialScoreCandidatesText(row, limit = 3) {
  const candidates = topOfficialScoreCandidates(row, limit);
  if (!candidates.length) return '未生成';
  return candidates
    .map((candidate) => {
      const probability = typeof candidate.probability === 'number' ? ` ${reviewPercent(candidate.probability, 1)}` : '';
      return `${candidate.homeGoals}-${candidate.awayGoals}${probability}`;
    })
    .join(' / ');
}

function officialGoalCandidatesCompact(row) {
  const candidates = topOfficialGoalCandidates(row, 3);
  return candidates.length ? candidates.map((candidate) => `${candidate.totalGoals}球`).join('/') : '--';
}

function officialScoreCandidatesCompact(row) {
  const candidates = topOfficialScoreCandidates(row, 3);
  return candidates.length ? candidates.map((candidate) => `${candidate.homeGoals}-${candidate.awayGoals}`).join('/') : '--';
}

function officialLedgerPredictionText(row) {
  const pick = row?.reviewBaseline?.pick ?? row?.recommendedPick ?? '--';
  return `${pick} · 球 ${officialGoalCandidatesCompact(row)} · 比分 ${officialScoreCandidatesCompact(row)}`;
}

function officialCompactResultNote(note) {
  if (!note) return null;
  return String(note)
    .split('；链接:')[0]
    .split(' 链接:')[0]
    .split(' | http')[0]
    .trim();
}

function officialActualTotalGoals(row) {
  const result = row?.resultSummary;
  const homeScore = Number(result?.homeScore);
  const awayScore = Number(result?.awayScore);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return homeScore + awayScore;
}

function officialCandidateHitText(primaryHit, candidateHit) {
  if (primaryHit === true) return '主推命中';
  if (candidateHit === true) return '候选命中';
  if (candidateHit === false) return '未中';
  return '未生成';
}

function officialOutputClass(hit) {
  if (hit === true) return 'hit';
  if (hit === false) return 'miss';
  return 'pending';
}

function officialGoalReview(row) {
  const candidates = topOfficialGoalCandidates(row, 3);
  const actualTotalGoals = officialActualTotalGoals(row);
  const generated = candidates.length > 0 && actualTotalGoals != null;
  const primaryHit = generated ? Number(candidates[0]?.totalGoals) === actualTotalGoals : null;
  const candidateHit = generated
    ? candidates.some((candidate) => Number(candidate.totalGoals) === actualTotalGoals)
    : null;
  return {
    generated,
    candidates,
    actualTotalGoals,
    primaryHit,
    candidateHit
  };
}

function officialScoreReview(row) {
  const candidates = topOfficialScoreCandidates(row, 3);
  const result = row?.resultSummary;
  const actualHome = Number(result?.homeScore);
  const actualAway = Number(result?.awayScore);
  const generated = candidates.length > 0 && Number.isFinite(actualHome) && Number.isFinite(actualAway);
  const primary = candidates[0];
  const primaryHit =
    generated && primary
      ? Number(primary.homeGoals) === actualHome && Number(primary.awayGoals) === actualAway
      : null;
  const candidateHit = generated
    ? candidates.some(
        (candidate) => Number(candidate.homeGoals) === actualHome && Number(candidate.awayGoals) === actualAway
      )
    : null;
  return {
    generated,
    candidates,
    actualScore: generated ? `${actualHome}-${actualAway}` : officialScoreText(row),
    primaryHit,
    candidateHit
  };
}

function officialAsianLineText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const rounded = Math.round(number * 100) / 100;
  const text = Number.isInteger(rounded) ? `${rounded}` : `${rounded}`.replace(/0+$/, '').replace(/\.$/, '');
  return rounded > 0 ? `+${text}` : text;
}

function officialAsianResultKey(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number > 0) return 'home';
  if (number < 0) return 'away';
  return 'push';
}

function officialAsianKeyLabel(key) {
  if (key === 'home') return '主队赢盘';
  if (key === 'away') return '客队赢盘';
  if (key === 'push') return '走水';
  return '--';
}

function officialAsianPickLabel(key, line) {
  if (key === 'home') return `主 ${officialAsianLineText(line)}`;
  if (key === 'away') return `客 ${officialAsianLineText(-Number(line))}`;
  return '--';
}

function officialAsianRecommendedSide(adjustedMargin, line, rawMargin) {
  if (!Number.isFinite(adjustedMargin)) return null;
  if (adjustedMargin > 0) return 'home';
  if (adjustedMargin < 0) return 'away';
  if (line < 0) return 'away';
  if (line > 0) return 'home';
  if (rawMargin > 0) return 'home';
  if (rawMargin < 0) return 'away';
  return null;
}

function officialAsianRecommendedKey(row, line) {
  const primaryScore = topOfficialScoreCandidates(row, 1)[0];
  const scoreMargin =
    primaryScore &&
    Number.isFinite(Number(primaryScore.homeGoals)) &&
    Number.isFinite(Number(primaryScore.awayGoals))
      ? Number(primaryScore.homeGoals) - Number(primaryScore.awayGoals)
      : null;
  if (scoreMargin != null) return officialAsianRecommendedSide(scoreMargin + line, line, scoreMargin);

  const expectedHome = Number(row?.reviewBaseline?.expectedGoals?.home ?? row?.expectedGoals?.home);
  const expectedAway = Number(row?.reviewBaseline?.expectedGoals?.away ?? row?.expectedGoals?.away);
  if ([expectedHome, expectedAway].every(Number.isFinite)) {
    const expectedMargin = expectedHome - expectedAway;
    return officialAsianRecommendedSide(expectedMargin + line, line, expectedMargin);
  }
  return null;
}

function officialHandicapReview(row) {
  const line = Number(row?.odds?.asianLine);
  const expectedHome = Number(row?.reviewBaseline?.expectedGoals?.home ?? row?.expectedGoals?.home);
  const expectedAway = Number(row?.reviewBaseline?.expectedGoals?.away ?? row?.expectedGoals?.away);
  const result = row?.resultSummary;
  const homeScore = Number(result?.homeScore);
  const awayScore = Number(result?.awayScore);
  const primaryScore = topOfficialScoreCandidates(row, 1)[0];
  const scoreMargin =
    primaryScore &&
    Number.isFinite(Number(primaryScore.homeGoals)) &&
    Number.isFinite(Number(primaryScore.awayGoals))
      ? Number(primaryScore.homeGoals) - Number(primaryScore.awayGoals)
      : null;
  const predictedKey = officialAsianRecommendedKey(row, line);
  if (![line, expectedHome, expectedAway, homeScore, awayScore].every(Number.isFinite) || !predictedKey) {
    return {
      generated: false,
      predicted: '--',
      actual: result?.handicapResult ?? '盘口待结算',
      hit: null
    };
  }
  const expectedMargin = expectedHome - expectedAway;
  const actualKey = officialAsianResultKey(homeScore - awayScore + line);
  const recommendedMargin = scoreMargin ?? expectedMargin;
  const scoreBasis = primaryScore ? `主推比分 ${primaryScore.homeGoals}-${primaryScore.awayGoals}` : '期望进球';
  const pushNote = Math.abs(recommendedMargin + line) < 0.0001 ? '，防走倾向' : '';
  return {
    generated: true,
    line,
    expectedMargin,
    predictedKey,
    recommendedMargin,
    actualKey,
    predicted: officialAsianPickLabel(predictedKey, line),
    actual: `${officialAsianKeyLabel(actualKey)} · 主 ${officialAsianLineText(line)}`,
    detail: `${scoreBasis}${pushNote}，盘口修正 ${signed(recommendedMargin + line, 2)}；期望净胜 ${signed(expectedMargin, 2)}`,
    hit: predictedKey === actualKey
  };
}

function resultProbability(match) {
  const result = match.resultSummary?.result1x2;
  const probabilities = match.reviewBaseline?.probabilities ?? match.probabilities;
  if (result === '主胜') return probabilities?.home;
  if (result === '平局') return probabilities?.draw;
  if (result === '客胜') return probabilities?.away;
  return null;
}

function predictionResultHit(match) {
  const pick = match.reviewBaseline?.pick ?? match.recommendedPick;
  if (!pick || !match.resultSummary?.result1x2) return null;
  return pick === match.resultSummary.result1x2;
}

function officialResultRows(matches) {
  return (matches ?? [])
    .filter((match) => match.resultSummary)
    .map((match) => {
      const row = {
        ...match,
        actualProbability: resultProbability(match),
        correct: predictionResultHit(match)
      };
      return {
        ...row,
        officialGoalReview: officialGoalReview(row),
        officialScoreReview: officialScoreReview(row),
        officialHandicapReview: officialHandicapReview(row)
      };
    });
}

function filterOfficialRows(rows, filter) {
  if (filter === 'hit') return rows.filter((row) => row.correct === true);
  if (filter === 'miss') return rows.filter((row) => row.correct === false);
  if (filter === 'blocked') return rows.filter((row) => row.correct == null);
  return rows;
}

function officialMetricHit(row, metricKey) {
  if (metricKey === 'handicap') return row?.officialHandicapReview?.hit ?? null;
  if (metricKey === 'goals') return row?.officialGoalReview?.candidateHit ?? null;
  if (metricKey === 'score') return row?.officialScoreReview?.candidateHit ?? null;
  return row?.correct ?? null;
}

function filterOfficialRowsByMetric(rows, filter, metricKey) {
  if (filter === 'hit') return rows.filter((row) => officialMetricHit(row, metricKey) === true);
  if (filter === 'miss') return rows.filter((row) => officialMetricHit(row, metricKey) === false);
  if (filter === 'blocked') return rows.filter((row) => officialMetricHit(row, metricKey) == null);
  return rows;
}

function officialHitSummary(rows) {
  const evaluatedRows = rows.filter((row) => typeof row.correct === 'boolean');
  const hits = evaluatedRows.filter((row) => row.correct).length;
  const handicapRows = rows.filter((row) => typeof row.officialHandicapReview?.hit === 'boolean');
  const handicapHits = handicapRows.filter((row) => row.officialHandicapReview.hit).length;
  const goalRows = rows.filter((row) => typeof row.officialGoalReview?.candidateHit === 'boolean');
  const goalHits = goalRows.filter((row) => row.officialGoalReview.candidateHit).length;
  const scoreRows = rows.filter((row) => typeof row.officialScoreReview?.candidateHit === 'boolean');
  const scoreHits = scoreRows.filter((row) => row.officialScoreReview.candidateHit).length;
  const metric = (metricRows, metricHits) => ({
    evaluated: metricRows.length,
    hits: metricHits,
    misses: metricRows.length - metricHits,
    blocked: rows.length - metricRows.length,
    accuracy: metricRows.length ? metricHits / metricRows.length : null
  });
  return {
    matches: rows.length,
    evaluated: evaluatedRows.length,
    blocked: rows.length - evaluatedRows.length,
    hits,
    misses: evaluatedRows.length - hits,
    accuracy: evaluatedRows.length ? hits / evaluatedRows.length : null,
    result: metric(evaluatedRows, hits),
    handicap: metric(handicapRows, handicapHits),
    goals: metric(goalRows, goalHits),
    score: metric(scoreRows, scoreHits)
  };
}

function officialResultClass(row) {
  if (row?.correct === true) return 'hit';
  if (row?.correct === false) return 'miss';
  return 'pending';
}

function officialMetricClass(row, metricKey) {
  return officialOutputClass(officialMetricHit(row, metricKey));
}

function officialResultText(row) {
  if (row?.correct === true) return '命中';
  if (row?.correct === false) return '未中';
  return '未接入';
}

function officialMetricText(row, metricKey) {
  const hit = officialMetricHit(row, metricKey);
  if (hit === true) return '命中';
  if (hit === false) return '未中';
  return '未生成';
}

function officialMetricLabel(metricKey) {
  if (metricKey === 'handicap') return '亚盘';
  if (metricKey === 'goals') return '进球数';
  if (metricKey === 'score') return '比分';
  return '胜平负';
}

function officialPredictionText(row) {
  if (row?.reviewBaseline?.pick) return `${row.reviewBaseline.label} → ${row.reviewBaseline.pick}`;
  if (!row?.hasPrediction) return '未接入赛前预测';
  return row.recommendedPick ?? '未生成';
}

function officialScoreText(row) {
  const result = row?.resultSummary;
  if (!result) return '--';
  return `${result.homeScore}-${result.awayScore}`;
}

function officialResultMeta(row) {
  const result = row?.resultSummary;
  if (!result) return '等待赛果';
  return `${result.result1x2} · ${result.upsetType ?? '官方赛果'}`;
}

function OfficialProbabilityBars({ row }) {
  const probabilities = row?.reviewBaseline?.probabilities ?? row?.probabilities;
  const items = [
    ['主', probabilities?.home],
    ['平', probabilities?.draw],
    ['客', probabilities?.away]
  ];
  return (
    <div className="review-probability-bars">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <i>
            <b style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} />
          </i>
          <strong>{reviewPercent(value, 1)}</strong>
        </div>
      ))}
    </div>
  );
}

const IDEA_SCOPE_OPTIONS = [
  { key: 'worldcup', label: '世界杯相关' },
  { key: 'latest', label: '最近 24 场' },
  { key: 'all', label: '全部样本' }
];

const IDEA_TARGET_OPTIONS = [
  { key: 'result', label: '胜平负方向' },
  { key: 'goals', label: '进球候选' },
  { key: 'score', label: '比分候选' }
];

const IDEA_CONFIDENCE_OPTIONS = [
  { key: '0.48', label: '48%+' },
  { key: '0.52', label: '52%+' },
  { key: '0.56', label: '56%+' },
  { key: '0.60', label: '60%+' }
];

function ideaRowsByScope(rows, scope) {
  if (scope === 'worldcup') return rows.filter((row) => row.worldCupRelevance?.involved);
  if (scope === 'latest') return rows.slice(0, 24);
  return rows;
}

function ideaConfidence(row) {
  const directConfidence = Number(row.confidence);
  if (Number.isFinite(directConfidence)) return directConfidence;
  return maxProbability(row.probabilities);
}

function ideaTargetHit(row, target) {
  const review = friendlyScoreReview(row);
  if (target === 'goals') return review.generated ? review.goalCandidateHit : null;
  if (target === 'score') return review.generated ? review.scoreCandidateHit : null;
  return row.correct;
}

function ideaTargetPick(row, target) {
  const review = friendlyScoreReview(row);
  if (target === 'goals') return friendlyGoalCandidatesZh(review.goalCandidates);
  if (target === 'score') return friendlyScoreCandidatesZh(review.scoreCandidates);
  return friendlyOutcomeZh(row.pickLabel);
}

function ideaTargetActual(row, target) {
  const review = friendlyScoreReview(row);
  if (target === 'goals') return review.actualTotalGoals == null ? '--' : `${review.actualTotalGoals} 球`;
  if (target === 'score') return row.score ?? '--';
  return friendlyOutcomeZh(row.actualLabel);
}

function ideaTargetName(target) {
  return IDEA_TARGET_OPTIONS.find((item) => item.key === target)?.label ?? '验证目标';
}

function summarizeIdeaRows(rows, target) {
  const eligibleRows = rows.filter((row) => typeof ideaTargetHit(row, target) === 'boolean');
  const hits = eligibleRows.filter((row) => ideaTargetHit(row, target)).length;
  const avgConfidence =
    eligibleRows.length > 0
      ? eligibleRows.reduce((sum, row) => sum + ideaConfidence(row), 0) / eligibleRows.length
      : null;
  return {
    rows: eligibleRows,
    matches: eligibleRows.length,
    hits,
    misses: eligibleRows.length - hits,
    hitRate: eligibleRows.length ? hits / eligibleRows.length : null,
    avgConfidence
  };
}

function ideaConfidenceBands(rows, target) {
  const bands = [
    { key: 'high', label: '60%+', test: (value) => value >= 0.6 },
    { key: 'mid', label: '52-60%', test: (value) => value >= 0.52 && value < 0.6 },
    { key: 'low', label: '<52%', test: (value) => value < 0.52 }
  ];
  return bands.map((band) => {
    const bandRows = rows.filter((row) => band.test(ideaConfidence(row)));
    return { ...band, ...summarizeIdeaRows(bandRows, target) };
  });
}

function IdeaMetricCard({ label, value, meta, tone = 'steady' }) {
  return (
    <article className={`idea-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function IdeaResultRow({ row, target }) {
  const hit = ideaTargetHit(row, target);
  const HitIcon = hit ? CheckCircle2 : XCircle;
  return (
    <div className={`idea-result-row ${hit ? 'hit' : 'miss'}`}>
      <span>{row.date}</span>
      <div>
        <strong>{friendlyFixtureZh(row)}</strong>
        <small>信心 {reviewPercent(ideaConfidence(row), 1)} · {friendlySourceZh(row.primarySource)}</small>
      </div>
      <em>{ideaTargetPick(row, target)}</em>
      <i>{ideaTargetActual(row, target)}</i>
      <b>
        <HitIcon size={15} />
        {hit ? '命中' : '未中'}
      </b>
    </div>
  );
}

const GUESS_MARKET_OPTIONS = [
  { key: 'result', label: '胜平负' },
  { key: 'handicap_result', label: '让球胜平负' },
  { key: 'total_goals', label: '总进球' },
  { key: 'score', label: '比分' }
];

const RESULT_PICK_OPTIONS = [
  { key: 'home', label: '主胜' },
  { key: 'draw', label: '平局' },
  { key: 'away', label: '客胜' }
];

const HANDICAP_PICK_OPTIONS = [
  { key: 'home', label: '让胜' },
  { key: 'draw', label: '让平' },
  { key: 'away', label: '让负' }
];

const TOTAL_GOAL_OPTIONS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

function toggleListValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function splitScoreInput(value) {
  return [
    ...String(value ?? '').matchAll(/(\d{1,2})\s*(?:-|:|比)\s*(\d{1,2})/g)
  ].map((match) => `${match[1]}-${match[2]}`);
}

function guessStatValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? reviewPercent(value, 1) : '--';
}

function guessConfidenceLabel(value) {
  return reviewPercent(Number(value), 0);
}

function guessSettlementClass(guess) {
  if (guess.settlement?.status !== 'settled') return 'pending';
  return guess.settlement.hit ? 'hit' : 'miss';
}

function guessSettlementLabel(guess) {
  if (guess.settlement?.status !== 'settled') return '待赛果';
  return guess.settlement.hit ? '命中' : '未中';
}

function groupGuessRows(guesses) {
  const displayOrder = {
    total_goals: 1,
    handicap_result: 2,
    result: 3,
    score: 4
  };
  const groups = new Map();
  for (const guess of guesses) {
    const key = guess.note
      ? [guess.matchId, guess.confidence, guess.note].join('|')
      : [guess.matchId, guess.createdAt, guess.updatedAt, guess.confidence].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        ...guess,
        ids: [],
        guesses: []
      });
    }
    const group = groups.get(key);
    group.ids.push(guess.id);
    group.guesses.push(guess);
  }
  return [...groups.values()].map((group) => {
    group.guesses.sort(
      (left, right) => (displayOrder[left.marketType] ?? 99) - (displayOrder[right.marketType] ?? 99)
    );
    const settledRows = group.guesses.filter((guess) => guess.settlement?.status === 'settled');
    const hitRows = settledRows.filter((guess) => guess.settlement?.hit);
    const hasSettled = settledRows.length > 0;
    const allSettled = settledRows.length === group.guesses.length;
    return {
      ...group,
      settlementSummary: {
        status: allSettled ? 'settled' : 'pending',
        hit: allSettled ? hitRows.length === group.guesses.length : null,
        label: allSettled
          ? hitRows.length === group.guesses.length
            ? '全中'
            : `${hitRows.length}/${group.guesses.length} 命中`
          : hasSettled
            ? `${hitRows.length}/${settledRows.length} 已结算`
            : '待赛果',
        actualLabel: allSettled
          ? group.guesses.map((guess) => `${guess.marketLabel} ${guess.settlement.actualLabel}`).join(' / ')
          : '待赛果'
      }
    };
  });
}

function GuessStatCard({ label, value, meta, tone = 'steady' }) {
  return (
    <article className={`idea-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function GuessLedgerRow({ guessGroup, onDeleteGuess }) {
  const statusClass =
    guessGroup.settlementSummary.status !== 'settled'
      ? 'pending'
      : guessGroup.settlementSummary.hit
        ? 'hit'
        : 'miss';
  const HitIcon = guessGroup.settlementSummary.hit ? CheckCircle2 : XCircle;
  return (
    <div className={`idea-result-row ${statusClass}`}>
      <span>#{guessGroup.matchNo}</span>
      <div>
        <strong>{guessGroup.fixture}</strong>
        <small>{guessGroup.roundLabel} · {new Date(guessGroup.kickoffUtc).toLocaleString('zh-CN', { hour12: false })}</small>
      </div>
      <div className="idea-guess-stack">
        <div className="idea-guess-title-row" style={{ '--guess-count': guessGroup.guesses.length }}>
          {guessGroup.guesses.map((guess) => (
            <strong key={`title-${guess.id}`}>{guess.marketLabel}</strong>
          ))}
        </div>
        <div className="idea-guess-value-row" style={{ '--guess-count': guessGroup.guesses.length }}>
          {guessGroup.guesses.map((guess) => (
            <em key={`value-${guess.id}`}>{guess.pickLabel}</em>
          ))}
        </div>
      </div>
      <i>{guessGroup.settlementSummary.actualLabel} · 信心 {guessConfidenceLabel(guessGroup.confidence)}</i>
      <b>
        {statusClass === 'pending' ? null : <HitIcon size={15} />}
        {guessGroup.settlementSummary.label}
      </b>
      <button
        aria-label="删除猜测"
        className="idea-delete-button"
        onClick={() => Promise.all(guessGroup.ids.map((id) => onDeleteGuess(id)))}
        type="button"
      >
        删除
      </button>
      {guessGroup.note && (
        <details className="idea-note-detail">
          <summary>查看想法</summary>
          <p>{guessGroup.note}</p>
        </details>
      )}
    </div>
  );
}

export function IdeaValidationView({ matches, ledger, onAddGuess, onDeleteGuess }) {
  const worldCupMatches = matches ?? [];
  const [matchId, setMatchId] = useState('');
  const [resultPicks, setResultPicks] = useState(['home']);
  const [handicapPicks, setHandicapPicks] = useState([]);
  const [totalPicks, setTotalPicks] = useState([]);
  const [scoreText, setScoreText] = useState('');
  const [confidence, setConfidence] = useState('0.60');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const guesses = ledger?.guesses ?? [];
  const stats = ledger?.stats ?? {};
  const groupedGuesses = useMemo(() => groupGuessRows(guesses), [guesses]);
  const selectedMatch = worldCupMatches.find((match) => String(match.id) === String(matchId));

  useEffect(() => {
    if (!matchId && worldCupMatches.length) setMatchId(String(worldCupMatches[0].id));
  }, [matchId, worldCupMatches]);

  const scorePicks = splitScoreInput(scoreText);
  const guessInputs = [
    resultPicks.length ? { marketType: 'result', pickKey: resultPicks } : null,
    handicapPicks.length ? { marketType: 'handicap_result', pickKey: handicapPicks } : null,
    totalPicks.length ? { marketType: 'total_goals', pickKey: totalPicks } : null,
    scorePicks.length ? { marketType: 'score', pickKey: scorePicks } : null
  ].filter(Boolean);
  const canSubmit = selectedMatch && guessInputs.length > 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) {
      setFormError('请至少填写一个猜测');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await onAddGuess({
        matchId: Number(matchId),
        guesses: guessInputs,
        confidence: Number(confidence),
        note
      });
      setNote('');
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="workspace-panel">
      <PanelHeader
        icon={Beaker}
        title="我的猜测账本"
        subtitle="只记录世界杯赛程里的比赛；赛果出现后自动结算命中，并按玩法和信心统计效果。"
      />
      <div className="idea-lab">
        <form className="idea-control-sidebar" onSubmit={handleSubmit}>
          <header>
            <SlidersHorizontal size={18} />
            <div>
              <strong>录入猜测</strong>
              <span>保存到本地 SQLite</span>
            </div>
          </header>

          <label>
            世界杯比赛
            <select value={matchId} onChange={(event) => setMatchId(event.target.value)}>
              {worldCupMatches.map((match) => (
                <option key={match.id} value={match.id}>
                  #{match.matchNo} {match.homeTeam} vs {match.awayTeam}
                </option>
              ))}
            </select>
          </label>

          <div className="idea-pick-section">
            <strong>胜平负</strong>
            <div className="idea-pick-grid compact">
              {RESULT_PICK_OPTIONS.map((option) => (
                <button
                  className={resultPicks.includes(option.key) ? 'active' : ''}
                  key={option.key}
                  onClick={() => setResultPicks((current) => toggleListValue(current, option.key))}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="idea-pick-section">
            <strong>让球胜平负</strong>
            <div className="idea-pick-grid compact">
              {HANDICAP_PICK_OPTIONS.map((option) => (
                <button
                  className={handicapPicks.includes(option.key) ? 'active' : ''}
                  key={option.key}
                  onClick={() => setHandicapPicks((current) => toggleListValue(current, option.key))}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="idea-pick-section">
            <strong>总进球</strong>
            <div className="idea-pick-grid">
              {TOTAL_GOAL_OPTIONS.map((option) => (
                <button
                  className={totalPicks.includes(option) ? 'active' : ''}
                  key={option}
                  onClick={() => setTotalPicks((current) => toggleListValue(current, option))}
                  type="button"
                >
                  {option} 球
                </button>
              ))}
            </div>
          </div>

          <label>
            比分
            <textarea
              className="idea-score-textarea"
              value={scoreText}
              onChange={(event) => setScoreText(event.target.value)}
              placeholder="例如：1-0、2-1、1-1"
              rows={2}
            />
          </label>

          <label>
            信心
            <select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
              {['0.40', '0.50', '0.60', '0.70', '0.80', '0.90'].map((option) => (
                <option key={option} value={option}>
                  {guessConfidenceLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label>
            备注
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="可写盘口、新闻、直觉原因" rows={3} />
          </label>

          {formError && <p className="idea-form-error">{formError}</p>}

          <button className="idea-submit-button" disabled={saving || !canSubmit} type="submit">
            {saving ? '保存中' : `记录 ${guessInputs.length || ''} 项猜测`}
          </button>

          <div className="idea-gate-note">
            <strong>当前场次</strong>
            <span>{selectedMatch ? `#${selectedMatch.matchNo} ${selectedMatch.roundLabel}` : '等待赛程'}</span>
            <small>{selectedMatch ? `${selectedMatch.venue} · ${new Date(selectedMatch.kickoffUtc).toLocaleString('zh-CN', { hour12: false })}` : '只允许从世界杯赛程中选择。'}</small>
          </div>
        </form>

        <div className="idea-result-panel">
          <div className="idea-metric-grid">
            <GuessStatCard
              label="比赛记录"
              value={stats.total ?? 0}
              meta={`${stats.pending ?? 0} 场待赛果`}
              tone="primary"
            />
            <GuessStatCard
              label="已结算命中"
              value={guessStatValue(stats.hitRate)}
              meta={`${stats.hits ?? 0}/${stats.settled ?? 0} 命中`}
            />
            <GuessStatCard
              label="平均信心"
              value={guessStatValue(stats.avgConfidence)}
              meta={`${stats.misses ?? 0} 条未中`}
              tone="lift"
            />
            <GuessStatCard
              label="世界杯覆盖"
              value={new Set(guesses.map((guess) => guess.matchId)).size}
              meta={`${worldCupMatches.length} 场官方赛程`}
            />
          </div>

          <div className="idea-analysis-grid">
            <article className="idea-band-card">
              <strong>按玩法统计</strong>
              {(stats.byType ?? []).map((band) => (
                <div className="idea-band-row" key={band.key}>
                  <span>{band.label}</span>
                  <i>
                    <b style={{ width: `${Math.max(4, Math.min(100, (band.hitRate ?? 0) * 100))}%` }} />
                  </i>
                  <em>{reviewPercent(band.hitRate, 0)}</em>
                  <small>{band.hits}/{band.matches}</small>
                </div>
              ))}
            </article>
            <article className="idea-readout-card">
              <strong>按信心统计</strong>
              {(stats.confidenceBands ?? []).map((band) => (
                <div className="idea-band-row" key={band.key}>
                  <span>{band.label}</span>
                  <i>
                    <b style={{ width: `${Math.max(4, Math.min(100, (band.hitRate ?? 0) * 100))}%` }} />
                  </i>
                  <em>{guessStatValue(band.hitRate)}</em>
                  <small>{band.hits}/{band.settled}</small>
                </div>
              ))}
              <div>
                <span>已结算 {stats.settled ?? 0}</span>
                <span>待赛果 {stats.pending ?? 0}</span>
                <span>命中率 {guessStatValue(stats.hitRate)}</span>
              </div>
            </article>
          </div>

          <div className="idea-result-list" aria-label="我的世界杯猜测明细">
            <div className="idea-result-head">
              <span>编号</span>
              <span>场次</span>
              <span>我的猜测</span>
              <span>结算</span>
              <span>结果</span>
              <span>操作</span>
            </div>
            {guesses.length ? (
              groupedGuesses.map((guessGroup) => (
                <GuessLedgerRow key={guessGroup.ids.join('-')} guessGroup={guessGroup} onDeleteGuess={onDeleteGuess} />
              ))
            ) : (
              <p className="validation-empty">还没有记录你的世界杯猜测。左侧选择比赛和判断后保存。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function gatePromotesFriendlySignal(gate) {
  return Boolean(gate?.promote_2026_friendly_signal || gate?.promoteFriendlySignal);
}

function gateCanDriveMarketRecommendation(gate) {
  return Boolean(gate?.can_drive_market_recommendation || gate?.canDriveMarketRecommendation);
}

function doubleGate(reports, promotionGate, friendlyLedger) {
  return (
    reports?.international?.friendly_window_stability?.promotion_gate ??
    promotionGate?.evidence?.friendly?.promotionGate ??
    promotionGate?.report?.friendly_window_stability?.promotion_gate ??
    friendlyLedger?.summary?.promotionGate ??
    null
  );
}

function doubleIdeaSummary(friendlyLedger, target, minConfidence = 0.52) {
  const rows = ideaRowsByScope(friendlyLedger?.matches ?? [], 'worldcup');
  const testedRows = rows.filter((row) => ideaConfidence(row) >= minConfidence);
  return summarizeIdeaRows(testedRows, target);
}

function doubleIdeaCards(friendlyLedger) {
  const result = doubleIdeaSummary(friendlyLedger, 'result', 0.52);
  const goals = doubleIdeaSummary(friendlyLedger, 'goals', 0.52);
  const score = doubleIdeaSummary(friendlyLedger, 'score', 0.52);
  return [
    {
      key: 'result',
      label: '第一叠合 · 方向',
      value: reviewPercent(result.hitRate, 1),
      meta: `${result.hits}/${result.matches} · 信心 52%+`,
      text: '胜平负方向先过模型概率和市场质量，再进入复核池。'
    },
    {
      key: 'goals',
      label: '第二叠合 · 进球',
      value: reviewPercent(goals.hitRate, 1),
      meta: `${goals.hits}/${goals.matches} · 候选命中`,
      text: '进球数只做剧本校验，优先看候选组，不把单点峰值放大。'
    },
    {
      key: 'score',
      label: '第二叠合 · 比分',
      value: reviewPercent(score.hitRate, 1),
      meta: `${score.hits}/${score.matches} · 候选命中`,
      text: '比分用于解释净胜球和进球层，不单独升级为推荐。'
    }
  ];
}

function doubleMatchScore(match) {
  const tier = match?.previewDecision?.tier;
  const tierScore = {
    candidate: 5,
    watch: 3,
    market_close: 1,
    negative: -4
  }[tier] ?? 0;
  const confidence = Number(match?.confidence ?? 0);
  const upsetRisk = Number(match?.upsetRisk ?? 0.5);
  const value = Number(match?.valueScore ?? 0);
  const quality = match?.marketQuality ?? match?.previewDecision?.marketQuality;
  const marketScore = quality?.candidateReady ? 2 : quality?.watchReady ? 1 : 0;
  const confidenceScore = confidence >= 0.6 ? 2 : confidence >= 0.52 ? 1 : 0;
  const valueScore = value >= 0.04 ? 2 : value > 0 ? 1 : value <= -0.05 ? -2 : 0;
  const riskPenalty = upsetRisk >= 0.54 ? 2 : upsetRisk >= 0.45 ? 1 : 0;
  return tierScore + marketScore + confidenceScore + valueScore - riskPenalty;
}

function doubleTierText(match, gate) {
  const tier = match?.previewDecision?.tier;
  if (!match?.hasPrediction) return '阻断';
  if (tier === 'negative') return '负价值不追';
  if (!gateCanDriveMarketRecommendation(gate)) return tier === 'candidate' ? '候选复核，不进串' : '观察复核';
  if (tier === 'candidate') return '可进复核票';
  if (tier === 'watch') return '小额观察';
  return '贴近市场';
}

function doubleEvidenceText(match) {
  const quality = match?.marketQuality ?? match?.previewDecision?.marketQuality;
  const providerCount = quality?.providerCount ?? match?.marketConsensus?.providerCount;
  const disagreement = quality?.maxProviderDisagreement ?? match?.marketConsensus?.maxProbabilityRange;
  return [
    `信心 ${reviewPercent(match?.confidence, 1)}`,
    `价值 ${signed(match?.valueScore, 3)}`,
    `provider ${providerCount ?? '--'}`,
    `分歧 ${reviewPercent(disagreement, 1)}`
  ].join(' · ');
}

function doubleMatchRows(matches, gate) {
  return (matches ?? [])
    .filter((match) => match.hasPrediction)
    .map((match) => ({
      match,
      score: doubleMatchScore(match),
      action: doubleTierText(match, gate),
      evidence: doubleEvidenceText(match)
    }))
    .toSorted((left, right) => right.score - left.score || Number(right.match.confidence ?? 0) - Number(left.match.confidence ?? 0))
    .slice(0, 8);
}

function doubleParlayRows(parlays, gate) {
  return (parlays ?? [])
    .filter((combo) => combo?.legs?.length >= 2)
    .toSorted((left, right) => numberValue(right.valueScore, -99) - numberValue(left.valueScore, -99))
    .slice(0, 5)
    .map((combo) => ({
      ...combo,
      action: gateCanDriveMarketRecommendation(gate) ? '复核后可试' : '只保留组合观察'
    }));
}

function splitCollisionPickKeys(value) {
  return String(value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resultKeyFromZh(label) {
  if (label === '主胜') return 'home';
  if (label === '平局') return 'draw';
  if (label === '客胜') return 'away';
  return null;
}

function scoreKey(score) {
  if (!score || !Number.isFinite(Number(score.homeGoals)) || !Number.isFinite(Number(score.awayGoals))) return null;
  return `${score.homeGoals}-${score.awayGoals}`;
}

function handicapKeyForScore(score, line) {
  if (!score || !Number.isFinite(Number(line))) return null;
  const adjusted = Number(score.homeGoals) - Number(score.awayGoals) + Number(line);
  if (adjusted > 0) return 'home';
  if (adjusted < 0) return 'away';
  return 'draw';
}

function handicapKeyFromExpected(match) {
  const line = Number(match?.odds?.asianLine);
  const home = Number(match?.expectedGoals?.home);
  const away = Number(match?.expectedGoals?.away);
  if (![line, home, away].every(Number.isFinite)) return null;
  const adjusted = home - away + line;
  if (adjusted > 0.18) return 'home';
  if (adjusted < -0.18) return 'away';
  return 'draw';
}

function guessModelOpinion(match, guess) {
  if (!match?.hasPrediction) {
    return {
      key: null,
      candidateKeys: [],
      label: '模型未接入',
      detail: '这场暂无完整模型输出。',
      ready: false
    };
  }

  if (guess.marketType === 'result') {
    const key = resultKeyFromZh(match.recommendedPick);
    return {
      key,
      candidateKeys: [key].filter(Boolean),
      label: match.recommendedPick ?? '待接入',
      detail: `模型胜平负主方向，信心 ${reviewPercent(match.confidence, 1)}。`,
      ready: Boolean(key)
    };
  }

  if (guess.marketType === 'handicap_result') {
    const primaryScore = match.scoreCandidates?.[0];
    const key = handicapKeyForScore(primaryScore, match.odds?.asianLine) ?? handicapKeyFromExpected(match);
    const labels = { home: '让胜', draw: '让平', away: '让负' };
    return {
      key,
      candidateKeys: [key].filter(Boolean),
      label: labels[key] ?? '让球待复核',
      detail: Number.isFinite(Number(match.odds?.asianLine))
        ? `按当前让球 ${signed(match.odds.asianLine, 1)} 与模型比分/均值折算。`
        : '缺少可用让球线。',
      ready: Boolean(key)
    };
  }

  if (guess.marketType === 'total_goals') {
    const goals = (match.goalCandidates ?? [])
      .filter((goal) => Number.isFinite(Number(goal.totalGoals)))
      .slice(0, 3);
    return {
      key: goals[0] ? String(goals[0].totalGoals) : null,
      candidateKeys: goals.map((goal) => String(goal.totalGoals)),
      label: goals.length ? goals.map((goal) => `${goal.totalGoals}球`).join(' / ') : '进球待接入',
      detail: '取模型进球分布前三候选做碰撞，不只看单点峰值。',
      ready: goals.length > 0
    };
  }

  if (guess.marketType === 'score') {
    const scores = (match.scoreCandidates ?? [])
      .map(scoreKey)
      .filter(Boolean)
      .slice(0, 5);
    return {
      key: scores[0] ?? null,
      candidateKeys: scores,
      label: scores.length ? scores.join(' / ') : '比分待接入',
      detail: '取模型比分候选前五做碰撞；比分只用于解释剧本。',
      ready: scores.length > 0
    };
  }

  return {
    key: null,
    candidateKeys: [],
    label: '玩法待识别',
    detail: '该玩法还没有碰撞规则。',
    ready: false
  };
}

function collisionForGuess(match, guess) {
  const model = guessModelOpinion(match, guess);
  const pickKeys = splitCollisionPickKeys(guess.pickKey);
  const primaryAligned = model.key != null && pickKeys.includes(model.key);
  const candidateAligned = !primaryAligned && model.candidateKeys.some((key) => pickKeys.includes(key));
  const isDifferentMarketScript = ['total_goals', 'score'].includes(guess.marketType) && model.ready;
  if (!model.ready) {
    return {
      guess,
      model,
      tone: 'pending',
      label: '待碰撞',
      action: '缺模型输入',
      score: 0,
      reason: '这条想法暂时不能和模型输出直接比对。'
    };
  }
  if (primaryAligned) {
    return {
      guess,
      model,
      tone: 'aligned',
      label: '强同向',
      action: '保留复核',
      score: 3,
      reason: '你的选择包含模型主输出，属于同一方向。'
    };
  }
  if (candidateAligned) {
    return {
      guess,
      model,
      tone: 'support',
      label: isDifferentMarketScript ? '剧本互补' : '候选同向',
      action: '作为第二层证据',
      score: 2,
      reason: '你的选择没有压中模型峰值，但进入了模型候选区间。'
    };
  }
  return {
    guess,
    model,
    tone: 'conflict',
    label: '分歧',
    action: '降级观察',
    score: -2,
    reason: '你的选择和模型候选没有重叠，需要回到盘口/新闻原因复核。'
  };
}

function collisionSummary(collisions) {
  const aligned = collisions.filter((item) => item.tone === 'aligned').length;
  const support = collisions.filter((item) => item.tone === 'support').length;
  const conflict = collisions.filter((item) => item.tone === 'conflict').length;
  const pending = collisions.filter((item) => item.tone === 'pending').length;
  const score = collisions.reduce((sum, item) => sum + item.score, 0);
  const label =
    conflict > 0
      ? '有分歧'
      : aligned > 0 && support > 0
        ? '同向+互补'
        : aligned > 0
          ? '强同向'
          : support > 0
            ? '互补'
            : '待碰撞';
  return { aligned, support, conflict, pending, score, label };
}

function buildCollisionGroups(matches, guessLedger) {
  const matchById = new Map((matches ?? []).map((match) => [Number(match.id), match]));
  return groupGuessRows(guessLedger?.guesses ?? [])
    .map((group) => {
      const match = matchById.get(Number(group.matchId));
      const collisions = group.guesses.map((guess) => collisionForGuess(match, guess));
      return {
        ...group,
        match,
        collisions,
        summary: collisionSummary(collisions)
      };
    })
    .toSorted((left, right) => right.summary.score - left.summary.score || Number(right.confidence ?? 0) - Number(left.confidence ?? 0));
}

function collisionNotePreview(note) {
  const text = String(note ?? '').trim();
  if (!text) return '';
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function CollisionPanel({ groups }) {
  return (
    <div className="double-collision-block">
      <div className="double-section-head">
        <div>
          <strong>想法碰撞</strong>
          <span>你的想法 × 模型输出 × 双叠合守门</span>
        </div>
        <em>{groups.length} 条</em>
      </div>
      <div className="double-collision-list">
        {groups.length ? groups.map((group) => (
          <article className={`double-collision-card tone-${group.summary.label === '有分歧' ? 'conflict' : 'aligned'}`} key={group.ids.join('-')}>
            <header>
              <div>
                <span>#{group.matchNo}</span>
                <strong>{group.fixture}</strong>
                <small>{group.roundLabel} · 信心 {guessConfidenceLabel(group.confidence)} · 碰撞分 {signed(group.summary.score, 0)}</small>
              </div>
              <em>{group.summary.label}</em>
            </header>
            <div className="collision-chip-row">
              <span>强同向 {group.summary.aligned}</span>
              <span>互补 {group.summary.support}</span>
              <span>分歧 {group.summary.conflict}</span>
              {group.summary.pending ? <span>待接入 {group.summary.pending}</span> : null}
            </div>
            <div className="collision-leg-list">
              {group.collisions.map((collision) => (
                <div className={`collision-leg-row ${collision.tone}`} key={collision.guess.id}>
                  <span>{collision.guess.marketLabel}</span>
                  <strong>你：{collision.guess.pickLabel}</strong>
                  <em>模型：{collision.model.label}</em>
                  <b>{collision.label}</b>
                  <small>{collision.reason}</small>
                </div>
              ))}
            </div>
            {group.note ? (
              <details className="double-collision-note">
                <summary>
                  <span>想法</span>
                  <em>{collisionNotePreview(group.note)}</em>
                </summary>
                <p>{group.note}</p>
              </details>
            ) : null}
          </article>
        )) : (
          <div className="empty-panel">
            <strong>还没有你的想法</strong>
            <span>去“想法验证”录入一条世界杯猜测后，这里会自动做同向、互补和分歧碰撞。</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DoubleIdeaCard({ card }) {
  return (
    <article className={`double-idea-card ${card.key}`}>
      <span>{card.label}</span>
      <strong>{card.value}</strong>
      <small>{card.meta}</small>
      <p>{card.text}</p>
    </article>
  );
}

export function DoubleOverlapView({ matches, parlays, guessLedger, friendlyLedger, reports, promotionGate }) {
  const gate = doubleGate(reports, promotionGate, friendlyLedger);
  const ideaCards = useMemo(() => doubleIdeaCards(friendlyLedger), [friendlyLedger]);
  const rows = useMemo(() => doubleMatchRows(matches, gate), [gate, matches]);
  const parlayRows = useMemo(() => doubleParlayRows(parlays, gate), [gate, parlays]);
  const collisionGroups = useMemo(() => buildCollisionGroups(matches, guessLedger), [guessLedger, matches]);
  const latest = friendlyLedger?.summary?.latest24 ?? {};
  const related = friendlyLedger?.summary?.worldCupRelated ?? {};
  const fullWindow = friendlyLedger?.summary?.fullWindow ?? {};
  const conclusion =
    promotionGate?.conclusion ??
    (gatePromotesFriendlySignal(gate)
      ? '友谊赛信号可进入模型复核，但仍需要赛前赔率、阵容和新闻确认。'
      : '友谊赛短窗表现强，但短窗/全窗口差异过大，当前只输出预判分层和复核推荐。');

  return (
    <section className="workspace-panel">
      <PanelHeader
        icon={GitCompare}
        title="双叠合复核推荐"
        subtitle="把你的思路拆成方向层与进球/比分层：先用数据验证想法，再叠合模型、市场质量和守门结论。"
      />

      <div className="double-hero">
        <article className="double-final-card">
          <span>最终结论</span>
          <strong>{friendlyGateDecisionLabel(gate)}</strong>
          <p>{conclusion}</p>
          <div>
            <em>最新 24 场 {reviewPercent(latest.accuracy, 1)}</em>
            <em>世界杯相关 {reviewPercent(related.accuracy, 1)}</em>
            <em>全窗口 {reviewPercent(fullWindow.accuracy, 1)}</em>
            <em>{friendlyGateDependencyLabel(gate)}</em>
          </div>
        </article>
        {ideaCards.map((card) => (
          <DoubleIdeaCard card={card} key={card.key} />
        ))}
      </div>

      <div className="double-logic-grid">
        <article>
          <span>叠合 1</span>
          <strong>方向先行</strong>
          <p>胜平负只取信心 52%+ 的世界杯相关样本做回放；模型方向、市场 provider 共识和价值分三者一致时，才进入候选复核。</p>
        </article>
        <article>
          <span>叠合 2</span>
          <strong>剧本复核</strong>
          <p>进球数和比分只作为第二层解释：确认净胜球、大小球和比分候选是否互相支持；短窗命中不能直接晋级投注建议。</p>
        </article>
        <article>
          <span>守门</span>
          <strong>{gateCanDriveMarketRecommendation(gate) ? '允许推荐' : '保持观察'}</strong>
          <p>当前复核结果优先约束仓位和串关：能解释的保留，负价值和高冷门风险不追，缺阵容/新闻的组合不升级。</p>
        </article>
      </div>

      <CollisionPanel groups={collisionGroups} />

      <div className="double-section-head">
        <div>
          <strong>单场复核排序</strong>
          <span>模型方向 × 市场质量 × 想法验证后的最终筛选</span>
        </div>
        <em>{rows.length} 场</em>
      </div>
      <div className="double-match-list">
        {rows.length ? rows.map(({ match, score, action, evidence }) => (
          <article className={`double-match-row tier-${match.previewDecision?.tier ?? 'blocked'}`} key={match.id}>
            <span>#{match.matchNo}</span>
            <div>
              <strong>{match.homeTeam} vs {match.awayTeam}</strong>
              <small>{match.roundLabel} · {match.recommendedPick} · {evidence}</small>
            </div>
            <em>{match.previewDecision?.label ?? '观察'}</em>
            <b>{action}</b>
            <i>叠合分 {signed(score, 0)}</i>
          </article>
        )) : (
          <div className="empty-panel">
            <strong>暂无可复核单场</strong>
            <span>等待完整盘口、阵容和新闻输入后重新生成。</span>
          </div>
        )}
      </div>

      <div className="double-section-head">
        <div>
          <strong>组合复核</strong>
          <span>只展示数据上可解释的 2 串 1/混合候选，最终仍受守门状态约束</span>
        </div>
        <em>{parlayRows.length} 组</em>
      </div>
      <div className="double-parlay-grid">
        {parlayRows.length ? parlayRows.map((combo) => (
          <article className="double-parlay-card" key={combo.id}>
            <header>
              <div>
                <strong>{combo.name}</strong>
                <span>{parlayPoolMix(combo)} · {combo.calculator?.passType ?? combo.mode}</span>
              </div>
              <em>{combo.action}</em>
            </header>
            <div className="double-ticket-line">
              <span>组合概率 {combo.probability}%</span>
              <span>赔率 {combo.impliedOdds}</span>
              <span>价值 {signed(combo.valueScore, 3)}</span>
            </div>
            {combo.legs.map((leg) => (
              <div className="double-leg" key={`${combo.id}-${leg.matchNo}-${leg.pool}`}>
                <span>{leg.matchNum ?? `#${leg.matchNo}`}</span>
                <strong>{leg.fixture}</strong>
                <small>{leg.pool} · {leg.pick} · 赔 {leg.odds} · 概 {leg.probability}%</small>
              </div>
            ))}
          </article>
        )) : (
          <div className="empty-panel">
            <strong>组合仍阻断</strong>
            <span>没有满足双叠合复核条件的组合。</span>
          </div>
        )}
      </div>
    </section>
  );
}

function FriendlyProbabilityBars({ row }) {
  return (
    <div className="review-probability-bars">
      {[
        ['主', row?.probabilities?.home],
        ['平', row?.probabilities?.draw],
        ['客', row?.probabilities?.away]
      ].map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <i>
            <b style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} />
          </i>
          <strong>{reviewPercent(value, 1)}</strong>
        </div>
      ))}
    </div>
  );
}

function FriendlyDetailPanel({ row }) {
  if (!row) {
    return (
      <article className="review-detail-panel empty-panel">
        <strong>选择一场友谊赛</strong>
        <span>查看赛前预测、概率、赛果和命中偏差。</span>
      </article>
    );
  }
  const relatedFixtures = flattenFriendlyFixtures(row).slice(0, 4);
  const scoreReview = friendlyScoreReview(row);
  const goalCandidates = scoreReview.goalCandidates ?? [];
  const scoreCandidates = scoreReview.scoreCandidates ?? [];
  const primaryGoal = goalCandidates[0];
  const primaryScore = scoreCandidates[0];
  const actualTotalGoals = Number.isFinite(scoreReview.actualTotalGoals)
    ? `${scoreReview.actualTotalGoals}球`
    : '--';
  const expectedGoals = scoreReview.expectedGoals ?? {};
  const technicalReason = scoreReview.generated
    ? `进球数来自赛前泊松总进球分布；比分先匹配胜平负方向（${friendlyOutcomeZh(row.pickLabel)}），再匹配优先进球数，最后按比分概率排序。`
    : '这场历史友谊赛账本没有保存赛前进球/比分候选，因此只核对胜平负方向。';
  return (
    <article className={`review-detail-panel ${row.correct ? 'hit' : 'miss'}`}>
      <header>
        <div>
          <span>{row.date} · {friendlyTournamentZh(row.tournament)}</span>
          <h2>{friendlyFixtureZh(row)}</h2>
        </div>
        <em>{row.correct ? '命中' : '未中'}</em>
      </header>
      <div className="review-detail-score">
        <div>
          <span>赛前预测</span>
          <strong>{friendlyOutcomeZh(row.pickLabel)}</strong>
          <small>信心 {reviewPercent(row.confidence, 1)}</small>
        </div>
        <div>
          <span>实际赛果</span>
          <strong>{row.score}</strong>
          <small>{friendlyOutcomeZh(row.actualLabel)}</small>
        </div>
        <div>
          <span>赛果概率</span>
          <strong>{reviewPercent(row.actualProbability, 1)}</strong>
          <small>{row.correct ? '模型方向命中' : '模型低估真实结果'}</small>
        </div>
      </div>
      <div className="review-standard-output" aria-label="赛前模型标准输出复盘">
        <div className={`review-output-card ${friendlyOutputClass(row.correct)}`}>
          <span>胜平负</span>
          <strong>{friendlyOutcomeZh(row.pickLabel)}</strong>
          <small>实际 {friendlyOutcomeZh(row.actualLabel)} · {friendlyHitText(row.correct)}</small>
        </div>
        <div className={`review-output-card ${friendlyOutputClass(scoreReview.goalCandidateHit)}`}>
          <span>进球数</span>
          <strong>{primaryGoal ? `${primaryGoal.totalGoals}球` : '未生成'}</strong>
          <small>
            候选 {friendlyGoalCandidatesZh(goalCandidates)} · 实际 {actualTotalGoals} · {friendlyCandidateHitText(scoreReview.goalPrimaryHit, scoreReview.goalCandidateHit)}
          </small>
        </div>
        <div className={`review-output-card ${friendlyOutputClass(scoreReview.scoreCandidateHit)}`}>
          <span>比分</span>
          <strong>{primaryScore?.score ?? '未生成'}</strong>
          <small>
            候选 {friendlyScoreCandidatesZh(scoreCandidates)} · 实际 {row.score} · {friendlyCandidateHitText(scoreReview.scorePrimaryHit, scoreReview.scoreCandidateHit)}
          </small>
        </div>
        <div className="review-output-card pending">
          <span>体彩让球 / 欧盘</span>
          <strong>未接入</strong>
          <small>友谊赛账本无可信赛前盘口，不参与命中统计。</small>
        </div>
      </div>
      <div className="review-technical-note">
        <strong>技术说明</strong>
        <p>{technicalReason}</p>
        {scoreReview.generated ? (
          <small>
            赛前预期进球 {reviewNumber(expectedGoals.home)}-{reviewNumber(expectedGoals.away)}，总计 {reviewNumber(expectedGoals.total)}。
          </small>
        ) : null}
      </div>
      <FriendlyProbabilityBars row={row} />
      <div className="review-process">
        <div>
          <span>1</span>
          <strong>赛前输入</strong>
          <p>只使用{friendlySourceZh(row.primarySource)}赛前状态和已完赛国际赛信息；未使用本场赛果或未来世界杯结果。</p>
        </div>
        <div>
          <span>2</span>
          <strong>概率判断</strong>
          <p>
            {`主 ${reviewPercent(row.probabilities?.home, 1)}，平 ${reviewPercent(row.probabilities?.draw, 1)}，客 ${reviewPercent(row.probabilities?.away, 1)}；最高概率对应 ${friendlyOutcomeZh(row.pickLabel)}${
              scoreReview.generated
                ? `；进球数候选 ${friendlyGoalCandidatesZh(goalCandidates)}；比分候选 ${friendlyScoreCandidatesZh(scoreCandidates)}。`
                : '。'
            }`}
          </p>
        </div>
        <div>
          <span>3</span>
          <strong>赛后核验</strong>
          <p>
            {`${row.score}，实际为 ${friendlyOutcomeZh(row.actualLabel)}；胜平负${friendlyHitText(row.correct)}${
              scoreReview.generated
                ? `，进球数${friendlyCandidateHitText(scoreReview.goalPrimaryHit, scoreReview.goalCandidateHit)}，比分${friendlyCandidateHitText(scoreReview.scorePrimaryHit, scoreReview.scoreCandidateHit)}`
                : ''
            }。进入校准误差和短窗口稳定性守门。`}
          </p>
        </div>
      </div>
      <div className="review-relevance">
        <strong>世界杯关联</strong>
        {row.worldCupRelevance?.involved ? (
          <>
            <span>{row.worldCupRelevance.involvedCodes?.map(friendlyCodeZh).join(' / ')}</span>
            <div>
              {relatedFixtures.map((fixture) => (
                <small key={`${fixture.teamCode}-${fixture.matchNo}`}>
                  {friendlyCodeZh(fixture.teamCode)} · #{fixture.matchNo} 对 {friendlyCodeZh(fixture.opponentCode)} · {fixture.dateEt}
                </small>
              ))}
            </div>
          </>
        ) : (
          <span>非 2026 官方赛程球队，仅用于校准样本。</span>
        )}
      </div>
    </article>
  );
}

function OfficialResultDetailPanel({ row, metricKey = 'result' }) {
  if (!row) {
    return (
      <article className="review-detail-panel empty-panel">
        <strong>暂无正赛赛果</strong>
        <span>只记录 2026 世界杯官方正赛已完赛场次；友谊赛和非正赛样本不进入这里。</span>
      </article>
    );
  }

  const result = row.resultSummary ?? {};
  const statusClass = officialMetricClass(row, metricKey);
  const predictionText = officialPredictionText(row);
  const predictedPick = row.reviewBaseline?.pick ?? row.recommendedPick ?? '未生成';
  const actualScore = officialScoreText(row);
  const probabilityText = row.actualProbability == null ? '--' : reviewPercent(row.actualProbability, 1);
  const handicapResult = result.handicapResult ?? '盘口待结算';
  const totalResult = result.totalResult ?? '大小球待结算';
  const sourceNote = row.resultSummary?.note ?? row.result?.note;
  const baseline = row.reviewBaseline;
  const baselineConfidence = baseline?.confidence ?? row.confidence;
  const goalReview = row.officialGoalReview ?? officialGoalReview(row);
  const scoreReview = row.officialScoreReview ?? officialScoreReview(row);
  const handicapReview = row.officialHandicapReview ?? officialHandicapReview(row);
  const expectedGoals = baseline?.expectedGoals ?? row.expectedGoals ?? {};
  const totalGoalsText = goalReview.actualTotalGoals == null ? '--' : `${goalReview.actualTotalGoals}球`;
  const compactSourceNote = officialCompactResultNote(sourceNote);
  const baselineSourceNote = baseline?.countsAsMarketPrediction
    ? `信心 ${reviewPercent(baselineConfidence, 1)}`
    : baseline
      ? `先验信心 ${reviewPercent(baselineConfidence, 1)}`
      : '无赛前盘口预测输出';
  const technicalReason = baseline
    ? `复盘只读取赛前已生成的预测快照：胜平负取主方向，进球数与比分均取概率前三候选；赛后只做命中校验，不用赛果反推覆盖。`
    : '当前没有可用赛前预测快照，因此该场不进入胜平负、亚盘、进球数或比分命中统计。';

  return (
    <article className={`review-detail-panel ${statusClass}`}>
      <header>
        <div>
          <span>{new Date(row.kickoffUtc).toLocaleDateString('zh-CN')} · {stageName(row.stage)}</span>
          <h2>{row.homeTeam} 对 {row.awayTeam}</h2>
        </div>
        <em>{officialMetricLabel(metricKey)} {officialMetricText(row, metricKey)}</em>
      </header>
      <div className="review-detail-score review-initial-grid">
        <div>
          <span>初始胜平负</span>
          <strong>{predictedPick}</strong>
          <small>{baselineSourceNote}</small>
        </div>
        <div>
          <span>初始进球数 Top3</span>
          <strong>{officialGoalCandidatesCompact(row)}</strong>
          <small>{officialGoalCandidatesText(row)}</small>
        </div>
        <div>
          <span>初始比分 Top3</span>
          <strong>{officialScoreCandidatesCompact(row)}</strong>
          <small>{officialScoreCandidatesText(row)}</small>
        </div>
        <div>
          <span>实际赛果</span>
          <strong>{actualScore}</strong>
          <small>{result.result1x2 ?? '--'} · 概率 {probabilityText}</small>
        </div>
      </div>
      <div className="review-standard-output official-outputs" aria-label="世界杯正赛标准输出复盘">
        <div className={`review-output-card ${officialResultClass(row)}`}>
          <span>胜平负</span>
          <strong>{predictedPick}</strong>
          <small>实际 {result.result1x2 ?? '--'} · {officialResultText(row)}</small>
        </div>
        <div className={`review-output-card ${officialOutputClass(handicapReview.hit)}`}>
          <span>亚盘</span>
          <strong>{handicapReview.predicted}</strong>
          <small>实际 {handicapReview.actual} · {officialCandidateHitText(handicapReview.hit, handicapReview.hit)} · {handicapReview.detail ?? '--'}</small>
        </div>
        <div className={`review-output-card ${officialOutputClass(goalReview.candidateHit)}`}>
          <span>进球数 Top3</span>
          <strong>{officialGoalCandidatesCompact(row)}</strong>
          <small>实际 {totalGoalsText} · {totalResult} · {officialCandidateHitText(goalReview.primaryHit, goalReview.candidateHit)}</small>
        </div>
        <div className={`review-output-card ${officialOutputClass(scoreReview.candidateHit)}`}>
          <span>比分 Top3</span>
          <strong>{officialScoreCandidatesCompact(row)}</strong>
          <small>实际 {scoreReview.actualScore ?? actualScore} · {officialCandidateHitText(scoreReview.primaryHit, scoreReview.candidateHit)}</small>
        </div>
      </div>
      <div className="review-technical-note">
        <strong>记录说明</strong>
        <p>{technicalReason}</p>
        <small title={sourceNote || undefined}>
          {compactSourceNote || '赛果来自官方结果导入表。'}
          {baseline ? ` 赛前预期进球 ${reviewNumber(expectedGoals.home)}-${reviewNumber(expectedGoals.away)}。` : ''}
        </small>
      </div>
      <OfficialProbabilityBars row={row} />
      <div className="review-process">
        <div>
          <span>1</span>
          <strong>正赛过滤</strong>
          <p>列表来源为本地官方 FIFA 2026 赛程中的 `results` 记录，未完赛和非正赛样本不展示。</p>
        </div>
        <div>
          <span>2</span>
          <strong>初始预设</strong>
          <p>
            {baseline?.countsAsMarketPrediction
              ? `方向为 ${predictionText}，信心 ${reviewPercent(baselineConfidence, 1)}；进球候选 ${officialGoalCandidatesText(row)}；比分候选 ${officialScoreCandidatesText(row)}。`
              : baseline
                ? `没有完整赛前盘口快照，使用球队强度先验复盘：${predictionText}，先验信心 ${reviewPercent(baselineConfidence, 1)}；进球候选 ${officialGoalCandidatesText(row)}；比分候选 ${officialScoreCandidatesText(row)}。`
                : '当前没有完整赛前盘口快照，因此不生成真实预测，也不参与命中率。'}
          </p>
        </div>
        <div>
          <span>3</span>
          <strong>赛后记录</strong>
          <p>
            {`${row.homeTeam} ${actualScore} ${row.awayTeam}，结果为 ${result.result1x2 ?? '--'}；亚盘${officialCandidateHitText(handicapReview.hit, handicapReview.hit)}，进球数${officialCandidateHitText(goalReview.primaryHit, goalReview.candidateHit)}，比分${officialCandidateHitText(scoreReview.primaryHit, scoreReview.candidateHit)}。`}
          </p>
        </div>
      </div>
      <div className="review-relevance">
        <strong>官方赛程关联</strong>
        <span>#{row.matchNo} · {row.roundLabel} · {row.venue}</span>
        <div>
          <small>{row.kickoffUtc}</small>
          <small>{row.status === 'finished' ? '已完赛' : row.status}</small>
        </div>
      </div>
    </article>
  );
}

export function ReviewView({ matches, calibration, friendlyLedger }) {
  const [ledgerFilter, setLedgerFilter] = useState('all');
  const [metricFilter, setMetricFilter] = useState('result');
  const [selectedLedgerKey, setSelectedLedgerKey] = useState(null);
  const officialRows = useMemo(() => officialResultRows(matches), [matches]);
  const filteredOfficialRows = useMemo(
    () => filterOfficialRowsByMetric(officialRows, ledgerFilter, metricFilter),
    [ledgerFilter, metricFilter, officialRows]
  );
  const selectedOfficialRow =
    filteredOfficialRows.find((row, index) => officialReviewRowKey(row, index) === selectedLedgerKey) ??
    filteredOfficialRows[0];
  const activeSummary = officialHitSummary(filteredOfficialRows);
  const officialSummary = officialHitSummary(officialRows);
  const friendlyRelated = friendlyLedger?.summary?.worldCupRelated ?? {};
  const friendlyFullWindow = friendlyLedger?.summary?.fullWindow ?? {};
  const metricCards = [
    { key: 'result', label: '胜平负命中率', summary: officialSummary.result, note: '按赛前主方向结算' },
    { key: 'handicap', label: '亚盘命中率', summary: officialSummary.handicap, note: '按主推比分盘口结算，如主 -0.75 / 客 +1.75' },
    { key: 'goals', label: '进球数命中率', summary: officialSummary.goals, note: 'Top3 候选包含实际总进球即命中' },
    { key: 'score', label: '比分命中率', summary: officialSummary.score, note: 'Top3 候选包含实际比分即命中' }
  ];
  const filterTabs = [
    { key: 'all', label: '全部赛果', count: officialRows.length },
    { key: 'hit', label: '命中', count: officialRows.filter((row) => officialMetricHit(row, metricFilter) === true).length },
    { key: 'miss', label: '未中', count: officialRows.filter((row) => officialMetricHit(row, metricFilter) === false).length },
    { key: 'blocked', label: '未生成', count: officialRows.filter((row) => officialMetricHit(row, metricFilter) == null).length }
  ];
  return (
    <section className="workspace-panel">
      <PanelHeader icon={FileClock} title="预测复盘与准确率校准" subtitle="只记录 2026 世界杯官方正赛已完赛结果；友谊赛和非正赛样本不进入正赛复盘。" />
      <div className="review-hero">
        <article className="review-hero-card primary">
          <Target size={28} />
          <div>
            <span>世界杯正赛赛果</span>
            <strong>{officialRows.length}</strong>
            <small>{officialSummary.evaluated} 场可评估 · {officialSummary.blocked} 场未接入预测</small>
          </div>
        </article>
        {metricCards.map((card) => (
          <button
            className={`review-hero-metric ${metricFilter === card.key ? 'active' : ''}`}
            key={card.key}
            onClick={() => {
              setMetricFilter(card.key);
              setSelectedLedgerKey(null);
            }}
            type="button"
          >
            <span>{card.label}</span>
            <strong>{reviewPercent(card.summary.accuracy, 1)}</strong>
            <small>{card.summary.hits}/{card.summary.evaluated} 命中 · {card.note} · 点击看逐场</small>
          </button>
        ))}
      </div>
      <div className="review-workbench">
        <div className="review-ledger-column">
          <div className="review-tabs" aria-label="世界杯正赛复盘筛选">
            {filterTabs.map((tab) => (
              <button
                className={ledgerFilter === tab.key ? 'active' : ''}
                key={tab.key}
                onClick={() => setLedgerFilter(tab.key)}
                type="button"
              >
                <span>{tab.label}</span>
                <strong>{tab.count}</strong>
              </button>
            ))}
          </div>
          <div className="review-hit-strip" aria-label="逐场赛果记录">
            {filteredOfficialRows.map((row, index) => (
              <button
                aria-label={`${row.homeTeam} 对 ${row.awayTeam} ${officialMetricLabel(metricFilter)} ${officialMetricText(row, metricFilter)}`}
                className={`${officialMetricClass(row, metricFilter)} ${row === selectedOfficialRow ? 'active' : ''}`}
                key={officialReviewRowKey(row, index)}
                onClick={() => setSelectedLedgerKey(officialReviewRowKey(row, index))}
                type="button"
              />
            ))}
          </div>
          <div className="review-ledger-list-detailed">
            {filteredOfficialRows.length ? filteredOfficialRows.map((row, index) => {
              const rowKey = officialReviewRowKey(row, index);
              const isActive = row === selectedOfficialRow;
              const statusClass = officialMetricClass(row, metricFilter);
              return (
                <button
                  className={`review-ledger-item ${statusClass} ${isActive ? 'active' : ''}`}
                  key={rowKey}
                  onClick={() => setSelectedLedgerKey(rowKey)}
                  type="button"
                >
                  <span>{new Date(row.kickoffUtc).toLocaleDateString('zh-CN')}</span>
                  <strong>{row.homeTeam} 对 {row.awayTeam}</strong>
                  <em>{officialLedgerPredictionText(row)}</em>
                  <small>{officialScoreText(row)} · {officialResultMeta(row)}</small>
                  <i>{officialMetricText(row, metricFilter)}</i>
                </button>
              );
            }) : (
              <div className="empty-panel compact">
                <strong>暂无正赛赛果</strong>
                <span>已剔除友谊赛和非正赛样本；等待下一场官方世界杯正赛完赛后录入。</span>
              </div>
            )}
          </div>
        </div>
        <div className="review-detail-column">
          <OfficialResultDetailPanel row={selectedOfficialRow} metricKey={metricFilter} />
          <div className="review-band-panel">
            <strong>正赛命中率拆分</strong>
            {metricCards.map((card) => (
              <div className="review-band-row" key={card.key}>
                <span>{card.label.replace('命中率', '')}</span>
                <i>
                  <b style={{ width: `${Math.max(4, Math.min(100, (card.summary.accuracy ?? 0) * 100))}%` }} />
                </i>
                <em>{reviewPercent(card.summary.accuracy, 0)}</em>
                <small>{card.summary.hits}/{card.summary.evaluated}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="calibration-strip">
        <article>
          <strong>{officialSummary.matches}</strong>
          <span>正赛赛果</span>
        </article>
        <article>
          <strong>{reviewPercent(officialSummary.result.accuracy, 1)}</strong>
          <span>胜平负</span>
        </article>
        <article>
          <strong>{reviewPercent(officialSummary.handicap.accuracy, 1)}</strong>
          <span>亚盘</span>
        </article>
        <article>
          <strong>{reviewPercent(officialSummary.goals.accuracy, 1)}</strong>
          <span>进球数 Top3</span>
        </article>
        <article>
          <strong>{reviewPercent(officialSummary.score.accuracy, 1)}</strong>
          <span>比分 Top3</span>
        </article>
        {calibration?.upsetBreakdown?.map((item) => (
          <article key={item.name}>
            <strong>{item.count}</strong>
            <span>{item.name} · {item.share}%</span>
          </article>
        ))}
      </div>
      <div className="review-matrix">
        {officialRows.length ? officialRows.slice(0, 16).map((match) => (
          <div className="review-row" key={match.id}>
            <span>#{match.matchNo}</span>
            <strong>{match.homeTeam} vs {match.awayTeam}</strong>
            <p>预测 {officialPredictionText(match)} / 球 {officialGoalCandidatesCompact(match)} / 比分 {officialScoreCandidatesCompact(match)}</p>
            <em>模型信心 {match.reviewBaseline ? percent(match.reviewBaseline.confidence) : '--'}</em>
            <i>{match.resultSummary.homeScore}-{match.resultSummary.awayScore} · {match.resultSummary.handicapResult ?? '盘口待结算'}</i>
            <i>{match.resultSummary.upsetType}</i>
          </div>
        )) : (
          <div className="empty-panel">
            <strong>暂无赛果复盘样本</strong>
            <span>官方 2026 正赛赛果尚未录入；友谊赛和非正赛样本已从该列表剔除。</span>
          </div>
        )}
      </div>
    </section>
  );
}

function formatMetric(key, value) {
  if (value == null) return '--';
  if (key === 'sample_size') return String(value);
  if (key === 'generated_at') return new Date(value).toLocaleString('zh-CN', { hour12: false });
  if (typeof value === 'number' && (key.includes('accuracy') || key.includes('error'))) return percent(value);
  if (typeof value === 'number') return value.toFixed(3);
  if (key === 'source') return value === 'synthetic_sample_results' ? '旧版合成赛果' : value;
  return String(value);
}

const FRIENDLY_NAME_ZH = {
  Andorra: '安道尔',
  Aruba: '阿鲁巴',
  Bolivia: '玻利维亚',
  Bonaire: '博奈尔',
  'Bosnia and Herzegovina': '波黑',
  Brazil: '巴西',
  'British Virgin Islands': '英属维尔京群岛',
  'Cayman Islands': '开曼群岛',
  Chile: '智利',
  Colombia: '哥伦比亚',
  Croatia: '克罗地亚',
  Curaçao: '库拉索',
  Cyprus: '塞浦路斯',
  Denmark: '丹麦',
  Ecuador: '厄瓜多尔',
  Egypt: '埃及',
  'El Salvador': '萨尔瓦多',
  England: '英格兰',
  Ethiopia: '埃塞俄比亚',
  Germany: '德国',
  Gibraltar: '直布罗陀',
  Greece: '希腊',
  Guatemala: '危地马拉',
  Italy: '意大利',
  Jamaica: '牙买加',
  Jordan: '约旦',
  Kosovo: '科索沃',
  Kyrgyzstan: '吉尔吉斯斯坦',
  Liberia: '利比里亚',
  Liechtenstein: '列支敦士登',
  Malawi: '马拉维',
  Morocco: '摩洛哥',
  'New Zealand': '新西兰',
  Norway: '挪威',
  Palestine: '巴勒斯坦',
  Panama: '巴拿马',
  Portugal: '葡萄牙',
  Qatar: '卡塔尔',
  Romania: '罗马尼亚',
  Scotland: '苏格兰',
  'Sierra Leone': '塞拉利昂',
  Slovenia: '斯洛文尼亚',
  'South Africa': '南非',
  Turkey: '土耳其',
  Ukraine: '乌克兰',
  'United States': '美国',
  Venezuela: '委内瑞拉',
  Wales: '威尔士',
  Draw: '平局'
};

const FRIENDLY_CODE_ZH = {
  BIH: '波黑',
  BRA: '巴西',
  CUW: '库拉索',
  EGY: '埃及',
  ENG: '英格兰',
  GER: '德国',
  HAI: '海地',
  MAR: '摩洛哥',
  MEX: '墨西哥',
  NOR: '挪威',
  NZL: '新西兰',
  RSA: '南非',
  SCO: '苏格兰'
};

function friendlyNameZh(name) {
  if (!name) return '--';
  return FRIENDLY_NAME_ZH[name] ?? name;
}

function friendlyFixtureZh(rowOrFixture) {
  if (rowOrFixture?.homeTeam && rowOrFixture?.awayTeam) {
    return `${friendlyNameZh(rowOrFixture.homeTeam)} 对 ${friendlyNameZh(rowOrFixture.awayTeam)}`;
  }
  const fixture = String(rowOrFixture ?? '');
  const [home, away] = fixture.split(' vs ');
  if (!away) return friendlyNameZh(fixture);
  return `${friendlyNameZh(home)} 对 ${friendlyNameZh(away)}`;
}

function friendlyOutcomeZh(label) {
  return friendlyNameZh(label);
}

function friendlyTournamentZh(value) {
  if (value === 'Friendly') return '友谊赛';
  return value ?? '--';
}

function friendlySourceZh(value) {
  if (value === 'elo') return '强度层';
  if (value === 'primary') return '主模型';
  return value ?? '模型';
}

function friendlyCodeZh(code) {
  return FRIENDLY_CODE_ZH[code] ?? code;
}

function metricNumber(value, digits = 3) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '--';
}

function metricPercent(value, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? percent(value, digits) : '--';
}

function metricRangePercent(min, max, digits = 1) {
  return typeof min === 'number' && typeof max === 'number'
    ? `${metricPercent(min, digits)}-${metricPercent(max, digits)}`
    : '--';
}

function metricRangeNumber(min, max, digits = 3) {
  return typeof min === 'number' && typeof max === 'number'
    ? `${metricNumber(min, digits)}-${metricNumber(max, digits)}`
    : '--';
}

function metricDeltaPercent(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(digits)}pp`;
}

function metricSignedNumber(value, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? signed(value, digits) : '--';
}

const FRIENDLY_GATE_LABELS = {
  latest_prior_cycles: '短窗口历届对照',
  all_window_prior_cycles: '全窗口历届对照',
  all_window_sample_size: '全窗口样本量',
  latest_vs_all_accuracy_delta: '短窗/全窗命中差',
  latest_accuracy_z: '短窗口 Z 值',
  all_window_accuracy_prior_range: '全窗口历史区间'
};

function friendlyGateLabel(check) {
  return FRIENDLY_GATE_LABELS[check?.key] ?? check?.label ?? '守门条件';
}

function friendlyGateObserved(check) {
  if (check?.observed === null || check?.observed === undefined) return '--';
  if (check.key === 'latest_vs_all_accuracy_delta') return metricDeltaPercent(check.observed);
  if (check.key === 'all_window_accuracy_prior_range') return metricPercent(check.observed);
  if (String(check.key).includes('z')) return metricSignedNumber(check.observed, 2);
  return String(check.observed);
}

function friendlyGateDecisionLabel(gate) {
  if (!gate) return '未生成';
  if (gate.promote_2026_friendly_signal || gate.promoteFriendlySignal) return '可进入模型复核';
  return '保持阻断';
}

function friendlyGateDependencyLabel(gate) {
  if (!gate) return '等待报告';
  if (gate.can_drive_market_recommendation || gate.canDriveMarketRecommendation) return '盘口推荐可用';
  return '盘口推荐仍需赔率/阵容';
}

function providerNoteLabel(note) {
  if (note === 'limited comparable coverage') return '覆盖不足';
  if (note === 'volatile by segment') return '切片波动';
  if (note === 'recent season weaker') return '近期偏弱';
  if (note === 'consistently top tier') return '持续前列';
  if (note === 'cross-segment stable') return '跨切片稳定';
  return note ?? '等待切片';
}

function outcomeLabel(outcome, homeTeam, awayTeam) {
  if (outcome === 'H') return friendlyNameZh(homeTeam);
  if (outcome === 'A') return friendlyNameZh(awayTeam);
  if (outcome === 'D') return '平局';
  return '--';
}

function probabilityEntries(probabilities = {}) {
  return [
    ['主', probabilities.home],
    ['平', probabilities.draw],
    ['客', probabilities.away]
  ];
}

function maxProbability(probabilities = {}) {
  return Math.max(0, ...probabilityEntries(probabilities).map(([, value]) => (typeof value === 'number' ? value : 0)));
}

function buildModelLayerRows(internationalReport) {
  const overall = internationalReport?.evaluation?.overall;
  return [
    { key: 'primary', label: '主模型', detail: 'Elo + 进球层动态融合', metrics: overall?.primary },
    { key: 'elo', label: 'Elo 基线', detail: '只看赛前强弱与主场', metrics: overall?.elo },
    { key: 'blended', label: '校准融合', detail: '按历史误差校准概率', metrics: overall?.blended }
  ];
}

function selectionLabel(selection) {
  if (selection === 'latest_completed_matches_in_window') return '最近完赛窗口';
  if (selection === 'all_completed_matches_in_window') return '全窗口样本';
  if (!selection) return '等待样本';
  return selection;
}

function editionYear(edition) {
  const match = String(edition ?? '').match(/\d{4}/);
  return match ? match[0] : edition ?? '--';
}

function KpiCard({ icon: Icon, label, value, meta, tone = 'steady' }) {
  return (
    <article className={`validation-kpi ${tone}`}>
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value ?? '--'}</strong>
        <small>{meta}</small>
      </div>
    </article>
  );
}

function ProbabilityBars({ probabilities }) {
  return (
    <div className="prob-bars" aria-label="胜平负概率">
      {probabilityEntries(probabilities).map(([label, value]) => (
        <div className="prob-bar" key={label}>
          <span>{label}</span>
          <i>
            <b style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} />
          </i>
          <em>{metricPercent(value, 0)}</em>
        </div>
      ))}
    </div>
  );
}

function LayerComparison({ rows }) {
  const bestAccuracy = Math.max(0.01, ...rows.map((row) => row.metrics?.accuracy ?? 0));
  return (
    <div className="layer-bars">
      {rows.map((row) => {
        const accuracy = row.metrics?.accuracy;
        const width = Math.max(4, ((accuracy ?? 0) / bestAccuracy) * 100);
        return (
          <div className="layer-row" key={row.key}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.detail}</span>
            </div>
            <div className="layer-track">
              <i style={{ width: `${width}%` }} />
            </div>
            <dl>
              <dt>{metricPercent(accuracy)}</dt>
              <dd>LL {metricNumber(row.metrics?.log_loss)}</dd>
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function buildReliabilityRows(internationalReport, historicalReport) {
  return [
    {
      key: 'international-primary',
      label: '国际赛主模型',
      detail: '23238 场 walk-forward',
      metric: internationalReport?.evaluation?.overall?.primary
    },
    {
      key: 'friendly-latest',
      label: '友谊赛最近 24',
      detail: '短窗口只作诊断',
      metric: internationalReport?.friendly_audit?.primary
    },
    {
      key: 'historical-blended',
      label: '五大联赛混合',
      detail: '市场+模型 walk-forward',
      metric: historicalReport?.evaluation?.overall?.blended
    },
    {
      key: 'historical-market',
      label: '五大联赛市场',
      detail: '盘口基准概率',
      metric: historicalReport?.evaluation?.overall?.market_only
    }
  ];
}

function ReliabilityPanel({ rows }) {
  const usableRows = rows.filter((row) => row.metric?.matches > 0);
  const maxCount = Math.max(1, ...usableRows.flatMap((row) => (row.metric?.reliability_bins ?? []).map((bin) => bin.count)));
  return (
    <article className="validation-card reliability-card">
      <header>
        <GitCompare size={18} />
        <div>
          <h2>概率可靠性审计</h2>
          <p>按预测最高概率分桶比较平均信心和真实命中率；ECE 越低，概率越可解释。</p>
        </div>
      </header>
      <div className="reliability-list">
        {usableRows.map((row) => (
          <div className="reliability-row" key={row.key}>
            <div className="reliability-head">
              <div>
                <strong>{row.label}</strong>
                <span>{row.detail} · {row.metric.matches} 场</span>
              </div>
              <dl>
                <dt>ECE {metricPercent(row.metric.calibration_error)}</dt>
                <dd>信心 {metricPercent(row.metric.avg_confidence)} · 命中 {metricPercent(row.metric.accuracy)}</dd>
              </dl>
            </div>
            <div className="reliability-bins" aria-label={`${row.label} 概率可靠性分桶`}>
              {(row.metric.reliability_bins ?? []).map((bin) => {
                const countWidth = Math.max(5, (bin.count / maxCount) * 100);
                const gap = Math.abs(bin.gap ?? 0);
                return (
                  <div className={`reliability-bin ${gap >= 0.08 ? 'wide-gap' : gap >= 0.04 ? 'mid-gap' : ''}`} key={`${bin.lower}-${bin.upper}`}>
                    <span>{metricPercent(bin.lower, 0)}-{metricPercent(bin.upper, 0)}</span>
                    <i style={{ width: `${countWidth}%` }}>
                      <b style={{ width: `${Math.max(4, Math.min(100, (bin.accuracy ?? 0) * 100))}%` }} />
                    </i>
                    <em>{metricPercent(bin.avg_confidence, 0)} / {metricPercent(bin.accuracy, 0)}</em>
                    <small>{bin.count} 场 · gap {metricSignedNumber(bin.gap, 3)}</small>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="validation-note">
        <span>友谊赛短窗 ECE 高时不能升格为固定规则</span>
        <span>国际赛主模型偏保守，平均信心低于真实命中</span>
      </div>
    </article>
  );
}

function FriendlyWindowHistoryPanel({ audits }) {
  const rows = (audits ?? []).filter((audit) => audit?.evaluated_matches > 0);
  const accuracies = rows.map((row) => row.primary?.accuracy).filter((value) => typeof value === 'number');
  const fullAccuracies = rows
    .map((row) => row.full_window?.primary?.accuracy)
    .filter((value) => typeof value === 'number');
  const bestAccuracy = Math.max(0.01, ...accuracies);
  const bestFullAccuracy = Math.max(0.01, ...fullAccuracies);
  const minAccuracy = accuracies.length ? Math.min(...accuracies) : null;
  const maxAccuracy = accuracies.length ? Math.max(...accuracies) : null;
  const currentAudit = rows.find((row) => editionYear(row.edition) === '2026') ?? rows.at(-1);
  const currentFullWindow = currentAudit?.full_window;

  return (
    <article className="validation-card friendly-history-card">
      <header>
        <FileClock size={18} />
        <div>
          <h2>历届赛前窗口对照</h2>
          <p>同一规则：世界杯开幕前当年友谊赛，同时看最近 24 场和全窗口样本，逐届核对而不是只看 2026 单点。</p>
        </div>
      </header>
      <div className="cycle-summary">
        <div>
          <span>周期</span>
          <strong>{rows.length || '--'}</strong>
          <small>2002-2026</small>
        </div>
        <div>
          <span>主模型区间</span>
          <strong>{minAccuracy == null ? '--' : `${metricPercent(minAccuracy, 0)}-${metricPercent(maxAccuracy, 0)}`}</strong>
          <small>同规则命中率</small>
        </div>
        <div>
          <span>2026 当前</span>
          <strong>{metricPercent(currentAudit?.primary?.accuracy)}</strong>
          <small>LL {metricNumber(currentAudit?.primary?.log_loss)}</small>
        </div>
        <div>
          <span>全窗口当前</span>
          <strong>{metricPercent(currentFullWindow?.primary?.accuracy)}</strong>
          <small>{currentFullWindow?.evaluated_matches ?? '--'} 场 · LL {metricNumber(currentFullWindow?.primary?.log_loss)}</small>
        </div>
      </div>
      <div className="cycle-list" aria-label="历届世界杯赛前友谊赛窗口命中率">
        {rows.length > 0 ? (
          rows.map((audit) => {
            const accuracy = audit.primary?.accuracy;
            const fullAccuracy = audit.full_window?.primary?.accuracy;
            const width = Math.max(4, ((accuracy ?? 0) / bestAccuracy) * 100);
            const fullWidth = Math.max(4, ((fullAccuracy ?? 0) / bestFullAccuracy) * 100);
            const isCurrent = editionYear(audit.edition) === '2026';
            return (
              <div className={`cycle-row ${isCurrent ? 'current' : ''}`} key={audit.edition}>
                <span>{editionYear(audit.edition)}</span>
                <div>
                  <strong>{audit.edition}</strong>
                  <small>
                    最近 {audit.evaluated_matches} 场 · 全窗口 {audit.full_window?.evaluated_matches ?? '--'} 场
                  </small>
                </div>
                <div className="cycle-meter-stack">
                  <div className="cycle-meter">
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <div className="cycle-meter full">
                    <i style={{ width: `${fullWidth}%` }} />
                  </div>
                </div>
                <dl>
                  <dt>{metricPercent(accuracy)}</dt>
                  <dd>全 {metricPercent(fullAccuracy)} · LL {metricNumber(audit.primary?.log_loss)}</dd>
                </dl>
                <em>校准 {signed(audit.primary?.calibration_gap, 3)}</em>
              </div>
            );
          })
        ) : (
          <p className="validation-empty">暂无历届赛前窗口审计。请先重新生成国际赛评估报告。</p>
        )}
      </div>
      <div className="validation-note">
        <span>高点 {metricPercent(maxAccuracy)} 不代表固定规则</span>
        <span>低点 {metricPercent(minAccuracy)} 用于提醒友谊赛噪声</span>
        <span>全窗口负责约束最近 24 场的波动</span>
      </div>
    </article>
  );
}

function MajorTournamentAuditPanel({ audit }) {
  const competitions = audit?.competitions ?? [];
  const stages = audit?.stages ?? [];
  const summary = audit?.summary ?? {};
  const guardrails = audit?.guardrails ?? {};
  const maxMatches = Math.max(1, ...competitions.map((row) => Number(row.matches ?? 0)));
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';

  return (
    <article className="validation-card major-tournament-card">
      <header>
        <Trophy size={18} />
        <div>
          <h2>大赛走步审计</h2>
          <p>{audit?.method ?? '等待生成世界杯、欧洲杯和美洲杯历史正赛走步审计。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{audit?.ok ? '审计通过' : audit ? '需复核' : '未生成'}</span>
      </header>
      <div className="cycle-summary">
        <div>
          <span>大赛样本</span>
          <strong>{auditNumber(summary.majorMatches)}</strong>
          <small>世界杯/欧洲杯/美洲杯</small>
        </div>
        <div>
          <span>历史届数</span>
          <strong>{auditNumber(summary.editionCount)}</strong>
          <small>按届 walk-forward</small>
        </div>
        <div>
          <span>阶段切片</span>
          <strong>{auditNumber(summary.stageCount)}</strong>
          <small>小组赛 / 淘汰赛</small>
        </div>
        <div>
          <span>世界杯主模型</span>
          <strong>{auditPercent(summary.worldCup?.primary?.accuracy, 1)}</strong>
          <small>LL {summary.worldCup?.primary?.logLoss ?? '--'} · ECE {auditPercent(summary.worldCup?.primary?.calibrationError, 1)}</small>
        </div>
      </div>
      {competitions.length ? (
        <div className="major-tournament-list">
          {competitions.map((row) => {
            const width = Math.max(6, (Number(row.matches ?? 0) / maxMatches) * 100);
            return (
              <div className="major-tournament-row" key={row.key}>
                <div>
                  <strong>{row.label}</strong>
                  <small>{row.matches} 场 · 融合占比 {auditPercent(row.primaryBlendShare, 0)}</small>
                </div>
                <div className="cycle-meter">
                  <i style={{ width: `${width}%` }} />
                </div>
                <dl>
                  <dt>{auditPercent(row.primary?.accuracy, 1)}</dt>
                  <dd>LL {row.primary?.logLoss ?? '--'} · Elo {row.elo?.logLoss ?? '--'}</dd>
                </dl>
                <em>ECE {auditPercent(row.primary?.calibrationError, 1)}</em>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="validation-empty">暂无大赛走步审计。</p>
      )}
      <div className="major-stage-grid">
        {stages.map((row) => (
          <div key={row.key}>
            <span>{row.label}</span>
            <strong>{row.stageLabel}</strong>
            <small>{row.matches} 场 · {auditPercent(row.primary?.accuracy, 1)} · LL {row.primary?.logLoss ?? '--'}</small>
          </div>
        ))}
      </div>
      <div className="decision-guardrails">
        <span>{guardrails.requiredCompetitionsPresent ? '三类大赛齐全' : '大赛缺项'}</span>
        <span>{guardrails.requiredStagesPresent ? '阶段切片齐全' : '阶段切片缺项'}</span>
        <span>{guardrails.stageCountsReconcile ? '阶段场次可回加' : '阶段场次不一致'}</span>
        <span>{guardrails.editionCoverage ? '历届覆盖达标' : '届数不足'}</span>
        <span>{guardrails.futurePredictionsBlocked ? '未来预测待接入' : '未来预测待查'}</span>
        <span>{guardrails.unscored2026RowsQuarantined ? '2026 未完赛隔离' : '2026 隔离待查'}</span>
      </div>
      <div className="market-audit-note">
        <span>{audit?.file ?? 'reports/major-tournament-audit.json'}</span>
        <span>{audit?.decision?.reason ?? '大赛审计只支持逻辑合理性复核，不单独晋级投注推荐。'}</span>
      </div>
    </article>
  );
}

function iterationDecisionLabel(decision) {
  if (decision === 'accept_for_review') return '进入复核';
  if (decision === 'monitor_only') return '仅观察';
  if (decision === 'reject_or_block') return '阻断';
  return '待审计';
}

function ModelIterationAuditPanel({ audit }) {
  const rows = audit?.iterations ?? [];
  const summary = audit?.summary ?? {};
  const guardrails = audit?.guardrails ?? {};
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';

  return (
    <article className="validation-card iteration-audit-card">
      <header>
        <GitCompare size={18} />
        <div>
          <h2>模型迭代审计</h2>
          <p>{audit?.method ?? '等待汇总模型层、盘口层和友谊赛短窗的迭代证据。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{audit?.ok ? '审计通过' : audit ? '需复核' : '未生成'}</span>
      </header>
      <div className="cycle-summary">
        <div>
          <span>迭代项</span>
          <strong>{auditNumber(summary.totalIterations)}</strong>
          <small>模型层/盘口层/短窗</small>
        </div>
        <div>
          <span>进入复核</span>
          <strong>{auditNumber(summary.acceptForReview)}</strong>
          <small>仍不等于推荐</small>
        </div>
        <div>
          <span>仅观察</span>
          <strong>{auditNumber(summary.monitorOnly)}</strong>
          <small>证据薄或波动大</small>
        </div>
        <div>
          <span>可驱动推荐</span>
          <strong>{auditNumber(summary.canDrive2026Recommendation)}</strong>
          <small>必须为 0</small>
        </div>
      </div>
      {rows.length ? (
        <div className="iteration-row-list">
          {rows.map((row) => (
            <div className={`iteration-row ${row.decision ?? 'pending'}`} key={row.key}>
              <div>
                <strong>{row.label}</strong>
                <small>{row.reason}</small>
              </div>
              <span className="iteration-status">{iterationDecisionLabel(row.decision)}</span>
              <em>{row.canDrive2026Recommendation ? '可驱动推荐' : '不直接推荐'}</em>
              <small>{row.evidence}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="validation-empty">暂无模型迭代审计。</p>
      )}
      <div className="decision-guardrails">
        <span>{guardrails.marketPriorRequired ? '市场先验必须保留' : '市场先验待查'}</span>
        <span>{guardrails.valueResearchBlocksPromotion ? '价值阈值阻断' : '价值阈值待查'}</span>
        <span>{guardrails.worldCupBlendOnlyForReview ? '世界杯融合仅复核' : '世界杯融合待查'}</span>
        <span>{guardrails.providerMovementBounded ? '盘口修正受控' : '盘口修正待查'}</span>
        <span>{guardrails.noIterationDirectlyDrivesRecommendation ? '无直接推荐层' : '存在推荐风险'}</span>
      </div>
      <div className="market-audit-note">
        <span>{audit?.file ?? 'reports/model-iteration-audit.json'}</span>
        <span>迭代项必须先通过真实走步和守门，再进入 2026 逻辑复核。</span>
      </div>
    </article>
  );
}

function FriendlyGuardrailPanel({ summary }) {
  if (!summary) return null;
  const latest = summary.latest_24;
  const full = summary.full_window;
  const comparison = summary.latest_vs_full_2026 ?? {};
  const gate = summary.promotion_gate;
  const gateChecks = Array.isArray(gate?.checks) ? gate.checks : [];
  const gateBlocked = gate && !gate.promote_2026_friendly_signal;
  const gateReasonText = Array.isArray(gate?.blocked_reasons)
    ? gate.blocked_reasons.map((key) => FRIENDLY_GATE_LABELS[key] ?? key).join(' · ')
    : '';
  const rows = [
    {
      key: 'latest',
      title: '最近 24 场',
      label: '短窗口',
      metric: latest,
      sample: comparison.latest_matches,
      tone: 'focus'
    },
    {
      key: 'full',
      title: '全窗口',
      label: '守门样本',
      metric: full,
      sample: comparison.full_window_matches,
      tone: 'steady'
    }
  ];
  return (
    <article className="validation-card friendly-guardrail-card">
      <header>
        <ShieldCheck size={18} />
        <div>
          <h2>友谊赛稳定性守门</h2>
          <p>2026 最近 24 场命中率很高，但必须和历届同口径分布、全窗口样本一起判断，避免把小样本高点写成固定规则。</p>
        </div>
      </header>
      <div className="guardrail-summary">
        {rows.map((row) => {
          const metric = row.metric;
          const width = Math.max(4, Math.min(100, (metric?.current_accuracy ?? 0) * 100));
          const priorCycles = metric?.prior_cycle_count ?? metric?.prior_cycles ?? 0;
          return (
            <div className={`guardrail-item ${row.tone}`} key={row.key}>
              <div>
                <span>{row.label}</span>
                <strong>{row.title}</strong>
                <small>{row.sample ?? '--'} 场 · 对照 {priorCycles} 届</small>
              </div>
              <div className="guardrail-meter" aria-label={`${row.title} 2026 命中率 ${metricPercent(metric?.current_accuracy)}`}>
                <i style={{ width: `${width}%` }} />
              </div>
              <dl>
                <dt>{metricPercent(metric?.current_accuracy)}</dt>
                <dd>历史均值 {metricPercent(metric?.prior_accuracy_mean)}</dd>
              </dl>
              <ul>
                <li>历史区间 {metricRangePercent(metric?.prior_accuracy_min, metric?.prior_accuracy_max)}</li>
                <li>LL 区间 {metricRangeNumber(metric?.prior_log_loss_min, metric?.prior_log_loss_max)}</li>
                <li>Z {metricSignedNumber(metric?.current_accuracy_z, 2)} · LL Z {metricSignedNumber(metric?.current_log_loss_z, 2)}</li>
              </ul>
            </div>
          );
        })}
      </div>
      {gate ? (
        <div className={`guardrail-gate ${gateBlocked ? 'blocked' : 'passed'}`}>
          <div className="guardrail-gate-status">
            {gateBlocked ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
            <div>
              <span>晋升 gate</span>
              <strong>{friendlyGateDecisionLabel(gate)}</strong>
              <small>{friendlyGateDependencyLabel(gate)}</small>
            </div>
          </div>
          <ul className="gate-check-list">
            {gateChecks.map((check) => (
              <li className={check.passed ? 'passed' : 'blocked'} key={check.key}>
                <span>{friendlyGateLabel(check)}</span>
                <strong>{friendlyGateObserved(check)}</strong>
                <small>{check.passed ? '通过' : '阻断'} · 阈值 {check.threshold ?? '--'}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="guardrail-comparison">
        <div>
          <span>2026 命中差</span>
          <strong>{metricDeltaPercent(comparison.accuracy_delta)}</strong>
          <small>最近 24 场相对全窗口</small>
        </div>
        <div>
          <span>Log loss 差</span>
          <strong>{metricSignedNumber(comparison.log_loss_delta, 3)}</strong>
          <small>负值代表短窗口更好</small>
        </div>
        <div>
          <span>判断</span>
          <strong>{friendlyGateDecisionLabel(gate)}</strong>
          <small>{gateReasonText || '高点进入权重提示，不单独升级规则'}</small>
        </div>
      </div>
    </article>
  );
}

function FriendlyAuditPanel({ audit }) {
  const rows = audit?.matches ?? [];
  const latestRows = [...rows].reverse().slice(0, 10);
  const fullWindow = audit?.full_window;
  const latestAccuracy = audit?.primary?.accuracy;
  const fullAccuracy = fullWindow?.primary?.accuracy;
  const hasComparableAccuracy = typeof latestAccuracy === 'number' && typeof fullAccuracy === 'number';
  return (
    <article className="validation-card">
      <header>
        <Activity size={18} />
        <div>
          <h2>赛前友谊赛核对</h2>
          <p>
            {audit
              ? `${audit.start_date} 至 ${audit.end_date}，最近 ${audit.evaluated_matches} 场用于短期核对，全窗口 ${fullWindow?.evaluated_matches ?? 0} 场用于守门。`
              : '等待重新生成国际赛报告后填充赛前核对记录。'}
          </p>
        </div>
      </header>
      <div className="audit-metrics">
        <div>
          <span>主模型</span>
          <strong>{metricPercent(audit?.primary?.accuracy)}</strong>
          <small>LL {metricNumber(audit?.primary?.log_loss)}</small>
        </div>
        <div>
          <span>融合层</span>
          <strong>{metricPercent(audit?.blended?.accuracy)}</strong>
          <small>LL {metricNumber(audit?.blended?.log_loss)}</small>
        </div>
        <div>
          <span>Elo</span>
          <strong>{metricPercent(audit?.elo?.accuracy)}</strong>
          <small>LL {metricNumber(audit?.elo?.log_loss)}</small>
        </div>
        <div>
          <span>全窗口主模型</span>
          <strong>{metricPercent(fullWindow?.primary?.accuracy)}</strong>
          <small>{fullWindow?.evaluated_matches ?? '--'} 场 · LL {metricNumber(fullWindow?.primary?.log_loss)}</small>
        </div>
      </div>
      <div className="validation-note">
        <span>短窗口 {audit?.evaluated_matches ?? '--'} 场</span>
        <span>全窗口 {fullWindow?.evaluated_matches ?? '--'} 场</span>
        <span>命中差 {hasComparableAccuracy ? metricDeltaPercent(latestAccuracy - fullAccuracy) : '--'}</span>
      </div>
      <div className="audit-ledger">
        {latestRows.length > 0 ? (
          latestRows.map((row) => (
            <div className={`audit-row ${row.correct ? 'hit' : 'miss'}`} key={`${row.date}-${row.home_team}-${row.away_team}`}>
              <span>{row.date}</span>
              <div>
                <strong>{friendlyNameZh(row.home_team)} 对 {friendlyNameZh(row.away_team)}</strong>
                <small>{row.score} · 实际 {outcomeLabel(row.actual, row.home_team, row.away_team)}</small>
              </div>
              <ProbabilityBars probabilities={row.primary_probabilities} />
              <em>{outcomeLabel(row.pick, row.home_team, row.away_team)}</em>
              <i>{row.correct ? '命中' : '偏差'}</i>
            </div>
          ))
        ) : (
          <p className="validation-empty">暂无赛前核对样本。</p>
        )}
      </div>
    </article>
  );
}

function WorldCupPreviewPanel({ predictions, fixtureAudit }) {
  const previewRows = [...(predictions ?? [])]
    .sort((a, b) => maxProbability(b.probabilities) - maxProbability(a.probabilities))
    .slice(0, 8);
  const officialSchedule = fixtureAudit?.official_schedule;
  const officialRows = officialSchedule?.sample_fixtures ?? [];
  const ignoredRows = fixtureAudit?.ignored_rows ?? 0;
  const statusLabel = {
    official_schedule_parsed_predictions_blocked: '官方赛程已结构化',
    ignored_unverified_cache: '已阻断未核实缓存',
    official_schedule_missing: '官方赛程未读取'
  }[fixtureAudit?.status] ?? fixtureAudit?.status ?? '等待审计';
  return (
    <article className="validation-card">
      <header>
        <Trophy size={18} />
        <div>
          <h2>2026 赛程源审计</h2>
          <p>
            {previewRows.length > 0
              ? '只展示已通过官方源校验的未来赛程预测，不进入训练与准确率统计。'
              : officialSchedule?.match_count
                ? '已解析 FIFA 官方赛程；预测仍等待赔率、阵容新闻和赛前状态输入。'
                : '第三方缓存的未来赛程已停用；官方赛程结构化接入前不展示预测。'}
          </p>
        </div>
      </header>
      <div className="validation-note">
        <span>官方赛程 {officialSchedule?.match_count ?? 0} 场</span>
        <span>日期 {dateSpanText(officialSchedule?.date_span_et)}</span>
        <span>预测输出 {previewRows.length} 场</span>
        <span>忽略缓存 {ignoredRows} 条</span>
        <span>状态 {statusLabel}</span>
      </div>
      <div className="schedule-audit-grid">
        <div>
          <span>官方结构化</span>
          <strong>{officialSchedule?.match_count ?? '--'}</strong>
          <small>{officialSchedule?.venue_count ? `${officialSchedule.venue_count} 个场馆` : '等待解析'}</small>
        </div>
        <div>
          <span>时间基准</span>
          <strong>ET</strong>
          <small>{officialSchedule?.time_basis ?? '按 FIFA 发布源校验'}</small>
        </div>
        <div>
          <span>预测状态</span>
          <strong>{previewRows.length}</strong>
          <small>未接入可靠临场输入前不输出</small>
        </div>
      </div>
      {officialRows.length > 0 && (
        <div className="official-fixture-list">
          {officialRows.map((row) => (
            <div className="official-fixture-row" key={row.match_no}>
              <span>M{row.match_no}</span>
              <div>
                <strong>{officialFixtureText(row)}</strong>
                <small>{row.date_et} {row.kickoff_et} ET · {row.venue}</small>
              </div>
              <em>{row.round_label}</em>
            </div>
          ))}
        </div>
      )}
      <div className="future-list">
        {previewRows.length > 0 ? (
          previewRows.map((row) => (
            <div className="future-row" key={`${row.date}-${row.home_team}-${row.away_team}`}>
              <span>{row.date}</span>
              <div>
                <strong>{row.home_team} vs {row.away_team}</strong>
                <small>{row.city || row.country || '场地待确认'} · {row.neutral ? '中立场' : '非中立场'}</small>
              </div>
              <ProbabilityBars probabilities={row.probabilities} />
              <em>{outcomeLabel(row.pick, row.home_team, row.away_team)}</em>
            </div>
          ))
        ) : (
          <p className="validation-empty">官方赛程已进入源审计，预测暂不输出；模型只保留历史 walk-forward、赛前友谊赛核对和市场习惯验证结果。</p>
        )}
      </div>
    </article>
  );
}

function MarketHabitPanel({ historicalReport }) {
  const overall = historicalReport?.evaluation?.overall;
  const decision = overall?.decision_accuracy;
  const movement = historicalReport?.evaluation?.primary_market_movement;
  const providers = historicalReport?.evaluation?.provider_tendencies?.slice(0, 4) ?? [];
  const robustness = historicalReport?.evaluation?.provider_robustness?.slice(0, 5) ?? [];
  const providerRows = robustness.length ? robustness : providers;
  const bestProvider = providerRows[0];
  const seasonSegmentCount = historicalReport?.evaluation?.provider_by_season?.length;
  const leagueSegmentCount = historicalReport?.evaluation?.provider_by_league?.length;
  const segmentMinRows = historicalReport?.evaluation?.provider_segment_min_rows ?? 150;
  const comparisonRows = [
    { label: '市场基准', metric: overall?.market_only, meta: '赔率隐含概率' },
    { label: '模型融合', metric: overall?.blended, meta: '模型 + 市场' },
    { label: '自适应选择', metric: decision?.adaptive, meta: `覆盖 ${metricPercent(decision?.adaptive?.override_rate)}` },
    { label: '动量自适应', metric: decision?.movement_adaptive, meta: `覆盖 ${metricPercent(decision?.movement_adaptive?.override_rate)}` }
  ];

  return (
    <article className="validation-card market-card">
      <header>
        <LineChart size={18} />
        <div>
          <h2>五大联赛市场习惯</h2>
          <p>用赛前赔率检验各家盘口习惯、收盘移动和模型覆盖边界。</p>
        </div>
      </header>
      <div className="market-grid">
        {comparisonRows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{metricPercent(row.metric?.accuracy)}</strong>
            <small>LL {metricNumber(row.metric?.log_loss)} · {row.meta}</small>
          </div>
        ))}
      </div>
      <div className="movement-strip">
        <strong>收盘移动</strong>
        <span>开盘 LL {metricNumber(movement?.opening_log_loss)}</span>
        <span>收盘 LL {metricNumber(movement?.closing_log_loss)}</span>
        <span>命中提升 {metricPercent(movement?.closing_pick_lift)}</span>
      </div>
      <div className="provider-stability-summary">
        <div>
          <span>稳定性首位</span>
          <strong>{bestProvider?.label ?? '--'}</strong>
          <small>
            Score {metricNumber(bestProvider?.stability_score)} · 全样本 LL{' '}
            {metricNumber(bestProvider?.overall_log_loss ?? bestProvider?.log_loss)}
          </small>
        </div>
        <div>
          <span>切片覆盖</span>
          <strong>
            {bestProvider?.season_coverage ?? '--'}/{seasonSegmentCount ?? '--'} 赛季
          </strong>
          <small>
            {bestProvider?.league_coverage ?? '--'}/{leagueSegmentCount ?? '--'} 联赛 · 阈值 {segmentMinRows} 场
          </small>
        </div>
        <div>
          <span>最近赛季</span>
          <strong>{bestProvider?.latest_season?.label ?? '--'}</strong>
          <small>
            LL {metricNumber(bestProvider?.latest_season?.log_loss)} · 命中{' '}
            {metricPercent(bestProvider?.latest_season?.accuracy)}
          </small>
        </div>
      </div>
      <div className="provider-list">
        {providerRows.map((provider) => (
          <div className="provider-row provider-row-stability" key={provider.provider}>
            <strong>
              {provider.label}
              <small>{providerNoteLabel(provider.note)}</small>
            </strong>
            <span>{provider.rows} 场</span>
            <em>
              {provider.stability_score == null
                ? `LL ${metricNumber(provider.log_loss)}`
                : `Score ${metricNumber(provider.stability_score)}`}
            </em>
            <i>
              赛季 {provider.season_coverage ?? '--'}
              {typeof provider.league_coverage === 'number' ? ` · 联赛 ${provider.league_coverage}` : ''}
            </i>
          </div>
        ))}
      </div>
      <div className="validation-note">
        <span>全样本排名只作审计输入</span>
        <span>按赛季/联赛波动修正信任度</span>
        <span>不把历史最优源固定到世界杯</span>
      </div>
    </article>
  );
}

function ExistingModelSummary({ active, tagRules }) {
  return (
    <div className="model-legacy">
      <article className="model-card wide">
        <h2>{active?.name ?? '模型版本'}</h2>
        <p>{active?.notes ?? '等待模型版本信息。'}</p>
        <div className="weights-grid">
          {active?.weights &&
            Object.entries(active.weights).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{percent(value, 0)}</strong>
              </div>
            ))}
        </div>
      </article>
      <article className="model-card">
        <h2>旧版摘要</h2>
        {active?.accuracy &&
          Object.entries(active.accuracy).map(([key, value]) => (
            <div className="kv" key={key}>
              <span>{key}</span>
              <strong>{formatMetric(key, value)}</strong>
            </div>
          ))}
      </article>
      <div className="rule-table compact">
        {tagRules?.slice(0, 6).map((rule) => (
          <div className="rule-row" key={rule.code}>
            <strong>{rule.name}</strong>
            <span>{rule.category}</span>
            <p>{rule.triggerCondition}</p>
            <em>{rule.impactDirection}</em>
            <i>历史 {percent(rule.historicalHitRate)}</i>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModelsView({ models, tagRules, reports }) {
  const active = models?.[0];
  const internationalReport = reports?.international;
  const historicalReport = reports?.historical;
  const majorTournamentAudit = reports?.majorTournament;
  const modelIterationAudit = reports?.modelIteration;
  const internationalOverall = internationalReport?.evaluation?.overall;
  const friendlyAudit = internationalReport?.friendly_audit;
  const friendlyHits = friendlyAudit?.matches?.filter((row) => row.correct).length ?? 0;
  const futurePredictions = internationalReport?.future_predictions ?? [];
  const fixtureAudit = internationalReport?.future_fixture_audit;
  const officialSchedule = fixtureAudit?.official_schedule;
  const historicalOverall = historicalReport?.evaluation?.overall;
  const latestCompletedDate = internationalReport?.latest_completed_date ?? '--';
  const preWorldCupFriendlyAudits = internationalReport?.pre_world_cup_friendly_audits ?? [];
  const friendlyWindowStability = internationalReport?.friendly_window_stability;

  return (
    <section className="workspace-panel">
      <PanelHeader
        icon={ShieldCheck}
        title="模型验证工作台"
        subtitle="用真实历史 walk-forward、赛前友谊赛核对、市场习惯和 2026 赛程源审计来判断模型是否可用。"
      />
      <div className="validation-hero">
        <KpiCard
          icon={Activity}
          label="国际赛 walk-forward"
          value={metricPercent(internationalOverall?.primary?.accuracy)}
          meta={`${internationalOverall?.primary?.matches ?? 0} 场 · LL ${metricNumber(internationalOverall?.primary?.log_loss)}`}
          tone="strong"
        />
        <KpiCard
          icon={Target}
          label="友谊赛赛前核对"
          value={metricPercent(friendlyAudit?.primary?.accuracy)}
          meta={`${friendlyHits}/${friendlyAudit?.evaluated_matches ?? 0} 命中 · ${selectionLabel(friendlyAudit?.selection)}`}
          tone="focus"
        />
        <KpiCard
          icon={BarChart3}
          label="五大联赛市场基准"
          value={metricPercent(historicalOverall?.market_only?.accuracy)}
          meta={`${historicalOverall?.market_only?.matches ?? 0} 场 · LL ${metricNumber(historicalOverall?.market_only?.log_loss)}`}
          tone="market"
        />
        <KpiCard
          icon={Gauge}
          label="2026 源审计"
          value={officialSchedule?.match_count ?? futurePredictions.length}
          meta={
            officialSchedule?.match_count
              ? `官方 ${dateSpanText(officialSchedule.date_span_et)} · 预测 ${futurePredictions.length}`
              : `已忽略 ${fixtureAudit?.ignored_rows ?? 0} 条未核实缓存 · 历史源 ${latestCompletedDate}`
          }
          tone="steady"
        />
      </div>
      <div className="validation-grid">
        <article className="validation-card">
          <header>
            <BarChart3 size={18} />
            <div>
              <h2>国际赛分层对比</h2>
              <p>同一时间顺序下比较主模型、Elo 基线和校准融合，避免只看单一回测结论。</p>
            </div>
          </header>
          <LayerComparison rows={buildModelLayerRows(internationalReport)} />
          <div className="validation-note">
            <span>校准差 {metricNumber(internationalOverall?.primary?.calibration_gap)}</span>
            <span>平均信心 {metricPercent(internationalOverall?.primary?.avg_confidence)}</span>
            <span>平局预测 {metricPercent(internationalOverall?.primary?.draw_probability)}</span>
          </div>
        </article>
        <ReliabilityPanel rows={buildReliabilityRows(internationalReport, historicalReport)} />
        <MajorTournamentAuditPanel audit={majorTournamentAudit} />
        <ModelIterationAuditPanel audit={modelIterationAudit} />
        <FriendlyAuditPanel audit={friendlyAudit} />
        <FriendlyWindowHistoryPanel audits={preWorldCupFriendlyAudits} />
        <FriendlyGuardrailPanel summary={friendlyWindowStability} />
        <MarketHabitPanel historicalReport={historicalReport} />
        <WorldCupPreviewPanel predictions={futurePredictions} fixtureAudit={fixtureAudit} />
      </div>
      <ExistingModelSummary active={active} tagRules={tagRules} />
    </section>
  );
}

function normalizeSourceNotes(sources) {
  if (!sources) return [];
  const notes = [];
  for (const key of ['teams', 'schedule', 'results']) {
    const value = sources[key];
    if (value) notes.push(String(value));
  }
  const odds = sources.odds;
  if (Array.isArray(odds)) {
    for (const source of odds) {
      const sourceType = source.source_type ?? source.sourceType ?? 'market';
      const rowsImported = source.count ?? source.importedRows ?? 0;
      const available = source.verified_snapshots_available ?? source.verifiedSnapshotsAvailable ?? null;
      const completeCandidates = source.complete_candidates ?? source.completeCandidates ?? 0;
      const importedText = available == null ? `入库 ${rowsImported}` : `可用 ${available} / 本轮 ${rowsImported}`;
      notes.push(
        `赔率 ${source.provider}/${sourceType} · ${importedText} · 完整候选 ${completeCandidates} · ${source.status ?? '待审计'}`
      );
    }
  } else if (odds) {
    notes.push(String(odds));
  }
  return notes;
}

function auditNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? String(numeric) : '--';
}

function auditPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return `${(numeric * 100).toFixed(digits)}%`;
}

function uncertaintyMarginText(uncertainty) {
  const numeric = Number(uncertainty?.margin);
  if (!Number.isFinite(numeric)) return '区间待审计';
  return `区间 ±${auditPercent(numeric, 1)}`;
}

function consensusMethodText(consensus) {
  if (!consensus?.providerCount) return '共识待审计';
  const matched = Number(consensus.matchedProviderCount ?? 0);
  const method = consensus.method === 'historical_provider_weighted' ? '历史加权' : '等权平均';
  return `${method} ${matched}/${consensus.providerCount}`;
}

function movementSummaryText(movement) {
  if (!movement?.supplied) return '移动样本不足';
  const direction =
    movement.favoriteDirection === 'strengthened'
      ? '顺向'
      : movement.favoriteDirection === 'weakened'
        ? '逆向'
        : '横盘';
  return `移动${direction} ${auditPercent(movement.favoriteDelta, 1)} / ${auditNumber(movement.providerCount)}家`;
}

function auditMetric(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return numeric.toFixed(digits);
}

const evidenceGuardrailLabels = {
  coreFilesExist: '核心文件存在',
  coreFilesHashed: '核心文件已指纹',
  footballDataFilesPresent: '五大联赛文件完整',
  footballDataRowsMatchReport: '联赛行数对齐',
  internationalRowsMatchCsv: '国家队行数对齐',
  officialScheduleMatchesAlign: '官方 104 场对齐',
  officialScheduleStageCountsAlign: '阶段数量对齐',
  oddsSnapshotsAlign: '盘口快照对齐',
  predictionsAlign: '预判数量对齐',
  officialResultsScoped: '官方赛果范围正确',
  downstreamReportsOk: '下游报告通过',
  promotionStatusPreviewOnly: '保持预判模式',
  generationOrderValid: '生成顺序有效',
  noDirectRecommendation: '无直接推荐'
};

const evidenceGuardrailOrder = [
  'coreFilesHashed',
  'footballDataRowsMatchReport',
  'internationalRowsMatchCsv',
  'officialScheduleMatchesAlign',
  'officialScheduleStageCountsAlign',
  'oddsSnapshotsAlign',
  'predictionsAlign',
  'officialResultsScoped',
  'promotionStatusPreviewOnly',
  'noDirectRecommendation'
];

const evidenceFeaturedFiles = new Set([
  'data/research/worldcup-2026/FWC26-Match-Schedule_English.pdf',
  'data/research/worldcup-2026/official-schedule.json',
  'data/research/worldcup-2026/odds-source-audit.json',
  'reports/historical-model-evaluation.json',
  'reports/international-model-evaluation.json',
  'reports/friendly-prediction-ledger.json',
  'reports/preview-decision-audit.json',
  'reports/promotion-gate-audit.json'
]);

function shortSha(value) {
  if (!value) return '--';
  return String(value).slice(0, 12);
}

function formatBytes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  if (numeric >= 1024 * 1024) return `${(numeric / 1024 / 1024).toFixed(1)} MB`;
  if (numeric >= 1024) return `${Math.round(numeric / 1024)} KB`;
  return `${numeric} B`;
}

function evidenceStatusLabel(audit) {
  if (!audit) return '未生成';
  return audit.ok ? '证据已对齐' : '需复核';
}

function evidenceFileLabel(filePath) {
  const map = {
    'data/research/worldcup-2026/FWC26-Match-Schedule_English.pdf': 'FIFA 赛程 PDF',
    'data/research/worldcup-2026/official-schedule.json': '官方赛程结构化',
    'data/research/worldcup-2026/odds-source-audit.json': '盘口源审计',
    'reports/historical-model-evaluation.json': '五大联赛走步',
    'reports/international-model-evaluation.json': '国家队评估',
    'reports/friendly-prediction-ledger.json': '友谊赛核对',
    'reports/preview-decision-audit.json': '预判决策',
    'reports/promotion-gate-audit.json': '晋级门'
  };
  return map[filePath] ?? filePath?.split('/').pop() ?? '证据文件';
}

function marketAuditStatusLabel(audit) {
  const available = Number(audit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const rows = Number(audit?.importSummary?.rowsImported ?? 0);
  if (!audit) return '待运行';
  if (available > 0) return '预判可用';
  if (rows > 0) return '已入库';
  if (audit.status === 'blocked_no_verified_market_odds') return '盘口待接入';
  if (String(audit.status ?? '').includes('error')) return '读取异常';
  return '审计中';
}

function sourceStatusLabel(status) {
  const map = {
    complete_market_candidates_found: '完整候选',
    official_sporttery_complete_snapshots: '体彩完整盘口',
    official_spf_hhad_candidates_found_missing_totals: '体彩胜平负候选',
    reachable_worldcup_rows_missing_complete_market: '世界杯行待补全',
    reachable_worldcup_rows_missing_complete_spf_hhad: '世界杯行待补全',
    reachable_no_worldcup_market: '未见世界杯盘口',
    reachable_no_complete_worldcup_market: '未见完整世界杯盘口',
    reachable_result_endpoint_no_worldcup_market: '赛果源可达',
    candidate_rows_found_needs_live_market_adapter: '候选需适配',
    public_pool_config_detected_mapping_required: '池配置已识别',
    reachable_waf_challenge_no_machine_readable_market: 'WAF 阻断解析',
    reachable_no_verified_worldcup_market_adapter: '无稳定盘口适配',
    probed_blocked_public_pages_no_import: '公开页阻断',
    probed_no_direct_import: '仅审计不入库',
    reachable_no_window_matches: '窗口无比赛',
    reachable_public_page_no_machine_adapter: '公开页未适配',
    blocked_cloudflare: 'Cloudflare 阻断',
    blocked_or_geo_restricted: '地域/权限阻断',
    blocked_http_403: 'HTTP 403',
    requires_api_key: '等待 API key',
    fetch_failed: '抓取失败'
  };
  return map[status] ?? status ?? '待审计';
}

function sourceStatusClass(status) {
  if (status === 'complete_market_candidates_found') return 'ready';
  if (status === 'fetch_failed') return 'error';
  if (
    status === 'requires_api_key' ||
    String(status ?? '').includes('blocked') ||
    String(status ?? '').includes('waf') ||
    String(status ?? '').includes('no_machine')
  ) {
    return 'blocked';
  }
  return 'watch';
}

function formatAuditDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '--';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function compactSourceType(sourceType) {
  const map = {
    official_sporttery_calculator: '体彩官方',
    dongqiudi_odds_index: '懂球帝指数',
    european_bookmaker_public_snapshot: '欧洲公开快照',
    european_bookmaker_api: '欧洲 API',
    official_result_endpoint: '官方赛果源',
    official_site_config: '官方池配置',
    official_site_waf_probe: '官网探测',
    public_page_probe: '公开页探测'
  };
  return map[sourceType] ?? sourceType ?? '盘口源';
}

function edgeText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return signed(number, 3);
}

function recommendationTierLabel(tier) {
  if (tier === 'candidate') return '候选';
  if (tier === 'avoid') return '不追';
  if (tier === 'watch') return '观察';
  return tier ?? '--';
}

function recommendationDiffText(change) {
  const fieldMap = {
    tier: '分层',
    receivingSide: '受让侧',
    pick: '让球项',
    odds: '赔率',
    modelProbability: '概率',
    edge: '边际',
    confidence: '信心',
    upsetRisk: '冷门'
  };
  return `${fieldMap[change.field] ?? change.field}: ${change.before ?? '--'} -> ${change.after ?? '--'}`;
}

function previewTierRank(row) {
  const rank = {
    candidate: 0,
    watch: 1,
    market_close: 2,
    negative: 3,
    blocked: 4
  };
  return rank[row?.decision?.tier] ?? 5;
}

function sortedPreviewRows(rows) {
  return [...(rows ?? [])].sort((left, right) => {
    const rankDelta = previewTierRank(left) - previewTierRank(right);
    if (rankDelta !== 0) return rankDelta;
    const valueDelta = Number(right.valueScore ?? -999) - Number(left.valueScore ?? -999);
    if (Math.abs(valueDelta) > 0.0001) return valueDelta;
    return Number(left.matchNo ?? 999) - Number(right.matchNo ?? 999);
  });
}

function previewShareStatusLabel(promotionGate, tierCounts) {
  if (Number(tierCounts?.candidate ?? 0) > 0) return '有候选待复核';
  if (promotionGate?.status === 'preview_only_no_promotion') return '只允许预判';
  if (Number(tierCounts?.watch ?? 0) > 0) return '观察清单';
  return '暂无候选';
}

function MarketPreviewSharePanel({ audit, marketAudit, promotionGate }) {
  const rows = sortedPreviewRows(audit?.rows);
  const tierCounts = audit?.tierCounts ?? {};
  const available = Number(marketAudit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const rowsImported = Number(marketAudit?.importSummary?.rowsImported ?? 0);
  const statusClass = rows.length ? 'ready' : audit ? 'blocked' : 'watch';
  const sourceBadges = (marketAudit?.sources ?? []).slice(0, 6);
  const noCandidate = Number(tierCounts.candidate ?? 0) === 0;

  return (
    <div className="market-preview-share-panel">
      <div className="market-audit-head">
        <div>
          <h2>赛前盘口预判分享</h2>
          <p>
            {noCandidate
              ? '当前没有正价值候选；只把完整盘口绑定后的观察、不追和贴盘状态展示为赛前数据分享。'
              : '候选仍需阵容、伤停、天气和新闻复核，通过守门前不升级成投注指令。'}
          </p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{previewShareStatusLabel(promotionGate, tierCounts)}</span>
      </div>
      <div className="share-kpi-strip">
        <div>
          <span>完整快照</span>
          <strong>{auditNumber(available)}</strong>
          <small>本轮新增 {auditNumber(rowsImported)}</small>
        </div>
        <div>
          <span>预判场次</span>
          <strong>{auditNumber(audit?.predictionCount)}</strong>
          <small>绑定 provider 优先级</small>
        </div>
        <div>
          <span>候选 / 观察</span>
          <strong>{auditNumber(tierCounts.candidate)} / {auditNumber(tierCounts.watch)}</strong>
          <small>价值阈值守门</small>
        </div>
        <div>
          <span>不追</span>
          <strong>{auditNumber(tierCounts.negative)}</strong>
          <small>负价值或风险过滤</small>
        </div>
      </div>
      {sourceBadges.length ? (
        <div className="preview-source-badges" aria-label="盘口源状态">
          {sourceBadges.map((source) => (
            <span className={`source-status ${sourceStatusClass(source.status)}`} key={`${source.provider}-${source.sourceType}`}>
              {source.provider} · {sourceStatusLabel(source.status)}
            </span>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <div className="preview-share-list" aria-label="赛前盘口预判清单">
          <div className="preview-share-row preview-share-head">
            <span>分层</span>
            <span>比赛</span>
            <span>胜平负概率区间</span>
            <span>价值 / 风险</span>
            <span>来源</span>
          </div>
          {rows.map((row) => (
            <div className={`preview-share-row tier-${row.decision?.tier ?? 'blocked'}`} key={row.matchNo}>
              <div className="preview-share-decision">
                <strong>{row.decision?.action ?? '--'}</strong>
                <small>{row.decision?.label ?? '待分层'}</small>
              </div>
              <div className="preview-share-fixture">
                <strong>#{row.matchNo} {row.fixture}</strong>
                <small>{row.pick} · {row.provider}</small>
              </div>
              <div className="preview-share-probs">
                <span>主 {auditPercent(row.probabilities?.home, 1)}</span>
                <span>平 {auditPercent(row.probabilities?.draw, 1)}</span>
                <span>客 {auditPercent(row.probabilities?.away, 1)}</span>
                <em>{uncertaintyMarginText(row.probabilityUncertainty)}</em>
              </div>
              <div className="preview-share-risk">
                <strong>{signed(row.valueScore, 3)}</strong>
                <small>信心 {auditPercent(row.confidence, 1)} · 冷门 {auditPercent(row.upsetRisk, 1)}</small>
              </div>
              <small className="preview-share-source">
                {compactSourceType(row.sourceType)} · {consensusMethodText(row.marketConsensus)} · {movementSummaryText(row.marketConsensus?.movement)} · 分歧 {auditPercent(row.marketConsensus?.maxProbabilityRange, 1)} · 快照 {auditMetric(row.marketQuality?.latestAgeHours, 1)}h · {formatAuditDateTime(row.capturedAt)}
              </small>
            </div>
          ))}
        </div>
      ) : (
        <p className="market-audit-empty">尚未形成可分享的赛前预判清单。</p>
      )}
      <div className="market-audit-note">
        <span>审计生成 {formatAuditDateTime(audit?.generatedAt)}</span>
        <span>只使用完整同源快照；阵容、伤停、天气和新闻未齐前不生成串关。</span>
      </div>
    </div>
  );
}

function MarketAuditPanel({ audit }) {
  const sources = audit?.sources ?? [];
  const importSummary = audit?.importSummary ?? {};
  const handicapRows = audit?.euroHandicapRecommendations?.rows ?? [];
  const recommendationDiff = audit?.recommendationDiff;
  const rowsImported = Number(importSummary.rowsImported ?? 0);
  const available = Number(importSummary.verifiedSnapshotsAvailable ?? 0);
  const statusClass = available > 0 || rowsImported > 0 ? 'ready' : audit ? 'blocked' : 'watch';

  return (
    <div className="market-audit-panel">
      <div className="market-audit-head">
        <div>
          <h2>盘口源抓取审计</h2>
          <p>{audit?.recommendationPolicy ?? '盘口源尚未运行审计；预测保持阻断。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{marketAuditStatusLabel(audit)}</span>
      </div>
      <div className="market-audit-kpis">
        <div>
          <span>审计源</span>
          <strong>{sources.length || '--'}</strong>
          <small>体彩/HKJC/澳门/欧洲</small>
        </div>
        <div>
          <span>完整候选</span>
          <strong>{auditNumber(importSummary.completeCandidates)}</strong>
          <small>胜平负+让球+大小球</small>
        </div>
        <div>
          <span>可用快照</span>
          <strong>{auditNumber(importSummary.verifiedSnapshotsAvailable)}</strong>
          <small>本地 odds_snapshots</small>
        </div>
        <div>
          <span>本轮新增</span>
          <strong>{auditNumber(importSummary.rowsImported)}</strong>
          <small>重复不再写入</small>
        </div>
      </div>
      {importSummary.staleDatabaseMismatch ? (
        <p className="market-audit-empty">
          审计文件记录 {auditNumber(importSummary.auditVerifiedSnapshotsAvailable)} 条，但当前数据库只有 {auditNumber(importSummary.databaseSnapshotsAvailable)} 条；请重新抓取盘口审计。
        </p>
      ) : null}
      {sources.length ? (
        <div className="market-source-grid">
          <div className="audit-source-row audit-source-head">
            <span>源</span>
            <span>状态</span>
            <span>行数</span>
            <span>候选</span>
            <span>完整</span>
            <span>入口</span>
          </div>
          {sources.map((source) => {
            const sourceType = source.sourceType ?? source.source_type ?? 'market';
            return (
              <div className="audit-source-row" key={`${source.provider}-${sourceType}`}>
                <div className="audit-source-name">
                  <strong>{source.provider}</strong>
                  <small>{sourceType}</small>
                </div>
                <span className={`source-status ${sourceStatusClass(source.status)}`}>{sourceStatusLabel(source.status)}</span>
                <span>{auditNumber(source.rowsSeen)}</span>
                <span>{auditNumber(source.candidateRows)}</span>
                <span>{auditNumber(source.completeCandidates)}</span>
                <small>{source.publicPage || source.url}</small>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="market-audit-empty">盘口源尚未审计。</p>
      )}
      {handicapRows.length ? (
        <div className="preview-share-list" aria-label="欧赔让球候选">
          <div className="preview-share-row preview-share-head">
            <span>分层</span>
            <span>比赛</span>
            <span>受让球</span>
            <span>欧赔边际</span>
            <span>模型</span>
          </div>
          {handicapRows.slice(0, 8).map((row) => (
            <div className={`preview-share-row tier-${row.tier ?? 'watch'}`} key={`${row.matchNo}-${row.handicapPick?.label}`}>
              <div className="preview-share-decision">
                <strong>{recommendationTierLabel(row.tier)}</strong>
                <small>{row.matchNum ?? '--'}</small>
              </div>
              <div className="preview-share-fixture">
                <strong>#{row.matchNo} {row.fixture}</strong>
                <small>{row.receivingSide}</small>
              </div>
              <div className="preview-share-probs">
                <span>{row.handicapPick?.text ?? row.bestHandicapPick?.label ?? '--'}</span>
                <span>概率 {auditPercent(row.handicapPick?.modelProbability, 1)}</span>
                <em>赔率 {auditMetric(row.handicapPick?.odds, 2)}</em>
              </div>
              <div className="preview-share-risk">
                <strong>{edgeText(row.handicapPick?.edge)}</strong>
                <small>胜平负 {row.moneylinePick?.label ?? '--'} · {edgeText(row.moneylinePick?.edge)}</small>
              </div>
              <small className="preview-share-source">
                信心 {auditPercent(row.model?.confidence, 1)} · 冷门 {auditPercent(row.model?.upsetRisk, 1)} · HHAD {formatAuditDateTime(row.source?.hhadCapturedAt)}
              </small>
            </div>
          ))}
        </div>
      ) : null}
      {recommendationDiff ? (
        <div className="preview-share-list" aria-label="推荐变化">
          <div className="preview-share-row preview-share-head">
            <span>变化</span>
            <span>比赛</span>
            <span>当前推荐</span>
            <span>差异</span>
            <span>对比</span>
          </div>
          {[...(recommendationDiff.added ?? []).slice(0, 4)].map((row) => (
            <div className="preview-share-row tier-candidate" key={`added-${row.matchNo}-${row.handicapPick?.key}`}>
              <div className="preview-share-decision">
                <strong>新增</strong>
                <small>{recommendationTierLabel(row.tier)}</small>
              </div>
              <div className="preview-share-fixture">
                <strong>#{row.matchNo} {row.fixture}</strong>
                <small>{row.receivingSide}</small>
              </div>
              <div className="preview-share-probs">
                <span>{row.handicapPick?.text ?? row.handicapPick?.label ?? '--'}</span>
                <span>概率 {auditPercent(row.handicapPick?.modelProbability, 1)}</span>
                <em>赔率 {auditMetric(row.handicapPick?.odds, 2)}</em>
              </div>
              <div className="preview-share-risk">
                <strong>{edgeText(row.handicapPick?.edge)}</strong>
                <small>新进入推荐清单</small>
              </div>
              <small className="preview-share-source">上次 {formatAuditDateTime(recommendationDiff.comparedWithGeneratedAt)}</small>
            </div>
          ))}
          {[...(recommendationDiff.changed ?? []).slice(0, 6)].map((row) => (
            <div className="preview-share-row tier-watch" key={`changed-${row.key}`}>
              <div className="preview-share-decision">
                <strong>变化</strong>
                <small>{recommendationTierLabel(row.after?.tier)}</small>
              </div>
              <div className="preview-share-fixture">
                <strong>#{row.matchNo} {row.fixture}</strong>
                <small>{row.after?.receivingSide}</small>
              </div>
              <div className="preview-share-probs">
                <span>{row.after?.handicapPick?.text ?? row.after?.handicapPick?.label ?? '--'}</span>
                <span>概率 {auditPercent(row.after?.handicapPick?.modelProbability, 1)}</span>
                <em>赔率 {auditMetric(row.after?.handicapPick?.odds, 2)}</em>
              </div>
              <div className="preview-share-risk">
                <strong>{edgeText(row.after?.handicapPick?.edge)}</strong>
                <small>{row.changes?.slice(0, 2).map(recommendationDiffText).join('；') || '字段变化'}</small>
              </div>
              <small className="preview-share-source">上次 {formatAuditDateTime(recommendationDiff.comparedWithGeneratedAt)}</small>
            </div>
          ))}
          {[...(recommendationDiff.removed ?? []).slice(0, 4)].map((row) => (
            <div className="preview-share-row tier-negative" key={`removed-${row.matchNo}-${row.handicapPick?.key}`}>
              <div className="preview-share-decision">
                <strong>移除</strong>
                <small>{recommendationTierLabel(row.tier)}</small>
              </div>
              <div className="preview-share-fixture">
                <strong>#{row.matchNo} {row.fixture}</strong>
                <small>{row.receivingSide}</small>
              </div>
              <div className="preview-share-probs">
                <span>{row.handicapPick?.text ?? row.handicapPick?.label ?? '--'}</span>
                <span>概率 {auditPercent(row.handicapPick?.modelProbability, 1)}</span>
                <em>赔率 {auditMetric(row.handicapPick?.odds, 2)}</em>
              </div>
              <div className="preview-share-risk">
                <strong>{edgeText(row.handicapPick?.edge)}</strong>
                <small>本次不在推荐清单</small>
              </div>
              <small className="preview-share-source">上次 {formatAuditDateTime(recommendationDiff.comparedWithGeneratedAt)}</small>
            </div>
          ))}
          {recommendationDiff.summary && (
            <div className="market-audit-note">
              <span>
                推荐变化：新增 {auditNumber(recommendationDiff.summary.added)}，移除 {auditNumber(recommendationDiff.summary.removed)}，变化 {auditNumber(recommendationDiff.summary.changed)}，不变 {auditNumber(recommendationDiff.summary.unchanged)}
              </span>
              <span>本次 {formatAuditDateTime(recommendationDiff.currentGeneratedAt)}</span>
            </div>
          )}
        </div>
      ) : null}
      <div className="market-audit-note">
        <span>{audit?.sourcePolicy ?? '只接受完整同源快照入库。'}</span>
        {audit?.file && <span>{audit.file}</span>}
      </div>
    </div>
  );
}

function EvidenceManifestPanel({ audit }) {
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';
  const counts = audit?.database?.counts ?? {};
  const guardrails = audit?.guardrails ?? {};
  const guardrailKeys = evidenceGuardrailOrder.filter((key) => key in guardrails);
  const coreFiles = audit?.files?.core ?? [];
  const featuredFiles = coreFiles.filter((file) => evidenceFeaturedFiles.has(file.path));
  const visibleFiles = (featuredFiles.length ? featuredFiles : coreFiles).slice(0, 8);
  const footballData = audit?.files?.footballData ?? {};

  return (
    <div className="evidence-manifest-panel">
      <div className="market-audit-head">
        <div>
          <h2>证据追溯清单</h2>
          <p>{audit?.method ?? '等待生成本地数据、报告和 SQLite 状态的 SHA-256 指纹清单。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{evidenceStatusLabel(audit)}</span>
      </div>
      <div className="manifest-kpis">
        <div>
          <span>核心证据</span>
          <strong>{auditNumber(coreFiles.length)}</strong>
          <small>{audit?.file ?? 'reports/evidence-manifest.json'}</small>
        </div>
        <div>
          <span>五大联赛 CSV</span>
          <strong>{auditNumber(footballData.count)}</strong>
          <small>{auditNumber(footballData.rows)} 行 · {shortSha(footballData.aggregateSha256)}</small>
        </div>
        <div>
          <span>SQLite 当前态</span>
          <strong>{auditNumber(counts.matches)} / {auditNumber(counts.odds_snapshots)}</strong>
          <small>比赛 / 盘口快照</small>
        </div>
        <div>
          <span>预判守门</span>
          <strong>{auditNumber(counts.predictions)} / {auditNumber(counts.results)}</strong>
          <small>预判 / 已填赛果</small>
        </div>
      </div>
      {guardrailKeys.length ? (
        <div className="manifest-guardrails">
          {guardrailKeys.map((key) => (
            <span className={guardrails[key] ? 'ready' : 'blocked'} key={key}>
              {guardrails[key] ? '通过' : '失败'} · {evidenceGuardrailLabels[key] ?? key}
            </span>
          ))}
        </div>
      ) : (
        <p className="market-audit-empty">尚未生成证据守门项。</p>
      )}
      {visibleFiles.length ? (
        <div className="manifest-file-list">
          <div className="manifest-file-row manifest-file-head">
            <span>证据</span>
            <span>大小</span>
            <span>SHA-256</span>
          </div>
          {visibleFiles.map((file) => (
            <div className="manifest-file-row" key={file.path}>
              <div>
                <strong>{evidenceFileLabel(file.path)}</strong>
                <small>{file.path}</small>
              </div>
              <span>{formatBytes(file.bytes)}</span>
              <code title={file.sha256}>{shortSha(file.sha256)}</code>
            </div>
          ))}
        </div>
      ) : null}
      <div className="market-audit-note">
        <span>生成 {formatAuditDateTime(audit?.generatedAt)}</span>
        <span>{audit?.markdown ?? 'reports/evidence-manifest.md'}</span>
      </div>
    </div>
  );
}

function FriendlyPredictionLedgerPanel({ audit }) {
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';
  const summary = audit?.summary ?? {};
  const latest = summary.latest24 ?? {};
  const related = summary.worldCupRelated ?? {};
  const fullWindow = summary.fullWindow ?? {};
  const gate = summary.promotionGate ?? {};
  const guardrails = audit?.guardrails ?? {};
  const rows = (audit?.matches ?? [])
    .filter((row) => row.worldCupRelevance?.involved)
    .slice(0, 6);
  const fallbackRows = rows.length ? rows : (audit?.matches ?? []).slice(0, 6);
  const gateLabel = gate.decision === 'hold' ? '保持阻断' : gate.promoteFriendlySignal ? '可复核' : '待复核';

  return (
    <div className="friendly-ledger-panel">
      <div className="market-audit-head">
        <div>
          <h2>友谊赛赛前核对</h2>
          <p>{audit?.method ?? '等待生成友谊赛赛前预测和赛果核对账本。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{audit?.ok ? '已记录' : audit ? '需复核' : '未生成'}</span>
      </div>
      <div className="decision-kpis">
        <div>
          <span>最新 24 场</span>
          <strong>{auditNumber(latest.hits)} / {auditNumber(latest.matches)}</strong>
          <small>{auditPercent(latest.accuracy, 1)} · LL {latest.logLoss ?? '--'}</small>
        </div>
        <div>
          <span>世界杯相关</span>
          <strong>{auditNumber(related.hits)} / {auditNumber(related.matches)}</strong>
          <small>{auditPercent(related.accuracy, 1)} · 任一队进官方赛程</small>
        </div>
        <div>
          <span>全窗口校验</span>
          <strong>{auditPercent(fullWindow.accuracy, 1)}</strong>
          <small>{auditNumber(fullWindow.matches)} 场 · ECE {auditPercent(fullWindow.calibrationError, 1)}</small>
        </div>
        <div>
          <span>信号晋级</span>
          <strong>{gateLabel}</strong>
          <small>{gate.blockedReasons?.join(' / ') || '等待门槛'}</small>
        </div>
      </div>
      <div className="decision-guardrails">
        <span>{guardrails.latest24RowsRecorded ? '逐场记录完整' : '逐场记录待补'}</span>
        <span>{guardrails.latestAccuracyRecomputed ? '命中率可复算' : '命中率待复核'}</span>
        <span>{guardrails.worldCupRelatedRowsPresent ? '世界杯相关样本已标注' : '相关样本不足'}</span>
        <span>{guardrails.fullWindowGuardrailApplied ? '全窗口守门已启用' : '全窗口守门待启用'}</span>
        <span>{guardrails.incompleteWorldCupRowsQuarantined ? '世界杯未来赛果隔离' : '未来赛果隔离待查'}</span>
        <span>{guardrails.friendlySignalNotPromoted ? '短窗信号未晋级' : '短窗信号需复核'}</span>
      </div>
      {fallbackRows.length ? (
        <div className="friendly-ledger-list">
          {fallbackRows.map((row) => (
            <div className="friendly-ledger-row" key={`${row.date}-${row.fixture}`}>
              <span>{row.date}</span>
              <strong>{friendlyFixtureZh(row)}</strong>
              <em>{friendlyOutcomeZh(row.pickLabel)} → {friendlyOutcomeZh(row.actualLabel)} · {row.correct ? '命中' : '未中'}</em>
              <small>
                {row.score} · 信心 {auditPercent(row.confidence, 1)} · 赛果概率 {auditPercent(row.actualProbability, 1)}
              </small>
              <i>{row.worldCupRelevance?.involvedCodes?.length ? row.worldCupRelevance.involvedCodes.map(friendlyCodeZh).join(' / ') : '非官方赛程队'}</i>
            </div>
          ))}
        </div>
      ) : (
        <p className="market-audit-empty">尚未生成友谊赛逐场核对。</p>
      )}
      <div className="market-audit-note">
        <span>{audit?.file ?? 'reports/friendly-prediction-ledger.json'}</span>
        <span>{audit?.markdown ?? 'reports/friendly-prediction-ledger.md'}</span>
      </div>
    </div>
  );
}

function PreviewDecisionAuditPanel({ audit }) {
  const tierCounts = audit?.tierCounts ?? {};
  const rows = audit?.rows ?? [];
  const guardrails = audit?.guardrails ?? {};
  const sampleRows = rows.slice(0, 5);
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';

  return (
    <div className="preview-audit-panel">
      <div className="market-audit-head">
        <div>
          <h2>预判决策审计</h2>
          <p>验证概率、provider 优先级、价值阈值和串关阻断；输出的是预判分层，不是投注指令。</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{audit?.ok ? '守门通过' : audit ? '需复核' : '未生成'}</span>
      </div>
      <div className="decision-kpis">
        <div>
          <span>预判场次</span>
          <strong>{auditNumber(audit?.predictionCount)}</strong>
          <small>绑定完整盘口</small>
        </div>
        <div>
          <span>正价值候选</span>
          <strong>{auditNumber(tierCounts.candidate)}</strong>
          <small>高阈值才进入</small>
        </div>
        <div>
          <span>观察</span>
          <strong>{auditNumber(tierCounts.watch)}</strong>
          <small>小样本低仓位</small>
        </div>
        <div>
          <span>不追</span>
          <strong>{auditNumber(tierCounts.negative)}</strong>
          <small>负价值过滤</small>
        </div>
      </div>
      <div className="decision-guardrails">
        <span>{guardrails.verifiedOddsOnly ? '已限制完整公开盘口' : '盘口源待复核'}</span>
        <span>{guardrails.providerPriorityApplied ? 'Pinnacle 优先级已校验' : 'provider 优先级待校验'}</span>
        <span>{guardrails.providerConsensusMeasured ? 'provider 共识已记录' : 'provider 共识待生成'}</span>
        <span>{guardrails.historicalProviderWeightsMeasured ? '历史 provider 权重已记录' : '历史 provider 权重待记录'}</span>
        <span>{guardrails.marketMovementMeasured ? '盘口移动已记录' : '盘口移动待记录'}</span>
        <span>{guardrails.marketQualityApplied ? '快照新鲜度已守门' : '快照新鲜度待守门'}</span>
        <span>{guardrails.probabilityUncertaintyMeasured ? '概率区间已校验' : '概率区间待校验'}</span>
        <span>{guardrails.noStandaloneBettingAdvice ? '保留非投注建议守门' : '建议文案待复核'}</span>
        <span>{guardrails.parlaysBlockedUntilFullInputs ? '串关继续阻断' : '串关状态待复核'}</span>
      </div>
      {sampleRows.length ? (
        <div className="decision-row-list">
          {sampleRows.map((row) => (
            <div className="decision-row" key={row.matchNo}>
              <span>#{row.matchNo}</span>
              <strong>{row.fixture}</strong>
              <em>{row.decision?.action ?? '--'} · {row.pick}</em>
              <small>{signed(row.valueScore, 3)} · {uncertaintyMarginText(row.probabilityUncertainty)} · {row.provider}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="market-audit-empty">尚未生成预判决策审计。</p>
      )}
      <div className="market-audit-note">
        <span>{audit?.file ?? 'reports/preview-decision-audit.json'}</span>
      </div>
    </div>
  );
}

function ModelChangeImpactPanel({ audit }) {
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';
  const summaries = audit?.summaries ?? {};
  const current = summaries.current ?? {};
  const baseline = summaries.equal_no_movement ?? {};
  const comparisons = audit?.comparisons ?? [];
  const guardrails = audit?.guardrails ?? {};

  return (
    <div className="model-impact-panel">
      <div className="market-audit-head">
        <div>
          <h2>模型变更影响审计</h2>
          <p>{audit?.purpose ?? '等待生成机构权重和盘口移动的消融对照。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>{audit?.ok ? '影响可控' : audit ? '需复核' : '未生成'}</span>
      </div>
      <div className="decision-kpis">
        <div>
          <span>当前候选 / 观察</span>
          <strong>{auditNumber(current.candidateCount)} / {auditNumber(current.watchCount)}</strong>
          <small>历史权重 + 盘口移动</small>
        </div>
        <div>
          <span>基线候选 / 观察</span>
          <strong>{auditNumber(baseline.candidateCount)} / {auditNumber(baseline.watchCount)}</strong>
          <small>等权机构 + 无移动</small>
        </div>
        <div>
          <span>移动覆盖</span>
          <strong>{auditNumber(current.movementRows)}</strong>
          <small>至少 2 家机构</small>
        </div>
        <div>
          <span>历史权重覆盖</span>
          <strong>{auditNumber(current.matchedProviderRows)}</strong>
          <small>有历史机构证据</small>
        </div>
      </div>
      <div className="decision-guardrails">
        <span>{guardrails.noPickChanges ? '选项未改变' : '选项有变化'}</span>
        <span>{guardrails.noTierChanges ? '分层未改变' : '分层有变化'}</span>
        <span>{guardrails.candidateCountStable ? '候选数稳定' : '候选数变化'}</span>
        <span>{guardrails.watchCountStable ? '观察数稳定' : '观察数变化'}</span>
        <span>{guardrails.confidenceDeltaBounded ? '信心变化受限' : '信心变化过大'}</span>
        <span>{guardrails.upsetRiskDeltaBounded ? '风险变化受限' : '风险变化过大'}</span>
      </div>
      {comparisons.length ? (
        <div className="impact-row-list">
          {comparisons.map((row) => (
            <div className="impact-row" key={row.variant}>
              <strong>{row.variant}</strong>
              <span>选项 {auditNumber(row.pickChanges)} · 分层 {auditNumber(row.tierChanges)}</span>
              <em>信心 Δ {auditPercent(row.maxConfidenceDelta, 2)}</em>
              <small>风险 Δ {auditPercent(row.maxUpsetRiskDelta, 2)} · 概率 Δ {auditPercent(row.maxProbabilityDelta, 2)}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="market-audit-empty">尚未生成变更影响对照。</p>
      )}
      <div className="market-audit-note">
        <span>{audit?.file ?? 'reports/model-change-impact-audit.json'}</span>
      </div>
    </div>
  );
}

function PromotionGatePanel({ audit }) {
  const historical = audit?.evidence?.historical ?? {};
  const international = audit?.evidence?.international ?? {};
  const preview = audit?.evidence?.preview ?? {};
  const checks = audit?.checks ?? [];
  const thresholdRows = historical.valueSensitivity ?? [];
  const calibration = historical.calibration ?? {};
  const statusClass = audit?.ok ? 'ready' : audit ? 'blocked' : 'watch';

  return (
    <div className="promotion-gate-panel">
      <div className="market-audit-head">
        <div>
          <h2>历史门槛审计</h2>
          <p>{audit?.conclusion ?? '等待历史走步和预判决策审计后生成晋级结论。'}</p>
        </div>
        <span className={`market-audit-status ${statusClass}`}>
          {audit?.status === 'preview_only_no_promotion' ? '只允许预判' : audit?.ok ? '可晋级' : audit ? '需复核' : '未生成'}
        </span>
      </div>
      <div className="decision-kpis">
        <div>
          <span>市场 LL</span>
          <strong>{auditMetric(historical.marketLogLoss)}</strong>
          <small>五大联赛走步</small>
        </div>
        <div>
          <span>混合 LL</span>
          <strong>{auditMetric(historical.blendedLogLoss)}</strong>
          <small>越低越好</small>
        </div>
        <div>
          <span>价值 ROI</span>
          <strong>{auditPercent(historical.valueResearchRoi)}</strong>
          <small>纸面验证</small>
        </div>
        <div>
          <span>自适应提升</span>
          <strong>{auditPercent(historical.adaptiveLift)}</strong>
          <small>相对市场择边</small>
        </div>
      </div>
      <div className="calibration-gate-strip">
        <div>
          <span>市场 ECE</span>
          <strong>{auditPercent(calibration.marketEce)}</strong>
          <small>五大联赛盘口基准</small>
        </div>
        <div>
          <span>混合 ECE</span>
          <strong>{auditPercent(calibration.blendedEce)}</strong>
          <small>模型+市场</small>
        </div>
        <div>
          <span>国际赛 ECE</span>
          <strong>{auditPercent(international.calibrationError)}</strong>
          <small>国家队主模型</small>
        </div>
        <div>
          <span>友谊赛短窗 ECE</span>
          <strong>{auditPercent(international.friendlyLatest24CalibrationError)}</strong>
          <small>短窗高误差继续阻断</small>
        </div>
      </div>
      <div className="decision-guardrails">
        {checks.map((item) => (
          <span key={item.key}>{item.passed ? '通过' : '失败'} · {item.key}</span>
        ))}
      </div>
      {thresholdRows.length ? (
        <div className="threshold-row-list">
          {thresholdRows.map((row) => (
            <div className="threshold-row" key={row.key}>
              <strong>{row.label}</strong>
              <span>{auditNumber(row.candidates)} 场</span>
              <em>{auditPercent(row.paperRoi)}</em>
              <small>{auditNumber(row.positiveSeasons)} / 5 季为正</small>
            </div>
          ))}
        </div>
      ) : null}
      <div className="market-audit-note">
        <span>当前预判 {auditNumber(preview.predictionCount)} 场；候选 {auditNumber(preview.tierCounts?.candidate)}，观察 {auditNumber(preview.tierCounts?.watch)}，不追 {auditNumber(preview.tierCounts?.negative)}</span>
        <span>{audit?.file ?? 'reports/promotion-gate-audit.json'}</span>
      </div>
    </div>
  );
}

export function DataView({ summary, onRefresh, onSeed, onOfficialSeed, onOddsRefresh, refreshing }) {
  const dataQuality = summary?.dataQuality;
  const sourceNotes = normalizeSourceNotes(dataQuality?.sources);
  const officialSchedule = dataQuality?.officialSchedule;
  const marketAudit = dataQuality?.marketAudit;
  const friendlyLedger = dataQuality?.friendlyLedger;
  const previewAudit = dataQuality?.previewAudit;
  const modelChangeImpact = dataQuality?.modelChangeImpact;
  const promotionGate = dataQuality?.promotionGate;
  const evidenceManifest = dataQuality?.evidenceManifest;
  const marketSnapshotsAvailable = Number(marketAudit?.importSummary?.verifiedSnapshotsAvailable ?? 0) > 0;
  return (
    <section className="workspace-panel">
      <PanelHeader
        icon={DatabaseZap}
        title="数据更新策略"
        subtitle={
          dataQuality?.mode === 'sample_sandbox_loop'
            ? '当前为第一阶段样例闭环：104 场预测、盘口、赛果、复盘校准和串关组合均可本地演示。'
            : 
          marketSnapshotsAvailable
            ? '当前以 FIFA 官方赛程和完整盘口快照为准；只生成预判，阵容、伤停、天气和新闻未齐前不做串关。'
            : '当前以 FIFA 官方赛程审计为准；预测、赔率和赛果写入在可靠输入接入前保持阻断。'
        }
      />
      <div className="source-audit">
        <div>
          <AlertTriangle size={18} />
          <strong>{dataQuality?.label ?? '数据来源未标注'}</strong>
          <span>{dataQuality?.confidence ?? '等待数据源审计'}</span>
        </div>
        <p>{dataQuality?.warning}</p>
      </div>
      {officialSchedule && (
        <div className="official-schedule-strip">
          <div>
            <span>FIFA 官方赛程</span>
            <strong>{officialSchedule.matchCount} 场</strong>
            <small>{dateSpanText(officialSchedule.dateSpanEt)} · {officialSchedule.venueCount ?? '--'} 个场馆</small>
          </div>
          <div>
            <span>结构化文件</span>
            <strong>{officialSchedule.file}</strong>
            <small>{officialSchedule.parser}</small>
          </div>
          {officialSchedule.sampleFixtures?.slice(0, 3).map((fixture) => (
            <div key={fixture.matchNo}>
              <span>M{fixture.matchNo}</span>
              <strong>{officialFixtureText(fixture)}</strong>
              <small>{fixture.dateEt} {fixture.kickoffEt} ET · {fixture.venue}</small>
            </div>
          ))}
        </div>
      )}
      <EvidenceManifestPanel audit={evidenceManifest} />
      <MarketAuditPanel audit={marketAudit} />
      <FriendlyPredictionLedgerPanel audit={friendlyLedger} />
      <MarketPreviewSharePanel audit={previewAudit} marketAudit={marketAudit} promotionGate={promotionGate} />
      <PreviewDecisionAuditPanel audit={previewAudit} />
      <ModelChangeImpactPanel audit={modelChangeImpact} />
      <PromotionGatePanel audit={promotionGate} />
      <div className="data-actions">
        <button type="button" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw size={16} />
          <span>刷新审计数据</span>
        </button>
        <button type="button" onClick={onOddsRefresh} disabled={refreshing}>
          <ServerCog size={16} />
          <span>抓取盘口审计</span>
        </button>
        <button type="button" onClick={onSeed} disabled={refreshing}>
          <DatabaseZap size={16} />
          <span>重建样例闭环库</span>
        </button>
        <button type="button" onClick={onOfficialSeed} disabled={refreshing}>
          <ShieldCheck size={16} />
          <span>重建官方安全库</span>
        </button>
      </div>
      <div className="data-grid">
        <article>
          <strong>{summary?.counts?.matches ?? 0}</strong>
          <span>比赛槽位</span>
        </article>
        <article>
          <strong>{summary?.counts?.groupMatches ?? 0}</strong>
          <span>小组赛</span>
        </article>
        <article>
          <strong>{summary?.counts?.knockoutMatches ?? 0}</strong>
          <span>淘汰赛</span>
        </article>
        <article>
          <strong>{summary?.counts?.predictedMatches ?? 0}</strong>
          <span>预测输出</span>
        </article>
        <article>
          <strong>{summary?.counts?.results ?? 0}</strong>
          <span>赛果记录</span>
        </article>
        <article>
          <strong>{summary?.latestRun?.run_type ?? '--'}</strong>
          <span>最近任务</span>
        </article>
      </div>
      <div className="roadmap-strip">
        {sourceNotes.map((note) => (
          <span key={note}>{note}</span>
        ))}
        <span>免费公开数据源适配器</span>
        <span>API key 适配器</span>
        <span>CSV/JSON 导入</span>
        <span>半小时自动更新</span>
        <span>临场高频更新</span>
      </div>
    </section>
  );
}
