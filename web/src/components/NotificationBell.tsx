import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmtDate } from '../lib/format';
import type { Notification } from '../types';

function Bell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function NotificationBell() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const q = useQuery({ queryKey: ['notifications'], queryFn: api.notifications, refetchInterval: 30000 });
  const readM = useMutation({
    mutationFn: () => api.markNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const items = q.data?.notifications ?? [];
  const unread = q.data?.unread ?? 0;

  const onItem = (n: Notification) => {
    setOpen(false);
    if (unread > 0) readM.mutate();
    if (n.link) nav(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t('notif.title')}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-elevated shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">{t('notif.title')}</span>
            {unread > 0 && (
              <button onClick={() => readM.mutate()} className="text-xs text-muted-foreground transition hover:text-foreground">
                {t('notif.markRead')}
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('notif.empty')}</p>
            ) : (
              items.map((n) => {
                const id = n.link?.match(/(\d+)/)?.[1];
                return (
                  <button
                    key={n.id}
                    onClick={() => onItem(n)}
                    className={`flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition last:border-0 hover:bg-muted/50 ${n.read ? '' : 'bg-primary/[0.04]'}`}
                  >
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                    <span className={`flex-1 ${n.read ? 'pl-4' : ''}`}>
                      <span className="block text-sm text-foreground">
                        {t(`notif.${n.type}`, n.type)}
                        {id && <span className="text-muted-foreground"> · #{id.padStart(3, '0')}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{fmtDate(n.created_at)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
