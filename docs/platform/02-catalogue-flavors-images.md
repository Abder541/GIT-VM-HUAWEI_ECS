# Plateforme — Catalogue : flavors ECS, images IMS, volumes EVS (`eu-west-101`)

> La **2ᵉ couture** du portage ([ADR 0003](../adr/0003-reprise-decisions-fondatrices.md) C3) : la
> *structure* de `presets.ts` est réutilisable, mais ses *données* (instance types, AMIs, tarifs) sont
> AWS. Ce document fige la **correspondance Huawei** à partir de la découverte **réelle** de la région
> (`scripts/huawei-discover.mjs`, signature AK/SK validée en live le 2026-06-23).
>
> ⚠️ Les `image_id` IMS sont **région-spécifiques** et **périment** → rafraîchir via le script
> (équivalent de `aws-amis.mjs`).

## 1. Flavors ECS (perf) — disponibles sur `eu-west-101` (354 au total)

Mapping proposé des presets perf (catalogue produit) vers des flavors Huawei éprouvés (séries **s6**
usage général, **c7n** calcul, **m6** mémoire) :

| Preset produit | Flavor Huawei | vCPU / RAM | Usage |
|---|---|---|---|
| `micro` | `s6.medium.2` | 1 / 2 Go | tests légers, apprentissage |
| `small` (recommandé) | `s6.large.2` | 2 / 4 Go | dev, plupart des cours |
| `flex` | `s6.large.4` | 2 / 8 Go | confort (Windows, conteneurs) |
| `perf` (option) | `s6.xlarge.2` / `c7n.xlarge.2` | 4 / 8 Go | charges plus lourdes |
| `mem` (option) | `m6.large.8` | 2 / 16 Go | data / mémoire |

> Décision de catalogue détaillée à acter en **ADR 0006**. Vérifier le **prix** de chaque flavor
> (`eu-west-101`) pour le modèle FinOps (l'EIP et l'EVS s'ajoutent).

## 2. Images IMS (OS) — `__imagetype=gold`, `eu-west-101`

| OS produit | Image IMS (gold) | `image_id` | Statut |
|---|---|---|---|
| Ubuntu 24.04 | `Ubuntu 24.04 server 64bit` | `188483c4-c66a-4559-83e6-e7f6591cdab0` | ✅ |
| Ubuntu 22.04 | `Ubuntu 22.04 server 64bit` | `d57f79e5-a9c5-4592-8270-a822e41ad6f4` | ✅ |
| Debian 12 | `Debian 12.0.0 64bit` | `1479cc34-8bc9-4bb0-9fe3-7530c39cd849` | ✅ |
| Debian 11 | `Debian 11.1.0 64bit` | `f2ca2562-4131-434b-a6fa-db2cca6983f5` | ✅ |
| Amazon Linux / Rocky / Alma | — | — | 🔵 à découvrir (autres `__platform`, ou Marketplace) |
| **Windows Server / poste** | — (0 image `gold` retournée) | — | ⚠️ **à sourcer** : Marketplace (KMS payant) ou BYOL. Décision RDP à reprendre. |

> Le catalogue OS AWS (Ubuntu/Debian/Amazon Linux/Rocky/Alma/Windows) ne se mappe pas 1:1 : Huawei EU
> expose Ubuntu/Debian en `gold`, mais **Windows** et les clones RHEL demandent une source dédiée
> (Marketplace / image privée). À trancher en **ADR 0006** + impacts sur le parcours RDP.

## 3. Volumes EVS (stockage)

| Preset stockage | Type EVS | Notes |
|---|---|---|
| SSD standard | `GPSSD` (general purpose SSD) | défaut recommandé (équiv. gp3). |
| SSD perf | `SSD` (ultra-high I/O) | si besoin perf. |
| Économique | `SAS` | HDD rapide, moins cher. |

`root_volume: { volumetype: "GPSSD", size: <Go> }`. Tailles : reprendre la grille AWS (20/30/50…),
mais **min ≥ 40 Go pour Ubuntu 24.04** (`mindisk` de l'image, **constaté en live**) ; Windows ≥ 40 Go.
→ le catalogue stockage doit imposer un plancher par image.

## 4. Rafraîchir le catalogue

```powershell
$env:HUAWEI_ACCESS_KEY="…"; $env:HUAWEI_SECRET_KEY="…"
node scripts/huawei-discover.mjs   # flavors + images + project_id de eu-west-101
```

Le script utilise la **même signature** que le Worker (`src/huawei-sign.ts`), il sert donc aussi de
**banc d'essai** de la couche fournisseur.
