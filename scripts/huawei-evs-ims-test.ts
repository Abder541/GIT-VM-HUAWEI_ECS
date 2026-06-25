// scripts/huawei-evs-ims-test.ts
//
// TEST PROVIDER ISOLÉ — EVS + IMS UNIQUEMENT (pas d'ECS, pas de boot VM).
//
// But minimal : valider les FORMATS réels des réponses Huawei async à partir d'un
// snapshot EVS DÉJÀ EXISTANT (fourni via $env:SNAPSHOT_ID) :
//   EVS : createVolumeFromSnapshot → job_id → resolveJob('evs') → volume_id
//   IMS : createImageFromVolume    → job_id → resolveJob('ims') → image_id
// On logge la réponse BRUTE du job à chaque poll. Cleanup simple en finally
// (volume + image créés ici uniquement ; le snapshot fourni n'est pas touché).
//
//   $env:SNAPSHOT_ID="<snapshot_id>"; npx tsx scripts/huawei-evs-ims-test.ts
//   (AK/SK lus depuis l'env, ou à défaut depuis .dev.vars à la racine)
//   Options : $env:HUAWEI_AZ="eu-west-101a"  $env:OS_VERSION="Other Linux(64 bit)"

import { readFileSync } from 'node:fs';
import { huawei } from '../src/huawei';
import { signedFetch } from '../src/huawei-sign';
import type { Env } from '../src/types';

const REGION = process.env.HUAWEI_REGION || 'eu-west-101';
const SITE = process.env.HUAWEI_ENDPOINT_SUFFIX || 'myhuaweicloud.eu';
const PID = process.env.HUAWEI_PROJECT_ID || '85a8db076e4e4e25aa2eeac9e3eb96e0';

// AK/SK : env d'abord, sinon .dev.vars (gitignoré) à la racine du repo.
function devVar(key: string): string | undefined {
  try {
    const txt = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    return txt.split(/\r?\n/).find((l) => l.startsWith(key + '='))?.slice(key.length + 1).trim();
  } catch { return undefined; }
}
const AK = process.env.HUAWEI_ACCESS_KEY || devVar('HUAWEI_ACCESS_KEY');
const SK = process.env.HUAWEI_SECRET_KEY || devVar('HUAWEI_SECRET_KEY');
const SNAPSHOT_ID = process.env.SNAPSHOT_ID;
const AZ = process.env.HUAWEI_AZ || 'eu-west-101a';
const OS_VERSION = process.env.OS_VERSION || 'Other Linux(64 bit)';

if (!AK || !SK) { console.error('✗ AK/SK manquants (env ou .dev.vars).'); process.exit(1); }
if (!SNAPSHOT_ID) { console.error('✗ SNAPSHOT_ID manquant.'); process.exit(1); }

const ep = { evs: `evs.${REGION}.${SITE}`, ims: `ims.${REGION}.${SITE}` };
const env = {
  HUAWEI_REGION: REGION, HUAWEI_ENDPOINT_SUFFIX: SITE, HUAWEI_PROJECT_ID: PID,
  HUAWEI_ACCESS_KEY: AK, HUAWEI_SECRET_KEY: SK,
} as unknown as Env;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Log BRUT de la réponse du job (aucune interprétation).
async function logRawJob(host: string, jobId: string): Promise<void> {
  const res = await signedFetch({ method: 'GET', host, path: `/v1/${PID}/jobs/${jobId}`, ak: AK!, sk: SK! });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  console.log(`   [raw] GET ${host}/v1/${PID}/jobs/${jobId} → HTTP ${res.status}`);
  console.log(json ? JSON.stringify(json, null, 2) : text);
}

async function poll(
  c: ReturnType<typeof huawei>,
  jobId: string,
  service: 'evs' | 'ims',
  host: string,
  label: string,
  tries: number,
): Promise<string> {
  for (let i = 0; i < tries; i++) {
    await sleep(8000);
    await logRawJob(host, jobId);
    const id = await c.resolveJob(jobId, service);
    if (id) { console.log(`   ✓ ${label} = ${id}`); return id; }
    console.log(`   …${label} pas encore prêt (${i + 1}/${tries})`);
  }
  throw new Error(`${label}: timeout`);
}

async function main() {
  console.log(`=== TEST EVS + IMS (snapshot ${SNAPSHOT_ID}, AZ ${AZ}) ===`);
  const c = huawei(env);
  let volId: string | undefined;
  let imgId: string | undefined;

  try {
    console.log('\n[1] EVS createVolumeFromSnapshot…');
    const evsJob = await c.createVolumeFromSnapshot(SNAPSHOT_ID!, AZ);
    console.log(`   job_id EVS = ${evsJob}`);
    volId = await poll(c, evsJob, 'evs', ep.evs, 'volume_id', 30);

    console.log(`\n[2] IMS createImageFromVolume (os_version="${OS_VERSION}")…`);
    const imsJob = await c.createImageFromVolume('gitvm-evs-ims-test', volId, OS_VERSION);
    console.log(`   job_id IMS = ${imsJob}`);
    imgId = await poll(c, imsJob, 'ims', ep.ims, 'image_id', 45);

    console.log(`\n✓ Terminé : volume_id=${volId}  image_id=${imgId}`);
  } finally {
    console.log('\n[3] Nettoyage (image puis volume créés par ce test ; snapshot préservé)…');
    if (imgId) { try { await c.deleteImage(imgId); console.log('   ✓ image supprimée'); } catch (e: any) { console.error('   ✗ deleteImage: ' + e.message); } }
    if (volId) { try { await c.deleteVolume(volId); console.log('   ✓ volume supprimé'); } catch (e: any) { console.error('   ✗ deleteVolume: ' + e.message); } }
  }
}

main().catch((e) => { console.error('\n✗ ' + (e?.stack || e)); process.exit(1); });
