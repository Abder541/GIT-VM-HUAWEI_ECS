// scripts/huawei-discover.mjs
//
// Outil one-off (Node 18+, zéro dépendance) : VALIDE la signature AK/SK
// « SDK-HMAC-SHA256 » contre l'API réelle Huawei et DÉCOUVRE la configuration de la
// région cible — `project_id`, flavors ECS, images IMS. Sert de banc d'essai à
// `src/huawei-sign.ts` (même algorithme) et alimente le catalogue.
//
// Les credentials sont lus depuis l'environnement (jamais en dur, jamais commités) :
//   $env:HUAWEI_ACCESS_KEY="..."; $env:HUAWEI_SECRET_KEY="..."; node scripts/huawei-discover.mjs
//
// Mirroir des helpers `scripts/aws-*.mjs` côté AWS.

const AK = process.env.HUAWEI_ACCESS_KEY;
const SK = process.env.HUAWEI_SECRET_KEY;
const REGION = process.env.HUAWEI_REGION || 'eu-west-101';
// Site Huawei : « myhuaweicloud.eu » (cloud européen, RGPD) vs « myhuaweicloud.com »
// (international). Le compte fourni vit sur le site EU → IAM global = iam.myhuaweicloud.eu.
const SITE = process.env.HUAWEI_SITE || 'myhuaweicloud.eu';

