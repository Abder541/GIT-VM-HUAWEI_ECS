import type { Env, SessionUser, VmRequestRow } from './types';

// Couche D1 (SQLite). Colonnes provider-neutres (server_id / snapshot_id /
// provider_job_id). Portée depuis l'édition AWS, adaptée au modèle de job ECS
// asynchrone (server_id renseigné par le réconciliateur via setServerId).

export function isAdmin(env: Env, email: string): boolean {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function upsertUser(env: Env, user: Omit<SessionUser, 'role'>): Promise<SessionUser> {
  const existing = await env.DB.prepare(`SELECT role FROM users WHERE email = ?1`)
    .bind(user.email)
    .first<{ role: string }>();
  const role: SessionUser['role'] =
    isAdmin(env, user.email) || existing?.role === 'admin'
      ? 'admin'
      : existing?.role === 'formateur'
        ? 'formateur'
        : 'member';
  await env.DB.prepare(
    `INSERT INTO users (email, name, role) VALUES (?1, ?2, ?3)
     ON CONFLICT(email) DO UPDATE SET name = ?2, role = ?3`
  )
    .bind(user.email, user.name, role)
    .run();
  return { ...user, role };
}

export async function listUsers(env: Env) {
  const res = await env.DB.prepare(
    `SELECT email, name, role, created_at FROM users ORDER BY role DESC, email`
  ).all();
  return res.results ?? [];
}

export async function setUserRole(env: Env, email: string, role: 'member' | 'formateur' | 'admin') {
  await env.DB.prepare(`UPDATE users SET role = ?2 WHERE email = ?1`).bind(email, role).run();
}

// ---- Notifications in-app -----------------------------------------------
export async function addNotification(env: Env, userEmail: string, type: string, link: string | null = null) {
  await env.DB.prepare(`INSERT INTO notifications (user_email, type, link) VALUES (?1, ?2, ?3)`)
    .bind(userEmail, type, link)
    .run();
}

export async function notifyAdminsInApp(env: Env, type: string, link: string | null = null) {
  const admins = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const a of admins) await addNotification(env, a, type, link);
}

export async function listNotifications(env: Env, userEmail: string, limit = 30) {
  const res = await env.DB.prepare(
    `SELECT id, type, link, read, created_at FROM notifications
      WHERE user_email = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2`
  )
    .bind(userEmail, limit)
    .all();
  return res.results ?? [];
}

export async function countUnreadNotifications(env: Env, userEmail: string): Promise<number> {
  const res = await env.DB.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_email = ?1 AND read = 0`)
    .bind(userEmail)
    .first<{ n: number }>();
  return res?.n ?? 0;
}

export async function markNotificationsRead(env: Env, userEmail: string) {
  await env.DB.prepare(`UPDATE notifications SET read = 1 WHERE user_email = ?1 AND read = 0`).bind(userEmail).run();
}

export async function metrics(env: Env) {
  const counts = await countByStatus(env);
  const succeeded = (counts.active ?? 0) + (counts.terminated ?? 0);
  const failed = counts.failed ?? 0;
  const successRate = succeeded + failed > 0 ? succeeded / (succeeded + failed) : 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const avg = await env.DB.prepare(
    `SELECT AVG((julianday(a2.created_at) - julianday(a1.created_at)) * 86400) AS s
       FROM audit_log a1 JOIN audit_log a2 ON a1.target = a2.target
      WHERE a1.action = 'request.approve' AND a2.action = 'vm.active'`
  ).first<{ s: number | null }>();
  return { total, successRate, failed, avgProvisionSeconds: Math.round(avg?.s ?? 0) };
}

export async function countAudit(env: Env, target: string, action: string): Promise<number> {
  const res = await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE target = ?1 AND action = ?2`)
    .bind(target, action)
    .first<{ n: number }>();
  return res?.n ?? 0;
}

export async function audit(env: Env, actor: string, action: string, target?: string, detail?: string) {
  await env.DB.prepare(`INSERT INTO audit_log (actor, action, target, detail) VALUES (?1, ?2, ?3, ?4)`)
    .bind(actor, action, target ?? null, detail ?? null)
    .run();
}

