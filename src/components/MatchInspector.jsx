import {
  AlertTriangle,
  BadgeCheck,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  GitCompare,
  Send,
  TrendingUp
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { percent, signed } from '../lib/format.js';
import { alternativeMarketReadingOutput, buildMarketOutputs } from '../lib/marketOutputs.js';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fixed(value, digits = 2) {
  return isFiniteNumber(value) ? value.toFixed(digits) : '--';
}

function barWidth(value) {
  const safeValue = isFiniteNumber(value) ? value : 0;
  return `${Math.max(4, Math.round(safeValue * 100))}%`;
}

function scaledBarWidth(value, maxValue) {
  if (!isFiniteNumber(value) || !isFiniteNumber(maxValue) || maxValue <= 0) return '0%';
  return `${Math.max(3, Math.round((value / maxValue) * 100))}%`;
}

function probabilityIntervalText(interval) {
  if (!isFiniteNumber(interval?.low) || !isFiniteNumber(interval?.high)) return '--';
  return `${percent(interval.low, 1)}-${percent(interval.high, 1)}`;
}

function Sparkline({ points, keyName }) {
  const path = useMemo(() => {
    if (!points?.length) return '';
    const values = points.map((point) => point[keyName]).filter(isFiniteNumber);
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    return values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 100;
        const y = 36 - ((value - min) / Math.max(0.01, max - min)) * 30;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }, [keyName, points]);

  return (
    <svg className="sparkline" viewBox="0 0 100 40" role="img" aria-label="盘口走势">
      <path d="M0 36 L100 36" className="spark-baseline" />
      <path d={path} className="spark-path" />
    </svg>
  );
}

function marketAuditBlockedText(audit) {
  const available = Number(audit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const rows = Number(audit?.importSummary?.rowsImported ?? 0);
  const complete = Number(audit?.importSummary?.completeCandidates ?? 0);
  const sources = audit?.sources?.length ?? 0;
  if (available > 0) return `${available} 条可用`;
  if (rows > 0) return `${rows} 条已入库`;
  if (complete > 0) return `${complete} 条待复核`;
  if (sources > 0) return `${sources} 源未达完整条件`;
  return '待审计';
}

function PredictionBlockedPanel({ detail, marketAudit }) {
  const hasMarketSnapshots = Number(marketAudit?.importSummary?.verifiedSnapshotsAvailable ?? 0) > 0;
  const reasonText =
    detail.predictionBlockedReason === 'unverified_odds_source'
      ? `已有原始模型记录，盘口源 ${detail.odds?.sourceType ?? '未标注'} 等待来源备注同步。`
      : null;
  return (
    <div className="inspector-block blocked-note">
      <div className="block-title">
        <AlertTriangle size={15} />
        <span>预测待接入</span>
      </div>
      <p>
        {reasonText ?? (hasMarketSnapshots
          ? '该场尚无完整同场赛前盘口快照，暂不生成单场推荐或价值分。'
          : 'FIFA 官方赛程已写入本地审计链；等待官方盘口源审计、阵容新闻与赛前输入后再生成概率、盘口和价值分。')}
      </p>
      <div className="blocked-grid">
        <div>
          <span>赛程源</span>
          <strong>FIFA 官方</strong>
        </div>
        <div>
          <span>比赛状态</span>
          <strong>{detail.status ?? 'official_schedule_prediction_blocked'}</strong>
        </div>
        <div>
          <span>预测输出</span>
          <strong>待接入</strong>
        </div>
        <div>
          <span>盘口源</span>
          <strong>{marketAuditBlockedText(marketAudit)}</strong>
        </div>
      </div>
    </div>
  );
}

function ProbabilityBars({ detail }) {
  const intervals = detail.probabilityUncertainty?.intervals ?? {};
  return (
    <div className="inspector-block">
      <div className="block-title">
        <BadgeCheck size={15} />
        <span>胜平负校准概率</span>
      </div>
      {[
        ['home', '主胜', detail.probabilities.home],
        ['draw', '平局', detail.probabilities.draw],
        ['away', '客胜', detail.probabilities.away]
      ].map(([key, label, value]) => (
        <div className="hbar" key={label}>
          <span>{label}</span>
          <div>
            <i style={{ width: barWidth(value) }} />
          </div>
          <strong>{percent(value)}</strong>
          <small>{probabilityIntervalText(intervals[key])}</small>
        </div>
      ))}
    </div>
  );
}

function AuxiliaryModelPanel({ detail }) {
  const signal = detail.auxiliarySignal;
  if (!signal || signal.status === 'reference_only') return null;
  const aligned = signal.status === 'aligned';
  const adjustment = isFiniteNumber(signal.confidenceAdjustment) ? signal.confidenceAdjustment : 0;
  return (
    <div className={`inspector-block auxiliary-block auxiliary-${signal.status}`}>
      <div className="block-title">
        {aligned ? <BadgeCheck size={15} /> : <GitCompare size={15} />}
        <span>辅助模型验票</span>
      </div>
      <div className="auxiliary-summary">
        <div>
          <span>主模型方向</span>
          <strong>{detail.recommendedPick}</strong>
        </div>
        <div>
          <span>辅助方向</span>
          <strong>{signal.pick}</strong>
        </div>
        <div>
          <span>信心修正</span>
          <strong>{adjustment >= 0 ? '+' : ''}{percent(adjustment, 0)}</strong>
        </div>
      </div>
      <div className="auxiliary-confidence">
        <span>原始 {percent(detail.confidence)}</span>
        <strong>{percent(detail.displayConfidence ?? detail.confidence)}</strong>
        <span>{signal.label}</span>
      </div>
      <p>{signal.note}</p>
    </div>
  );
}

function CandidatePills({ candidates }) {
  if (!candidates?.length) return null;
  return (
    <div className="candidate-pills">
      {candidates.map((candidate) => (
        <span className={candidate.primary ? 'primary' : ''} key={`${candidate.label}-${candidate.metric}`}>
          <b>{candidate.primary ? '优先' : '备选'}</b>
          {candidate.label}
          <em>{candidate.metric}</em>
        </span>
      ))}
    </div>
  );
}

function OutputCard({ output }) {
  return (
    <div className={`standard-output-card output-${output.status ?? 'ready'}`}>
      <span>{output.title}</span>
      <strong>{output.label}</strong>
      <small>{output.detail}</small>
      <em>{output.metric}</em>
      <CandidatePills candidates={output.candidates} />
    </div>
  );
}

function StandardOutputPanel({ detail, marketAudit }) {
  const [showAlternative, setShowAlternative] = useState(false);
  const outputs = buildMarketOutputs(detail, marketAudit, {
    scores: detail.scores,
    goals: detail.goals
  });
  const alternative = alternativeMarketReadingOutput(detail, {
    scores: detail.scores,
    goals: detail.goals
  });
  return (
    <div className="inspector-block standard-output-block">
      <div className="block-title">
        <ClipboardCheck size={15} />
        <span>标准输出</span>
      </div>
      <div className="standard-output-grid">
        <OutputCard output={outputs.moneyline} />
        <OutputCard output={outputs.sporttery} />
        <OutputCard output={outputs.handicap} />
        <OutputCard output={outputs.total} />
        <OutputCard output={outputs.goalCount} />
        <OutputCard output={outputs.score} />
      </div>
      <div className="technical-reasons">
        <strong>技术简述</strong>
        {outputs.reasons.map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </div>
      <div className="alternative-market-read">
        <button type="button" onClick={() => setShowAlternative((value) => !value)}>
          <TrendingUp size={14} />
          <span>{showAlternative ? '收起盘口推演' : '显示盘口推演'}</span>
        </button>
        {showAlternative && (
          <div className="alternative-market-panel">
            <div className="alternative-market-summary">
              <span>推演结果</span>
              <strong>{alternative.summary}</strong>
            </div>
            <div className="alternative-market-grid">
              <div>
                <span>让球盘</span>
                <strong>{alternative.handicap.label}</strong>
                {alternative.handicap.reasons.map((reason) => (
                  <small key={reason}>{reason}</small>
                ))}
              </div>
              <div>
                <span>大小球</span>
                <strong>{alternative.total.label}</strong>
                {alternative.total.reasons.map((reason) => (
                  <small key={reason}>{reason}</small>
                ))}
              </div>
              <div>
                <span>合成比分</span>
                <strong>{alternative.score.label}</strong>
                <small>{alternative.score.detail}</small>
                <CandidatePills candidates={alternative.score.candidates} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProbabilityUncertaintyPanel({ uncertainty }) {
  if (!uncertainty) return null;
  const basis = uncertainty.basis ?? {};
  return (
    <div className="inspector-block uncertainty-block">
      <div className="block-title">
        <AlertTriangle size={15} />
        <span>概率区间审计</span>
      </div>
      <div className="uncertainty-grid">
        <div>
          <span>展示区间</span>
          <strong>±{percent(uncertainty.margin, 1)}</strong>
        </div>
        <div>
          <span>校准误差</span>
          <strong>{percent(basis.calibrationError, 1)}</strong>
        </div>
        <div>
          <span>provider 分歧</span>
          <strong>{percent(basis.providerDisagreement, 1)}</strong>
        </div>
        <div>
          <span>快照年龄</span>
          <strong>{isFiniteNumber(basis.latestAgeHours) ? `${basis.latestAgeHours.toFixed(1)}h` : '--'}</strong>
        </div>
      </div>
      <p>区间用于表达不确定性，不改变候选/观察分层。</p>
    </div>
  );
}

function pickKeyFromLabel(label) {
  if (label === '主胜') return 'home';
  if (label === '客胜') return 'away';
  if (label === '平局') return 'draw';
  return null;
}

function scoreOutcomeKey(score) {
  if (!score) return null;
  if (score.home_goals > score.away_goals) return 'home';
  if (score.home_goals < score.away_goals) return 'away';
  return 'draw';
}

function scoreLabel(score) {
  return score ? `${score.home_goals}-${score.away_goals}` : '--';
}

function goalDistributionMeta(goals) {
  const rows = goals?.filter((goal) => goal.total_goals <= 6) ?? [];
  const maxProbability = Math.max(0, ...rows.map((goal) => (isFiniteNumber(goal.probability) ? goal.probability : 0)));
  const peak = rows.find((goal) => goal.probability === maxProbability);
  return { rows, maxProbability, peak };
}

function ScorePanel({ detail }) {
  const scores = detail.scores ?? [];
  const pickKey = pickKeyFromLabel(detail.recommendedPick);
  const globalPeak = scores[0] ?? null;
  const directionScore = scores.find((score) => scoreOutcomeKey(score) === pickKey) ?? globalPeak;
  const maxScoreProbability = Math.max(0, ...scores.map((score) => (isFiniteNumber(score.probability) ? score.probability : 0)));
  const visibleScores = [directionScore, ...scores.filter((score) => scoreLabel(score) !== scoreLabel(directionScore))]
    .filter(Boolean)
    .slice(0, 6);
  const goalMeta = goalDistributionMeta(detail.goals);
  const expectedTotal = (detail.expectedGoals?.home ?? 0) + (detail.expectedGoals?.away ?? 0);
  return (
    <div className="inspector-block">
      <div className="block-title">
        <ClipboardList size={15} />
        <span>比分与进球数</span>
      </div>
      <div className="score-feature">
        <div>
          <span>方向比分</span>
          <strong>{scoreLabel(directionScore)}</strong>
          <em>{percent(directionScore?.probability)}</em>
        </div>
        <div>
          <span>全局峰值</span>
          <strong>{scoreLabel(globalPeak)}</strong>
          <em>{percent(globalPeak?.probability)}</em>
        </div>
      </div>
      <div className="score-grid score-grid-refined">
        {visibleScores.map((score) => (
          <div
            className={`score-tile ${scoreLabel(score) === scoreLabel(directionScore) ? 'is-direction' : ''}`}
            key={`${score.home_goals}-${score.away_goals}`}
          >
            <strong>{score.home_goals}-{score.away_goals}</strong>
            <span>{percent(score.probability)}</span>
            <i style={{ width: scaledBarWidth(score.probability, maxScoreProbability) }} />
          </div>
        ))}
      </div>
      <div className="goal-distribution">
        <div className="goal-distribution-head">
          <span>总进球分布</span>
          <strong>
            峰值 {goalMeta.peak?.total_goals ?? '--'} 球 · {percent(goalMeta.peak?.probability)}
          </strong>
          <em>均值 {fixed(expectedTotal, 2)}</em>
        </div>
        {goalMeta.rows.map((goal) => (
          <div className="goal-row" key={goal.total_goals}>
            <span>{goal.total_goals}</span>
            <div>
              <i style={{ width: scaledBarWidth(goal.probability, goalMeta.maxProbability) }} />
            </div>
            <strong>{percent(goal.probability)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagPanel({ detail }) {
  return (
    <div className="inspector-block">
      <div className="block-title">
        <AlertTriangle size={15} />
        <span>盘口经验标签</span>
      </div>
      <div className="tag-list">
        {detail.tags?.length ? (
          detail.tags.map((tag) => (
            <div className="tag-row" key={tag.code}>
              <div>
                <strong>{tag.name}</strong>
                <span>{tag.impactDirection}</span>
              </div>
              <em>{percent(tag.confidence)}</em>
            </div>
          ))
        ) : (
          <p className="muted">当前未触发规则标签。</p>
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }) {
  return (
    <div className="inspector-block">
      <div className="block-title">
        <ClipboardCheck size={15} />
        <span>赛果与盘口复盘</span>
      </div>
      {result ? (
        <>
          <div className="result-grid">
            <div>
              <span>比分</span>
              <strong>{result.homeScore}-{result.awayScore}</strong>
            </div>
            <div>
              <span>胜平负</span>
              <strong>{result.result1x2}</strong>
            </div>
            <div>
              <span>盘口</span>
              <strong>{result.handicapResult}</strong>
            </div>
            <div>
              <span>大小球</span>
              <strong>{result.totalResult}</strong>
            </div>
          </div>
          <div className="result-note">
            <strong>{result.upsetType}</strong>
            <span>{result.note}</span>
          </div>
        </>
      ) : (
        <p className="muted">暂无赛果，保留赛后录入和复盘校准入口。</p>
      )}
    </div>
  );
}

function favoriteLabel(key) {
  if (key === 'home') return '主胜';
  if (key === 'draw') return '平局';
  if (key === 'away') return '客胜';
  return '--';
}

function oddsRangeText(range) {
  if (!range) return '--';
  return `${fixed(range.min)}-${fixed(range.max)}`;
}

function qualityStatusText(quality) {
  if (!quality?.supplied) return '未生成';
  if (quality.candidateReady) return '候选可用';
  if (quality.watchReady) return '观察可用';
  return '需复核';
}

function consensusMethodLabel(method) {
  if (method === 'historical_provider_weighted') return '历史加权';
  return '等权平均';
}

function movementDirectionLabel(direction) {
  if (direction === 'strengthened') return '顺向增强';
  if (direction === 'weakened') return '逆向走弱';
  if (direction === 'flat') return '横盘';
  return '样本不足';
}

function MarketConsensusPanel({ consensus, quality }) {
  if (!consensus?.providerCount) return null;
  const movement = consensus.movement;
  return (
    <div className="inspector-block consensus-block">
      <div className="block-title">
        <GitCompare size={15} />
        <span>provider 共识与分歧</span>
      </div>
      <div className="consensus-grid">
        <div>
          <span>provider</span>
          <strong>{consensus.providerCount} 家</strong>
        </div>
        <div>
          <span>方法</span>
          <strong>{consensusMethodLabel(consensus.method)}</strong>
        </div>
        <div>
          <span>历史证据</span>
          <strong>{consensus.matchedProviderCount ?? 0}/{consensus.providerCount}</strong>
        </div>
        <div>
          <span>主快照一致</span>
          <strong>{consensus.primaryAgreement === false ? '否' : consensus.primaryAgreement === true ? '是' : '--'}</strong>
        </div>
      </div>
      <div className="consensus-probs">
        <span>主 {percent(consensus.probabilities?.home)}</span>
        <span>平 {percent(consensus.probabilities?.draw)}</span>
        <span>客 {percent(consensus.probabilities?.away)}</span>
      </div>
      <div className="consensus-range">
        <span>方向 {favoriteLabel(consensus.favorite)}</span>
        <span>最大分歧 {percent(consensus.maxProbabilityRange)}</span>
        <span>平均分歧 {percent(consensus.avgProbabilityRange)}</span>
        <span>
          移动 {movement?.supplied ? `${movementDirectionLabel(movement.favoriteDirection)} ${percent(movement.favoriteDelta)}` : '样本不足'}
        </span>
        <span>快照年龄 {isFiniteNumber(quality?.latestAgeHours) ? `${quality.latestAgeHours.toFixed(1)}h` : '--'}</span>
        <span>质量 {qualityStatusText(quality)}</span>
        <span>欧赔主 {oddsRangeText(consensus.oddsRange?.home)}</span>
        <span>平 {oddsRangeText(consensus.oddsRange?.draw)}</span>
        <span>客 {oddsRangeText(consensus.oddsRange?.away)}</span>
      </div>
      {consensus.providers?.length ? (
        <div className="provider-weight-list" aria-label="provider 历史权重">
          {consensus.providers.map((provider) => (
            <span className={provider.evidenceMatched ? 'matched' : ''} key={`${provider.provider}-${provider.capturedAt}`}>
              {provider.provider.replace('OddsLab/', '')} · w {fixed(provider.weight, 3)}
              {provider.evidenceMatched ? ` · ${provider.historicalLabel}` : ' · 中性'}
            </span>
          ))}
        </div>
      ) : null}
      {movement?.providers?.length ? (
        <div className="provider-movement-list" aria-label="provider 盘口移动">
          {movement.providers.map((provider) => (
            <span key={`${provider.provider}-${provider.latestCapturedAt}`}>
              {provider.provider.replace('OddsLab/', '')} · {provider.snapshots} 点 · {percent(provider.favoriteDelta)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MatchInspector({
  detail,
  marketAudit,
  stake,
  onStakeChange,
  riskBudget,
  onRiskBudgetChange,
  onAddReview
}) {
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);

  if (!detail) {
    return (
      <aside className="inspector empty">
        <p>选择一场比赛查看深度分析。</p>
      </aside>
    );
  }

  const hasPrediction = detail.hasPrediction ?? detail.recommendedPick != null;
  const fallbackExplanation = 'FIFA 官方赛程已写入；等待官方赔率、阵容新闻与赛前输入后再生成预测。';
  const decision = detail.previewDecision ?? { label: '观察', action: '观察', tone: 'watch' };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!hasPrediction) return;
    setSaving(true);
    await onAddReview({
      matchId: detail.id,
      actualResult: detail.result?.result1x2 || '',
      handicapResult: detail.result?.handicapResult || '',
      modelError: detail.result ? `${detail.recommendedPick === detail.result.result1x2 ? '赛果命中' : '赛果偏差'} · ${detail.result.upsetType}` : '待赛后确认',
      calibrationAction: detail.result ? '纳入历史校准' : '观察',
      note: reviewNote || '赛前复盘占位记录'
    });
    setReviewNote('');
    setSaving(false);
  };

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span>#{detail.matchNo} {detail.roundLabel}</span>
        <h2>{detail.homeTeam} vs {detail.awayTeam}</h2>
        <p>{detail.explanation || fallbackExplanation}</p>
      </div>

      {!hasPrediction ? (
        <>
          <PredictionBlockedPanel detail={detail} marketAudit={marketAudit} />
          <ResultPanel result={detail.result} />
          <TagPanel detail={detail} />
        </>
      ) : (
        <>
          <ProbabilityBars detail={detail} />
          <AuxiliaryModelPanel detail={detail} />
          <StandardOutputPanel detail={detail} marketAudit={marketAudit} />
          <ProbabilityUncertaintyPanel uncertainty={detail.probabilityUncertainty} />
          <ScorePanel detail={detail} />
          <ResultPanel result={detail.result} />

          <div className="inspector-block">
            <div className="block-title">
              <TrendingUp size={15} />
              <span>赔率与水位走势</span>
            </div>
            <Sparkline points={detail.oddsHistory} keyName="homeOdds" />
            <div className="market-summary">
              <span>欧赔 {fixed(detail.odds?.home)} / {fixed(detail.odds?.draw)} / {fixed(detail.odds?.away)}</span>
              <strong>亚盘 {fixed(detail.odds?.asianLine, 1)} | {fixed(detail.odds?.asianHomeWater)}-{fixed(detail.odds?.asianAwayWater)}</strong>
              <small>
                来源 {detail.odds?.provider ?? '--'} · {detail.odds?.capturedAt
                  ? new Date(detail.odds.capturedAt).toLocaleString('zh-CN', { hour12: false })
                  : '--'}
              </small>
            </div>
          </div>

          <MarketConsensusPanel consensus={detail.marketConsensus} quality={detail.marketQuality} />

          <TagPanel detail={detail} />

          <div className="inspector-block stake-block">
            <div className="block-title">
              <CircleDollarSign size={15} />
              <span>价值分层与风险输入</span>
            </div>
            <div className="stake-grid">
              <label>
                <span>金额</span>
                <input value={stake} onChange={(event) => onStakeChange(event.target.value)} inputMode="decimal" />
              </label>
              <label>
                <span>预算</span>
                <select value={riskBudget} onChange={(event) => onRiskBudgetChange(event.target.value)}>
                  <option value="observe">观察</option>
                  <option value="small">小仓</option>
                  <option value="standard">标准</option>
                  <option value="avoid">规避</option>
                </select>
              </label>
            </div>
            <div className="ev-line">
              <span>价值分</span>
              <strong>{signed(detail.valueScore, 3)}</strong>
              <span>分层</span>
              <strong className={`decision-${decision.tone}`}>{decision.label}</strong>
              <span>方向</span>
              <strong>{detail.recommendedPick}</strong>
            </div>
          </div>

          <form className="review-form" onSubmit={handleSubmit}>
            <label>
              <span>复盘记录</span>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="记录赛后偏差、盘口结果或校准动作"
              />
            </label>
            <button type="submit" disabled={saving}>
              <Send size={15} />
              <span>{saving ? '保存中' : '写入复盘'}</span>
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
