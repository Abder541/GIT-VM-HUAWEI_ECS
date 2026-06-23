# ADR 0007 — Pile d'observabilité

- **Statut** : Accepté (signaux définis ; CES idle déjà utilisé, Sentry/Workers Obs câblés)
- **Date** : 2026-06-23

## Contexte

Plateforme de niveau entreprise → besoin de **métriques, logs, traces, audit et alerting**, à la fois
côté **Cloudflare** (plan de contrôle) et **Huawei** (plan de charge). Réutiliser au maximum l'existant.

## Décisions — signaux par couche

| Domaine | Outil | État | Usage |
|---|---|---|---|
| Métriques VM (CPU, réseau, disque) | **Cloud Eye (CES)** | CPU déjà consommé (idle-stop) | alertes : VM bloquée en `BUILD`, CPU anormal, EIP saturée |
| Audit des appels AK/SK | **CTS (Cloud Trace Service)** | à activer (sécurité) | qui/quoi/quand sur l'AK/SK — non-répudiation |
| Logs VM (optionnel) | **LTS (Log Tank Service)** | phase avancée | centralisation si besoin |
| Logs/traces du Worker | **Workers Observability** | ✅ activé (`observability.enabled`) | requêtes, erreurs, cron |
| Erreurs applicatives | **Sentry** | ✅ câblé (`SENTRY_DSN`, `sentry.ts`) | exceptions du Worker (opt-in) |
| Audit métier | **`audit_log` (D1)** | ✅ en place | toutes les actions (approve, launch, terminate, drift…) |
| Tableaux de bord | **Grafana** (Infinity) | endpoints `/api/monitoring/*` ✅ | statut, coûts, OS, utilisateurs, métriques |

## SLO proposés

- **Taux de succès de provisioning** ≥ 98 % (dérivable de `metrics()` : active+terminated / +failed).
- **Délai approve → active** p95 < 5 min (calculé dans `metrics()` via l'audit).
- **Disponibilité du portail** (Worker) ≥ 99,9 % (Cloudflare).

## Alerting (cible)

- CES : VM en `BUILD`/`ERROR` > 10 min ; CPU > 90 % soutenu ; échec de job de création.
- Worker : taux d'erreur 5xx, échecs cron répétés (Sentry/Workers Obs).
- FinOps : EIP orpheline détectée ([FinOps](../finops/01-modele-couts-et-garde-fous.md)).

## Conséquences

**Positives** — couverture bout en bout, réutilise l'existant (audit D1, Sentry, Workers Obs, endpoints
Grafana, CES idle). Coût marginal faible.

**Négatives** — CES/CTS/LTS ajoutent un peu de coût Huawei (faible) ; intégration Grafana à finaliser
(datasource Infinity + token). CTS à activer côté compte (action équipe Huawei).
