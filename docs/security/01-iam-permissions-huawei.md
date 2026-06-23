# Sécurité — Permissions IAM Huawei minimales (livrable d'accès)

> **But** : exécuter le portail avec une AK/SK de **moindre privilège**, scopée au strict
> nécessaire et à **un seul projet/région**. Ce document est la **liste d'accès à fournir** une fois
> la conception validée. Tant qu'il n'est pas validé, **aucune AK/SK n'est branchée**.
>
> ⚠️ Les **noms d'actions exacts** ci-dessous suivent le modèle Huawei « fine-grained » et **doivent
> être validés** contre la doc officielle « *Permissions Policies and Supported Actions* » de chaque
> service (ECS, IMS, VPC/EIP, KPS, EVS) avant application. La **structure** et le **périmètre**, eux,
> sont arrêtés.

## 1. Modèle d'identité retenu

| Élément | Choix | Pourquoi |
|---|---|---|
| Type d'identité | **Utilisateur IAM technique dédié** `svc-git-vm-portal` | Traçable, révocable, isolé de tout humain. |
| Accès console | **Désactivé** | Cette identité ne sert qu'à l'API (Programmatic access). |
| Authentification | **AK/SK** (Access Key / Secret Key) | Compatible signature in-Worker (pas de token à rafraîchir). |
| Rattachement | Groupe IAM dédié `grp-git-vm-portal` | Politique attachée au groupe, pas à l'utilisateur. |
| Périmètre | **1 projet** (région cible) | Scope région-projet = pas d'accès aux autres régions. |
| Politique | **Custom policy** (ci-dessous), pas les rôles « FullAccess » | Moindre privilège réel. |
| Audit côté Huawei | **CTS (Cloud Trace Service)** activé | Trace toutes les actions de cette AK/SK. |

> On **n'utilise pas** la clé AK/SK du compte racine (« domain ») : elle a tous les droits et n'est
> pas révocable finement. Règle absolue.

## 2. Actions strictement nécessaires (par service)

### Compute — ECS
| Besoin fonctionnel | Action (à valider) |
|---|---|
| Créer une VM | `ecs:cloudServers:create` |
| Supprimer une VM | `ecs:cloudServers:delete` |
| Lire détail / lister | `ecs:cloudServers:get`, `ecs:cloudServers:list` |
| Démarrer / arrêter / redémarrer | `ecs:cloudServers:start`, `ecs:cloudServers:stop`, `ecs:cloudServers:reboot` |
| Lire l'état d'un job de provisioning | `ecs:serverJobs:get` *(nom à confirmer)* |
| Lister les flavors (catalogue) | `ecs:cloudServerFlavors:get` |

### Image — IMS
| Lire les images (catalogue OS, root device) | `ims:images:list`, `ims:images:get` |

### Réseau — VPC + EIP (EIP est sous le namespace VPC)
| Lire VPC / subnet / security group | `vpc:vpcs:get`, `vpc:subnets:get`, `vpc:securityGroups:get` |
| Gérer les ports (rattachement NIC) | `vpc:ports:get`, `vpc:ports:create`, `vpc:ports:delete` |
| Allouer / libérer une EIP | `vpc:publicIps:create`, `vpc:publicIps:delete`, `vpc:publicIps:get` |
| Gérer la bande passante EIP | `vpc:bandwidths:get` *(create/update si bande passante dédiée)* |

### Clés SSH — KPS / DEW
| Créer une paire de clés | `kps:domainKeypairs:create` |
| Supprimer une paire | `kps:domainKeypairs:delete` |
| Lister / lire | `kps:domainKeypairs:list`, `kps:domainKeypairs:get` |

### Disque — EVS (souvent couvert par ECS, sinon explicite)
| Créer / supprimer / lire le volume racine | `evs:volumes:create`, `evs:volumes:delete`, `evs:volumes:get` |

