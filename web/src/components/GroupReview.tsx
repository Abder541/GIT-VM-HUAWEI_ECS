import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../toast';
import type { PerfPreset, VmRequest } from '../types';
import { Button, IconCheck, IconX, Modal, Spinner, Textarea } from '../ui';
import { StatusBadge } from './StatusBadge';
import { displayStatus } from '../lib/status';
import { OsIcon } from './OsIcon';
import type { OsFamily } from '../types';

/**
 * Group review block — same shape as a single-VM review (justification + approve/reject),
 * but acts on the whole group. No per-VM accept/reject: a grouped VM is validated as a group.
 */
export function GroupReview({
  groupId,
  name,
  owner,
  vms,
  presets,
  osFamily,
}: {
  groupId: string;
  name: string;
  owner?: string;
  vms: VmRequest[];
  presets?: Record<string, PerfPreset>;
  osFamily?: (osId: string | null | undefined) => OsFamily | undefined;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-all'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
    vms.forEach((v) => qc.invalidateQueries({ queryKey: ['request', v.id] }));
  };
  const onErr = () => toast.error(t('toast.error'));
  const approveM = useMutation({ mutationFn: () => api.groupApprove(groupId), onSuccess: () => { invalidate(); toast.success(t('toast.approved')); }, onError: onErr });
  const rejectM = useMutation({ mutationFn: () => api.groupReject(groupId, note.trim()), onSuccess: () => { invalidate(); setRejectOpen(false); setNote(''); toast.success(t('toast.rejected')); }, onError: onErr });

  const label = (id: string) => presets?.[id]?.label ?? id;
  const justification = vms.find((v) => v.purpose)?.purpose ?? '';

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-amber-500/[0.06] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{name}</span>
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              {t('admin.groupBadge', { count: vms.length })}
            </span>
          </div>
          {owner && <p className="truncate text-xs text-muted-foreground">{owner}</p>}
        </div>
        <div className="flex gap-2">
          <Button disabled={approveM.isPending} onClick={() => approveM.mutate()}>
            {approveM.isPending ? <Spinner className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}
            {t('admin.approveGroup')}
          </Button>
          <Button variant="danger" disabled={rejectM.isPending} onClick={() => { setRejectOpen(true); setNote(''); }}>
            <IconX className="h-4 w-4" /> {t('admin.rejectGroup')}
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.justification')}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{justification || '—'}</p>
        </div>
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border">
          {vms.map((v) => {
            const fam = osFamily?.(v.os);
            return (
              <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Link to={`/requests/${v.id}`} className="font-mono text-xs text-muted-foreground hover:text-foreground">
                  #{String(v.id).padStart(3, '0')}
                </Link>
                {fam && <OsIcon family={fam} className="h-5 w-5" />}
                <span className="truncate font-medium">{label(v.preset)}</span>
                <span className="ml-auto"><StatusBadge status={displayStatus(v)} /></span>
              </li>
            );
          })}
        </ul>
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('admin.rejectGroup')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)} disabled={rejectM.isPending}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={rejectM.isPending} onClick={() => rejectM.mutate()}>
              {rejectM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('actions.reject')}
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('admin.rejectReason')}</span>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Modal>
    </div>
  );
}
