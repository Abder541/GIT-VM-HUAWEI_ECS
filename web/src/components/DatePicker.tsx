import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Dependency-free date + time picker. Value is a datetime-local string
// ("YYYY-MM-DDTHH:mm"), so it drops straight into the existing form logic.

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}

export function DatePicker({
  value,
  onChange,
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'fr';
  const selected = useMemo(() => {
    const d = value ? new Date(value) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  }, [value]);
  const minDate = min ? new Date(min) : null;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({ y: selected.getFullYear(), m: selected.getMonth() }));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setView({ y: selected.getFullYear(), m: selected.getMonth() });
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const weekdays = useMemo(() => {
    // Monday-first short weekday labels in the active locale.
    const base = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString(lang, { weekday: 'short' })
    );
  }, [lang]);

  // Build the 6×7 grid starting on the Monday on/before the 1st.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // Mon=0
    const start = new Date(view.y, view.m, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [view]);

  const pickDay = (d: Date) => {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), selected.getHours(), selected.getMinutes());
    onChange(toInput(next));
  };
  const setTime = (hhmm: string) => {
    const [h, mn] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(mn)) return;
    const next = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), h, mn);
    onChange(toInput(next));
  };

  const dayDisabled = (d: Date) => {
    if (!minDate) return false;
    const min0 = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
    const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return d0.getTime() < min0.getTime();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-left text-sm outline-none transition hover:border-foreground/25 focus:border-ring focus:ring-2 focus:ring-ring/15"
      >
        <span>{selected.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-border bg-elevated p-3 shadow-2xl shadow-black/20">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Chevron dir="left" />
            </button>
            <span className="text-sm font-medium capitalize">{monthLabel}</span>
            <button type="button" onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Chevron dir="right" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {weekdays.map((w) => (
              <div key={w} className="grid h-7 place-items-center text-[10px] font-medium uppercase text-muted-foreground">
                {w.slice(0, 2)}
              </div>
            ))}
            {cells.map((d) => {
              const inMonth = d.getMonth() === view.m;
              const isSel = dayKey(d) === dayKey(selected);
              const isToday = dayKey(d) === dayKey(new Date());
              const disabled = dayDisabled(d);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(d)}
                  className={`grid h-8 place-items-center rounded-md text-sm transition ${
                    isSel
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : disabled
                        ? 'cursor-not-allowed text-muted-foreground/30'
                        : inMonth
                          ? 'text-foreground hover:bg-muted'
                          : 'text-muted-foreground/50 hover:bg-muted'
                  } ${isToday && !isSel ? 'ring-1 ring-inset ring-primary/40' : ''}`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">{t('newvm.timeLabel')}</span>
            <input
              type="time"
              value={`${pad(selected.getHours())}:${pad(selected.getMinutes())}`}
              onChange={(e) => setTime(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
            />
          </div>
        </div>
      )}
    </div>
  );
}
