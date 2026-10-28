import {
  Activity,
  BarChart3,
  Beaker,
  Brackets,
  ClipboardCheck,
  Database,
  GitBranch,
  Layers3,
  LineChart,
  ShieldCheck,
  Trophy
} from 'lucide-react';

const navItems = [
  { key: 'matches', label: '官方赛程', icon: Activity },
  { key: 'groups', label: '官方分组', icon: Layers3 },
  { key: 'knockout', label: '淘汰赛路径', icon: Brackets },
  { key: 'champion', label: '冠军概率', icon: Trophy },
  { key: 'parlay', label: '串关筛选', icon: GitBranch },
  { key: 'double', label: '双叠合', icon: Layers3 },
  { key: 'ideas', label: '想法验证', icon: Beaker },
  { key: 'review', label: '复盘校准', icon: ClipboardCheck },
  { key: 'models', label: '模型版本', icon: BarChart3 },
  { key: 'data', label: '数据更新', icon: Database }
];

export function Sidebar({ activeView, onChangeView, counts }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <LineChart size={19} strokeWidth={2.2} />
        </div>
        <div>
          <strong>世界杯预测</strong>
          <span>官方赛程工作台</span>
        </div>
      </div>

      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-current={activeView === item.key ? 'page' : undefined}
              aria-label={item.label}
              className={`nav-item ${activeView === item.key ? 'active' : ''}`}
              key={item.key}
              onClick={() => onChangeView(item.key)}
              type="button"
            >
              <Icon size={17} strokeWidth={2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-status">
        <div className="status-title">
          <ShieldCheck size={16} />
          <span>闭环状态</span>
        </div>
        <dl>
          <div>
            <dt>比赛</dt>
            <dd>{counts?.matches ?? 0}</dd>
          </div>
          <div>
            <dt>高风险</dt>
            <dd>{counts?.highRisk ?? 0}</dd>
          </div>
          <div>
            <dt>正价值</dt>
            <dd>{counts?.positiveValue ?? 0}</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}
