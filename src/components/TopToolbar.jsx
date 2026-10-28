import { Download, Filter, ImagePlus, RefreshCcw, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';

const stageOptions = [
  ['all', '全部阶段'],
  ['group', '小组赛'],
  ['round32', '32强'],
  ['round16', '16强'],
  ['quarterfinal', '1/4决赛'],
  ['semifinal', '半决赛'],
  ['final', '决赛']
];

const riskOptions = [
  ['all', '全部风险'],
  ['高', '高风险'],
  ['中', '中风险'],
  ['低', '低风险']
];

export function TopToolbar({
  query,
  onQueryChange,
  stageFilter,
  onStageChange,
  riskFilter,
  onRiskChange,
  tagFilter,
  onTagChange,
  tagRules,
  model,
  onGeneratePoster,
  posterDisabled = false,
  posterBusy = false,
  onRefresh,
  onSeed,
  refreshing
}) {
  return (
    <header className="topbar">
      <div className="toolbar-main">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索比赛"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onQueryChange('');
            }}
            placeholder="搜索球队、场次、标签"
            value={query}
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => onQueryChange('')}
              title="清空搜索"
              aria-label="清空搜索"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        <label className="select-control">
          <Filter size={15} />
          <select value={stageFilter} onChange={(event) => onStageChange(event.target.value)}>
            {stageOptions.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="select-control">
          <SlidersHorizontal size={15} />
          <select value={riskFilter} onChange={(event) => onRiskChange(event.target.value)}>
            {riskOptions.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="select-control tag-select">
          <select value={tagFilter} onChange={(event) => onTagChange(event.target.value)}>
            <option value="all">全部标签</option>
            {tagRules?.map((tag) => (
              <option value={tag.name} key={tag.code}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar-actions">
        <button
          type="button"
          className="poster-button"
          onClick={onGeneratePoster}
          disabled={posterDisabled || posterBusy}
          title="生成今日推荐传播图"
        >
          <ImagePlus size={16} />
          <span>{posterBusy ? '生成中' : '生成今日推荐'}</span>
        </button>
        <div className="model-pill" title="当前预测模型版本">
          {model?.name ?? '模型未加载'}
        </div>
        <button type="button" className="icon-button" onClick={onRefresh} disabled={refreshing} title="刷新审计数据">
          <RefreshCcw size={16} className={refreshing ? 'spin' : ''} />
        </button>
        <button type="button" className="icon-button" onClick={onSeed} disabled={refreshing} title="重建样例闭环库">
          <RotateCcw size={16} />
        </button>
        <button type="button" className="icon-button" title="预留 CSV/JSON 导入">
          <Download size={16} />
        </button>
      </div>
    </header>
  );
}
