# Déploiement — Stratégie GitOps

> Objectif : **`git push` = déploiement**. Réduire au maximum les opérations manuelles, la gestion
> de secrets dispersée et la complexité opérationnelle.

## 1. Flux cible

```
 Développeur ──push──▶ GitHub (Abder541/GIT-VM-HUAWEI_ECS)
                          │
                          ├─ CI : typecheck + lint + tests (GitHub Actions)   ⟵ bloquant
                          │
                          ▼
                  Cloudflare Workers Builds  ──build SPA + deploy Worker──▶  Production
                          │
                          └─ migrations D1 appliquées (étape contrôlée)
```

Deux briques complémentaires :
1. **GitHub Actions** — qualité (PR gate) : `npm ci`, `typecheck`, `lint`, `test`. Empêche de merger
   du code cassé. Ne déploie pas (séparation des responsabilités).
2. **Cloudflare Workers Builds** — connecté au repo : build (`web` → `web/dist`) + `wrangler deploy`
   sur push `main`. Pas de `wrangler deploy` manuel depuis un poste.

> Alternative si Workers Builds indisponible : un job GitHub Actions `deploy` utilisant
> `cloudflare/wrangler-action` avec un `CLOUDFLARE_API_TOKEN` à portée minimale. Documenté en repli.

## 2. Environnements

| Env | Branche | Worker | D1 | Domaine |
|---|---|---|---|---|
| **Production** | `main` | `git-vm-huawei` | `git_vm_huawei` | `*.workers.dev` (puis domaine custom) |
| **Preview** *(option)* | PR | preview Worker éphémère | D1 preview ou local | URL de preview Cloudflare |

> Séparer prod et preview évite de tester sur la base de prod. Phase « plateforme avancée ».

## 3. Gestion des secrets

| Secret | Où | Notes |
|---|---|---|
| `HUAWEI_ACCESS_KEY` / `HUAWEI_SECRET_KEY` | `wrangler secret put` (prod) | AK/SK IAM moindre privilège. Jamais commités. |
| `ENTRA_CLIENT_SECRET` | `wrangler secret put` | OIDC. |
| `SESSION_SECRET` | `wrangler secret put` | signature JWT + dérivation clé de chiffrement. |
| `EMAILJS_PRIVATE_KEY` | `wrangler secret put` | notifications. |
| `CLOUDFLARE_API_TOKEN` *(si Actions deploy)* | GitHub Secrets | portée minimale (Workers Scripts:Edit). |

Règles :
- **Aucun secret dans le repo** ni dans `wrangler.jsonc` (seulement des vars publiques).
- Pour le multi-env, envisager **Cloudflare Secrets Store** (centralisation) — phase avancée.
- **Rotation** documentée en runbook (AK/SK Huawei en priorité).

## 4. Migrations D1

- Migrations versionnées dans `migrations/` (comme le projet AWS).
- Appliquées **explicitement** (`wrangler d1 migrations apply <db> --remote`), idéalement via une
  étape de pipeline distincte et contrôlée (pas en silence à chaque deploy) pour garder la maîtrise
  des changements de schéma.

## 5. Garde-fous

- **CI bloquante** sur PR : pas de merge si `typecheck`/`lint`/`test` échouent.
- **Rollback** : `wrangler rollback` (Workers garde les versions) ou redeploy d'un tag précédent.
  Procédure dans `runbooks/` (à rédiger).
- **Observabilité du déploiement** : Workers Observability activé + Sentry (releases).

## 6. Pourquoi GitOps ici

| Bénéfice | Effet |
|---|---|
| Reproductibilité | l'état déployé = l'état du repo, traçable par commit. |
| Moins de secrets en circulation | déploiement piloté par la plateforme, pas par des postes. |
| Revue obligatoire | tout passe par PR + CI. |
| Rollback simple | versions Workers + tags git. |
