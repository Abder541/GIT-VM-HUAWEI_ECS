import { describe, it, expect } from 'vitest';
import { reconstruct, computeCostReport, type VmForCost } from '../src/cost';

const H = 3_600_000;
const T = Date.UTC(2026, 5, 1, 0, 0, 0); // 2026-06-01 00:00 UTC

// small = 0.036 €/h ; s40 = 40 Go → 40*0.1/730 = 0.0054795 €/h
function mk(p: Partial<VmForCost>): VmForCost {
  return {
    id: 1, user_email: 'a@x.ch', name: 'vm', preset: 'small', storage: 's40',
    status: 'active', endDate: null, expiredAt: null, events: [], ...p,
  };
}

describe('reconstruct (intervalles d\'allumage)', () => {
  it('active puis terminée → un interval, plus en vie', () => {
    const r = reconstruct(
      mk({
        status: 'terminated',
        events: [
          { action: 'vm.active', at: T },
          { action: 'vm.terminate', at: T + 10 * H },
        ],
      }),
      T + 50 * H
    );
    expect(r.running).toEqual([[T, T + 10 * H]]);
    expect(r.life).toEqual([T, T + 10 * H]);
    expect(r.currentlyOn).toBe(false);
  });

  it('active, arrêt programmé, redémarrage, toujours allumée → deux intervals jusqu\'à now', () => {
    const now = T + 10 * H;
    const r = reconstruct(
      mk({
        status: 'active',
        events: [
          { action: 'vm.active', at: T },
          { action: 'vm.schedule.stop', at: T + 5 * H },
          { action: 'vm.schedule.start', at: T + 8 * H },
        ],
      }),
      now
    );
    expect(r.running).toEqual([
      [T, T + 5 * H],
      [T + 8 * H, now],
    ]);
    expect(r.life).toEqual([T, now]);
    expect(r.currentlyOn).toBe(true);
  });

  it('statut terminal SANS event d\'extinction → borné à endDate (bug terminaison de groupe)', () => {
    // Reproduit le bug observé : VM terminée via action de groupe (aucun vm.terminate par VM),
    // statut = terminated, endDate court. NE DOIT PAS facturer jusqu'à now.
    const r = reconstruct(
      mk({ status: 'terminated', endDate: T + H, events: [{ action: 'vm.active', at: T }] }),
      T + 50 * H
    );
    expect(r.running).toEqual([[T, T + H]]); // 1h, surtout pas 50h
    expect(r.life).toEqual([T, T + H]);
    expect(r.currentlyOn).toBe(false);
  });

  it('expirée → bornée à expiredAt (prioritaire sur endDate)', () => {
    const r = reconstruct(
      mk({ status: 'expired', endDate: T + 100 * H, expiredAt: T + 2 * H, events: [{ action: 'vm.active', at: T }] }),
      T + 50 * H
    );
    expect(r.running).toEqual([[T, T + 2 * H]]);
    expect(r.currentlyOn).toBe(false);
  });

  it('jamais d\'allumage → pas de vie', () => {
    const r = reconstruct(mk({ status: 'failed', events: [{ action: 'vm.launch.failed', at: T }] }), T + H);
    expect(r.life).toBeNull();
  });
});

describe('computeCostReport', () => {
  it('une VM active 10h puis terminée', () => {
    const rep = computeCostReport(
      [
        mk({
          id: 1, user_email: 'a@x.ch', status: 'terminated',
          events: [
            { action: 'vm.active', at: T },
            { action: 'vm.terminate', at: T + 10 * H },
          ],
        }),
      ],
      T + 50 * H
    );
    expect(rep.computeEur).toBe(0.36); // 10h * 0.036
    expect(rep.storageEur).toBe(0.05); // 10h * 0.0054795 ≈ 0.0548
    expect(rep.totalEur).toBe(0.41);
    expect(rep.activeVms).toBe(0);
    expect(rep.perVm).toHaveLength(1);
    expect(rep.perVm[0].eur).toBe(0.41);
    expect(rep.perUser).toEqual([{ email: 'a@x.ch', vms: 1, eur: 0.41 }]);
  });

  it('VM encore allumée → comptée active + coût mensuel projeté', () => {
    const now = T + 10 * H;
    const rep = computeCostReport(
      [mk({ id: 2, user_email: 'b@x.ch', name: null, status: 'active', events: [{ action: 'vm.active', at: T }] })],
      now
    );
    expect(rep.activeVms).toBe(1);
    expect(rep.fleetMonthlyEur).toBe(30.28); // 0.036*730 + 40*0.1
    expect(rep.perVm[0].running).toBe(true);
    expect(rep.perVm[0].until).toBeNull();
  });

  it('VM terminée en groupe (sans event) bornée → pas 13h de coût parasite', () => {
    const rep = computeCostReport(
      [mk({ id: 9, status: 'terminated', endDate: T + H, events: [{ action: 'vm.active', at: T }] })],
      T + 50 * H
    );
    expect(rep.perVm[0].running).toBe(false);
    expect(rep.perVm[0].runningHours).toBe(1); // borné à endDate
    expect(rep.activeVms).toBe(0);
  });

  it('VM jamais active → exclue du rapport', () => {
    const rep = computeCostReport([mk({ id: 3, user_email: 'c@x.ch', name: null, status: 'failed', events: [] })], T + H);
    expect(rep.perVm).toHaveLength(0);
    expect(rep.totalEur).toBe(0);
  });

  it('coût par jour réparti sur les jours calendaires traversés', () => {
    const rep = computeCostReport(
      [
        mk({
          id: 4, user_email: 'd@x.ch', name: null, status: 'terminated',
          events: [
            { action: 'vm.active', at: T }, // 06-01 00:00
            { action: 'vm.terminate', at: T + 30 * H }, // 06-02 06:00
          ],
        }),
      ],
      T + 40 * H,
      30
    );
    expect(rep.perDay.map((d) => d.date)).toEqual(['2026-06-01', '2026-06-02']);
    const sum = rep.perDay.reduce((s, d) => s + d.eur, 0);
    expect(Math.round(sum * 100) / 100).toBeCloseTo(rep.totalEur, 1);
  });
});
