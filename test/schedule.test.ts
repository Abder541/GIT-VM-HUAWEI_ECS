import { describe, it, expect } from 'vitest';
import { parseHHMM, inWindow, shouldRunSchedule, zurichNow } from '../src/schedule';

describe('parseHHMM', () => {
  it('parse HH:MM en minutes', () => {
    expect(parseHHMM('08:00')).toBe(480);
    expect(parseHHMM('18:30')).toBe(1110);
    expect(parseHHMM('00:00')).toBe(0);
  });
  it('null si invalide', () => {
    expect(parseHHMM(null)).toBeNull();
    expect(parseHHMM('8:0')).toBeNull();
    expect(parseHHMM('xx')).toBeNull();
  });
});

describe('inWindow', () => {
  it('fenêtre normale 08:00–18:00 [480,1080)', () => {
    expect(inWindow(600, 480, 1080)).toBe(true); // 10:00 dedans
    expect(inWindow(480, 480, 1080)).toBe(true); // borne basse incluse
    expect(inWindow(1080, 480, 1080)).toBe(false); // borne haute exclue
    expect(inWindow(1100, 480, 1080)).toBe(false); // après
  });
  it('fenêtre passant minuit 22:00–06:00 [1320,360)', () => {
    expect(inWindow(1380, 1320, 360)).toBe(true); // 23:00 dedans
    expect(inWindow(60, 1320, 360)).toBe(true); // 01:00 dedans
    expect(inWindow(720, 1320, 360)).toBe(false); // 12:00 hors
  });
  it('fenêtre nulle (start == stop) → jamais', () => {
    expect(inWindow(600, 600, 600)).toBe(false);
  });
});

describe('shouldRunSchedule (lun–ven 08:00–18:00)', () => {
  const D = '1,2,3,4,5';
  it('mardi 14:00 → tourne', () => expect(shouldRunSchedule(2, 840, D, '08:00', '18:00')).toBe(true));
  it('mardi 20:00 → arrêtée', () => expect(shouldRunSchedule(2, 1200, D, '08:00', '18:00')).toBe(false));
  it('samedi 14:00 → arrêtée (jour non sélectionné)', () => expect(shouldRunSchedule(6, 840, D, '08:00', '18:00')).toBe(false));
  it('planning incomplet → false', () => expect(shouldRunSchedule(2, 840, D, null, '18:00')).toBe(false));
});

describe('zurichNow (DST-aware)', () => {
  it('jour ISO 1..7 + minutes 0..1439', () => {
    const r = zurichNow(new Date('2026-06-23T12:00:00Z'));
    expect(r.day).toBeGreaterThanOrEqual(1);
    expect(r.day).toBeLessThanOrEqual(7);
    expect(r.minutes).toBeGreaterThanOrEqual(0);
    expect(r.minutes).toBeLessThan(1440);
  });
  it('été : 12:00 UTC → 14:00 Europe/Zurich (CEST, UTC+2)', () => {
    expect(zurichNow(new Date('2026-06-23T12:00:00Z')).minutes).toBe(14 * 60);
  });
});
