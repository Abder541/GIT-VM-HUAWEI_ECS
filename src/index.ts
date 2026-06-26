import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionUser } from './types';
import { signToken, verifyToken, randomToken, encryptSecret, decryptSecret, courseCallbackToken } from './crypto';
import { authorizeUrl, exchangeCode, userFromIdToken } from './oidc';
import {
  PERF,
  STORAGE,
  OS,
  COURSES,
  isValidPerf,
  isValidStorage,
  isValidOs,
  isValidCourse,
  buildCourseUserData,
  buildWindowsCourseInstall,
  estimateMonthlyEur,
  STORAGE_EUR_GB_MONTH,
} from './presets';
import { reportError } from './sentry';
import { assembleVms, computeCostReport } from './cost';
import {
  upsertUser,
  audit,
  countAudit,
  createRequest,
  countRecentRequests,
  listRequestsForUser,
  listRequestsByStatus,
  getRequest,
  getRequestDetail,
  countByStatus,
  requestsPerDay,
  countByOs,
  countByUser,
  listActiveForCost,
  listCostData,
  listAllSnapshots,
  getAnySnapshot,
  createBackupRow,
  setRequestStatus,
  createVm,
  setServerId,
  restoreToImage,
  restoreToLaunch,
  clearRestore,
  startRollback,
  setRollbackStep,
  clearRollback,
  updateVm,
  deleteVm,
  clearCourseReady,
  getVmByRequest,
  getKeyForRequest,
  getPasswordForRequest,
  listActiveVms,
  listRunningVmsForIdle,
  listScheduledVms,
  setSchedule,
  setSchedulePaused,
  listExpired,
  listExpiringSoon,
  markExpired,
  listTerminating,
  latestSnapshotForRequest,
  requestExtension,
  approveExtension,
  rejectExtension,
  listGroupVms,
  listGroupRequests,
  assignGroup,
  renameGroup,
  clearGroup,
  deleteRequest,
  createSnapshotRow,
  listSnapshotsForRequest,
  listSnapshotsForUser,
  getSnapshot,
  updateSnapshotStatus,
  listPendingSnapshots,
  setSnapshotOnDelete,
  deleteSnapshotRow,
  deleteSnapshotRowsForRequest,
  listUsers,
  setUserRole,
  setCourseReady,
  addNotification,
  notifyAdminsInApp,
  listNotifications,
  countUnreadNotifications,
  markNotificationsRead,
  listAudit,
  metrics,
} from './db';
import { huawei } from './huawei';

// Adaptateurs : conservent la signature `(env, …)` en déléguant au CloudProvider
// Huawei, pour que les sites d'appel des routes restent inchangés. createKeyPair /
// launchInstance / listManaged sont utilisés directement (provisionRequest / reconcile).
const describeInstance = (env: Env, serverId: string) => huawei(env).describeInstance(serverId);
const terminateInstance = (env: Env, serverId: string, keepVolume?: boolean) => huawei(env).terminateInstance(serverId, keepVolume);
const deleteKeyPair = (env: Env, keyName: string) => huawei(env).deleteKeyPair(keyName);
const startInstance = (env: Env, serverId: string) => huawei(env).startInstance(serverId);
const stopInstance = (env: Env, serverId: string) => huawei(env).stopInstance(serverId);
const rebootInstance = (env: Env, serverId: string) => huawei(env).rebootInstance(serverId);
const describeRootVolume = (env: Env, serverId: string) => huawei(env).describeRootVolume(serverId);

// Restore = LEGACY / DEPRECATED (remplacé par CBR — cf. docs/design-cbr-restore.md).
// GATÉ au niveau du compte (real-name auth requise). Ce flag UNIQUE désactive TOUS les flux actifs
// de restore (provisionRequest `isRestore` + route rollback). Les pipelines IMS (new-VM) et rollback
// EVS (en place) restent DORMANTS/legacy, inactifs. Repasser à true UNIQUEMENT après bascule CBR.
const RESTORE_ENABLED = false;
const createSnapshot = (env: Env, volumeId: string, description: string) => huawei(env).createSnapshot(volumeId, description);
const describeSnapshot = (env: Env, snapshotId: string) => huawei(env).describeSnapshot(snapshotId);
const deleteSnapshot = (env: Env, snapshotId: string) => huawei(env).deleteSnapshot(snapshotId);
const deleteVolume = (env: Env, volumeId: string) => huawei(env).deleteVolume(volumeId);
const maxCpuOverWindow = (env: Env, serverId: string, minutes: number) => huawei(env).maxCpuOverWindow(serverId, minutes);

// Clé de chiffrement au repos (clés SSH / mots de passe) — séparée de SESSION_SECRET.
const dataKey = (env: Env) => env.DATA_ENCRYPTION_KEY || env.SESSION_SECRET;
import {
  notifyAdminsNewRequest,
  notifyUserApproved,
  notifyUserRejected,
  notifyUserReady,
  notifyUserExpiring,
  notifyUserExpired,
  notifyAdminsExtension,
  notifyUserExtensionApproved,
  notifyUserExtensionRejected,
} from './email';
import { zurichNow, shouldRunSchedule } from './schedule';

type Vars = { Variables: { user: SessionUser }; Bindings: Env };

const SESSION_TTL = 8 * 60 * 60;
const OIDC_TTL = 10 * 60;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const app = new Hono<Vars>();

// Security headers on every response (clone so headers from ASSETS/redirects are mutable).
app.use('*', async (c, next) => {
  await next();
  c.res = new Response(c.res.body, c.res);
  const h = c.res.headers;
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  h.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
      "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
});

function redirectUri(c: { req: { url: string } }): string {
  return new URL(c.req.url).origin + '/auth/callback';
}
async function loadUser(c: any): Promise<SessionUser | null> {
  return await verifyToken<SessionUser>(c.env.SESSION_SECRET, getCookie(c, 'sess'));
}

const apiAuth = async (c: any, next: any) => {
  const user = await loadUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
};
const apiAdmin = async (c: any, next: any) => {
  const user = await loadUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  c.set('user', user);
  await next();
};
// Trainer (formateur) or admin — for the group-request feature.
const apiTrainer = async (c: any, next: any) => {
  const user = await loadUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'formateur' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  c.set('user', user);
  await next();
};

// Strong random password for Windows (RDP). Guarantees one of each class and
// avoids characters that are awkward to quote in PowerShell / RDP clients.
function generateWindowsPassword(length = 18): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#_-+='];
  const all = sets.join('');
  const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = sets.map((s) => s[rand(s.length)]); // one from each class
  while (chars.length < length) chars.push(all[rand(all.length)]);
  // Fisher–Yates shuffle so the guaranteed chars aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// In-VM hardening (defense-in-depth). The strong, un-bypassable layer is the
// Security Group egress allowlist (scripts/aws-harden-sg.mjs) — a sudo/admin user
// can undo in-VM rules but not the network SG.
function linuxHardeningBody(): string {
  return [
    '# --- GIT VM Portal hardening ---',
    '# Filtered DNS (Cloudflare for Families: blocks adult + malware content)',
    'mkdir -p /etc/systemd/resolved.conf.d 2>/dev/null || true',
    "printf '[Resolve]\\nDNS=1.1.1.3 1.0.0.3\\nDomains=~.\\n' >/etc/systemd/resolved.conf.d/gitvm.conf 2>/dev/null || true",
    'systemctl restart systemd-resolved 2>/dev/null || true',
    'rm -f /etc/resolv.conf 2>/dev/null || true',
    "printf 'nameserver 1.1.1.3\\nnameserver 1.0.0.3\\n' >/etc/resolv.conf 2>/dev/null || true",
    'chattr +i /etc/resolv.conf 2>/dev/null || true',
    '# Block P2P / torrent ports (network SG enforces the default-deny egress)',
    'if command -v iptables >/dev/null 2>&1; then',
    '  iptables -A OUTPUT -p tcp -m multiport --dports 6881:6889,6969,51413 -j REJECT 2>/dev/null || true',
    '  iptables -A OUTPUT -p udp -m multiport --dports 6881:6889,6969,51413,1337 -j REJECT 2>/dev/null || true',
    'fi',
    '# Lock the hostname (prevent rename)',
    'chattr -i /etc/hostname 2>/dev/null || true',
    'hostname >/etc/hostname 2>/dev/null || true',
    'chattr +i /etc/hostname 2>/dev/null || true',
    '# --- end hardening ---',
  ].join('\n');
}
function windowsHardeningLines(): string[] {
  return [
    "try { $a=(Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 1).Name; Set-DnsClientServerAddress -InterfaceAlias $a -ServerAddresses ('1.1.1.3','1.0.0.3') } catch {}",
    "try { New-NetFirewallRule -DisplayName 'gitvm-block-torrent-tcp' -Direction Outbound -Action Block -Protocol TCP -RemotePort 6881-6889,6969,51413 } catch {}",
    "try { New-NetFirewallRule -DisplayName 'gitvm-block-torrent-udp' -Direction Outbound -Action Block -Protocol UDP -RemotePort 6881-6889,6969,51413,1337 } catch {}",
  ];
}

