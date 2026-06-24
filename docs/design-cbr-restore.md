# Design détaillé — Restore via CBR (PROVISOIRE)

> ⚠️ **STATUT : PROVISOIRE.** Faisabilité de la voie « nouvelle VM » **gatée sur la real-name
> authentication** du compte (whole-image → `400 IMG.0026`, prouvé live 2026-06-24). Ce document
> est un **plan de conception**, pas une décision finale ni une implémentation. Les hypothèses
> non prouvées sont listées en §6 ; le plan pour les lever en §7.
>
> Document de conception uniquement — aucun code modifié. Réfs : [ROADMAP-HUAWEI.md](ROADMAP-HUAWEI.md) §Phase 4,
> mémoire `huawei-restore-blocker`. ADR 0006 sera réécrit **après** validation real-name.

---

## 1. Architecture cible

### 1.1 Constat fondateur
- Les snapshots EVS **ne peuvent pas** devenir une image bootable (images gold `__lazyloading` non-exportables → `charged image cannot be exported`).
- **CBR** est la voie native : le backup CBR (niveau serveur) **contourne** ce mur (backup → `available`, prouvé).
- Deux sorties CBR :
  1. **Restore → serveur EXISTANT** (`/backups/{id}/restore`) — en place, **pas de création d'image**.
  2. **Whole-image → NOUVELLE VM** (`ims …/wholeimages/action` avec `backup_id`) — **seule voie** vers une nouvelle ECS, **gatée real-name**.

### 1.2 Choix d'architecture
- **Artefact de sauvegarde = CBR server backup** (système + disques data), qui **remplace** le snapshot EVS pour la fonctionnalité « Sauvegardes » restaurables. (Le code snapshot EVS reste dormant ; voir migration §3.)
  - *Pourquoi* : un whole-image/restore exige un **CBR backup**, pas un snapshot EVS. Garder les deux = double coût de stockage + confusion. Le backup CBR est aussi **plus riche** (VM entière).
- **Un vault partagé** pour tout le portail (`git-vm-portal-vault`), créé à la demande (`ensureVault`), redimensionné au besoin. Les serveurs y sont associés au moment du backup.
  - *Pourquoi* : à l'échelle du portail (dizaines de VM), un vault par VM multiplie le surcoût de capacité minimale. Un vault partagé = gestion simple + facturation unique.
- **Deux modes de restore** exposés :
  - **« Nouvelle VM depuis une sauvegarde »** (parité AWS) : whole-image → launch. *(gaté real-name)*
  - **« Restaurer en place »** (optionnel) : restore-to-server. *(real-name probablement non requis — à confirmer)*
- **Tout asynchrone, piloté par le réconciliateur** (cron `*/2`), suivi via `job_id` (IMS) et `operation-logs`/statut backup (CBR). Aucun polling bloquant HTTP. Le couplage reste **derrière `cloud.ts`**.

### 1.3 Flux (vue d'ensemble)
```
SAUVEGARDE :  VM active ──ensureVault──> vault ──checkpoint──> backup (poll → available)
NOUVELLE VM : backup ──wholeImageFromBackup──> job ──> image_id ──launchInstance──> serveur (cleanup image)
EN PLACE :    VM stoppée + backup ──restoreToServer──> opération (poll) ──> start VM
```

---

## 2. Machine à états (réconciliateur)

Réutilise le pattern existant `restore_step` (colonne `vms`), gardé NULL pour les VM normales → **zéro régression**. Deux machines distinctes selon le mode.

### 2.1 Restore « nouvelle VM » (depuis un backup existant choisi à la création)
```
(création avec backup choisi)
   restore_step = 'image'   → wholeImageFromBackup(backup_id) ; provider_job_id = jobId
        │  resolveJob(jobId,'ims') == null → attendre
        ▼ image_id obtenu
   restore_step = 'launch'  → launchInstance(image_id) ; provider_job_id = jobId
        │  resolveLaunch(jobId) == null → attendre
        ▼ server_id obtenu, running+IP
   deleteImage(image_id)  (anti-orphelin) ; clearRestore ; status = active
```
Échec (catch) → `deleteImage` best-effort, `setRequestStatus('failed')`, `clearRestore`.

