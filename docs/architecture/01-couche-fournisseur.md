# Architecture — La couche fournisseur : AWS EC2 → Huawei ECS

> Le portage n'est **pas** une migration globale. C'est le remplacement d'**une seule couche** :
> le client cloud. Ce document spécifie cette couche (`src/huawei.ts`) et son contrat.

## 1. La couture fournisseur (« provider seam »)

Dans le projet AWS de référence, **tout** le code spécifique au cloud tient dans :
- `src/aws.ts` — **272 lignes, 15 fonctions exportées** : client EC2 **+ EBS + CloudWatch**
  (`aws4fetch`, protocole query, réponses XML parsées au regex) ;
- les bindings `AWS_*` de `src/types.ts` et `wrangler.jsonc`.

> 🔧 **Correction d'analyse** (cf. [ADR 0003](../adr/0003-reprise-decisions-fondatrices.md)) :
> l'estimation préliminaire « ~150 lignes / ~10 opérations » **sous-estimait 5 opérations bien
> réelles** — snapshots EVS (×3), lecture du volume racine, restauration par image, et métriques CPU.
> Le contrat ci-dessous les inclut donc : **16 méthodes**, pas 10.

Le reste (D1, OIDC, crypto, presets, email, réconciliateur) **ne connaît pas AWS**. On définit donc
un **contrat de couche fournisseur** stable, et on en fournit une implémentation Huawei.

### Contrat (interface cible)

> La version de référence, **commentée et typée**, vit dans [`src/cloud.ts`](../../src/cloud.ts)
> (créée). Résumé des **16 méthodes** :

```ts
// src/cloud.ts — contrat provider-neutre (le reste du Worker n'importe QUE ça)
export interface CloudProvider {
  // Clés SSH (KPS)
  createKeyPair(requestId: number, keyType?: KeyType): Promise<KeyPair>;
  deleteKeyPair(keyName: string): Promise<void>;
  // Cycle de vie ECS
  launchInstance(p: LaunchParams): Promise<LaunchHandle>;    // ECS create -> job_id
  resolveLaunch(h: LaunchHandle): Promise<string | null>;    // job -> server_id (async)
  describeInstance(serverId: string): Promise<InstanceStatus>;
  terminateInstance(serverId: string): Promise<void>;        // + EIP + volume racine
  startInstance(serverId: string): Promise<void>;
  stopInstance(serverId: string): Promise<void>;
  rebootInstance(serverId: string): Promise<void>;
  listManaged(): Promise<Record<string, string>>;            // serverId -> état (réconciliation)
  // Disque/snapshots (EVS) + restauration (IMS)  ⟵ sous-estimés par l'analyse initiale
  describeRootVolume(serverId: string): Promise<RootVolume>;
  createSnapshot(volumeId: string, description: string): Promise<string>;
  describeSnapshot(snapshotId: string): Promise<SnapshotState>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  registerImageFromSnapshot(name, snapshotId, rootDevice, architecture): Promise<string>;
  // Métriques (Cloud Eye / CES) pour l'idle-stop
  maxCpuOverWindow(serverId: string, minutes: number): Promise<CpuStat | null>;
}
```

> ⚠️ **Seule vraie différence de forme avec AWS** : `launchInstance` est **asynchrone** côté Huawei
> (renvoie un `job_id`, pas directement un `server_id`). D'où `resolveLaunch()`, résolu par le
> réconciliateur au tick suivant. C'est un *meilleur* modèle : il rend explicite l'attente.

## 2. Mapping conceptuel EC2 → ECS

