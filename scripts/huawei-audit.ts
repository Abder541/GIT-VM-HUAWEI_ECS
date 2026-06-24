// scripts/huawei-audit.ts — INSPECTION de l'état RÉEL des ressources Huawei (lecture seule).
// Réseau (VPC/subnet/SG + règles), charge (serveurs/EIP/EVS/snapshots), clés KPS.
//   $env:HUAWEI_ACCESS_KEY="..."; $env:HUAWEI_SECRET_KEY="..."; npx tsx scripts/huawei-audit.ts

import { signedFetch } from '../src/huawei-sign';

const REGION = 'eu-west-101', SITE = 'myhuaweicloud.eu';
const PID = '85a8db076e4e4e25aa2eeac9e3eb96e0';
const VPC = '3f8f8a3c-b1bf-495e-b91f-c74cbca7137a';
const SUBNET = '62c8cbf4-5299-4e66-a4d1-c5e77bbf2541';
const SG = '9880c9be-136f-4cf8-8219-3eff57605684';
const AK = process.env.HUAWEI_ACCESS_KEY, SK = process.env.HUAWEI_SECRET_KEY;
if (!AK || !SK) { console.error('✗ AK/SK manquants'); process.exit(1); }

const ecs = `ecs.${REGION}.${SITE}`, vpc = `vpc.${REGION}.${SITE}`, evs = `evs.${REGION}.${SITE}`;
async function get(host: string, path: string, query?: Record<string, string>) {
  const res = await signedFetch({ method: 'GET', host, path, query, ak: AK!, sk: SK! });
  const t = await res.text(); let j: any; try { j = JSON.parse(t); } catch {}
  return { ok: res.ok, status: res.status, j, t };
}

async function main() {
  console.log('============ AUDIT HUAWEI (état réel) ============');

  console.log('\n--- RÉSEAU (plateforme) ---');
  const v = await get(vpc, `/v1/${PID}/vpcs/${VPC}`);
  console.log(`VPC ${VPC} : ${v.ok ? `EXISTE (name=${v.j?.vpc?.name}, cidr=${v.j?.vpc?.cidr}, status=${v.j?.vpc?.status})` : 'HTTP ' + v.status}`);
  const sn = await get(vpc, `/v1/${PID}/subnets/${SUBNET}`);
  console.log(`Subnet ${SUBNET} : ${sn.ok ? `EXISTE (name=${sn.j?.subnet?.name}, cidr=${sn.j?.subnet?.cidr}, dns=${JSON.stringify(sn.j?.subnet?.dnsList)})` : 'HTTP ' + sn.status}`);
  const sg = await get(vpc, `/v1/${PID}/security-groups/${SG}`);
  if (sg.ok) {
    const rules = sg.j?.security_group?.security_group_rules ?? [];
    console.log(`Security Group ${SG} : EXISTE (name=${sg.j?.security_group?.name}, ${rules.length} règles)`);
    for (const r of rules) {
      const port = r.port_range_min ? `${r.port_range_min}${r.port_range_max && r.port_range_max !== r.port_range_min ? '-' + r.port_range_max : ''}` : 'all';
      console.log(`   ${r.direction.padEnd(7)} ${(r.ethertype || '').padEnd(4)} ${(r.protocol || 'any').padEnd(4)} port=${String(port).padEnd(9)} remote=${r.remote_ip_prefix ?? r.remote_group_id ?? '-'}`);
    }
    const egressOpen = rules.some((r: any) => r.direction === 'egress' && !r.protocol && (r.remote_ip_prefix === '0.0.0.0/0' || !r.remote_ip_prefix));
    console.log(`   → EGRESS : ${egressOpen ? 'OUVERT (durcissement NON activé)' : 'restreint'}`);
  } else console.log(`Security Group ${SG} : HTTP ${sg.status}`);

  console.log('\n--- CHARGE (créée à la demande) ---');
  const srv = await get(ecs, `/v1/${PID}/cloudservers/detail`, { limit: '100' });
  const servers = srv.j?.servers ?? [];
  const managed = servers.filter((s: any) => JSON.stringify(s.tags ?? []).includes('git-vm-portal'));
  console.log(`Serveurs ECS : ${servers.length} total · ${managed.length} gérés (tag)` + managed.map((s: any) => `\n   - ${s.id} ${s.status} ${s.name}`).join(''));

  const eip = await get(vpc, `/v1/${PID}/publicips`);
  const ips = eip.j?.publicips ?? [];
  console.log(`EIP : ${ips.length} total` + ips.map((p: any) => `\n   - ${p.public_ip_address} ${p.status}`).join(''));

  const vol = await get(evs, `/v2/${PID}/cloudvolumes`, { limit: '100' });
  const vols = vol.ok ? (vol.j?.volumes ?? []) : null;
  console.log(`Volumes EVS : ${vols ? vols.length + ' total · ' + vols.filter((x: any) => (x.attachments ?? []).length === 0).length + ' non attaché(s)' : 'HTTP ' + vol.status}`);

  const snap = await get(evs, `/v2/${PID}/cloudsnapshots`, { limit: '100' });
  console.log(`Snapshots EVS : ${snap.ok ? (snap.j?.snapshots ?? []).length + ' total' : 'HTTP ' + snap.status}`);

  const kp = await get(ecs, `/v2.1/${PID}/os-keypairs`);
  const keys = (kp.j?.keypairs ?? []).map((k: any) => k.keypair?.name).filter((n: string) => /vm-portal-req/.test(n));
  console.log(`Clés KPS (vm-portal-req-*) : ${keys.length}` + (keys.length ? ' → ' + keys.join(', ') : ''));

  console.log('\n--- CATALOGUE (consommé) ---');
  const fl = await get(ecs, `/v1/${PID}/cloudservers/flavors`);
  console.log(`Flavors disponibles : ${fl.ok ? (fl.j?.flavors ?? []).length : 'HTTP ' + fl.status}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
