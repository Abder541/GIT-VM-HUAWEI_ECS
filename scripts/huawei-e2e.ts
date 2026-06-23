// scripts/huawei-e2e.ts
//
// Test d'intégration RÉEL de la couche fournisseur (`src/huawei.ts`) contre Huawei EU.
// Couvre le cycle de vie complet : clé → VM → résolution job → describe → volume racine
// → snapshot EVS → métrique CES → PUIS destruction de TOUT (snapshot, VM+EIP+volume, clé).
// Coût ≈ quelques centimes. Nettoyage garanti (finally), ordonné (snapshot avant VM).
//
//   $env:HUAWEI_ACCESS_KEY="…"; $env:HUAWEI_SECRET_KEY="…"; npx tsx scripts/huawei-e2e.ts

import { huawei } from '../src/huawei';
import type { Env } from '../src/types';

const env = {
  HUAWEI_REGION: 'eu-west-101',
  HUAWEI_ENDPOINT_SUFFIX: 'myhuaweicloud.eu',
  HUAWEI_PROJECT_ID: '85a8db076e4e4e25aa2eeac9e3eb96e0',
  HUAWEI_VPC_ID: '3f8f8a3c-b1bf-495e-b91f-c74cbca7137a',
  HUAWEI_SUBNET_ID: '62c8cbf4-5299-4e66-a4d1-c5e77bbf2541',
  HUAWEI_SECGROUP_ID: '9880c9be-136f-4cf8-8219-3eff57605684',
  HUAWEI_EIP_BANDWIDTH: '5',
  HUAWEI_ACCESS_KEY: process.env.HUAWEI_ACCESS_KEY,
  HUAWEI_SECRET_KEY: process.env.HUAWEI_SECRET_KEY,
} as unknown as Env;

const UBUNTU_2404 = '188483c4-c66a-4559-83e6-e7f6591cdab0';
const FLAVOR = 's6.medium.2';
const REQ_ID = 999001;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!env.HUAWEI_ACCESS_KEY || !env.HUAWEI_SECRET_KEY) throw new Error('AK/SK manquants dans l\'environnement');
  const c = huawei(env);
  let keyName: string | null = null;
  let serverId: string | null = null;
  let snapshotId: string | null = null;

  try {
    console.log('→ createKeyPair…');
    const kp = await c.createKeyPair(REQ_ID, 'rsa');
    keyName = kp.keyName;
    console.log(`   ✓ ${kp.keyName}`);

    console.log('→ launchInstance…');
    const handle = await c.launchInstance({ requestId: REQ_ID, keyName: kp.keyName, flavor: FLAVOR, imageId: UBUNTU_2404, sizeGb: 40, nameTag: 'gitvm-e2e-test' });
    console.log(`   ✓ job_id=${handle.jobId}`);

    console.log('→ resolveLaunch…');
    for (let i = 0; i < 30 && !serverId; i++) { await sleep(8000); serverId = await c.resolveLaunch(handle); }
    if (!serverId) throw new Error('serverId non résolu (timeout)');
    console.log(`   ✓ serverId=${serverId}`);

    const st = await c.describeInstance(serverId);
    console.log(`→ describeInstance: état=${st.state} ip=${st.publicIp ?? '—'}`);

    console.log('→ describeRootVolume…');
    const rv = await c.describeRootVolume(serverId);
    console.log(`   ✓ volumeId=${rv.volumeId} device=${rv.rootDevice} size=${rv.sizeGb}Go`);
    if (!rv.volumeId) throw new Error('volumeId introuvable');

    console.log('→ createSnapshot (EVS)…');
    snapshotId = await c.createSnapshot(rv.volumeId, 'gitvm e2e snapshot');
    console.log(`   ✓ snapshotId=${snapshotId}`);

    console.log('→ describeSnapshot (poll jusqu\'à completed)…');
    let snapState = 'pending';
    for (let i = 0; i < 30 && snapState !== 'completed' && snapState !== 'error'; i++) {
      await sleep(8000);
      const s = await c.describeSnapshot(snapshotId);
      snapState = s.state;
      process.stdout.write(`   …${i + 1}: ${s.state} (${s.sizeGb ?? '?'}Go)\n`);
    }
    console.log(`   ✓ snapshot: ${snapState}`);

    console.log('→ maxCpuOverWindow (CES)…');
    const cpu = await c.maxCpuOverWindow(serverId, 60);
    console.log(`   ✓ CES: ${cpu ? `max=${cpu.max}% pts=${cpu.datapoints}` : 'null (pas encore de données — attendu sur VM neuve, appel OK)'}`);
  } finally {
    console.log('→ NETTOYAGE (snapshot → VM → clé)…');
    if (snapshotId) {
      try { await c.deleteSnapshot(snapshotId); console.log(`   ✓ deleteSnapshot ${snapshotId}`); await sleep(5000); }
      catch (e: any) { console.error(`   ✗ deleteSnapshot: ${e.message}`); }
    }
    if (serverId) {
      try { await c.terminateInstance(serverId); console.log(`   ✓ terminate ${serverId}`); }
      catch (e: any) { console.error(`   ✗ terminate: ${e.message}`); }
    }
    if (keyName) {
      try { await c.deleteKeyPair(keyName); console.log(`   ✓ deleteKeyPair ${keyName}`); }
      catch (e: any) { console.error(`   ✗ deleteKeyPair: ${e.message}`); }
    }
  }
  console.log('\n✓ E2E terminé.');
}

main().catch((e) => { console.error('\n✗ ' + (e?.stack || e)); process.exit(1); });