| AWS (réf.) | Huawei Cloud | Notes |
|---|---|---|
| Signature **SigV4** (`aws4fetch`) | **AK/SK « SDK-HMAC-SHA256 »** | À implémenter en WebCrypto (§3). Plus simple que SigV4 (pas de clé dérivée date/région/service). |
| Protocole **query + XML** | **REST + JSON** | On supprime le parsing regex de l'AWS → plus robuste. |
| Endpoint `ec2.{region}.amazonaws.com` | `ecs.{region}.myhuaweicloud.eu` (site **EU/RGPD**) | IAM global `iam.myhuaweicloud.eu` · + `vpc.`, `eip.`, `kps.`/`dew.`, `ims.`. **Signature validée en live.** |
| `RunInstances` (synchrone) | `POST /v1/{project_id}/cloudservers` | **Asynchrone** → renvoie `job_id` (+ `serverIds` selon version). |
| `DescribeInstances` | `GET /v1/{project_id}/cloudservers/{id}` | Statut + adresses (privée/flottante). |
| filtre `tag:managed-by` | `GET /v1/{project_id}/cloudservers/detail?tags=...` | Réconciliation par tag (TMS). |
| `TerminateInstances` | `POST /v1/{project_id}/cloudservers/delete` | Body : `delete_publicip:true`, `delete_volume:true`. Renvoie `job_id`. |
| `StartInstances` | `POST .../cloudservers/action` `{os-start}` | Action batch. |
| `StopInstances` | `POST .../cloudservers/action` `{os-stop:{type}}` | `SOFT`/`HARD`. |
| `RebootInstances` | `POST .../cloudservers/action` `{reboot:{type}}` | |
| `CreateKeyPair` ed25519 | **KPS** `POST /v3/{project_id}/keypairs` | Clé privée renvoyée **une fois**. ⚠️ ed25519 à vérifier, sinon **RSA-4096**. |
| `AssociatePublicIpAddress=true` | bloc `publicip` à la création **ou** EIP via `eip` API | EIP = ressource **facturée + cycle de vie propre** → à libérer à la destruction. |
| Subnet + Security Group | VPC **Subnet** + **Security Group** | Occasion de corriger « 1 seul subnet/SG » → segmentation par classe. |
| AMI `ami-…` | **IMS** `image_id` | Catalogue à refaire. |
| instance type `t3.medium` | ECS **flavor** (ex. `s6.large.2`, `c7.large.4`) | Catalogue à refaire. |
| EBS `gp3` | **EVS** (`SSD`, `GPSSD`, `SAS`) | `root_volume` + `data_volumes`. |
| `DescribeVolumes` (volume racine) | **EVS** `GET /v2/{project_id}/os-vendor-volumes/detail` | Pour le snapshot + la restauration (device, taille, archi). |
| `CreateSnapshot` / `DescribeSnapshots` / `DeleteSnapshot` (EBS) | **EVS snapshots** `/v2/{project_id}/cloudsnapshots` | Modèle EVS ≠ EBS (snapshot de volume). |
| `RegisterImage` depuis snapshot (restore) | **IMS** `POST /v2/cloudimages/action` (create image) | Image privée → relance une VM « restaurée ». |
| `GetMetricStatistics` CPU (CloudWatch) | **Cloud Eye / CES** `POST /V1.0/{project_id}/batch-query-metric-data` | `instance_id` dimension, métrique `cpu_util`. Alimente l'idle-stop. |
| Région `eu-central-2` (Zurich) | **EU-Dublin `eu-west-101`** (décidée) | Proximité UE + RGPD. Reste à vérifier : dispo des flavors visés. |

## 3. Signature AK/SK (« SDK-HMAC-SHA256 »)

Huawei signe chaque requête avec un schéma très proche de SigV4, **mais sans dérivation de clé** :

```
CanonicalRequest =
  HTTPMethod        + '\n' +
  CanonicalURI      + '\n' +   // chemin, terminé par '/'
  CanonicalQuery    + '\n' +   // params triés, URL-encodés
  CanonicalHeaders  + '\n' +   // headers signés, minuscules, triés, "k:v\n"
  SignedHeaders     + '\n' +   // liste "h1;h2;host;x-sdk-date"
  HexSHA256(body)

StringToSign =
  "SDK-HMAC-SHA256" + '\n' +
  X-Sdk-Date        + '\n' +   // format ISO basique: 20260623T101500Z
  HexSHA256(CanonicalRequest)

Signature  = HexHMAC-SHA256( SK , StringToSign )           // ⟵ clé = SK directement
Authorization = "SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=<...>, Signature=<...>"
```

