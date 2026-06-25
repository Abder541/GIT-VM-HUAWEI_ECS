-- 0004 — Autoriser le statut 'terminating' (suppression différée : snapshot puis destruction).
-- SQLite ne permet pas d'altérer un CHECK existant → rebuild de la table. Sûr ici :
-- aucune clé étrangère ne référence vm_requests (cf. 0001). Schéma copié verbatim de 0001
-- avec 'terminating' ajouté à la liste autorisée.

ALTER TABLE vm_requests RENAME TO vm_requests_old;

CREATE TABLE vm_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email          TEXT NOT NULL,
  name                TEXT,
  purpose             TEXT NOT NULL,
  preset              TEXT NOT NULL,
  storage             TEXT,
  os                  TEXT,
  region              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','provisioning','active','failed','terminating','terminated')),
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

INSERT INTO vm_requests SELECT * FROM vm_requests_old;
DROP TABLE vm_requests_old;

CREATE INDEX IF NOT EXISTS idx_requests_user   ON vm_requests(user_email);
CREATE INDEX IF NOT EXISTS idx_requests_status ON vm_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_group  ON vm_requests(group_id);
