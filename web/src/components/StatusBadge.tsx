import { useTranslation } from 'react-i18next';
import type { Status } from '../types';

const dot: Record<Status, string> = {
  pending: 'bg-amber-500',
  approved: 'bg-blue-500',
  provisioning: 'bg-blue-500',
  active: 'bg-emerald-500',
  stopped: 'bg-zinc-400',
  rejected: 'bg-red-500',
  failed: 'bg-red-500',
  terminating: 'bg-orange-400',
  terminated: 'bg-zinc-400',
  expired: 'bg-orange-500',
};

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useTranslation();
  const pulse = status === 'provisioning' || status === 'terminating';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground">
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dot[status]} opacity-60`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      </span>
      {t(`status.${status}`)}
    </span>
  );
}
