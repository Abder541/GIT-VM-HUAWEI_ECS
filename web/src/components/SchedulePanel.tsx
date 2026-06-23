import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../toast';
import type { VmRequest } from '../types';
import { Button, Spinner } from '../ui';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-6 w-10 rounded-full transition ${on ? 'bg-primary' : 'bg-muted'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export function SchedulePanel({ request }: { request: VmRequest }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'fr';
  const qc = useQueryClient();
  const toast = useToast();

  const [enabled, setEnabled] = useState(!!request.schedule_enabled);
  const [start, setStart] = useState(request.schedule_start ?? '08:00');
  const [stop, setStop] = useState(request.schedule_stop ?? '18:00');
  const [days, setDays] = useState<Set<number>>(
    () => new Set((request.schedule_days ?? '1,2,3,4,5').split(',').map(Number).filter(Boolean))
  );

  // Localized weekday short labels, ISO order (1=Mon … 7=Sun).
  const dayLabels = useMemo(() => {
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString(lang, { weekday: 'short' })
    );
  }, [lang]);

  const toggleDay = (d: number) => {
    setDays((prev) => {
      const n = new Set(prev);
      n.has(d) ? n.delete(d) : n.add(d);
      return n;
    });
  };

  const valid = !enabled || (HHMM.test(start) && HHMM.test(stop) && start !== stop && days.size > 0);

  const m = useMutation({
    mutationFn: () =>
      api.setSchedule(request.id, enabled ? { enabled, start, stop, days: [...days].sort((a, b) => a - b) } : { enabled: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['request', request.id] });
      toast.success(t('schedule.saved'));
    },
    onError: () => toast.error(t('toast.error')),
  });
  const resumeM = useMutation({
    mutationFn: () => api.resumeSchedule(request.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['request', request.id] }); toast.success(t('schedule.resumed')); },
    onError: () => toast.error(t('toast.error')),
  });

  return (
    <div className="space-y-4">
      {request.schedule_enabled && request.schedule_paused ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <span className="text-sm text-amber-700 dark:text-amber-400">{t('schedule.paused')}</span>
          <Button variant="secondary" disabled={resumeM.isPending} onClick={() => resumeM.mutate()}>
            {resumeM.isPending ? <Spinner className="h-4 w-4" /> : null}
            {t('schedule.resume')}
          </Button>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t('schedule.hint')}</p>
        <Switch on={enabled} onClick={() => setEnabled((v) => !v)} />
      </div>

      {enabled && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('schedule.start')}</span>
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('schedule.stop')}</span>
              <input
                type="time"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t('schedule.days')}</span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setDays(new Set([1, 2, 3, 4, 5]))} className="text-xs text-muted-foreground hover:text-foreground">
                  {t('schedule.weekdays')}
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button type="button" onClick={() => setDays(new Set([1, 2, 3, 4, 5, 6, 7]))} className="text-xs text-muted-foreground hover:text-foreground">
                  {t('schedule.everyday')}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dayLabels.map((label, i) => {
                const d = i + 1;
                const on = days.has(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`h-9 min-w-11 rounded-lg border px-2 text-xs font-medium capitalize transition ${
                      on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t('schedule.note')}</p>
          {!valid && <p className="text-xs text-amber-500">{t('schedule.invalid')}</p>}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => m.mutate()} disabled={!valid || m.isPending}>
          {m.isPending ? <Spinner className="h-4 w-4" /> : null}
          {t('schedule.save')}
        </Button>
      </div>
    </div>
  );
}