if (!AK || !SK) {
  console.error('✗ HUAWEI_ACCESS_KEY / HUAWEI_SECRET_KEY manquants dans l\'environnement.');
  process.exit(1);
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(data) {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}
async function hmacSha256Hex(keyStr, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// Horodatage UTC au format Huawei : YYYYMMDDTHHMMSSZ
function sdkDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// RFC3986, identique à encodeURIComponent + ! * ' ( ) (Huawei quote safe='~').
function uriEncode(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function canonicalUri(path) {
  let p = path.split('/').map(uriEncode).join('/');
  if (!p.endsWith('/')) p += '/'; // Huawei : la canonical URI se termine TOUJOURS par /
  return p;
}
function canonicalQuery(query) {
  return Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(String(query[k]))}`).join('&');
}

// Signe une requête et renvoie les en-têtes à envoyer (+ traces pour le debug).
async function sign({ method, host, path, query = {}, headers = {}, body = '' }) {
  const xSdkDate = sdkDate();
  const h = { host, 'x-sdk-date': xSdkDate };
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((k) => `${k}:${String(h[k]).trim()}`).join('\n') + '\n';
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(path),
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(body),
  ].join('\n');
  const stringToSign = ['SDK-HMAC-SHA256', xSdkDate, await sha256Hex(canonicalRequest)].join('\n');
  const signature = await hmacSha256Hex(SK, stringToSign);
  const authorization = `SDK-HMAC-SHA256 Access=${AK}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { xSdkDate, authorization, canonicalRequest };
}

async function call({ method = 'GET', host, path, query = {}, body = '' }) {
  const { xSdkDate, authorization, canonicalRequest } = await sign({ method, host, path, query, body });
  const qs = Object.keys(query).length ? '?' + Object.keys(query).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&') : '';
  const url = `https://${host}${path}${qs}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-Sdk-Date': xSdkDate, Authorization: authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body || undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { res, json, text, canonicalRequest, url };
}

async function main() {
  console.log(`→ Région : ${REGION} · AK : ${AK.slice(0, 4)}…${AK.slice(-2)}`);

  // 1) IAM : valider la signature + récupérer le project_id de la région.
  const iamHost = process.env.IAM_HOST || `iam.${SITE}`;
  console.log(`\n[1] IAM ${iamHost} /v3/projects?name=${REGION}`);
  const proj = await call({ host: iamHost, path: '/v3/projects', query: { name: REGION } });
  if (!proj.res.ok) {
    console.error(`✗ IAM ${proj.res.status} : ${proj.text.slice(0, 400)}`);
    console.error('--- CanonicalRequest (debug) ---\n' + proj.canonicalRequest);
    process.exit(2);
  }
  const projects = proj.json?.projects ?? [];
  const project = projects.find((p) => p.name === REGION) ?? projects[0];
  if (!project) { console.error('✗ Aucun projet pour cette région.'); process.exit(2); }
  const projectId = project.id;
  console.log(`✓ Signature VALIDE. project_id = ${projectId} (enabled=${project.enabled})`);

  // 2) ECS : lister les flavors (catalogue perf).
  const ecsHost = `ecs.${REGION}.${SITE}`;
  console.log(`\n[2] ECS ${ecsHost} /v1/${projectId}/cloudservers/flavors`);
  try {
    const fl = await call({ host: ecsHost, path: `/v1/${projectId}/cloudservers/flavors` });
    if (fl.res.ok) {
      const flavors = fl.json?.flavors ?? [];
      const small = flavors
        .filter((f) => /^(s6|s7|c7|c7n|x1|m6)\./.test(f.id) && Number(f.vcpus) <= 4)
        .map((f) => `${f.id} (${f.vcpus}vCPU/${Math.round(Number(f.ram) / 1024)}Go)`);
      console.log(`✓ ${flavors.length} flavors. Candidats petits gabarits :`);
      console.log('  ' + small.slice(0, 25).join('\n  '));
    } else {
      console.error(`✗ ECS flavors ${fl.res.status} : ${fl.text.slice(0, 300)}`);
    }
  } catch (e) { console.error('✗ ECS flavors : ' + e.message); }

  // 3) IMS : images publiques (catalogue OS) — best effort.
  const imsHost = `ims.${REGION}.${SITE}`;
  console.log(`\n[3] IMS ${imsHost} /v2/cloudimages (gold, Ubuntu/Windows)`);
  for (const platform of ['Ubuntu', 'Debian', 'Windows']) {
    try {
      const im = await call({ host: imsHost, path: '/v2/cloudimages', query: { __imagetype: 'gold', __platform: platform, status: 'active', limit: '5' } });
      if (im.res.ok) {
        const imgs = im.json?.images ?? [];
        console.log(`  ${platform}: ${imgs.length} → ` + imgs.slice(0, 3).map((i) => `${i.name} [${i.id}]`).join(' | '));
      } else {
        console.log(`  ${platform}: HTTP ${im.res.status}`);
      }
    } catch (e) { console.log(`  ${platform}: ${e.message}`); }
  }

  // 4) ECS : serveurs gérés (valide le chemin listManaged) — vide attendu au début.
  console.log(`\n[4] ECS ${ecsHost} /v1/${projectId}/cloudservers/detail (filtre tag)`);
  try {
    const sv = await call({ host: ecsHost, path: `/v1/${projectId}/cloudservers/detail`, query: { limit: '50' } });
    if (sv.res.ok) {
      const servers = sv.json?.servers ?? [];
      const managed = servers.filter((s) => JSON.stringify(s.tags ?? []).includes('git-vm-portal'));
      console.log(`✓ ${servers.length} serveur(s) au total, ${managed.length} géré(s) par le portail.`);
    } else {
      console.error(`✗ ECS detail ${sv.res.status} : ${sv.text.slice(0, 200)}`);
    }
  } catch (e) { console.error('✗ ECS detail : ' + e.message); }

  // 5) EIP : détecter les IP publiques orphelines (garde-fou coût FinOps).
  const vpcHost = `vpc.${REGION}.${SITE}`;
  console.log(`\n[5] EIP ${vpcHost} /v1/${projectId}/publicips`);
  try {
    const ip = await call({ host: vpcHost, path: `/v1/${projectId}/publicips` });
    if (ip.res.ok) {
      const ips = ip.json?.publicips ?? [];
      const down = ips.filter((p) => p.status === 'DOWN');
      console.log(`✓ ${ips.length} EIP au total · ${down.length} non liée(s) (orpheline = coût)` + (ips.length ? ' → ' + ips.map((p) => `${p.public_ip_address}:${p.status}`).join(', ') : ''));
    } else { console.error(`✗ EIP ${ip.res.status}: ${ip.text.slice(0, 200)}`); }
  } catch (e) { console.error('✗ EIP: ' + e.message); }

  // 6) EVS snapshots : détecter les snapshots orphelins (garde-fou coût).
  console.log(`\n[6] EVS ${ep_evs(REGION, SITE)} /v2/${projectId}/cloudsnapshots`);
  try {
    const sn = await call({ host: ep_evs(REGION, SITE), path: `/v2/${projectId}/cloudsnapshots`, query: { limit: '50' } });
    if (sn.res.ok) {
      const snaps = (sn.json?.snapshots ?? []).filter((s) => /gitvm|git-vm-portal/.test(JSON.stringify(s)));
      console.log(`✓ ${(sn.json?.snapshots ?? []).length} snapshot(s) au total · ${snaps.length} lié(s) au portail`);
    } else { console.error(`✗ EVS snapshots ${sn.res.status}: ${sn.text.slice(0, 200)}`); }
  } catch (e) { console.error('✗ EVS snapshots: ' + e.message); }

  console.log('\n✓ Découverte terminée.');
}
function ep_evs(region, site) { return `evs.${region}.${site}`; }

main().catch((e) => { console.error('✗ ' + (e?.stack || e)); process.exit(1); });
