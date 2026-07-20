import * as client from 'openid-client';
import { getSettings } from './settings.js';

let cachedConfig: client.Configuration | null = null;
let cachedKey: string | null = null;

// Discovery is a network round-trip, so the resulting Configuration is cached and only
// re-discovered when the relevant settings actually change (see resetOidcConfigCache(),
// called by routes/settings.ts after any update).
export async function getOidcConfig(): Promise<client.Configuration | null> {
  const { oidc } = getSettings();
  if (!oidc.enabled || !oidc.issuerUrl || !oidc.clientId || !oidc.clientSecret) return null;

  const key = `${oidc.issuerUrl}|${oidc.clientId}|${oidc.clientSecret}`;
  if (cachedConfig && cachedKey === key) return cachedConfig;

  const issuer = new URL(oidc.issuerUrl);
  // openid-client refuses plain HTTP by default as a safety net; an admin who has
  // deliberately entered an http:// issuer (a same-network provider with no local TLS
  // termination is common in self-hosted setups) is explicitly opting out of that.
  const options = issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined;
  cachedConfig = await client.discovery(issuer, oidc.clientId, oidc.clientSecret, undefined, options);
  cachedKey = key;
  return cachedConfig;
}

export function resetOidcConfigCache(): void {
  cachedConfig = null;
  cachedKey = null;
}
