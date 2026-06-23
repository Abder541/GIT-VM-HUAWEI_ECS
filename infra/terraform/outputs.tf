# Valeurs à reporter dans wrangler.jsonc (vars) : HUAWEI_VPC_ID / SUBNET_ID / SECGROUP_ID.

output "vpc_id" {
  value       = huaweicloud_vpc.main.id
  description = "→ HUAWEI_VPC_ID"
}

output "subnet_id" {
  value       = huaweicloud_vpc_subnet.main.id
  description = "→ HUAWEI_SUBNET_ID (ECS nics.subnet_id attend l'ID réseau du subnet)"
}

output "security_group_id" {
  value       = huaweicloud_networking_secgroup.main.id
  description = "→ HUAWEI_SECGROUP_ID"
}
