// src/cloud.ts — Contrat de couche fournisseur (« provider seam »)
//
// CLÉ DE VOÛTE du portage AWS → Huawei. TOUT le code spécifique au cloud est
// derrière ce contrat ; le reste du Worker (OIDC, crypto, D1, réconciliateur, SPA)
// n'importe QUE ce fichier et reste agnostique du fournisseur.
//
// Côté AWS (référence), l'équivalent concret est `src/aws.ts` : 15 fonctions
// exportées, ~272 lignes (EC2 + EBS + CloudWatch via aws4fetch, protocole query,
// réponses XML parsées au regex). L'analyse préliminaire l'estimait à « ~150 lignes /
// ~10 opérations » : en réalité elle sous-estimait 5 opérations bien réelles
// (snapshots ×3, lecture volume racine, restauration via image, métriques CPU).
// Ce contrat les inclut toutes.
//
// Côté Huawei, l'implémentation vit dans `src/huawei.ts` (REST/JSON + signature
// AK/SK « SDK-HMAC-SHA256 ») et expose exactement cette interface.
//
// DIFFÉRENCE STRUCTURANTE vs AWS : la création ECS est ASYNCHRONE. `launchInstance`
// renvoie un `jobId` (pas un `serverId`). Le `serverId` est résolu plus tard par le
// réconciliateur via `resolveLaunch` — aucun polling bloquant dans la requête HTTP.

/** Type de clé SSH généré pour la VM. Windows exige RSA (ed25519 rejeté au boot). */
export type KeyType = 'ed25519' | 'rsa';

/** Paire de clés générée pour UNE VM. La clé privée n'est renvoyée qu'une fois. */
export interface KeyPair {
  keyName: string;
  /** Matériel de clé privée (PEM / OpenSSH) — chiffré AES-GCM avant stockage. */
  privateKey: string;
}

/** Paramètres de création d'une VM (provider-neutres). */
export interface LaunchParams {
  requestId: number;
  keyName: string;
  /** Gabarit de calcul ECS (ex. `s6.large.2`). Équivaut à l'`instanceType` EC2. */
  flavor: string;
  /** Image IMS (`image_id`). Équivaut à l'AMI EC2. */
  imageId: string;
  /** Taille du volume racine EVS, en Go. */
  sizeGb: number;
  /** Type de volume EVS racine (GPSSD / SSD / SAS…). Défaut implémentation : GPSSD. */
  volumetype?: string;
  /** Script de bootstrap au 1er démarrage (cloud-init Linux / EC2Launch-like Windows). */
  userData?: string;
  /** Nom lisible → tag `Name` de la VM (repli : `vm-portal-req-<id>`). */
  nameTag?: string | null;
  /**
   * Restauration (Option A) : booter directement sur un VOLUME EVS existant (sauvegarde
   * conservée) au lieu de créer un disque depuis une image. Quand défini, l'implémentation
   * utilise l'API Nova (block_device_mapping_v2) et renvoie un `serverId` (synchrone).
   * `imageId`/`sizeGb` sont alors ignorés (le disque existe déjà).
   */
  bootVolumeId?: string;
}

/**
 * Accusé de création asynchrone. Huawei renvoie un `jobId` ; le `serverId` réel est
 * résolu au tick suivant du réconciliateur (`resolveLaunch`).
 */
export interface LaunchHandle {
  /** Création ECS native asynchrone → résolu par `resolveLaunch`. */
  jobId?: string;
  /** Boot-from-volume (Nova) : `server_id` déjà connu (synchrone), pas de job à résoudre. */
  serverId?: string;
}

/**
 * État d'une VM exprimé dans le VOCABULAIRE DU PORTAIL (pas celui du cloud).
 * L'implémentation traduit les états natifs vers `NORMALIZED_STATES`.
 */
export interface InstanceStatus {
  state: string;
  publicIp?: string;
  launchTime?: string;
}

/** Volume racine d'une VM (pour snapshot + restauration). */
export interface RootVolume {
  volumeId?: string;
  rootDevice?: string;
  architecture?: string;
  sizeGb?: number;
}

/** État d'un snapshot. `state` ∈ pending | completed | error. */
export interface SnapshotState {
  state: string;
  sizeGb?: number;
}

/** Statistique CPU sur une fenêtre (pour l'arrêt sur inactivité). */
export interface CpuStat {
  /** Maximum d'utilisation CPU (%) observé sur la fenêtre. */
  max: number;
  /** Nombre de points de mesure (le réconciliateur exige assez d'historique). */
  datapoints: number;
}

