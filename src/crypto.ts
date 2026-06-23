// Stateless signed tokens (sessions + OIDC state) using HMAC-SHA256.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

// Constant-time-ish compare
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(secret: string, payload: object, ttlSeconds: number): Promise<string> {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64urlEncode(enc.encode(JSON.stringify(body)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyToken<T = any>(secret: string, token: string | undefined): Promise<T | null> {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const key = await hmacKey(secret);
  const expected = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const body = JSON.parse(dec.decode(b64urlDecode(data)));
    if (typeof body.exp === 'number' && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body as T;
  } catch {
    return null;
  }
}

// Stateless callback token for the course-install cloud-init script: the VM posts
// it back when done. Verifiable without storage by recomputing.
export async function courseCallbackToken(secret: string, id: number): Promise<string> {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`course:${id}`)));
  return b64urlEncode(sig).slice(0, 24);
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

// ---- AES-GCM at-rest encryption (for stored SSH private keys) ----------
async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64urlEncode(out);
}

export async function decryptSecret(secret: string, packed: string): Promise<string> {
  const raw = b64urlDecode(packed);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const key = await aesKey(secret);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

// Decode a JWT payload WITHOUT signature verification.
// Safe here: the id_token is fetched server-to-server directly from Microsoft's
// token endpoint over TLS in the authorization-code flow (never via the browser),
// so channel authenticity is guaranteed. We still validate iss/aud/tid/exp/nonce.
export function decodeJwtPayload(jwt: string): any | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch {
    return null;
  }
}
