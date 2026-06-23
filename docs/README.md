# Documentation — GIT VM Portal · Huawei Cloud Edition

Documentation de niveau entreprise. Chaque décision structurante = un **ADR** (`adr/`).
Statut global : **parité atteinte en production** ; couches avancées (Phases 2-6) **conçues & documentées**.

## Index

### 🏛️ Architecture (`architecture/`)
- [`00-vue-ensemble.md`](architecture/00-vue-ensemble.md) — vision, contexte C4, flux métier, topologie cible.
- [`01-couche-fournisseur.md`](architecture/01-couche-fournisseur.md) — **portage AWS → Huawei** : couture fournisseur, mapping EC2↔ECS, signature AK/SK, modèle de job async, EIP, impact schéma.
- [`02-resilience-ha-dr.md`](architecture/02-resilience-ha-dr.md) — haute dispo & reprise d'activité (D1, multi-AZ, DR).

### 🔐 Sécurité (`security/`)
- [`01-iam-permissions-huawei.md`](security/01-iam-permissions-huawei.md) — permissions IAM (cible moindre privilège), politique custom.

### 🌐 Réseau (`network/`)
- [`01-securite-reseau.md`](network/01-securite-reseau.md) — défense en profondeur, **durcissement egress SG**, segmentation par classe, flux autorisés.

### 🧱 Plateforme (`platform/`)
- [`01-ressources-huawei.md`](platform/01-ressources-huawei.md) — inventaire des ressources (VPC, subnet, SG, EIP, KPS, projet, région).
- [`02-catalogue-flavors-images.md`](platform/02-catalogue-flavors-images.md) — flavors ECS / images IMS / EVS `eu-west-101` (données réelles).

### 📊 Observabilité (`observability/`)
- [`01-metriques-logs-alerting.md`](observability/01-metriques-logs-alerting.md) — CES/CTS/LTS, Sentry, Workers Obs, audit D1, SLO, endpoints Grafana.

### 💶 FinOps (`finops/`)
- [`01-modele-couts-et-garde-fous.md`](finops/01-modele-couts-et-garde-fous.md) — coût ECS/EIP/EVS, scénarios, garde-fous, piège EIP, orphelins.

### 🧭 Gouvernance (`governance/`)
- [`01-nommage-tagging-standards.md`](governance/01-nommage-tagging-standards.md) — nommage, tagging, standards techniques, RACI, environnements.

### 🛠️ Exploitation (`operations/`)
- [`01-runbooks.md`](operations/01-runbooks.md) — rotation AK/SK, incident provisioning, orphelins, rollback, DR, migration de compte.

### 🚀 Déploiement (`deployment/`)
- [`01-gitops.md`](deployment/01-gitops.md) — stratégie GitOps (GitHub → Workers Builds), secrets, environnements.

### 🗺️ Roadmap (`roadmap/`)
- [`00-feuille-de-route.md`](roadmap/00-feuille-de-route.md) — plan par phases (0-6) avec statut.

### 📜 Décisions (`adr/`)
- [0001](adr/0001-worker-distinct-et-architecture-first.md) — Worker distinct & architecture-first.
- [0002](adr/0002-client-ecs-direct-vs-sdk.md) — client ECS direct vs SDK.
- [0003](adr/0003-reprise-decisions-fondatrices.md) — corrections d'analyse + décisions fondatrices.
- [0004](adr/0004-propriete-cloudflare-et-cicd.md) — propriétaire Cloudflare canonique avant CI/CD.
- [0005](adr/0005-securite-reseau-egress-segmentation.md) — sécurité réseau : durcissement egress + segmentation.
- [0006](adr/0006-restauration-snapshot-ims.md) — restauration depuis snapshot (IMS, design, U6).
- [0007](adr/0007-observabilite.md) — pile d'observabilité.
- [0008](adr/0008-finops-couts-garde-fous.md) — modèle FinOps & garde-fous.
- [0009](adr/0009-resilience-ha-dr.md) — résilience HA/DR.
- [0010](adr/0010-provisioning-evenementiel-queues-do.md) — cron vs événementiel (Queues/DO).

### 💻 Code (racine du repo)
- `src/` — `cloud.ts` (contrat 16 méthodes), `huawei.ts` (impl), `huawei-sign.ts` (+tests), `index.ts` (réconciliateur+routes), `db.ts`, `presets.ts`, `schedule.ts` (+tests), `crypto/oidc/email/sentry/types`.
- `infra/terraform/` — réseau socle + `hardening.tf` (durcissement egress).
- `scripts/` — `huawei-discover.mjs`, `huawei-e2e.ts`, `huawei-stabilize.ts`, `huawei-orphans.ts`, `d1-demo.sql`.
- `migrations/0001_init.sql` — schéma D1 neutre.
