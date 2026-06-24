// src/huawei.ts — Implémentation Huawei du contrat `CloudProvider`.
//
// REST/JSON signé AK/SK (`huawei-sign.ts`, validé en live). Tout le couplage cloud
// vit ici ; le reste du Worker n'importe que `cloud.ts`. Endpoints sur le site
// européen `myhuaweicloud.eu` (RGPD), région `eu-west-101`, project_id scoped.
//
// États natifs Huawei normalisés vers le vocabulaire du portail (cf. cloud.ts).

import type { Env } from './types';
import { signedFetch } from './huawei-sign';
import type {
  CloudProvider,
  KeyPair,
  KeyType,
  LaunchParams,
  LaunchHandle,
  InstanceStatus,
  RootVolume,
  SnapshotState,
  CpuStat,
} from './cloud';

// ---- Endpoints (site EU) -----------------------------------------------
function endpoints(env: Env) {
  const s = env.HUAWEI_ENDPOINT_SUFFIX || 'myhuaweicloud.eu';
  const r = env.HUAWEI_REGION;
  return {
    ecs: `ecs.${r}.${s}`,
    vpc: `vpc.${r}.${s}`, // EIP est sous le service VPC
    ims: `ims.${r}.${s}`,
    kps: `kps.${r}.${s}`,
    evs: `evs.${r}.${s}`,
    ces: `ces.${r}.${s}`,
  };
}

// État Huawei → vocabulaire portail (NORMALIZED_STATES dans cloud.ts).
function normalizeState(s: string | undefined): string {
  switch ((s || '').toUpperCase()) {
    case 'ACTIVE': return 'running';
    case 'BUILD': case 'REBOOT': case 'HARD_REBOOT': case 'RESIZE': case 'VERIFY_RESIZE': return 'pending';
    case 'SHUTOFF': return 'stopped';
    case 'DELETED': case 'SOFT_DELETED': return 'terminated';
    case 'ERROR': return 'error';
    default: return 'unknown';
  }
}

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

// Huawei renvoie les dates en UTC SANS suffixe 'Z' (ex. "2026-06-23T17:50:00.000000"),
// ce qui fausse les calculs d'uptime (interprété en heure locale). On normalise en ISO
// UTC : microsecondes → millisecondes + 'Z'.
function utcIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(/(\.\d{3})\d+$/, '$1').replace(' ', 'T') + 'Z';
}

