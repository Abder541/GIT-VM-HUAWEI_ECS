# Roadmap Huawei — du provider validé au projet 100 %

> Plan-maître exhaustif pour finir le portage **GIT VM Portal → Huawei Cloud ECS**.
> Chaque tâche : **objectif · étapes · test/debug · résultat attendu · reco · risque**.
> Convention projet : docs FR, code EN, TypeScript strict, Hono, migrations D1 additives,
> tout le couplage cloud derrière `src/cloud.ts` (impl `src/huawei.ts`). Voir [AGENTS.md](../AGENTS.md).
>
> Dernière analyse live : 2026-06-24 (région `eu-west-101`, site `myhuaweicloud.eu`).
> Légende : ✅ fait & validé · 🔶 codé non-validé-live · ⬜ à faire · ❌ bloqué.

---

## 0. Décisions requises (débloquent des phases entières)

| # | Décision | Bloque | Reco |
|---|---|---|---|
| D1 | **Compte Cloudflare canonique** (aujourd'hui = compte de Thomas) | CI/CD Workers Builds (Phase 5) | Trancher tôt : créer un compte projet dédié ou officialiser l'actuel |
| D2 | **Push GitHub** des ~8+ commits locaux (`github.com/Abder541/GIT-VM-HUAWEI_ECS`) | CI/CD, revue, sauvegarde | Pousser dès que la Phase 0 est verte |
| D3 | **Rotation AK/SK** (clé exposée en clair, full-access) | Sécurité | Roter + ressaisir secret Cloudflare ; cible IAM moindre privilège `svc-git-vm-portal` |
| D4 | **Budget / flavors haut de gamme & GPU** | Catalogue perf (Phase 1) | Plafonner ; GPU (`pi3`) réservé admin/formateur |
| D5 | **Windows = images market payantes** (acceptation de la charge) | Phase 2 Windows | Valider le surcoût licence avant activation |
| D6 | **Stratégie restore** (IMS bloqué → CBR) | Phase 4 | Adopter **CBR** (cf. Phase 4) |

### Résolutions (2026-06-24)
- **D5 Windows** ✅ accepté (surcoût licence) → Phase 2 : code fait, image market, validation live à venir.
- **D6 Restore** ✅ **CBR confirmé viable** (endpoints `cbr.…/v3/vaults|backups|policies` = 200, `ims …/v1/cloudimages/wholeimages/action` existe) → voie **CBR backup → whole-image(`backup_id`) → launch** (cf. Phase 4).
- **D4 GPU** ✅ tranché : GPU reste `hidden` (hors sélecteur, SPA filtre `!hidden`) ; **l'approbation admin de chaque demande = garde-fou** → pas de gate API dédié nécessaire. Budget : garder le plafond + alerte (Phase 5).
- **D1 Cloudflare** ▶ reco : **officialiser le compte actuel** (`8ff047eb…`, qui héberge déjà Worker+D1 live) pour brancher CI/CD sans migration ; revoir la propriété ensuite. Le choix d'ownership reste ta décision org.
- **D2 GitHub** ▶ je pousse le travail via **branche + PR** (convention AGENTS.md), pas en direct sur `main`.
- **D3 Rotation AK/SK** ▶ action **console Huawei (manuelle, ton login)** : créer une nouvelle paire AK/SK → `wrangler secret put HUAWEI_ACCESS_KEY/HUAWEI_SECRET_KEY` + `.dev.vars` → révoquer l'ancienne. Je ne peux pas la faire à ta place (pas d'accès console). Procédure détaillée à fournir.

---

## 1. Acquis (ne pas refaire)

- ✅ Signature AK/SK (`huawei-sign.ts`, 8 tests live).
- ✅ Provider `huawei.ts` (16 méthodes contrat `cloud.ts`).
- ✅ Cycle de vie ECS create→active→stop/start→terminate (EIP + volume), 0 orphelin.
- ✅ Clés SSH via Nova `os-keypairs`.
- ✅ **EVS** create / `createVolumeFromSnapshot` / `resolveJob('evs')` / snapshots create-describe-delete. **Bug `size` corrigé** dans `createVolumeFromSnapshot`.
- ✅ Réseau Terraform (VPC/subnet/SG) câblé.
- ✅ Déploiement live (Worker + D1 + 6 secrets + SPA), login Entra, parcours demande→approve→VM→SSH root.

