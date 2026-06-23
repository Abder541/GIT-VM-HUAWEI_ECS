import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useToast } from '../toast';
import type { PresetCatalog } from '../types';
import { Button, Card, IconBack, Input, Select, Spinner, Textarea } from '../ui';
import { OsIcon } from '../components/OsIcon';
import { DatePicker } from '../components/DatePicker';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAY = 86400000;

export function TrainerBatch() {
  const { t } = useTranslation();
  const catalogQ = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const usersQ = useQuery({ queryKey: ['trainer-users'], queryFn: api.trainerUsers });
  if (!catalogQ.data) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> {t('common.loading')}</div>;
  return <Form catalog={catalogQ.data} users={usersQ.data ?? []} />;
}

function Form({ catalog, users }: { catalog: PresetCatalog; users: { email: string; name: string | null }[] }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const perfList = catalog.perf.filter((p) => !p.hidden);
  const storageList = catalog.storage.filter((s) => !s.hidden);
  const osList = catalog.os.filter((o) => !o.hidden);

  const [perf, setPerf] = useState(catalog.perf.find((p) => p.recommended)?.id ?? perfList[0]?.id ?? '');
  const [storage, setStorage] = useState(catalog.storage.find((s) => s.recommended)?.id ?? storageList[0]?.id ?? '');
  const [os, setOs] = useState(catalog.os.find((o) => o.recommended)?.id ?? osList[0]?.id ?? '');
  const [course, setCourse] = useState('');
  const [baseName, setBaseName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [count, setCount] = useState(5);
  const [start, setStart] = useState(toLocalInput(new Date()));
  const [end, setEnd] = useState(toLocalInput(new Date(Date.now() + 7 * DAY)));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const osDef = catalog.os.find((o) => o.id === os);
  const minGb = osDef?.minStorageGb ?? 0;
  const toggle = (email: string) => setSelected((p) => { const n = new Set(p); n.has(email) ? n.delete(email) : n.add(email); return n; });

  const shownUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? users.filter((u) => u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)) : users;
  }, [users, filter]);

  // Round-robin distribution preview: VM i -> user[i % M].
  const dist = useMemo(() => {
    const list = [...selected];
    if (!list.length) return [] as { email: string; n: number }[];
    return list.map((email, idx) => ({ email, n: Math.floor(count / list.length) + (idx < count % list.length ? 1 : 0) }));
  }, [selected, count]);

  const datesValid = (() => {
    const e = end ? new Date(end) : null;
    const s = start ? new Date(start) : null;
    return !!e && !isNaN(e.getTime()) && e.getTime() > Date.now() && (!s || (!isNaN(s.getTime()) && s.getTime() < e.getTime()));
  })();
  const storageOk = !(minGb > 0 && (catalog.storage.find((s) => s.id === storage)?.sizeGb ?? 0) < minGb);
  const valid = !!perf && !!storage && !!os && baseName.trim() && groupName.trim() && purpose.trim()
    && count >= 1 && count <= 30 && selected.size >= 1 && selected.size <= count && datesValid && storageOk;

  const m = useMutation({
    mutationFn: () => api.trainerBatch({
      perf, storage, os, course, baseName: baseName.trim(), groupName: groupName.trim(), purpose: purpose.trim(),
      count, userEmails: [...selected], startDate: start ? new Date(start).toISOString() : null, endDate: new Date(end).toISOString(),
    }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['requests'] }); toast.success(t('trainer.created', { count: res.ids.length })); nav('/'); },
    onError: (e) => toast.error(e instanceof ApiError && e.message === 'rate_limited' ? t('toast.rateLimited') : t('toast.error')),
  });

  return (
    <div className="space-y-7">
      <div>
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground">
          <IconBack className="h-4 w-4" /> {t('nav.dashboard')}
        </Link>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('trainer.eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('trainer.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('trainer.subtitle')}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* config */}
          <Card className="space-y-4 p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('trainer.config')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.perf')}</span>
                <Select value={perf} onChange={(e) => setPerf(e.target.value)}>{perfList.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.vcpu}vCPU/{p.ramGb}Go</option>)}</Select>
              </label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.os')}</span>
                <Select value={os} onChange={(e) => setOs(e.target.value)}>{osList.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
              </label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.storage')}</span>
                <Select value={storage} onChange={(e) => setStorage(e.target.value)}>{storageList.map((s) => <option key={s.id} value={s.id} disabled={minGb > 0 && s.sizeGb < minGb}>{s.label}</option>)}</Select>
              </label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.course')}</span>
                <Select value={course} onChange={(e) => setCourse(e.target.value)}>
                  <option value="">{t('newvm.courseNone')}</option>
                  {catalog.courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.start')}</span>
                <DatePicker value={start} onChange={setStart} />
              </label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.end')}</span>
                <DatePicker value={end} min={start} onChange={setEnd} />
              </label>
            </div>
            {!storageOk && <p className="text-xs text-amber-500">{t('newvm.minStorage', { gb: minGb })}</p>}
          </Card>

          {/* count + names */}
          <Card className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('trainer.count')}</span>
                <Input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 1))))} />
              </label>
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('trainer.baseName')}</span>
                <Input value={baseName} onChange={(e) => setBaseName(e.target.value)} placeholder={t('trainer.baseNamePlaceholder')} maxLength={50} />
              </label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.groupNameLabel')}</span>
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('newvm.groupNamePlaceholder')} maxLength={80} />
              </label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('newvm.justifyLabel')}</span>
                <Textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t('newvm.purposePlaceholder')} />
              </label>
            </div>
          </Card>

          {/* users */}
          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('trainer.assignTo')}</h2>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('admin.search')} className="h-8 w-44 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15" />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
              {shownUsers.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('trainer.noUsers')}</p>
              ) : shownUsers.map((u) => (
                <label key={u.email} className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition hover:bg-muted/50">
                  <input type="checkbox" checked={selected.has(u.email)} onChange={() => toggle(u.email)} className="h-4 w-4 rounded border-border" />
                  <span className="min-w-0 flex-1 truncate text-sm">{u.email}</span>
                  {u.name && <span className="shrink-0 text-xs text-muted-foreground">{u.name}</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('trainer.selectedCount', { count: selected.size })}</p>
          </Card>
        </div>

        {/* summary */}
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <Card className="p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('trainer.distribution')}</h2>
            <div className="mt-3 flex items-center gap-2 text-sm">
              {osDef && <OsIcon family={osDef.family} className="h-5 w-5" />}
              <span className="font-medium">{t('trainer.summary', { count, users: selected.size })}</span>
            </div>
            {dist.length > 0 ? (
              <div className="mt-3 max-h-52 space-y-1.5 overflow-y-auto">
                {dist.map((d) => (
                  <div key={d.email} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{d.email}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{t('trainer.nVms', { count: d.n })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t('trainer.pickUsers')}</p>
            )}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t('trainer.approvalNote')}</p>
            <Button className="mt-4 w-full" disabled={!valid || m.isPending} onClick={() => m.mutate()}>
              {m.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t('trainer.submit', { count })}
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