export function huawei(env: Env): CloudProvider {
  const ep = endpoints(env);
  const pid = env.HUAWEI_PROJECT_ID;

  // Requête JSON signée + gestion d'erreur uniforme.
  async function req(host: string, method: string, path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<any> {
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : '';
    const res = await signedFetch({
      method,
      host,
      path,
      query: opts.query,
      headers: bodyStr ? { 'Content-Type': 'application/json' } : {},
      body: bodyStr,
      ak: env.HUAWEI_ACCESS_KEY,
      sk: env.HUAWEI_SECRET_KEY,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.error_msg ?? json?.message ?? text.slice(0, 200) ?? String(res.status);
      throw new Error(`Huawei ${method} ${path} → ${res.status}: ${msg}`);
    }
    return json ?? {};
  }

  return {
    // ---- Clés SSH (API keypair Nova, hôte ECS) ----------------------------
    // KPS v3 n'est pas publié sur le site EU (404) → on utilise l'API compatible
    // Nova `os-keypairs` sur l'hôte ECS (validé). Génère la paire et renvoie la clé
    // privée UNE fois (RSA ; ed25519 non garanti — U1).
    async createKeyPair(requestId: number, _keyType: KeyType = 'ed25519'): Promise<KeyPair> {
      const keyName = `vm-portal-req-${requestId}`;
      // Idempotence : supprimer un éventuel reliquat du même nom.
      await req(ep.ecs, 'DELETE', `/v2.1/${pid}/os-keypairs/${keyName}`).catch(() => {});
      const j = await req(ep.ecs, 'POST', `/v2.1/${pid}/os-keypairs`, { body: { keypair: { name: keyName } } });
      const privateKey = j?.keypair?.private_key;
      if (!privateKey) throw new Error('os-keypairs: pas de private_key dans la réponse');
      return { keyName, privateKey };
    },

    async deleteKeyPair(keyName: string): Promise<void> {
      await req(ep.ecs, 'DELETE', `/v2.1/${pid}/os-keypairs/${keyName}`).catch(() => {});
    },

    // ---- Cycle de vie ECS -------------------------------------------------
    async launchInstance(p: LaunchParams): Promise<LaunchHandle> {
      if (!env.HUAWEI_VPC_ID || !env.HUAWEI_SUBNET_ID || !env.HUAWEI_SECGROUP_ID) {
        throw new Error('Config réseau Huawei manquante (VPC / subnet / security group)');
      }
      const rawName = (p.nameTag && p.nameTag.trim()) || `vm-portal-req-${p.requestId}`;
      const name = rawName.replace(/[^a-zA-Z0-9-_.]/g, '-').slice(0, 64);
      const bandwidth = Number(env.HUAWEI_EIP_BANDWIDTH) > 0 ? Number(env.HUAWEI_EIP_BANDWIDTH) : 5;

      const server: any = {
        name,
        imageRef: p.imageId,
        flavorRef: p.flavor,
        vpcid: env.HUAWEI_VPC_ID,
        nics: [{ subnet_id: env.HUAWEI_SUBNET_ID }],
        root_volume: { volumetype: p.volumetype || 'GPSSD', size: p.sizeGb },
        security_groups: [{ id: env.HUAWEI_SECGROUP_ID }],
        key_name: p.keyName,
        count: 1,
        // EIP créée et liée atomiquement, libérée à la suppression (delete_publicip).
        publicip: { eip: { iptype: '5_bgp', bandwidth: { size: bandwidth, sharetype: 'PER', charge_mode: 'traffic' } } },
        server_tags: [
          { key: 'managed-by', value: 'git-vm-portal' },
          { key: 'request-id', value: String(p.requestId) },
        ],
      };
      if (env.HUAWEI_AZ) server.availability_zone = env.HUAWEI_AZ;
      if (p.userData) server.user_data = b64(p.userData); // ECS exige du base64

      // Création ASYNCHRONE → renvoie un job_id (U2 : forme confirmée au tick suivant).
      const j = await req(ep.ecs, 'POST', `/v1/${pid}/cloudservers`, { body: { server } });
      const jobId = j?.job_id;
      if (!jobId) throw new Error('ECS create: pas de job_id dans la réponse');
      return { jobId };
    },

    async resolveLaunch(handle: LaunchHandle): Promise<string | null> {
      const j = await req(ep.ecs, 'GET', `/v1/${pid}/jobs/${handle.jobId}`);
      const status = j?.status;
      if (status === 'SUCCESS') {
        // server_id remonte dans le sous-job de création.
        const sub = j?.entities?.sub_jobs?.[0];
        const serverId = sub?.entities?.server_id ?? j?.entities?.server_id;
        if (!serverId) throw new Error('Job SUCCESS mais server_id introuvable');
        return serverId;
      }
      if (status === 'FAIL') throw new Error(`Job ECS échoué: ${j?.fail_reason ?? 'raison inconnue'}`);
      return null; // RUNNING / INIT → on retentera au prochain tick
    },

    async describeInstance(serverId: string): Promise<InstanceStatus> {
      const j = await req(ep.ecs, 'GET', `/v1/${pid}/cloudservers/${serverId}`);
      const s = j?.server ?? {};
      let publicIp: string | undefined;
      for (const list of Object.values(s.addresses ?? {}) as any[]) {
        for (const a of list ?? []) {
          if (a['OS-EXT-IPS:type'] === 'floating') publicIp = a.addr;
        }
      }
      return { state: normalizeState(s.status), publicIp, launchTime: utcIso(s['OS-SRV-USG:launched_at']) };
    },

    async terminateInstance(serverId: string): Promise<void> {
      // Détruit la VM + libère l'EIP + supprime le volume racine (FinOps).
      await req(ep.ecs, 'POST', `/v1/${pid}/cloudservers/delete`, {
        body: { servers: [{ id: serverId }], delete_publicip: true, delete_volume: true },
      });
    },

    async startInstance(serverId: string): Promise<void> {
      await req(ep.ecs, 'POST', `/v1/${pid}/cloudservers/action`, { body: { 'os-start': { servers: [{ id: serverId }] } } });
    },
    async stopInstance(serverId: string): Promise<void> {
      await req(ep.ecs, 'POST', `/v1/${pid}/cloudservers/action`, { body: { 'os-stop': { type: 'SOFT', servers: [{ id: serverId }] } } });
    },
    async rebootInstance(serverId: string): Promise<void> {
      await req(ep.ecs, 'POST', `/v1/${pid}/cloudservers/action`, { body: { reboot: { type: 'SOFT', servers: [{ id: serverId }] } } });
    },

    async listManaged(): Promise<Record<string, string>> {
      // Liste détaillée, filtrée côté client par tag (robuste quelle que soit la
      // forme de filtrage serveur — U5). Échelle portail = dizaines de VM.
      const j = await req(ep.ecs, 'GET', `/v1/${pid}/cloudservers/detail`, { query: { limit: 1000 } });
      const out: Record<string, string> = {};
      for (const s of (j?.servers ?? []) as any[]) {
        const tagged = JSON.stringify(s.tags ?? []).includes('managed-by=git-vm-portal') || JSON.stringify(s.tags ?? []).includes('git-vm-portal');
        if (tagged && s.id) out[s.id] = normalizeState(s.status);
      }
      return out;
    },

    // ---- Disque (EVS) & snapshots ----------------------------------------
    async describeRootVolume(serverId: string): Promise<RootVolume> {
      const j = await req(ep.ecs, 'GET', `/v1/${pid}/cloudservers/${serverId}`);
      const s = j?.server ?? {};
      const attached = (s['os-extended-volumes:volumes_attached'] ?? []) as any[];
      const root = attached.find((v) => v.bootIndex === '0' || v.bootIndex === 0 || v.boot_index === 0) ?? attached[0];
      const volumeId = root?.id;
      let sizeGb: number | undefined;
      if (volumeId) {
        try {
          const v = await req(ep.evs, 'GET', `/v2/${pid}/cloudvolumes/${volumeId}`);
          sizeGb = v?.volume?.size;
        } catch { /* best effort */ }
      }
      // Architecture x86_64 par défaut (Huawei EU : flavors x86 ; ARM = kunpeng explicite).
      return { volumeId, rootDevice: root?.device ?? '/dev/vda', architecture: 'x86_64', sizeGb };
    },

    async createSnapshot(volumeId: string, description: string): Promise<string> {
      const j = await req(ep.evs, 'POST', `/v2/${pid}/cloudsnapshots`, {
        body: { snapshot: { volume_id: volumeId, name: `gitvm-${Date.now()}`, description: description.slice(0, 255), force: true } },
      });
      const id = j?.snapshot?.id;
      if (!id) throw new Error('EVS snapshot: pas d\'id');
      return id;
    },

    async describeSnapshot(snapshotId: string): Promise<SnapshotState> {
      const j = await req(ep.evs, 'GET', `/v2/${pid}/cloudsnapshots/${snapshotId}`);
      const st = j?.snapshot?.status; // available | creating | error | deleting
      const state = st === 'available' ? 'completed' : st === 'error' || st === 'error_deleting' ? 'error' : 'pending';
      return { state, sizeGb: j?.snapshot?.size };
    },

    async deleteSnapshot(snapshotId: string): Promise<void> {
      await req(ep.evs, 'DELETE', `/v2/${pid}/cloudsnapshots/${snapshotId}`).catch(() => {});
    },

    // Restauration EN PLACE : rollback du snapshot sur son volume source (VM stoppée
    // → volume non monté). Asynchrone côté Huawei (volume passe en 'rollbacking' →
    // 'available') ; le suivi se fait via le statut du volume. Droits EVS uniquement.
    async rollbackSnapshot(snapshotId: string, volumeId: string): Promise<void> {
      await req(ep.evs, 'POST', `/v2/${pid}/cloudsnapshots/${snapshotId}/rollback`, {
        body: { rollback: { volume_id: volumeId } },
      });
    },

    // ---- Restauration (IMS) ----------------------------------------------
    // U6 : le chemin « snapshot → image relançable » diffère d'AWS (pas de
    // RegisterImage direct depuis un snapshot EVS). Approche Huawei : créer un
    // volume depuis le snapshot, puis une image système IMS depuis ce volume.
    // À valider en live avant activation de la restauration.
    async registerImageFromSnapshot(name: string, snapshotId: string, _rootDevice: string, _architecture: string): Promise<string> {
      // 1) Volume depuis le snapshot.
      const cv = await req(ep.evs, 'POST', `/v2/${pid}/cloudvolumes`, {
        body: { volume: { snapshot_id: snapshotId, volume_type: 'GPSSD', name: `gitvm-restore-${Date.now()}` } },
      });
      const volumeId = cv?.volume?.id ?? cv?.id;
      if (!volumeId) throw new Error('Restore: création du volume depuis snapshot échouée');
      // 2) Image système IMS depuis le volume (action asynchrone → job/image_id).
      const im = await req(ep.ims, 'POST', `/v2/cloudimages/action`, {
        body: { name: name.slice(0, 64), volume_id: volumeId, os_version: 'Other Linux(64 bit)' },
      });
      const imageId = im?.image_id ?? im?.id;
      if (!imageId) throw new Error('Restore: création image IMS échouée (U6 — à valider)');
      return imageId;
    },

    // ---- Restauration async (EVS volume → IMS image → launch normal) -----
    // Piloté par le réconciliateur (chaque create → job_id ; resolveJob résout job → id).
    // ⚠️ U6 : forme exacte des réponses EVS/IMS à confirmer en live ; isolé ici.
    async createVolumeFromSnapshot(snapshotId: string, availabilityZone: string): Promise<string> {
      // EVS exige `size` (≥ taille du snapshot) même pour une création depuis snapshot,
      // sinon « 400: invalid volume size! » (confirmé en live). On lit la taille du snapshot.
      const s = await req(ep.evs, 'GET', `/v2/${pid}/cloudsnapshots/${snapshotId}`);
      const size = s?.snapshot?.size;
      if (!size) throw new Error('EVS create-volume: taille du snapshot introuvable');
      const j = await req(ep.evs, 'POST', `/v2/${pid}/cloudvolumes`, {
        body: { volume: { snapshot_id: snapshotId, volume_type: 'GPSSD', availability_zone: availabilityZone, size, name: `gitvm-restore-vol-${Date.now()}` } },
      });
      const jobId = j?.job_id;
      if (!jobId) throw new Error('EVS create-volume: pas de job_id');
      return jobId;
    },

    async createImageFromVolume(name: string, volumeId: string, osVersion: string): Promise<string> {
      const j = await req(ep.ims, 'POST', `/v2/cloudimages/action`, {
        body: { name: name.slice(0, 64), volume_id: volumeId, os_version: osVersion },
      });
      const jobId = j?.job_id;
      if (!jobId) throw new Error('IMS create-image: pas de job_id');
      return jobId;
    },

    async deleteVolume(volumeId: string): Promise<void> {
      await req(ep.evs, 'DELETE', `/v2/${pid}/cloudvolumes/${volumeId}`).catch(() => {});
    },

    async deleteImage(imageId: string): Promise<void> {
      await req(ep.ims, 'DELETE', `/v2/cloudimages/${imageId}`).catch(() => {});
    },

    async resolveJob(jobId: string, service: 'evs' | 'ims'): Promise<string | null> {
      const host = service === 'evs' ? ep.evs : ep.ims;
      const j = await req(host, 'GET', `/v1/${pid}/jobs/${jobId}`);
      const status = j?.status;
      if (status === 'SUCCESS') {
        const ent = j?.entities ?? {};
        const sub = ent?.sub_jobs?.[0]?.entities ?? {};
        const id = service === 'evs' ? (ent.volume_id ?? sub.volume_id) : (ent.image_id ?? sub.image_id);
        if (!id) throw new Error(`Job ${service} SUCCESS mais id introuvable`);
        return id;
      }
      if (status === 'FAIL') throw new Error(`Job ${service} échoué: ${j?.fail_reason ?? 'raison inconnue'}`);
      return null; // RUNNING / INIT
    },

    // ---- Métriques (Cloud Eye / CES) -------------------------------------
    async maxCpuOverWindow(serverId: string, minutes: number): Promise<CpuStat | null> {
      const to = Date.now();
      const from = to - minutes * 60_000;
      const j = await req(ep.ces, 'GET', `/V1.0/${pid}/metric-data`, {
        query: {
          namespace: 'SYS.ECS',
          metric_name: 'cpu_util',
          'dim.0': `instance_id,${serverId}`,
          from,
          to,
          period: 300,
          filter: 'max',
        },
      });
      const pts = (j?.datapoints ?? []) as any[];
      const vals = pts.map((d) => Number(d.max)).filter((n) => !isNaN(n));
      if (!vals.length) return null;
      return { max: Math.max(...vals), datapoints: vals.length };
    },
  };
}
