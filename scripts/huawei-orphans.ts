// scripts/huawei-orphans.ts
//
// Scan d'orphelins (garde-fou FinOps) via le signer de PRODUCTION (huawei-sign) :
// serveurs gérés, EIP non liées, volumes EVS non attachés, snapshots EVS.
// Après une suppression propre, tout doit être à 0.
//
//   $env:HUAWEI_ACCESS_KEY="..."; $env:HUAWEI_SECRET_KEY="..."; npx tsx scripts/huawei-orphans.ts

import { signedFetch } from '../src/huawei-sign';

const REGION = 'eu-west-101';
const SITE = 'myhuaweicloud.eu';
const PID = '85a8db076e4e4e25aa2eeac9e3eb96e0';
const AK = process.env.HUAWEI_ACCESS_KEY;
const SK = process.env.HUAWEI_SECRET_KEY;
if (!AK || !SK) { console.error('✗ HUAWEI_ACCESS_KEY/SECRET_KEY manquants'); process.exit(1); }

async function get(host: string, path: string, query?: Record<string, string>) {
  const res = await signedFetch({ method: 'GET', host, path, query, ak: AK!, sk: SK! });
  const t = await res.text();
  let j: any; try { j = JSON.parse(t); } catch { /* */ }
  return { ok: res.ok, status: res.status, j, t };
}

async function main() {
  const ecs = `ecs.${REGION}.${SITE}`, vpc = `vpc.${REGION}.${SITE}`, evs = `evs.${REGION}.${SITE}`;
  let clean = true;

  const srv = await get(ecs, `/v1/${PID}/cloudservers/detail`, { limit: '100' });
  const managed = (srv.j?.servers ?? []).filter((s: any) => JSON.stringify(s.tags ?? []).includes('git-vm-portal'));
  console.log(`Serveurs gérés (tag git-vm-portal) : ${managed.length}` + (managed.length ? ' ✗' : ' ✓'));
  if (managed.length) clean = false;

  const eip = await get(vpc, `/v1/${PID}/publicips`);
  const ips = eip.j?.publicips ?? [];
  const down = ips.filter((p: any) => p.status === 'DOWN');
  console.log(`EIP : ${ips.length} total · ${down.length} non liée(s)` + (ips.length ? ' ✗' : ' ✓'));
  if (ips.length) clean = false;

  const vol = await get(evs, `/v2/${PID}/cloudvolumes`, { limit: '100' });
  if (vol.ok) {
    const vols = vol.j?.volumes ?? [];
    const unatt = vols.filter((v: any) => (v.attachments ?? []).length === 0);
    console.log(`Volumes EVS : ${vols.length} total · ${unatt.length} non attaché(s)` + (unatt.length ? ' ✗ ' + unatt.map((v: any) => `${v.id}:${v.status}`).join(',') : ' ✓'));
    if (unatt.length) clean = false;
  } else console.log(`Volumes EVS : HTTP ${vol.status} ${vol.t.slice(0, 120)}`);

  const snap = await get(evs, `/v2/${PID}/cloudsnapshots/detail`, { limit: '100' });
  if (snap.ok) {
    const snaps = (snap.j?.snapshots ?? []).filter((s: any) => /gitvm/.test(JSON.stringify(s)));
    console.log(`Snapshots EVS (gitvm) : ${snaps.length}` + (snaps.length ? ' ✗' : ' ✓'));
    if (snaps.length) clean = false;
  } else console.log(`Snapshots EVS : HTTP ${snap.status}`);

  console.log(clean ? '\n✅ AUCUN orphelin facturé.' : '\n⚠️  Orphelins détectés (voir ci-dessus).');
}

main().catch((e) => { console.error(e); process.exit(1); });
