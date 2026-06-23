-- Schéma initial consolidé — édition Huawei (base D1 NEUVE).
-- Colonnes provider-neutres : server_id / snapshot_id / provider_job_id
-- (et non aws_instance_id / aws_snapshot_id). Voir ADR 0003.

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','formateur','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vm_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email          TEXT NOT NULL,
  name                TEXT,
  purpose             TEXT NOT NULL,
  preset              TEXT NOT NULL,
  storage             TEXT,
  os                  TEXT,
  region              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','provisioning','active','failed','terminated')),
  course              TEXT,
  course_ready_at     TEXT,
  group_id            TEXT,
  group_name          TEXT,
  snapshot_on_delete  INTEGER NOT NULL DEFAULT 0,
  restore_snapshot_id INTEGER,
  admin_note          TEXT,
  decided_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at          TEXT,
  start_date          TEXT,
  end_date            TEXT,
  expired_at          TEXT,
  ext_requested_end   TEXT,
  ext_requested_at    TEXT,
  schedule_enabled    INTEGER NOT NULL DEFAULT 0,
  schedule_start      TEXT,
  schedule_stop       TEXT,
  schedule_days       TEXT,
  schedule_paused     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_requests_user   ON vm_requests(user_email);
CREATE INDEX IF NOT EXISTS idx_requests_status ON vm_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_group  ON vm_requests(group_id);

CREATE TABLE IF NOT EXISTS vms (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      INTEGER NOT NULL,
  server_id       TEXT,          -- ECS server_id (résolu après le job de création)
  provider_job_id TEXT,          -- job de création asynchrone Huawei (réconciliateur)
  public_ip       TEXT,
  state           TEXT NOT NULL DEFAULT 'pending',
  ssh_key_name    TEXT,
  ssh_private_key TEXT,          -- chiffré AES-GCM
  ssh_user        TEXT,
  connect_method  TEXT NOT NULL DEFAULT 'ssh' CHECK (connect_method IN ('ssh','rdp')),
  admin_password  TEXT,          -- chiffré AES-GCM (Windows)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  terminated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_vms_request ON vms(request_id);
CREATE INDEX IF NOT EXISTS idx_vms_server  ON vms(server_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   INTEGER,
  user_email   TEXT NOT NULL,
  snapshot_id  TEXT,             -- EVS snapshot id
  description  TEXT,
  root_device  TEXT,
  architecture TEXT,
  size_gb      INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',
  os           TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_request ON snapshots(request_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user    ON snapshots(user_email);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  type       TEXT NOT NULL,
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_email);

CREATE TABLE IF NOT EXISTS request_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_request ON request_comments(request_id);