export async function createRequest(
  env: Env,
  email: string,
  purpose: string,
  perf: string,
  storage: string,
  os: string,
  region: string,
  startDate: string | null,
  endDate: string,
  course: string | null = null,
  groupId: string | null = null,
  groupName: string | null = null,
  restoreSnapshotId: number | null = null,
  name: string | null = null
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO vm_requests (user_email, purpose, preset, storage, os, region, start_date, end_date, course, group_id, group_name, restore_snapshot_id, name)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
  )
    .bind(email, purpose, perf, storage, os, region, startDate, endDate, course, groupId, groupName, restoreSnapshotId, name?.slice(0, 60) ?? null)
    .run();
  return res.meta.last_row_id as number;
}

// ---- Groupes ------------------------------------------------------------
export interface GroupVm {
  id: number;
  status: string;
  expired_at: string | null;
  server_id: string | null;
  ssh_key_name: string | null;
  state: string | null;
}

export async function listGroupRequests(env: Env, groupId: string): Promise<VmRequestRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM vm_requests WHERE group_id = ?1 ORDER BY id`).bind(groupId).all<VmRequestRow>();
  return res.results ?? [];
}

export async function listGroupVms(env: Env, owner: string, groupId: string): Promise<GroupVm[]> {
  const res = await env.DB.prepare(
    `SELECT r.id, r.status, r.expired_at, v.server_id, v.ssh_key_name, v.state
       FROM vm_requests r LEFT JOIN vms v ON v.request_id = r.id
      WHERE r.group_id = ?1 AND r.user_email = ?2`
  )
    .bind(groupId, owner)
    .all<GroupVm>();
  return res.results ?? [];
}

export async function assignGroup(env: Env, owner: string, ids: number[], groupId: string, groupName: string) {
  if (!ids.length) return;
  const ph = ids.map((_, i) => `?${i + 4}`).join(',');
  await env.DB.prepare(
    `UPDATE vm_requests SET group_id = ?1, group_name = ?2 WHERE user_email = ?3 AND id IN (${ph})`
  )
    .bind(groupId, groupName, owner, ...ids)
    .run();
}

export async function renameGroup(env: Env, owner: string, groupId: string, name: string) {
  await env.DB.prepare(`UPDATE vm_requests SET group_name = ?3 WHERE group_id = ?1 AND user_email = ?2`)
    .bind(groupId, owner, name)
    .run();
}

export async function clearGroup(env: Env, owner: string, groupId: string) {
  await env.DB.prepare(`UPDATE vm_requests SET group_id = NULL, group_name = NULL WHERE group_id = ?1 AND user_email = ?2`)
    .bind(groupId, owner)
    .run();
}

// ---- Snapshots ----------------------------------------------------------
export interface SnapshotRow {
  id: number;
  request_id: number | null;
  user_email: string;
  snapshot_id: string | null;
  description: string | null;
  root_device: string | null;
  architecture: string | null;
  size_gb: number | null;
  status: string;
  os: string | null;
  created_at: string;
  completed_at: string | null;
  backup_volume_id: string | null; // sauvegarde « disque conservé » (Option A) ; null = snapshot EVS
}

// Enregistre une SAUVEGARDE (disque EVS conservé à la suppression). Prête immédiatement
// (le disque existe déjà) → status 'completed'. backup_volume_id non nul la distingue d'un snapshot.
export async function createBackupRow(
  env: Env, requestId: number, owner: string, volumeId: string, sizeGb: number | null, os: string | null, description: string
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO snapshots (request_id, user_email, backup_volume_id, description, size_gb, status, os, completed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'completed', ?6, datetime('now'))`
  )
    .bind(requestId, owner, volumeId, description.slice(0, 255), sizeGb ?? null, os ?? null)
    .run();
}

export async function createSnapshotRow(
  env: Env,
  requestId: number,
  owner: string,
  snapshotId: string,
  description: string,
  rootDevice: string | null,
  architecture: string | null,
  os: string | null = null
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO snapshots (request_id, user_email, snapshot_id, description, root_device, architecture, os)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(requestId, owner, snapshotId, description.slice(0, 255), rootDevice, architecture, os)
    .run();
  return res.meta.last_row_id as number;
}

