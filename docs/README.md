# Documentation — GIT VM Portal · Huawei Cloud Edition

Documentation de niveau entreprise. Chaque décision structurante = un **ADR** (`adr/`).
Statut global : **Phase 0 — Architecture-first** (conception avant tout accès Huawei).

## Index

### 🏛️ Architecture (`architecture/`)
- [`00-vue-ensemble.md`](architecture/00-vue-ensemble.md) — vision, contexte C4, flux métier, topologie cible.
- [`01-couche-fournisseur.md`](architecture/01-couche-fournisseur.md) — **le portage AWS → Huawei** : couture fournisseur, mapping EC2 ↔ ECS, signature AK/SK, modèle de job asynchrone, EIP.

### 🔐 Sécurité (`security/`)
- [`01-iam-permissions-huawei.md`](security/01-iam-permissions-huawei.md) — **permissions IAM minimales** requises pour l'exécution (livrable clé), politique custom, moindre privilège.

### 🧱 Plateforme (`platform/`)
- [`01-ressources-huawei.md`](platform/01-ressources-huawei.md) — inventaire des ressources Huawei à provisionner (VPC, subnets, SG, EIP, flavors ECS, images IMS, KPS, projet, région).

### 🚀 Déploiement (`deployment/`)
- [`01-gitops.md`](deployment/01-gitops.md) — stratégie GitOps (GitHub → Cloudflare Workers Builds), gestion des secrets, environnements.

### 🗺️ Roadmap (`roadmap/`)
- [`00-feuille-de-route.md`](roadmap/00-feuille-de-route.md) — plan par phases : socle parité → couches avancées.

### 📜 Décisions (`adr/`)
- [`0001-worker-distinct-et-architecture-first.md`](adr/0001-worker-distinct-et-architecture-first.md)
- [`0002-client-ecs-direct-vs-sdk.md`](adr/0002-client-ecs-direct-vs-sdk.md)
- [`0003-reprise-decisions-fondatrices.md`](adr/0003-reprise-decisions-fondatrices.md) — **corrections d'analyse + décisions fondatrices** (parité totale, identité, Terraform, repo).

### 💻 Code (à la racine du repo)
- [`src/cloud.ts`](../src/cloud.ts) — **contrat `CloudProvider`** (16 méthodes, provider-neutre).
- [`src/types.ts`](../src/types.ts) — bindings `HUAWEI_*` + session.
- `wrangler.jsonc`, `package.json`, `tsconfig.json` — Worker distinct + base D1 `git_vm_portal_huawei`.

## Sections à venir (placeholders créés, contenu en cours)

| Dossier | Contenu prévu |
|---|---|
| `network/` | Topologie VPC, segmentation par classe, security groups, flux autorisés. |
| `observability/` | Métriques (CES + Workers), logs, traces, alerting, SLO. |
| `operations/` + `runbooks/` | Exploitation courante, procédures incident, on-call. |
| `governance/` | Conventions, nommage, tagging, standards, qualité. |
| `finops/` | Modèle de coûts ECS/EIP/EVS, garde-fous, dashboard, dimensionnement. |
| `decisions/` | Notes de décision non-ADR, comparatifs, benchmarks. |

> Ces dossiers existent déjà dans l'arborescence ; leur contenu est priorisé dans la
> [feuille de route](roadmap/00-feuille-de-route.md).
