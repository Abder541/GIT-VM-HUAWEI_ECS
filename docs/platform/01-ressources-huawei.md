# Plateforme — Inventaire des ressources Huawei Cloud

> Ressources à **pré-provisionner** (manuellement ou en IaC) pour que le portail puisse les
> **consommer**. Séparer « ressources de plateforme » (stables, créées une fois) des « ressources de
> charge » (VM créées/détruites à la demande) est un choix de gouvernance : le portail n'a **pas** le
> droit de modifier la plateforme, seulement d'y déployer des VM (cf.
> [sécurité IAM](../security/01-iam-permissions-huawei.md)).

## 1. Compte, région, projet

| Ressource | Détail | Statut |
|---|---|---|
| Compte Huawei | Site **européen** Huawei Cloud (`myhuaweicloud.eu`, RGPD) | ✅ existe |
| **Région** | **EU-Dublin `eu-west-101`** | ✅ **confirmée** |
| **Projet** (`project_id`) | `85a8db076e4e4e25aa2eeac9e3eb96e0` | ✅ **découvert** (signature AK/SK validée en live) |
| Endpoints | `iam.myhuaweicloud.eu` (IAM global) · `ecs.eu-west-101.myhuaweicloud.eu` · `vpc.` · `ims.` · `kps.`/`dew.` | ⚠️ site **`.eu`**, pas `.com` |

## 2. Identité (cf. doc sécurité)

| Ressource | Détail |
|---|---|
| Utilisateur IAM (en service) | **`GIT-VM`** (full-access ECS) — conservé pour le projet ([ADR 0003](../adr/0003-reprise-decisions-fondatrices.md) D2) |
| Cible de durcissement (documentée, non bloquante) | `svc-git-vm-portal` + `grp-git-vm-portal` + custom policy moindre privilège |
| AK/SK | secret Cloudflare (`HUAWEI_ACCESS_KEY` / `HUAWEI_SECRET_KEY`) · `.dev.vars` en local |

## 3. Réseau (plateforme — créé une fois)

| Ressource | Rôle | Notes |
|---|---|---|
| **VPC** | Réseau privé du portail | 1 VPC dédié `vpc-git-vm-portal`. |
| **Subnet(s)** | Place les VM | **Phase parité** : 1 subnet. **Cible** : 1 subnet par **classe/cours** (segmentation). |
| **Security Group(s)** | Pare-feu L4 | **Phase parité** : 1 SG « SSH entrant restreint ». **Cible** : 1 SG par classe + règles minimales (SSH depuis plages autorisées, pas 0.0.0.0/0 en prod). |
| **EIP** | IP publique par VM | ⚠️ **ressource de charge** (créée/détruite par VM), facturée. Bande passante à dimensionner (FinOps). |

> 🔐 Dette AWS à corriger : le projet de référence n'a **qu'un** subnet/SG. Ici on **conçoit la
> segmentation par classe dès le départ** (map `classe → {subnet_id, secgroup_id}`), activée en
> phase « réseau avancé ».

## 4. Catalogue de charge (ce que le portail crée à la demande)

| Ressource | Équivalent AWS | À définir |
|---|---|---|
| **Flavor ECS** | instance type | ✅ 354 dispo `eu-west-101`. Cibles : `s6.medium.2`, `s6.large.2`, `s6.large.4`, `s6.xlarge.2`. Détail → [`02-catalogue`](02-catalogue-flavors-images.md). |
| **Image IMS** | AMI | ✅ Ubuntu 24.04 `188483c4-…`, Debian 12 `1479cc34-…`. ⚠️ Windows absent en `gold` → à sourcer (Marketplace/BYOL). Détail → [`02-catalogue`](02-catalogue-flavors-images.md). |
| **EVS (volume racine)** | EBS gp3 | Mapper les presets stockage → taille + type (`SSD`/`GPSSD`). |
| **KPS keypair** | EC2 keypair | 1 paire **par VM**, clé privée chiffrée au repos. ed25519 si supporté, sinon RSA-4096. |
| **EIP + bande passante** | public IP | 1 par VM, libérée à la destruction. |
| **Tags** | tags EC2 | `managed-by=git-vm-portal`, `request-id=<id>`, `class=<classe>` (réconciliation + FinOps). |

## 5. Observabilité & audit (plateforme)

| Ressource | Rôle | Phase |
|---|---|---|
| **Cloud Eye (CES)** | métriques ECS (CPU, réseau, disque) | observabilité (post-parité) |
| **CTS (Cloud Trace Service)** | trace des appels API de l'AK/SK | sécurité (dès la mise en service IAM) |
| **LTS (Log Tank Service)** | logs centralisés (optionnel) | observabilité avancée |

## 6. Tableau « à provisionner » (synthèse actionnable)

| # | Ressource | Qui | Quand | Bloquant pour |
|---|---|---|---|---|
| R1 | Région + projet confirmés (`project_id`) | équipe Huawei | validation conception | tout appel API |
| R2 | Utilisateur IAM + policy + AK/SK | équipe Huawei | validation IAM | exécution |
| R3 | VPC + 1 subnet + 1 SG (parité) | IaC / console | avant 1er provisioning | provisioning |
| R4 | Flavors + images IMS mappés (catalogue) | équipe projet | avant 1er provisioning | catalogue/presets |
| R5 | CTS activé | équipe Huawei | mise en service IAM | audit |
| R6 | Subnets/SG par classe | IaC | phase réseau avancé | segmentation |

> **IaC** : ces ressources de plateforme sont candidates à une description **Terraform** (provider
> Huawei Cloud officiel) pour reproductibilité multi-environnement — voir
> [feuille de route](../roadmap/00-feuille-de-route.md) (phase gouvernance/IaC).