---

## 2. Phase 0 — Clôture du provider (priorité)

But : garantir que **toute** la couche fournisseur est sûre avant d'élargir.

### P0-1 — EVS : figer et nettoyer ✅/⬜
- ✅ `createVolumeFromSnapshot` envoie `size` (lu sur le snapshot). Typecheck OK.
- ⬜ **Reco** : appliquer le même correctif à `registerImageFromSnapshot` (l.242 : `size` manquant **+ AZ manquante**) — méthode dormante mais cassée. Ou la **supprimer** si on bascule sur la voie async `createImageFromVolume`/CBR (éviter 2 chemins).
- Test : `npm run typecheck` ; relancer `scripts/huawei-evs-ims-test.ts` avec un snapshot réel → 200.

### P0-2 — IMS restore : lever ou contourner ❌
- Analyse faite : toutes les bases Linux EU sont `gold/__lazyloading=true` non-exportables → `createImageFromVolume` (volume_id) refusé (`charged image cannot be exported`). **Ce n'est PAS notre code.**
- ⬜ **Reco** : ne pas insister sur image-depuis-volume. Décision D6 → **CBR** (Phase 4). Documenter dans ADR 0006 (mise à jour).
- ⬜ Optionnel (read-only impossible) : confirmer que image-depuis-`instance_id` marche (création custom-image standard) — utile si on garde une voie ECS.

### P0-3 — idle-stop CES 🔶
- Objectif : confirmer `maxCpuOverWindow` renvoie de vrais datapoints et déclenche le stop.
- Étapes : VM de test → charge CPU (`stress`) → vérifier `GET ces.…/V1.0/{pid}/metric-data` (namespace `SYS.ECS`, `cpu_util`) → laisser idle → vérifier stop par le réconciliateur.
- Debug : si 0 datapoint, vérifier droit CES (équivalent `aws-iam-cloudwatch`), `period`, fenêtre, `dim.0=instance_id,...`.
- Résultat : stop auto + notif ; sinon `IDLE_STOP=false` documenté.
- Risque : nécessite **1 VM live** (décision implicite).

### P0-4 — Durcissement egress SG 🔶
- Objectif : activer `harden_egress=true` (Terraform `hardening.tf`) en staging.
- Test : depuis une VM, DNS résout via Cloudflare-only (1.1.1.3), torrents/P2P bloqués, **SSH/RDP entrants OK**.
- Risque : casser une VM antérieure (DNS = résolveur VPC) → `resolv.conf` 1.1.1.3 ou recréer.

### P0-5 — Scan orphelins 🔶
- ⬜ Relancer `scripts/huawei-orphans.ts` (classifieur indispo précédemment) → confirmer 0 ressource non-taggée (ECS/EIP/EVS/snapshots/images).

### P0-6 — Mail ⬜
- `MAIL_ENABLED=false` → renseigner EmailJS service/template, tester : VM prête, expiry J-x, snapshot, échec provisioning.

---

## 3. Phase 1 — Catalogue complet (toutes les options Huawei)

But : exposer la richesse Huawei (perf / stockage / OS / disques data). Couture = `src/presets.ts` + `launchInstance`.

> ✅ **IMPLÉMENTÉ 2026-06-24** (typecheck worker+SPA + 19 tests verts) :
> - `PERF` : +compute (`c7n.xlarge.2`, `c7n.2xlarge.2`), +mémoire (`m7n.2xlarge.8`), +GPU (`pi3.6xlarge.4`, `hidden`).
> - `STORAGE` : champ `volumetype` ajouté ; +SSD (`ssd80`/`ssd160`), +SAS (`sas160`). GPSSD2 exclu (AZ c). `volumetype` threadé via `cloud.ts LaunchParams` → `huawei.ts launchInstance` → `index.ts` (2 sites). Sans migration (id stockage déjà persisté).
> - `OS` : +Ubuntu 20.04, Debian 11, AlmaLinux 8/9, Rocky 8/9 (image_id réels).
> - ⚠️ **À confirmer live** : prix EUR (approximatifs), `sshUser='root'` pour Alma/Rocky (hypothèse Huawei gold), volume type sur le flux restore (resté GPSSD). GPU à exposer via gate admin (D4).

