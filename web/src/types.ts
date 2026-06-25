export type Role = 'member' | 'formateur' | 'admin';

export interface User {
  email: string;
  name: string;
  role: Role;
}

export interface PerfPreset {
  id: string;
  label: string;
  flavor: string;
  vcpu: number;
  ramGb: number;
  hourlyEur: number;
  description?: string;
  recommended?: boolean;
  hidden?: boolean;
}
export interface StoragePreset {
  id: string;
  label: string;
  sizeGb: number;
  description?: string;
  recommended?: boolean;
  hidden?: boolean;
}
export type OsFamily = 'ubuntu' | 'debian' | 'amazon' | 'rocky' | 'alma' | 'windows';
export interface OsPreset {
  id: string;
  label: string;
  family: OsFamily;
  image: string;
  sshUser: string;
  connect: 'ssh' | 'rdp';
  description?: string;
  recommended?: boolean;
  minStorageGb?: number;
  hidden?: boolean;
}

export interface CoursePreset {
  id: string;
  label: string;
  description: string;
  tools: string[];
}
export interface PresetCatalog {
  perf: PerfPreset[];
  storage: StoragePreset[];
  os: OsPreset[];
  courses: CoursePreset[];
  storageUsdGbMonth: number;
  region: string;
  grafanaUrl?: string;
}

export type Status =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'provisioning'
  | 'active'
  | 'stopped'
  | 'failed'
  | 'terminating'
  | 'terminated'
  | 'expired';

export interface AdminUser {
  email: string;
  name: string | null;
  role: Role;
  created_at: string;
}
export interface Comment {
  id: number;
  author: string;
  body: string;
  created_at: string;
}
export interface Metrics {
  total: number;
  successRate: number;
  failed: number;
  avgProvisionSeconds: number;
}
export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
}
export interface Notification {
  id: number;
  type: string;
  link: string | null;
  read: number;
  created_at: string;
}
export interface VmCost {
  id: number;
  user: string;
  name: string | null;
  preset: string;
  storage: string | null;
  running: boolean;
  runningHours: number;
  lifetimeHours: number;
  computeEur: number;
  storageEur: number;
  eur: number;
  since: number | null;
  until: number | null;
}
export interface CostReport {
  totalEur: number;
  computeEur: number;
  storageEur: number;
  activeVms: number;
  fleetMonthlyEur: number;
  perUser: { email: string; vms: number; eur: number }[];
  perVm: VmCost[];
  perDay: { date: string; eur: number }[];
}
export interface Snapshot {
  id: number;
  request_id: number | null;
  snapshot_id: string | null;
  description: string | null;
  size_gb: number | null;
  status: string;
  ova_status: string | null;
  ova_url: string | null;
  os: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AdminSnapshot extends Snapshot {
  user_email: string;
  vm_name: string | null;
}

export interface VmRequest {
  id: number;
  user_email: string;
  name: string | null;
  purpose: string;
  preset: string; // performance preset id
  storage: string | null;
  os: string | null;
  region: string;
  status: Status;
  course?: string | null;
  course_ready_at?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  snapshot_on_delete?: number;
  admin_note: string | null;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
  start_date: string | null;
  end_date: string | null;
  expired_at: string | null;
  ext_requested_end?: string | null;
  ext_requested_at?: string | null;
  schedule_enabled?: number;
  schedule_start?: string | null;
  schedule_stop?: string | null;
  schedule_days?: string | null;
  schedule_paused?: number;
  public_ip?: string | null;
  ssh_key_name?: string | null;
  ssh_user?: string | null;
  server_id?: string | null;
  vm_state?: string | null;
  has_key?: number;
  connect_method?: string | null;
  has_password?: number;
}
