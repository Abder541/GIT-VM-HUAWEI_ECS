# ADR 0004 — Propriétaire Cloudflare canonique avant activation du CI/CD

- **Statut** : Accepté (cible à confirmer : B ou C)
- **Date** : 2026-06-23

## Contexte

Le premier déploiement de validation a été fait sur le compte Cloudflare de **Thomas Prudhomme**
(`thomas.prudhomme@git.swiss`, account `8ff047eb…`) — **le même compte que le portail AWS** (le
`wrangler` local y est authentifié). Il en résulte un **éclatement de propriété** :

| Couche | Propriétaire actuel |
|---|---|
| Dépôt GitHub | **Abder541** + identité git `abderahmane.chaouche@satom.ch` |
| Cloudflare (Worker + D1) | **Thomas** (`thomas.prudhomme@git.swiss`) |
| Huawei (ECS / projet EU) | user `GIT-VM` |
| Entra | tenant `33a7a298…`, app `GIT-VM-Huawei` |

Pour un produit pérenne, la propriété Cloudflare doit être **cohérente avec la gouvernance** du projet.

## Décision

1. **Le déploiement actuel (compte de Thomas) reste en place pour les tests** — il est isolé du
   projet AWS et **réversible**.
2. **Avant d'activer GitHub → Cloudflare Workers Builds**, migrer vers un **propriétaire Cloudflare
   canonique** :
   - **Option B** — compte Cloudflare **propre à l'utilisateur** (Abder) ;
   - **Option C** — compte Cloudflare **dédié au projet / à l'organisation GIT** (meilleure
     gouvernance : séparation des responsabilités, accès équipe).
   Le choix B/C est à confirmer ; il **conditionne** la mise en place du CI/CD.
3. **Validation couche par couche d'abord** (login → workflow → cycle de vie → provisioning réel),
   puis migration de compte, puis CI/CD.

## Conséquences

- Le **CI/CD est volontairement gelé** tant que le compte cible n'est pas figé (Workers Builds lie un
  repo à **un** compte).
- **Procédure de migration** (réversible, ~15 min) quand le compte cible sera choisi :
  1. `wrangler login` sur le compte cible ;
  2. `wrangler d1 create git_vm_portal_huawei` → nouveau `database_id` dans `wrangler.jsonc` ;
  3. `wrangler d1 migrations apply … --remote` ;
  4. `wrangler secret bulk` (re-pousser les 6 secrets) ;
  5. `wrangler deploy` → **nouvelle URL** `*.<sous-domaine-cible>.workers.dev` ;
  6. mettre à jour `APP_URL` et **ajouter** la nouvelle URI de redirection dans l'app Entra
     (l'app Entra accepte **plusieurs** URI → l'URI de test actuelle peut rester) ;
  7. (optionnel) `wrangler delete git-vm-portal-huawei` sur l'ancien compte.
- Les ressources **Huawei** (VPC/subnet/SG, project, AK/SK) et **Entra** ne changent pas — seul le
  plan d'hébergement Cloudflare bouge.

## Suite

Confirmer **B ou C** après la validation fonctionnelle, exécuter la migration, **puis** brancher
Workers Builds sur `Abder541/GIT-VM-HUAWEI_ECS` (build web + migrations D1 remote + deploy sur `main`).
