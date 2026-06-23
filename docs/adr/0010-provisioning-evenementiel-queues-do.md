# ADR 0010 — Provisioning : cron réconciliateur vs événementiel (Queues / Durable Objects)

- **Statut** : Accepté (garder le cron ; événementiel = évolution conçue)
- **Date** : 2026-06-23

## Contexte

Le réconciliateur tourne sur un **cron** (`*/2 * * * *`). Opportunité identifiée : un modèle
**événementiel** (Cloudflare **Queues** + **Durable Objects**) serait plus réactif (provisioning en
secondes plutôt qu'au prochain tick) et scalerait mieux.

## Options

| Option | Avantages | Coûts / risques | Verdict |
|---|---|---|---|
| **A. Cron réconciliateur** | simple, robuste, idempotent, 1 seul mécanisme, tolérant aux pannes | latence jusqu'à 2 min ; 1 cron (limite compte) | ✅ **retenu (v1)** |
| B. Queues + Durable Objects | réactif (événementiel), pas de polling, scalable | complexité, nouveau modèle d'état, plus de surface | conçu, **différé** |

## Décision

**Garder le cron** pour la cible actuelle : à l'échelle d'un institut (dizaines de VM), la latence de
2 min est sans impact, et la simplicité/robustesse priment (un seul mécanisme de cycle de vie — règle
d'or). Le modèle **événementiel** est **conçu** et activable si le volume/réactivité l'exige :
- une **Queue** reçoit les événements (demande validée, échéance) ;
- un **Durable Object** par VM (ou par groupe) pilote la machine à états sans polling ;
- le cron reste comme **filet de sécurité** (réconciliation de fond).

## Conséquences

**Positives** — simplicité maintenue, pas de dette ; chemin d'évolution clair et non bloquant.

**Négatives** — latence de 2 min (acceptable v1) ; bascule événementielle à concevoir finement (idempotence,
ordre, reprise) le moment venu.
