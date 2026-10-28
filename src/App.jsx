import { useEffect, useMemo, useState, useTransition } from 'react';
import { Activity, DatabaseZap, ShieldAlert, Sparkles } from 'lucide-react';
import { MatchInspector } from './components/MatchInspector.jsx';
import { PredictionTable } from './components/PredictionTable.jsx';
import { RecommendationPosterModal } from './components/RecommendationPosterModal.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { TopToolbar } from './components/TopToolbar.jsx';
import {
  ChampionView,
  DataView,
  DoubleOverlapView,
  GroupsView,
  IdeaValidationView,
  KnockoutView,
  ModelsView,
  ParlayView,
  ReviewView
} from './components/WorkspacePanel.jsx';
import { api } from './lib/api.js';
import { generateRecommendationPoster } from './lib/recommendationPoster.js';

function numberOr(value, fallback = -Infinity) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function compareBy(key, direction) {
  const factor = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const value = (match) => {
      if (key === 'time') return new Date(match.kickoffUtc).getTime();
      if (key === 'fixture') return `${match.homeTeam}${match.awayTeam}`;
      if (key === 'prob') {
        return Math.max(
          numberOr(match.probabilities?.home),
          numberOr(match.probabilities?.draw),
          numberOr(match.probabilities?.away)
        );
      }
      if (key === 'goals') {
        const home = numberOr(match.expectedGoals?.home, null);
        const away = numberOr(match.expectedGoals?.away, null);
        return home == null || away == null ? -Infinity : home + away;
      }
      if (key === 'score') return numberOr(match.scoreCandidates?.[0]?.probability);
      if (key === 'market') return numberOr(Math.abs(match.odds?.asianLine));
      if (key === 'confidence') return numberOr(match.confidence);
      if (key === 'risk') return numberOr(match.upsetRisk);
      if (key === 'value') return numberOr(match.valueScore);
      return match.matchNo;
    };
    const left = value(a);
    const right = value(b);
    if (typeof left === 'string') return left.localeCompare(right, 'zh-CN') * factor;
    return (left - right) * factor;
  };
}

