# Gouvernance — nommage, tagging, standards

> Conventions pour un parc cohérent, traçable et imputable. S'applique aux ressources **plateforme**
> (Terraform) et **de charge** (créées par le portail).

## 1. Nommage

| Ressource | Convention | Exemple |
|---|---|---|
| Worker | `git-vm-portal-huawei` | — |
| Base D1 | `git_vm_portal_huawei` | — |
| VPC / subnet / SG | `git-vm-portal-{vpc\|subnet\|sg}[-<classe>]` | `git-vm-portal-sg-cyber` |
| VM (tag `Name`) | `<nom-vm>.<préfixe-email>` | `python.thomas.prudhomme` |
| Clé SSH (KPS) | `vm-portal-req-<id>` | `vm-portal-req-42` |
| Image de restauration (IMS) | `gitvm-restore-<id>` | `gitvm-restore-42` |
| Utilisateur IAM | `svc-git-vm-portal` (cible) / `GIT-VM` (actuel) | — |

## 2. Tagging (obligatoire sur toute ressource de charge)

| Tag | Valeur | Usage |
|---|---|---|
| `managed-by` | `git-vm-portal` | réconciliation + détection d'orphelins |
| `request-id` | `<id>` | corrélation D1 ↔ cloud |
| `class` | `<classe/cours>` | segmentation réseau + **imputation FinOps** |

> Les ressources **plateforme** (Terraform) portent `managed-by=git-vm-portal` + `usage=platform`.

## 3. Standards techniques

- **TypeScript strict**, Hono, **zéro dépendance lourde** (signature/crypto maison en WebCrypto).
- **Migrations D1 additives** uniquement.
- **i18n** : toute clé `fr` doit exister en `en` (`en: typeof fr`).
- **Secrets** : `wrangler secret put` / `.dev.vars` (gitignoré) — **jamais** dans le repo.
- **Un changement structurant = un ADR** (`docs/adr/`).
- **Docs & commentaires en français** ; code/identifiants en anglais.
- **CI** (cible) : `typecheck` + `test` (worker & web) avant tout déploiement.

## 4. Cycle de vie & responsabilités (RACI simplifié)

| Action | Member | Formateur | Admin | Système (cron) |
|---|---|---|---|---|
| Demander une VM | ✅ | ✅ | ✅ | — |
| Demande groupée | — | ✅ | ✅ | — |
| **Valider / provisionner** | — | — | ✅ | (retry only) |
| Gérer les rôles | — | — | ✅ | — |
| Extinction nuit/idle, expiry, drift | — | — | — | ✅ |

## 5. Environnements (cible)

- **prod** (actuel) + **preview** (par branche, via Workers Builds une fois le compte canonique choisi —
  [ADR 0004](../adr/0004-propriete-cloudflare-et-cicd.md)). Une **D1 par environnement**.
