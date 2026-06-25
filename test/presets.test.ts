// Tests unitaires du catalogue (presets) : intègre les invariants produit (types EVS
// supportés, plancher disque, GPU/Windows masqués, GPSSD2 jamais utilisé) + validateurs
// + calcul de coût. Verrouille le catalogue enrichi en Phase 1 contre les régressions.
import { describe, it, expect } from 'vitest';
import {
  PERF, STORAGE, OS,
  isValidPerf, isValidStorage, isValidOs, isValidCourse,
  estimateMonthlyEur, buildCourseUserData, buildWindowsCourseInstall,
  STORAGE_EUR_GB_MONTH,
} from '../src/presets';

describe('Catalogue PERF', () => {
  it('chaque preset est cohérent (id == clé, champs > 0, flavor qualifié)', () => {
    for (const [key, p] of Object.entries(PERF)) {
      expect(p.id).toBe(key);
      expect(p.flavor).toMatch(/^[a-z0-9]+\..+/); // ex. s6.large.2, c7n.xlarge.2
      expect(p.vcpu).toBeGreaterThan(0);
      expect(p.ramGb).toBeGreaterThan(0);
      expect(p.hourlyEur).toBeGreaterThan(0);
    }
  });
  it('expose au moins un preset recommandé et visible', () => {
    expect(Object.values(PERF).some((p) => p.recommended && !p.hidden)).toBe(true);
  });
  it('le GPU est masqué (coût élevé — gate admin)', () => {
    expect(PERF.gpu?.hidden).toBe(true);
  });
});

describe('Catalogue STORAGE', () => {
  it('chaque preset a un type EVS supporté et un plancher de 40 Go', () => {
    for (const [key, s] of Object.entries(STORAGE)) {
      expect(s.id).toBe(key);
      expect(['GPSSD', 'SSD', 'SAS']).toContain(s.volumetype);
      expect(s.sizeGb).toBeGreaterThanOrEqual(40);
    }
  });
  it("n'utilise jamais GPSSD2 (indisponible dans l'AZ par défaut eu-west-101a)", () => {
    for (const s of Object.values(STORAGE)) expect(s.volumetype).not.toBe('GPSSD2');
  });
});

describe('Catalogue OS', () => {
  const families = ['ubuntu', 'debian', 'amazon', 'rocky', 'alma', 'windows'];
  it('chaque OS a image_id, famille valide, plancher 40 Go, connect ssh|rdp', () => {
    for (const [key, o] of Object.entries(OS)) {
      expect(o.id).toBe(key);
      expect(o.image.length).toBeGreaterThan(10); // UUID image_id
      expect(families).toContain(o.family);
      expect(['ssh', 'rdp']).toContain(o.connect);
      expect(o.minStorageGb).toBe(40);
    }
  });
  it("Windows est masqué (image market non souscrite) et en RDP", () => {
    expect(OS.windows2019?.hidden).toBe(true);
    expect(OS.windows2019?.connect).toBe('rdp');
  });
});

describe('Validateurs', () => {
  it('isValidPerf / isValidStorage / isValidOs', () => {
    expect(isValidPerf('small')).toBe(true);
    expect(isValidPerf('inexistant')).toBe(false);
    expect(isValidStorage('s40')).toBe(true);
    expect(isValidStorage('nope')).toBe(false);
    expect(isValidOs('ubuntu2404')).toBe(true);
    expect(isValidOs('nope')).toBe(false);
  });
  it('isValidCourse accepte vide + cours connu, rejette inconnu', () => {
    expect(isValidCourse('')).toBe(true);
    expect(isValidCourse('cloud')).toBe(true);
    expect(isValidCourse('inconnu')).toBe(false);
  });
});

describe('estimateMonthlyEur', () => {
  it('coût mensuel = flavor × 730h + stockage × tarif/Go', () => {
    const p = PERF.small, s = STORAGE.s40;
    expect(estimateMonthlyEur('small', 's40')).toBeCloseTo(p.hourlyEur * 730 + s.sizeGb * STORAGE_EUR_GB_MONTH, 6);
  });
  it('renvoie 0 pour une composition invalide', () => {
    expect(estimateMonthlyEur('nope', 's40')).toBe(0);
    expect(estimateMonthlyEur('small', 'nope')).toBe(0);
  });
});

describe('Bootstrap cours', () => {
  it('buildCourseUserData : undefined sans cours, script bash sinon', () => {
    expect(buildCourseUserData('')).toBeUndefined();
    expect(buildCourseUserData(null)).toBeUndefined();
    expect(buildCourseUserData('inconnu')).toBeUndefined();
    expect(buildCourseUserData('cloud')).toContain('#!/bin/bash');
  });
  it('buildWindowsCourseInstall : script PowerShell Chocolatey pour un cours connu', () => {
    expect(buildWindowsCourseInstall('cloud')).toContain('choco install');
    expect(buildWindowsCourseInstall('')).toBeUndefined();
  });
});