export async function listSnapshotsForRequest(env: Env, requestId: number): Promise<SnapshotRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM snapshots WHERE request_id = ?1 ORDER BY created_at DESC`).bind(requestId).all<SnapshotRow>();
  return res.results ?? [];
}

export async function listSnapshotsForUser(env: Env, owner: string): Promise<SnapshotRow[]> {
  const res = await env.DB.prepare(`SELECT * FROM snapshots WHERE user_email = ?1 ORDER BY created_at DESC LIMIT 100`).bind(owner).all<SnapshotRow>();
  return res.results ?? [];
}

// Tous les snapshots (vue admin) + nom de la VM d'origine.
export async function listAllSnapshots(env: Env, limit = 200): Promise<(SnapshotRow & { vm_name: string | null })[]> {
  const res = await env.DB.prepare(
    `SELECT s.*, r.name AS vm_name
       FROM snapshots s LEFT JOIN vm_requests r ON r.id = s.request_id
      ORDER BY s.created_at DESC LIMIT ?1`
  )
    .bind(limit)
    .all<SnapshotRow & { vm_name: string | null }>();
  return res.results ?? [];
}

export async function getSnapshot(env: Env, id: number, owner: string): Promise<SnapshotRow | null> {
  return await env.DB.prepare(`SELECT * FROM snapshots WHERE id = ?1 AND user_email = ?2`).bind(id, owner).first<SnapshotRow>();
}

// Snapshot par id sans contrôle de propriétaire (vue admin).
export async function getAnySnapshot(env: Env, id: number): Promise<SnapshotRow | null> {
  return await env.DB.prepare(`SELECT * FROM snapshots WHERE id = ?1`).bind(id).first<SnapshotRow>();
}

export async function updateSnapshotStatus(env: Env, snapshotId: string, status: string, sizeGb?: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE snapshots SET status = ?2, size_gb = COALESCE(?3, size_gb),
            completed_at = CASE WHEN ?2 = 'completed' THEN datetime('now') ELSE completed_at END
       WHERE snapshot_id = ?1`
  )
    .bind(snapshotId, status, sizeGb ?? null)
    .run();
}

export async function listPendingSnapshots(env: Env): Promise<{ id: number; snapshot_id: string }[]> {
  const res = await env.DB.prepare(`SELECT id, snapshot_id FROM snapshots WHERE status = 'pending' AND snapshot_id IS NOT NULL`).all<{ id: number; snapshot_id: string }>();
  return res.results ?? [];
}

export async function setSnapshotOnDelete(env: Env, owner: string, id: number, enabled: boolean): Promise<void> {
  await env.DB.prepare(`UPDATE vm_requests SET snapshot_on_delete = ?3 WHERE id = ?1 AND user_email = ?2`).bind(id, owner, enabled ? 1 : 0).run();
}

export async function deleteSnapshotRow(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM snapshots WHERE id = ?1`).bind(id).run();
}

export async function deleteSnapshotRowsForRequest(env: Env, requestId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM snapshots WHERE request_id = ?1`).bind(requestId).run();
}

export async function deleteRequest(env: Env, owner: string, id: number): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT status, expired_at FROM vm_requests WHERE id = ?1 AND user_email = ?2`)
    .bind(id, owner)
    .first<{ status: string; expired_at: string | null }>();
  if (!r) return false;
  const terminal = r.status === 'terminated' || r.status === 'rejected' || r.status === 'failed' || !!r.expired_at;
  if (!terminal) return false;
  await env.DB.prepare(`DELETE FROM vms WHERE request_id = ?1`).bind(id).run();
  await env.DB.prepare(`DELETE FROM vm_requests WHERE id = ?1`).bind(id).run();
  return true;
}

export async function countRecentRequests(env: Env, email: string, minutes: number): Promise<number> {
  const res = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM vm_requests WHERE user_email = ?1 AND created_at >= datetime('now', ?2)`
  )
    .bind(email, `-${minutes} minutes`)
    .first<{ n: number }>();
  return res?.n ?? 0;
}