> **Dépendances Huawei** : créer un ECS peut exiger des permissions *dépendantes* (ex. `vpc:ports:create`,
> `vpc:securityGroups:get`, `evs:volumes:create`). Elles sont déjà incluses ci-dessus. La liste de
> dépendances de chaque action est donnée dans la colonne « Dependencies » de la doc Huawei.

## 3. Politique custom (gabarit IAM Huawei)

> Format « policy » IAM Huawei (fine-grained). À ajuster après validation des noms d'actions et,
> si possible, restreindre par **condition** au projet/région et aux ressources tagguées
> `managed-by=git-vm-portal`.

```json
{
  "Version": "1.1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:cloudServers:create",
        "ecs:cloudServers:delete",
        "ecs:cloudServers:get",
        "ecs:cloudServers:list",
        "ecs:cloudServers:start",
        "ecs:cloudServers:stop",
        "ecs:cloudServers:reboot",
        "ecs:serverJobs:get",
        "ecs:cloudServerFlavors:get",
        "ims:images:list",
        "ims:images:get",
        "vpc:vpcs:get",
        "vpc:subnets:get",
        "vpc:securityGroups:get",
        "vpc:ports:get",
        "vpc:ports:create",
        "vpc:ports:delete",
        "vpc:publicIps:get",
        "vpc:publicIps:create",
        "vpc:publicIps:delete",
        "vpc:bandwidths:get",
        "kps:domainKeypairs:create",
        "kps:domainKeypairs:delete",
        "kps:domainKeypairs:list",
        "kps:domainKeypairs:get",
        "evs:volumes:create",
        "evs:volumes:delete",
        "evs:volumes:get"
      ]
    }
  ]
}
```

## 4. Ce qui est volontairement EXCLU

- ❌ Aucune action `*:*` ni rôle « Administrator / FullAccess ».
- ❌ Aucun droit IAM (création d'utilisateurs, de clés) — l'identité ne peut pas s'auto-élever.
- ❌ Aucun droit sur d'autres services (OBS, RDS, DNS, facturation…) non requis par le parcours.
- ❌ Aucun accès aux autres projets/régions (scope région-projet).
- ❌ Aucune permission de modification réseau structurelle (créer/supprimer VPC, subnet, SG) — ces
  ressources sont **pré-provisionnées** (voir [platform/01-ressources-huawei.md](../platform/01-ressources-huawei.md))
  et le portail ne fait que **les consommer**.

## 5. Checklist de mise en service (quand la conception est validée)

1. [ ] Créer l'utilisateur IAM `svc-git-vm-portal` (programmatic only, pas de console).
2. [ ] Créer le groupe `grp-git-vm-portal`, y placer l'utilisateur.
3. [ ] Créer la **custom policy** ci-dessus (après validation des noms d'actions), l'attacher au groupe.
4. [ ] Restreindre l'autorisation au **projet de la région cible** uniquement.
5. [ ] Générer l'**AK/SK**, la déposer comme secret Cloudflare (`HUAWEI_ACCESS_KEY`, `HUAWEI_SECRET_KEY`).
6. [ ] Activer **CTS** sur la région pour tracer l'usage de l'AK/SK.
7. [ ] Test de fumée en lecture seule (`ecs:cloudServers:list`) avant d'autoriser la création.
8. [ ] Documenter la **rotation** de l'AK/SK (procédure runbook + périodicité).

## 6. Récapitulatif « accès à demander »

> **À fournir par l'équipe Huawei une fois ce document validé :**
> 1. Confirmation de la **région/projet** cible (+ `project_id`).
> 2. L'utilisateur IAM dédié + groupe + **custom policy** appliqués (§3, noms d'actions validés).
> 3. L'**AK/SK** de `svc-git-vm-portal`.
> 4. Les IDs des ressources réseau pré-provisionnées (VPC, subnet, SG) — cf. inventaire plateforme.
> 5. CTS activé.
>
> **Rien d'autre.** Aucun accès console humain, aucun droit large.
