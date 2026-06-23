# Observabilité — métriques, logs, audit, alerting

> Décisions : [ADR 0007](../adr/0007-observabilite.md). Principe : réutiliser l'existant, couvrir les
> deux plans (Cloudflare = contrôle, Huawei = charge).

## 1. Vue d'ensemble

| Question opérationnelle | Source |
|---|---|
| « Le portail répond-il ? » | `GET /healthz`, Workers Observability |
| « Une VM est-elle bloquée en création ? » | réconciliateur (audit `vm.job.resolved` absent) + CES |
| « Qui a fait quoi ? » | `audit_log` (D1) + **CTS** (appels AK/SK) |
| « Combien ça coûte ? » | `/api/monitoring/cost` + [FinOps](../finops/01-modele-couts-et-garde-fous.md) |
| « Y a-t-il des orphelins facturés ? » | `scripts/huawei-orphans.ts` |
| « Une erreur applicative ? » | Sentry (`SENTRY_DSN`), Workers Observability |

## 2. Endpoints de monitoring (déjà implémentés)

`GET /api/monitoring/:metric` (token `GRAFANA_TOKEN`) — `summary`, `daily`, `os`, `users`, `audit`,
`metrics`, `cost`. Pensés pour une **datasource Grafana Infinity** (cf. `monitoring/` côté AWS).

## 3. Métriques Huawei (Cloud Eye / CES)

- **Déjà utilisé** : `cpu_util` sur fenêtre glissante → **arrêt sur inactivité** (`maxCpuOverWindow`).
- **À ajouter (alertes)** : VM en `BUILD`/`ERROR` > 10 min, CPU saturé, bande passante EIP saturée,
  échec de job de création ECS.

## 4. Audit & traçabilité

- **`audit_log` (D1)** : chaque transition (`request.approve`, `vm.launch`, `vm.active`,
  `vm.drift.terminated`, `vm.expired.terminated`, `snapshot.*`, `user.role`…). Consultable dans la
  console admin.
- **CTS (Huawei)** : trace **tous les appels API de l'AK/SK** (non-répudiation, conformité). À activer
  sur le compte (action équipe Huawei) — cf. [sécurité IAM](../security/01-iam-permissions-huawei.md).

## 5. SLO & santé

| SLO | Cible | Mesure |
|---|---|---|
| Succès de provisioning | ≥ 98 % | `metrics().successRate` |
| Délai approve → active (p95) | < 5 min | audit (`request.approve` → `vm.active`) |
| Dispo du portail | ≥ 99,9 % | Cloudflare |

## 6. Reste à brancher

- Datasource Grafana Infinity + `GRAFANA_TOKEN` (secret) → dashboards (réutiliser ceux d'AWS dans
  `monitoring/`).
- Règles d'alerte CES (console ou Terraform `huaweicloud_ces_alarmrule`).
- Activation CTS.