// Create the SSH key + ECS instance for a request. Shared by approve + retry.
// Windows VMs additionally get an Administrator password set via UserData and
// stored encrypted (no SSH; the user connects over RDP).
async function provisionRequest(env: Env, req: any): Promise<string> {
  const perf = PERF[req.preset];
  const os = OS[req.os ?? ''];
  const storage = STORAGE[req.storage ?? ''];
  if (!perf || !os || !storage) throw new Error('invalid preset composition');

  const c = huawei(env);
  const isWindows = os.connect === 'rdp';
  const isRestore = RESTORE_ENABLED && !!req.restore_snapshot_id;
  const hardeningOn = env.HARDENING !== 'false';
  let userData: string | undefined;
  let encPassword: string | null = null;
  if (isWindows) {
    const password = generateWindowsPassword();
    // Exécuté au premier boot ; quote simple pour que le mot de passe soit littéral.
    const lines = [`net user Administrator '${password}'`];
    if (hardeningOn && !isRestore) lines.push(...windowsHardeningLines());
    if (!isRestore) {
      const win = buildWindowsCourseInstall(req.course);
      if (win) {
        lines.push(win);
        const token = await courseCallbackToken(env.SESSION_SECRET, req.id);
        lines.push(`try { Invoke-WebRequest -UseBasicParsing -Method POST -Uri "${env.APP_URL}/api/internal/course-done?req=${req.id}&token=${encodeURIComponent(token)}" } catch {}`);
      }
    }
    userData = `<powershell>\n${lines.join('\n')}\n</powershell>\n<persist>false</persist>`;
    encPassword = await encryptSecret(dataKey(env), password);
  } else if (!isRestore) {
    // Linux : durcissement (DNS filtré + blocage P2P + hostname verrouillé) + outils de cours.
    const hard = hardeningOn ? linuxHardeningBody() : '';
    const base = buildCourseUserData(req.course); // script #!/bin/bash complet, ou ''
    if (base) {
      const token = await courseCallbackToken(env.SESSION_SECRET, req.id);
      const cb = `curl -fsS -X POST "${env.APP_URL}/api/internal/course-done?req=${req.id}&token=${encodeURIComponent(token)}" || true`;
      userData = `${base.replace(/^(#![^\n]*\n)/, `$1${hard ? hard + '\n' : ''}`)}${cb}\n`;
    } else if (hard) {
      userData = `#!/bin/bash\nset +e\n${hard}\n`;
    }
  }

  // Restauration : flux ASYNC (volume → image → launch) piloté par le réconciliateur.
  // On crée le VOLUME depuis le snapshot, on stocke la VM en étape 'volume', puis on REND
  // la main (le réconciliateur enchaîne image → launch). Le flux VM normal ci-dessous est inchangé.
  if (isRestore) {
    const az = env.HUAWEI_AZ;
    if (!az) throw new Error('Restauration indisponible : variable HUAWEI_AZ requise (AZ du volume)');
    const snap = await getSnapshot(env, req.restore_snapshot_id, req.user_email);
    if (!snap?.snapshot_id || snap.status !== 'completed') throw new Error('snapshot not ready for restore');
    const kpR = await c.createKeyPair(req.id, isWindows ? 'rsa' : 'ed25519');
    const encKeyR = await encryptSecret(dataKey(env), kpR.privateKey);
    const volJob = await c.createVolumeFromSnapshot(snap.snapshot_id, az);
    await createVm(env, req.id, volJob, kpR.keyName, encKeyR, os.sshUser, os.connect, encPassword, 'volume');
    return volJob;
  }
  const imageId = os.image;
  const sizeGb = storage.sizeGb;

  const kp = await c.createKeyPair(req.id, isWindows ? 'rsa' : 'ed25519');
  const encKey = await encryptSecret(dataKey(env), kp.privateKey);
  // Création ECS asynchrone → job_id (server_id résolu par le réconciliateur).
  const { jobId } = await c.launchInstance({
    requestId: req.id,
    keyName: kp.keyName,
    flavor: perf.flavor,
    imageId,
    sizeGb,
    volumetype: storage.volumetype,
    userData,
    nameTag: req.name ? `${req.name}.${req.user_email.split('@')[0]}` : null,
  });
  if (!jobId) throw new Error('ECS launch: job_id manquant');
  await createVm(env, req.id, jobId, kp.keyName, encKey, os.sshUser, os.connect, encPassword);
  return jobId;
}

// Sauvegarde à la suppression (Option A) : conserve le DISQUE racine (un snapshot EVS mourrait
// avec le disque). Détruit le serveur en GARDANT le volume, puis l'enregistre comme sauvegarde
// restaurable. Retourne true si la sauvegarde est faite (serveur déjà détruit), false sinon
// (pas de volume identifiable → l'appelant fait une suppression normale).
async function keepVolumeBackup(env: Env, requestId: number, owner: string, serverId: string): Promise<boolean> {
  try {
    const rv = await describeRootVolume(env, serverId);
    if (!rv.volumeId) return false;
    await terminateInstance(env, serverId, true); // détruit le serveur, CONSERVE le disque
    const r = await getRequest(env, requestId);
    await createBackupRow(env, requestId, owner, rv.volumeId, rv.sizeGb ?? null, r?.os ?? null, `backup req-${requestId} ${new Date().toISOString().slice(0, 16)}`);
    await audit(env, 'system', 'vm.backup.kept', `req:${requestId}`, rv.volumeId);
    return true;
  } catch (e: any) {
    await audit(env, 'system', 'vm.backup.error', `req:${requestId}`, e.message);
    return false;
  }
}

// ---- OIDC (browser redirects) ------------------------------------------
app.get('/auth/login', async (c) => {
  const state = randomToken();
  const nonce = randomToken();
  const oidc = await signToken(c.env.SESSION_SECRET, { state, nonce }, OIDC_TTL);
  setCookie(c, 'oidc', oidc, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: OIDC_TTL });
  return c.redirect(authorizeUrl(c.env, redirectUri(c), state, nonce));
});

app.get('/auth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const err = c.req.query('error_description');
  if (err) return c.text(`Login error: ${err}`, 400);
  if (!code || !state) return c.text('Missing code/state', 400);
  const oidc = await verifyToken<{ state: string; nonce: string }>(c.env.SESSION_SECRET, getCookie(c, 'oidc'));
  if (!oidc || oidc.state !== state) return c.text('Invalid state', 400);
  deleteCookie(c, 'oidc', { path: '/' });
  try {
    const idToken = await exchangeCode(c.env, code, redirectUri(c));
    const base = userFromIdToken(c.env, idToken, oidc.nonce);
    const user = await upsertUser(c.env, base);
    const sess = await signToken(c.env.SESSION_SECRET, user, SESSION_TTL);
    setCookie(c, 'sess', sess, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL });
    await audit(c.env, user.email, 'auth.login');
    return c.redirect('/');
  } catch (e: any) {
    return c.text(`Auth failed: ${e.message}`, 403);
  }
});

app.post('/auth/logout', async (c) => {
  deleteCookie(c, 'sess', { path: '/' });
  return c.body(null, 204);
});

// ---- API ----------------------------------------------------------------
app.get('/healthz', (c) => c.json({ ok: true }));

app.get('/api/me', async (c) => {
  const user = await loadUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ user });
});

app.get('/api/notifications', apiAuth, async (c) => {
  const u = c.get('user');
  return c.json({
    notifications: await listNotifications(c.env, u.email),
    unread: await countUnreadNotifications(c.env, u.email),
  });
});

app.post('/api/notifications/read', apiAuth, async (c) => {
  await markNotificationsRead(c.env, c.get('user').email);
  return c.json({ ok: true });
});

app.get('/api/presets', (c) =>
  c.json({
    perf: Object.values(PERF),
    storage: Object.values(STORAGE),
    os: Object.values(OS),
    courses: Object.values(COURSES).map(({ id, label, description, tools }) => ({ id, label, description, tools })),
    storageUsdGbMonth: STORAGE_EUR_GB_MONTH,
    region: c.env.HUAWEI_REGION,
    grafanaUrl: c.env.GRAFANA_URL ?? '',
  })
);

app.get('/api/requests', apiAuth, async (c) => {
  const rows = await listRequestsForUser(c.env, c.get('user').email);
  return c.json({ requests: rows });
});

