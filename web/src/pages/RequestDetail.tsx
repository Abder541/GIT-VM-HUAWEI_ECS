import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmtDate, fmtUptime } from '../lib/format';
import { displayStatus } from '../lib/status';
import { Button, Card, IconBack, IconPlay, IconReboot, IconStop, IconTrash, Modal, Skeleton, Spinner } from '../ui';
import { StatusBadge } from '../components/StatusBadge';
import { OsIcon } from '../components/OsIcon';
import { ConnectionGuide } from '../components/ConnectionGuide';
import { SchedulePanel } from '../components/SchedulePanel';
import { SnapshotPanel } from '../components/SnapshotPanel';
import { ExtensionPanel } from '../components/ExtensionPanel';
import { AdminReviewPanel } from '../components/AdminReviewPanel';
import { useToast } from '../toast';

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`text-right ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{children}</span>
    </div>
  );
}
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>;
}

function ProvisionSteps({ status }: { status: string }) {
  const { t } = useTranslation();
  const steps = [t('detail.stepRequested'), t('detail.stepApproved'), t('detail.stepProvisioning'), t('detail.stepActive')];
  const idx = status === 'pending' ? 0 : status === 'approved' ? 1 : status === 'provisioning' ? 2 : 3;
  return (
    <div className="flex items-center">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div className="flex items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
                i < idx ? 'bg-primary text-primary-foreground' : i === idx ? 'bg-primary/15 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < idx ? '✓' : i + 1}
            </span>
            <span className={`whitespace-nowrap text-xs ${i <= idx ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>{label}</span>
          </div>
          {i < steps.length - 1 && <span className={`mx-2 h-px flex-1 ${i < idx ? 'bg-primary' : 'bg-border'}`} />}
        </div>
      ))}
    </div>
  );
}

type Tab = 'overview' | 'access' | 'snapshots' | 'schedule';
const TAB_ICON: Record<Tab, string> = {
  overview: 'M4 5h16M4 12h16M4 19h10',
  access: 'M15 7a2 2 0 0 1 2 2m4-2a6 6 0 0 1-7.7 5.7l-1.6 1.6H10v2H8v2H4v-4l5.3-5.3A6 6 0 1 1 21 7z',
  snapshots: 'M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9m18 0H3m18 0 1.5 3a1 1 0 0 1-.9 1.4H2.4a1 1 0 0 1-.9-1.4L3 15',
  schedule: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
};

