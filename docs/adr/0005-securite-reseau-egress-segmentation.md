# ADR 0005 — Sécurité réseau : durcissement egress (SG) + segmentation par classe

- **Statut** : Accepté (durcissement implémenté, togglable ; segmentation conçue)
- **Date** : 2026-06-23

## Contexte

Correction d'analyse **C5** ([ADR 0003](0003-reprise-decisions-fondatrices.md)) : côté AWS, le durcissement
réseau (`scripts/aws-harden-sg.mjs`, liste blanche egress du Security Group) est la **vraie barrière** de
sécurité — un utilisateur **root dans la VM** peut défaire les règles *in-VM* (DNS, iptables) mais **pas**
le Security Group. Cette barrière était **AWS-spécifique** → à reconcevoir pour les SG Huawei.

Par ailleurs, dette AWS connue : **un seul** subnet/SG. L'édition Huawei est l'occasion de concevoir la
**segmentation par classe** dès le départ.

## Décisions

1. **Défense en profondeur, 2 couches VM + 1 couche edge** :
   - *In-VM* (déjà dans le code : `linuxHardeningBody` / `windowsHardeningLines`) — DNS forcé vers
     Cloudflare for Families, blocage ports torrent, hostname verrouillé. Défaisable par un root → couche **faible**.
   - *Réseau (SG egress allowlist)* — la barrière **forte**, non contournable (`hardening.tf`).
   - *Edge (Cloudflare Access/WAF)* — devant la surface admin (Phase 2, cf. [observabilité/sécurité edge]).

2. **Allowlist egress du SG** (Terraform `hardening.tf`, activée par `var.harden_egress`) :
   | Autorisé en sortie | Pourquoi |
   |---|---|
   | **DNS 53 (tcp+udp) → 1.1.1.3 / 1.0.0.3 uniquement** | force le DNS filtré (adulte+malware bloqués), empêche un résolveur tiers |
   | **TCP 80 / 443 → 0.0.0.0/0** | mises à jour, installeurs de cours, callback `course-done` |
   | **UDP 123 → 0.0.0.0/0** | NTP |
   | *tout le reste* | **default-deny** (`delete_default_rules = true` + aucune autre règle) |
   → bloque torrents/P2P et l'exfiltration sur ports arbitraires **au niveau réseau**.

3. **Segmentation par classe** (conçue, activée en phase réseau avancé) : map `classe/cours →
   { subnet_id, secgroup_id }`. Le Worker prend déjà `HUAWEI_SUBNET_ID` / `HUAWEI_SECGROUP_ID` en binding ;
   on étend en **table de correspondance** (un subnet/SG par classe) pour isoler les groupes de VM.

4. **Ingress** : SSH 22 / RDP 3389, **restreignables par CIDR** (`ssh_allowed_cidr` / `rdp_allowed_cidr`,
   défaut `0.0.0.0/0` pour la parité, **à restreindre en prod**).

## Options (egress) comparées

| Option | Avantages | Coûts / risques | Verdict |
|---|---|---|---|
| A. Egress ouvert (parité) | simple | un root sort où il veut | défaut actuel |
| **B. Allowlist SG** | barrière non contournable, DNS filtré forcé | maintenir la liste si un cours sort hors 80/443 | ✅ **retenu** (togglable) |
| C. Proxy sortant filtrant | filtrage L7 | lourd à exploiter | reporté |

## Conséquences

**Positives** — barrière réseau réelle ; DNS filtré imposé ; P2P/exfiltration bloqués ; reproductible (IaC).

**Négatives / à surveiller** — un installeur de cours qui sortirait **hors 80/443/DNS/NTP** échouerait
(rare : apt/dnf/curl passent en 443). À valider après activation. Effet de bord identique à AWS.

**Activation** : `terraform apply -var harden_egress=true` (dans `infra/terraform/`). Réversible.