export async function listRequestsForUser(env: Env, email: string): Promise<VmRequestRow[]> {
  const res = await env.DB.prepare(
    `SELECT r.*, v.public_ip AS public_ip, v.ssh_key_name AS ssh_key_name,
            v.state AS vm_state, v.connect_method AS connect_method
       FROM vm_requests r
       LEFT JOIN vms v ON v.request_id = r.id
      WHERE r.user_email = ?1
      ORDER BY r.created_at DESC`
  )
    .bind(email)
    .all<VmRequestRow>();
  return res.results ?? [];
}

export async function listRequestsByStatus(env: Env, status?: string): Promise<VmRequestRow[]> {
  const eff = `(CASE WHEN r.expired_at IS NOT NULL THEN 'expired' ELSE r.status END)`;
  const cols = `r.*, v.public_ip AS public_ip, v.ssh_key_name AS ssh_key_name,
                v.ssh_user AS ssh_user, v.server_id AS server_id,
                v.state AS vm_state, v.connect_method AS connect_method`;
  const stmt = status
    ? env.DB.prepare(
        `SELECT ${cols} FROM vm_requests r LEFT JOIN vms v ON v.request_id = r.id
          WHERE ${eff} = ?1 ORDER BY r.created_at DESC`
      ).bind(status)
    : env.DB.prepare(
        `SELECT ${cols} FROM vm_requests r LEFT JOIN vms v ON v.request_id = r.id
          ORDER BY r.created_at DESC`
      );
  const res = await stmt.all<VmRequestRow>();
  return res.results ?? [];
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
}

export async function listAudit(env: Env, limit = 100, action?: string): Promise<AuditEntry[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const stmt = action
    ? env.DB.prepare(
        `SELECT id, actor, action, target, detail, created_at FROM audit_log
          WHERE action = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2`
      ).bind(action, lim)
    : env.DB.prepare(
        `SELECT id, actor, action, target, detail, created_at FROM audit_log
          ORDER BY created_at DESC, id DESC LIMIT ?1`
      ).bind(lim);
  const res = await stmt.all<AuditEntry>();
  return res.results ?? [];
}

export async function getRequest(env: Env, id: number): Promise<VmRequestRow | null> {
  return await env.DB.prepare(`SELECT * FROM vm_requests WHERE id = ?1`).bind(id).first<VmRequestRow>();
}

export async function setRequestStatus(
  env: Env,
  id: number,
  status: string,
  decidedBy?: string,
  note?: string
) {
  await env.DB.prepare(
    `UPDATE vm_requests
       SET status = ?2,
           decided_by = COALESCE(?3, decided_by),
           admin_note = COALESCE(?4, admin_note),
           decided_at = CASE WHEN ?3 IS NOT NULL THEN datetime('now') ELSE decided_at END
     WHERE id = ?1`
  )
    .bind(id, status, decidedBy ?? null, note ?? null)
    .run();
}

export interface RequestDetail extends VmRequestRow {
  server_id?: string | null;
  vm_state?: string | null;
  has_key?: number;
  connect_method?: string | null;
  has_password?: number;
}

export async function getRequestDetail(env: Env, id: number): Promise<RequestDetail | null> {
  return await env.DB.prepare(
    `SELECT r.*, v.public_ip AS public_ip, v.ssh_key_name AS ssh_key_name,
            v.ssh_user AS ssh_user, v.server_id AS server_id, v.state AS vm_state,
            v.connect_method AS connect_method,
            (v.ssh_private_key IS NOT NULL) AS has_key,
            (v.admin_password IS NOT NULL) AS has_password
       FROM vm_requests r
       LEFT JOIN vms v ON v.request_id = r.id
      WHERE r.id = ?1`
  )
    .bind(id)
    .first<RequestDetail>();
}

