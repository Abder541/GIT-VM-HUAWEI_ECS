# ADR 0003 — Reprise sur la dernière version AWS : corrections d'analyse & décisions fondatrices

- **Statut** : Accepté
- **Date** : 2026-06-23
- **Remplace/complète** : [0001](0001-worker-distinct-et-architecture-first.md), [0002](0002-client-ecs-direct-vs-sdk.md)

## Contexte

Re-analyse **à la source** de la dernière version du projet AWS de référence
(`Thomas-TP/GIT-VM`), comme demandé : ne pas se fier aux conclusions préliminaires, les
**confirmer / corriger / compléter**. Cet ADR fige (a) les corrections d'analyse et (b) les
arbitrages tranchés au démarrage de la reprise.

## A. Corrections aux analyses préliminaires

| # | Hypothèse préliminaire | Réalité constatée dans le code | Conséquence |
|---|---|---|---|
| C1 | Couture fournisseur = `src/aws.ts` « ~150 lignes / ~10 opérations » | **272 lignes, 15 fonctions exportées** | Le contrat `CloudProvider` doit couvrir **16 méthodes** (cf. `src/cloud.ts`), pas 10. |
| C2 | Opérations = CRUD VM + clés | + **snapshots EVS (×3)**, **lecture volume racine**, **restauration via image (IMS)**, **métriques CPU (CES)** | 5 mappings Huawei supplémentaires, non triviaux (EVS, IMS, Cloud Eye). |
| C3 | `presets.ts` agnostique du cloud | Structure réutilisable mais **données 100 % AWS** (`instanceType`, `ami-…`, tarifs gp3) | `presets.ts` est une **2ᵉ couture** (catalogue) à refaire : flavors / images IMS / EVS / tarifs `eu-west-101`. |
| C4 | DB/SPA totalement agnostiques | Colonnes `aws_instance_id` / `aws_snapshot_id` dans `db.ts`, `types.ts`, `web/` | Couplage **cosmétique** ; base Huawei neuve → on nomme **provider-neutre** (`server_id`, `snapshot_id`, `provider_job_id`). |
| C5 | Durcissement réseau « portable » | `scripts/aws-harden-sg.mjs` = allowlist egress **propre à la sémantique SG AWS** | Le durcissement réseau (la **vraie** barrière) est à **reconcevoir** pour les SG Huawei, pas à porter. Le durcissement *in-VM* reste réutilisable tel quel. |
| C6 | Création synchrone (comme `RunInstances`) | Huawei = **asynchrone** (`job_id`) | Ajout d'une colonne D1 `provider_job_id` + d'une sous-étape `resolveLaunch` dans le réconciliateur. |
| C7 | `SESSION_SECRET` unique | Double rôle : signe les sessions **et** chiffre clés SSH/mots de passe (le roter casse tout) | Édition Huawei : **clé de chiffrement dédiée** `DATA_ENCRYPTION_KEY` (repli sur `SESSION_SECRET` pour la parité). |

**Confirmé** : l'hypothèse centrale tient — une **couture fournisseur unique** + un **réconciliateur
idempotent** (DB = état désiré). Le portage = remplacer la couche, pas réécrire le produit.

## B. Décisions tranchées (arbitrages du client)

### D1 — Périmètre v1 : **parité fonctionnelle totale**
La v1 Huawei reproduit **tout** le modèle opérationnel AWS, pas seulement le provisioning :
ECS + clés KPS + cycle de vie complet + **snapshots EVS** + **restauration IMS** + expiration auto +
extinction nocturne + **idle-stop (CES)** + réconciliateur complet. Les couches *plateforme*
(Cloudflare Access, Queues/Durable Objects, FinOps avancé, segmentation réseau étendue, HA/DR) sont
**conçues maintenant**, **implémentées ensuite**.
> *Raison* : valider d'emblée tous les points de couplage Huawei (EVS, IMS, CES, EIP, job async) et la
> valeur opérationnelle, avant d'empiler l'optimisation/industrialisation.

### D2 — Identité d'exécution : **conserver la clé `GIT-VM` (full-access ECS)**
Le client choisit de **garder la clé AK/SK fournie** (`GIT-VM`, accès programmatique full ECS) pour
toute la durée du projet ; pas de révocation. On configure les accès avec.
> *Réserve d'ingénierie (non bloquante)* : cela déroge au moindre privilège. On **documente quand
> même** la cible scopée (`svc-git-vm-portal` + custom policy, cf. [sécurité IAM](../security/01-iam-permissions-huawei.md))
> comme **durcissement recommandé** activable plus tard, et on active **CTS** pour l'audit. La clé reste
> un **secret Cloudflare** (`wrangler secret put`), **jamais commitée** ; rotation documentée en runbook.
> ⚠️ La clé ayant transité en clair (chat + fichier local), elle est à considérer comme exposée : une
> rotation reste conseillée même si on garde le même utilisateur IAM.

### D3 — Infra socle : **Terraform (provider Huawei Cloud)**
VPC / subnet(s) / security group(s) / EIP / identité sont **pré-provisionnés en IaC Terraform**
(reproductible, versionné, auditable), puis **seulement consommés** par le Worker (qui n'a pas le droit
de muter la plateforme). Terraform passe donc d'une option « phase 6 » à un **prérequis de la parité**.

### D4 — Emplacement : **le dépôt existant devient LE workspace Huawei**
Le dossier brouillon était déjà un **clone du repo cible** `github.com/Abder541/GIT-VM-HUAWEI_ECS`.
Plutôt que créer un second dossier (→ deux dépôts = ambiguïté), on **construit le code dans ce dépôt**
et on **améliore les docs en place**. Dossier renommé `GIT-VM-HUAWEI_ECS` (= nom du repo, sans espace).
Le projet **AWS reste intact, en lecture seule**.

## Conséquences

**Positives** — contrat complet et fidèle dès le départ ; base D1 propre (noms neutres, clé de
chiffrement dédiée) ; un seul dépôt sans ambiguïté ; infra reproductible ; parité validant tous les
couplages Huawei.

**Coûts / risques** — surface d'implémentation v1 plus large (EVS/IMS/CES inclus) ; dérogation assumée
au moindre privilège (mitigée par CTS + cible documentée) ; catalogue (`presets`) entièrement à
reconstruire pour `eu-west-101`.

## Suites

- Mettre à jour [`architecture/01-couche-fournisseur.md`](../architecture/01-couche-fournisseur.md)
  (contrat 16 méthodes, mappings EVS/IMS/CES, impact schéma) ✅.
- Prochains ADR : **0004** réseau/segmentation, **0005** modèle de données (dates/rôles/job async),
  **0006** catalogue flavors/images/EVS `eu-west-101`.
