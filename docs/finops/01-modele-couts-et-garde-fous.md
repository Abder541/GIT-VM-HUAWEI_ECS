# FinOps — modèle de coûts & garde-fous

> Décisions : [ADR 0008](../adr/0008-finops-couts-garde-fous.md). Particularité Huawei : l'**EIP** est
> une ressource facturée à part (le piège coût).

## 1. Coût par VM (`eu-west-101`, EUR approximatif, pay-as-you-go)

| Poste | Facturé quand | Estimation |
|---|---|---|
| ECS `s6.large.2` (2 vCPU/4 Go) | VM **allumée** | ~0,036 €/h |
| EVS 40 Go (GPSSD) | VM **existe** (même éteinte) | ~4 €/mois |
| EIP + bande passante | **allouée** (même éteinte) | ~3–6 €/mois |

**Scénarios :**
| Usage | €/VM/mois |
|---|---|
| 24/7 (sans garde-fous) | ~35–40 |
| ~40 h/sem (avec garde-fous) | ~14–18 |
| provisionnée mais éteinte | ~7–10 |

> Coût **fixe de plateforme = 0 €** (VPC/subnet/SG/IAM/Cloudflare gratuits). On ne paie que les VM.

## 2. Garde-fous (état)

| Garde-fou | État | Effet |
|---|---|---|
| Extinction nocturne (19:00 UTC) | ✅ | coupe le calcul ECS la nuit |
| Arrêt sur inactivité (CES CPU) | ✅ | coupe les VM oubliées |
| Expiration auto → terminate (libère **EIP + EVS**) | ✅ | aucune VM éternelle |
| « Aucune machine sans date de fin » | ✅ (validation à la création) | borne le cycle de vie |
| Estimation de coût dans l'UI | ✅ | transparence à la demande |
| Détection d'orphelins (`huawei-orphans.ts`) | ✅ | EIP/EVS/snapshots/serveurs zombies |
| Alerte budget mensuelle | 🔵 cible | seuil + mail (Cloud Eye/budget) |
| Dashboard coûts par classe/utilisateur | 🔵 cible | via tags + `/api/monitoring/cost` |

## 3. Le piège EIP

Une VM **`SHUTOFF`** conserve son EIP → **encore facturée**. Deux stratégies :
- **Garder l'EIP** (IP stable, simple) — coût résiduel ~3–6 €/mois/VM éteinte.
- **Libérer/réallouer** l'EIP au stop/start — économise mais l'IP change (impact UX/connexion).
→ Par défaut on **garde** (stabilité) ; à arbitrer par classe si le volume de VM éteintes est élevé.

## 4. Hygiène opérationnelle

- Lancer `scripts/huawei-orphans.ts` périodiquement (et après chaque suppression) → 0 orphelin attendu.
- Tagging systématique (`managed-by`, `request-id`, `class`) → imputation des coûts.
- Right-sizing : catalogue limité à des flavors raisonnables (s6.*), pas de surdimensionnement.