export async function getPasswordForRequest(
  env: Env,
  requestId: number
): Promise<{ user_email: string; admin_password: string | null; ssh_user: string | null } | null> {
  return await env.DB.prepare(
    `SELECT r.user_email, v.admin_password, v.ssh_user
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.id = ?1`
  )
    .bind(requestId)
    .first();
}

// ---- Agrégats monitoring (Grafana) -------------------------------------
export async function requestsPerDay(env: Env, days = 30) {
  const res = await env.DB.prepare(
    `SELECT date(created_at) AS day, COUNT(*) AS count FROM vm_requests
      WHERE created_at >= datetime('now', ?1) GROUP BY day ORDER BY day`
  )
    .bind(`-${days} days`)
    .all();
  return res.results ?? [];
}

export async function countByOs(env: Env) {
  const res = await env.DB.prepare(
    `SELECT COALESCE(os, '?') AS os, COUNT(*) AS count FROM vm_requests GROUP BY os ORDER BY count DESC`
  ).all();
  return res.results ?? [];
}

export async function countByUser(env: Env) {
  const res = await env.DB.prepare(
    `SELECT user_email, COUNT(*) AS count FROM vm_requests GROUP BY user_email ORDER BY count DESC`
  ).all();
  return res.results ?? [];
}

export async function listActiveForCost(env: Env): Promise<{ preset: string; storage: string | null }[]> {
  const res = await env.DB.prepare(
    `SELECT preset, storage FROM vm_requests WHERE status = 'active' AND expired_at IS NULL`
  ).all<{ preset: string; storage: string | null }>();
  return res.results ?? [];
}

// Actions d'audit ON/OFF utilisées pour reconstituer les heures réelles (cf. src/cost.ts).
const COST_EVENT_ACTIONS = [
  'vm.active', 'vm.schedule.start', 'vm.start',
  'vm.stop', 'vm.schedule.stop', 'vm.scheduled_stop', 'vm.idle_stop',
  'vm.terminate', 'vm.expired.terminated', 'vm.drift.terminated',
];

// SQLite CURRENT_TIMESTAMP = 'YYYY-MM-DD HH:MM:SS' en UTC → epoch ms.
function sqliteToMs(s: string): number {
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return Date.parse(iso.endsWith('Z') ? iso : iso + 'Z');
}

// VMs (métadonnées) + events d'allumage (target `req:<id>`), pour le rapport de coût.
export async function listCostData(env: Env): Promise<{
  vms: {
    id: number; user_email: string; name: string | null; preset: string; storage: string | null;
    status: string; endDate: number | null; expiredAt: number | null;
  }[];
  events: { req: number; action: string; at: number }[];
}> {
  const vmsRes = await env.DB.prepare(
    `SELECT id, user_email, name, preset, storage, status, end_date, expired_at FROM vm_requests`
  ).all<{
    id: number; user_email: string; name: string | null; preset: string; storage: string | null;
    status: string; end_date: string | null; expired_at: string | null;
  }>();
  const vms = (vmsRes.results ?? []).map((r) => ({
    id: r.id, user_email: r.user_email, name: r.name, preset: r.preset, storage: r.storage, status: r.status,
    endDate: r.end_date ? sqliteToMs(r.end_date) : null,
    expiredAt: r.expired_at ? sqliteToMs(r.expired_at) : null,
  }));

  const ph = COST_EVENT_ACTIONS.map((_, i) => `?${i + 1}`).join(',');
  const evRes = await env.DB.prepare(
    `SELECT target, action, created_at FROM audit_log
      WHERE action IN (${ph}) AND target LIKE 'req:%'
      ORDER BY created_at ASC`
  )
    .bind(...COST_EVENT_ACTIONS)
    .all<{ target: string; action: string; created_at: string }>();

  const events = (evRes.results ?? [])
    .map((e) => ({ req: Number(e.target.slice(4)), action: e.action, at: sqliteToMs(e.created_at) }))
    .filter((e) => Number.isFinite(e.req) && Number.isFinite(e.at));

  return { vms, events };
}

