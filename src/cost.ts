// src/cost.ts — Calcul de coût « heures réelles » (Modèle B).
//
// Le compute n'est facturé que pendant les périodes d'allumage, reconstituées
// depuis l'audit_log (events ON/OFF). Le stockage (disque) est facturé sur toute
// la durée de vie (création → terminaison), qu'il tourne ou non.
//
// IMPORTANT — la FIN est autoritaire = statut + horodatages de la demande, PAS
// seulement l'audit : une VM terminée via une action de groupe n'émet pas
// d'événement par VM, donc on ne doit jamais facturer un interval « ouvert »
// jusqu'à maintenant pour une VM non active.
//
// Module PUR (aucune I/O) → testable en isolation (cf. test/cost.test.ts).

import { hourlyEurFor, storageHourlyEur, estimateMonthlyEur } from './presets';

// Vocabulaire d'audit (target = `req:<id>`), cf. src/index.ts.
const ON_ACTIONS = new Set(['vm.active', 'vm.schedule.start', 'vm.start']);
const OFF_ACTIONS = new Set([
  'vm.stop',
  'vm.schedule.stop',
  'vm.scheduled_stop',
  'vm.idle_stop',
  'vm.terminate',
  'vm.expired.terminated',
  'vm.drift.terminated',
]);
const END_ACTIONS = new Set(['vm.terminate', 'vm.expired.terminated', 'vm.drift.terminated']);
// Statuts terminaux : la VM n'existe plus (compute ET stockage arrêtés).
const TERMINAL_STATUS = new Set(['terminated', 'expired', 'failed', 'rejected', 'deleted']);

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface VmEvent {
  action: string;
  at: number; // epoch ms
}

export interface VmForCost {
  id: number;
  user_email: string;
  name: string | null;
  preset: string;
  storage: string | null;
  status: string;
  endDate: number | null; // end_date planifiée (epoch ms) — borne max de vie
  expiredAt: number | null; // expired_at (epoch ms) — fin réelle si expirée
  events: VmEvent[]; // triés croissant par `at`
}

export interface VmCost {
  id: number;
  user: string;
  name: string | null;
  preset: string;
  storage: string | null;
  running: boolean; // allumée à l'instant `now`
  runningHours: number;
  lifetimeHours: number;
  computeEur: number;
  storageEur: number;
  eur: number;
  since: number | null; // début de vie (epoch ms)
  until: number | null; // fin de vie, null si encore en vie
}

export interface CostReport {
  totalEur: number;
  computeEur: number;
  storageEur: number;
  activeVms: number;
  fleetMonthlyEur: number; // coût mensuel projeté de la flotte actuellement allumée (24/7)
  perUser: { email: string; vms: number; eur: number }[];
  perVm: VmCost[];
  perDay: { date: string; eur: number }[];
}

interface Lifecycle {
  running: [number, number][]; // intervalles d'allumage (compute)
  life: [number, number] | null; // [début de vie, fin de vie] (stockage)
  currentlyOn: boolean;
}

/**
 * Reconstitue les intervalles d'allumage (compute) et la durée de vie (stockage).
 * La fin effective est bornée par le statut/horodatages : une VM non active n'est
 * jamais facturée jusqu'à `now`.
 */
export function reconstruct(vm: VmForCost, now: number): Lifecycle {
  const { events, status } = vm;
  const running: [number, number][] = [];
  let onSince: number | null = null;
  let ended = false;
  let endAt: number | null = null;
  for (const e of events) {
    if (ended) break; // après terminaison, plus rien à compter
    if (ON_ACTIONS.has(e.action)) {
      if (onSince === null) onSince = e.at;
    } else if (OFF_ACTIONS.has(e.action)) {
      if (onSince !== null) {
        if (e.at > onSince) running.push([onSince, e.at]);
        onSince = null;
      }
      if (END_ACTIONS.has(e.action)) {
        ended = true;
        endAt = e.at;
      }
    }
  }

  // Fin autoritaire : événement de fin si présent ; sinon, si le statut est terminal,
  // on borne au meilleur horodatage connu (expiry réel, sinon date de fin planifiée),
  // sans jamais dépasser maintenant ; sinon la VM est encore en vie → maintenant.
  const terminal = TERMINAL_STATUS.has(status);
  let effectiveEnd: number;
  if (ended && endAt !== null) effectiveEnd = endAt;
  else if (terminal) effectiveEnd = Math.min(now, vm.expiredAt ?? vm.endDate ?? now);
  else effectiveEnd = now;

  // Clôture d'un éventuel interval ouvert (VM jamais éteinte par un event) à la fin effective.
  if (onSince !== null && effectiveEnd > onSince) running.push([onSince, effectiveEnd]);

  // Sécurité : aucune période ne dépasse la fin effective.
  const clamped = running
    .map(([a, b]) => [a, Math.min(b, effectiveEnd)] as [number, number])
    .filter(([a, b]) => b > a);

  const firstOn = events.find((e) => ON_ACTIONS.has(e.action));
  const start = firstOn ? firstOn.at : null;
  const life: [number, number] | null =
    start !== null && effectiveEnd > start ? [start, effectiveEnd] : null;

  // « En marche maintenant » = statut actif ET aucun événement de fin vu.
  const currentlyOn = status === 'active' && !ended;
  return { running: clamped, life, currentlyOn };
}

