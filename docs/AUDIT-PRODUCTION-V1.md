# Audit final — Préparation production V1 (GIT VM Portal Huawei)

> Évaluation **honnête** du niveau de préparation production. 2026-06-25.
> Deux lectures distinctes : **code/fonctionnel** (élevé) vs **opérationnel/lancement** (moyen,
> dépend d'actions hors-code). Distingue prouvé / hypothèse / gated. Réfs :
> [ETAT-CONVERGENCE-V1.md](ETAT-CONVERGENCE-V1.md), [ROADMAP-HUAWEI.md](ROADMAP-HUAWEI.md).

## 1. Risques production classés

### 🔴 Bloquant production
| Risque | Preuve | Impact | Action | Code ? |
|---|---|---|---|---|
| **Clé AK/SK full-access exposée** (chat + `.dev.vars` + `credentials.csv`) | mémoire/ADR 0003 ; clé en clair | Compromission = contrôle total du compte Huawei | Rotation + cible moindre privilège | **Hors-code** (console IAM) |
| **Travail non déployé** : tous les commits de convergence sont sur la branche PR `feat/…`, **non mergés** → la prod live tourne du code **antérieur** | `git rev-list --count origin/main..HEAD` = **16**, PR #1 ouverte | La prod n'a PAS catalogue enrichi / fix EVS / parking restore | Merger sur `main` + déployer | **Hors-code** (décision + deploy) |

### 🟠 Important
| Risque | Preuve | Impact | Action | Code ? |
|---|---|---|---|---|
| **Observabilité quasi nulle** | Sentry optionnel, `/api/monitoring` gated `GRAFANA_TOKEN`, alertes CES non posées, CTS off | Exploitation à l'aveugle (pannes non détectées) | Activer Sentry + Grafana + alertes CES budget/erreurs | Mixte (config surtout hors-code) |
| **CI/CD absent** | pas de Workers Builds branché (bloqué décision compte CF, ADR 0004) | Déploiement manuel, risque d'erreur/drift | Trancher compte CF → brancher build+migrate+deploy | **Hors-code** (décision) |
| **real-name auth non faite** | `IMG.0026` live | Bloque restore (DR « nouvelle VM ») ; souvent requis pour compte prod | Authentification compte (console) | **Hors-code** |
| **Durcissement egress non appliqué** | `harden_egress=false` (Terraform) | « Barrière réseau » annoncée inactive → VM sortent partout | `terraform apply` avec `harden_egress=true` (valider DNS/SSH) | **Hors-code** (apply infra) |
| **Parité E2E non re-validée live** | aucun run E2E ce sprint (gated VM) | Risque de régression non détectée | 1 run E2E live (create→active→snapshot→stop→terminate) | **Hors-code** (VM facturable) |
| **idle-stop CES non prouvé** | `maxCpuOverWindow` jamais confirmé live | Garde-fou coût potentiellement inerte | Test live avec charge CPU réelle | **Hors-code** |
| **Mail désactivé** | `MAIL_ENABLED=false` | Pas de notif email (in-app seulement) | Renseigner secrets/template EmailJS | **Hors-code** (secrets) |

### 🟢 Amélioration future
Windows (market), GPU (admin), disques data, restore CBR, multi-AZ / HA-DR, Cloudflare Access/WAF, FinOps avancé (alerte budget), segmentation réseau. Tous **conçus**, non bloquants pour une V1 Linux.

## 2. Audit final V1

- **Réellement terminé (prouvé)** : provider 16 méthodes ; cycle de vie create→destroy (validé live E2E *antérieurement*) ; catalogue PERF/STORAGE/OS enrichi ; contrat frontend↔backend cohérent ; création `batch` validée ; flux extension complet ; approve→provision robuste ; chiffrement at-rest testé ; garde-fous **verts** (typecheck worker+SPA, lint, 51 tests, build prod 489 KB).
- **Prouvé cette session** : qualité code (typecheck/lint/test/build) + cohérence contrat + robustesse approve.
- **Hypothèse (non prouvé live ce sprint)** : parité E2E du réconciliateur ; idle-stop CES ; comportement sous charge.
- **Dépend d'un environnement réel** : E2E live, idle-stop, hardening egress, métriques CES, déploiement.
- **GATED** : restore CBR (real-name), Windows (market), CI/CD (compte CF), Mail (secrets), rotation clé (console).

## 3. Pourcentage réaliste de préparation production

| Domaine | % | Justification |
|---|---|---|
| **Architecture** | **90 %** | Seam fournisseur propre, réconciliateur desired-state, D1 neutre, infra Terraform. HA/DR & segmentation conçues non implémentées. |
| **Backend** | **85 %** | Code complet + validé + flux robustes ; restore gated, idle-stop non prouvé live, non déployé depuis la branche courante. |
| **Frontend** | **80 %** | SPA build OK, flux câblés, i18n FR/EN ; non re-testé live ce sprint, UX fonctionnelle (non « WOW »). |
| **Sécurité** | **55 %** | Auth Entra + chiffrement at-rest testé + SG. MAIS clé full-access exposée (non rotée), egress ouvert, pas de WAF. |
| **Observabilité** | **35 %** | Audit log + notifs in-app + endpoint Grafana prêt. Pas de monitoring/alerting actif, CTS off. |
| **Exploitation** | **55 %** | Réconciliateur cron + runbooks documentés + garde-fous codés ; mais non prouvés live + pas d'alerting + deploy manuel. |
| **CI/CD** | **25 %** | Aucun pipeline branché ; déploiement manuel ; PR non mergée. Bloqué décision compte CF. |
| **Cloud** | **55 %** | VPC/subnet/SG/EIP Terraform, région EU. MAIS clé full-access, real-name auth absente, mono-AZ, mono-compte. |

**Global pondéré ≈ 60 % production-ready opérationnel** · ≈ **85 % code/fonctionnel** (périmètre Linux non-gated).

## 4. Verdict
**Aucun bloqueur de CODE** : le périmètre V1 Linux non-gated est cohérent, robuste et déployable.
Les bloqueurs/risques sont **opérationnels et hors-code** : sécurité de la clé, déploiement de la branche, observabilité, CI/CD, real-name auth. → On passe en **préparation de lancement V1** (§5), pas en nouveaux cycles de nettoyage.

## 5. Préparation lancement V1 — checklist ordonnée (toutes hors-code, à l'exploitant)
1. **Merger la PR #1 sur `main` + déployer** (la prod doit refléter le code convergé). *(préalable à tout)*
2. **Sécurité** : roter la clé AK/SK (ou acter le risque), appliquer `harden_egress=true`.
3. **Validation live** : 1 run E2E (create→snapshot→stop→terminate) + idle-stop sous charge → transformer les hypothèses §2 en preuves.
4. **Observabilité minimale** : activer Sentry + alerte budget/erreurs (sinon lancement à l'aveugle).
5. **CI/CD** : trancher le compte Cloudflare → brancher Workers Builds (build + migrate D1 + deploy).
6. **Mail** : secrets/template EmailJS si notifications email voulues.
7. **(Différé)** real-name auth → restore CBR ; Windows market ; HA/DR.
