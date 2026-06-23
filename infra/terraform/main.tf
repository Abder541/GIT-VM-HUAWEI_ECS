# Réseau socle du portail (ressources de PLATEFORME, créées une fois, GRATUITES).
# Le Worker ne fait que les CONSOMMER (il n'a pas le droit de muter le réseau).
#
# AK/SK lues depuis l'environnement : HW_ACCESS_KEY / HW_SECRET_KEY (jamais en dur).
# Site européen Huawei (RGPD) via cloud = "myhuaweicloud.eu".

provider "huaweicloud" {
  region = var.region
  cloud  = "myhuaweicloud.eu"
}

# --- VPC (réseau privé) ---
resource "huaweicloud_vpc" "main" {
  name = "${var.name_prefix}-vpc"
  cidr = var.vpc_cidr
  tags = {
    managed-by = "git-vm-portal"
    usage      = "platform"
  }
}

# --- Subnet (où se branchent les VM) ---
resource "huaweicloud_vpc_subnet" "main" {
  name       = "${var.name_prefix}-subnet"
  cidr       = var.subnet_cidr
  gateway_ip = var.subnet_gateway
  vpc_id     = huaweicloud_vpc.main.id

  # DNS filtré (Cloudflare for Families : bloque adulte + malware) — durcissement réseau.
  dns_list = ["1.1.1.3", "1.0.0.3"]

  tags = {
    managed-by = "git-vm-portal"
    usage      = "platform"
  }
}

# --- Security Group (pare-feu L4) ---
resource "huaweicloud_networking_secgroup" "main" {
  name                 = "${var.name_prefix}-sg"
  description          = "GIT VM Portal — SSH/RDP entrants, egress ouvert (durcissement fin en phase reseau)"
  delete_default_rules = true
}

# Entrant : SSH (Linux)
resource "huaweicloud_networking_secgroup_rule" "ssh" {
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  ports             = "22"
  remote_ip_prefix  = var.ssh_allowed_cidr
}

# Entrant : RDP (Windows)
resource "huaweicloud_networking_secgroup_rule" "rdp" {
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  ports             = "3389"
  remote_ip_prefix  = var.rdp_allowed_cidr
}

# Sortant OUVERT (parité) — actif tant que harden_egress = false.
resource "huaweicloud_networking_secgroup_rule" "egress_v4" {
  count             = var.harden_egress ? 0 : 1
  security_group_id = huaweicloud_networking_secgroup.main.id
  direction         = "egress"
  ethertype         = "IPv4"
  remote_ip_prefix  = "0.0.0.0/0"
}
# Le durcissement egress (liste blanche + default-deny) vit dans hardening.tf,
# activé par var.harden_egress. C'est la « vraie barrière » non contournable par un root.
