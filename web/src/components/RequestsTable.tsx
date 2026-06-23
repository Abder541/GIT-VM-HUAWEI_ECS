import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PerfPreset, VmRequest } from '../types';
import { fmtDate } from '../lib/format';
import { displayStatus } from '../lib/status';
import { StatusBadge } from './StatusBadge';
import { IconDownload, IconServer, IconTrash, IconX, Spinner } from '../ui';
import { api } from '../api';

interface Props {
  rows: VmRequest[];
  presets: Record<string, PerfPreset>;
  admin?: boolean;
  busyId?: number | null;
  onTerminate?: (r: VmRequest) => void;
  onDelete?: (r: VmRequest) => void;
}

const canTerminate = (s: string) => s === 'active' || s === 'provisioning' || s === 'failed';
const canDelete = (r: VmRequest) => !!r.expired_at || r.status === 'terminated' || r.status === 'rejected' || r.status === 'failed';

function IconBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function RequestsTable({ rows, presets, admin, busyId, onTerminate, onDelete }: Props) {
  const { t } = useTranslation();
  const label = (id: string) => presets[id]?.label ?? id;
  const eff = displayStatus;

  const access = (r: VmRequest) => {
    if (r.status === 'active' && r.public_ip)
      return (
        <a href={api.keyUrl(r.id)} className="inline-flex items-center gap-1.5 font-medium hover:underline">
          <IconDownload className="h-4 w-4" />
          {t('access.downloadKey')}
        </a>
      );
    if (r.status === 'provisioning' || r.status === 'approved')
      return <span className="text-muted-foreground">{t('access.provisioning')}</span>;
    return <span className="text-muted-foreground/60">—</span>;
  };

  const actions = (r: VmRequest) => {
    const busy = busyId === r.id;
    return (
      <div className="flex items-center justify-end gap-1.5">
        {!admin && canTerminate(r.status) && (
          <IconBtn disabled={busy} onClick={() => onTerminate?.(r)} title={t('actions.terminate')}>
            {busy ? <Spinner className="h-4 w-4" /> : <IconTrash className="h-4 w-4 text-red-600" />}
          </IconBtn>
        )}
        {!admin && onDelete && canDelete(r) && (
          <IconBtn disabled={busy} onClick={() => onDelete(r)} title={t('actions.delete')}>
            <IconX className="h-4 w-4 text-muted-foreground" />
          </IconBtn>
        )}
        <Link
          to={`/requests/${r.id}`}
          title={t('actions.view')}
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <IconServer className="h-4 w-4" />
        </Link>
      </div>
    );
  };

  return (
    <>
      {/* desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3.5 py-3 font-medium">{t('table.id')}</th>
                {admin && <th className="px-3.5 py-3 font-medium">{t('table.user')}</th>}
                <th className="px-3.5 py-3 font-medium">{t('table.type')}</th>
                <th className={`px-3.5 py-3 font-medium ${admin ? 'hidden 2xl:table-cell' : ''}`}>{t('table.purpose')}</th>
                <th className={`px-3.5 py-3 font-medium ${admin ? 'hidden xl:table-cell' : ''}`}>{t('table.expires')}</th>
                <th className="px-3.5 py-3 font-medium">{t('table.status')}</th>
                <th className={`px-3.5 py-3 font-medium ${admin ? 'hidden lg:table-cell' : ''}`}>{admin ? t('table.created') : t('table.access')}</th>
                <th className="px-3.5 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/70 transition last:border-0 hover:bg-muted/40">
                  <td className="px-3.5 py-3">
                    <Link to={`/requests/${r.id}`} className="block max-w-[12rem] truncate font-medium hover:underline" title={r.name ?? undefined}>
                      {r.name || `#${String(r.id).padStart(3, '0')}`}
                    </Link>
                    {r.name && <span className="font-mono text-[10px] text-muted-foreground">#{String(r.id).padStart(3, '0')}</span>}
                  </td>
                  {admin && <td className="max-w-[12rem] truncate px-3.5 py-3 text-muted-foreground" title={r.user_email}>{r.user_email}</td>}
                  <td className="px-3.5 py-3 font-medium">{label(r.preset)}</td>
                  <td className={`max-w-[14rem] truncate px-3.5 py-3 text-muted-foreground ${admin ? 'hidden 2xl:table-cell' : ''}`} title={r.purpose}>
                    {r.purpose}
                  </td>
                  <td className={`whitespace-nowrap px-3.5 py-3 text-muted-foreground ${admin ? 'hidden xl:table-cell' : ''}`}>{fmtDate(r.end_date)}</td>
                  <td className="px-3.5 py-3"><StatusBadge status={eff(r)} /></td>
                  <td className={`whitespace-nowrap px-3.5 py-3 text-muted-foreground ${admin ? 'hidden lg:table-cell' : ''}`}>
                    {admin ? fmtDate(r.created_at) : access(r)}
                  </td>
                  <td className="px-3.5 py-3">{actions(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/requests/${r.id}`} className="truncate font-medium hover:underline">
                {r.name || `#${String(r.id).padStart(3, '0')}`}
              </Link>
              <StatusBadge status={eff(r)} />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">{label(r.preset)}</div>
            {admin && <div className="text-xs text-muted-foreground">{r.user_email}</div>}
            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.purpose}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('table.expires')} : {fmtDate(r.end_date)}</div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-sm">{admin ? <span className="text-muted-foreground">{fmtDate(r.created_at)}</span> : access(r)}</div>
              {actions(r)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