### 2.2 Restore « en place » (restore-to-server)
```
(POST .../rollback ou .../restore)
   stop VM (si requis) ; pause planning (garde transitoire)
   restore_step = 'restoring' → restoreToServer(backup_id, server_id) ; suivi opération
        │  opération en cours → attendre
        ▼ opération success
   start VM ; attendre running+IP ; un-pause planning (cf. décision Option B) ; clearRestore
```
Échec (catch) → start best-effort + un-pause planning + clearRestore (VM reste `active`).

> Note : la machine §2.2 remplace **avantageusement** le hack EVS detach/re-attach (managé par CBR, pas de manipulation de disque de boot). **À valider** (real-name ? body ? disque système en place ?).

---

## 3. Migrations D1 (additives uniquement)

`migrations/0004_cbr.sql` (proposé) :
```sql
-- Sauvegardes CBR (en complément des colonnes snapshot existantes ; additif strict).
ALTER TABLE snapshots ADD COLUMN kind          TEXT;   -- 'evs' (legacy) | 'cbr'
ALTER TABLE snapshots ADD COLUMN cbr_vault_id  TEXT;   -- vault CBR
ALTER TABLE snapshots ADD COLUMN cbr_backup_id TEXT;   -- backup CBR (source du whole-image / restore)

-- Restore : on RÉUTILISE vms.restore_step / restore_image_id (déjà présents, flux IMS dormant).
-- Nouvelle colonne pour la source backup d'un restore (new-VM ou en-place) :
ALTER TABLE vms ADD COLUMN restore_backup_id   TEXT;   -- backup_id source du restore en cours
```
- `restore_step` (existant) prend les valeurs `'image' | 'launch'` (new-VM) ou `'restoring'` (en place).
- Aucune table reconstruite (contrainte D1). Le flux IMS `restore_*` (0002) reste dormant.
- `vault_id` global stocké en `vars`/secret ou dérivé via `ensureVault` (pas de colonne dédiée nécessaire).

---

## 4. APIs Huawei utilisées

| Opération | API | Méthode | Statut |
|---|---|---|---|
| Créer vault | `cbr …/v3/{pid}/vaults` | POST | write **accordé** (lecture 200 confirmée) |
| Associer ressources | `cbr …/v3/{pid}/vaults/{id}/addresources` | POST | à confirmer (ou via `resources` au create) |
| Backup immédiat | `cbr …/v3/{pid}/checkpoints` | POST | **prouvé** (backup → available) |
| Lister/poller backups | `cbr …/v3/{pid}/backups` (+ `/{id}`) | GET | **200 confirmé** |
| **Restore en place** | `cbr …/v3/{pid}/backups/{id}/restore` | POST | **NON testé** (destructif) |
| Supprimer backup | `cbr …/v3/{pid}/backups/{id}` | DELETE | à utiliser (FinOps) |
| Supprimer vault | `cbr …/v3/{pid}/vaults/{id}` | DELETE | **prouvé** (cleanup) |
| Monitoring | `cbr …/v3/{pid}/operation-logs` | GET | **200 confirmé** |
| **Whole-image** | `ims …/v1/cloudimages/wholeimages/action` | POST | endpoint OK, **❌ 400 IMG.0026 real-name** |
| Résoudre job image | `ims …/v1/{pid}/jobs/{jobId}` | GET | à confirmer (host/chemin/`entities.image_id`) |
| Supprimer image | `ims …/v2/cloudimages/{id}` | DELETE | déjà utilisé |
| Launch / lifecycle ECS | `ecs …/v1/{pid}/cloudservers…` | — | **déjà en place** (provider) |

### 4.1 Méthodes provider à ajouter (`cloud.ts` + `huawei.ts`) — *non implémentées*
```
ensureVault(name): Promise<string>                       // vault_id (idempotent)
backupServer(vaultId, serverId, name): Promise<string>   // → checkpoint/backup (async)
resolveBackup(serverId|checkpointId): Promise<string|null>// → backup_id quand available
wholeImageFromBackup(name, backupId): Promise<string>     // → job_id
restoreToServer(backupId, serverId): Promise<string>      // → operation_id (en place)
getRestoreStatus(operationId): Promise<'pending'|'done'|'error'>
deleteBackup(backupId): Promise<void>
deleteVault(vaultId): Promise<void>
// réutilise : resolveJob(jobId,'ims'), launchInstance, deleteImage, stop/start/describe
```

---

## 5. Coûts

