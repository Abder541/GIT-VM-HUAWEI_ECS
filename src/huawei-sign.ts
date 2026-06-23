// src/huawei-sign.ts — Signature AK/SK Huawei « SDK-HMAC-SHA256 » (WebCrypto)
//
// Équivalent d'`aws4fetch` côté Huawei, en ~100 lignes, zéro dépendance. L'algorithme
// est **validé en live** contre l'API Huawei EU (cf. `scripts/huawei-discover.mjs`).
//
// Plus simple que SigV4 : la clé HMAC est le **SK directement** (pas de dérivation
// date/région/service). Étapes (doc Huawei « AK/SK Signing and Authentication ») :
//   1. CanonicalRequest = method \n uri \n query \n headers \n signedHeaders \n sha256(body)
//   2. StringToSign     = "SDK-HMAC-SHA256" \n X-Sdk-Date \n sha256(CanonicalRequest)
//   3. Signature        = hex(HMAC-SHA256(SK, StringToSign))
//   4. Authorization    = "SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=<…>, Signature=<…>"

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

export async function hmacSha256Hex(keyStr: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

/** Horodatage UTC au format Huawei : `YYYYMMDDTHHMMSSZ`. */
export function sdkDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// Encodage RFC3986 (identique au `quote(safe='~')` de la doc Huawei).
function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Chemin canonique : chaque segment encodé, terminé TOUJOURS par `/`. */
export function canonicalUri(path: string): string {
  let p = path.split('/').map(uriEncode).join('/');
  if (!p.endsWith('/')) p += '/';
  return p;
}

/** Query canonique : clés triées, clés/valeurs URL-encodées, `k=v` jointes par `&`. */
export function canonicalQueryString(query: Record<string, string | number | undefined>): string {
  return Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== '')
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(String(query[k]))}`)
    .join('&');
}

export interface SignInput {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  /** En-têtes additionnels à signer (ex. `Content-Type`). `host`/`x-sdk-date` ajoutés d'office. */
  headers?: Record<string, string>;
  body?: string;
  ak: string;
  sk: string;
  date?: Date;
}

/** Construit la CanonicalRequest (exposé pour les tests). */
export async function buildCanonicalRequest(
  i: Pick<SignInput, 'method' | 'host' | 'path' | 'query' | 'body'>,
  lowerHeaders: Record<string, string>
): Promise<{ canonicalRequest: string; signedHeaders: string }> {
  const names = Object.keys(lowerHeaders).sort();
  const canonicalHeaders = names.map((k) => `${k}:${lowerHeaders[k].trim()}`).join('\n') + '\n';
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    i.method.toUpperCase(),
    canonicalUri(i.path),
    canonicalQueryString(i.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(i.body ?? ''),
  ].join('\n');
  return { canonicalRequest, signedHeaders };
}

export interface SignedRequest {
  url: string;
  /** En-têtes à envoyer (X-Sdk-Date, Authorization, + ceux fournis). `Host` est exclu (posé par fetch). */
  headers: Record<string, string>;
}

/** Signe une requête et renvoie l'URL + les en-têtes prêts pour `fetch`. */
export async function signRequest(i: SignInput): Promise<SignedRequest> {
  const xSdkDate = sdkDate(i.date);
  const lower: Record<string, string> = { host: i.host, 'x-sdk-date': xSdkDate };
  for (const [k, v] of Object.entries(i.headers ?? {})) lower[k.toLowerCase()] = v;

  const { canonicalRequest, signedHeaders } = await buildCanonicalRequest(i, lower);
  const stringToSign = ['SDK-HMAC-SHA256', xSdkDate, await sha256Hex(canonicalRequest)].join('\n');
  const signature = await hmacSha256Hex(i.sk, stringToSign);
  const authorization = `SDK-HMAC-SHA256 Access=${i.ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const qs = canonicalQueryString(i.query ?? {});
  const url = `https://${i.host}${i.path}${qs ? '?' + qs : ''}`;

  // En-têtes à émettre : tout sauf `host` (fetch le pose), + X-Sdk-Date + Authorization.
  const sendHeaders: Record<string, string> = { 'X-Sdk-Date': xSdkDate, Authorization: authorization };
  for (const [k, v] of Object.entries(i.headers ?? {})) sendHeaders[k] = v;
  return { url, headers: sendHeaders };
}

/** Helper : signe puis exécute le `fetch`. Utilisé par `src/huawei.ts`. */
export async function signedFetch(i: SignInput): Promise<Response> {
  const { url, headers } = await signRequest(i);
  return fetch(url, { method: i.method, headers, body: i.body || undefined });
}
