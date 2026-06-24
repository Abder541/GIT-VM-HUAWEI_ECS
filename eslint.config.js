// eslint.config.js — Flat config ESLint 9 (le projet n'en avait aucune → `npm run lint` cassé).
//
// Objectif : restaurer un garde-fou LÉGER (code mort, erreurs réelles) SANS imposer un refactor
// massif. Volontairement pragmatique : `no-explicit-any` désactivé (le worker manipule des lignes
// D1 / contextes Hono typés `any` à dessein) ; `no-unused-vars` en erreur (= détection de code mort,
// avec convention `_` pour les paramètres intentionnellement inutilisés). `no-undef` off : TypeScript
// gère déjà les symboles non définis (globals Workers : crypto, fetch, Response, btoa…).
//
// Périmètre : `npm run lint` = `eslint src test` (worker). La SPA (web/) a son propre tsc strict.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'web/**', 'scripts/**', 'dist/**', '**/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
