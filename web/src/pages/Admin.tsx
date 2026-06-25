import { useMemo } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { AuditEntry, Metrics, VmRequest } from '../types';
import { Card } from '../ui';
import { fmtDate } from '../lib/format';
import { UsersPanel } from '../components/UsersPanel';
import { VmConsole } from '../components/VmConsole';

type Tab = 'overview' | 'vms' | 'users' | 'cost' | 'snapshots' | 'monitoring';

/* ---------- shared bits ---------- */
function StatCard({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
    </Card>
  );
}
function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
    </Card>
  );
}
function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ---------- nav ---------- */
const TabIcon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS: Record<Tab, string> = {
  overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-4H4z',
  vms: 'M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2zM3 15h18v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 7h.01M7 18h.01',
  users: 'M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  cost: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  snapshots: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  monitoring: 'M22 12h-4l-3 9L9 3l-3 9H2',
};

export function Admin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');

  const presetsQ = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const statsQ = useQuery({ queryKey: ['admin-stats'], queryFn: api.adminStats, refetchInterval: 10000 });
  const metricsQ = useQuery({ queryKey: ['admin-metrics'], queryFn: api.adminMetrics, refetchInterval: 15000 });
  const allQ = useQuery({
    queryKey: ['admin-all'],
    queryFn: () => api.adminList(''),
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'provisioning') ? 5000 : 15000),
  });

  const catalog = presetsQ.data;
  const rows = allQ.data ?? [];
  const stats = statsQ.data ?? {};
  const pending = stats.pending ?? 0;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: t('admin.navOverview') },
    { id: 'vms', label: t('admin.navVms'), badge: pending },
    { id: 'users', label: t('admin.navUsers') },
    { id: 'cost', label: t('admin.navCost') },
    { id: 'snapshots', label: t('admin.navSnapshots') },
    { id: 'monitoring', label: t('admin.navMonitoring') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">GIT Cloud</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('admin.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('admin.subtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  tab === tb.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <TabIcon d={ICONS[tb.id]} />
                <span>{tb.label}</span>
                {tb.badge ? (
                  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-amber-500/15 px-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    {tb.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          {tab === 'overview' && <OverviewSection stats={stats} metrics={metricsQ.data} />}
          {tab === 'vms' && <VmConsole rows={rows} loading={allQ.isLoading} catalog={catalog} />}
          {tab === 'users' && <UsersSection rows={rows} />}
          {tab === 'cost' && <CostSection />}
          {tab === 'snapshots' && <SnapshotsSection />}
          {tab === 'monitoring' && <MonitoringSection grafanaUrl={catalog?.grafanaUrl} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- Overview ---------- */
function OverviewSection({ stats, metrics }: { stats: Record<string, number>; metrics?: Metrics }) {
  const { t } = useTranslation();
  const auditQ = useQuery({ queryKey: ['admin-audit', 50], queryFn: () => api.adminAudit(50), refetchInterval: 15000 });
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('status.pending')} value={stats.pending ?? 0} dot="bg-amber-500" />
        <StatCard label={t('status.provisioning')} value={stats.provisioning ?? 0} dot="bg-blue-500" />
        <StatCard label={t('status.active')} value={stats.active ?? 0} dot="bg-emerald-500" />
        <StatCard label={t('status.failed')} value={stats.failed ?? 0} dot="bg-red-500" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('status.expired')} value={stats.expired ?? 0} dot="bg-orange-500" />
        <StatCard label={t('status.terminated')} value={stats.terminated ?? 0} dot="bg-zinc-400" />
        <StatCard label={t('status.rejected')} value={stats.rejected ?? 0} dot="bg-red-500" />
        <MetricCard label={t('metric.total')} value={String(metrics?.total ?? 0)} />
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.recent')}</h3>
        </div>
        <div className="max-h-96 overflow-y-auto pr-1">
          <AuditList entries={auditQ.data ?? []} compact />
        </div>
      </Card>
    </div>
  );
}

/* ---------- Users ---------- */
function UsersSection({ rows }: { rows: VmRequest[] }) {
  const { t } = useTranslation();
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.user_email] = (m[r.user_email] ?? 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [rows]);
  return (
    <div className="space-y-6">
      <SectionTitle title={t('admin.users')} />
      <UsersPanel />
      {counts.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.perUser')}</h3>
          <div className="space-y-2">
            {counts.map(([email, n]) => (
              <div key={email} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{email}</span>
                <span className="shrink-0 font-semibold tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- Audit ---------- */
const actionTone = (a: string) => {
  if (a.includes('fail') || a.includes('reject') || a.includes('terminate') || a.includes('expired')) return 'text-red-600 dark:text-red-400';
  if (a.includes('approve') || a.includes('active') || a.includes('ready') || a.includes('launch')) return 'text-emerald-600 dark:text-emerald-400';
  if (a.includes('login') || a.includes('create')) return 'text-blue-600 dark:text-blue-400';
  return 'text-muted-foreground';
};
function AuditList({ entries, compact }: { entries: AuditEntry[]; compact?: boolean }) {
  const { t } = useTranslation();
  if (entries.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t('admin.noAudit')}</p>;
  return (
    <div className="space-y-1.5">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-3 text-sm">
          <span className={`w-40 shrink-0 truncate font-mono text-xs font-medium ${actionTone(e.action)}`}>{e.action}</span>
          <span className="shrink-0 truncate text-xs text-muted-foreground">{e.actor}</span>
          {!compact && e.target && <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.target}</span>}
          {!compact && e.detail && <span className="truncate text-xs text-muted-foreground/80">{e.detail}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">{fmtDate(e.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Coûts (heures réelles) ---------- */
const fmtEur = (n: number) => `${n.toFixed(2)} €`;

function CostSection() {
  const { t } = useTranslation();
  const costQ = useQuery({ queryKey: ['admin-cost'], queryFn: api.adminCost, refetchInterval: 30000 });
  const d = costQ.data;
  if (!d) return <p className="py-10 text-center text-sm text-muted-foreground">…</p>;
  // Timeline complète sur 30 jours (jours sans coût = 0) pour un vrai graphe.
  const byDate = new Map(d.perDay.map((x) => [x.date, x.eur]));
  const series = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, eur: byDate.get(date) ?? 0 };
  });
  const maxDay = Math.max(0.01, ...series.map((x) => x.eur));
  return (
    <div className="space-y-6">
      <SectionTitle title={t('admin.navCost')} hint={t('admin.costPageHint')} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label={t('admin.costTotal')} value={fmtEur(d.totalEur)} />
        <MetricCard label={t('admin.costCompute')} value={fmtEur(d.computeEur)} />
        <MetricCard label={t('admin.costStorage')} value={fmtEur(d.storageEur)} />
        <MetricCard label={t('admin.costFleetMonthly')} value={fmtEur(d.fleetMonthlyEur)} />
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.costPerDay')}</h3>
          <span className="text-[10px] text-muted-foreground/70">max {fmtEur(maxDay)}</span>
        </div>
        <div className="flex h-40 items-end gap-px">
          {series.map((x) => (
            <div
              key={x.date}
              className="group flex flex-1 flex-col justify-end"
              title={`${x.date} · ${fmtEur(x.eur)}`}
            >
              <div
                className={`w-full rounded-t transition ${x.eur > 0 ? 'bg-emerald-500/70 group-hover:bg-emerald-500' : 'bg-muted'}`}
                style={{ height: x.eur > 0 ? `${Math.max(3, (x.eur / maxDay) * 100)}%` : '2px' }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>{series[0].date}</span>
          <span>{series[series.length - 1].date}</span>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.costPerUser')}</h3>
        {d.perUser.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('admin.noCost')}</p>
        ) : (
          <div className="space-y-2">
            {d.perUser.map((u) => (
              <div key={u.email} className="flex items-center gap-3 text-sm">
                <span className="truncate text-muted-foreground">{u.email}</span>
                <span className="shrink-0 text-xs text-muted-foreground/70">{u.vms} VM</span>
                <span className="ml-auto shrink-0 font-semibold tabular-nums">{fmtEur(u.eur)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.costPerVm')}</h3>
        {d.perVm.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('admin.noCost')}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">{t('admin.costVm')}</th>
                  <th className="pb-2 font-medium">{t('admin.costUser')}</th>
                  <th className="pb-2 text-right font-medium">{t('admin.costHours')}</th>
                  <th className="pb-2 text-right font-medium">€</th>
                </tr>
              </thead>
              <tbody>
                {d.perVm.map((v) => (
                  <tr key={v.id} className="border-t border-border/60">
                    <td className="py-1.5">
                      <span className="font-medium">{v.name || `#${v.id}`}</span>
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">{v.preset}</span>
                      {v.running && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" title="active" />}
                    </td>
                    <td className="truncate py-1.5 text-muted-foreground">{v.user}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{v.runningHours.toFixed(1)}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{fmtEur(v.eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">{t('admin.costDisclaimer')}</p>
    </div>
  );
}

/* ---------- Snapshots (vue globale) ---------- */
const snapTone = (s: string) => {
  if (/(complete|available|active|success)/i.test(s)) return 'text-emerald-600 dark:text-emerald-400';
  if (/(pending|creating|progress)/i.test(s)) return 'text-amber-600 dark:text-amber-400';
  if (/(error|fail)/i.test(s)) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
};

function SnapshotsSection() {
  const { t } = useTranslation();
  const snapsQ = useQuery({ queryKey: ['admin-snapshots'], queryFn: api.adminSnapshots, refetchInterval: 30000 });
  const snaps = snapsQ.data;
  if (!snaps) return <p className="py-10 text-center text-sm text-muted-foreground">…</p>;
  return (
    <div className="space-y-6">
      <SectionTitle title={t('admin.navSnapshots')} hint={t('admin.snapHint')} />
      <Card className="p-5">
        {snaps.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('admin.noSnap')}</p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">{t('admin.snapVm')}</th>
                  <th className="pb-2 font-medium">{t('admin.snapUser')}</th>
                  <th className="pb-2 font-medium">{t('admin.snapDesc')}</th>
                  <th className="pb-2 font-medium">{t('admin.snapStatus')}</th>
                  <th className="pb-2 text-right font-medium">{t('admin.snapSize')}</th>
                  <th className="pb-2 text-right font-medium">{t('admin.snapDate')}</th>
                </tr>
              </thead>
              <tbody>
                {snaps.map((s) => (
                  <tr key={s.id} className="border-t border-border/60">
                    <td className="py-1.5 font-medium">{s.vm_name || `#${s.request_id ?? '?'}`}</td>
                    <td className="max-w-[12rem] truncate py-1.5 text-muted-foreground">{s.user_email}</td>
                    <td className="max-w-[14rem] truncate py-1.5 text-muted-foreground">{s.description || '—'}</td>
                    <td className={`py-1.5 font-mono text-xs ${snapTone(s.status)}`}>{s.status}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{s.size_gb ? `${s.size_gb} Go` : '—'}</td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground/70">{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t('admin.snapDisclaimer')}</p>
    </div>
  );
}

/* ---------- Monitoring (Grafana Cloud) ---------- */
function MonitoringSection({ grafanaUrl }: { grafanaUrl?: string }) {
  const { t } = useTranslation();
  let base = '';
  try {
    if (grafanaUrl) base = new URL(grafanaUrl).origin;
  } catch {
    /* ignore */
  }
  const dashboards = [
    { uid: 'gitvm-portal', label: t('admin.dashComplete') },
    { uid: 'gitvm-cost', label: t('admin.dashCost') },
    { uid: 'gitvm-vms', label: t('admin.dashVms') },
    { uid: 'gitvm-logs', label: t('admin.dashLogs') },
  ];
  return (
    <div className="space-y-4">
      <SectionTitle title={t('admin.navMonitoring')} hint={t('admin.monHint')} />
      {base ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {dashboards.map((d) => (
            <a
              key={d.uid}
              href={`${base}/d/${d.uid}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-border bg-card p-4 font-medium transition hover:border-foreground/25 hover:bg-muted/40"
            >
              {d.label}
              <span className="text-muted-foreground">↗</span>
            </a>
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">{t('admin.monIntro')}</p>
          <a
            href="https://grafana.com/auth/sign-up/create-user"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium transition hover:bg-muted"
          >
            {t('admin.monOpen')} ↗
          </a>
        </Card>
      )}
      <Card className="p-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.monEndpoints')}</h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {['summary', 'daily', 'os', 'users', 'cost', 'metrics', 'audit'].map((e) => (
            <li key={e}><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/api/monitoring/{e}</code></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
