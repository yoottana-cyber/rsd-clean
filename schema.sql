PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('Admin','Supervisor','Inspector','Teacher')),
  linked_classroom_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS classrooms (
  classroom_id TEXT PRIMARY KEY,
  class_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS areas (
  area_id TEXT PRIMARY KEY,
  area_name TEXT NOT NULL UNIQUE,
  responsible_classroom_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_areas_class ON areas(responsible_classroom_id);

CREATE TABLE IF NOT EXISTS area_map_shapes (
  shape_id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL UNIQUE,
  shape_type TEXT NOT NULL DEFAULT 'rect',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 120,
  height REAL NOT NULL DEFAULT 80,
  points_json TEXT NOT NULL DEFAULT '[]',
  fill_color TEXT NOT NULL DEFAULT '#38bdf8',
  locked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_area_map_sort ON area_map_shapes(sort_order,shape_id);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '1,2,3,4,5',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, area_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_area ON assignments(area_id);

CREATE TABLE IF NOT EXISTS inspections (
  inspection_id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL,
  inspection_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'รอตรวจ',
  rating TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  meta_json TEXT NOT NULL,
  photo_links_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NOT NULL DEFAULT '',
  completed_by_id TEXT NOT NULL DEFAULT '',
  completed_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(area_id, inspection_date)
);
CREATE INDEX IF NOT EXISTS idx_inspections_date ON inspections(inspection_date);
CREATE INDEX IF NOT EXISTS idx_inspections_status_date ON inspections(status, inspection_date);

CREATE TABLE IF NOT EXISTS inspection_inspectors (
  inspection_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(inspection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ii_user ON inspection_inspectors(user_id, inspection_id);

CREATE TABLE IF NOT EXISTS rewards_log (
  log_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  achievement TEXT NOT NULL,
  details_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rewards_ref ON rewards_log(reference_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  credential_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS holidays (
  holiday_date TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS upload_tickets (
  ticket TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  inspection_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_tickets_exp ON upload_tickets(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS audit_log (
  audit_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor_user_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id, timestamp DESC);


CREATE TABLE IF NOT EXISTS recycle_bin (
  recycle_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL,
  deleted_by_user_id TEXT NOT NULL DEFAULT '',
  deleted_by_name TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recycle_expires ON recycle_bin(expires_at);
CREATE INDEX IF NOT EXISTS idx_recycle_deleted ON recycle_bin(deleted_at DESC);


CREATE TABLE IF NOT EXISTS system_events (
  event_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  client_hash TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_system_events_timestamp ON system_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_type_time ON system_events(event_type, timestamp DESC);


CREATE TABLE IF NOT EXISTS duty_overrides (
  override_id TEXT PRIMARY KEY,
  override_date TEXT NOT NULL,
  area_id TEXT NOT NULL,
  replace_user_id TEXT NOT NULL DEFAULT '',
  substitute_user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duty_overrides_date ON duty_overrides(override_date, area_id);
CREATE INDEX IF NOT EXISTS idx_duty_overrides_substitute ON duty_overrides(substitute_user_id, override_date);


CREATE TABLE IF NOT EXISTS academic_periods (
  period_id TEXT PRIMARY KEY,
  academic_year TEXT NOT NULL,
  semester TEXT NOT NULL,
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_academic_periods_dates ON academic_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_academic_periods_active ON academic_periods(is_active, start_date);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL DEFAULT '',
  auth TEXT NOT NULL DEFAULT '',
  device_label TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id, enabled);