const hoursOf = (intervals: [number, number][]) =>
  intervals.reduce((s, [a, b]) => s + (b - a) / MS_PER_HOUR, 0);

/** Répartit le coût d'un interval par jour calendaire UTC, dans `acc` (date ISO → €). */
function spreadPerDay(acc: Map<string, number>, start: number, end: number, ratePerHour: number): void {
  if (ratePerHour <= 0 || end <= start) return;
  let cur = start;
  while (cur < end) {
    const dayStart = Math.floor(cur / MS_PER_DAY) * MS_PER_DAY;
    const segEnd = Math.min(end, dayStart + MS_PER_DAY);
    const date = new Date(dayStart).toISOString().slice(0, 10);
    acc.set(date, (acc.get(date) ?? 0) + ((segEnd - cur) / MS_PER_HOUR) * ratePerHour);
    cur = segEnd;
  }
}

/** Regroupe les events (déjà triés) par VM. */
export function assembleVms(
  rows: {
    id: number;
    user_email: string;
    name: string | null;
    preset: string;
    storage: string | null;
    status: string;
    endDate: number | null;
    expiredAt: number | null;
  }[],
  events: { req: number; action: string; at: number }[]
): VmForCost[] {
  const byReq = new Map<number, VmEvent[]>();
  for (const e of events) {
    const arr = byReq.get(e.req);
    if (arr) arr.push({ action: e.action, at: e.at });
    else byReq.set(e.req, [{ action: e.action, at: e.at }]);
  }
  return rows.map((r) => ({ ...r, events: byReq.get(r.id) ?? [] }));
}

/** Agrège le coût de toutes les VM. `days` = fenêtre du graphe par jour. */
export function computeCostReport(vms: VmForCost[], now: number, days = 30): CostReport {
  const perVm: VmCost[] = [];
  const perUser = new Map<string, { email: string; vms: number; eur: number }>();
  const perDay = new Map<string, number>();
  let totalCompute = 0;
  let totalStorage = 0;
  let activeVms = 0;
  let fleetMonthlyEur = 0;

  for (const vm of vms) {
    const { running, life, currentlyOn } = reconstruct(vm, now);
    if (life === null) continue; // VM jamais réellement provisionnée

    const computeRate = hourlyEurFor(vm.preset);
    const storageRate = storageHourlyEur(vm.storage);
    const runningHours = hoursOf(running);
    const lifetimeHours = (life[1] - life[0]) / MS_PER_HOUR;
    const computeEur = round2(runningHours * computeRate);
    const storageEur = round2(lifetimeHours * storageRate);
    const eur = round2(computeEur + storageEur);

    totalCompute += computeEur;
    totalStorage += storageEur;
    if (currentlyOn) {
      activeVms += 1;
      fleetMonthlyEur += estimateMonthlyEur(vm.preset, vm.storage ?? '');
    }

    for (const [a, b] of running) spreadPerDay(perDay, a, b, computeRate);
    spreadPerDay(perDay, life[0], life[1], storageRate);

    const u = perUser.get(vm.user_email) ?? { email: vm.user_email, vms: 0, eur: 0 };
    u.vms += 1;
    u.eur = round2(u.eur + eur);
    perUser.set(vm.user_email, u);

    perVm.push({
      id: vm.id,
      user: vm.user_email,
      name: vm.name,
      preset: vm.preset,
      storage: vm.storage,
      running: currentlyOn,
      runningHours: round2(runningHours),
      lifetimeHours: round2(lifetimeHours),
      computeEur,
      storageEur,
      eur,
      since: life[0],
      until: currentlyOn ? null : life[1],
    });
  }

  const cutoff = now - days * MS_PER_DAY;
  const perDayArr = [...perDay.entries()]
    .filter(([date]) => new Date(date + 'T00:00:00Z').getTime() >= cutoff)
    .map(([date, eur]) => ({ date, eur: round2(eur) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalEur: round2(totalCompute + totalStorage),
    computeEur: round2(totalCompute),
    storageEur: round2(totalStorage),
    activeVms,
    fleetMonthlyEur: round2(fleetMonthlyEur),
    perUser: [...perUser.values()].sort((a, b) => b.eur - a.eur),
    perVm: perVm.sort((a, b) => b.eur - a.eur),
    perDay: perDayArr,
  };
}
