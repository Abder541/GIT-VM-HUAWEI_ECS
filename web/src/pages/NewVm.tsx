import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useToast } from '../toast';
import type { OsPreset, PresetCatalog, Snapshot } from '../types';
import { Button, Card, IconBack, IconCheck, Input, Modal, Select, Spinner, Textarea } from '../ui';
import { OsIcon } from '../components/OsIcon';
import { DatePicker } from '../components/DatePicker';
import { fmtDate } from '../lib/format';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const DAY = 86400000;
const QUICK = [
  { key: 'newvm.q1d', ms: DAY },
  { key: 'newvm.q3d', ms: 3 * DAY },
  { key: 'newvm.q1w', ms: 7 * DAY },
  { key: 'newvm.q2w', ms: 14 * DAY },
  { key: 'newvm.q1m', ms: 30 * DAY },
];

interface VmCfg {
  name: string;
  perf: string;
  storage: string;
  os: string;
  course: string;
  start: string;
  end: string;
  snapshotId: string;
}

function Section({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{n}</span>
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Choice({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`relative rounded-xl border p-3.5 text-left transition ${
        selected ? 'border-primary bg-primary/[0.04] ring-2 ring-primary/20' : 'border-border bg-card hover:border-foreground/25'
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      {children}
      {selected && (
        <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
          <IconCheck className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'primary' | 'blue' }) {
  const cls = tone === 'primary' ? 'bg-primary/10 text-primary' : tone === 'blue' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{children}</span>;
}

/* ---- per-VM configuration form ---- */
// Restore GATÉ (real-name auth requise — cf. docs/design-cbr-restore.md). Le sélecteur
// « restaurer depuis un snapshot » est masqué tant que le pipeline n'est pas réactivable.
const RESTORE_ENABLED = false;

function VmConfig({ vm, onChange, catalog, snapshots }: { vm: VmCfg; onChange: (patch: Partial<VmCfg>) => void; catalog: PresetCatalog; snapshots: Snapshot[] }) {
  const { t } = useTranslation();
  const perfList = catalog.perf.filter((p) => !p.hidden);
  const storageList = catalog.storage.filter((s) => !s.hidden);
  const osList = catalog.os.filter((o) => !o.hidden);
  const osDef = catalog.os.find((o) => o.id === vm.os);
  const minGb = osDef?.minStorageGb ?? 0;
  const datesValid = (() => {
    const end = vm.end ? new Date(vm.end) : null;
    const start = vm.start ? new Date(vm.start) : null;
    return !!end && !isNaN(end.getTime()) && end.getTime() > Date.now() && (!start || (!isNaN(start.getTime()) && start.getTime() < end.getTime()));
  })();
  const startDate = vm.start ? new Date(vm.start) : null;

  return (
    <div className="space-y-8">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.vmName')}</span>
        <Input value={vm.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={t('newvm.vmNamePlaceholder')} maxLength={60} />
      </label>
      {RESTORE_ENABLED && snapshots.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/30 p-3.5">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.restore')}</span>
          <Select
            value={vm.snapshotId}
            onChange={(e) => {
              const sid = e.target.value;
              const snap = snapshots.find((s) => String(s.id) === sid);
              onChange({ snapshotId: sid, ...(snap?.os ? { os: snap.os } : {}) });
            }}
          >
            <option value="">{t('newvm.restoreNone')}</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>#{s.id}{s.os ? ` · ${s.os}` : ''} · {fmtDate(s.created_at)}</option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">{t('newvm.restoreHint')}</p>
        </div>
      )}
      <Section n={1} title={t('newvm.perf')} hint={t('newvm.perfHint')}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {perfList.map((p) => (
            <Choice key={p.id} selected={vm.perf === p.id} onClick={() => onChange({ perf: p.id })}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.label}</span>
                {p.recommended && <Badge tone="primary">{t('newvm.recommended')}</Badge>}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{p.flavor}</div>
              <div className="mt-1.5 text-sm">{p.vcpu} vCPU · {p.ramGb} {t('newvm.ram')}</div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">{p.hourlyEur.toFixed(3)} €/h</div>
            </Choice>
          ))}
        </div>
      </Section>

      <Section n={2} title={t('newvm.storage')} hint={t('newvm.storageHint')}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {storageList.map((s) => {
            const tooSmall = minGb > 0 && s.sizeGb < minGb;
            return (
              <Choice key={s.id} selected={vm.storage === s.id} disabled={tooSmall} onClick={() => onChange({ storage: s.id })}>
                <div className="font-medium">{s.label}</div>
                {s.description && <div className="mt-0.5 text-xs text-muted-foreground">{s.description}</div>}
              </Choice>
            );
          })}
        </div>
        {minGb > 0 && <p className="text-xs text-muted-foreground">{t('newvm.minStorage', { gb: minGb })}</p>}
      </Section>

      <Section n={3} title={t('newvm.os')} hint={t('newvm.osHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {osList.map((o: OsPreset) => (
            <Choice
              key={o.id}
              selected={vm.os === o.id}
              onClick={() => {
                const patch: Partial<VmCfg> = { os: o.id };
                if (o.minStorageGb) {
                  const cur = catalog.storage.find((s) => s.id === vm.storage);
                  if (cur && cur.sizeGb < o.minStorageGb) {
                    const f = catalog.storage.find((s) => !s.hidden && s.sizeGb >= o.minStorageGb!);
                    if (f) patch.storage = f.id;
                  }
                }
                onChange(patch);
              }}
            >
              <div className="flex gap-3">
                <OsIcon family={o.family} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{o.label}</span>
                    {o.recommended && <Badge tone="primary">{t('newvm.recommended')}</Badge>}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{o.description}</div>
                  <div className="mt-1.5"><Badge tone={o.connect === 'rdp' ? 'blue' : 'muted'}>{o.connect === 'rdp' ? 'RDP' : 'SSH'}</Badge></div>
                </div>
              </div>
            </Choice>
          ))}
        </div>
      </Section>

      <Section n={4} title={t('newvm.course')} hint={t('newvm.courseHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice selected={vm.course === ''} onClick={() => onChange({ course: '' })}>
            <div className="font-medium">{t('newvm.courseNone')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t('newvm.courseNoneHint')}</div>
          </Choice>
          {catalog.courses.map((c) => (
            <Choice key={c.id} selected={vm.course === c.id} onClick={() => onChange({ course: c.id })}>
              <div className="font-medium">{c.label}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.description}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {c.tools.slice(0, 6).map((tool) => (
                  <span key={tool} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tool}</span>
                ))}
                {c.tools.length > 6 && <span className="text-[10px] text-muted-foreground">+{c.tools.length - 6}</span>}
              </div>
            </Choice>
          ))}
        </div>
      </Section>

      <Section n={5} title={t('newvm.schedule')} hint={t('newvm.scheduleHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.start')}</span>
            <DatePicker value={vm.start} onChange={(v) => onChange({ start: v })} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.end')}</span>
            <DatePicker value={vm.end} min={vm.start} onChange={(v) => onChange({ end: v })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t('newvm.quickPick')} :</span>
          {QUICK.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => {
                const base = startDate && startDate.getTime() > Date.now() ? startDate : new Date();
                onChange({ end: toLocalInput(new Date(base.getTime() + q.ms)) });
              }}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {t(q.key)}
            </button>
          ))}
        </div>
        {!datesValid && <p className="text-xs text-amber-500">{t('newvm.endRequired')}</p>}
      </Section>
    </div>
  );
}

export function NewVm() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const catalogQ = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  if (!catalogQ.data)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  return <NewVmForm catalog={catalogQ.data} nav={nav} qc={qc} toast={toast} />;
}

function NewVmForm({ catalog, nav, qc, toast }: { catalog: PresetCatalog; nav: ReturnType<typeof useNavigate>; qc: ReturnType<typeof useQueryClient>; toast: ReturnType<typeof useToast> }) {
  const { t } = useTranslation();
  const makeDefault = (): VmCfg => ({
    name: '',
    perf: catalog.perf.find((p) => p.recommended)?.id ?? catalog.perf.find((p) => !p.hidden)?.id ?? '',
    storage: catalog.storage.find((s) => s.recommended)?.id ?? catalog.storage.find((s) => !s.hidden && s.sizeGb >= 30)?.id ?? '',
    os: catalog.os.find((o) => o.recommended)?.id ?? catalog.os.find((o) => !o.hidden)?.id ?? '',
    course: '',
    start: toLocalInput(new Date()),
    end: toLocalInput(new Date(Date.now() + 7 * DAY)),
    snapshotId: '',
  });

  const snapshotsQ = useQuery({ queryKey: ['user-snapshots'], queryFn: api.userSnapshots });
  const completedSnaps = useMemo(() => (snapshotsQ.data ?? []).filter((s) => s.status === 'completed'), [snapshotsQ.data]);

  const [vms, setVms] = useState<VmCfg[]>([makeDefault()]);
  const [active, setActive] = useState(0);
  const [groupName, setGroupName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);

  const count = vms.length;
  const setCount = (n: number) => {
    setVms((prev) => {
      if (n === prev.length) return prev;
      if (n < prev.length) return prev.slice(0, n);
      return [...prev, ...Array.from({ length: n - prev.length }, makeDefault)];
    });
    setActive((a) => Math.min(a, n - 1));
  };
  const updateActive = (patch: Partial<VmCfg>) => setVms((prev) => prev.map((v, i) => (i === active ? { ...v, ...patch } : v)));
  const applyToAll = () => setVms((prev) => prev.map(() => ({ ...prev[active] })));

  const validVm = (vm: VmCfg) => {
    if (!vm.name.trim() || !vm.perf || !vm.storage || !vm.os) return false;
    const end = vm.end ? new Date(vm.end) : null;
    const start = vm.start ? new Date(vm.start) : null;
    if (!end || isNaN(end.getTime()) || end.getTime() <= Date.now()) return false;
    if (start && (isNaN(start.getTime()) || start.getTime() >= end.getTime())) return false;
    const osDef = catalog.os.find((o) => o.id === vm.os);
    const sDef = catalog.storage.find((s) => s.id === vm.storage);
    if (osDef?.minStorageGb && sDef && sDef.sizeGb < osDef.minStorageGb) return false;
    return true;
  };
  const monthlyOf = (vm: VmCfg) => {
    const p = catalog.perf.find((x) => x.id === vm.perf);
    const s = catalog.storage.find((x) => x.id === vm.storage);
    return p && s ? p.hourlyEur * 730 + s.sizeGb * catalog.storageUsdGbMonth : 0;
  };
  const totalMonthly = useMemo(() => vms.reduce((a, v) => a + monthlyOf(v), 0), [vms]);
  const allValid = vms.every(validVm);
  const needsGroup = count > 1;

  const m = useMutation({
    mutationFn: () =>
      api.createBatch(
        vms.map((v) => ({ name: v.name.trim(), perf: v.perf, storage: v.storage, os: v.os, purpose: purpose.trim(), startDate: v.start ? new Date(v.start).toISOString() : null, endDate: new Date(v.end).toISOString(), course: v.course, snapshotId: v.snapshotId ? Number(v.snapshotId) : null })),
        needsGroup ? { name: groupName.trim() } : undefined
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      setShowSubmit(false);
      toast.success(t('newvm.createdN', { count: res.ids.length }));
      if (res.groupId || res.ids.length > 1) nav('/');
      else nav(`/requests/${res.ids[0]}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.message === 'rate_limited') toast.error(t('toast.rateLimited'));
      else toast.error(t('toast.error'));
    },
  });

  return (
    <div className="space-y-7">
      <div>
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
          <IconBack className="h-4 w-4" /> {t('nav.dashboard')}
        </Link>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('newvm.eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('newvm.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('newvm.subtitle')}</p>
      </div>

      {/* quantity */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{t('newvm.quantity')}</span>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={`grid h-9 w-9 place-items-center rounded-lg border text-sm font-semibold transition ${
                count === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {count > 1 && (
          <button type="button" onClick={applyToAll} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {t('newvm.applyAll')}
          </button>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {count > 1 && (
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/40 p-1">
              {vms.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${active === i ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {v.name.trim() || t('newvm.vmN', { n: i + 1 })}
                  <span className={`h-1.5 w-1.5 rounded-full ${validVm(v) ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                </button>
              ))}
            </div>
          )}

          <VmConfig vm={vms[active]} onChange={updateActive} catalog={catalog} snapshots={completedSnaps} />

          {count > 1 && (
            <p className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
              {t('newvm.groupForced')}
            </p>
          )}
        </div>

        {/* summary */}
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <Card className="p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('newvm.summary')}</h2>
            <div className="mt-3 space-y-2">
              {vms.map((v, i) => {
                const osDef = catalog.os.find((o) => o.id === v.os);
                return (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5">
                      {osDef && <OsIcon family={osDef.family} className="h-4 w-4" />}
                      {v.name.trim() || (count > 1 ? t('newvm.vmN', { n: i + 1 }) : (osDef?.label ?? '—'))}
                    </span>
                    <span className="text-right text-xs text-muted-foreground tabular-nums">≈ ${monthlyOf(v).toFixed(0)}/{t('newvm.month')}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">{t('newvm.estCost')}</span>
                <span className="text-lg font-semibold tabular-nums">≈ ${totalMonthly.toFixed(2)}</span>
              </div>
              <div className="mt-0.5 text-right text-xs text-muted-foreground">/{t('newvm.month')}</div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('newvm.costNote')}</p>
            <Button className="mt-4 w-full" disabled={!allValid} onClick={() => setShowSubmit(true)}>
              {t('newvm.submitN', { count })}
            </Button>
          </Card>
        </aside>
      </div>

      <Modal
        open={showSubmit}
        onClose={() => { if (!m.isPending) setShowSubmit(false); }}
        title={t('newvm.justifyTitle')}
        description={count > 1 ? t('newvm.justifyHintGroup') : t('newvm.justifyHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowSubmit(false)} disabled={m.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => m.mutate()} disabled={!purpose.trim() || (needsGroup && !groupName.trim()) || m.isPending}>
              {m.isPending ? <Spinner className="h-4 w-4" /> : null}
              {m.isPending ? t('newvm.submitting') : t('newvm.submitN', { count })}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {needsGroup && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.groupNameLabel')}</span>
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('newvm.groupNamePlaceholder')} autoFocus />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.justifyLabel')}</span>
            <Textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('newvm.purposePlaceholder')} />
          </label>
        </div>
      </Modal>
    </div>
  );
}
