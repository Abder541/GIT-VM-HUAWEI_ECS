import type { Env, SessionUser } from './types';
import { decodeJwtPayload } from './crypto';

// Microsoft Entra ID (Azure AD) v2.0 OIDC — authorization code flow.

export function authorizeUrl(env: Env, redirectUri: string, state: string, nonce: string): string {
  const p = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
  });
  return `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/authorize?${p}`;
}

interface TokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(env: Env, code: string, redirectUri: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      client_secret: env.ENTRA_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: 'openid profile email',
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.id_token) {
    throw new Error(`token exchange failed: ${json.error ?? res.status} ${json.error_description ?? ''}`);
  }
  return json.id_token;
}

// Validate claims and return the resolved user (email + name). Throws on invalid.
export function userFromIdToken(env: Env, idToken: string, expectedNonce: string): Omit<SessionUser, 'role'> {
  const claims = decodeJwtPayload(idToken);
  if (!claims) throw new Error('invalid id_token');

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now) throw new Error('id_token expired');
  if (claims.aud !== env.ENTRA_CLIENT_ID) throw new Error('id_token aud mismatch');
  if (claims.tid !== env.ENTRA_TENANT_ID) throw new Error('id_token tenant mismatch');
  if (claims.nonce !== expectedNonce) throw new Error('nonce mismatch');

  const email: string = (claims.email || claims.preferred_username || '').toLowerCase();
  if (!email) throw new Error('no email claim');

  const domains = env.ALLOWED_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length && !domains.some((d) => email.endsWith('@' + d))) {
    throw new Error(`email domain not allowed: ${email}`);
  }

  return { email, name: claims.name || email };
}
