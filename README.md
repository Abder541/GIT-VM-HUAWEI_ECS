# GIT VM Portal — Huawei Cloud Edition

> Plateforme **self-service de provisioning de VM** pour le Geneva Institute of Technology (GIT),
> portée sur **Huawei Cloud ECS** + **Cloudflare**, conçue comme un produit de long terme :
> sécurisée, automatisée, observée, documentée et industrialisable.

Un étudiant / formateur se connecte en **SSO Microsoft (Entra ID)**, demande une VM depuis un
catalogue, un validateur approuve/refuse, la VM est **provisionnée automatiquement sur Huawei ECS**
avec une **clé SSH unique chiffrée au repos** (ou un mot de passe RDP Windows), **sauvegardable**
(snapshots EVS), **arrêtée si inactive**, et **détruite à sa date de fin**.

---

## Statut

🟢 **Phase 0 — Architecture-first (quasi terminée).** Le projet AWS de référence
([`Thomas-TP/GIT-VM`](https://github.com/Thomas-TP/GIT-VM)) est **fonctionnel et sert de socle de
connaissances** (lecture seule, jamais modifié). Cette édition Huawei est un **Worker Cloudflare
distinct** (nouveau projet, nouvelle base D1 `git_vm_portal_huawei`, nouveau domaine, nouveaux secrets).

**Décisions actées** ([ADR 0003](docs/adr/0003-reprise-decisions-fondatrices.md)) : **parité
fonctionnelle totale** en v1 · identité = clé `GIT-VM` conservée (cible moindre privilège documentée) ·
infra socle en **Terraform** · ce dépôt est **le** workspace Huawei.

La **fondation code** est posée : contrat de couche fournisseur [`src/cloud.ts`](src/cloud.ts)
(16 méthodes), [`src/types.ts`](src/types.ts), et la config Worker/D1 (`wrangler.jsonc`).

### ▶️ Prochaine étape

Construire le **socle de parité** (Phase 1), sans dépendre encore d'un accès Huawei pour la majeure
partie :

1. `src/huawei-sign.ts` — signature AK/SK « SDK-HMAC-SHA256 » (WebCrypto) **+ tests vecteurs**.
2. `src/huawei.ts` — client ECS/EIP/KPS/**EVS/IMS/CES** implémentant le contrat `CloudProvider`.
3. Port de la base saine AWS (hors `aws.ts`) : `db.ts` (colonnes **neutres** + `provider_job_id`),
   `oidc.ts`, `crypto.ts`, `email.ts`, `index.ts` (réconciliateur), `web/`.
4. `infra/terraform/` — VPC + subnet + SG + (identité/CTS) sur `eu-west-101`.

Voir la [feuille de route](docs/roadmap/00-feuille-de-route.md).

## Par où commencer

| Je veux… | Lire |
|---|---|
| Comprendre la cible en 5 min | [`docs/architecture/00-vue-ensemble.md`](docs/architecture/00-vue-ensemble.md) |
| Voir comment AWS devient Huawei | [`docs/architecture/01-couche-fournisseur.md`](docs/architecture/01-couche-fournisseur.md) |
| Lire le contrat de couche fournisseur | [`src/cloud.ts`](src/cloud.ts) |
| Connaître les ressources Huawei à créer | [`docs/platform/01-ressources-huawei.md`](docs/platform/01-ressources-huawei.md) |
| Connaître les permissions IAM (cible) | [`docs/security/01-iam-permissions-huawei.md`](docs/security/01-iam-permissions-huawei.md) |
| Savoir comment ça se déploie | [`docs/deployment/01-gitops.md`](docs/deployment/01-gitops.md) |
| Voir le plan par phases | [`docs/roadmap/00-feuille-de-route.md`](docs/roadmap/00-feuille-de-route.md) |
| Lire toutes les décisions | [`docs/adr/`](docs/adr/) |

## Principe directeur

> **La DB est l'état désiré. Un réconciliateur idempotent (cron Cloudflare) aligne le réel Huawei
> sur la DB.** Toute automatisation de cycle de vie (provisioning job→server, EIP, auto-destroy,
> extinction, idle-stop, snapshots, notifications d'échéance) **s'ajoute au réconciliateur** — jamais
> un mécanisme parallèle.

Ce pattern, hérité du projet AWS, est le cœur robuste de l'architecture (futur ADR 0004/0005).

## Documentation

Toute la documentation entreprise vit sous [`docs/`](docs/) — index :
[`docs/README.md`](docs/README.md). Toute décision structurante = un ADR (`docs/adr/`).
Langue : **français** (équipe + client francophones).
