# Architecture — Résilience (HA / DR)

> Décisions : [ADR 0009](../adr/0009-resilience-ha-dr.md). Idée maîtresse : protéger l'**état désiré**
> (D1) ; les VM sont recréables.

## 1. Ce qui doit survivre

| Élément | Criticité | Protection |
|---|---|---|
| **D1 (état désiré)** | 🔴 vitale | Time Travel (point-in-time) + export hors-ligne |
| Worker (code) | 🟠 | versionné (Git) → redéployable |
| Secrets | 🟠 | gérés Cloudflare + source sûre (gestionnaire de secrets) |
| Ressources réseau (VPC/SG) | 🟡 | Terraform (re-créables) |
| VM ECS | 🟢 recréable | aucune (bétail) — multi-AZ limite l'impact |

## 2. Multi-AZ (cible)

`launchInstance` répartit les VM sur les AZ de `eu-west-101` (`availability_zone` round-robin). Un
incident d'AZ n'emporte qu'une fraction du parc ; les VM survivantes continuent.

## 3. Reprise d'activité (DR) — procédure

1. **Worker** : redéployer depuis Git (`wrangler deploy`).
2. **D1** : restaurer (Time Travel : `wrangler d1 time-travel restore`, ou réimport d'un export).
3. **Secrets** : re-pousser (`wrangler secret bulk`) depuis la source sûre.
4. **Réseau** : `terraform apply` si VPC/SG perdus.
5. Le **réconciliateur** reconverge : il relit la D1, interroge Huawei (`listManaged`), et resynchronise
   les statuts. Les VM toujours vivantes sont ré-attachées ; les disparues passent `terminated` (drift).

**RPO** ≈ minutes (Time Travel). **RTO** ≈ minutes à dizaines de minutes (redeploy + restore).

## 4. Test de DR

À planifier : restaurer la D1 dans un environnement de préproduction, redéployer, vérifier que le
réconciliateur reconverge sans créer ni détruire à tort (idempotence). Cf. [runbooks](../operations/01-runbooks.md).
