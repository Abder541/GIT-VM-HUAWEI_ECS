import type { Status, VmRequest } from '../types';

// Single source of truth for the badge shown in lists AND on the detail page,
// so they never disagree. "expired" is derived from expired_at; an active VM
// whose instance is stopped (schedule / manual) shows "stopped" rather than "active".
export function displayStatus(r: Pick<VmRequest, 'status' | 'expired_at' | 'vm_state'>): Status {
  if (r.expired_at) return 'expired';
  if (r.status === 'active' && r.vm_state === 'stopped') return 'stopped';
  return r.status;
}
