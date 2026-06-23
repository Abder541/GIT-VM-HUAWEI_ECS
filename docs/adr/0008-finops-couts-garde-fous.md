# ADR 0008 — Modèle FinOps & garde-fous de coût

- **Statut** : Accepté (garde-fous majeurs déjà implémentés)
- **Date** : 2026-06-23

## Contexte

Sur Huawei, contrairement à AWS, l'**EIP est une ressource facturée à cycle de vie propre**
([ADR 0003](0003-reprise-decisions-fondatrices.md), couche fournisseur). Le coût d'une VM = **ECS +
EVS + EIP** (+ snapshots). Sans garde-fous, des VM oubliées ou des EIP orphelines génèrent des coûts.

## Modèle de coût (par VM, `eu-west-101`, EUR approx)

| Poste | Facturé quand | Estimation |
|---|---|---|
| ECS (flavor) | VM **allumée** | `s6.large.2` ~0,036 €/h |
| EVS (disque) | VM **existe** (même éteinte) | GPSSD ~0,10 €/Go/mois |
| **EIP** | **allouée** (même VM éteinte) | ~3–6 €/mois — *le piège* |
| Snapshot EVS | tant qu'il existe | ~stockage Go/mois |

## Décisions — garde-fous

1. **Extinction nocturne** (cron, 19:00 UTC) — déjà implémenté (`scheduledStop`, fusionné dans l'unique cron).
2. **Arrêt sur inactivité** (CES CPU < 10 %) — déjà implémenté (`enforceIdleStop`).
3. **Expiration automatique** à `end_date` → **terminate** qui **libère EIP + EVS** (`delete_publicip` +
   `delete_volume`) — déjà implémenté (`enforceExpiry`). **Aucune machine sans date de fin.**
4. **Détection d'orphelins** (EIP/EVS/snapshots/serveurs non gérés) — `scripts/huawei-orphans.ts`.
5. **Estimation de coût dans l'UI** (par VM, mensuel) — déjà implémenté (`estimateMonthlyEur`,
   endpoint `/api/monitoring/cost`).
6. **Alerte budget** (cible) — Cloud Eye / budget Huawei, seuil mensuel + mail (équivalent de
   `aws-budget.mjs`).
7. **Right-sizing** — catalogue de flavors raisonnables (s6.*), pas de gabarits surdimensionnés.

## Conséquences

**Positives** — coût borné : une VM ne tourne que quand on l'utilise (nuit/idle), est détruite à
l'échéance (EIP+EVS libérés), et les orphelins sont détectables. L'EIP — principal piège — est libérée
à la destruction et surveillée.

**Négatives / reste** — l'EIP d'une VM **éteinte** reste facturée (compromis : garder l'IP stable vs la
libérer/réallouer) → à arbitrer si besoin. Alerte budget à brancher (action compte Huawei).
