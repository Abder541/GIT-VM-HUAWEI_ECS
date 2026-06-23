import { defineConfig } from 'vitest/config';

// Tests unitaires (signature AK/SK, presets, crypto…) — exécutés hors Worker.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
