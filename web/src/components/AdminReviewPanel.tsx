import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../toast';
import type { VmRequest } from '../types';
import { Button, IconCheck, IconX, Spinner, Textarea } from '../ui';

export function AdminReviewPanel({ request }: { request: VmRequest }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [rejectNote, setRejectNote] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['request', request.id] });
    qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['admin-all'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
  };
  const onErr = () => toast.error(t('toast.error'));
  const approveM = useMutation({ mutationFn: () => api.approve(request.id), onSuccess: () => { invalidate(); toast.success(t('toast.approved')); }, onError: onErr });
  const rejectM = useMutation({ mutationFn: () => api.reject(request.id, rejectNote.trim()), onSuccess: () => { invalidate(); setRejectNote(''); toast.success(t('toast.rejected')); }, onError: onErr });
  const gApproveM = useMutation({ mutationFn: () => api.groupApprove(request.group_id!), onSuccess: () => { invalidate(); toast.success(t('toast.approved')); }, onError: onErr });
  const gRejectM = useMutation({ mutationFn: () => api.groupReject(request.group_id!, rejectNote.trim()), onSuccess: () => { invalidate(); setRejectNote(''); toast.success(t('toast.rejected')); }, onError: onErr });

  const isPending = request.status === 'pending';
  const inGroup = !!request.group_id;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('admin.justification')}</p>
        <p className="mt-1 whitespace-pre-line text-sm">{request.purpose || '—'}</p>
      </div>

      {isPending && inGroup && (
        <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
          <div>
            <p className="text-sm font-medium">{t('admin.partOfGroup', { name: request.group_name ?? request.group_id })}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.partOfGroupHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={gApproveM.isPending} onClick={() => gApproveM.mutate()}>
              {gApproveM.isPending ? <Spinner className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}
              {t('admin.approveGroup')}
            </Button>
            <Button variant="danger" disabled={gRejectM.isPending} onClick={() => gRejectM.mutate()}>
              {gRejectM.isPending ? <Spinner className="h-4 w-4" /> : <IconX className="h-4 w-4" />}
              {t('admin.rejectGroup')}
            </Button>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('admin.rejectReason')}</span>
            <Textarea rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t('admin.rejectReason')} />
          </label>
        </div>
      )}

      {isPending && !inGroup && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button disabled={approveM.isPending} onClick={() => approveM.mutate()}>
              {approveM.isPending ? <Spinner className="h-4 w-4" /> : <IconCheck className="h-4 w-4" />}
              {t('actions.approve')}
            </Button>
            <Button variant="danger" disabled={rejectM.isPending} onClick={() => rejectM.mutate()}>
              {rejectM.isPending ? <Spinner className="h-4 w-4" /> : <IconX className="h-4 w-4" />}
              {t('actions.reject')}
            </Button>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('admin.rejectReason')}</span>
            <Textarea rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t('admin.rejectReason')} />
          </label>
        </div>
      )}
    </div>
  );
}
