import type { PresetCatalog, User, VmRequest, Status, AdminUser, Metrics, AuditEntry, Notification, Snapshot } from './types';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => req<{ user: User }>('/api/me').then((r) => r.user),
  presets: () => req<PresetCatalog>('/api/presets'),

  listRequests: () => req<{ requests: VmRequest[] }>('/api/requests').then((r) => r.requests),
  createRequest: (
    perf: string,
    storage: string,
    os: string,
    purpose: string,
    startDate: string | null,
    endDate: string,
    course = ''
  ) =>
    req<{ id: number }>('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ perf, storage, os, purpose, startDate, endDate, course }),
    }),
  createBatch: (
    vms: { name: string; perf: string; storage: string; os: string; purpose: string; startDate: string | null; endDate: string; course: string; snapshotId?: number | null }[],
    group?: { name: string }
  ) => req<{ ids: number[]; groupId: string | null; groupName: string | null }>('/api/requests/batch', {
    method: 'POST',
    body: JSON.stringify({ vms, group }),
  }),
  deleteRequest: (id: number) => req<{ ok: true }>(`/api/requests/${id}`, { method: 'DELETE' }),
  groupAction: (groupId: string, action: 'start' | 'stop' | 'reboot' | 'terminate') =>
    req<{ ok: true; affected: number }>(`/api/groups/${groupId}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
  groupRename: (groupId: string, name: string) =>
    req<{ ok: true }>(`/api/groups/${groupId}/rename`, { method: 'POST', body: JSON.stringify({ name }) }),
  groupDissolve: (groupId: string) => req<{ ok: true }>(`/api/groups/${groupId}/dissolve`, { method: 'POST' }),
  groupSchedule: (groupId: string, payload: { enabled: boolean; start?: string; stop?: string; days?: number[] }) =>
    req<{ ok: true }>(`/api/groups/${groupId}/schedule`, { method: 'POST', body: JSON.stringify(payload) }),
  groupExtend: (groupId: string, until: string) =>
    req<{ ok: true }>(`/api/groups/${groupId}/extend`, { method: 'POST', body: JSON.stringify({ until }) }),
  createGroup: (name: string, ids: number[]) =>
    req<{ ok: true; groupId: string; groupName: string }>('/api/groups', { method: 'POST', body: JSON.stringify({ name, ids }) }),
  getRequest: (id: number) => req<{ request: VmRequest }>(`/api/requests/${id}`).then((r) => r.request),
  requestExtension: (id: number, until: string) =>
    req<{ ok: true }>(`/api/requests/${id}/extend`, { method: 'POST', body: JSON.stringify({ until }) }),
  approveExtension: (id: number) => req<{ ok: true }>(`/api/admin/requests/${id}/extend/approve`, { method: 'POST' }),
  rejectExtension: (id: number) => req<{ ok: true }>(`/api/admin/requests/${id}/extend/reject`, { method: 'POST' }),
  terminate: (id: number) => req<{ ok: true }>(`/api/requests/${id}/terminate`, { method: 'POST' }),
  reset: (id: number) => req<{ ok: true }>(`/api/requests/${id}/reset`, { method: 'POST' }),
  createSnapshot: (id: number) => req<{ ok: true; id: number }>(`/api/requests/${id}/snapshot`, { method: 'POST' }),
  listSnapshots: (id: number) => req<{ snapshots: Snapshot[] }>(`/api/requests/${id}/snapshots`).then((r) => r.snapshots),
  userSnapshots: () => req<{ snapshots: Snapshot[] }>('/api/snapshots').then((r) => r.snapshots),
  setSnapshotOnDelete: (id: number, enabled: boolean) =>
    req<{ ok: true }>(`/api/requests/${id}/snapshot-on-delete`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  deleteSnapshot: (id: number, sid: number) =>
    req<{ ok: true }>(`/api/requests/${id}/snapshots/${sid}`, { method: 'DELETE' }),
  start: (id: number) => req<{ ok: true }>(`/api/requests/${id}/start`, { method: 'POST' }),
  stop: (id: number) => req<{ ok: true }>(`/api/requests/${id}/stop`, { method: 'POST' }),
  reboot: (id: number) => req<{ ok: true }>(`/api/requests/${id}/reboot`, { method: 'POST' }),
  live: (id: number) =>
    req<{ state: string; publicIp: string | null; launchTime: string | null }>(`/api/requests/${id}/live`),
  keyUrl: (id: number) => `/api/requests/${id}/key`,
  password: (id: number) => req<{ user: string; password: string }>(`/api/requests/${id}/password`),
  setSchedule: (
    id: number,
    payload: { enabled: boolean; start?: string; stop?: string; days?: number[] }
  ) => req<{ ok: true }>(`/api/requests/${id}/schedule`, { method: 'POST', body: JSON.stringify(payload) }),
  resumeSchedule: (id: number) => req<{ ok: true }>(`/api/requests/${id}/schedule/resume`, { method: 'POST' }),

  adminList: (status?: Status | '') =>
    req<{ requests: VmRequest[] }>(`/api/admin/requests${status ? `?status=${status}` : ''}`).then(
      (r) => r.requests
    ),
  adminStats: () => req<{ stats: Record<string, number> }>('/api/admin/stats').then((r) => r.stats),
  adminMetrics: () => req<{ metrics: Metrics }>('/api/admin/metrics').then((r) => r.metrics),
  adminUsers: () => req<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users),
  adminAudit: (limit = 150) =>
    req<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=${limit}`).then((r) => r.entries),
  setUserRole: (email: string, role: 'admin' | 'formateur' | 'member') =>
    req<{ ok: true }>(`/api/admin/users/${encodeURIComponent(email)}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  csvUrl: '/api/admin/requests.csv',
  approve: (id: number) => req<{ ok: true }>(`/api/admin/requests/${id}/approve`, { method: 'POST' }),
  reject: (id: number, note: string) =>
    req<{ ok: true }>(`/api/admin/requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),
  groupApprove: (groupId: string) => req<{ ok: true; approved: number }>(`/api/admin/groups/${groupId}/approve`, { method: 'POST' }),
  groupReject: (groupId: string, note: string) =>
    req<{ ok: true }>(`/api/admin/groups/${groupId}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),

  trainerUsers: () => req<{ users: { email: string; name: string | null }[] }>('/api/trainer/users').then((r) => r.users),
  trainerBatch: (payload: {
    perf: string; storage: string; os: string; course: string; baseName: string; groupName: string;
    purpose: string; count: number; userEmails: string[]; startDate: string | null; endDate: string;
  }) => req<{ ok: true; ids: number[]; groupId: string }>('/api/trainer/batch', { method: 'POST', body: JSON.stringify(payload) }),

  notifications: () => req<{ notifications: Notification[]; unread: number }>('/api/notifications'),
  markNotificationsRead: () => req<{ ok: true }>('/api/notifications/read', { method: 'POST' }),

  logout: () => req<void>('/auth/logout', { method: 'POST' }),
};

export { ApiError };