| Poste | Modèle | Estimation EU (à confirmer) |
|---|---|---|
| **Vault CBR** | capacité provisionnée (Go) facturée au stockage/mois | ~0.05–0.10 €/Go/mois selon type backup |
| **Backups** | 1er = full, suivants = **incrémentiels** ; consomment le vault | dépend du delta ; rétention `defaultPolicy` 30j |
| **Whole-image transitoire** | image IMS pendant le restore | faible (supprimée après launch) |
| **EIP/compute VM restaurée** | identique au flux VM normal | inchangé |

- **FinOps clés** : un vault provisionné coûte **même sans backup actif** → dimensionner juste + auto-grow. Supprimer les backups expirés (rétention) + l'image whole-image transitoire systématiquement. Vault partagé = 1 seul coût de base.
- Vault sizing : ≥ somme des tailles de backup. Stratégie : créer petit, agrandir via update si besoin (à confirmer : auto-grow vs taille fixe).

---

## 6. Inconnues restantes (NON prouvées)

| # | Hypothèse non prouvée | Impact si fausse |
|---|---|---|
| U1 | **whole-image réussit une fois la real-name auth faite** (IMG.0026 levé) | bloque toute la voie « nouvelle VM » |
| U2 | l'image whole-image est **bootable** et se lance comme une ECS normale (clé SSH, réseau réinjectables) | restore produit une VM non-bootable |
| U3 | aucun **résidu de blocage « charged »** ne resurgit post-real-name (la source dérive d'une image gold) | whole-image échoue pour une autre raison |
| U4 | forme du **job whole-image** : host/chemin (`ims/v1/{pid}/jobs/{id}` ?) + emplacement de `image_id` dans `entities` | `resolveJob` à ajuster |
| U5 | **restore-to-server** : besoin real-name ? body exact (`mappings`, `power_on`) ? restaure-t-il le **disque système en place** ? VM stoppée requise ? | l'option « en place » CBR peut être non-viable |
| U6 | **vault** : taille mini, auto-grow vs taille fixe, association serveur (au create vs addresources) | dimensionnement/coût + automatisation |
| U7 | **durées** backup & whole-image & restore (UX / timeouts réconciliateur) | tuning des `tries` |
| U8 | **dépendances de suppression** des backups incrémentiels (supprimer un backup base avec dépendants) | logique de cleanup/rétention |
| U9 | quotas CBR (nb vaults/backups, taille max) sur ce compte/région | limites d'échelle |
| U10 | real-name auth = **individuelle ou entreprise** requise, délai, documents | faisabilité/planning du déblocage |

---

## 7. Plan de validation APRÈS activation real-name auth

Séquence de tests **live contrôlés** (VM jetables, cleanup garanti, ~quelques cents), à lancer par l'utilisateur. Chaque étape lève des inconnues précises :

1. **Whole-image (U1, U3, U4)** — depuis un CBR backup frais : `wholeimages/action` → attendu **200 + job_id** (plus d'IMG.0026) ; poller le job → `image_id`. Logguer le job brut (host/chemin/entities). *Script : adapter `tmp-cbr-e2e.ts`.*
2. **Boot de la VM restaurée (U2)** — `launchInstance(image_id)` → running + IP → **SSH `root`** confirmé. Valide la parité « nouvelle VM » bout-en-bout.
3. **Restore-to-server en place (U5)** — sur une VM jetable : backup → `restoreToServer` → suivre l'opération → VM démarrée. Confirme besoin real-name + body + restauration disque système en place.
4. **Vault & coûts (U6, U9)** — créer/associer/redimensionner un vault ; relever taille mini, comportement auto-grow, quotas ; estimer le coût réel.
5. **Durées & rétention (U7, U8)** — mesurer backup/whole-image/restore ; tester suppression backup base + incrémentiel.
6. **Anti-orphelin** — `huawei-orphans.ts` (étendre au CBR : vaults/backups/images) → 0 orphelin.

**Critère de GO implémentation** : étapes 1+2 vertes (= parité « nouvelle VM » prouvée). Puis implémentation progressive selon §1–§4 (provider → contrat → migration → réconciliateur → UI → FinOps → ADR 0006).

---

## 8. Décisions ouvertes (pour l'implémentation, pas maintenant)
- Backup = **CBR uniquement** (recommandé) vs cohabitation EVS+CBR.
- Restore exposé : « nouvelle VM » seul, ou **+ en place** (si U5 OK).
- Vault : **partagé** (recommandé) vs par-VM.
- `backup-on-delete` (CBR) en remplacement de `snapshot-on-delete`.
- Rétention/quota par rôle (FinOps).
