import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useToast } from '../toast';
import { Button, Modal, Spinner } from '../ui';
import { DatePicker } from './DatePicker';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Group-level schedule + extension (applies to every VM in the group).
export function GroupActions({ groupId }: { groupId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'fr';
  const qc = useQueryClient();
  const toast = useToast();
  const [schedOpen, setSchedOpen] = useState(false);
  const [extOpen, setExtOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [start, setStart] = useState('08:00');
  const [stop, setStop] = useState('18:00');
  const [days, setDays] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5]));
  const [until, setUntil] = useState(() => toInput(new Date(Date.now() + 7 * 86400000)));

  const dayLabels = useMemo(() => {
    const base = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString(lang, { weekday: 'short' }));
  }, [lang]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests'] });
  const schedM = useMutation({
    mutationFn: () => api.groupSchedule(groupId, enabled ? { enabled, start, stop, days: [...days].sort((a, b) => a - b) } : { enabled: false }),
    onSuccess: () => { invalidate(); setSchedOpen(false); toast.success(t('schedule.saved')); },
    onError: () => toast.error(t('toast.error')),
  });
  const extM = useMutation({
    mutationFn: () => api.groupExtend(groupId, new Date(until).toISOString()),
    onSuccess: () => { invalidate(); setExtOpen(false); toast.success(t('extension.requested')); },
    onError: (e) => toast.error(e instanceof ApiError && e.message === 'none_extendable' ? t('toast.error') : t('toast.error')),
  });

  const schedValid = !enabled || (HHMM.test(start) && HHMM.test(stop) && start !== stop && days.size > 0);
  const btn = 'rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground';

  return (
    <>
      <button onClick={() => setSchedOpen(true)} className={btn}>{t('myvms.groupSchedule')}</button>
      <button onClick={() => setExtOpen(true)} className={btn}>{t('myvms.groupExtend')}</button>

      <Modal
        open={schedOpen}
        onClose={() => setSchedOpen(false)}
        title={t('schedule.title')}
        description={t('myvms.groupScheduleHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSchedOpen(false)} disabled={schedM.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => schedM.mutate()} disabled={!schedValid || schedM.isPending}>{schedM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('schedule.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="flex items-center gap-2.5">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-border" />
            <span className="text-sm font-medium">{t('schedule.title')}</span>
          </label>
          {enabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('schedule.start')}</span>
                  <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15" /></label>
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('schedule.stop')}</span>
                  <input type="time" value={stop} onChange={(e) => setStop(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15" /></label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayLabels.map((label, i) => {
                  const d = i + 1; const on = days.has(d);
                  return (
                    <button key={d} type="button" onClick={() => setDays((p) => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n; })}
                      className={`h-9 min-w-11 rounded-lg border px-2 text-xs font-medium capitalize transition ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={extOpen}
        onClose={() => setExtOpen(false)}
        title={t('extension.title')}
        description={t('myvms.groupExtendHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExtOpen(false)} disabled={extM.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => extM.mutate()} disabled={extM.isPending}>{extM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('extension.requestBtn')}</Button>
          </>
        }
      >
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('extension.newEnd')}</span>
          <DatePicker value={until} onChange={setUntil} /></label>
      </Modal>
    </>
  );
}
