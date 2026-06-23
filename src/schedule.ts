// src/schedule.ts — Logique PURE de décision des plannings auto start/stop.
// Sans I/O ni cloud → testable en isolation. Utilisée par le réconciliateur
// (applySchedules dans index.ts).

/** Minutes depuis minuit pour "HH:MM" (null si invalide). */
export function parseHHMM(s: string | null | undefined): number | null {
  const m = s ? /^(\d{2}):(\d{2})$/.exec(s) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `minutes` dans [start, stop) — gère les fenêtres qui passent minuit. */
export function inWindow(minutes: number, startM: number, stopM: number): boolean {
  if (startM === stopM) return false;
  return startM < stopM ? minutes >= startM && minutes < stopM : minutes >= startM || minutes < stopM;
}

/** Jour ISO (1=lun..7=dim) + minutes-of-day en Europe/Zurich (DST-aware). */
export function zurichNow(now: Date = new Date()): { day: number; minutes: number } {
  const z = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Zurich' }));
  return { day: z.getDay() === 0 ? 7 : z.getDay(), minutes: z.getHours() * 60 + z.getMinutes() };
}

/** La VM doit-elle tourner maintenant ? (jour ISO, minutes-of-day, planning). */
export function shouldRunSchedule(
  day: number,
  minutes: number,
  days: string | null | undefined,
  start: string | null | undefined,
  stop: string | null | undefined
): boolean {
  const startM = parseHHMM(start);
  const stopM = parseHHMM(stop);
  if (startM === null || stopM === null) return false;
  const dayList = (days ?? '').split(',').map(Number);
  return dayList.includes(day) && inWindow(minutes, startM, stopM);
}