// Batch creation: 1–4 individually-configured VMs, optionally in a named group.
// Voie UNIQUE de création (le SPA passe toujours par batch, même pour 1 VM).
app.post('/api/requests/batch', apiAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const vms = Array.isArray(body.vms) ? body.vms : [];
  if (vms.length < 1 || vms.length > 4) return c.json({ error: 'invalid_count' }, 400);
  const now = Date.now();
  const parsed: { name: string; perf: string; storage: string; os: string; purpose: string; course: string; start: string | null; end: string; restoreSnapshotId: number | null }[] = [];
  for (const v of vms) {
    const perf = String(v.perf ?? ''), storage = String(v.storage ?? ''), os = String(v.os ?? '');
    const purpose = String(v.purpose ?? '').trim(), course = String(v.course ?? '');
    const name = String(v.name ?? '').trim().slice(0, 60);
    if (!isValidPerf(perf) || !isValidStorage(storage) || !isValidOs(os) || !isValidCourse(course) || !purpose || !name) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    if (OS[os].minStorageGb && STORAGE[storage].sizeGb < OS[os].minStorageGb!) return c.json({ error: 'storage_too_small' }, 400);
    const end = v.endDate ? new Date(String(v.endDate)) : null;
    const start = v.startDate ? new Date(String(v.startDate)) : null;
    if (!end || isNaN(end.getTime()) || end.getTime() <= now) return c.json({ error: 'invalid_end_date' }, 400);
    if (start && (isNaN(start.getTime()) || start.getTime() >= end.getTime())) return c.json({ error: 'invalid_start_date' }, 400);
    const restoreSnapshotId = v.snapshotId && Number.isInteger(Number(v.snapshotId)) ? Number(v.snapshotId) : null;
    parsed.push({ name, perf, storage, os, purpose, course, start: start ? start.toISOString() : null, end: end.toISOString(), restoreSnapshotId });
  }
  if ((await countRecentRequests(c.env, user.email, 60)) + parsed.length > 10) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': '3600' });
  }
  // Multi-VM batches are always grouped (fallback name if the client omitted one).
  const groupNameRaw = body.group && String(body.group.name ?? '').trim() ? String(body.group.name).trim().slice(0, 80) : null;
  const groupName = groupNameRaw ?? (parsed.length > 1 ? 'Groupe' : null);
  const groupId = groupName ? randomToken(8) : null;
  const ids: number[] = [];
  for (const p of parsed) {
    const id = await createRequest(
      c.env, user.email, p.purpose, p.perf, p.storage, p.os, c.env.HUAWEI_REGION, p.start, p.end, p.course || null, groupId, groupName, p.restoreSnapshotId, p.name
    );
    ids.push(id);
    await audit(c.env, user.email, 'request.create', `req:${id}`, `${p.perf}/${p.storage}/${p.os}${groupId ? ` grp:${groupId}` : ''}`);
  }
  await notifyAdminsInApp(c.env, 'request_new', groupId ? '/admin' : `/requests/${ids[0]}`);
  c.executionCtx.waitUntil(notifyAdminsNewRequest(c.env, ids[0], user.email, `${parsed.length} VM`));
  return c.json({ ids, groupId, groupName }, 201);
});

// Delete a request from the user's list (terminal states only).
app.delete('/api/requests/:id', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  // Capture snapshots before the row is gone, then cascade-delete them (Huawei + DB).
  const snaps = await listSnapshotsForRequest(c.env, id);
  const ok = await deleteRequest(c.env, user.email, id);
  if (!ok) return c.json({ error: 'not_deletable' }, 409);
  for (const s of snaps) if (s.snapshot_id) await deleteSnapshot(c.env, s.snapshot_id).catch(() => {});
  await deleteSnapshotRowsForRequest(c.env, id);
  await audit(c.env, user.email, 'request.delete', `req:${id}`, snaps.length ? `+${snaps.length} snap` : '');
  return c.json({ ok: true });
});

// ---- Groups -------------------------------------------------------------
app.post('/api/groups', apiAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? '').trim().slice(0, 80);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((n: number) => Number.isInteger(n)) : [];
  if (!name || !ids.length) return c.json({ error: 'invalid' }, 400);
  const groupId = randomToken(8);
  await assignGroup(c.env, user.email, ids, groupId, name);
  await audit(c.env, user.email, 'group.create', `grp:${groupId}`, `${ids.length} vm`);
  return c.json({ ok: true, groupId, groupName: name });
});

app.post('/api/groups/:groupId/rename', apiAuth, async (c) => {
  const user = c.get('user');
  const name = String((await c.req.json().catch(() => ({}))).name ?? '').trim().slice(0, 80);
  if (!name) return c.json({ error: 'empty' }, 400);
  await renameGroup(c.env, user.email, c.req.param('groupId'), name);
  return c.json({ ok: true });
});

app.post('/api/groups/:groupId/dissolve', apiAuth, async (c) => {
  await clearGroup(c.env, c.get('user').email, c.req.param('groupId'));
  return c.json({ ok: true });
});

// Schedule all owned VMs in a group at once.
app.post('/api/groups/:groupId/schedule', apiAuth, async (c) => {
  const user = c.get('user');
  const groupId = c.req.param('groupId');
  const vms = await listGroupVms(c.env, user.email, groupId);
  if (!vms.length) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const enabled = !!body.enabled;
  if (enabled) {
    const start = String(body.start ?? ''), stop = String(body.stop ?? '');
    const days = Array.isArray(body.days)
      ? [...new Set(body.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7))]
      : [];
    if (!HHMM.test(start) || !HHMM.test(stop) || start === stop || !days.length) return c.json({ error: 'invalid_schedule' }, 400);
    const csv = (days as number[]).sort((a, b) => a - b).join(',');
    for (const vm of vms) await setSchedule(c.env, vm.id, true, start, stop, csv);
  } else {
    for (const vm of vms) await setSchedule(c.env, vm.id, false, null, null, null);
  }
  await audit(c.env, user.email, 'group.schedule', `grp:${groupId}`, enabled ? 'on' : 'off');
  return c.json({ ok: true });
});

// Request an extension for all active VMs in a group.
app.post('/api/groups/:groupId/extend', apiAuth, async (c) => {
  const user = c.get('user');
  const groupId = c.req.param('groupId');
  const until = (await c.req.json().catch(() => ({}))).until;
  const u = until ? new Date(String(until)) : null;
  if (!u || isNaN(u.getTime()) || u.getTime() <= Date.now()) return c.json({ error: 'invalid_date' }, 400);
  const active = (await listGroupVms(c.env, user.email, groupId)).filter((v) => v.status === 'active' && !v.expired_at);
  if (!active.length) return c.json({ error: 'none_extendable' }, 409);
  for (const v of active) await requestExtension(c.env, v.id, u.toISOString());
  await notifyAdminsInApp(c.env, 'ext_request', '/admin');
  c.executionCtx.waitUntil(notifyAdminsExtension(c.env, active[0].id, user.email, u.toISOString()));
  await audit(c.env, user.email, 'group.extend', `grp:${groupId}`, u.toISOString());
  return c.json({ ok: true });
});

// Bulk action on all owned VMs in a group.
app.post('/api/groups/:groupId/action', apiAuth, async (c) => {
  const user = c.get('user');
  const groupId = c.req.param('groupId');
  const action = String((await c.req.json().catch(() => ({}))).action ?? '');
  if (!['start', 'stop', 'reboot', 'terminate'].includes(action)) return c.json({ error: 'invalid_action' }, 400);
  const vms = await listGroupVms(c.env, user.email, groupId);
  if (!vms.length) return c.json({ error: 'not_found' }, 404);
  let affected = 0;
  for (const vm of vms) {
    if (!vm.server_id) continue;
    try {
      if (action === 'start') {
        if (vm.expired_at) continue;
        await startInstance(c.env, vm.server_id);
        await updateVm(c.env, vm.id, 'pending');
        await audit(c.env, user.email, 'vm.start', `req:${vm.id}`, `grp:${groupId}`);
      } else if (action === 'stop') {
        await stopInstance(c.env, vm.server_id);
        await updateVm(c.env, vm.id, 'stopping');
        await audit(c.env, user.email, 'vm.stop', `req:${vm.id}`, `grp:${groupId}`);
      } else if (action === 'reboot') {
        await rebootInstance(c.env, vm.server_id);
      } else if (action === 'terminate') {
        await terminateInstance(c.env, vm.server_id);
        if (vm.ssh_key_name) await deleteKeyPair(c.env, vm.ssh_key_name);
        await updateVm(c.env, vm.id, 'terminated');
        await setRequestStatus(c.env, vm.id, 'terminated');
        await audit(c.env, user.email, 'vm.terminate', `req:${vm.id}`, vm.server_id ?? `grp:${groupId}`);
      }
      affected++;
    } catch {
      /* skip one, continue the group */
    }
  }
  await audit(c.env, user.email, `group.${action}`, `grp:${groupId}`, `${affected}/${vms.length}`);
  return c.json({ ok: true, affected });
});

app.get('/api/requests/:id', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequestDetail(c.env, id);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  return c.json({ request: r });
});