/**
 * Vocabulaire d'état normalisé du portail. Toute implémentation DOIT mapper les
 * états natifs du cloud vers l'une de ces valeurs (le réconciliateur et la SPA ne
 * connaissent que celles-ci).
 *
 *   pending     création / démarrage en cours   (AWS `pending`   · Huawei `BUILD`)
 *   running     active et joignable             (AWS `running`   · Huawei `ACTIVE`)
 *   stopping    arrêt demandé                    (AWS `stopping`  · Huawei transition)
 *   stopped     arrêtée                          (AWS `stopped`   · Huawei `SHUTOFF`)
 *   terminated  détruite / absente               (AWS `terminated`· Huawei `DELETED`)
 *   error       échec                            (—               · Huawei `ERROR`)
 */
export const NORMALIZED_STATES = [
  'pending',
  'running',
  'stopping',
  'stopped',
  'terminated',
  'error',
  'unknown',
] as const;
export type NormalizedState = (typeof NORMALIZED_STATES)[number];

/**
 * Contrat de couche fournisseur. Une implémentation par cloud.
 * `src/huawei.ts` exportera une fabrique `huawei(env): CloudProvider`, seul point où
 * le reste du Worker obtient un fournisseur (facilite le test par injection d'un faux
 * et un éventuel multi-cloud).
 */
export interface CloudProvider {
  // ---- Clés SSH (Huawei KPS / AWS EC2 KeyPair) ----------------------------
  createKeyPair(requestId: number, keyType?: KeyType): Promise<KeyPair>;
  deleteKeyPair(keyName: string): Promise<void>;

  // ---- Cycle de vie de la VM (Huawei ECS / AWS EC2) -----------------------
  /** Crée la VM. ASYNCHRONE côté Huawei → renvoie un `jobId`. */
  launchInstance(p: LaunchParams): Promise<LaunchHandle>;
  /** Résout `jobId → serverId` (null tant que le job n'est pas terminé). Réconciliateur. */
  resolveLaunch(handle: LaunchHandle): Promise<string | null>;
  describeInstance(serverId: string): Promise<InstanceStatus>;
  /**
   * Détruit la VM ET ses ressources liées (EIP, volume racine) — enjeu FinOps + drift.
   * `keepVolume` (sauvegarde à la suppression) : conserve le disque racine pour restauration.
   */
  terminateInstance(serverId: string, keepVolume?: boolean): Promise<void>;
  /** Attache une EIP (IP publique) à une VM — pour les VM restaurées bootées via Nova. */
  attachEip(serverId: string): Promise<void>;
  startInstance(serverId: string): Promise<void>;
  stopInstance(serverId: string): Promise<void>;
  rebootInstance(serverId: string): Promise<void>;
  /** VM gérées par le portail (filtre par tag) → `{ serverId: étatNormalisé }`. */
  listManaged(): Promise<Record<string, string>>;

  // ---- Disque & snapshots (Huawei EVS) + restauration (Huawei IMS) --------
  describeRootVolume(serverId: string): Promise<RootVolume>;
  createSnapshot(volumeId: string, description: string): Promise<string>;
  describeSnapshot(snapshotId: string): Promise<SnapshotState>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  // ===== LEGACY / DEPRECATED — remplacé par CBR (cf. docs/design-cbr-restore.md) ============
  // Deux approches de restore PROUVÉES NON-VIABLES sur le compte (IMS image-from-volume →
  // « charged image cannot be exported » ; whole-image → IMG.0026 real-name ; rollback EVS →
  // volume « in-use »). Conservées comme LEGACY, INACTIVES : gated `RESTORE_ENABLED=false`,
  // aucun flux actif ne les appelle (prouvé : seuls appelants = branches gated). Ne pas réutiliser ;
  // à retirer/remplacer une fois CBR implémenté (real-name auth gated).
  /** @deprecated LEGACY — rollback EVS en place (bloqué « in-use »). Remplacé par CBR. Inactif (gated). */
  rollbackSnapshot(snapshotId: string, volumeId: string): Promise<void>;
  /** @deprecated LEGACY — suivi du rollback EVS. Remplacé par CBR. Inactif (gated). */
  getVolumeStatus(volumeId: string): Promise<string>;
  /** @deprecated LEGACY — IMS restore : volume depuis snapshot. Remplacé par CBR. Inactif (gated). */
  createVolumeFromSnapshot(snapshotId: string, availabilityZone: string): Promise<string>; // → jobId
  /** @deprecated LEGACY — IMS restore : image depuis volume (bloqué charged-image). Remplacé par CBR. */
  createImageFromVolume(name: string, volumeId: string, osVersion: string): Promise<string>; // → jobId
  // ===== fin LEGACY =====
  deleteVolume(volumeId: string): Promise<void>;
  deleteImage(imageId: string): Promise<void>;
  /** Résout un job EVS/IMS → id de ressource (volume_id/image_id) ; null si en cours. */
  resolveJob(jobId: string, service: 'evs' | 'ims'): Promise<string | null>;

  // ---- Métriques (Huawei Cloud Eye / CES) pour l'arrêt sur inactivité -----
  maxCpuOverWindow(serverId: string, minutes: number): Promise<CpuStat | null>;
}
