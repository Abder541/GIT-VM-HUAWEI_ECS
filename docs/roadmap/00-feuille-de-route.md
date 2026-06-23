# Feuille de route — par phases

> Principe : **parité d'abord** (un socle robuste, testable, de bout en bout), **puis** activation
> progressive des couches avancées — toutes **conçues dès maintenant**.
>
> 🟢 **Décisions actées** (cf. [ADR 0003](../adr/0003-reprise-decisions-fondatrices.md)) : parité
> **fonctionnelle totale** en v1 (snapshots/restore/idle-stop inclus) · identité = clé `GIT-VM`
> full-access conservée · infra socle en **Terraform** · repo = ce dépôt (AWS intact en référence).

## Phase 0 — Architecture-first (quasi terminée)

- [x] Workspace + arborescence docs entreprise.
- [x] Vue d'ensemble + couche fournisseur (mapping AWS→Huawei).
- [x] Permissions IAM minimales (documentées comme cible de durcissement, cf. ADR 0003 D2).
- [x] Inventaire ressources Huawei.
- [x] Stratégie GitOps.
- [x] **ADR 0003** — corrections d'analyse + décisions fondatrices.
- [x] **Fondation code** : contrat `src/cloud.ts` (16 méthodes), `src/types.ts`, config Worker/D1 distincte.
- [x] **Signature AK/SK validée en live** + `project_id`/flavors/images découverts (`eu-west-101`, site `.eu`).
- [ ] ADR 0004 (réseau/segmentation), 0005 (modèle de données : dates/rôles/**job async**), 0006 (catalogue).
- [ ] Spéc. catalogue (flavors/images/EVS) pour `eu-west-101`.
- **Sortie de phase** : conception validée + liste d'accès Huawei figée.

## Phase 1 — Socle de **parité totale** (objectif principal)

Reproduire **tout** le modèle opérationnel AWS sur Huawei (cf. ADR 0003 D1). Pas de couche *plateforme*.

**Infra socle (prérequis, Terraform — ADR 0003 D3)**
- [x] `infra/terraform/` : **VPC + subnet + SG créés** sur `eu-west-101` (gratuit, `terraform apply` OK). Identité/CTS = durcissement ultérieur.

**Couche fournisseur & exécution**
- [x] `src/huawei-sign.ts` — signature AK/SK (WebCrypto) + tests (8 ✓, **validée en live**).
- [x] `src/huawei.ts` — contrat implémenté ; **cycle de vie validé E2E en live** (keypair → launch→job → resolve → describe IP → listManaged → terminate +EIP+volume, teardown propre). Reste : EVS snapshots, restore IMS (U6), CES idle.
- [x] **Port complet** : backend (`crypto`/`oidc`/`sentry`/`db`/`email`/`presets`/`index.ts` réconciliateur+routes) **+ SPA `web/`** (typecheck + 8 tests + build OK, 3 commits). App **exécutée en local** (`wrangler dev`) servant le catalogue Huawei `eu-west-101`.
- [~] **Mise en ligne** : ✅ **déployé** (`git-vm-portal-huawei.thomas-prudhomme.workers.dev`, 1 cron `*/2`, 6 secrets, D1 migrée, prod testée `/healthz` + `/api/presets` + SPA). **Reste (Azure)** : URI de redirection Entra `.../auth/callback` → 1er login + parcours complet.
- [x] Schéma D1 : `migrations/0001_init.sql` — colonnes **neutres** + `provider_job_id`, dates/rôles/groupes ✅.
- [x] Réconciliateur complet : `resolveLaunch` (job→server), `active`, drift, retry, **auto-destroy + libération EIP**, extinction nocturne, **idle-stop (CES)**, **sync snapshots** ✅.
- [x] Fonctionnel de parité : **snapshots EVS** ✅, expiration auto ✅, planning start/stop ✅ (+ tests), demande groupée formateur ✅. (**restauration IMS** = conçue, [ADR 0006](../adr/0006-restauration-snapshot-ims.md) — à finaliser, U6.)
- [x] Catalogue presets Huawei (flavors `s6.*` / images IMS / EVS, tarifs `eu-west-101`) ✅.
- [x] **Parcours bout en bout testé EN PRODUCTION** : demande → validation → provisioning → IP → SSH `root` → stop/start → destruction (EIP+EVS libérés) ✅.
- **Sortie de phase** : ✅ **parité atteinte en production**.

## Phase 2 — Sécurité & réseau — 🟢 conçue ([ADR 0005](../adr/0005-securite-reseau-egress-segmentation.md) · [network/01](../network/01-securite-reseau.md))

- [ ] **Cloudflare Access** (Zero Trust) devant `/admin` — conçu (edge), à activer.
- [ ] **WAF + rate limiting** edge — à activer (rate-limit applicatif 5/h déjà présent).
- [~] **Segmentation réseau par classe** (map classe → subnet/SG) — **conçue**.
- [x] **Durcissement SG egress** (liste blanche + default-deny) — **implémenté** (Terraform `hardening.tf`, togglable).
- [~] Rotation AK/SK ([runbook R1](../operations/01-runbooks.md)) + CTS — **documenté** ; CTS à activer (compte).

## Phase 3 — Observabilité — 🟢 conçue ([ADR 0007](../adr/0007-observabilite.md) · [observability/01](../observability/01-metriques-logs-alerting.md))

- [~] **Cloud Eye (CES)** : CPU **déjà** utilisé (idle) ; alertes (BUILD/ERROR) à brancher.
- [x] Workers Observability ✅ + Sentry ✅ (opt-in).
- [x] SLO définis + endpoints `/api/monitoring/*` ✅ ; dashboard Grafana à finaliser.
- [x] **Runbooks** (incident, orphelin, rollback, rotation, DR, migration) ✅ ([operations/01](../operations/01-runbooks.md)).

## Phase 4 — FinOps — 🟢 conçue ([ADR 0008](../adr/0008-finops-couts-garde-fous.md) · [finops/01](../finops/01-modele-couts-et-garde-fous.md))

- [x] Modèle de coûts ECS + **EIP** + EVS ✅.
- [x] Garde-fous : nuit ✅, idle ✅, expiry+libération EIP/EVS ✅, **détection orphelins** ✅ (`huawei-orphans.ts`). Alerte budget à brancher.
- [~] Dashboard coûts par classe/utilisateur — endpoint `cost` ✅, dashboard à finaliser.
- [x] Right-sizing (catalogue raisonnable) ✅.

## Phase 5 — Résilience (HA / DR) — 🟢 conçue ([ADR 0009](../adr/0009-resilience-ha-dr.md) · [architecture/02](../architecture/02-resilience-ha-dr.md))

- [~] Multi-AZ (placement round-robin) — **conçu**, à activer.
- [~] Sauvegarde/restauration D1 (Time Travel + export) — **conçu**, à activer.
- [x] Plan de reprise documenté ([runbook R5](../operations/01-runbooks.md)) — à **tester**.

## Phase 6 — Industrialisation & gouvernance — 🟢 conçue ([governance/01](../governance/01-nommage-tagging-standards.md) · [ADR 0010](../adr/0010-provisioning-evenementiel-queues-do.md))

- [x] **IaC Terraform** (réseau socle + durcissement) ✅.
- [~] **Queues + Durable Objects** (événementiel) — **conçu** ; cron gardé en v1 ([ADR 0010](../adr/0010-provisioning-evenementiel-queues-do.md)).
- [ ] **Propriété Cloudflare canonique** — **prérequis au CI/CD** ([ADR 0004](../adr/0004-propriete-cloudflare-et-cicd.md)).
- [ ] **CI/CD** GitHub → Workers Builds (**après** migration de compte).
- [~] Multi-environnement (preview/prod) — conçu (gouvernance §5).
- [x] Conventions nommage/tagging/standards ✅.

---

### Vue synthétique

| Phase | Thème | Dépend de | Valeur |
|---|---|---|---|
| 0 | Architecture-first | — | conception figée |
| 1 | Parité | 0 + accès Huawei | produit fonctionnel |
| 2 | Sécurité/réseau | 1 | défense en profondeur |
| 3 | Observabilité | 1 | exploitabilité |
| 4 | FinOps | 1 | maîtrise des coûts |
| 5 | HA/DR | 2,3 | résilience |
| 6 | Industrialisation | 1–5 | passage à l'échelle |