function useWorkbenchData() {
  const [data, setData] = useState({ matches: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    const bootstrap = await api.bootstrap();
    setData(bootstrap);
    setLoading(false);
    return bootstrap;
  };

  useEffect(() => {
    load().catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  return { data, loading, error, load, setError };
}

function EmptyState({ loading, error }) {
  return (
    <main className="empty-state">
      <div>
        <strong>{loading ? '正在加载官方赛程审计' : '无法加载工作台'}</strong>
        <span>{loading ? '初始化 SQLite、官方赛程和前端状态。' : error}</span>
      </div>
    </main>
  );
}

function TacticalStatusStrip({ summary, marketAudit }) {
  const sampleMode = summary?.dataQuality?.mode === 'sample_sandbox_loop';
  const marketSnapshots = Number(marketAudit?.importSummary?.verifiedSnapshotsAvailable ?? 0);
  const rowsImported = Number(marketAudit?.importSummary?.rowsImported ?? 0);
  const sourceCount = marketAudit?.sources?.length ?? 0;
  const marketLabel =
    marketSnapshots > 0 ? `${marketSnapshots}` : rowsImported > 0 ? `${rowsImported}` : sourceCount > 0 ? `${sourceCount}` : '待审计';
  const marketMeta =
    marketSnapshots > 0 ? '完整盘口快照' : rowsImported > 0 ? '入库盘口行' : sourceCount > 0 ? '已审计来源' : '等待数据源';

  const items = [
    {
      icon: Activity,
      label: sampleMode ? '样例赛程' : '官方赛程',
      value: summary?.counts?.matches ?? 0,
      meta: sampleMode ? '沙盒 104' : 'FIFA 2026'
    },
    {
      icon: DatabaseZap,
      label: '盘口快照',
      value: marketLabel,
      meta: sampleMode ? '样例快照' : marketMeta
    },
    {
      icon: ShieldAlert,
      label: '高风险场次',
      value: summary?.counts?.highRisk ?? 0,
      meta: '冷门预警'
    },
    {
      icon: Sparkles,
      label: '正价值输出',
      value: summary?.counts?.positiveValue ?? 0,
      meta: '候选分层'
    }
  ];

  return (
    <section className="tactical-status-strip" aria-label="分析室状态">
      <div className="status-strip-title">
        <strong>{sampleMode ? '样例分析室' : '比赛分析室'}</strong>
        <span>{sampleMode ? '沙盒闭环 · 样例盘口 · 复盘校准' : '官方赛程 · 市场快照 · 风险分层'}</span>
      </div>
      <div className="status-strip-grid">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.label}>
              <Icon size={18} strokeWidth={2} />
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.meta}</small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function App() {
  const { data, loading, error, load, setError } = useWorkbenchData();
  const [activeView, setActiveView] = useState('matches');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'time', direction: 'asc' });
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [stake, setStake] = useState('1000');
  const [riskBudget, setRiskBudget] = useState('observe');
  const [guessLedger, setGuessLedger] = useState({ guesses: [], stats: null });
  const [poster, setPoster] = useState({ open: false, status: 'idle', imageUrl: '', blob: null, error: '', meta: null });
  const [refreshing, startRefreshTransition] = useTransition();

  const matches = data.matches;
  const summary = data.summary;
  const model = summary?.modelVersions?.[0];
  const marketAudit = summary?.dataQuality?.marketAudit;

  useEffect(() => {
    if (!selectedId && matches.length) setSelectedId(matches[0].id);
  }, [matches, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    api
      .match(selectedId)
      .then((detail) => {
        if (active) setSelectedDetail(detail);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [selectedId, setError]);

  useEffect(() => {
    api.guesses().then(setGuessLedger).catch((err) => console.warn('guesses ledger unavailable', err));
  }, []);

  const filteredMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
    return matches
      .filter((match) => {
        if (stageFilter !== 'all' && match.stage !== stageFilter) return false;
        if (riskFilter !== 'all' && match.riskLevel !== riskFilter) return false;
        if (tagFilter !== 'all' && !match.tags?.includes(tagFilter)) return false;
        if (!normalizedQuery) return true;
        return [
          match.homeTeam,
          match.awayTeam,
          match.roundLabel,
          match.venue,
          match.recommendedPick ?? '',
          ...(match.tags ?? []),
          String(match.matchNo)
        ]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery);
      })
      .toSorted(compareBy(sort.key, sort.direction));
  }, [matches, query, riskFilter, sort.direction, sort.key, stageFilter, tagFilter]);

  const handleSort = (key) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleRefresh = () => {
    startRefreshTransition(async () => {
      await api.refresh();
      await load();
      if (selectedId) setSelectedDetail(await api.match(selectedId));
    });
  };

  const handleOddsRefresh = () => {
    startRefreshTransition(async () => {
      await api.refreshOdds();
      await load();
      if (selectedId) setSelectedDetail(await api.match(selectedId));
    });
  };

  const handleSeed = (mode = 'official') => {
    startRefreshTransition(async () => {
      const seeded = await api.seed(mode);
      const bootstrap = await load();
      setSelectedId(bootstrap.matches[0]?.id ?? null);
      setSelectedDetail(null);
      console.info('seeded', seeded);
    });
  };

  const handleSampleSeed = () => handleSeed('sample');
  const handleOfficialSeed = () => handleSeed('official');

  const handleClosePoster = () => {
    setPoster((current) => {
      if (current.imageUrl) URL.revokeObjectURL(current.imageUrl);
      return { open: false, status: 'idle', imageUrl: '', blob: null, error: '', meta: null };
    });
  };

  const handleGeneratePoster = async () => {
    setPoster((current) => {
      if (current.imageUrl) URL.revokeObjectURL(current.imageUrl);
      return { open: true, status: 'generating', imageUrl: '', blob: null, error: '', meta: null };
    });
    try {
      const generated = await generateRecommendationPoster({ matches, summary, marketAudit });
      setPoster({ open: true, status: 'ready', error: '', ...generated });
    } catch (err) {
      setPoster({ open: true, status: 'error', imageUrl: '', blob: null, error: err.message, meta: null });
    }
  };

  const handleAddReview = async (payload) => {
    await api.addReview(payload);
    if (selectedId) setSelectedDetail(await api.match(selectedId));
  };

  const handleAddGuess = async (payload) => {
    const response = await api.addGuess(payload);
    setGuessLedger(response.ledger);
  };

  const handleDeleteGuess = async (id) => {
    const response = await api.deleteGuess(id);
    setGuessLedger(response.ledger);
  };

  if (loading || error) return <EmptyState loading={loading} error={error} />;

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onChangeView={setActiveView} counts={summary?.counts} />
      <div className="main-shell">
        <TopToolbar
          query={query}
          onQueryChange={setQuery}
          stageFilter={stageFilter}
          onStageChange={setStageFilter}
          riskFilter={riskFilter}
          onRiskChange={setRiskFilter}
          tagFilter={tagFilter}
          onTagChange={setTagFilter}
          tagRules={summary?.tagRules}
          model={model}
          onGeneratePoster={handleGeneratePoster}
          posterDisabled={!matches.some((match) => match.hasPrediction ?? match.recommendedPick != null)}
          posterBusy={poster.status === 'generating'}
          onRefresh={handleRefresh}
          onSeed={handleSampleSeed}
          refreshing={refreshing}
        />
        <RecommendationPosterModal poster={poster} onClose={handleClosePoster} onRegenerate={handleGeneratePoster} />
        <TacticalStatusStrip summary={summary} marketAudit={marketAudit} />

        <div className={`content-grid ${activeView === 'matches' ? '' : 'full'}`}>
          {activeView === 'matches' && (
            <>
              <PredictionTable
                matches={filteredMatches}
                selectedId={selectedId}
                onSelect={setSelectedId}
                sort={sort}
                onSort={handleSort}
                marketAudit={marketAudit}
                dataQuality={summary?.dataQuality}
              />
              <MatchInspector
                detail={selectedDetail}
                marketAudit={marketAudit}
                stake={stake}
                onStakeChange={setStake}
                riskBudget={riskBudget}
                onRiskBudgetChange={setRiskBudget}
                onAddReview={handleAddReview}
              />
            </>
          )}
          {activeView === 'groups' && <GroupsView groups={summary?.groups} />}
          {activeView === 'knockout' && <KnockoutView paths={summary?.knockoutPaths} />}
          {activeView === 'champion' && <ChampionView champions={summary?.champions} />}
          {activeView === 'parlay' && <ParlayView parlays={summary?.parlays} />}
          {activeView === 'double' && (
            <DoubleOverlapView
              matches={matches}
              parlays={summary?.parlays}
              guessLedger={guessLedger}
              friendlyLedger={summary?.dataQuality?.friendlyLedger}
              reports={summary?.validationReports}
              promotionGate={summary?.dataQuality?.promotionGate}
            />
          )}
          {activeView === 'ideas' && (
            <IdeaValidationView
              matches={matches}
              ledger={guessLedger}
              onAddGuess={handleAddGuess}
              onDeleteGuess={handleDeleteGuess}
            />
          )}
          {activeView === 'review' && (
            <ReviewView
              matches={matches}
              calibration={summary?.calibration}
              friendlyLedger={summary?.dataQuality?.friendlyLedger}
            />
          )}
          {activeView === 'models' && (
            <ModelsView
              models={summary?.modelVersions}
              tagRules={summary?.tagRules}
              reports={summary?.validationReports}
            />
          )}
          {activeView === 'data' && (
            <DataView
              summary={summary}
              onRefresh={handleRefresh}
              onOddsRefresh={handleOddsRefresh}
              onSeed={handleSampleSeed}
              onOfficialSeed={handleOfficialSeed}
              refreshing={refreshing}
            />
          )}
        </div>
      </div>
    </div>
  );
}
