// scripts/huawei-restore-test.ts
//
// TEST ISOLÉ du pipeline de restauration EVS → IMS → ECS, EN DIRECT via le provider
// (src/huawei.ts), contre Huawei réel. But : valider l'inconnue U6 (formes des réponses
// EVS/IMS, et surtout si l'image IMS produite est BOOTABLE) SANS dépendre du réconciliateur
// ni d'un déploiement. Crée 1 VM source → snapshot → pipeline restore → vérifie le boot →
// PUIS NETTOIE TOUT (try/finally). Coût ≈ quelques centimes.
//
//   $env:HUAWEI_ACCESS_KEY="…"; $env:HUAWEI_SECRET_KEY="…"; npx tsx scripts/huawei-restore-test.ts

import { huawei } from '../src/huawei';
import { signedFetch } from '../src/huawei-sign';
import type { Env } from '../src/types';

const REGION = 'eu-west-101', SITE = 'myhuaweicloud.eu', PID = '85a8db076e4e4e25aa2eeac9e3eb96e0';
const UBUNTU = '188483c4-c66a-4559-83e6-e7f6591cdab0', FLAVOR = 's6.medium.2';
const AK = process.env.HUAWEI_ACCESS_KEY, SK = process.env.HUAWEI_SECRET_KEY;
if (!AK || !SK) { console.error('✗ AK/SK manquants'); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = {
  HUAWEI_REGION: REGION, HUAWEI_ENDPOINT_SUFFIX: SITE, HUAWEI_PROJECT_ID: PID,
  HUAWEI_VPC_ID: '3f8f8a3c-b1bf-495e-b91f-c74cbca7137a',
  HUAWEI_SUBNET_ID: '62c8cbf4-5299-4e66-a4d1-c5e77bbf2541',
  HUAWEI_SECGROUP_ID: '9880c9be-136f-4cf8-8219-3eff57605684',
  HUAWEI_EIP_BANDWIDTH: '5', HUAWEI_ACCESS_KEY: AK, HUAWEI_SECRET_KEY: SK,
} as unknown as Env;

async function discoverAZ(): Promise<string> {
  const res = await signedFetch({ method: 'GET', host: `ecs.${REGION}.${SITE}`, path: `/v2.1/${PID}/os-availability-zone`, ak: AK!, sk: SK! });
  const j: any = await res.json().catch(() => ({}));
  return (j?.availabilityZoneInfo ?? []).find((a: any) => a?.zoneState?.available)?.zoneName ?? 'eu-west-101a';
}
async function pollLaunch(c: any, handle: any, label: string, tries = 30): Promise<string> {
  for (let i = 0; i < tries; i++) { await sleep(8000); const id = await c.resolveLaunch(handle); if (id) { console.log(`   ✓ ${label}=${id}`); return id; } process.stdout.write(`   …${label} (${i + 1})\n`); }
  throw new Error(`${label}: timeout`);
}
async function pollJob(c: any, jobId: string, service: 'evs' | 'ims', label: string, tries = 40): Promise<string> {
  for (let i = 0; i < tries; i++) { await sleep(8000); const id = await c.resolveJob(jobId, service); if (id) { console.log(`   ✓ ${label}=${id}`); return id; } process.stdout.write(`   …${label} (${i + 1})\n`); }
  throw new Error(`${label}: timeout`);
}
async function pollSnapshot(c: any, snapId: string, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) { await sleep(8000); const s = await c.describeSnapshot(snapId); if (s.state === 'completed') { console.log('   ✓ snapshot completed'); return; } if (s.state === 'error') throw new Error('snapshot error'); process.stdout.write(`   …snapshot ${s.state} (${i + 1})\n`); }
  throw new Error('snapshot: timeout');
}