export function RequestDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const rid = Number(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmTerm, setConfirmTerm] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  const q = useQuery({
    queryKey: ['request', rid],
    queryFn: () => api.getRequest(rid),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      if (d.status === 'provisioning') return 5000;
      if (d.status === 'active' && d.course && !d.course_ready_at) return 15000; // wait for cloud-init
      return false;
    },
  });
  const meQ = useQuery({ queryKey: ['me'], queryFn: api.me });
  const presetsQ = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const liveQ = useQuery({
    queryKey: ['live', rid],
    queryFn: () => api.live(rid),
    enabled: q.data?.status === 'active',
    refetchInterval: 10000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['request', rid] });
    qc.invalidateQueries({ queryKey: ['live', rid] });
    qc.invalidateQueries({ queryKey: ['requests'] });
  };
  const onErr = () => toast.error(t('toast.error'));
  const termM = useMutation({
    mutationFn: () => api.terminate(rid),
    onSuccess: () => { refresh(); setConfirmTerm(false); toast.success(t('toast.terminated')); },
    onError: onErr,
  });
  const startM = useMutation({ mutationFn: () => api.start(rid), onSuccess: () => { refresh(); toast.success(t('toast.started')); }, onError: onErr });
  const stopM = useMutation({ mutationFn: () => api.stop(rid), onSuccess: () => { refresh(); toast.success(t('toast.stopped')); }, onError: onErr });
  const rebootM = useMutation({ mutationFn: () => api.reboot(rid), onSuccess: () => { refresh(); toast.success(t('toast.rebooted')); }, onError: onErr });
  const resetM = useMutation({ mutationFn: () => api.reset(rid), onSuccess: () => { refresh(); setConfirmReset(false); toast.success(t('toast.reset')); }, onError: onErr });
  const busy = startM.isPending || stopM.isPending || rebootM.isPending;

  if (q.isLoading)
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
          <IconBack className="h-4 w-4" /> {t('common.back')}
        </Link>
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <p className="font-medium">{t('common.error')}</p>
          <p className="text-sm text-muted-foreground">{t('detail.notFound')}</p>
        </Card>
      </div>
    );

  const r = q.data;
  const effStatus = displayStatus(r);
  const cat = presetsQ.data;
  const perfDef = cat?.perf.find((p) => p.id === r.preset);
  const storageDef = cat?.storage.find((s) => s.id === r.storage);
  const osDef = cat?.os.find((o) => o.id === r.os);
  const courseDef = cat?.courses.find((c) => c.id === r.course);
  const connect = (r.connect_method as 'ssh' | 'rdp') ?? osDef?.connect ?? 'ssh';
  const sshUser = r.ssh_user ?? osDef?.sshUser ?? 'ubuntu';
  const keyName = r.ssh_key_name ?? `vm-portal-req-${r.id}`;
  const vmState = liveQ.data?.state ?? r.vm_state ?? 'none';
  const ip = liveQ.data?.publicIp ?? r.public_ip ?? null;
  const canTerm = r.status === 'active' || r.status === 'provisioning' || r.status === 'failed';
  const isAdmin = meQ.data?.role === 'admin';
  const live = r.status === 'active' && !r.expired_at;

  const tabs: { id: Tab; label: string }[] = live
    ? [
        { id: 'overview', label: t('detail.tabOverview') },
        { id: 'access', label: t('detail.tabAccess') },
        { id: 'snapshots', label: t('detail.tabSnapshots') },
        { id: 'schedule', label: t('detail.tabSchedule') },
      ]
    : [{ id: 'overview', label: t('detail.tabOverview') }];
  const cur = tabs.some((x) => x.id === tab) ? tab : 'overview';

  const overview = (
    <div className="space-y-5">
      {(r.status === 'pending' || r.status === 'approved' || r.status === 'provisioning') && (
        <Card className="p-5"><ProvisionSteps status={r.status} /></Card>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card className="p-5">
          <Eyebrow>{t('detail.specs')}</Eyebrow>
          <div className="divide-y divide-border">
            <Row label={t('form.os')}>
              <span className="inline-flex items-center gap-1.5">
                {osDef && <OsIcon family={osDef.family} className="h-4 w-4" />}
                {osDef?.label ?? r.os ?? '—'}
              </span>
            </Row>
            <Row label={t('detail.instanceType')} mono>{perfDef?.flavor ?? r.preset}</Row>
            <Row label={t('detail.cpu')}>{perfDef ? `${perfDef.vcpu} vCPU` : '—'}</Row>
            <Row label={t('detail.memory')}>{perfDef ? `${perfDef.ramGb} Go` : '—'}</Row>
            <Row label={t('detail.disk')}>{storageDef?.label ?? r.storage ?? '—'}</Row>
            <Row label={t('detail.connectMethod')}>{connect === 'rdp' ? 'RDP' : 'SSH'}</Row>
            {courseDef && <Row label={t('newvm.course')}>{courseDef.label}</Row>}
            <Row label={t('common.region')} mono>{r.region}</Row>
          </div>
          {courseDef && (
            <div className="mt-3 border-t border-border pt-3">
              {r.status === 'active' && (
                <div className="mb-2 text-xs font-medium">
                  {r.course_ready_at ? (
                    <span className="text-emerald-600 dark:text-emerald-400">✓ {t('detail.toolsReady')}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <Spinner className="h-3.5 w-3.5" /> {t('detail.toolsInstalling')}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {courseDef.tools.map((tool) => (
                  <span key={tool} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tool}</span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <Eyebrow>{t('detail.overview')}</Eyebrow>
          <div className="divide-y divide-border">
            <Row label={t('table.purpose')}>{r.purpose}</Row>
            <Row label={t('detail.requestedBy')}>{r.user_email}</Row>
            <Row label={t('detail.createdAt')}>{fmtDate(r.created_at)}</Row>
            {r.start_date && <Row label={t('detail.startDate')}>{fmtDate(r.start_date)}</Row>}
            <Row label={t('detail.endDate')}>{fmtDate(r.end_date)}</Row>
            {r.decided_by && <Row label={t('detail.decidedBy')}>{r.decided_by}</Row>}
            {r.admin_note && <Row label={t('detail.adminNote')}>{r.admin_note}</Row>}
            {r.status === 'active' && (
              <Row label={t('detail.state')}>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${vmState === 'running' ? 'bg-emerald-500' : vmState === 'stopped' ? 'bg-zinc-400' : 'bg-amber-500'}`} />
                  {t(`vmState.${vmState}`, vmState)}
                </span>
              </Row>
            )}
            {vmState === 'running' && liveQ.data?.launchTime && <Row label={t('detail.uptime')}>{fmtUptime(liveQ.data.launchTime)}</Row>}
            {ip && <Row label={t('detail.ip')} mono>{ip}</Row>}
            {r.server_id && <Row label={t('detail.instance')} mono>{r.server_id}</Row>}
          </div>
        </Card>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
        <IconBack className="h-4 w-4" /> {t('common.back')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {osDef && <OsIcon family={osDef.family} className="h-10 w-10" />}
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{r.name || t('detail.title', { id: r.id })}</h1>
              <StatusBadge status={effStatus} />
            </div>
            <p className="text-sm text-muted-foreground">{osDef?.label ?? r.os} · #{String(r.id).padStart(3, '0')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {r.status === 'active' && vmState === 'stopped' && !r.expired_at && (
            <Button variant="secondary" disabled={busy} onClick={() => startM.mutate()}>
              <IconPlay className="h-4 w-4 text-emerald-600" /> {t('actions.start')}
            </Button>
          )}
          {r.status === 'active' && vmState === 'running' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => stopM.mutate()}>
                <IconStop className="h-4 w-4 text-amber-600" /> {t('actions.stop')}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => rebootM.mutate()}>
                <IconReboot className="h-4 w-4" /> {t('actions.reboot')}
              </Button>
            </>
          )}
          {r.status === 'active' && !r.expired_at && (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmReset(true)}>
              <IconReboot className="h-4 w-4" /> {t('actions.reset')}
            </Button>
          )}
          {canTerm && (
            <Button variant="danger" onClick={() => setConfirmTerm(true)}>
              <IconTrash className="h-4 w-4" /> {t('actions.terminate')}
            </Button>
          )}
        </div>
      </div>

      {isAdmin && r.status === 'pending' && (
        <Card className="border-primary/20 p-5">
          <Eyebrow>{t('admin.review')}</Eyebrow>
          <AdminReviewPanel request={r} />
        </Card>
      )}

      {tabs.length > 1 && (
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                cur === tb.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={TAB_ICON[tb.id]} /></svg>
              {tb.label}
            </button>
          ))}
        </div>
      )}

      {cur === 'overview' && overview}

      {cur === 'access' && (
        <Card className="p-5">
          <Eyebrow>{t('guide.title')}</Eyebrow>
          {r.status === 'active' && ip && vmState !== 'stopped' ? (
            <ConnectionGuide id={r.id} ip={ip} user={sshUser} keyName={keyName} connect={connect} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('detail.notReady')}</p>
          )}
        </Card>
      )}

      {cur === 'snapshots' && (
        <Card className="p-5">
          <Eyebrow>{t('snapshot.title')}</Eyebrow>
          <SnapshotPanel request={r} />
        </Card>
      )}

      {cur === 'schedule' && (
        <div className="space-y-5">
          <Card className="p-5">
            <Eyebrow>{t('extension.title')}</Eyebrow>
            <ExtensionPanel request={r} isAdmin={isAdmin} isOwner={meQ.data?.email === r.user_email} />
          </Card>
          <Card className="p-5">
            <Eyebrow>{t('schedule.title')}</Eyebrow>
            <SchedulePanel request={r} />
          </Card>
        </div>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t('confirm.resetTitle')}
        description={t('confirm.resetBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)} disabled={resetM.isPending}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => resetM.mutate()} disabled={resetM.isPending}>
              {resetM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('actions.reset')}
            </Button>
          </>
        }
      />

      <Modal
        open={confirmTerm}
        onClose={() => setConfirmTerm(false)}
        title={t('confirm.terminateTitle')}
        description={t('confirm.terminateBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmTerm(false)} disabled={termM.isPending}>{t('common.cancel')}</Button>
            <Button variant="danger" onClick={() => termM.mutate()} disabled={termM.isPending}>
              {termM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('actions.terminate')}
            </Button>
          </>
        }
      />
    </div>
  );
}
