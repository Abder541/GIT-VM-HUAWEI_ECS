import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { PerfPreset, VmRequest } from '../types';
import { displayStatus } from '../lib/status';
import { Button, Card, IconPlay, IconPlus, IconReboot, IconServer, IconStop, IconTrash, Input, Modal, Spinner, TableSkeleton } from '../ui';
import { useToast } from '../toast';
import { StatusBadge } from '../components/StatusBadge';
import { OsIcon } from '../components/OsIcon';
import { RequestsTable } from '../components/RequestsTable';
import { GroupActions } from '../components/GroupActions';

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
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

function GIcon({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}

export function MyVms() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [termTarget, setTermTarget] = useState<VmRequest | null>(null);
  const [delTarget, setDelTarget] = useState<VmRequest | null>(null);
  const [groupTermId, setGroupTermId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [newGroupName, setNewGroupName] = useState('');
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('gitvm_onboarded') === '1');

  const presetsQ = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const reqQ = useQuery({
    queryKey: ['requests'],
    queryFn: api.listRequests,
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'provisioning' || r.status === 'approved') ? 5000 : false),
  });

  const presetMap = useMemo(() => {
    const m: Record<string, PerfPreset> = {};
    presetsQ.data?.perf.forEach((p) => (m[p.id] = p));
    return m;
  }, [presetsQ.data]);
  const osLabel = useMemo(() => {
    const m: Record<string, string> = {};
    presetsQ.data?.os.forEach((o) => (m[o.id] = o.label));
    return m;
  }, [presetsQ.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests'] });
  const onErr = () => toast.error(t('toast.error'));
  const termM = useMutation({ mutationFn: (id: number) => api.terminate(id), onSuccess: () => { invalidate(); setTermTarget(null); toast.success(t('toast.terminated')); }, onError: onErr });
  const delM = useMutation({ mutationFn: (id: number) => api.deleteRequest(id), onSuccess: () => { invalidate(); setDelTarget(null); toast.success(t('toast.deleted')); }, onError: onErr });
  const groupActM = useMutation({ mutationFn: (v: { groupId: string; action: 'start' | 'stop' | 'reboot' | 'terminate' }) => api.groupAction(v.groupId, v.action), onSuccess: () => { invalidate(); setGroupTermId(null); toast.success(t('toast.groupDone')); }, onError: onErr });
  const renameM = useMutation({ mutationFn: (v: { groupId: string; name: string }) => api.groupRename(v.groupId, v.name), onSuccess: () => { invalidate(); setRenameId(null); toast.success(t('toast.renamed')); }, onError: onErr });
  const dissolveM = useMutation({ mutationFn: (groupId: string) => api.groupDissolve(groupId), onSuccess: () => { invalidate(); toast.success(t('toast.groupDone')); }, onError: onErr });
  const createGroupM = useMutation({
    mutationFn: () => api.createGroup(newGroupName.trim(), [...selected]),
    onSuccess: () => { invalidate(); setSelecting(false); setSelected(new Set()); setNewGroupName(''); toast.success(t('toast.groupCreated')); },
    onError: onErr,
  });

  const rows = reqQ.data ?? [];
  const now = Date.now();
  const isExpired = (r: VmRequest) => !!r.expired_at;
  const stats = {
    total: rows.length,
    active: rows.filter((r) => r.status === 'active' && !isExpired(r)).length,
    provisioning: rows.filter((r) => r.status === 'provisioning').length,
    expiring: rows.filter((r) => { if (r.status !== 'active' || isExpired(r) || !r.end_date) return false; const e = new Date(r.end_date).getTime(); return e > now && e - now <= 24 * 3600 * 1000; }).length,
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.purpose.toLowerCase().includes(q) ||
      (r.os ? (osLabel[r.os] ?? r.os).toLowerCase().includes(q) : false) ||
      (r.public_ip ?? '').toLowerCase().includes(q) ||
      (r.group_name ?? '').toLowerCase().includes(q)
    );
  }, [rows, search, osLabel]);

  // Split into groups + ungrouped.
  const { groups, ungrouped } = useMemo(() => {
    const g = new Map<string, { name: string; rows: VmRequest[] }>();
    const un: VmRequest[] = [];
    for (const r of filtered) {
      if (r.group_id) {
        const e = g.get(r.group_id) ?? { name: r.group_name ?? r.group_id, rows: [] };
        e.rows.push(r);
        g.set(r.group_id, e);
      } else un.push(r);
    }
    return { groups: [...g.entries()], ungrouped: un };
  }, [filtered]);

  const toggleSel = (id: number) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const dismissOnboarding = () => { localStorage.setItem('gitvm_onboarded', '1'); setOnboarded(true); };

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('myvms.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('myvms.title')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('myvms.subtitle')}</p>
        </div>
        <Link to="/new"><Button><IconPlus className="h-4 w-4" />{t('myvms.new')}</Button></Link>
      </div>

      {!onboarded && (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <div className="min-w-0">
            <p className="font-medium">{t('myvms.welcomeTitle')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('myvms.welcomeBody')}</p>
          </div>
          <button onClick={dismissOnboarding} className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted">{t('myvms.welcomeDismiss')}</button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('myvms.statTotal')} value={stats.total} dot="bg-foreground/40" />
          <Stat label={t('myvms.statActive')} value={stats.active} dot="bg-emerald-500" />
          <Stat label={t('myvms.statProvisioning')} value={stats.provisioning} dot="bg-blue-500" />
          <Stat label={t('myvms.statExpiring')} value={stats.expiring} dot="bg-orange-500" />
        </div>
      )}

      {reqQ.isLoading ? (
        <TableSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-border bg-muted text-muted-foreground"><IconServer /></div>
          <div>
            <p className="font-medium">{t('myvms.empty')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('myvms.emptyHint')}</p>
          </div>
          <Link to="/new" className="mt-1"><Button><IconPlus className="h-4 w-4" />{t('myvms.new')}</Button></Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {ungrouped.length > 1 ? (
              <Button variant="secondary" onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }}>
                {selecting ? t('myvms.organizeCancel') : t('myvms.organize')}
              </Button>
            ) : <span />}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('myvms.search')}
              className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">{t('myvms.noMatch')}</p>
          ) : (
            <>
              {/* groups */}
              {groups.map(([gid, grp]) => (
                <Card key={gid} className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <IconServer className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{grp.name}</span>
                      <span className="text-xs text-muted-foreground">· {t('myvms.vmCount', { count: grp.rows.length })}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <GIcon title={t('actions.start')} onClick={() => groupActM.mutate({ groupId: gid, action: 'start' })}><IconPlay className="h-4 w-4 text-emerald-600" /></GIcon>
                      <GIcon title={t('actions.stop')} onClick={() => groupActM.mutate({ groupId: gid, action: 'stop' })}><IconStop className="h-4 w-4 text-amber-600" /></GIcon>
                      <GIcon title={t('actions.reboot')} onClick={() => groupActM.mutate({ groupId: gid, action: 'reboot' })}><IconReboot className="h-4 w-4" /></GIcon>
                      <GIcon title={t('actions.terminate')} onClick={() => setGroupTermId(gid)}><IconTrash className="h-4 w-4 text-red-600" /></GIcon>
                      <span className="mx-1 h-5 w-px bg-border" />
                      <GroupActions groupId={gid} />
                      <button onClick={() => { setRenameId(gid); setRenameVal(grp.name); }} className="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">{t('myvms.rename')}</button>
                      <button onClick={() => dissolveM.mutate(gid)} className="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">{t('myvms.dissolve')}</button>
                    </div>
                  </div>
                  <div className="p-3">
                    <RequestsTable rows={grp.rows} presets={presetMap} onTerminate={setTermTarget} onDelete={setDelTarget} />
                  </div>
                </Card>
              ))}

              {/* ungrouped */}
              {ungrouped.length > 0 && (
                <div className="space-y-3">
                  {groups.length > 0 && <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('myvms.noGroup')}</h2>}
                  {selecting ? (
                    <Card className="divide-y divide-border">
                      {ungrouped.map((r) => (
                        <label key={r.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-muted/40">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} className="h-4 w-4 rounded border-border" />
                          <span className="font-mono text-xs text-muted-foreground">#{String(r.id).padStart(3, '0')}</span>
                          {r.os && presetsQ.data && <OsIcon family={presetsQ.data.os.find((o) => o.id === r.os)?.family ?? 'ubuntu'} className="h-5 w-5" />}
                          <span className="flex-1 truncate text-sm">{r.purpose}</span>
                          <StatusBadge status={displayStatus(r)} />
                        </label>
                      ))}
                    </Card>
                  ) : (
                    <RequestsTable rows={ungrouped} presets={presetMap} onTerminate={setTermTarget} onDelete={setDelTarget} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* organize floating bar */}
      {selecting && selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-xl border border-border bg-elevated p-2 shadow-2xl shadow-black/20">
          <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder={t('newvm.groupNamePlaceholder')} className="flex-1" />
          <Button disabled={!newGroupName.trim() || createGroupM.isPending} onClick={() => createGroupM.mutate()}>
            {createGroupM.isPending ? <Spinner className="h-4 w-4" /> : null}
            {t('myvms.createGroupBtn', { count: selected.size })}
          </Button>
        </div>
      )}

      {/* modals */}
      <Modal open={!!termTarget} onClose={() => setTermTarget(null)} title={t('confirm.terminateTitle')} description={t('confirm.terminateBody')}
        footer={<><Button variant="secondary" onClick={() => setTermTarget(null)} disabled={termM.isPending}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => termTarget && termM.mutate(termTarget.id)} disabled={termM.isPending}>{termM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('actions.terminate')}</Button></>} />

      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title={t('myvms.deleteTitle')} description={t('myvms.deleteBody')}
        footer={<><Button variant="secondary" onClick={() => setDelTarget(null)} disabled={delM.isPending}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => delTarget && delM.mutate(delTarget.id)} disabled={delM.isPending}>{delM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('common.delete')}</Button></>} />

      <Modal open={!!groupTermId} onClose={() => setGroupTermId(null)} title={t('myvms.groupTermTitle')} description={t('myvms.groupTermBody')}
        footer={<><Button variant="secondary" onClick={() => setGroupTermId(null)} disabled={groupActM.isPending}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => groupTermId && groupActM.mutate({ groupId: groupTermId, action: 'terminate' })} disabled={groupActM.isPending}>{groupActM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('actions.terminate')}</Button></>} />

      <Modal open={!!renameId} onClose={() => setRenameId(null)} title={t('myvms.renameTitle')}
        footer={<><Button variant="secondary" onClick={() => setRenameId(null)} disabled={renameM.isPending}>{t('common.cancel')}</Button><Button onClick={() => renameId && renameVal.trim() && renameM.mutate({ groupId: renameId, name: renameVal.trim() })} disabled={!renameVal.trim() || renameM.isPending}>{renameM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('myvms.rename')}</Button></>}>
        <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} placeholder={t('newvm.groupNamePlaceholder')} />
      </Modal>
    </div>
  );
}
