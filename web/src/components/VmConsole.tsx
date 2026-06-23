import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../toast';
import type { OsPreset, PerfPreset, PresetCatalog, Status, VmRequest } from '../types';
import { Button, IconCheck, IconDownload, IconPlay, IconReboot, IconServer, IconStop, IconTrash, IconX, Modal, Select, Spinner, TableSkeleton, Textarea } from '../ui';
import { fmtDate } from '../lib/format';
import { displayStatus } from '../lib/status';
import { StatusBadge } from './StatusBadge';
import { OsIcon } from './OsIcon';
import { GroupReview } from './GroupReview';

const FILTERS: (Status | '')[] = ['', 'pending', 'provisioning', 'active', 'approved', 'rejected', 'failed', 'terminated', 'expired'];
const PER_PAGE = 12;

function Tool({ children, onClick, disabled, title, tone }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string; tone?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted disabled:pointer-events-none disabled:opacity-50 ${tone ?? 'text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  );
}

/** Compact review card for a single pending VM (justification + approve/reject), same language as GroupReview. */
function SingleReview({ r, typeLabel, osFamily }: { r: VmRequest; typeLabel: string; osFamily?: OsPreset['family'] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-all'] }); qc.invalidateQueries({ queryKey: ['admin-stats'] }); qc.invalidateQueries({ queryKey: ['request', r.id] }); };
  const onErr = () => toast.error(t('toast.error'));
  const approveM = useMutation({ mutationFn: () => api.approve(r.id), onSuccess: () => { invalidate(); toast.success(t('toast.approved')); }, onError: onErr });
  const rejectM = useMutation({ mutationFn: () => api.reject(r.id, note.trim()), onSuccess: () => { invalidate(); setRejectOpen(false); setNote(''); toast.success(t('toast.rejected')); }, onError: onErr });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-amber-500/[0.06] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {osFamily && <OsIcon family={osFamily} className="h-6 w-6" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link to={`/requests/${r.id}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">#{String(r.id).padStart(3, '0')}</Link>
              <span className="truncate font-semibold">{typeLabel}</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">{r.user_email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button disabled={approveM.isPending} onClick={() => approveM.mutate()}>
            {approveM.isPending ? <Spinner className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}{t('actions.approve')}
          </Button>
          <Button variant="danger" disabled={rejectM.isPending} onClick={() => { setRejectOpen(true); setNote(''); }}>
            <IconX className="h-4 w-4" />{t('actions.reject')}
          </Button>
        </div>
      </div>
      <div className="p-4">
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.justification')}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{r.purpose || '—'}</p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('table.expires')} : {fmtDate(r.end_date)}</p>
      </div>
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('actions.reject')}
        footer={<>
          <Button variant="secondary" onClick={() => setRejectOpen(false)} disabled={rejectM.isPending}>{t('common.cancel')}</Button>
          <Button variant="danger" disabled={rejectM.isPending} onClick={() => rejectM.mutate()}>{rejectM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('actions.reject')}</Button>
        </>}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('admin.rejectReason')}</span>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}

/**
 * Unified admin VM console: review-first (pending groups + singles as cards),
 * then one operational table for every VM with lifecycle actions inline.
 * Replaces the split Requests / Machines tabs.
 */
export function VmConsole({ rows, loading, catalog }: { rows: VmRequest[]; loading: boolean; catalog?: PresetCatalog }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Status | ''>('');
  const [search, setSearch] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [termTarget, setTermTarget] = useState<VmRequest | null>(null);

  const presetMap = useMemo(() => { const m: Record<string, PerfPreset> = {}; catalog?.perf.forEach((p) => (m[p.id] = p)); return m; }, [catalog]);
  const osMap = useMemo(() => { const m: Record<string, OsPreset> = {}; catalog?.os.forEach((o) => (m[o.id] = o)); return m; }, [catalog]);
  const typeLabel = (r: VmRequest) => presetMap[r.preset]?.label ?? r.preset;
  const osFamily = (r: VmRequest) => (r.os ? osMap[r.os]?.family : undefined);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['admin-all'] }); qc.invalidateQueries({ queryKey: ['admin-stats'] }); setBusy(null); };
  const run = (id: number, p: Promise<unknown>, ok: string) => { setBusy(id); p.then(() => { invalidate(); toast.success(t(ok)); }).catch(() => { setBusy(null); toast.error(t('toast.error')); }); };

  const eff = (r: VmRequest): Status => (r.expired_at ? 'expired' : r.status);
  const matchSearch = (r: VmRequest) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.user_email.toLowerCase().includes(q) || r.purpose.toLowerCase().includes(q) || (r.group_name ?? '').toLowerCase().includes(q) || (r.public_ip ?? '').toLowerCase().includes(q);
  };
  const visible = useMemo(() => rows.filter(matchSearch), [rows, search]);

  // Pending items → review cards. Group pending VMs by group; singles stand alone.
  const { pendingGroups, pendingSingles } = useMemo(() => {
    const g = new Map<string, { name: string; rows: VmRequest[] }>();
    const singles: VmRequest[] = [];
    for (const r of visible) {
      if (r.status !== 'pending') continue;
      if (r.group_id) {
        const e = g.get(r.group_id) ?? { name: r.group_name ?? r.group_id, rows: [] };
        e.rows.push(r);
        g.set(r.group_id, e);
      } else singles.push(r);
    }
    return { pendingGroups: [...g.entries()], pendingSingles: singles };
  }, [visible]);

  // Operational table: everything not a pending item (or filtered).
  const tableRows = useMemo(() => {
    let r = visible.filter((x) => x.status !== 'pending');
    if (filter) r = visible.filter((x) => eff(x) === filter);
    return [...r].sort((a, b) => (sortAsc ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  }, [visible, filter, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = tableRows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const pendingCount = pendingGroups.length + pendingSingles.length;

  const rowActions = (r: VmRequest) => {
    const b = busy === r.id;
    const st = r.vm_state ?? 'none';
    return (
      <div className="flex items-center justify-end gap-1.5">
        {r.status === 'active' && st === 'stopped' && !r.expired_at && (
          <Tool title={t('actions.start')} disabled={b} onClick={() => run(r.id, api.start(r.id), 'toast.started')} tone="text-emerald-600"><IconPlay className="h-4 w-4" /></Tool>
        )}
        {r.status === 'active' && st === 'running' && (
          <>
            <Tool title={t('actions.stop')} disabled={b} onClick={() => run(r.id, api.stop(r.id), 'toast.stopped')} tone="text-amber-600"><IconStop className="h-4 w-4" /></Tool>
            <Tool title={t('actions.reboot')} disabled={b} onClick={() => run(r.id, api.reboot(r.id), 'toast.rebooted')}><IconReboot className="h-4 w-4" /></Tool>
          </>
        )}
        {(r.status === 'active' || r.status === 'provisioning' || r.status === 'failed') && (
          <Tool title={t('actions.terminate')} disabled={b} onClick={() => setTermTarget(r)} tone="text-red-600">{b ? <Spinner className="h-4 w-4" /> : <IconTrash className="h-4 w-4" />}</Tool>
        )}
        <Link to={`/requests/${r.id}`} title={t('actions.view')} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <IconServer className="h-4 w-4" />
        </Link>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t('admin.consoleTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('admin.consoleHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t('admin.search')}
            className="h-9 w-44 rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/15"
          />
          <Select value={filter} onChange={(e) => { setFilter(e.target.value as Status | ''); setPage(0); }} className="w-40">
            {FILTERS.map((s) => <option key={s} value={s}>{s ? t(`status.${s}`) : t('admin.allStatuses')}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => setSortAsc((v) => !v)}>{sortAsc ? t('admin.oldest') : t('admin.newest')}</Button>
          <a href={api.csvUrl} download className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition hover:bg-muted">
            <IconDownload className="h-4 w-4" /> {t('admin.exportCsv')}
          </a>
        </div>
      </div>

      {/* pending extension requests */}
      {rows.some((r) => r.ext_requested_end) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm">
          <span className="font-medium text-amber-700 dark:text-amber-400">{t('admin.pendingExt', { count: rows.filter((r) => r.ext_requested_end).length })}</span>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {rows.filter((r) => r.ext_requested_end).map((r) => (
              <Link key={r.id} to={`/requests/${r.id}`} className="font-mono text-xs text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
                #{String(r.id).padStart(3, '0')} → {fmtDate(r.ext_requested_end)}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* review-first: pending groups + singles */}
      {pendingCount > 0 && !filter && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('admin.toReview')}
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500/15 px-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">{pendingCount}</span>
          </h3>
          {pendingGroups.map(([gid, grp]) => (
            <GroupReview key={gid} groupId={gid} name={grp.name} owner={grp.rows[0]?.user_email} vms={grp.rows} presets={presetMap} osFamily={(id) => (id ? osMap[id]?.family : undefined)} />
          ))}
          {pendingSingles.map((r) => (
            <SingleReview key={r.id} r={r} typeLabel={typeLabel(r)} osFamily={osFamily(r)} />
          ))}
        </div>
      )}

      {/* operational table */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : tableRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">{t('admin.noMachines')}</p>
      ) : (
        <>
          {(pendingCount > 0 && !filter) && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.allVms')}</h3>}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3.5 py-3 font-medium">{t('admin.colVm')}</th>
                    <th className="px-3.5 py-3 font-medium">{t('admin.colOwner')}</th>
                    <th className="hidden px-3.5 py-3 font-medium lg:table-cell">{t('table.type')}</th>
                    <th className="px-3.5 py-3 font-medium">{t('table.status')}</th>
                    <th className="hidden px-3.5 py-3 font-medium xl:table-cell">{t('admin.colIp')}</th>
                    <th className="hidden px-3.5 py-3 font-medium md:table-cell">{t('table.expires')}</th>
                    <th className="px-3.5 py-3 text-right font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => {
                    const fam = osFamily(r);
                    const st = r.vm_state ?? 'none';
                    return (
                      <tr key={r.id} className="border-b border-border/70 transition last:border-0 hover:bg-muted/40">
                        <td className="px-3.5 py-3">
                          <span className="flex items-center gap-2.5">
                            {fam && <OsIcon family={fam} className="h-6 w-6" />}
                            <span className="min-w-0">
                              <Link to={`/requests/${r.id}`} className="block truncate font-medium hover:underline">{r.name || `#${String(r.id).padStart(3, '0')}`}</Link>
                              <span className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] text-muted-foreground">#{String(r.id).padStart(3, '0')}</span>
                                {r.group_name && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{r.group_name}</span>}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="max-w-[12rem] truncate px-3.5 py-3 text-muted-foreground" title={r.user_email}>{r.user_email}</td>
                        <td className="hidden px-3.5 py-3 font-medium lg:table-cell">{typeLabel(r)}</td>
                        <td className="px-3.5 py-3">
                          <span className="flex items-center gap-2">
                            <StatusBadge status={displayStatus(r)} />
                            {r.status === 'active' && (st === 'running' || st === 'stopped') && (
                              <span className={`h-1.5 w-1.5 rounded-full ${st === 'running' ? 'bg-emerald-500' : 'bg-zinc-400'}`} title={t(`vmState.${st}`, st)} />
                            )}
                          </span>
                        </td>
                        <td className="hidden px-3.5 py-3 font-mono text-xs xl:table-cell">{r.public_ip ?? '—'}</td>
                        <td className="hidden whitespace-nowrap px-3.5 py-3 text-muted-foreground md:table-cell">{fmtDate(r.end_date)}</td>
                        <td className="px-3.5 py-3">{rowActions(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{safePage + 1} / {pageCount}</span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>←</Button>
                <Button variant="secondary" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>→</Button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        open={!!termTarget}
        onClose={() => setTermTarget(null)}
        title={t('confirm.terminateTitle')}
        description={t('confirm.terminateBody')}
        footer={<>
          <Button variant="secondary" onClick={() => setTermTarget(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => { if (termTarget) { run(termTarget.id, api.terminate(termTarget.id), 'toast.terminated'); setTermTarget(null); } }}>{t('actions.terminate')}</Button>
        </>}
      />
    </div>
  );
}
