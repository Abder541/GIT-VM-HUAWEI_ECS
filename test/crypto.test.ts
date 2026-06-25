// Tests unitaires de crypto.ts — module SÉCURITÉ-CRITIQUE (chiffrement at-rest des clés
// SSH / mots de passe Windows, JWT de session HMAC, tokens de callback). Round-trips +
// rejets (falsification, mauvais secret, expiration, malformé). Sans réseau.
import { describe, it, expect } from 'vitest';
import {
  signToken, verifyToken, encryptSecret, decryptSecret,
  randomToken, decodeJwtPayload, courseCallbackToken,
} from '../src/crypto';

const SECRET = 'test-secret-123';
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('signToken / verifyToken (JWT HMAC maison)', () => {
  it('round-trip : un token valide se vérifie et restitue le payload', async () => {
    const tok = await signToken(SECRET, { sub: 'alice', role: 'admin' }, 60);
    const payload = await verifyToken<{ sub: string; role: string; exp: number }>(SECRET, tok);
    expect(payload?.sub).toBe('alice');
    expect(payload?.role).toBe('admin');
    expect(typeof payload?.exp).toBe('number');
  });
  it('rejette une signature falsifiée', async () => {
    const tok = await signToken(SECRET, { sub: 'a' }, 60);
    const tampered = tok.slice(0, -1) + (tok.at(-1) === 'A' ? 'B' : 'A');
    expect(await verifyToken(SECRET, tampered)).toBeNull();
  });
  it('rejette un mauvais secret', async () => {
    const tok = await signToken(SECRET, { sub: 'a' }, 60);
    expect(await verifyToken('autre-secret', tok)).toBeNull();
  });
  it('rejette un token expiré', async () => {
    const tok = await signToken(SECRET, { sub: 'a' }, -10);
    expect(await verifyToken(SECRET, tok)).toBeNull();
  });
  it('rejette undefined / malformé', async () => {
    expect(await verifyToken(SECRET, undefined)).toBeNull();
    expect(await verifyToken(SECRET, 'pasdepoint')).toBeNull();
  });
});

describe('encryptSecret / decryptSecret (AES-GCM at-rest)', () => {
  it('round-trip : decrypt(encrypt(x)) == x', async () => {
    const plain = 'ssh-ed25519 AAAA... clé privée';
    const packed = await encryptSecret(SECRET, plain);
    expect(packed).not.toContain(plain);
    expect(await decryptSecret(SECRET, packed)).toBe(plain);
  });
  it('IV aléatoire : deux chiffrements du même clair diffèrent', async () => {
    expect(await encryptSecret(SECRET, 'x')).not.toBe(await encryptSecret(SECRET, 'x'));
  });
  it('déchiffrement avec mauvais secret échoue (auth GCM)', async () => {
    const packed = await encryptSecret(SECRET, 'secret');
    await expect(decryptSecret('autre-secret', packed)).rejects.toBeDefined();
  });
});

describe('randomToken', () => {
  it('génère des valeurs distinctes et non vides', () => {
    const a = randomToken(), b = randomToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe('courseCallbackToken', () => {
  it('déterministe par (secret,id), différent selon id, longueur 24', async () => {
    const t1 = await courseCallbackToken(SECRET, 1);
    expect(await courseCallbackToken(SECRET, 1)).toBe(t1);
    expect(await courseCallbackToken(SECRET, 2)).not.toBe(t1);
    expect(t1.length).toBe(24);
  });
});

describe('decodeJwtPayload', () => {
  it('décode le payload d\'un JWT bien formé', () => {
    const payload = b64url(JSON.stringify({ sub: 'bob', tid: 't1' }));
    expect(decodeJwtPayload(`header.${payload}.sig`)).toMatchObject({ sub: 'bob', tid: 't1' });
  });
  it('renvoie null si malformé (≠ 3 parties ou payload non-JSON)', () => {
    expect(decodeJwtPayload('deux.parties')).toBeNull();
    expect(decodeJwtPayload(`h.${b64url('pas du json')}.s`)).toBeNull();
  });
});
