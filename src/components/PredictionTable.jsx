import { Fragment, useState } from 'react';
import { AlertTriangle, ArrowDownUp, ChevronRight, Flame, ShieldAlert, Star, TrendingUp } from 'lucide-react';
import { formatDateTime, percent, probabilityColor, riskClass, signed, stageName } from '../lib/format.js';
import { alternativeMarketReadingOutput, buildMarketOutputs } from '../lib/marketOutputs.js';

const columns = [
  ['time', '本地时间'],
  ['fixture', '比赛'],
  ['prob', '胜平负'],
  ['goals', '进球数'],
  ['score', '比分'],
  ['market', '盘口输出'],
  ['confidence', '信心'],
  ['risk', '风险'],
  ['value', '价值']
];

function ProbabilityCell({ label, value, picked = false }) {
  return (
    <div className={`prob-chip ${probabilityColor(value)} ${picked ? 'picked' : ''}`}>
      <span>{label}</span>
      <strong>{percent(value, 0)}</strong>
    </div>
  );
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fixed(value, digits = 2) {
  return isFiniteNumber(value) ? value.toFixed(digits) : '--';
}

function decisionText(match) {
  if (!(match.hasPrediction ?? match.recommendedPick != null)) return match.recommendedPick ?? '待接入';
  const action = match.previewDecision?.action ?? '观察';
  return `${action} · ${match.recommendedPick ?? '待接入'}`;
}

function AuxiliaryBadge({ signal }) {
  if (!signal || signal.status === 'reference_only') return null;
  const icon = signal.status === 'aligned' ? <TrendingUp size={12} /> : <ShieldAlert size={12} />;
  return (
    <span className={`auxiliary-badge auxiliary-${signal.status}`} title={signal.note}>
      {icon}
      <span>{signal.label}</span>
    </span>
  );
}

function SortButton({ column, sort, onSort }) {
  const active = sort.key === column[0];
  return (
    <button type="button" className={`sort-button ${active ? 'active' : ''}`} onClick={() => onSort(column[0])}>
      <span>{column[1]}</span>
      <ArrowDownUp size={12} />
    </button>
  );
}

function statusText(status, hasPrediction) {
  if (status === 'finished') return hasPrediction ? '已完赛 · 赛前预判可复盘' : '已完赛 · 官方赛果';
  if (status === 'result_pending') return hasPrediction ? '已开赛 · 赛前预判待复盘' : '已开赛 · 待赛果同步';
  if (hasPrediction) return 'FIFA 官方赛程 · 盘口预判 · 阵容待复核';
  if (status === 'official_schedule_prediction_blocked') return 'FIFA 官方赛程 · 等待赛前盘口';
  if (status === 'sample_placeholder') return '非官方占位';
  if (status === 'fixture_placeholder') return '赛程占位';
  return '赛程待核验';
}

function marketAuditText(audit) {
  const available = Number(audit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const rows = Number(audit?.importSummary?.rowsImported ?? 0);
  const complete = Number(audit?.importSummary?.completeCandidates ?? 0);
  const sourceCount = audit?.sources?.length ?? 0;
  if (available > 0) return `${available} 条完整盘口可用`;
  if (rows > 0) return `${rows} 条完整盘口已入库`;
  if (complete > 0) return `${complete} 条完整候选待入库`;
  if (sourceCount > 0) return `${sourceCount} 个盘口源已审计`;
  return '盘口源待审计';
}

function marketAuditShort(audit) {
  const available = Number(audit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const rows = Number(audit?.importSummary?.rowsImported ?? 0);
  const sourceCount = audit?.sources?.length ?? 0;
  if (available > 0) return '阵容待复核';
  if (rows > 0) return '等待阵容复核';
  if (sourceCount > 0) return '不输出推荐';
  return '无标签';
}

function consensusText(consensus) {
  if (!consensus?.providerCount) return null;
  const label = consensus.method === 'historical_provider_weighted' ? '加权共识' : '共识';
  const matched = isFiniteNumber(consensus.matchedProviderCount)
    ? ` · 历史 ${consensus.matchedProviderCount}/${consensus.providerCount}`
    : '';
  return `${label} ${consensus.providerCount} 家${matched} · 分歧 ${percent(consensus.maxProbabilityRange, 1)}`;
}

function marketQualityText(quality) {
  if (!quality?.supplied || !isFiniteNumber(quality.latestAgeHours)) return null;
  return `快照 ${quality.latestAgeHours.toFixed(1)}h`;
}

function movementText(movement) {
  if (!movement?.supplied) return null;
  const label = movement.favoriteDirection === 'strengthened' ? '顺向' : movement.favoriteDirection === 'weakened' ? '逆向' : '横盘';
  return `移动 ${label} ${percent(movement.favoriteDelta, 1)} · ${movement.providerCount} 家`;
}

function uncertaintyText(uncertainty) {
  if (!isFiniteNumber(uncertainty?.margin)) return null;
  return `概率区间 ±${percent(uncertainty.margin, 1)}`;
}

function outputCandidateLabels(output, limit = 3) {
  const labels = (output?.candidates ?? [])
    .map((candidate) => candidate?.label)
    .filter(Boolean)
    .slice(0, limit);
  return labels.length ? labels.join(' / ') : output?.label ?? '--';
}

function AlternativeMarketPanel({ alternative }) {
  return (
    <div className="table-alternative-panel">
      <div className="table-alternative-summary">
        <span>盘口推演结果</span>
        <strong>{alternative.summary}</strong>
      </div>
      <div className="table-alternative-grid">
        <div>
          <span>让球盘</span>
          <strong>{alternative.handicap.label}</strong>
          {alternative.handicap.reasons.slice(0, 3).map((reason) => (
            <small key={reason}>{reason}</small>
          ))}
        </div>
        <div>
          <span>大小球</span>
          <strong>{alternative.total.label}</strong>
          {alternative.total.reasons.slice(0, 3).map((reason) => (
            <small key={reason}>{reason}</small>
          ))}
        </div>
        <div>
          <span>合成比分</span>
          <strong>{alternative.score.label}</strong>
          <small>{alternative.score.detail}</small>
          <small>{outputCandidateLabels(alternative.score)}</small>
        </div>
      </div>
    </div>
  );
}

export function PredictionTable({ matches, selectedId, onSelect, sort, onSort, marketAudit, dataQuality }) {
  const [expandedAlternativeId, setExpandedAlternativeId] = useState(null);
  const marketReady = Number(marketAudit?.importSummary?.verifiedSnapshotsAvailable ?? 0) > 0;
  const sampleMode = dataQuality?.mode === 'sample_sandbox_loop';
  return (
    <section className="table-panel">
      <div className="table-header">
        <div>
          <h1>{sampleMode ? '2026 样例闭环预测' : '2026 官方赛程审计'}</h1>
          <p>
            {sampleMode
              ? `104 场样例赛制；${marketAuditText(marketAudit)}；用于验证预测、盘口、串关、赛果和校准闭环，不代表真实赛事。`
              : `104 场来自 FIFA 官方赛程；${marketAuditText(marketAudit)}；${
                  marketReady ? '有快照的场次显示预判，阵容和新闻未齐前不做串关。' : '阵容和新闻未齐前不生成概率、盘口或串关。'
                }`}
          </p>
        </div>
        <div className="table-count">
          <strong>{matches.length}</strong>
          <span>当前结果</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="prediction-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column[0]}>
                  <SortButton column={column} sort={sort} onSort={onSort} />
                </th>
              ))}
              <th aria-label="打开单场" />
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => {
              const hasPrediction = match.hasPrediction ?? match.recommendedPick != null;
              const confidence = isFiniteNumber(match.displayConfidence) ? match.displayConfidence : isFiniteNumber(match.confidence) ? match.confidence : 0;
              const asianLine = match.odds?.asianLine;
              const asianPrefix = isFiniteNumber(asianLine) && asianLine > 0 ? '+' : '';
              const outputs = buildMarketOutputs(match, marketAudit);
              const moneylinePick = outputs.moneyline?.label;
              const alternative = alternativeMarketReadingOutput(match);
              const alternativeExpanded = expandedAlternativeId === match.id;
              return (
                <Fragment key={match.id}>
                  <tr
                    className={selectedId === match.id ? 'selected' : ''}
                    onClick={() => onSelect(match.id)}
                    tabIndex={0}
                    aria-label={`查看${match.homeTeam}对${match.awayTeam}`}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSelect(match.id);
                    }}
                  >
                    <td>
                      <div className="time-cell">
                        <strong>{formatDateTime(match.kickoffUtc)}</strong>
                        <span>#{match.matchNo} {stageName(match.stage)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="fixture-cell">
                        <span className="round-label">{match.roundLabel}</span>
                        <strong>
                          {match.homeTeam} <em>vs</em> {match.awayTeam}
                        </strong>
                        <small>{match.venue}</small>
                        <small className="fixture-source-note">
                          <AlertTriangle size={12} />
                          {statusText(match.status, hasPrediction)}
                        </small>
                      </div>
                    </td>
                    <td>
                      {hasPrediction ? (
                        <div className="prob-grid-wrap">
                          <div className="prob-grid">
                            <ProbabilityCell label="主" value={match.probabilities?.home} picked={moneylinePick === '主胜'} />
                            <ProbabilityCell label="平" value={match.probabilities?.draw} picked={moneylinePick === '平局'} />
                            <ProbabilityCell label="客" value={match.probabilities?.away} picked={moneylinePick === '客胜'} />
                          </div>
                          {uncertaintyText(match.probabilityUncertainty) && (
                            <small className="prob-uncertainty">{uncertaintyText(match.probabilityUncertainty)}</small>
                          )}
                          <small className="prob-uncertainty">
                            输出 {outputs.moneyline.label} · {outputs.moneyline.metric}
                          </small>
                        </div>
                      ) : (
                        <div className="pending-cell">
                          <strong>待盘口预测</strong>
                          <span>无完整赛前盘口</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="goals-cell">
                        {hasPrediction ? (
                          <>
                            <strong>{outputCandidateLabels(outputs.goalCount, 2)}</strong>
                            <span>{outputs.goalCount.candidateText}</span>
                            <span>{outputs.total.detail} · {outputs.total.metric}</span>
                            <small>期望 {fixed(match.expectedGoals?.home)} : {fixed(match.expectedGoals?.away)}</small>
                          </>
                        ) : (
                          <>
                            <strong>--</strong>
                            <span>未生成进球分布</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="score-cell">
                        {hasPrediction ? (
                          <>
                            <strong>{outputCandidateLabels(outputs.score)}</strong>
                            <span>{outputs.score.candidateText}</span>
                            <small>{outputs.score.detail}</small>
                          </>
                        ) : (
                          <>
                            <strong>-- : --</strong>
                            <span>未生成比分分布</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="market-cell">
                        {hasPrediction ? (
                          <>
                            <div className="market-output-list">
                              <div>
                                <span>{outputs.sporttery.title}</span>
                                <strong>{outputs.sporttery.label}</strong>
                                <em>{outputs.sporttery.detail}</em>
                                <small>{outputs.sporttery.metric}</small>
                              </div>
                              <div>
                                <span>让球盘</span>
                                <strong>{outputs.handicap.label}</strong>
                                <em>{outputs.handicap.detail}</em>
                                <small>{outputs.handicap.metric}</small>
                              </div>
                            </div>
                            <button
                              className="table-alternative-toggle"
                              type="button"
                              aria-expanded={alternativeExpanded}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedAlternativeId((currentId) => (currentId === match.id ? null : match.id));
                              }}
                            >
                              <TrendingUp size={13} />
                              <span>{alternativeExpanded ? '收起盘口推演' : '盘口推演'}</span>
                            </button>
                            <small>欧赔 {fixed(match.odds?.home)} / {fixed(match.odds?.draw)} / {fixed(match.odds?.away)}</small>
                            <small>亚盘 {asianPrefix}{fixed(asianLine, 1)} · {match.odds?.provider || match.tags?.slice(0, 2).join(' · ') || '无标签'}</small>
                            {consensusText(match.marketConsensus) && <small>{consensusText(match.marketConsensus)}</small>}
                            {movementText(match.marketConsensus?.movement) && <small>{movementText(match.marketConsensus.movement)}</small>}
                            {marketQualityText(match.marketQuality) && <small>{marketQualityText(match.marketQuality)}</small>}
                          </>
                        ) : (
                          <>
                            <strong>盘口待接入</strong>
                            <span>{marketAuditText(marketAudit)}</span>
                            <small>{marketAuditShort(marketAudit)}</small>
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="metric-stack">
                        <span className="confidence-bar" style={{ '--value': `${confidence * 100}%` }} />
                        <strong>{hasPrediction ? percent(confidence) : '--'}</strong>
                        {hasPrediction && <AuxiliaryBadge signal={match.auxiliarySignal} />}
                      </div>
                    </td>
                    <td>
                      <div className={`risk-badge ${hasPrediction ? riskClass(match.riskLevel) : 'risk-low muted-risk'}`}>
                        {hasPrediction && match.riskLevel === '高' ? <ShieldAlert size={14} /> : <Flame size={14} />}
                        <span>{hasPrediction ? match.riskLevel : '未评估'}</span>
                        <strong>{hasPrediction ? percent(match.upsetRisk, 0) : '--'}</strong>
                      </div>
                    </td>
                    <td>
                      <div className={`value-cell value-${match.previewDecision?.tone ?? 'muted'}`}>
                        <Star size={14} />
                        <strong>{hasPrediction ? signed(match.valueScore, 2) : '--'}</strong>
                        <span>
                          {decisionText(match)}
                          {match.resultSummary ? ` · ${match.resultSummary.result1x2}` : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="row-action" aria-hidden="true">
                        <ChevronRight size={16} />
                      </span>
                    </td>
                  </tr>
                  {hasPrediction && alternativeExpanded && (
                    <tr className="table-alternative-row">
                      <td colSpan={columns.length + 1}>
                        <AlternativeMarketPanel alternative={alternative} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
