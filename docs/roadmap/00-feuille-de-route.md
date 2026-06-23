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
- [~] Port de la base saine AWS : `crypto`/`oidc`/`sentry`/`db`/`email`/**`presets`** (catalogue Huawei)/**`index.ts`** (réconciliateur + routes, modèle de job) ✅ (typecheck + 8 tests OK, 2 commits). **Reste : `web/` (SPA)** + exécution bout en bout.
- [x] Schéma D1 : `migrations/0001_init.sql` — colonnes **neutres** + `provider_job_id`, dates/rôles/groupes ✅.
- [ ] Réconciliateur complet : `resolveLaunch` (job→server), `active`, drift, retry, **auto-destroy + libération EIP**, extinction nocturne, **idle-stop (CES)**, **sync snapshots**.
- [ ] Fonctionnel de parité : **snapshots EVS**, **restauration IMS**, expiration auto, planning start/stop, demande groupée formateur.
- [ ] Catalogue presets Huawei (flavors/images IMS/EVS, tarifs `eu-west-101`).
- [ ] Parcours testé de bout en bout : `demande → validation → provisioning → clé SSH/RDP → IP → snapshot → restore → destruction`.
- **Sortie de phase** : démo de parité complète fonctionnelle sur Huawei.

## Phase 2 — Sécurité & réseau

- [ ] **Cloudflare Access** (Zero Trust) devant la surface admin.
- [ ] **WAF + rate limiting** edge.
- [ ] **Segmentation réseau par classe** (map classe → subnet/SG).
- [ ] Durcissement SG (pas de `0.0.0.0/0`, plages autorisées).
- [ ] Rotation AK/SK (runbook) + CTS exploité.

## Phase 3 — Observabilité & exploitation

- [ ] **Cloud Eye (CES)** : métriques ECS, alertes (CPU, VM bloquée en BUILD).
- [ ] Workers Observability + Sentry (releases, traces).
- [ ] SLO + dashboard santé.
- [ ] **Runbooks** : incident provisioning, EIP orpheline, rollback déploiement, rotation secrets.

## Phase 4 — FinOps

- [ ] Modèle de coûts ECS + **EIP** + EVS (l'EIP est le piège coût).
- [ ] Garde-fous : extinction nuit/WE, alerte budget, détection EIP orpheline.
- [ ] Dashboard coûts par classe/utilisateur (via tags).
- [ ] Dimensionnement (right-sizing) des flavors.

## Phase 5 — Résilience (HA / DR)

- [ ] Multi-AZ (placement des VM sur plusieurs zones).
- [ ] Sauvegarde/restauration de la D1 (état désiré) + procédure DR.
- [ ] Plan de reprise documenté + testé.

## Phase 6 — Industrialisation & gouvernance

- [ ] **IaC Terraform** (provider Huawei) pour les ressources de plateforme.
- [ ] **Queues + Durable Objects** : provisioning événementiel (plus réactif que le cron).
- [ ] Multi-environnement (preview/prod), multi-région.
- [ ] Conventions de nommage/tagging formalisées, standards qualité.

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
