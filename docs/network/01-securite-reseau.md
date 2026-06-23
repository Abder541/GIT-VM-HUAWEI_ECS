# Réseau — Sécurité & segmentation

> Défense en profondeur du parc de VM. Décisions dans [ADR 0005](../adr/0005-securite-reseau-egress-segmentation.md).

## 1. Modèle de défense en profondeur

```
 Utilisateur ──TLS──> Cloudflare (edge)  ── Access/Zero Trust + WAF + rate-limit (Phase 2)
                          │
                          ▼  (Worker = plan de contrôle ; ne route pas le trafic des VM)
 Internet  ◄──egress filtré──  Security Group Huawei  ◄── la VRAIE barrière (non contournable par root)
                                   │
                                   ▼
                                 VM ECS  ── durcissement IN-VM (DNS filtré, blocage P2P, hostname)
                                             couche faible (défaisable par un root)
```

Trois couches, de la plus contournable à la plus forte :
1. **In-VM** (au provisioning) — DNS → Cloudflare for Families, blocage ports torrent, hostname verrouillé
   (`chattr +i`). Flag `HARDENING`. ⚠️ un root peut la défaire.
2. **Security Group (réseau)** — **liste blanche egress + default-deny** (`infra/terraform/hardening.tf`).
   **Non contournable** depuis la VM. C'est la barrière de référence.
3. **Edge Cloudflare** — Access (Zero Trust) devant `/admin`, WAF, rate limiting (Phase 2).

## 2. Security Group — règles

**Entrant** (consommé par les VM) :
| Port | Source | Usage |
|---|---|---|
| 22/tcp | `ssh_allowed_cidr` (déf. 0.0.0.0/0 → à restreindre) | SSH Linux |
| 3389/tcp | `rdp_allowed_cidr` | RDP Windows |

**Sortant** — deux modes (variable `harden_egress`) :
- `false` (parité, actuel) : tout autorisé.
- `true` (durci) : **uniquement** DNS→Cloudflare (53), HTTP/HTTPS (80/443), NTP (123) ; **tout le reste refusé**.

## 3. Segmentation par classe (cible)

Dette AWS : un seul subnet/SG. Cible Huawei : **un subnet + un SG par classe/cours**, pour isoler les
groupes de VM (un incident sur une classe n'expose pas les autres).

- **Plateforme** : 1 VPC, N subnets (`subnet-<classe>`), N SG (`sg-<classe>`), créés en Terraform.
- **Worker** : remplacer `HUAWEI_SUBNET_ID`/`HUAWEI_SECGROUP_ID` (valeurs uniques) par une **map**
  `classe → { subnet_id, secgroup_id }` ; `launchInstance` choisit selon la classe de la demande.
- **Tags** : `class=<classe>` sur chaque VM (déjà prévu) → traçabilité + FinOps par classe.

## 4. Flux autorisés (synthèse, mode durci)

| Depuis la VM vers… | Autorisé ? |
|---|---|
| DNS Cloudflare for Families (1.1.1.3/1.0.0.3:53) | ✅ |
| Web 80/443 (apt, dnf, installeurs, callback) | ✅ |
| NTP 123 | ✅ |
| DNS tiers (8.8.8.8…), torrents/P2P, ports arbitraires | ❌ default-deny |

## 5. Activation & vérification

```powershell
cd infra/terraform
terraform apply -var harden_egress=true        # active la liste blanche egress
```
Vérifier ensuite depuis une VM : `curl https://example.com` (OK), `dig @8.8.8.8 example.com` (timeout =
DNS tiers bloqué), un client torrent (bloqué). À refaire à chaque évolution du catalogue de cours.