app.get('/api/requests/:id/key', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await getKeyForRequest(c.env, id);
  if (!row || !row.ssh_private_key) return c.json({ error: 'no_key' }, 404);
  if (row.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const pem = await decryptSecret(dataKey(c.env), row.ssh_private_key);
  await audit(c.env, user.email, 'key.download', `req:${id}`);
  return new Response(pem, {
    headers: {
      'Content-Type': 'application/x-pem-file',
      'Content-Disposition': `attachment; filename="${row.ssh_key_name}.pem"`,
    },
  });
});

// Windows RDP password — revealed only to the owner or an admin (audited).
app.get('/api/requests/:id/password', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await getPasswordForRequest(c.env, id);
  if (!row || !row.admin_password) return c.json({ error: 'no_password' }, 404);
  if (row.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const password = await decryptSecret(dataKey(c.env), row.admin_password);
  await audit(c.env, user.email, 'password.reveal', `req:${id}`);
  return c.json({ user: row.ssh_user ?? 'Administrator', password });
});

app.post('/api/requests/:id/terminate', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequest(c.env, id);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  const vm: any = await getVmByRequest(c.env, id);
  try {
    // Snapshot-à-la-suppression : on DIFFÈRE la destruction Huawei. Sinon le disque source
    // est supprimé avant la fin du snapshot → snapshot bloqué « pending » à vie. On crée le
    // snapshot, on passe en 'terminating', et le réconciliateur finalise une fois le snapshot prêt.
    // Sauvegarde à la suppression = on GARDE le disque (Option A), restaurable ensuite.
    if (r.snapshot_on_delete && vm?.server_id) {
      const kept = await keepVolumeBackup(c.env, id, r.user_email, vm.server_id);
      if (kept) {
        if (vm?.ssh_key_name) await deleteKeyPair(c.env, vm.ssh_key_name);
        await updateVm(c.env, id, 'terminated');
        await setRequestStatus(c.env, id, 'terminated');
        await audit(c.env, user.email, 'vm.terminate', `req:${id}`, `${vm.server_id} +backup`);
        return c.json({ ok: true });
      }
      // pas de volume identifiable → suppression normale ci-dessous
    }
    if (vm?.server_id) await terminateInstance(c.env, vm.server_id);
    if (vm?.ssh_key_name) await deleteKeyPair(c.env, vm.ssh_key_name);
    if (vm) await updateVm(c.env, id, 'terminated');
    await setRequestStatus(c.env, id, 'terminated');
    await audit(c.env, user.email, 'vm.terminate', `req:${id}`, vm?.server_id ?? '');
    return c.json({ ok: true });
  } catch (e: any) {
    await audit(c.env, user.email, 'vm.terminate.failed', `req:${id}`, e.message);
    return c.json({ error: e.message }, 500);
  }
});

async function authorizeVm(c: any, id: number): Promise<{ r: any; vm: any } | null> {
  const user = c.get('user');
  const r = await getRequest(c.env, id);
  if (!r) return null;
  if (r.user_email !== user.email && user.role !== 'admin') return null;
  const vm: any = await getVmByRequest(c.env, id);
  return { r, vm };
}

app.post('/api/requests/:id/start', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (!ctx.vm?.server_id) return c.json({ error: 'no_instance' }, 400);
  // An expired VM cannot be restarted by the user (needs an extension / re-approval).
  if (ctx.r.expired_at) return c.json({ error: 'expired' }, 409);
  try {
    await startInstance(c.env, ctx.vm.server_id);
    await updateVm(c.env, id, 'pending');
    // Manual start resumes the schedule.
    if (ctx.r.schedule_enabled) await setSchedulePaused(c.env, id, false);
    await audit(c.env, c.get('user').email, 'vm.start', `req:${id}`);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/requests/:id/stop', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (!ctx.vm?.server_id) return c.json({ error: 'no_instance' }, 400);
  try {
    await stopInstance(c.env, ctx.vm.server_id);
    await updateVm(c.env, id, 'stopping');
    // Manual stop pauses the schedule so it doesn't auto-restart the VM.
    if (ctx.r.schedule_enabled) await setSchedulePaused(c.env, id, true);
    await audit(c.env, c.get('user').email, 'vm.stop', `req:${id}`);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post('/api/requests/:id/reboot', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (!ctx.vm?.server_id) return c.json({ error: 'no_instance' }, 400);
  try {
    await rebootInstance(c.env, ctx.vm.server_id);
    await audit(c.env, c.get('user').email, 'vm.reboot', `req:${id}`);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Request an extension of the VM lifetime (owner/admin). Must be done BEFORE
// the end date (expiry deletes the VM). An admin then approves/rejects.
app.post('/api/requests/:id/extend', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequest(c.env, id);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  if (r.status !== 'active' || r.expired_at) return c.json({ error: 'not_extendable' }, 409);
  const body = await c.req.json().catch(() => ({}));
  const until = body.until ? new Date(String(body.until)) : null;
  const currentEnd = r.end_date ? new Date(r.end_date) : null;
  if (!until || isNaN(until.getTime()) || until.getTime() <= Date.now()) return c.json({ error: 'invalid_date' }, 400);
  if (currentEnd && until.getTime() <= currentEnd.getTime()) return c.json({ error: 'must_be_later' }, 400);
  await requestExtension(c.env, id, until.toISOString());
  await audit(c.env, user.email, 'extension.request', `req:${id}`, until.toISOString());
  await notifyAdminsInApp(c.env, 'ext_request', `/requests/${id}`);
  c.executionCtx.waitUntil(notifyAdminsExtension(c.env, id, r.user_email, until.toISOString()));
  return c.json({ ok: true });
});

// Configure the per-VM auto start/stop schedule (owner/admin). Times are 'HH:MM'
// local Europe/Zurich; days are ISO weekdays (1=Mon..7=Sun). Enforced by the cron.
app.post('/api/requests/:id/schedule', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequest(c.env, id);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const enabled = !!body.enabled;
  if (enabled) {
    const start = String(body.start ?? '');
    const stop = String(body.stop ?? '');
    const days = Array.isArray(body.days)
      ? [...new Set(body.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7))]
      : [];
    if (!HHMM.test(start) || !HHMM.test(stop) || start === stop || days.length === 0) {
      return c.json({ error: 'invalid_schedule' }, 400);
    }
    await setSchedule(c.env, id, true, start, stop, (days as number[]).sort((a, b) => a - b).join(','));
    await audit(c.env, user.email, 'schedule.set', `req:${id}`, `${start}-${stop} d:${days.join('')}`);
  } else {
    await setSchedule(c.env, id, false, null, null, null);
    await audit(c.env, user.email, 'schedule.off', `req:${id}`);
  }
  return c.json({ ok: true });
});

// Resume a paused schedule (clears the manual-stop pause). The reconciler will
// then start the VM at the next start boundary.
app.post('/api/requests/:id/schedule/resume', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequest(c.env, id);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await setSchedulePaused(c.env, id, false);
  await audit(c.env, user.email, 'schedule.resume', `req:${id}`);
  return c.json({ ok: true });
});

// Full reset: destroy the instance + key and re-provision a fresh one (same config).
// No admin approval. DESTRUCTIVE — wipes all data on the VM.
app.post('/api/requests/:id/reset', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (ctx.r.status !== 'active' || ctx.r.expired_at) return c.json({ error: 'not_resettable' }, 409);
  try {
    if (ctx.vm?.server_id) await terminateInstance(c.env, ctx.vm.server_id);
    if (ctx.vm?.ssh_key_name) await deleteKeyPair(c.env, ctx.vm.ssh_key_name);
    await deleteVm(c.env, id);
    await clearCourseReady(c.env, id);
    await setRequestStatus(c.env, id, 'provisioning');
    const instanceId = await provisionRequest(c.env, ctx.r);
    await audit(c.env, c.get('user').email, 'vm.reset', `req:${id}`, instanceId);
    return c.json({ ok: true });
  } catch (e: any) {
    await setRequestStatus(c.env, id, 'failed', undefined, `reset: ${e.message}`);
    await audit(c.env, c.get('user').email, 'vm.reset.failed', `req:${id}`, e.message);
    return c.json({ error: e.message }, 500);
  }
});

// ---- Snapshots (EVS) ----------------------------------------------------
app.post('/api/requests/:id/snapshot', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (!ctx.vm?.server_id) return c.json({ error: 'no_instance' }, 400);
  try {
    const rv = await describeRootVolume(c.env, ctx.vm.server_id);
    if (!rv.volumeId) return c.json({ error: 'no_volume' }, 400);
    const desc = `req-${id} ${new Date().toISOString().slice(0, 16)}`;
    const snapId = await createSnapshot(c.env, rv.volumeId, desc);
    const rowId = await createSnapshotRow(c.env, id, c.get('user').email, snapId, desc, rv.rootDevice ?? null, rv.architecture ?? null, ctx.r.os ?? null);
    await audit(c.env, c.get('user').email, 'snapshot.create', `req:${id}`, snapId);
    return c.json({ ok: true, id: rowId, awsSnapshotId: snapId });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/requests/:id/snapshots', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  return c.json({ snapshots: await listSnapshotsForRequest(c.env, id) });
});