### P1-1 — Performances (flavors) — actuel : **s6 seul (4 tiers)**
Données live (eu-west-101a, 293 flavors). **Catalogue cible recommandé** :

| Tier | Flavor | vCPU/RAM | Famille | Usage |
|---|---|---|---|---|
| Micro | `s6.medium.2` | 1c / 2g | général | tests (actuel) |
| Small ⭐ | `s6.large.2` | 2c / 4g | général | cours standard (actuel) |
| Flex | `s6.large.4` | 2c / 8g | général | conteneurs/IDE (actuel) |
| Perf | `s6.xlarge.2` | 4c / 8g | général | charges lourdes (actuel) |
| Compute | `c7n.xlarge.2` | 4c / 8g | compute-opt | compil/cyber/calcul |
| Compute+ | `c7n.2xlarge.2` | 8c / 16g | compute-opt | gros calcul |
| Memory | `m7n.2xlarge.8` | 8c / 64g | mémoire | data science / DB |
| GPU (admin) | `pi3.6xlarge.4` | 24c / 96g + GPU | GPU | IA/CUDA — **coût élevé, gate D4** |

- Étapes : enrichir `PERF` (id/label/flavor/vcpu/ramGb/hourlyEur réel), tag `family` perf pour l'UI, flag `adminOnly` pour GPU.
- ⬜ Script `huawei-flavors.mjs` formalisé (équiv. `aws-amis`) pour rafraîchir prix/dispo.
- Risque : prix EUR à confirmer (pay-as-you-go) ; garde-fou budget (D4).