Implémentation : **WebCrypto** (`crypto.subtle.digest('SHA-256', …)` et
`crypto.subtle.sign('HMAC', …)`) — ~80-100 lignes, zéro dépendance, exactement dans l'esprit de
l'`aws.ts` actuel. En-têtes obligatoires : `Host`, `X-Sdk-Date`, `Content-Type`, `X-Project-Id`.

> Pas d'équivalent léger d'`aws4fetch` côté Huawei → **on écrit `src/huawei-sign.ts`** (testable en
> isolation, vecteurs de test fournis par la doc Huawei « AK/SK signing »).

## 4. Provisioning : le modèle de job asynchrone

```
launchInstance():
  POST /v1/{project_id}/cloudservers
  body = { server: { name, imageRef, flavorRef, vpcid, nics:[{subnet_id}],
                     root_volume:{volumetype,size}, key_name, security_groups:[{id}],
                     publicip:{ eip:{ iptype:"5_bgp", bandwidth:{size,sharetype:"PER"} } },
                     server_tags:[{key:"managed-by",value:"git-vm-portal"},
                                  {key:"request-id",value:"<id>"}] } }
  → { job_id }                       // on stocke job_id en D1, status=provisioning

resolveLaunch() (au tick réconciliateur):
  GET /v1/{project_id}/jobs/{job_id}
  → status: SUCCESS  → entities.sub_jobs[].entities.server_id   → on stocke server_id
    status: RUNNING  → on attend le prochain tick
    status: FAIL     → status=failed (retry ≤ 3)

describeInstance(server_id):
  GET /v1/{project_id}/cloudservers/{server_id}
  → status (ACTIVE/BUILD/SHUTOFF/…), addresses → EIP publique
  → quand ACTIVE + IP : D1 active + mail "VM prête"
```

Le **job model** s'intègre naturellement au réconciliateur : pas de polling bloquant dans la requête
HTTP, tout converge par ticks. C'est plus propre que le `RunInstances` synchrone d'AWS.

## 5. Cycle de vie de l'EIP (point d'attention FinOps + drift)

Contrairement à AWS (`AssociatePublicIpAddress` = simple booléen sans ressource facturée à part),
une **EIP Huawei est une ressource distincte, facturée**. Conséquences pour le réconciliateur :
- **Création** : soit via le bloc `publicip` de la création serveur (auto), soit via l'EIP API puis
  binding. On privilégie le bloc `publicip` (atomique).
- **Destruction** : `delete_publicip:true` à la suppression du serveur **libère l'EIP** → pas d'EIP
  orpheline facturée. Le réconciliateur doit **vérifier l'absence d'EIP orpheline** (drift coût).
- **Stop** : une VM `SHUTOFF` conserve son EIP (facturée) → le garde-fou d'extinction doit en tenir
  compte dans le modèle FinOps.

## 6. Bindings d'environnement (remplacent `AWS_*`)

```ts
// Vars publiques (wrangler.jsonc)
HUAWEI_REGION        // ex. "eu-west-101"
HUAWEI_PROJECT_ID    // id du projet région-scoped
HUAWEI_VPC_ID
HUAWEI_SUBNET_ID     // (puis map classe -> subnet pour la segmentation)
HUAWEI_SECGROUP_ID   // (puis map classe -> SG)
HUAWEI_IMAGE_ID      // image par défaut (catalogue par OS ensuite)
HUAWEI_EIP_BANDWIDTH // taille bande passante EIP (Mbit/s)

// Secrets (wrangler secret put)
HUAWEI_ACCESS_KEY    // AK de l'utilisateur IAM dédié
HUAWEI_SECRET_KEY    // SK
```