export async function countByStatus(env: Env): Promise<Record<string, number>> {
  const res = await env.DB.prepare(
    `SELECT CASE WHEN expired_at IS NOT NULL THEN 'expired' ELSE status END AS status,
            COUNT(*) AS n
       FROM vm_requests GROUP BY 1`
  ).all<{ status: string; n: number }>();
  const out: Record<string, number> = {};
  for (const row of res.results ?? []) out[row.status] = row.n;
  return out;
}

// Crée la ligne VM. Côté Huawei la création est ASYNCHRONE : on stocke le
// provider_job_id et server_id reste NULL jusqu'à résolution par le réconciliateur.
export async function createVm(
  env: Env,
  requestId: number,
  jobId: string,
  keyName: string,
  encryptedPrivateKey: string,
  sshUser: string,
  connectMethod: 'ssh' | 'rdp' = 'ssh',
  encryptedAdminPassword: string | null = null,
  restoreStep: string | null = null
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO vms (request_id, provider_job_id, state, ssh_key_name, ssh_private_key, ssh_user, connect_method, admin_password, restore_step)
     VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(requestId, jobId, keyName, encryptedPrivateKey, sshUser, connectMethod, encryptedAdminPassword, restoreStep)
    .run();
}

// Renseigne le server_id une fois le job de création résolu (réconciliateur).
export async function setServerId(env: Env, requestId: number, serverId: string): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET server_id = ?2 WHERE request_id = ?1`).bind(requestId, serverId).run();
}

// ===== LEGACY / DEPRECATED — restore IMS (restoreTo*) + rollback EVS (startRollback/…) =====
// Remplacé par CBR (cf. docs/design-cbr-restore.md). Helpers d'état INACTIFS : `restore_step` et
// `rollback_step` ne sont jamais positionnés par un flux actif (entrées gated RESTORE_ENABLED=false).
// Conservés comme legacy ; NE PAS réutiliser ; à retirer/remplacer quand CBR sera implémenté.
// ---- Restauration : transitions du pré-vol (pilotées par le réconciliateur) ----
// Volume prêt → étape image (provider_job_id = job de création d'image).
export async function restoreToImage(env: Env, requestId: number, volumeId: string, imageJobId: string): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET restore_step = 'image', restore_volume_id = ?2, provider_job_id = ?3 WHERE request_id = ?1`)
    .bind(requestId, volumeId, imageJobId).run();
}
// Image prête → étape launch (volume libéré ; provider_job_id = job de lancement).
export async function restoreToLaunch(env: Env, requestId: number, imageId: string, launchJobId: string): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET restore_step = 'launch', restore_image_id = ?2, restore_volume_id = NULL, provider_job_id = ?3 WHERE request_id = ?1`)
    .bind(requestId, imageId, launchJobId).run();
}
// Fin ou échec de restauration → efface l'état de restauration.
export async function clearRestore(env: Env, requestId: number): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET restore_step = NULL, restore_volume_id = NULL, restore_image_id = NULL WHERE request_id = ?1`)
    .bind(requestId).run();
}

// --- Rollback EN PLACE (restauration d'une VM vers un snapshot EVS) ---
export async function startRollback(env: Env, requestId: number, snapshotId: string, volumeId: string): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET rollback_step = 'stopping', rollback_snapshot_id = ?2, rollback_volume_id = ?3 WHERE request_id = ?1`)
    .bind(requestId, snapshotId, volumeId).run();
}
export async function setRollbackStep(env: Env, requestId: number, step: string): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET rollback_step = ?2 WHERE request_id = ?1`).bind(requestId, step).run();
}
export async function clearRollback(env: Env, requestId: number): Promise<void> {
  await env.DB.prepare(`UPDATE vms SET rollback_step = NULL, rollback_snapshot_id = NULL, rollback_volume_id = NULL WHERE request_id = ?1`)
    .bind(requestId).run();
}

export async function getKeyForRequest(
  env: Env,
  requestId: number
): Promise<{ user_email: string; ssh_key_name: string; ssh_private_key: string } | null> {
  return await env.DB.prepare(
    `SELECT r.user_email, v.ssh_key_name, v.ssh_private_key
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.id = ?1`
  )
    .bind(requestId)
    .first();
}

