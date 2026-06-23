# ADR 0009 — Résilience : haute disponibilité & reprise d'activité (HA/DR)

- **Statut** : Accepté (principes ; multi-AZ et sauvegarde D1 à activer)
- **Date** : 2026-06-23

## Contexte

Deux plans à protéger différemment :
- **Plan de contrôle** (Worker + **D1 = état désiré**) : le cœur. Sa perte = perte du portail.
- **Plan de charge** (VM ECS) : du *bétail*, recréable ; pas de HA applicative par VM (ce n'est pas le
  rôle du portail).

## Décisions

1. **Le portail est intrinsèquement résilient** : Cloudflare (Workers + D1) est mondialement répliqué et
   géré. Le réconciliateur **reconverge** le réel sur la D1 à chaque tick (auto-réparation du drift).
2. **Sauvegarde de l'état désiré (D1)** : activer **D1 Time Travel** (restauration point-in-time
   Cloudflare, ~30 j) + export périodique (`wrangler d1 export`) hors-ligne. **RPO ≈ minutes**.
3. **Multi-AZ** (cible) : répartir les VM sur plusieurs zones de disponibilité (`availability_zone` à la
   création, round-robin) → un incident d'AZ n'emporte pas tout le parc.
4. **DR du portail** : redéployer le Worker (code versionné) + restaurer la D1 → le réconciliateur
   reconverge. **RTO** = temps de redeploy + restore D1 (minutes à dizaines de minutes).
5. **Périmètre assumé** : une VM perdue (panne d'AZ) est détectée comme **drift → terminated** ; elle
   n'est **pas** recréée automatiquement (statut terminal par conception). La redondance applicative
   d'une charge est la responsabilité de l'utilisateur, pas du portail.

## Conséquences

**Positives** — le composant critique (état désiré) est sauvegardable et restaurable ; le réconciliateur
limite naturellement la dérive ; multi-AZ réduit le rayon d'impact.

**Négatives / à activer** — Time Travel/export D1 à mettre en place (procédure runbook) ; multi-AZ
ajoute un mapping AZ ; pas de recréation auto des VM perdues (choix assumé).
