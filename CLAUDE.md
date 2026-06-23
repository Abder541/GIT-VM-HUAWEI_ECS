# CLAUDE.md — Contexte projet GIT VM Portal · Huawei Cloud Edition

> Fichier de contexte pour l'IA (Claude Code) **et** pour l'équipe. À lire en premier.
> Édition **Huawei Cloud ECS + Cloudflare**, dérivée du projet AWS de référence.
> Mis à jour le 2026-06-23.

---

## 1. En une phrase

Plateforme **self-service de provisioning de VM** : un utilisateur authentifié en SSO Entra ID
demande une VM depuis un catalogue, un validateur approuve, la VM est provisionnée
**automatiquement sur Huawei Cloud ECS** avec une **clé SSH unique chiffrée**, et détruite à sa
date de fin. Le tout piloté par un **Worker Cloudflare** et un **réconciliateur idempotent**.

## 2. Règle d'or : on NE touche PAS au projet AWS

- Le dépôt AWS (`Thomas-TP/GIT-VM`, dossier `Downloads/GIT-VM-main`) est **référence en lecture
  seule**. Source de connaissances, de patterns et de bonnes pratiques. **Jamais modifié.**
- Cette édition Huawei est un **Worker Cloudflare distinct** : nom différent, base D1 différente,
  domaine différent, secrets différents, pipeline de déploiement différent.
- Repo cible : `https://github.com/Abder541/GIT-VM-HUAWEI_ECS`.

## 3. Stratégie : architecture-first, parité d'abord

1. **Concevoir** l'architecture cible complète maintenant (toutes les couches), même si certaines
   ne sont activées que plus tard.
2. **Livrer d'abord la parité fonctionnelle** : le parcours de bout en bout sur Huawei
   (`demande → validation → provisioning ECS → clé SSH → réseau → destruction → audit → observabilité`).
3. **Empiler ensuite** les couches avancées (Cloudflare Access, GitOps, Queues/Durable Objects,
   FinOps, segmentation réseau, HA, DR, gouvernance, sécurité avancée) — toutes déjà documentées.
4. Aucun déploiement Huawei tant que la conception et le **périmètre IAM minimal** ne sont pas validés.

## 4. Stack cible

| Couche | Techno |
|---|---|
| Frontend | React 19 + Vite + TS + Tailwind v4 + TanStack Query + react-i18next (réutilisé de l'AWS) |
| Backend | Cloudflare Worker (**Hono**) — API JSON + cron `scheduled` |
| Base de données | Cloudflare **D1** (SQLite) — nouvelle instance |
| Hébergement | Cloudflare Workers Static Assets (SPA) |
| Auth | Microsoft **Entra ID** (OIDC authorization code, in-Worker, sans librairie) |
| Compute | **Huawei Cloud ECS** (région cible : EU-Dublin `eu-west-101`, à confirmer) |
| Signature API | **AK/SK « SDK-HMAC-SHA256 »** Huawei, implémentée en WebCrypto (pas de SDK lourd) |
| Réseau | Huawei **VPC** + Subnet(s) + Security Group(s) + **EIP** |
| Clés SSH | Huawei **KPS/DEW** (clé privée renvoyée une fois, chiffrée AES-GCM au repos) |
| Email | EmailJS (REST) — réutilisé |
| Erreurs / Observabilité | Sentry (optionnel) + Workers Observability + Huawei **Cloud Eye (CES)** |
| CI/CD | **GitOps** : GitHub → Cloudflare Workers Builds |

## 5. La couche fournisseur (le seul vrai travail de portage)

Tout le code spécifique AWS du projet de référence tient dans **`src/aws.ts`** (~154 lignes) +
les bindings `AWS_*`. Tout le reste (D1, OIDC, crypto, presets, email, réconciliateur) est
**agnostique du cloud**. Le portage = remplacer cette couche par **`src/huawei.ts`**
(client ECS REST/JSON + signature AK/SK + modèle de job asynchrone + gestion EIP).

Détails : [`docs/architecture/01-couche-fournisseur.md`](docs/architecture/01-couche-fournisseur.md).

## 6. Le pattern central : le réconciliateur

La **DB = état désiré**. Une cron réconcilie le réel Huawei avec la DB :
`provisioning → active`, détection de drift, retry des échecs, libération des EIP à la destruction,
auto-destroy à `end_date`, garde-fous coûts. **Toute nouvelle automatisation s'y ajoute.**

## 7. Sécurité (cible)

- Clé SSH unique par VM, **chiffrée AES-GCM au repos**, téléchargeable par le propriétaire/admin.
- Sessions = JWT HMAC signé maison, cookie `HttpOnly; Secure; SameSite=Lax`.
- `audit_log` sur toutes les actions sensibles.
- **IAM Huawei moindre privilège** : AK/SK d'un utilisateur IAM dédié, politique custom limitée
  au strict nécessaire (ECS/VPC/EIP/KPS/IMS), scopée au projet. Jamais une clé admin.
- Secrets via `wrangler secret put` / pipeline — jamais commités.
- Défense en profondeur (futur) : Cloudflare Access devant l'admin, WAF, rate limiting.

## 8. Règles de travail

- **Ne pas casser, ne pas pivoter** : on réutilise les patterns validés de l'AWS, on remplace la
  couche fournisseur, on améliore là où c'est justifié.
- Toute évolution de cycle de vie passe par le **réconciliateur**.
- **Documentation continue** : un ADR par décision structurante (`docs/adr/`).
- Convention de code : TS strict, Hono, pas de dépendances lourdes (réutiliser le style AWS).
- Langue de la doc : **français**.

## 9. Commandes (cible, une fois le code scaffolddé)

```bash
npm install && npm --prefix web install      # deps
npx wrangler dev                              # worker (API) :8787
npm --prefix web run dev                      # SPA hot-reload
npx wrangler deploy                           # déploie worker + assets
npx wrangler d1 migrations apply <db> --remote
npm test ; npm run typecheck ; npm run lint
```
