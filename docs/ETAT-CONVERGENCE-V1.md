# État de convergence V1 — GIT VM Portal (Huawei)

> Synthèse honnête de l'état du système après la phase de convergence. Distingue ce qui est
> **prouvé** (build/test/exécution) de ce qui reste **hypothèse** (non validé en live, gated).
> Établi le 2026-06-25. Réfs : [ROADMAP-HUAWEI.md](ROADMAP-HUAWEI.md), [design-cbr-restore.md](design-cbr-restore.md).

## 1. Garde-fous qualité — PROUVÉS (dernière exécution)
- `npm run typecheck` (worker, strict + `noUnusedLocals`/`noUnusedParameters`) → **OK**.
- `npm --prefix web run typecheck` (SPA, même strictness) → **OK**.
- `npm run lint` (ESLint 9 flat config) → **OK**.
- `npm test` (vitest) → **51 tests verts** (provider normalize/utcIso, catalogue/validateurs/coût, crypto JWT/AES-GCM, schedule, signature AK/SK).
- `npm --prefix web run build` (vite) → **OK** (~489 KB JS).

## 2. Audité et jugé SAIN (avec preuve)
- **Contrat frontend↔backend** : diff `web/src/api.ts` (seul client HTTP) vs routes `index.ts` → **cohérent**. Chaque route est consommée (SPA), un callback interne (`course-done`), ou une intégration externe (`/api/monitoring/:metric`, gardée par `GRAFANA_TOKEN`).
- **Création de VM** : voie unique `POST /api/requests/batch` — validations complètes (count 1-4, presets valides, **name requis**, **min-disk par OS**, dates obligatoires/cohérentes, rate-limit).
- **Flux extension** : complet de bout en bout (user demande → admin voit les demandes en attente → approve/reject).
- **Flux approve→provision** : robuste — échec → statut `failed` (repris par `retryFailed`, pas d'état bloqué) ; group-approve isole chaque VM.
- **Cycle de vie** (réconciliateur : reconcile/applySchedules/enforceExpiry/enforceIdleStop/retryFailed/garde nuit) : portage AWS **vérifié par lecture + comparaison ponctuelle** (cf. §5, non prouvé E2E).
- **Sécurité** : `crypto.ts` (chiffrement at-rest clés/mots de passe, JWT) couvert par tests round-trip + rejets.
- **Champs `admin_note`/`decided_by`** : écrits (setRequestStatus) ET affichés (RequestDetail) — cohérents.

## 3. Périmètre V1 FONCTIONNEL (non gated)
Provisioning **Linux** complet : SSO Entra → demande (batch, catalogue enrichi PERF/STORAGE/OS) → validation admin → VM ECS réelle (clé SSH, IP, cours préinstallés) → start/stop/reboot → snapshots EVS (create/list/delete) → plannings → expiry/auto-destroy → idle-stop (codé) → durcissement. Déployé live (`git-vm-portal-huawei.…workers.dev`).

## 4. GATED — attend une action compte/décision (n'empêche pas le reste)
| Item | Débloqué par | Statut |
|---|---|---|
| Restore « nouvelle VM » (CBR) | **real-name auth** (console) | conçu (design-cbr-restore.md), legacy IMS/rollback isolé/inerte |
| Windows | souscription image **market** | code prêt, OS `windows2019` masqué |
| idle-stop CES / hardening egress (validation) | **VM live** facturable | codé, non validé live |
| Mail (notifications email) | **secrets + template EmailJS** | code prêt, `MAIL_ENABLED=false` |
| CI/CD Workers Builds · rotation AK/SK | **décision compte Cloudflare** · console | non fait |

## 5. Hypothèses NON prouvées (à valider, honnêteté)
- **Parité E2E live** : le cycle de vie complet n'a PAS été re-testé end-to-end en live ce sprint (gated, VM facturables). La cohérence du portage est une **hypothèse** (lecture + comparaison ponctuelle `listRunningVmsForIdle`==AWS), pas une preuve runtime.
- **idle-stop CES** : `maxCpuOverWindow` jamais confirmé avec de vraies métriques CES.
- **Restore CBR** : viabilité confirmée en lecture seule, mais whole-image gaté real-name (jamais exécuté avec succès).

## 6. Dette résiduelle CONNUE — mineure, non bloquante
- `restore_snapshot_id` accepté par `batch` mais ignoré par `provisionRequest` (gated `RESTORE_ENABLED=false`) → stocké-mais-inutilisé tant que restore gated. Impact ~nul (UI masquée). À nettoyer avec l'implémentation CBR.
- Table `request_comments` inerte (flux comments mort retiré ; migration historique conservée).
- Clés i18n mortes résiduelles + notif type `suggestion` orpheline = **cosmétique** (volontairement non traité).
- Scripts de test legacy (`huawei-restore-test`, `huawei-evs-ims-test`) = différés jusqu'à CBR.

## 7. Verdict
**Le périmètre V1 non-gated est cohérent, robuste et production-ready au niveau code** (garde-fous tous verts, contrat frontend↔backend sain, flux métier complets, flux morts éliminés, legacy isolé). **Aucune dette active critique.** Le passage à « V1 100 % » ne dépend plus de nettoyage code mais d'**actions compte/décisions** (§4) et d'une **validation E2E live** (§5) — toutes hors du code, à la main de l'exploitant.
