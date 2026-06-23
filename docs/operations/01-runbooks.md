# Exploitation — Runbooks

> Procédures opérationnelles. Toutes les commandes `wrangler`/`tsx` se lancent depuis la racine du repo,
> AK/SK via l'environnement (jamais en dur).

## R1 — Rotation de l'AK/SK Huawei

**Quand** : périodique, ou après suspicion de fuite (la clé `GIT-VM` a transité en clair → rotation conseillée).
1. Console Huawei → IAM → utilisateur → créer une **nouvelle** AK/SK.
2. Mettre à jour le secret Cloudflare : `wrangler secret put HUAWEI_ACCESS_KEY` / `HUAWEI_SECRET_KEY`
   (ou `secret bulk`), et `.dev.vars` en local.
3. Smoke test : `node scripts/huawei-discover.mjs` (doit lister project/flavors).
4. Supprimer l'**ancienne** AK/SK dans la console.
> Aucune VM impactée (la clé ne sert qu'aux appels API). CTS trace l'usage des deux clés pendant la bascule.

## R2 — Incident : provisioning bloqué

**Symptôme** : une demande reste en `provisioning` / `failed`.
1. Console admin → audit : chercher `vm.launch.failed`, `vm.reconcile.error`, `vm.job.resolved`.
2. `node scripts/huawei-discover.mjs` (vérifier accès API + quotas).
3. Si job ECS en échec : vérifier flavor/image/quotas/AZ dans le message d'erreur.
4. Le réconciliateur **retente** (max 3). Au-delà : corriger la cause, puis « Réinitialiser » la VM
   (re-provisioning) ou refuser/refaire la demande.

## R3 — EIP / volume orphelin (coût)

**Quand** : doute après suppression, ou contrôle périodique.
```powershell
$env:HUAWEI_ACCESS_KEY="…"; $env:HUAWEI_SECRET_KEY="…"; npx tsx scripts/huawei-orphans.ts
```
Attendu : **0 serveur géré, 0 EIP, 0 volume non attaché, 0 snapshot gitvm**. Si orphelin → le supprimer
en console (ou via API) et investiguer le `terminate` correspondant (audit).

## R4 — Rollback de déploiement

1. `wrangler deployments list` → identifier la version saine.
2. `wrangler rollback [<version-id>]`.
3. Vérifier `GET /healthz` et `GET /api/presets`.
> Les **migrations D1 sont additives** → un rollback du Worker reste compatible avec le schéma courant.

## R5 — Reprise d'activité (DR)

Cf. [résilience HA/DR](../architecture/02-resilience-ha-dr.md) §3 :
redeploy Worker → restore D1 (Time Travel) → re-push secrets → `terraform apply` (réseau) → laisser le
réconciliateur reconverger → vérifier l'idempotence (ni création ni destruction à tort).

## R6 — Migration vers le compte Cloudflare canonique

Cf. [ADR 0004](../adr/0004-propriete-cloudflare-et-cicd.md) §Conséquences (procédure en 7 étapes :
`wrangler login` cible → `d1 create` → migrations → `secret bulk` → `deploy` → `APP_URL` + URI Entra →
`wrangler delete` ancien). **Prérequis avant d'activer le CI/CD.**
