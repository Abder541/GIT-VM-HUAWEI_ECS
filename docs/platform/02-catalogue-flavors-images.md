# Plateforme — Catalogue : flavors ECS, images IMS, volumes EVS (`eu-west-101`)

> La **2ᵉ couture** du portage ([ADR 0003](../adr/0003-reprise-decisions-fondatrices.md) C3) : la
> *structure* de `presets.ts` est réutilisable, mais ses *données* (instance types, AMIs, tarifs) sont
> AWS. Ce document fige la **correspondance Huawei** à partir de la découverte **réelle** de la région
> (`scripts/huawei-discover.mjs`, signature AK/SK validée en live le 2026-06-23).
>
> ⚠️ Les `image_id` IMS sont **région-spécifiques** et **périment** → rafraîchir via le script
> (équivalent de `aws-amis.mjs`).

## 1. Flavors ECS (perf) — `eu-west-101` (✅ catalogue IMPLÉMENTÉ dans `presets.ts`)

Découverte live 2026-06-24 : **293 flavors** dans `eu-west-101a` (familles **s6/s7n** général, **c6/c7n/c9**
calcul, **m6/m7n/m9** mémoire, **d6** disque, **pi3/ai2** GPU, **x1/x2** flexibles). Catalogue produit retenu :

| Preset | Flavor | vCPU / RAM | Usage |
|---|---|---|---|
| `micro` | `s6.medium.2` | 1 / 2 Go | tests, apprentissage |
| `small` (recommandé) | `s6.large.2` | 2 / 4 Go | dev, plupart des cours |
| `flex` | `s6.large.4` | 2 / 8 Go | confort (conteneurs, IDE) |
| `perf` | `s6.xlarge.2` | 4 / 8 Go | charges plus lourdes |
| `compute` | `c7n.xlarge.2` | 4 / 8 Go | calcul intensif (compil, cyber) |
| `computeplus` | `c7n.2xlarge.2` | 8 / 16 Go | gros calcul |
| `memory` | `m7n.2xlarge.8` | 8 / 64 Go | data science, bases de données |
| `gpu` *(hidden)* | `pi3.6xlarge.4` | 24 / 96 Go + GPU | IA/CUDA — masqué (coût ; gate admin, cf. ROADMAP D4) |

> ⚠️ Prix EUR **approximatifs** dans `presets.ts` → confirmer via l'API de tarification (FinOps : + EIP + EVS).

## 2. Images IMS (OS) — `eu-west-101` (✅ IMPLÉMENTÉ ; `image_id` réels, scan 2026-06-24)

| OS | `image_id` |
|---|---|
| Ubuntu 24.04 (recommandé) | `188483c4-c66a-4559-83e6-e7f6591cdab0` |
| Ubuntu 22.04 | `d57f79e5-a9c5-4592-8270-a822e41ad6f4` |
| Ubuntu 20.04 | `5161457d-381d-471e-9c09-98cf32e75c42` |
| Debian 12 | `1479cc34-8bc9-4bb0-9fe3-7530c39cd849` |
| Debian 11 | `f2ca2562-4131-434b-a6fa-db2cca6983f5` |
| AlmaLinux 9 / 8 | `fda22b17-93db-4e3e-8b05-37124f2e92a2` / `4a74c7b7-e964-4766-9e6e-187990f8d7ea` |
| Rocky Linux 9 / 8 | `48ff5b63-df3d-4719-9d9b-93465ae091d4` / `5542ea9f-adb4-4237-82e7-4b92a84b15e2` |

> ⚠️ Toutes les bases Linux EU sont `gold/__lazyloading` **non-exportables** → impacte le restore IMS
> (cf. [ADR 0006](../adr/0006-restauration-snapshot-ims.md) + [design-cbr-restore](../design-cbr-restore.md)).
> `sshUser=root` (validé Ubuntu ; **à reconfirmer par SSH live** pour Alma/Rocky).
>
> **Windows** : aucune image gold gratuite → image **MARKET payante** (`Windows Server 2019`,
> `e5233d7b-d432-4506-9149-ee25567daa05`). Preset `windows2019` **`hidden`** tant que l'image n'est pas
> **souscrite** au Marketplace (`400 forbidden to use market image`, confirmé live).

## 3. Volumes EVS (stockage)

| Preset stockage | Type EVS | Notes |
|---|---|---|
| SSD standard | `GPSSD` (general purpose SSD) | défaut recommandé (équiv. gp3). |
| SSD perf | `SSD` (ultra-high I/O) | si besoin perf. |
| Économique | `SAS` | HDD rapide, moins cher. |

✅ **Implémenté** : `StoragePreset.volumetype` (presets.ts) threadé `cloud.ts LaunchParams` →
`huawei.ts launchInstance` → `index.ts`. Presets : `s40/s80/s160` (GPSSD), `ssd80/ssd160` (SSD),
`sas160` (SAS). Types live (scan 2026-06-24) : GPSSD & SSD (toutes AZ), SAS & ESSD (AZ a/b),
**GPSSD2 = AZ `c` uniquement → EXCLU** (l'AZ par défaut est `a` → échec sinon).
Plancher **≥ 40 Go** (`mindisk` des images gold, constaté live) imposé par `minStorageGb` par OS.

## 4. Rafraîchir le catalogue

```powershell
$env:HUAWEI_ACCESS_KEY="…"; $env:HUAWEI_SECRET_KEY="…"
node scripts/huawei-discover.mjs   # flavors + images + project_id de eu-west-101
```

Le script utilise la **même signature** que le Worker (`src/huawei-sign.ts`), il sert donc aussi de
**banc d'essai** de la couche fournisseur.