async function main() {
  const c = huawei(env);
  const az = await discoverAZ();
  (env as any).HUAWEI_AZ = az;
  console.log(`AZ découverte = ${az}`);

  let key1: string | null = null, srv1: string | null = null, snapId: string | null = null;
  let volId: string | null = null, imgId: string | null = null, key2: string | null = null, srv2: string | null = null;

  try {
    console.log('\n[1] VM source (dans l\'AZ choisie)…');
    const kp1 = await c.createKeyPair(999002, 'rsa'); key1 = kp1.keyName;
    const h1 = await c.launchInstance({ requestId: 999002, keyName: kp1.keyName, flavor: FLAVOR, imageId: UBUNTU, sizeGb: 40, nameTag: 'gitvm-restore-src' });
    srv1 = await pollLaunch(c, h1, 'srv1');

    console.log('\n[2] snapshot du volume racine…');
    const rv = await c.describeRootVolume(srv1); if (!rv.volumeId) throw new Error('pas de volume racine');
    snapId = await c.createSnapshot(rv.volumeId, 'restore-test'); console.log(`   snapshotId=${snapId}`);
    await pollSnapshot(c, snapId);

    console.log('\n[3] PIPELINE RESTORE (cœur du test, U6) : volume → image → launch');
    const volJob = await c.createVolumeFromSnapshot(snapId, az); console.log(`   volJob=${volJob}`);
    volId = await pollJob(c, volJob, 'evs', 'volumeId');
    const imgJob = await c.createImageFromVolume('gitvm-restore-test', volId, 'Ubuntu'); console.log(`   imgJob=${imgJob}`);
    imgId = await pollJob(c, imgJob, 'ims', 'imageId');
    console.log('   🗑️ suppression du volume transitoire (anti-orphelin)…'); await c.deleteVolume(volId); volId = null;
    const kp2 = await c.createKeyPair(999003, 'rsa'); key2 = kp2.keyName;
    const h2 = await c.launchInstance({ requestId: 999003, keyName: kp2.keyName, flavor: FLAVOR, imageId: imgId, sizeGb: 40, nameTag: 'gitvm-restore-dst' });
    srv2 = await pollLaunch(c, h2, 'srv2 (VM restaurée)');

    const st = await c.describeInstance(srv2);
    console.log(`\n[4] VM restaurée : état=${st.state} ip=${st.publicIp ?? '—'}`);
    console.log(st.state === 'running' && st.publicIp
      ? '   ✅ La VM restaurée a DÉMARRÉ → image IMS bootable CONFIRMÉE (U6 levée).'
      : '   ⚠️ VM restaurée pas encore running — image peut-être non bootable, à analyser.');
  } finally {
    console.log('\n[5] NETTOYAGE (ordre : VM restaurée → image → volume → VM source → snapshot → clés)…');
    if (srv2) { try { await c.terminateInstance(srv2); console.log('   ✓ terminate VM restaurée'); } catch (e: any) { console.error('   ✗ ' + e.message); } }
    if (imgId) { try { await c.deleteImage(imgId); console.log('   ✓ deleteImage'); } catch (e: any) { console.error('   ✗ ' + e.message); } }
    if (volId) { try { await c.deleteVolume(volId); console.log('   ✓ deleteVolume (résiduel)'); } catch (e: any) { console.error('   ✗ ' + e.message); } }
    if (srv1) { try { await c.terminateInstance(srv1); console.log('   ✓ terminate VM source'); } catch (e: any) { console.error('   ✗ ' + e.message); } }
    if (snapId) { try { await c.deleteSnapshot(snapId); console.log('   ✓ deleteSnapshot'); } catch (e: any) { console.error('   ✗ ' + e.message); } }
    if (key1) { try { await c.deleteKeyPair(key1); } catch { /* */ } }
    if (key2) { try { await c.deleteKeyPair(key2); } catch { /* */ } }
    console.log('   → lancer ensuite scripts/huawei-orphans.ts pour confirmer 0 orphelin.');
  }
}
main().catch((e) => { console.error('\n✗ ' + (e?.stack || e)); process.exit(1); });
