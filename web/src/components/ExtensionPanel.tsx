import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { useToast } from '../toast';
import type { VmRequest } from '../types';
import { fmtDate } from '../lib/format';
import { Button, Spinner } from '../ui';
import { DatePicker } from './DatePicker';

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function ExtensionPanel({
  request,
  isAdmin,
  isOwner,
}: {
  request: VmRequest;
  isAdmin: boolean;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const endBase = request.end_date ? new Date(request.end_date) : new Date();
  const [until, setUntil] = useState(() => toInput(new Date(endBase.getTime() + 7 * 86400000)));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['request', request.id] });
    qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['admin-all'] });
  };

  const reqM = useMutation({
    mutationFn: () => api.requestExtension(request.id, new Date(until).toISOString()),
    onSuccess: () => { invalidate(); toast.success(t('extension.requested')); },
    onError: (e) =>
      toast.error(e instanceof ApiError && (e.message === 'must_be_later' || e.message === 'invalid_date') ? t('extension.mustBeLater') : t('toast.error')),
  });
  const approveM = useMutation({
    mutationFn: () => api.approveExtension(request.id),
    onSuccess: () => { invalidate(); toast.success(t('extension.approved')); },
    onError: () => toast.error(t('toast.error')),
  });
  const rejectM = useMutation({
    mutationFn: () => api.rejectExtension(request.id),
    onSuccess: () => { invalidate(); toast.success(t('extension.rejected')); },
    onError: () => toast.error(t('toast.error')),
  });

  // Pending request awaiting admin decision.
  if (request.ext_requested_end) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {t('extension.pending', { date: fmtDate(request.ext_requested_end) })}
        </p>
        {isAdmin && (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={rejectM.isPending} onClick={() => rejectM.mutate()}>
              {rejectM.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t('extension.reject')}
            </Button>
            <Button disabled={approveM.isPending} onClick={() => approveM.mutate()}>
              {approveM.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t('extension.approve')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!isOwner && !isAdmin) return null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('extension.hint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('extension.newEnd')}</span>
          <DatePicker value={until} min={request.end_date ? toInput(endBase) : undefined} onChange={setUntil} />
        </label>
        <Button disabled={reqM.isPending} onClick={() => reqM.mutate()}>
          {reqM.isPending ? <Spinner className="h-4 w-4" /> : null}
          {t('extension.requestBtn')}
        </Button>
      </div>
    </div>
  );
}