## 7. Inconnues à lever (avant code d'exécution)

| # | Inconnue | Impact | Comment lever |
|---|---|---|---|
| U1 | KPS supporte-t-il **ed25519** ? | type de clé SSH | Doc KPS / test API. Repli : RSA-4096. |
| U2 | Version exacte de l'API Create ECS (`v1` vs `v1.1`) et forme du retour `serverIds`/`job_id` | `resolveLaunch` | Doc ECS + 1 appel réel. |
| U3 | ✅ Région **décidée** (`eu-west-101`, EU-Dublin). Reste : **disponibilité des flavors** visés | catalogue | Console / `ecs:cloudServerFlavors:get`. |
| U4 | EIP : bloc `publicip` vs EIP v3 API | atomicité création/cleanup | Doc EIP. |
| U5 | Filtrage par tag dispo sur `cloudservers/detail` ou via TMS `resource_instances` | réconciliation | Doc ECS/TMS. |
| U6 | Forme exacte de l'API **EVS snapshot** + **IMS create-image** + **CES `cpu_util`** | snapshots/restore/idle-stop | Doc EVS/IMS/CES + 1 appel réel. |

Ces inconnues **n'empêchent pas** d'écrire la signature, le contrat `CloudProvider`, les types et les
tests : elles ne touchent que les détails d'URL/payload, isolés dans `src/huawei.ts`.

## 8. Impact sur le schéma D1 & normalisation des états

Deux conséquences directes du modèle Huawei sur la base (par rapport au schéma AWS) :

1. **Colonne `provider_job_id`** sur `vms`. La création étant asynchrone, `provisionRequest` stocke le
   `jobId` (instance encore sans `server_id`). Le réconciliateur appelle `resolveLaunch(jobId)` ; dès
   qu'il obtient le `server_id`, il le renseigne puis poursuit `provisioning → active`. (Côté AWS, le
   `instanceId` est connu **synchroniquement** → pas de colonne job.)
2. **Noms de colonnes provider-neutres** : `server_id` / `snapshot_id` / `provider_job_id` au lieu de
   `aws_instance_id` / `aws_snapshot_id`. Base neuve → on évite la dette cosmétique d'entrée
   ([ADR 0003](../adr/0003-reprise-decisions-fondatrices.md), C4).

**Normalisation des états** — le réconciliateur et la SPA ne connaissent qu'un vocabulaire fixe
(`NORMALIZED_STATES` dans `src/cloud.ts`). L'implémentation Huawei traduit :

| Huawei (natif) | Portail (normalisé) |
|---|---|
| `BUILD`, `REBOOT`, `HARD_REBOOT`, `RESIZE` | `pending` |
| `ACTIVE` | `running` |
| `SHUTOFF` | `stopped` |
| (transition d'arrêt) | `stopping` |
| `DELETED` / absent du `listManaged` | `terminated` |
| `ERROR` | `error` |

## 9. Couplage résiduel à neutraliser (au-delà de la couche fournisseur)

La couche `huawei.ts` ne suffit pas : **deux** points de couplage vivent ailleurs et sont traités
séparément (cf. [ADR 0003](../adr/0003-reprise-decisions-fondatrices.md)) :

- **Catalogue (`presets.ts`) = 2ᵉ couture.** Sa *structure* est réutilisable, mais ses *données* sont
  100 % AWS (`instanceType`, `ami-…`, tarifs gp3). À reconstruire pour `eu-west-101` : flavors ECS,
  images IMS, types/tarifs EVS. → ADR 0006 + `platform/02-catalogue` (à venir).
- **Durcissement réseau (la vraie barrière).** `scripts/aws-harden-sg.mjs` (allowlist egress) repose
  sur la sémantique **SG AWS** : à **reconcevoir** pour les Security Groups Huawei (stateful, règles
  in/out). Le durcissement *in-VM* (DNS filtré, blocage P2P, hostname verrouillé), lui, est
  **agnostique** → réutilisable tel quel.
