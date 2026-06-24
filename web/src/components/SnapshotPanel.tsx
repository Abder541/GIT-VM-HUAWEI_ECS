import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useToast } from '../toast';
import type { Snapshot, VmRequest } from '../types';
import { fmtDate } from '../lib/format';
import { Button, IconTrash, Modal, Spinner } from '../ui';

function SnapStatus({ s }: { s: Snapshot }) {
  const { t } = useTranslation();
  if (s.status === 'completed')
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ {t('snapshot.statusCompleted')}</span>;
  if (s.status === 'error')
    return <span className="text-xs font-medium text-red-600 dark:text-red-400">{t('snapshot.statusError')}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
      <Spinner className="h-3.5 w-3.5" /> {t('snapshot.statusPending')}
    </span>
  );
}

// Restore en place GATÉ (rollback EVS bloqué « in-use », restore CBR gaté real-name —
// cf. docs/design-cbr-restore.md). Bouton masqué ; backend dormant. Flag ré-activable.
const ROLLBACK_ENABLED = false;

export function SnapshotPanel({ request }: { request: VmRequest }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [delTarget, setDelTarget] = useState<Snapshot | null>(null);
  const [rbTarget, setRbTarget] = useState<Snapshot | null>(null);

  const q = useQuery({
    queryKey: ['snapshots', request.id],
    queryFn: () => api.listSnapshots(request.id),
    refetchInterval: (qq) => ((qq.state.data ?? []).some((s) => s.status === 'pending') ? 8000 : false),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['snapshots', request.id] });
  const createM = useMutation({
    mutationFn: () => api.createSnapshot(request.id),
    onSuccess: () => { invalidate(); toast.success(t('snapshot.created')); },
    onError: () => toast.error(t('toast.error')),
  });
  const toggleM = useMutation({
    mutationFn: (en: boolean) => api.setSnapshotOnDelete(request.id, en),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['request', request.id] }),
    onError: () => toast.error(t('toast.error')),
  });
  const delM = useMutation({
    mutationFn: (sid: number) => api.deleteSnapshot(request.id, sid),
    onSuccess: () => { invalidate(); setDelTarget(null); toast.success(t('snapshot.deleted')); },
    onError: () => toast.error(t('toast.error')),
  });
  const rbM = useMutation({
    mutationFn: (sid: number) => api.rollbackSnapshot(request.id, sid),
    onSuccess: () => { setRbTarget(null); toast.success(t('snapshot.restored')); qc.invalidateQueries({ queryKey: ['request', request.id] }); },
    onError: () => toast.error(t('toast.error')),
  });

  const snaps = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('snapshot.hint')}</p>
        <Button variant="secondary" disabled={createM.isPending} onClick={() => createM.mutate()}>
          {createM.isPending ? <Spinner className="h-4 w-4" /> : null}
          {t('snapshot.create')}
        </Button>
      </div>

      <label className="flex items-center gap-2.5">
        <input type="checkbox" checked={!!request.snapshot_on_delete} onChange={(e) => toggleM.mutate(e.target.checked)} className="h-4 w-4 rounded border-border" />
        <span className="text-sm">{t('snapshot.autoLabel')}</span>
      </label>

      {snaps.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('snapshot.empty')}</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {snaps.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground">{s.snapshot_id ?? `#${s.id}`}</div>
                <div className="text-xs text-muted-foreground">{fmtDate(s.created_at)}{s.size_gb ? ` · ${s.size_gb} Go` : ''}</div>
              </div>
              <div className="flex items-center gap-3">
                <SnapStatus s={s} />
                {ROLLBACK_ENABLED && s.status === 'completed' && (
                  <button
                    onClick={() => setRbTarget(s)}
                    title={t('snapshot.restore')}
                    className="grid h-8 place-items-center rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    {t('snapshot.restore')}
                  </button>
                )}
                <button
                  onClick={() => setDelTarget(s)}
                  title={t('snapshot.delete')}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:bg-muted hover:text-red-600"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!delTarget}
        onClose={() => setDelTarget(null)}
        title={t('snapshot.deleteTitle')}
        description={t('snapshot.deleteBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDelTarget(null)} disabled={delM.isPending}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={delM.isPending} onClick={() => delTarget && delM.mutate(delTarget.id)}>
              {delM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('common.delete')}
            </Button>
          </>
        }
      />

      <Modal
        open={!!rbTarget}
        onClose={() => setRbTarget(null)}
        title={t('snapshot.restoreTitle')}
        description={t('snapshot.restoreBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRbTarget(null)} disabled={rbM.isPending}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={rbM.isPending} onClick={() => rbTarget && rbM.mutate(rbTarget.id)}>
              {rbM.isPending ? <Spinner className="h-4 w-4" /> : null}{t('snapshot.restore')}
            </Button>
          </>
        }
      />
    </div>
  );
}
