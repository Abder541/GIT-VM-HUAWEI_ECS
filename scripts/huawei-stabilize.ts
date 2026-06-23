// scripts/huawei-stabilize.ts
//
// Validation de STABILISATION de la VM réelle #1, via l'API DÉPLOYÉE (chaîne complète
// UI→API→provider→réconciliateur→D1). Signe une session admin avec SESSION_SECRET
// (autorisé : système + secret du propriétaire, pour validation).
//
//   $env:SESSION_SECRET="..."; npx tsx scripts/huawei-stabilize.ts
//
// Phases : (0) garde admin  (1) SSH  (2) stop→start  (3) terminate.

import { signToken } from '../src/crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://git-vm-portal-huawei.thomas-prudhomme.workers.dev';
const REQ = 1;
const IP = '101.46.143.236';
const SS = process.env.SESSION_SECRET;
if (!SS) { console.error('✗ SESSION_SECRET manquant'); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mint(role: 'admin' | 'member') {
  return `sess=${await signToken(SS!, { email: 'abderahmane.chaouche@satom.ch', name: 'Stabilize', role }, 3600)}`;
}
const call = (cookie: string, p: string, method = 'GET') => fetch(BASE + p, { method, headers: { Cookie: cookie } });

async function main() {
  const admin = await mint('admin');
  const member = await mint('member');

  // --- Phase 0 : garde admin (un membre ne peut ni lister l'admin ni valider) ---
  console.log('=== [0] GARDE ADMIN (un non-admin ne peut PAS provisionner) ===');
  const g1 = await call(member, '/api/admin/requests');
  const g2 = await call(member, `/api/admin/requests/${REQ}/approve`, 'POST');
  console.log(`   GET  /api/admin/requests            (membre) → ${g1.status}  ${g1.status === 403 ? '✓ refusé' : '✗ ATTENDU 403'}`);
  console.log(`   POST /api/admin/requests/${REQ}/approve (membre) → ${g2.status}  ${g2.status === 403 ? '✓ refusé' : '✗ ATTENDU 403'}`);

  // détail VM
  const det: any = await (await call(admin, `/api/requests/${REQ}`)).json();
  const r = det.request;
  console.log(`\nVM #${REQ}: status=${r?.status} ssh_user=${r?.ssh_user} server=${r?.server_id} ip=${r?.public_ip}`);

  // --- Phase 1 : SSH ---
  console.log('\n=== [1] SSH (téléchargement clé + whoami) ===');
  try {
    const keyRes = await call(admin, `/api/requests/${REQ}/key`);
    if (!keyRes.ok) throw new Error('GET key → ' + keyRes.status);
    const pem = await keyRes.text();
    const pemPath = join(tmpdir(), 'gitvm-stab.pem');
    writeFileSync(pemPath, pem);
    try { execFileSync('icacls', [pemPath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], { stdio: 'ignore' }); } catch {}
    const user = r?.ssh_user || 'root';
    const out = execFileSync('ssh', ['-i', pemPath, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=NUL', '-o', 'ConnectTimeout=20', `${user}@${IP}`, 'whoami; hostname; head -1 /etc/os-release 2>/dev/null'], { encoding: 'utf8', timeout: 45000 });
    console.log(`   ✓ SSH OK (user=${user}) :`);
    out.trim().split('\n').forEach((l) => console.log('     ' + l));
    rmSync(pemPath, { force: true });
  } catch (e: any) {
    console.error('   ✗ SSH échec : ' + String(e.stderr || e.message || e).split('\n').slice(0, 4).join(' | '));
  }

  // --- Phase 2 : stop → start ---
  console.log('\n=== [2] STOP → START ===');
  await call(admin, `/api/requests/${REQ}/stop`, 'POST');
  await pollLive(admin, 'stopped', 40);
  await call(admin, `/api/requests/${REQ}/start`, 'POST');
  await pollLive(admin, 'running', 40);

  // --- Phase 3 : terminate ---
  console.log('\n=== [3] TERMINATE (libère VM + EIP + volume) ===');
  await call(admin, `/api/requests/${REQ}/terminate`, 'POST');
  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const d: any = await (await call(admin, `/api/requests/${REQ}`)).json();
    const st = d.request?.status;
    process.stdout.write(`   …request.status=${st}\n`);
    if (st === 'terminated') break;
  }
  console.log('\n✓ Stabilisation pilotée terminée. Lance le scan d\'orphelins (huawei-discover.mjs).');
}

async function pollLive(cookie: string, target: string, tries: number) {
  for (let i = 0; i < tries; i++) {
    await sleep(5000);
    const l: any = await (await call(cookie, `/api/requests/${REQ}/live`)).json().catch(() => ({}));
    process.stdout.write(`   …live.state=${l.state ?? '?'}\n`);
    if (l.state === target) { console.log(`   ✓ ${target}`); return; }
  }
  console.log(`   ⚠ ${target} non atteint dans le délai (vérifier manuellement)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
