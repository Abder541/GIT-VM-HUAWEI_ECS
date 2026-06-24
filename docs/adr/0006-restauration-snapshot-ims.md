# ADR 0006 — Restauration d'une VM depuis un snapshot (Huawei IMS)

- **Statut** : ⚠️ **SUPERSEDÉ / GATÉ** (2026-06-24) — à réécrire après real-name auth
- **Date** : 2026-06-23

> ⚠️ **MISE À JOUR 2026-06-24** — la voie IMS de cet ADR (volume → image système → launch) est
> **bloquée au niveau du COMPTE**, prouvé live :
> 1. `createImageFromVolume` → `400 charged image cannot be exported` (images gold EU non-exportables) ;
> 2. voie CBR whole-image → `400 IMG.0026` **real-name authentication** requise (le grant IMS n'y change rien).
>
> Le code `registerImageFromSnapshot` (amorce option B) a été **supprimé** (mort). Voie cible retenue =
> **CBR** (backup → whole-image → launch), conçue dans **`docs/design-cbr-restore.md`** (PROVISOIRE, gatée
> real-name). Repli en place = **rollback EVS** (codé, dormant). **Restore = GATÉ** et ne bloque plus le
> projet. Verdict + plan : `docs/ROADMAP-HUAWEI.md` §Phase 4. Cet ADR sera réécrit après activation real-name.

## Contexte

Le portail AWS permet de **restaurer** : créer une nouvelle VM à partir d'un snapshot
(`RegisterImage` depuis un snapshot EBS → lancement). Côté Huawei, il **n'existe pas** de
`RegisterImage` direct depuis un snapshot EVS — c'est le point le plus divergent (inconnue **U6**).
Le reste des snapshots (créer / lister / supprimer) est **validé en live**.

## Chemin Huawei (design)

Restaurer = chaîne **multi-étapes, asynchrone** :

```
snapshot EVS ──> (1) volume depuis snapshot      POST /v2/{pid}/cloudvolumes {snapshot_id, AZ}  -> job
             ──> (2) image système depuis volume  IMS POST /v2/cloudimages/action {volume_id,…}  -> job -> image_id
             ──> (3) lancer ECS avec imageRef = image_id   (flux launchInstance normal)
```

## Options

| Option | Description | Verdict |
|---|---|---|
| A. Synchrone dans la requête `approve` | bloque l'HTTP plusieurs minutes (création volume + image) | ❌ timeout |
| **B. Asynchrone via le réconciliateur** | étendre le modèle de job : `provisioning_restore` → résoudre volume→image→launch par ticks | ✅ **retenu** (cohérent avec `resolveLaunch`) |
| C. CBR (Cloud Backup) au lieu d'EVS snapshot | sauvegarde + image depuis backup | alternative à évaluer |

## Décision

Implémenter la restauration en **mode asynchrone**, dans la lignée du modèle de job existant :
- nouvel état intermédiaire (ou réutilisation de `provisioning` + un marqueur) ;
- le réconciliateur enchaîne volume → image → `launchInstance` ;
- `registerImageFromSnapshot` (dans `src/huawei.ts`) contient déjà l'amorce (volume + IMS) ; à
  **compléter** (AZ, résolution des jobs, polling) et **valider en live** lors d'une phase de test
  dédiée (création de ressources réelles → coût).

## Conséquences

**Positives** — parité fonctionnelle complète (restauration) ; cohérent avec l'architecture (jobs +
réconciliateur) ; pas de blocage HTTP.

**Négatives** — feature **différée** (non validée en live) pour éviter de la dette : la version actuelle
de `registerImageFromSnapshot` est marquée U6 et ne doit pas être considérée comme prête en production
tant que ce flux async n'est pas implémenté et testé. Les snapshots **create/list/delete** restent,
eux, pleinement opérationnels.