### P1-2 — Stockage (types EVS) — actuel : **GPSSD figé**
Types live : `GPSSD`(toutes AZ ✅), `SSD`(toutes AZ), `SAS`(a/b), `ESSD`(a/b), `GPSSD2`(**c seul** ⚠️).
- Étapes : ajouter `volumetype` au `StoragePreset` (aujourd'hui codé en dur `GPSSD` dans `launchInstance` l.123) ; sélecteur type × taille.
- **Reco** : proposer GPSSD (déf.), SAS (éco), SSD (perf). **Exclure GPSSD2** tant que l'AZ par défaut est `a` (sinon échec) → sinon ajouter une **vérif AZ/type**.
- ⬜ **Disques de données** : option volumes secondaires (create EVS + attach), affichage + détachement/suppression au terminate (FinOps).

### P1-3 — OS Linux — actuel : 3 (Ubuntu 24.04/22.04, Debian 12)
image_id réels capturés (scan 2026-06-24) à ajouter : Debian 11 `f2ca2562…`, AlmaLinux 9.0 `fda22b17…` / 8.4, Rocky 9.0 `48ff5b63…` / 8.x, CentOS Stream 9 `6d20bd81…`, CentOS 7.9 `e9e78b35…`, Ubuntu 20.04 `5161457d…`.
- Étapes : enrichir `OS` (familles `alma`/`rocky` existent déjà dans le type), icônes SPA.
- ⚠️ `minStorageGb=40` (mindisk gold), garder `sshUser=root` (validé Ubuntu — **reconfirmer par OS** : CentOS/Alma peuvent imposer `cloud-user`/`root`).
- ⬜ Script de **rafraîchissement des image_id** (ils périment) — `huawei-images.mjs`.

---

## 4. Phase 2 — Windows (ton exemple) 🔶 code fait, validation live à venir

> ✅ **2026-06-24** : OS `windows2019` ajouté (`presets.ts`, image market `e5233d7b…`, RDP, `Administrator`). Le provider gère **déjà** Windows (mot de passe via user_data `<powershell>`, base64, `admin_password` AES-GCM). Le SG ouvre **déjà** 3389 (`infra/terraform/main.tf` rule `rdp`). Typecheck+tests verts.
> ❌ **VALIDATION LIVE BLOQUÉE (2026-06-24)** : `POST cloudservers → 400 "You are forbidden to use market image e5233d7b…"`. L'image market n'est **pas souscrite** sur le compte. Preset passé en `hidden`.
> ▶ **Action requise (console, toi)** : Marketplace Huawei → s'abonner à une image **Windows Server** (vérifier le modèle de coût licence), récupérer l'`image_id` souscrit → le mettre dans `windows2019.image` + retirer `hidden`. Puis re-run `scripts/tmp-win-e2e.ts`.

Constat : Windows existe en images **MARKET** EU (ex. `Windows Server 2019 Standard …eu`, `__productcode` présent = **payant**, D5). Pas d'image gold gratuite.

Travail provider (`huawei.ts launchInstance`) :
- ⬜ Mot de passe admin : Windows ne boote PAS en clé SSH. Passer `admin_pass` (généré, fort) dans le body ECS, **OU** Cloudbase-init + récupération. Stocker `admin_password` **AES-GCM** (colonne **déjà en base**).
- ⬜ `connect_method='rdp'`, ouvrir **3389** sur le SG (le durcissement egress ne touche pas l'ingress).
- ⬜ user_data **Cloudbase-init** (PowerShell base64) — `buildWindowsCourseInstall` (Chocolatey) **existe déjà** dans `presets.ts`, à brancher.
- ⬜ Réactiver la famille `windows` dans `OS` (+ icône), image market.
- ⬜ Gérer l'**acceptation de la charge** market à la création (sinon refus).

Test/debug : provisionner 1 Windows → RDP avec mot de passe déchiffré → cours installé (callback). Vérifier coût licence.
Risque : surcoût ; format user_data Windows ; temps de boot long (mot de passe prêt tardivement).

---

## 5. Phase 3 — Validation parité E2E 🔶

Re-tester en réel (parité AGENTS.md) sur le cron unique `*/2`:
- ⬜ Multi-VM & groupes (1–4, demande groupée formateur round-robin).
- ⬜ Plannings start/stop (fuseau Europe/Zurich).
- ⬜ Auto-destroy à `end_date` + **snapshot auto avant suppression**.
- ⬜ Garde-fou nocturne 19:00 (fusionné dans `scheduled()` — limite 5 crons).
- ⬜ Durcissement in-VM (DNS/P2P/hostname) Linux **et** Windows.
- ⬜ Retry provisioning échoué (max 3), détection drift (VM supprimée hors portail → `terminated`).
Outil : étendre `scripts/huawei-e2e.ts` + `huawei-stabilize.ts`.

---

## 6. Phase 4 — Restore opérationnel via CBR (remplace IMS-from-volume) ❌→⬜

Justification : image-depuis-volume bloquée (lignée gold). **CBR = voie native Huawei.**

> ✅ **Étude read-only faite (2026-06-24)** : CBR dispo sur EU (`cbr.eu-west-101.…/v3/{pid}/vaults|backups|policies` = 200, `defaultPolicy` backup 30j présente). `ims …/v1/cloudimages/wholeimages/action` existe (400 sur body vide = endpoint OK, pas 404). CSBS absent (404) → CBR est le bon service.
>
> ❌ **VALIDATION LIVE BLOQUÉE (2026-06-24)** : `POST cbr/v3/{pid}/vaults → 403 "Policy doesn't allow cbr:vaults:create"`. L'identité AK/SK a le **read CBR** (GET = 200) mais **pas le write** → la clé `GIT-VM` n'est PAS réellement full-access (CBR manquant).
> ▶ **Action requise (console/IAM, toi ou l'IT client)** : attacher **CBR FullAccess** (ou policy custom `cbr:*`) à l'utilisateur IAM de la clé. Puis re-run `scripts/tmp-cbr-e2e.ts` → ça révélera les formes d'API (vault/checkpoint/backup/whole-image) pour écrire le provider CBR.

**Design retenu (CBR backup → whole-image → launch)** :
1. **Vault** : créer/réutiliser un vault CBR (`POST cbr/v3/{pid}/vaults`, type `backup`, ressource = serveur).
2. **Backup** : associer la VM au vault + déclencher un backup (`POST cbr/v3/{pid}/vaults/{id}/backup` ou checkpoint) → backup async.
3. **Whole-image** : `POST ims/v1/cloudimages/wholeimages/action` avec `backup_id` → job → `image_id` (image entière, lancée comme une image normale).
4. **Launch** : `launchInstance` avec cette `imageId` (flux existant inchangé).

Implémentation :
- ⬜ Provider : `createVault`/`backupServer`/`resolveBackup`/`wholeImageFromBackup`/`resolveJob('ims')` (réutilise le polling job). Remplace/complète `createVolumeFromSnapshot`+`createImageFromVolume`.
- ⬜ Décision modèle « backup » : soit CBR remplace les snapshots EVS (refonte feature backup), soit CBR coexiste pour le seul restore-vers-nouvelle-VM. **Reco** : CBR pour le restore ; garder snapshots EVS pour le backup simple (les deux services rendent des services différents).
- ⬜ Contrat `cloud.ts` (méthodes restore neutres) + réconciliateur (`restore_step` étendu) + ADR 0006 réécrit.
- ⬜ **Validation live** : VM → backup CBR → whole-image → relance → boot OK. Risque : coût vault (stockage), latence backup, droits IAM CBR.

---

## 7. Phase 5 — Industrialisation (production)

- ⬜ **D2** Push GitHub + ⬜ **D1** compte Cloudflare → **CI/CD Workers Builds** (build + `d1 migrations apply --remote` + deploy sur `main`).
- ⬜ **D3** Rotation AK/SK + cible IAM moindre privilège.
- ⬜ Observabilité : alertes **CES**, dashboards Grafana, **CTS** (audit trail), Sentry actif.
- ⬜ FinOps : alerte budget, plafond coût, revue EIP/volumes/snapshots orphelins (cron).
- ⬜ Healthchecks : `GET /healthz`, `GET /api/presets` post-deploy.

---

## 8. Phase 6 — Durcissement avancé

- ⬜ Réseau : segmentation, activation `harden_egress` en prod, revue SG.
- ⬜ HA/DR : multi-AZ (attention dispo type/AZ vue en P1-2), **D1 Time Travel**, runbooks `docs/operations`.
- ⬜ Cloudflare **Access/WAF** devant le portail.
- ⬜ Gouvernance : quotas par rôle, revue des accès.

---

## 9. Qualité transverse (à chaque PR)

- `npm run typecheck` + `npm --prefix web run typecheck` (i18n : toute clé `fr` aussi en `en`).
- `npm test` (vitest), `npm run lint`.
- Migrations D1 **additives uniquement**.
- Scripts d'intégration réels (`huawei-e2e`, `huawei-evs-ims-test`, `huawei-orphans`) avant jalon.
- **Nettoyage** : supprimer les jetables `scripts/tmp-*.ts` en fin de phase d'analyse.

---

## 10. Recommandation (ordre conseillé)

1. **Finir Phase 0** (provider sûr) — surtout P0-2 (décision CBR) + P0-1 (nettoyer `registerImageFromSnapshot`). *Sans ressource si on reste read-only ; idle-stop/hardening nécessiteront 1 VM.*
2. **Phase 1 catalogue** (impact visible immédiat, **sans dépendance externe**) : flavors + types EVS + OS Linux. **C'est le meilleur quick-win** vu que les données sont déjà capturées.
3. **D1/D2/D3** en parallèle (push GitHub + compte + rotation) pour débloquer la prod.
4. **Phase 2 Windows** (après D5).
5. **Phase 3 parité E2E**, puis **Phase 4 CBR**, puis **Phases 5-6**.

**Mon conseil immédiat** : enchaîner **Phase 1 (catalogue)** maintenant — c'est sûr, sans ECS, sans décision externe, et ça concrétise « toutes les options Huawei » que tu veux (perf/stockage/OS). Windows et restore CBR viennent juste après car ils dépendent de décisions (D5/D6) et de ressources.
