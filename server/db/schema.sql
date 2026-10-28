CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  confederation TEXT NOT NULL,
  group_name TEXT,
  seed_rank INTEGER NOT NULL,
  elo REAL NOT NULL,
  glicko_mu REAL NOT NULL,
  glicko_phi REAL NOT NULL,
  attack REAL NOT NULL,
  defense REAL NOT NULL,
  form REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  match_no INTEGER NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  group_name TEXT,
  round_label TEXT NOT NULL,
  kickoff_utc TEXT NOT NULL,
  venue TEXT NOT NULL,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_placeholder TEXT,
  away_placeholder TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_versions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  calibration_json TEXT NOT NULL,
  accuracy_json TEXT NOT NULL,
  notes TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  home_odds REAL NOT NULL,
  draw_odds REAL NOT NULL,
  away_odds REAL NOT NULL,
  asian_line REAL NOT NULL,
  asian_home_water REAL NOT NULL,
  asian_away_water REAL NOT NULL,
  total_line REAL NOT NULL,
  over_water REAL NOT NULL,
  under_water REAL NOT NULL,
  source_type TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  UNIQUE(match_id, captured_at, provider)
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version_id INTEGER NOT NULL REFERENCES model_versions(id),
  odds_snapshot_id INTEGER NOT NULL REFERENCES odds_snapshots(id),
  generated_at TEXT NOT NULL,
  home_win_prob REAL NOT NULL,
  draw_prob REAL NOT NULL,
  away_win_prob REAL NOT NULL,
  calibrated_home_prob REAL NOT NULL,
  calibrated_draw_prob REAL NOT NULL,
  calibrated_away_prob REAL NOT NULL,
  expected_home_goals REAL NOT NULL,
  expected_away_goals REAL NOT NULL,
  confidence REAL NOT NULL,
  upset_risk REAL NOT NULL,
  value_score REAL NOT NULL,
  recommended_pick TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  explanation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS score_probabilities (
  id INTEGER PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  probability REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_probabilities (
  id INTEGER PRIMARY KEY,
  prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  total_goals INTEGER NOT NULL,
  probability REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_rules (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  impact_direction TEXT NOT NULL,
  impact_strength REAL NOT NULL,
  historical_hit_rate REAL NOT NULL,
  review_summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_tags (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tag_rule_id INTEGER NOT NULL REFERENCES tag_rules(id),
  source TEXT NOT NULL,
  triggered_at TEXT NOT NULL,
  confidence REAL NOT NULL,
  note TEXT NOT NULL,
  review_result TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(match_id, tag_rule_id, triggered_at)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER,
  away_score INTEGER,
  result_1x2 TEXT,
  handicap_result TEXT,
  total_result TEXT,
  upset_type TEXT,
  settled_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  model_version_id INTEGER REFERENCES model_versions(id),
  created_at TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  actual_result TEXT,
  handicap_result TEXT,
  model_error TEXT,
  calibration_action TEXT,
  note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_guesses (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  market_type TEXT NOT NULL,
  pick_key TEXT NOT NULL,
  pick_label TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY,
  run_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  rows_affected INTEGER NOT NULL,
  snapshot_key TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_stage ON matches(stage);
CREATE INDEX IF NOT EXISTS idx_matches_group ON matches(group_name);
CREATE INDEX IF NOT EXISTS idx_odds_match_time ON odds_snapshots(match_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_tags_match ON match_tags(match_id);
CREATE INDEX IF NOT EXISTS idx_personal_guesses_match ON personal_guesses(match_id);
