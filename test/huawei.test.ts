// Tests unitaires des helpers PURS du provider Huawei (sans appel réseau).
// Verrouillent : (1) la normalisation d'état pilotant le réconciliateur,
// (2) la normalisation des dates Huawei (corrige le bug d'uptime).
import { describe, it, expect } from 'vitest';
import { normalizeState, utcIso } from '../src/huawei';

describe('normalizeState — états Huawei → vocabulaire portail', () => {
  it('mappe les états connus', () => {
    expect(normalizeState('ACTIVE')).toBe('running');
    expect(normalizeState('SHUTOFF')).toBe('stopped');
    expect(normalizeState('BUILD')).toBe('pending');
    expect(normalizeState('REBOOT')).toBe('pending');
    expect(normalizeState('HARD_REBOOT')).toBe('pending');
    expect(normalizeState('RESIZE')).toBe('pending');
    expect(normalizeState('VERIFY_RESIZE')).toBe('pending');
    expect(normalizeState('DELETED')).toBe('terminated');
    expect(normalizeState('SOFT_DELETED')).toBe('terminated');
    expect(normalizeState('ERROR')).toBe('error');
  });
  it('est insensible à la casse', () => {
    expect(normalizeState('active')).toBe('running');
    expect(normalizeState('ShutOff')).toBe('stopped');
  });
  it('renvoie "unknown" pour inconnu/vide/undefined', () => {
    expect(normalizeState(undefined)).toBe('unknown');
    expect(normalizeState('')).toBe('unknown');
    expect(normalizeState('WAT')).toBe('unknown');
  });
});

describe('utcIso — dates Huawei (sans Z) → ISO UTC', () => {
  it('ajoute Z et tronque les microsecondes', () => {
    expect(utcIso('2026-06-23T17:50:00.000000')).toBe('2026-06-23T17:50:00.000Z');
    expect(utcIso('2026-06-23T17:50:00.123456')).toBe('2026-06-23T17:50:00.123Z');
  });
  it('gère le séparateur espace', () => {
    expect(utcIso('2026-06-23 17:50:00.123456')).toBe('2026-06-23T17:50:00.123Z');
  });
  it('laisse intacte une date déjà zonée (Z ou offset)', () => {
    expect(utcIso('2026-06-23T17:50:00Z')).toBe('2026-06-23T17:50:00Z');
    expect(utcIso('2026-06-23T17:50:00+02:00')).toBe('2026-06-23T17:50:00+02:00');
  });
  it('renvoie undefined pour vide/undefined', () => {
    expect(utcIso(undefined)).toBeUndefined();
    expect(utcIso('')).toBeUndefined();
  });
});
