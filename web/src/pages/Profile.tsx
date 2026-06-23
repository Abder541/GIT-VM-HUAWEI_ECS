import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { VmRequest } from '../types';
import { displayStatus } from '../lib/status';
import { fmtDate } from '../lib/format';
import { Button, Card, IconLogout, Spinner } from '../ui';
import { StatusBadge } from '../components/StatusBadge';
import { ThemeToggle, LangToggle } from '../components/Toggles';

function initials(email: string) {
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return name.split(' ').slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
    </Card>
  );
}

export function Profile() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['me'], queryFn: api.me });
  const reqQ = useQuery({ queryKey: ['requests'], queryFn: api.listRequests });

  const rows = reqQ.data ?? [];
  const now = Date.now();
  const stats = useMemo(() => {
    const eff = (r: VmRequest) => displayStatus(r);
    return {
      total: rows.length,
      active: rows.filter((r) => eff(r) === 'active').length,
      stopped: rows.filter((r) => eff(r) === 'stopped').length,
      expiring: rows.filter((r) => {
        if (r.status !== 'active' || r.expired_at || !r.end_date) return false;
        const e = new Date(r.end_date).getTime();
        return e > now && e - now <= 24 * 3600 * 1000;
      }).length,
    };
  }, [rows, now]);

  async function logout() {
    await api.logout();
    qc.clear();
    nav('/');
    location.reload();
  }

  if (!meQ.data)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  const me = meQ.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('profile.eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('profile.title')}</h1>
      </div>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="grid h-14 w-14 place-items-center rounded-full border border-border bg-muted text-lg font-semibold text-muted-foreground">
          {initials(me.email)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{me.name || me.email.split('@')[0]}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary">
              {t(`role.${me.role}`)}
            </span>
          </div>
          <div className="truncate text-sm text-muted-foreground">{me.email}</div>
        </div>
        <Button variant="secondary" onClick={logout}>
          <IconLogout className="h-4 w-4" /> {t('profile.signOut')}
        </Button>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('profile.statTotal')} value={stats.total} />
        <Stat label={t('profile.statActive')} value={stats.active} />
        <Stat label={t('profile.statStopped')} value={stats.stopped} />
        <Stat label={t('profile.statExpiring')} value={stats.expiring} />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('profile.settings')}</h2>
        <div className="divide-y divide-border">
          <div className="flex items-center justify-between py-3">
            <span className="text-sm">{t('profile.theme')}</span>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm">{t('profile.language')}</span>
            <LangToggle />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('profile.myVms')}</h2>
          <Link to="/" className="text-xs text-muted-foreground transition hover:text-foreground">{t('profile.viewAll')}</Link>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('myvms.empty')}</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.slice(0, 5).map((r) => (
              <Link key={r.id} to={`/requests/${r.id}`} className="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80">
                <span className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">#{String(r.id).padStart(3, '0')}</span>
                  <span className="truncate text-muted-foreground">{fmtDate(r.end_date)}</span>
                </span>
                <StatusBadge status={displayStatus(r)} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