export async function updateVm(env: Env, requestId: number, state: string, publicIp?: string) {
  await env.DB.prepare(
    `UPDATE vms SET state = ?2, public_ip = COALESCE(?3, public_ip) WHERE request_id = ?1`
  )
    .bind(requestId, state, publicIp ?? null)
    .run();
}

export async function getVmByRequest(env: Env, requestId: number) {
  return await env.DB.prepare(`SELECT * FROM vms WHERE request_id = ?1`).bind(requestId).first();
}

export async function deleteVm(env: Env, requestId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM vms WHERE request_id = ?1`).bind(requestId).run();
}

export async function clearCourseReady(env: Env, requestId: number): Promise<void> {
  await env.DB.prepare(`UPDATE vm_requests SET course_ready_at = NULL WHERE id = ?1`).bind(requestId).run();
}

export interface ActiveVm {
  id: number;
  status: string;
  user_email: string;
  server_id: string | null;
  provider_job_id: string | null;
  ssh_user: string | null;
  ssh_key_name: string | null;
  state: string | null;
  connect_method: string | null;
  schedule_enabled: number;
  // restauration (NULL pour les VM normales)
  restore_step: string | null;
  restore_volume_id: string | null;
  restore_image_id: string | null;
  // rollback EN PLACE (NULL pour les VM normales)
  rollback_step: string | null;
  rollback_snapshot_id: string | null;
  rollback_volume_id: string | null;
}

// Demandes ayant (ou en cours d'obtention d') une VM — pour reconcile / scheduled stop.
export async function listActiveVms(env: Env): Promise<ActiveVm[]> {
  const res = await env.DB.prepare(
    `SELECT r.id, r.status, r.user_email, v.server_id, v.provider_job_id, v.ssh_user, v.ssh_key_name, v.state, v.connect_method,
            r.schedule_enabled, v.restore_step, v.restore_volume_id, v.restore_image_id,
            v.rollback_step, v.rollback_snapshot_id, v.rollback_volume_id
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.status IN ('provisioning', 'active')`
  ).all<ActiveVm>();
  return res.results ?? [];
}

// VMs en cours de suppression différée (snapshot-à-la-suppression) — finalisées par le réconciliateur.
export async function listTerminating(env: Env): Promise<{ id: number; user_email: string; server_id: string | null; ssh_key_name: string | null }[]> {
  const res = await env.DB.prepare(
    `SELECT r.id, r.user_email, v.server_id, v.ssh_key_name
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.status = 'terminating'`
  ).all<{ id: number; user_email: string; server_id: string | null; ssh_key_name: string | null }>();
  return res.results ?? [];
}

// État + âge (ms) du dernier snapshot d'une demande (pour décider de finaliser la suppression).
export async function latestSnapshotForRequest(env: Env, requestId: number): Promise<{ status: string; atMs: number } | null> {
  const r = await env.DB.prepare(
    `SELECT status, created_at FROM snapshots WHERE request_id = ?1 ORDER BY created_at DESC LIMIT 1`
  ).bind(requestId).first<{ status: string; created_at: string }>();
  return r ? { status: r.status, atMs: sqliteToMs(r.created_at) } : null;
}

export interface IdleVm { id: number; user_email: string; server_id: string | null; }
export async function listRunningVmsForIdle(env: Env): Promise<IdleVm[]> {
  // L'idle-stop RESPECTE le planning : on exclut les VM à planning actif (schedule_enabled=1),
  // sinon l'idle-stop arrêterait une VM que applySchedules doit garder allumée → oscillation +
  // notifs parasites. (Amélioration vs la réf. AWS, qui ne les excluait pas.)
  const res = await env.DB.prepare(
    `SELECT r.id, r.user_email, v.server_id
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.status = 'active' AND r.expired_at IS NULL AND r.schedule_enabled = 0
        AND v.state = 'running' AND v.server_id IS NOT NULL`
  ).all<IdleVm>();
  return res.results ?? [];
}

export interface ScheduledVm {
  id: number;
  user_email: string;
  server_id: string | null;
  state: string | null;
  schedule_start: string | null;
  schedule_stop: string | null;
  schedule_days: string | null;
}

export async function listScheduledVms(env: Env): Promise<ScheduledVm[]> {
  const res = await env.DB.prepare(
    `SELECT r.id, r.user_email, v.server_id, v.state,
            r.schedule_start, r.schedule_stop, r.schedule_days
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.status = 'active' AND r.expired_at IS NULL AND r.schedule_enabled = 1
        AND r.schedule_paused = 0 AND v.server_id IS NOT NULL`
  ).all<ScheduledVm>();
  return res.results ?? [];
}

export async function setSchedule(
  env: Env,
  id: number,
  enabled: boolean,
  start: string | null,
  stop: string | null,
  days: string | null
): Promise<void> {
  await env.DB.prepare(
    `UPDATE vm_requests
        SET schedule_enabled = ?2, schedule_start = ?3, schedule_stop = ?4, schedule_days = ?5,
            schedule_paused = 0
      WHERE id = ?1`
  )
    .bind(id, enabled ? 1 : 0, start, stop, days)
    .run();
}

export async function setSchedulePaused(env: Env, id: number, paused: boolean): Promise<void> {
  await env.DB.prepare(`UPDATE vm_requests SET schedule_paused = ?2 WHERE id = ?1`)
    .bind(id, paused ? 1 : 0)
    .run();
}

export interface ExpirableVm {
  id: number;
  user_email: string;
  end_date: string;
  server_id: string | null;
  state: string | null;
  ssh_key_name: string | null;
  snapshot_on_delete: number;
}

export async function listExpired(env: Env): Promise<ExpirableVm[]> {
  const res = await env.DB.prepare(
    `SELECT r.id, r.user_email, r.end_date, v.server_id, v.state, v.ssh_key_name, r.snapshot_on_delete
       FROM vm_requests r JOIN vms v ON v.request_id = r.id
      WHERE r.status = 'active' AND r.expired_at IS NULL AND r.end_date IS NOT NULL
        AND datetime(r.end_date) <= datetime('now')`
  ).all<ExpirableVm>();
  return res.results ?? [];
}

export async function listExpiringSoon(
  env: Env
): Promise<{ id: number; user_email: string; end_date: string }[]> {
  const res = await env.DB.prepare(
    `SELECT r.id, r.user_email, r.end_date
       FROM vm_requests r
      WHERE r.status = 'active' AND r.expired_at IS NULL AND r.end_date IS NOT NULL
        AND datetime(r.end_date) > datetime('now')
        AND datetime(r.end_date) <= datetime('now', '+24 hours')`
  ).all<{ id: number; user_email: string; end_date: string }>();
  return res.results ?? [];
}

export async function markExpired(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`UPDATE vm_requests SET expired_at = datetime('now') WHERE id = ?1`)
    .bind(id)
    .run();
}

export async function setCourseReady(env: Env, id: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE vm_requests SET course_ready_at = datetime('now') WHERE id = ?1 AND course_ready_at IS NULL`
  )
    .bind(id)
    .run();
}

// ---- Prolongations (l'utilisateur demande, l'admin approuve) ------------
export async function requestExtension(env: Env, id: number, until: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE vm_requests SET ext_requested_end = ?2, ext_requested_at = datetime('now') WHERE id = ?1`
  )
    .bind(id, until)
    .run();
}

export async function approveExtension(env: Env, id: number): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT ext_requested_end FROM vm_requests WHERE id = ?1`)
    .bind(id)
    .first<{ ext_requested_end: string | null }>();
  if (!row?.ext_requested_end) return null;
  await env.DB.prepare(
    `UPDATE vm_requests SET end_date = ext_requested_end, ext_requested_end = NULL, ext_requested_at = NULL WHERE id = ?1`
  )
    .bind(id)
    .run();
  return row.ext_requested_end;
}

export async function rejectExtension(env: Env, id: number): Promise<void> {
  await env.DB.prepare(`UPDATE vm_requests SET ext_requested_end = NULL, ext_requested_at = NULL WHERE id = ?1`)
    .bind(id)
    .run();
}
