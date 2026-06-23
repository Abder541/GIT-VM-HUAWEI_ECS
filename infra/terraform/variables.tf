variable "region" {
  type        = string
  default     = "eu-west-101"
  description = "Région Huawei (EU-Dublin)."
}

variable "project_id" {
  type        = string
  default     = "85a8db076e4e4e25aa2eeac9e3eb96e0"
  description = "project_id région-scoped (découvert)."
}

variable "name_prefix" {
  type        = string
  default     = "git-vm-portal"
  description = "Préfixe de nommage des ressources de plateforme."
}

variable "vpc_cidr" {
  type    = string
  default = "192.168.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "192.168.10.0/24"
}

variable "subnet_gateway" {
  type    = string
  default = "192.168.10.1"
}

# ⚠️ Ouvert par défaut (parité avec AWS + durcissement in-VM/DNS). À restreindre en prod.
variable "ssh_allowed_cidr" {
  type    = string
  default = "0.0.0.0/0"
}

variable "rdp_allowed_cidr" {
  type    = string
  default = "0.0.0.0/0"
}

# Durcissement egress : remplace le « tout autorisé » par une liste blanche
# (DNS Cloudflare for Families, HTTP/HTTPS, NTP) + default-deny. La VRAIE barrière
# réseau (un root dans la VM ne peut pas la contourner). false = parité ; true = durci.
variable "harden_egress" {
  type    = bool
  default = false
}
