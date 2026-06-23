# Infra socle — Terraform (réseau de plateforme)

Crée les ressources **gratuites** que le portail consomme : **VPC + Subnet + Security Group**
(`eu-west-101`, site `myhuaweicloud.eu`). Ces ressources sont stables (créées une fois) ; les VM,
EIP et volumes sont gérés par le Worker, pas par Terraform.

## Utilisation

```powershell
# AK/SK via l'environnement (jamais commitées) :
$env:HW_ACCESS_KEY="<AK>"; $env:HW_SECRET_KEY="<SK>"; $env:HW_REGION_NAME="eu-west-101"

terraform init
terraform plan
terraform apply -auto-approve
```

Reporter ensuite les `outputs` (`vpc_id`, `subnet_id`, `security_group_id`) dans
[`../../wrangler.jsonc`](../../wrangler.jsonc) → `HUAWEI_VPC_ID` / `HUAWEI_SUBNET_ID` / `HUAWEI_SECGROUP_ID`.

## Notes

- **Coût = 0 €** (VPC/subnet/SG gratuits). Seules les VM/EIP/EVS sont facturées (gérées par le Worker).
- `delete_default_rules = true` : on part d'un SG vide et on n'ouvre que SSH (22) et RDP (3389) en
  entrée. Egress ouvert pour la parité ; le durcissement egress fin viendra en phase réseau avancé.
- DNS du subnet forcé sur Cloudflare for Families (1.1.1.3 / 1.0.0.3) — couche de durcissement.
- `ssh_allowed_cidr` / `rdp_allowed_cidr` par défaut `0.0.0.0/0` → **à restreindre en prod**.
- L'état Terraform (`terraform.tfstate`) contient des IDs (pas de secrets) ; il est **gitignoré**.
