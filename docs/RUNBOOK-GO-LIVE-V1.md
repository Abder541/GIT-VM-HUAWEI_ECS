# Runbook — Mise en production V1 (GIT VM Portal Huawei)

> Procédures de go-live : prérequis, déploiement, rollback, validation, exploitation, sécurité
> opérationnelle, observabilité, actions Huawei/Cloudflare. 2026-06-25.
> Classement : **[OBL]** obligatoire avant lancement · **[REC]** recommandée avant · **[POST]** peut attendre après.
> Réfs : [AUDIT-PRODUCTION-V1.md](AUDIT-PRODUCTION-V1.md) · [deployment/01-gitops.md](deployment/01-gitops.md) · [operations/01-runbooks.md](operations/01-runbooks.md).

## 0. Coordonnées de l'environnement (à confirmer avant d'agir)
- Worker prod : `git-vm-portal-huawei.thomas-prudhomme.workers.dev` (compte CF `8ff047eb…`).
- D1 : `git_vm_portal_huawei` (`bfc2962a-…`). Cron unique `*/2`.
- Huawei EU `eu-west-101`, project `85a8db076e4e4e25aa2eeac9e3eb96e0` · VPC/subnet/SG Terraform.
- Secrets attendus (6) : `HUAWEI_ACCESS_KEY`, `HUAWEI_SECRET_KEY`, `ENTRA_CLIENT_SECRET`, `EMAILJS_PRIVATE_KEY`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`.
- ⚠️ État actuel : **16 commits (PR #1) non mergés/déployés** → la prod tourne du code antérieur.

---

## 1. Prérequis techniques & opérationnels
| # | Action | Classe | Objectif | Risque couvert | Effort | Dépendances |
|---|---|---|---|---|---|---|
| P1 | Confirmer le **compte Cloudflare canonique** qui porte la prod (ADR 0004) | **OBL** | Savoir où l'on déploie | Déployer au mauvais endroit | S | décision |
| P2 | Vérifier les **6 secrets** présents (`wrangler secret list`) | **OBL** | Worker fonctionnel | 500 au runtime (creds manquants) | S | accès compte CF |
| P3 | Vérifier l'**app Entra** (redirect URI = URL prod, secret valide, domaines autorisés) | **OBL** | Login OIDC | « Login KO » (cause #1 = config Entra) | S | accès Entra |
| P4 | Confirmer la **commande de déploiement** (cf. `deployment/01-gitops.md`) | **OBL** | Déploiement reproductible | Étape de build/migration oubliée | S | — |
| P5 | Geler une **fenêtre de déploiement** + responsable identifié | **REC** | Coordination | Incident non couvert | S | — |

---

## 2. Checklist de mise en production
| # | Action | Classe | Objectif | Risque couvert | Effort | Dépendances |
|---|---|---|---|---|---|---|
| M1 | **Merger PR #1 → `main`** | **OBL** | Code convergé en ligne | Prod = vieux code (sans fix EVS/catalogue) | S | revue PR |
| M2 | `npm run typecheck && npm --prefix web run typecheck && npm test` sur `main` | **OBL** | Dernière barrière qualité | Régression livrée | S | M1 |
| M3 | **Migrations D1 remote** : `wrangler d1 migrations apply git_vm_portal_huawei --remote` | **OBL** | Schéma à jour (colonnes 0003) | Runtime KO (colonne absente) | S | M1 |
| M4 | **Build SPA** + **déploiement Worker** (cf. `deployment/01-gitops.md`) | **OBL** | Mise en ligne | — | M | M2, M3 |
| M5 | **Validation post-déploiement** (§5) | **OBL** | Confirmer le succès | Panne silencieuse | M | M4 |
| M6 | Connaître/tester la **procédure de rollback** (§4) AVANT | **OBL** | Réagir vite | Indispo prolongée | S | accès CF |
| M7 | Brancher **CI/CD Workers Builds** (build+migrate+deploy auto sur `main`) | **REC** | Déploiements sûrs/reproductibles | Erreur de déploiement manuel | M-L | P1 |

> **Note migrations** : additives uniquement (0001→0003). Une migration appliquée **ne se dé-applique pas** ; voir §4 (le rollback du *code* est sûr, les colonnes additives restent inertes).

---

## 3. Risques de déploiement
| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Migration 0003 non appliquée avant le code | Moyenne | Runtime KO (`rollback_step` absent) | Ordre M3 **avant** M4 |
| Secrets manquants/erronés sur le compte cible | Faible | 500 généralisé | P2 + smoke test M5 |
| Login Entra (redirect URI/secret) | **Moyenne** | Personne ne se connecte | P3 (vérif config) |
| Image_id catalogue invalide en prod | Faible | Échec de création VM | image_id capturés sur le compte prod (déjà valides) |
| Déploiement manuel incomplet (SPA pas rebuildée) | Moyenne | UI obsolète vs API | M4 inclut le build SPA ; ou CI/CD (M7) |
| Drift code vs prod (oubli de merge) | **Élevée actuellement** | Fonctionnalités absentes | M1 |

---

## 4. Procédure de rollback
| # | Action | Classe | Objectif | Effort |
|---|---|---|---|---|
| R1 | **Rollback du Worker** vers la version précédente (Cloudflare : `wrangler rollback` ou dashboard → Deployments → Rollback) | **OBL (procédure prête)** | Restaurer l'état sain en < 2 min | S |
| R2 | Vérifier après rollback : `/api/presets` + login + `wrangler tail` | **OBL** | Confirmer le retour à l'état sain | S |
| R3 | **Données D1** : les migrations étant **additives**, un rollback de code laisse les colonnes ajoutées **inertes** (aucune corruption). Pas de rollback de schéma nécessaire. | info | — | — |
| R4 | (POST) Activer **D1 Time Travel** pour un rollback de données ponctuel si besoin futur | **POST** | DR données | S |
> ⚠️ Ne JAMAIS « rollback » en re-déployant un ancien code qui ignore une colonne : inutile (additif) et risqué. Préférer R1 (rollback natif CF).

---

## 5. Validation post-déploiement (smoke test)
| # | Vérif | Classe | Preuve attendue |
|---|---|---|---|
| V1 | `GET /api/presets` (public) | **OBL** | 200 + catalogue **enrichi** (compute/memory, SSD/SAS, OS Alma/Rocky) = preuve que le nouveau code est en ligne |
| V2 | Login Entra → `GET /api/me` | **OBL** | session OK, rôle correct |
| V3 | `wrangler tail git-vm-portal-huawei --format pretty` pendant ~2 cron ticks | **OBL** | réconciliateur tourne, pas d'erreurs en boucle |
| V4 | (REC) **1 cycle E2E** sur une VM de test : demande→approve→active(IP)→snapshot→stop/start→terminate | **REC** | transforme la parité « hypothèse » en preuve (coût ~qqs centimes) |
| V5 | (REC) Vérifier **0 orphelin** après V4 (`scripts/huawei-orphans.ts`) | **REC** | pas de fuite FinOps |

---

## 6. Sécurité opérationnelle
| # | Action | Classe | Objectif | Risque couvert | Effort | Dépendances |
|---|---|---|---|---|---|---|
| S1 | **Roter la clé AK/SK** full-access exposée (ou **acter le risque par écrit** si le client refuse) | **OBL** | Réduire la surface de compromission | Clé fuitée = contrôle total du compte | M | console IAM Huawei |
| S2 | Ne **PAS** roter `SESSION_SECRET`/`DATA_ENCRYPTION_KEY` sans plan | **OBL (règle)** | Éviter d'invalider tout le chiffré (clés SSH/mdp) | Perte d'accès aux VM existantes | — | — |
| S3 | Appliquer **`harden_egress=true`** (Terraform) puis valider DNS Cloudflare-only + SSH/RDP OK | **REC** | « Barrière réseau » réelle (anti-P2P/X, DNS filtré) | Egress ouvert = durcissement annoncé inactif | M | `terraform apply` + 1 VM test |
| S4 | Cible IAM **moindre privilège** (`svc-git-vm-portal`) | **POST** | Principe du moindre privilège | Sur-privilège | M | décision client |
| S5 | Cloudflare **Access/WAF** devant le portail | **POST** | Filtrage périmètre | Exposition directe | M | — |

---

## 7. Observabilité minimale
| # | Action | Classe | Objectif | Risque couvert | Effort | Dépendances |
|---|---|---|---|---|---|---|
| O1 | Activer **Sentry** (`SENTRY_DSN`) | **REC** | Capturer les erreurs runtime | Pannes non détectées | S | compte Sentry |
| O2 | **Alerte budget Huawei** + (REC) alertes **CES** (erreurs/CPU) | **REC** | Garde-fou coût + santé | Dérive de coût silencieuse | M | console Huawei |
| O3 | `wrangler tail` documenté comme outil d'astreinte | **OBL** | Diagnostic live | Diagnostic lent en incident | S | — |
| O4 | Dashboards **Grafana** (endpoint `/api/monitoring` déjà prêt, `GRAFANA_TOKEN`) | **POST** | Vue d'ensemble | — | M | Grafana Cloud |
| O5 | **CTS** (audit trail Huawei) | **POST** | Traçabilité conformité | — | S | console |

> Le portail expose déjà : `audit_log` D1 + notifications in-app → observabilité **applicative** minimale présente ; manque l'**infra/alerting**.

---

## 8. Actions Huawei Cloud
| # | Action | Classe | Objectif | Effort | Dépendances |
|---|---|---|---|---|---|
| H1 | (si S1) Créer/roter AK/SK + mettre à jour secret CF | **OBL** | Sécurité | M | — |
| H2 | `terraform apply harden_egress=true` | **REC** | Durcissement réseau | M | S3 |
| H3 | Alerte budget + CES | **REC** | FinOps/santé | M | O2 |
| H4 | **real-name authentication** du compte | **POST** | Débloque restore CBR + Windows + posture prod | L | process Huawei |
| H5 | Souscrire image **Windows market** (si Windows voulu) | **POST** | Catalogue Windows | M | H4 ? |
| H6 | Vérifier **quotas** (vCPU, EIP, volumes) suffisants pour la cohorte attendue | **REC** | Éviter le blocage à l'échelle | S | — |

## 9. Actions Cloudflare
| # | Action | Classe | Objectif | Effort | Dépendances |
|---|---|---|---|---|---|
| C1 | Confirmer compte canonique + accès équipe | **OBL** | Gouvernance déploiement | S | P1 |
| C2 | Vérifier secrets + bindings (D1, ASSETS, vars) | **OBL** | Worker fonctionnel | S | — |
| C3 | Brancher **Workers Builds** (CI/CD) | **REC** | Déploiement auto sûr | M-L | C1 |
| C4 | Familiariser l'équipe avec **Rollback** (dashboard) | **OBL** | Réaction incident | S | — |
| C5 | (POST) **Domaine custom** + WAF/Access | **POST** | Pro/sécurité | M | — |

---

## 10. Runbooks d'exploitation (post-lancement)
- **VM bloquée en `provisioning`** : `wrangler tail` → chercher `vm.reconcile.error`/`vm.launch.failed` ; le réconciliateur retente (max 3) ; sinon statut `failed` → investiguer le message Huawei.
- **Drift** (VM supprimée hors portail) : le réconciliateur la passe `terminated` automatiquement (confirmé par double-check). Rien à faire.
- **Dérive de coût** : vérifier les VM `running` non planifiées ; le garde-fou nocturne 19:00 UTC + idle-stop devraient stopper l'inactif ; sinon `scripts/huawei-orphans.ts` pour les orphelins.
- **Incident login** : 99 % = config Entra (redirect URI/secret/domaine), pas le code.
- **Snapshot bloqué `pending`** : `syncSnapshots` le résout au tick suivant ; sinon vérifier EVS.
- **Rollback d'un déploiement raté** : §4 R1.

---

## 11. Synthèse Go / No-Go
**GO minimal (OBL)** : P1-P4 · M1-M6 · V1-V3 · S1(ou risque acté)-S2 · O3 · C1-C2-C4.
**GO professionnel (OBL+REC)** : + S3 (egress) · O1-O2 (Sentry+budget) · V4-V5 (E2E live) · M7/C3 (CI/CD) · P3.
**POST-lancement** : real-name auth → restore CBR · Windows · Grafana/CTS · IAM moindre privilège · HA/DR · WAF.
