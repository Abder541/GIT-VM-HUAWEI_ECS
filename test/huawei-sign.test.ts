import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  hmacSha256Hex,
  sdkDate,
  canonicalUri,
  canonicalQueryString,
  buildCanonicalRequest,
  signRequest,
} from '../src/huawei-sign';

describe('primitives crypto', () => {
  it('sha256 de la chaîne vide', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('sha256 d\'une valeur connue', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hmac-sha256 est déterministe et en hex 64', async () => {
    const a = await hmacSha256Hex('sk-secret', 'message');
    const b = await hmacSha256Hex('sk-secret', 'message');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacSha256Hex('autre', 'message')).not.toBe(a);
  });
});

describe('formatage', () => {
  it('sdkDate au format YYYYMMDDTHHMMSSZ (UTC)', () => {
    expect(sdkDate(new Date(Date.UTC(2026, 5, 23, 12, 55, 40)))).toBe('20260623T125540Z');
  });
  it('canonicalUri se termine toujours par /', () => {
    expect(canonicalUri('/v3/projects')).toBe('/v3/projects/');
    expect(canonicalUri('/v3/projects/')).toBe('/v3/projects/');
    expect(canonicalUri('/')).toBe('/');
  });
  it('canonicalQueryString trie et encode', () => {
    expect(canonicalQueryString({ name: 'eu-west-101' })).toBe('name=eu-west-101');
    expect(canonicalQueryString({ b: '2', a: '1' })).toBe('a=1&b=2');
    expect(canonicalQueryString({ a: undefined, b: '' , c: 'x' })).toBe('c=x');
  });
});

describe('canonical request (vecteur validé en live contre Huawei EU)', () => {
  it('reproduit exactement la CanonicalRequest GET /v3/projects', async () => {
    const lower = { host: 'iam.myhuaweicloud.eu', 'x-sdk-date': '20260623T125540Z' };
    const { canonicalRequest, signedHeaders } = await buildCanonicalRequest(
      { method: 'GET', host: 'iam.myhuaweicloud.eu', path: '/v3/projects', query: { name: 'eu-west-101' }, body: '' },
      lower
    );
    expect(signedHeaders).toBe('host;x-sdk-date');
    expect(canonicalRequest).toBe(
      [
        'GET',
        '/v3/projects/',
        'name=eu-west-101',
        'host:iam.myhuaweicloud.eu',
        'x-sdk-date:20260623T125540Z',
        '',
        'host;x-sdk-date',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n')
    );
  });
});

describe('signRequest', () => {
  it('produit un en-tête Authorization bien formé et une URL', async () => {
    const { url, headers } = await signRequest({
      method: 'GET',
      host: 'iam.myhuaweicloud.eu',
      path: '/v3/projects',
      query: { name: 'eu-west-101' },
      ak: 'AKTEST',
      sk: 'SKTEST',
      date: new Date(Date.UTC(2026, 5, 23, 12, 55, 40)),
    });
    expect(url).toBe('https://iam.myhuaweicloud.eu/v3/projects?name=eu-west-101');
    expect(headers['X-Sdk-Date']).toBe('20260623T125540Z');
    expect(headers.Authorization).toMatch(
      /^SDK-HMAC-SHA256 Access=AKTEST, SignedHeaders=host;x-sdk-date, Signature=[0-9a-f]{64}$/
    );
    expect(headers.Host).toBeUndefined(); // Host est posé par fetch, jamais émis manuellement
  });
});
