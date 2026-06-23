# Durcissement egress du Security Group — LISTE BLANCHE + default-deny.
# Activé par var.harden_egress = true (avec egress_v4 désactivé dans main.tf).
# C'est la « vraie barrière » : un utilisateur root DANS la VM peut défaire les règles
# in-VM (DNS, iptables) mais PAS ce Security Group. Voir ADR 0005.

locals {
  # Cloudflare for Families : bloque contenus adultes + malware au niveau DNS.
  cloudflare_families_dns = ["1.1.1.3/32", "1.0.0.3/32"]
}

# DNS (53 udp+tcp) UNIQUEMENT vers Cloudflare for Families → force le DNS filtré.
resource "huaweicloud_networking_secgroup_rule" "egress_dns_udp" {
  for_each          = var.harden_egress ? toset(local.cloudflare_families_dns) : toset([])
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "egress"
  ethertype         = "IPv4"
  protocol          = "udp"
  ports             = "53"
  remote_ip_prefix  = each.value
}
resource "huaweicloud_networking_secgroup_rule" "egress_dns_tcp" {
  for_each          = var.harden_egress ? toset(local.cloudflare_families_dns) : toset([])
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "egress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  ports             = "53"
  remote_ip_prefix  = each.value
}

# HTTP / HTTPS : mises à jour système, installeurs de cours, callback course-done.
resource "huaweicloud_networking_secgroup_rule" "egress_web" {
  for_each          = var.harden_egress ? toset(["80", "443"]) : toset([])
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "egress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  ports             = each.value
  remote_ip_prefix  = "0.0.0.0/0"
}

# NTP : synchronisation de l'horloge.
resource "huaweicloud_networking_secgroup_rule" "egress_ntp" {
  count             = var.harden_egress ? 1 : 0
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "egress"
  ethertype         = "IPv4"
  protocol          = "udp"
  ports             = "123"
  remote_ip_prefix  = "0.0.0.0/0"
}

# Tout le reste (torrents/P2P, DNS tiers, ports arbitraires) → DEFAULT-DENY implicite
# (le SG a delete_default_rules = true, donc aucune sortie non listée n'est autorisée).