app.get('/api/snapshots', apiAuth, async (c) => {
  return c.json({ snapshots: await listSnapshotsForUser(c.env, c.get('user').email) });
});

app.post('/api/requests/:id/snapshot-on-delete', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequest(c.env, id);
  if (!r) return c.json({ error: 'not_found' }, 404);
  if (r.user_email !== user.email && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const enabled = !!(await c.req.json().catch(() => ({}))).enabled;
  await setSnapshotOnDelete(c.env, r.user_email, id, enabled);
  await audit(c.env, user.email, 'snapshot.auto.toggle', `req:${id}`, enabled ? 'on' : 'off');
  return c.json({ ok: true });
});

// Delete one snapshot (Huawei EVS snapshot + DB row).
app.delete('/api/requests/:id/snapshots/:sid', apiAuth, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const sid = Number(c.req.param('sid'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  const snap = await getSnapshot(c.env, sid, ctx.r.user_email);
  if (!snap) return c.json({ error: 'not_found' }, 404);
  if (snap.snapshot_id) await deleteSnapshot(c.env, snap.snapshot_id).catch(() => {});
  await deleteSnapshotRow(c.env, sid);
  await audit(c.env, user.email, 'snapshot.delete', `snap:${sid}`, snap.snapshot_id ?? '');
  return c.json({ ok: true });
});

// Restauration EN PLACE : rollback de la VM vers un snapshot EVS (destructif).
// Piloté ensuite par le réconciliateur (stopping → rollingback → starting).
app.post('/api/requests/:id/snapshots/:sid/rollback', apiAuth, async (c) => {
  if (!RESTORE_ENABLED) return c.json({ error: 'restore_gated' }, 403); // garde : restore gated (cf. RESTORE_ENABLED)
  const user = c.get('user');
  const id = Number(c.req.param('id')), sid = Number(c.req.param('sid'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (!ctx.vm?.server_id) return c.json({ error: 'no_instance' }, 400);
  if (ctx.r.expired_at) return c.json({ error: 'expired' }, 409);
  if (ctx.vm.rollback_step) return c.json({ error: 'rollback_in_progress' }, 409);
  const snap = await getSnapshot(c.env, sid, ctx.r.user_email);
  if (!snap || snap.request_id !== id) return c.json({ error: 'not_found' }, 404);
  if (snap.status !== 'completed' || !snap.snapshot_id) return c.json({ error: 'snapshot_not_ready' }, 409);
  try {
    const rv = await describeRootVolume(c.env, ctx.vm.server_id);
    if (!rv.volumeId) return c.json({ error: 'no_volume' }, 400);
    await stopInstance(c.env, ctx.vm.server_id);
    await updateVm(c.env, id, 'stopping');
    if (ctx.r.schedule_enabled) await setSchedulePaused(c.env, id, true);
    await startRollback(c.env, id, snap.snapshot_id, rv.volumeId);
    await audit(c.env, user.email, 'vm.rollback', `req:${id}`, snap.snapshot_id);
    return c.json({ ok: true });
  } catch (e: any) { return c.json({ error: e.message }, 500); }
});

// Live Huawei state (state + public IP + uptime) — used by the detail page.
app.get('/api/requests/:id/live', apiAuth, async (c) => {
  const id = Number(c.req.param('id'));
  const ctx = await authorizeVm(c, id);
  if (!ctx) return c.json({ error: 'not_found' }, 404);
  if (!ctx.vm?.server_id) return c.json({ state: 'none' });
  try {
    const s = await describeInstance(c.env, ctx.vm.server_id);
    await updateVm(c.env, id, s.state, s.publicIp);
    return c.json({ state: s.state, publicIp: s.publicIp ?? null, launchTime: s.launchTime ?? null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Course-install callback: the VM's cloud-init posts here (token-gated, no session)
// once the course tools finished installing.
app.post('/api/internal/course-done', async (c) => {
  const id = Number(c.req.query('req'));
  const token = c.req.query('token') ?? '';
  if (!id || !token) return c.json({ error: 'bad_request' }, 400);
  const expected = await courseCallbackToken(c.env.SESSION_SECRET, id);
  if (token !== expected) return c.json({ error: 'forbidden' }, 403);
  await setCourseReady(c.env, id);
  await audit(c.env, 'system', 'course.ready', `req:${id}`);
  return c.json({ ok: true });
});

// ---- Admin API ----------------------------------------------------------
app.get('/api/admin/requests', apiAdmin, async (c) => {
  const status = c.req.query('status');
  const rows = await listRequestsByStatus(c.env, status || undefined);
  return c.json({ requests: rows });
});

app.get('/api/admin/stats', apiAdmin, async (c) => {
  return c.json({ stats: await countByStatus(c.env) });
});

app.get('/api/admin/metrics', apiAdmin, async (c) => {
  return c.json({ metrics: await metrics(c.env) });
});

// Rapport de coût « heures réelles » (Modèle B) : compute facturé sur les périodes
// d'allumage reconstituées depuis l'audit, stockage sur la durée de vie. Cf. src/cost.ts.
app.get('/api/admin/cost', apiAdmin, async (c) => {
  const { vms, events } = await listCostData(c.env);
  return c.json(computeCostReport(assembleVms(vms, events), Date.now()));
});

// Tous les snapshots (vue admin globale).
app.get('/api/admin/snapshots', apiAdmin, async (c) => {
  return c.json({ snapshots: await listAllSnapshots(c.env) });
});

// Supprimer un snapshot (admin) — EVS + ligne DB. Best-effort côté Huawei.
app.delete('/api/admin/snapshots/:sid', apiAdmin, async (c) => {
  const sid = Number(c.req.param('sid'));
  const snap = await getAnySnapshot(c.env, sid);
  if (!snap) return c.json({ error: 'not_found' }, 404);
  if (snap.backup_volume_id) await deleteVolume(c.env, snap.backup_volume_id).catch(() => {});
  else if (snap.snapshot_id) await deleteSnapshot(c.env, snap.snapshot_id).catch(() => {});
  await deleteSnapshotRow(c.env, sid);
  await audit(c.env, c.get('user').email, 'snapshot.delete', `snap:${sid}`, snap.backup_volume_id ?? snap.snapshot_id ?? '');
  return c.json({ ok: true });
});

app.get('/api/admin/users', apiAdmin, async (c) => {
  return c.json({ users: await listUsers(c.env) });
});

app.get('/api/admin/audit', apiAdmin, async (c) => {
  const limit = Number(c.req.query('limit') ?? '100');
  const action = c.req.query('action') || undefined;
  return c.json({ entries: await listAudit(c.env, isNaN(limit) ? 100 : limit, action) });
});

app.post('/api/admin/users/:email/role', apiAdmin, async (c) => {
  const admin = c.get('user');
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const role = body.role === 'admin' ? 'admin' : body.role === 'formateur' ? 'formateur' : 'member';
  await setUserRole(c.env, email, role);
  await audit(c.env, admin.email, 'user.role', email, role);
  return c.json({ ok: true });
});

// ---- Trainer (formateur) : group request — create N VMs assigned to platform users ----
app.get('/api/trainer/users', apiTrainer, async (c) => {
  const users = await listUsers(c.env);
  return c.json({ users: users.map((u: any) => ({ email: u.email, name: u.name })) });
});

app.post('/api/trainer/batch', apiTrainer, async (c) => {
  const trainer = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const perf = String(body.perf ?? ''), storage = String(body.storage ?? ''), os = String(body.os ?? '');
  const course = String(body.course ?? ''), baseName = String(body.baseName ?? '').trim().slice(0, 50);
  const purpose = String(body.purpose ?? '').trim();
  const groupName = String(body.groupName ?? '').trim().slice(0, 80);
  const count = Math.floor(Number(body.count));
  const emails: string[] = Array.isArray(body.userEmails)
    ? Array.from(new Set((body.userEmails as any[]).map((e) => String(e).trim().toLowerCase()).filter(Boolean) as string[]))
    : [];
  if (!isValidPerf(perf) || !isValidStorage(storage) || !isValidOs(os) || !isValidCourse(course)) return c.json({ error: 'invalid_request' }, 400);
  if (!baseName || !purpose || !groupName) return c.json({ error: 'invalid_request' }, 400);
  if (!Number.isInteger(count) || count < 1 || count > 30) return c.json({ error: 'invalid_count' }, 400);
  if (!emails.length || emails.length > count) return c.json({ error: 'invalid_users' }, 400);
  if (OS[os].minStorageGb && STORAGE[storage].sizeGb < OS[os].minStorageGb!) return c.json({ error: 'storage_too_small' }, 400);
  const end = body.endDate ? new Date(String(body.endDate)) : null;
  const start = body.startDate ? new Date(String(body.startDate)) : null;
  if (!end || isNaN(end.getTime()) || end.getTime() <= Date.now()) return c.json({ error: 'invalid_end_date' }, 400);
  if (start && (isNaN(start.getTime()) || start.getTime() >= end.getTime())) return c.json({ error: 'invalid_start_date' }, 400);
  // Only assign to known platform users.
  const known = new Set((await listUsers(c.env)).map((u: any) => String(u.email).toLowerCase()));
  for (const e of emails) if (!known.has(e)) return c.json({ error: 'unknown_user', email: e }, 400);

  const groupId = randomToken(8);
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const owner = emails[i % emails.length]; // round-robin distribution
    const name = `${baseName} ${i + 1}`;
    const id = await createRequest(
      c.env, owner, purpose, perf, storage, os, c.env.HUAWEI_REGION,
      start ? start.toISOString() : null, end.toISOString(), course || null, groupId, groupName, null, name
    );
    ids.push(id);
    await addNotification(c.env, owner, 'request_new', `/requests/${id}`);
  }
  await notifyAdminsInApp(c.env, 'request_new', '/admin');
  c.executionCtx.waitUntil(notifyAdminsNewRequest(c.env, ids[0], trainer.email, `${count} VM (formateur)`));
  await audit(c.env, trainer.email, 'trainer.batch', `grp:${groupId}`, `${count} vm / ${emails.length} users`);
  return c.json({ ok: true, ids, groupId, groupName }, 201);
});

app.get('/api/admin/requests.csv', apiAdmin, async (c) => {
  const rows = await listRequestsByStatus(c.env);
  const cols = ['id', 'user_email', 'preset', 'storage', 'os', 'region', 'status', 'start_date', 'end_date', 'expired_at', 'created_at', 'decided_by', 'decided_at'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r: any) => cols.map((k) => esc(r[k])).join(','))].join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="vm-requests.csv"',
    },
  });
});

app.post('/api/admin/requests/:id/approve', apiAdmin, async (c) => {
  const admin = c.get('user');
  const id = Number(c.req.param('id'));
  const req = await getRequest(c.env, id);
  if (!req || req.status !== 'pending') return c.json({ error: 'not_pending' }, 409);

  await setRequestStatus(c.env, id, 'provisioning', admin.email);
  await audit(c.env, admin.email, 'request.approve', `req:${id}`);
  try {
    const instanceId = await provisionRequest(c.env, req);
    await audit(c.env, admin.email, 'vm.launch', `req:${id}`, instanceId);
    await addNotification(c.env, req.user_email, 'approved', `/requests/${id}`);
    c.executionCtx.waitUntil(notifyUserApproved(c.env, req.user_email, id));
    return c.json({ ok: true, status: 'provisioning' });
  } catch (e: any) {
    await setRequestStatus(c.env, id, 'failed', undefined, `provisioning: ${e.message}`);
    await audit(c.env, 'system', 'vm.launch.failed', `req:${id}`, e.message);
    return c.json({ error: e.message }, 500);
  }
});

// Approve / reject ALL pending requests in a group at once.
app.post('/api/admin/groups/:groupId/approve', apiAdmin, async (c) => {
  const admin = c.get('user');
  const groupId = c.req.param('groupId');
  const reqs = (await listGroupRequests(c.env, groupId)).filter((r) => r.status === 'pending');
  if (!reqs.length) return c.json({ error: 'no_pending' }, 409);
  let approved = 0;
  for (const req of reqs) {
    await setRequestStatus(c.env, req.id, 'provisioning', admin.email);
    try {
      const iid = await provisionRequest(c.env, req);
      await audit(c.env, admin.email, 'vm.launch', `req:${req.id}`, iid);
      approved++;
    } catch (e: any) {
      await setRequestStatus(c.env, req.id, 'failed', undefined, `provisioning: ${e.message}`);
      await audit(c.env, 'system', 'vm.launch.failed', `req:${req.id}`, e.message);
    }
    await addNotification(c.env, req.user_email, 'approved', `/requests/${req.id}`);
  }
  c.executionCtx.waitUntil(notifyUserApproved(c.env, reqs[0].user_email, reqs[0].id));
  await audit(c.env, admin.email, 'group.approve', `grp:${groupId}`, `${approved}/${reqs.length}`);
  return c.json({ ok: true, approved });
});

app.post('/api/admin/groups/:groupId/reject', apiAdmin, async (c) => {
  const admin = c.get('user');
  const groupId = c.req.param('groupId');
  const note = String((await c.req.json().catch(() => ({}))).note ?? '').trim();
  const reqs = (await listGroupRequests(c.env, groupId)).filter((r) => r.status === 'pending');
  if (!reqs.length) return c.json({ error: 'no_pending' }, 409);
  for (const req of reqs) {
    await setRequestStatus(c.env, req.id, 'rejected', admin.email, note);
    await addNotification(c.env, req.user_email, 'rejected', `/requests/${req.id}`);
  }
  c.executionCtx.waitUntil(notifyUserRejected(c.env, reqs[0].user_email, reqs[0].id, note));
  await audit(c.env, admin.email, 'group.reject', `grp:${groupId}`, `${reqs.length}`);
  return c.json({ ok: true });
});

app.post('/api/admin/requests/:id/extend/approve', apiAdmin, async (c) => {
  const admin = c.get('user');
  const id = Number(c.req.param('id'));
  const until = await approveExtension(c.env, id);
  if (!until) return c.json({ error: 'no_request' }, 409);
  await audit(c.env, admin.email, 'extension.approve', `req:${id}`, until);
  const r = await getRequest(c.env, id);
  if (r) {
    await addNotification(c.env, r.user_email, 'ext_approved', `/requests/${id}`);
    c.executionCtx.waitUntil(notifyUserExtensionApproved(c.env, r.user_email, id, until));
  }
  return c.json({ ok: true });
});

app.post('/api/admin/requests/:id/extend/reject', apiAdmin, async (c) => {
  const admin = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await getRequest(c.env, id);
  if (!r || !r.ext_requested_end) return c.json({ error: 'no_request' }, 409);
  await rejectExtension(c.env, id);
  await audit(c.env, admin.email, 'extension.reject', `req:${id}`);
  await addNotification(c.env, r.user_email, 'ext_rejected', `/requests/${id}`);
  c.executionCtx.waitUntil(notifyUserExtensionRejected(c.env, r.user_email, id));
  return c.json({ ok: true });
});

app.post('/api/admin/requests/:id/reject', apiAdmin, async (c) => {
  const admin = c.get('user');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const note = String(body.note ?? '').trim();
  const req = await getRequest(c.env, id);
  if (!req || req.status !== 'pending') return c.json({ error: 'not_pending' }, 409);
  await setRequestStatus(c.env, id, 'rejected', admin.email, note);
  await audit(c.env, admin.email, 'request.reject', `req:${id}`, note);
  await addNotification(c.env, req.user_email, 'rejected', `/requests/${id}`);
  c.executionCtx.waitUntil(notifyUserRejected(c.env, req.user_email, id, note));
  return c.json({ ok: true });
});

// ---- Monitoring (Grafana Cloud via Infinity datasource) ----------------
// Token-gated, no session: Grafana sends `Authorization: Bearer <GRAFANA_TOKEN>`
// (or ?token=). Returns Infinity-friendly JSON arrays. 503 if the token is unset.
function monitoringOk(c: any): boolean {
  const token = c.env.GRAFANA_TOKEN;
  if (!token) return false;
  const provided = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '') || c.req.query('token') || '';
  return provided.length > 0 && provided === token;
}

app.get('/api/monitoring/:metric', async (c) => {
  if (!c.env.GRAFANA_TOKEN) return c.json({ error: 'not_configured' }, 503);
  if (!monitoringOk(c)) return c.json({ error: 'unauthorized' }, 401);
  const metric = c.req.param('metric');
  if (metric === 'summary') {
    const counts = await countByStatus(c.env);
    return c.json(Object.entries(counts).map(([status, count]) => ({ status, count })));
  }
  if (metric === 'daily') return c.json(await requestsPerDay(c.env));
  if (metric === 'os') return c.json(await countByOs(c.env));
  if (metric === 'users') return c.json(await countByUser(c.env));
  if (metric === 'audit') return c.json(await listAudit(c.env, 200));
  if (metric === 'metrics') {
    const m = await metrics(c.env);
    return c.json([
      { total: m.total, successRate: Math.round(m.successRate * 100), failed: m.failed, avgProvisionSeconds: m.avgProvisionSeconds },
    ]);
  }
  if (metric === 'cost') {
    const rows = await listActiveForCost(c.env);
    const monthlyEur = rows.reduce((s, r) => s + estimateMonthlyEur(r.preset, r.storage ?? ''), 0);
    return c.json([{ activeVms: rows.length, monthlyEur: Math.round(monthlyEur * 100) / 100 }]);
  }
  return c.json({ error: 'unknown_metric' }, 404);
});

// ---- Static assets (React SPA) -----------------------------------------
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// ---- Scheduled: reconcile state + scheduled stop ------------------------
// Reconcile DB against Huawei: promote provisioning->active, sync running/stopped
// state, and detect drift (instances terminated outside the portal).
// OS du snapshot → os_version IMS (pour la création d'image de restauration).
function imsOsVersion(osId: string | null | undefined): string {
  const fam = osId ? OS[osId]?.family : undefined;
  if (fam === 'ubuntu') return 'Ubuntu';
  if (fam === 'debian') return 'Debian';
  if (fam === 'windows') return 'Windows';
  return 'Other Linux(64 bit)';
}

async function reconcile(env: Env): Promise<void> {
  const c = huawei(env);
  let managed: Record<string, string>;
  try {
    managed = await c.listManaged();
  } catch {
    return; // cloud injoignable ce tick → ne rien changer (évite un faux drift global)
  }
  const rows = await listActiveVms(env);
  for (const row of rows) {
    try {
      // ---- Pré-vol RESTAURATION — LEGACY/DEPRECATED (IMS, remplacé par CBR) ----
      // INACTIF : restore_step n'est jamais positionné (entrée gated RESTORE_ENABLED=false). Dormant.
      if (row.restore_step === 'volume') {
        const volumeId = await c.resolveJob(row.provider_job_id!, 'evs');
        if (!volumeId) continue; // volume en cours de création
        const r = await getRequest(env, row.id);
        if (!r) throw new Error('restore: demande introuvable');
        const imgJob = await c.createImageFromVolume(`gitvm-restore-${row.id}`, volumeId, imsOsVersion(r.os));
        await restoreToImage(env, row.id, volumeId, imgJob);
        await audit(env, 'system', 'restore.volume.ready', `req:${row.id}`, volumeId);
        continue;
      }
      if (row.restore_step === 'image') {
        const imageId = await c.resolveJob(row.provider_job_id!, 'ims');
        if (!imageId) continue; // image en cours de création
        if (row.restore_volume_id) await c.deleteVolume(row.restore_volume_id); // anti-orphelin : volume devenu inutile
        const r = await getRequest(env, row.id);
        if (!r) throw new Error('restore: demande introuvable');
        const perf = PERF[r.preset];
        const storage = STORAGE[r.storage ?? ''];
        if (!perf || !storage) throw new Error('restore: preset/storage invalide');
        const h = await c.launchInstance({
          requestId: row.id,
          keyName: row.ssh_key_name ?? `vm-portal-req-${row.id}`,
          flavor: perf.flavor,
          imageId,
          sizeGb: storage.sizeGb,
          volumetype: storage.volumetype,
          nameTag: r.name ? `${r.name}.${r.user_email.split('@')[0]}` : null,
        });
        await restoreToLaunch(env, row.id, imageId, h.jobId ?? '');
        await audit(env, 'system', 'restore.image.ready', `req:${row.id}`, imageId);
        continue;
      }

      // ---- Pré-vol ROLLBACK EN PLACE — LEGACY/DEPRECATED (EVS, remplacé par CBR) ----
      // INACTIF : rollback_step n'est jamais positionné (route gated RESTORE_ENABLED=false). Dormant.
      // Machine à états : stopping → rollingback → starting, conduite par le réconciliateur.
      if (row.rollback_step) {
        const serverId = row.server_id;
        if (!serverId) { await clearRollback(env, row.id); continue; }
        if (row.rollback_step === 'stopping') {
          const s = await describeInstance(env, serverId);
          if (s.state === 'error') throw new Error('VM en erreur pendant l\'arrêt');
          if (s.state !== 'stopped') { if (s.state !== row.state) await updateVm(env, row.id, s.state); continue; }
          await c.rollbackSnapshot(row.rollback_snapshot_id!, row.rollback_volume_id!);
          await setRollbackStep(env, row.id, 'rollingback');
          await audit(env, 'system', 'vm.rollback.started', `req:${row.id}`, row.rollback_snapshot_id ?? '');
          continue;
        }
        if (row.rollback_step === 'rollingback') {
          const vs = await c.getVolumeStatus(row.rollback_volume_id!);
          if (vs === 'available') {
            await startInstance(env, serverId);
            await setRollbackStep(env, row.id, 'starting');
            await audit(env, 'system', 'vm.rollback.volume.restored', `req:${row.id}`, row.rollback_volume_id ?? '');
          } else if (vs === 'error' || vs === 'error_rollbacking') {
            throw new Error(`rollback EVS échoué (volume ${vs})`);
          }
          continue;
        }
        if (row.rollback_step === 'starting') {
          const s = await describeInstance(env, serverId);
          if (s.state === 'running' && s.publicIp) {
            await updateVm(env, row.id, 'running', s.publicIp);
            // La pause posée au lancement du rollback n'était qu'un garde transitoire :
            // on restaure l'invariant planning (sinon la VM tournerait 24/7 hors planning).
            if (row.schedule_enabled) await setSchedulePaused(env, row.id, false);
            await clearRollback(env, row.id);
            await audit(env, 'system', 'vm.rollback.done', `req:${row.id}`, serverId);
          } else { await updateVm(env, row.id, s.state); }
          continue;
        }
      }

      // Modèle asynchrone : résoudre job_id → server_id s'il n'est pas encore connu.
      if (!row.server_id) {
        if (!row.provider_job_id) continue;
        const resolved = await c.resolveLaunch({ jobId: row.provider_job_id });
        if (!resolved) continue; // job encore en cours
        await setServerId(env, row.id, resolved);
        await audit(env, 'system', 'vm.job.resolved', `req:${row.id}`, resolved);
        // Restauration : VM démarrée → image IMS transitoire inutile (anti-orphelin).
        if (row.restore_step === 'launch') {
          if (row.restore_image_id) await c.deleteImage(row.restore_image_id);
          await clearRestore(env, row.id);
        }
        row.server_id = resolved;
      }
      const serverId = row.server_id;
      if (!serverId) continue;

      // provisioning -> active dès que running + IP publique
      if (row.status === 'provisioning') {
        const s = await describeInstance(env, serverId);
        if (s.state === 'running' && s.publicIp) {
          await updateVm(env, row.id, 'running', s.publicIp);
          await setRequestStatus(env, row.id, 'active');
          await audit(env, 'system', 'vm.active', `req:${row.id}`, s.publicIp);
          await addNotification(env, row.user_email, 'ready', `/requests/${row.id}`);
          await notifyUserReady(env, row.user_email, row.id, s.publicIp, row.ssh_user ?? 'root', row.connect_method === 'rdp' ? 'rdp' : 'ssh');
        } else {
          await updateVm(env, row.id, s.state);
        }
        continue;
      }

      // active : détection de drift + synchronisation d'état
      const state = managed[serverId];
      if (!state || state === 'terminated') {
        // Confirmer pour éviter un faux drift (indexation par tag éventuellement en retard).
        let gone = state === 'terminated';
        if (!state) {
          try {
            const s = await describeInstance(env, serverId);
            if (s.state !== 'terminated') {
              if (s.state !== row.state) await updateVm(env, row.id, s.state);
              continue;
            }
            gone = true;
          } catch {
            gone = true; // 404 → réellement supprimée
          }
        }
        if (gone) {
          await updateVm(env, row.id, 'terminated');
          await setRequestStatus(env, row.id, 'terminated');
          await audit(env, 'system', 'vm.drift.terminated', `req:${row.id}`, serverId);
        }
        continue;
      }

      // synchroniser l'état réel + rafraîchir l'IP au redémarrage
      if (state !== row.state) {
        if (state === 'running') {
          const s = await describeInstance(env, serverId);
          await updateVm(env, row.id, 'running', s.publicIp);
        } else {
          await updateVm(env, row.id, state);
        }
      }
    } catch (e: any) {
      // Restauration : nettoyage des ressources transitoires en cas d'échec (anti-orphelin).
      if (row.restore_step) {
        if (row.restore_volume_id) await c.deleteVolume(row.restore_volume_id).catch(() => {});
        if (row.restore_image_id) await c.deleteImage(row.restore_image_id).catch(() => {});
        await setRequestStatus(env, row.id, 'failed', undefined, `restore: ${e.message}`).catch(() => {});
        await clearRestore(env, row.id).catch(() => {});
      }
      // Rollback en place : échec → tentative de redémarrage best-effort + on efface l'état
      // (la demande reste 'active', pas de blocage). Garde-fou par rollback_step NULL.
      if (row.rollback_step) {
        if (row.server_id) await startInstance(env, row.server_id).catch(() => {});
        if (row.schedule_enabled) await setSchedulePaused(env, row.id, false).catch(() => {});
        await clearRollback(env, row.id).catch(() => {});
      }
      await audit(env, 'system', 'vm.reconcile.error', `req:${row.id}`, e.message);
    }
  }
}

// Plannings auto start/stop par VM (Europe/Zurich). État désiré : dans la fenêtre un jour
// sélectionné → la VM doit tourner ; sinon → arrêtée. Décision pure dans src/schedule.ts (testée).
async function applySchedules(env: Env): Promise<void> {
  const { day, minutes } = zurichNow();
  for (const row of await listScheduledVms(env)) {
    if (!row.server_id) continue;
    const shouldRun = shouldRunSchedule(day, minutes, row.schedule_days, row.schedule_start, row.schedule_stop);
    try {
      if (shouldRun && row.state === 'stopped') {
        await startInstance(env, row.server_id);
        await updateVm(env, row.id, 'pending');
        await audit(env, 'system', 'vm.schedule.start', `req:${row.id}`);
      } else if (!shouldRun && row.state === 'running') {
        await stopInstance(env, row.server_id);
        await updateVm(env, row.id, 'stopping');
        await audit(env, 'system', 'vm.schedule.stop', `req:${row.id}`);
      }
    } catch (e: any) {
      await audit(env, 'system', 'vm.schedule.error', `req:${row.id}`, e.message);
    }
  }
}

// Stop all running portal VMs (off-hours cost guardrail). Users can restart them.
// VMs with their own enabled schedule are skipped (their schedule is authoritative).
async function scheduledStop(env: Env): Promise<void> {
  if (env.SCHEDULED_STOP !== 'true') return;
  const rows = await listActiveVms(env);
  for (const row of rows) {
    if (row.schedule_enabled) continue;
    if (row.status === 'active' && row.state === 'running' && row.server_id) {
      try {
        await stopInstance(env, row.server_id);
        await updateVm(env, row.id, 'stopping');
        await audit(env, 'system', 'vm.scheduled_stop', `req:${row.id}`);
      } catch (e: any) {
        await audit(env, 'system', 'vm.scheduled_stop.error', `req:${row.id}`, e.message);
      }
    }
  }
}

// Auto-stop VMs idle (low CPU) for IDLE_STOP_HOURS. Best-effort; needs Cloud Eye (CES) read.
// The user can restart from the portal at any time.
async function enforceIdleStop(env: Env): Promise<void> {
  if (env.IDLE_STOP !== 'true') return;
  const hours = Number(env.IDLE_STOP_HOURS) > 0 ? Number(env.IDLE_STOP_HOURS) : 3;
  const minPoints = Math.floor(((hours * 60) / 5) * 0.7); // require ~enough history (running most of the window)
  for (const vm of await listRunningVmsForIdle(env)) {
    if (!vm.server_id) continue;
    try {
      const cpu = await maxCpuOverWindow(env, vm.server_id, hours * 60);
      if (!cpu || cpu.datapoints < minPoints) continue; // not enough history yet
      if (cpu.max < 10) {
        await stopInstance(env, vm.server_id);
        await updateVm(env, vm.id, 'stopping');
        await addNotification(env, vm.user_email, 'idle_stopped', `/requests/${vm.id}`);
        await audit(env, 'system', 'vm.idle_stop', `req:${vm.id}`, `cpuMax=${cpu.max.toFixed(1)}%`);
      }
    } catch {
      /* skip this tick (e.g. Cloud Eye/CES permission missing) */
    }
  }
}

// Auto-retry provisioning for failed requests that never got an instance (max 3).
async function retryFailed(env: Env): Promise<void> {
  const failed = await listRequestsByStatus(env, 'failed');
  for (const req of failed) {
    const vm = await getVmByRequest(env, req.id);
    if (vm) continue; // an instance already exists
    if ((await countAudit(env, `req:${req.id}`, 'vm.launch.failed')) >= 3) continue;
    try {
      await setRequestStatus(env, req.id, 'provisioning');
      const instanceId = await provisionRequest(env, req);
      await audit(env, 'system', 'vm.launch.retry', `req:${req.id}`, instanceId);
    } catch (e: any) {
      await setRequestStatus(env, req.id, 'failed', undefined, `retry: ${e.message}`);
      await audit(env, 'system', 'vm.launch.failed', `req:${req.id}`, e.message);
    }
  }
}

// Lifecycle: at end_date, TERMINATE the VM (instance + SSH key destroyed) and mark it
// 'expired'. ADR 0008 supersedes ADR 0004 (auto-suppression demandée par le client).
// A one-time heads-up email is sent 24h before the deadline so users can back up.
async function enforceExpiry(env: Env): Promise<void> {
  for (const row of await listExpired(env)) {
    try {
      // Sauvegarde à la suppression = on GARDE le disque (Option A), restaurable ensuite.
      if (row.snapshot_on_delete && row.server_id) {
        const kept = await keepVolumeBackup(env, row.id, row.user_email, row.server_id);
        if (!kept) await terminateInstance(env, row.server_id); // pas de volume → suppression normale
        if (row.ssh_key_name) await deleteKeyPair(env, row.ssh_key_name);
        await updateVm(env, row.id, 'terminated');
        await markExpired(env, row.id);
        await setRequestStatus(env, row.id, 'terminated');
        await audit(env, 'system', 'vm.expired.terminated', `req:${row.id}`, kept ? `${row.server_id} +backup` : (row.server_id ?? ''));
        await addNotification(env, row.user_email, 'expired', `/requests/${row.id}`);
        await notifyUserExpired(env, row.user_email, row.id);
        continue;
      }
      if (row.server_id) await terminateInstance(env, row.server_id);
      if (row.ssh_key_name) await deleteKeyPair(env, row.ssh_key_name);
      await updateVm(env, row.id, 'terminated');
      await markExpired(env, row.id);
      await setRequestStatus(env, row.id, 'terminated');
      await audit(env, 'system', 'vm.expired.terminated', `req:${row.id}`, row.server_id ?? '');
      await addNotification(env, row.user_email, 'expired', `/requests/${row.id}`);
      await notifyUserExpired(env, row.user_email, row.id);
    } catch (e: any) {
      await audit(env, 'system', 'vm.expire.error', `req:${row.id}`, e.message);
    }
  }
  for (const row of await listExpiringSoon(env)) {
    if ((await countAudit(env, `req:${row.id}`, 'vm.expiring.notified')) > 0) continue;
    try {
      await addNotification(env, row.user_email, 'expiring', `/requests/${row.id}`);
      await notifyUserExpiring(env, row.user_email, row.id, row.end_date);
      await audit(env, 'system', 'vm.expiring.notified', `req:${row.id}`);
    } catch (e: any) {
      await audit(env, 'system', 'vm.expiring.error', `req:${row.id}`, e.message);
    }
  }
}

// Poll pending EVS snapshots and mark them completed/error.
async function syncSnapshots(env: Env): Promise<void> {
  for (const s of await listPendingSnapshots(env)) {
    try {
      const st = await describeSnapshot(env, s.snapshot_id);
      if (st.state === 'completed' || st.state === 'error') {
        await updateSnapshotStatus(env, s.snapshot_id, st.state, st.sizeGb);
      }
    } catch {
      /* skip this tick */
    }
  }
}

// Finalise les suppressions DIFFÉRÉES (snapshot-à-la-suppression) : une fois le snapshot
// terminé — ou après un timeout de garde — on détruit réellement la VM + le disque. Sépare
// la création du snapshot de la suppression du disque (sinon le snapshot reste « pending »).
const DEFERRED_DELETE_TIMEOUT_MS = 20 * 60 * 1000;
async function finalizePendingDeletions(env: Env): Promise<void> {
  for (const row of await listTerminating(env)) {
    try {
      const snap = await latestSnapshotForRequest(env, row.id);
      const settled = !snap || snap.status === 'completed' || snap.status === 'error';
      const timedOut = snap ? Date.now() - snap.atMs > DEFERRED_DELETE_TIMEOUT_MS : true;
      if (!settled && !timedOut) continue; // snapshot encore en cours → on attend le prochain tick
      if (row.server_id) await terminateInstance(env, row.server_id);
      if (row.ssh_key_name) await deleteKeyPair(env, row.ssh_key_name);
      await updateVm(env, row.id, 'terminated');
      await setRequestStatus(env, row.id, 'terminated');
      await audit(env, 'system', 'vm.terminate', `req:${row.id}`, `${row.server_id ?? ''} snap=${snap?.status ?? 'none'}${!settled && timedOut ? ' timeout' : ''}`);
    } catch (e: any) {
      await audit(env, 'system', 'vm.terminate.deferred.error', `req:${row.id}`, e.message);
    }
  }
}

app.onError((err, c) => {
  reportError(c.env.SENTRY_DSN, err, c.executionCtx, { path: c.req.path });
  return c.json({ error: 'internal' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await reconcile(env);
        await applySchedules(env);
        await retryFailed(env);
        await enforceExpiry(env);
        await enforceIdleStop(env);
        await syncSnapshots(env);
        await finalizePendingDeletions(env);
        // Garde-fou nocturne fusionné dans l'unique cron (limite Cloudflare de 5 crons/compte) :
        // déclenché une fois au passage de 19:00 UTC.
        const now = new Date();
        if (now.getUTCHours() === 19 && now.getUTCMinutes() < 2) await scheduledStop(env);
      })()
    );
  },
} satisfies ExportedHandler<Env>;
