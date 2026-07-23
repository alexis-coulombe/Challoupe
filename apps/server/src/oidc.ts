import * as client from 'openid-client';
import { settingsService } from './settings.js';

/**
 * Discovers and caches the OIDC provider Configuration, since discovery is a network
 * round-trip — re-discovered only when the relevant settings actually change (see
 * resetCache(), called by routes/settings.ts after any update).
 */
export class OidcConfigProvider {
  private cachedConfig: client.Configuration | null = null;
  private cachedKey: string | null = null;

  async get(): Promise<client.Configuration | null> {
    const { oidc } = settingsService.get();
    if (!oidc.enabled || !oidc.issuerUrl || !oidc.clientId || !oidc.clientSecret) return null;

    const key = `${oidc.issuerUrl}|${oidc.clientId}|${oidc.clientSecret}`;
    if (this.cachedConfig && this.cachedKey === key) return this.cachedConfig;

    const issuer = new URL(oidc.issuerUrl);
    // openid-client refuses plain HTTP by default as a safety net; an admin who has
    // deliberately entered an http:// issuer (a same-network provider with no local TLS
    // termination is common in self-hosted setups) is explicitly opting out of that.
    const options = issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined;
    this.cachedConfig = await client.discovery(issuer, oidc.clientId, oidc.clientSecret, undefined, options);
    this.cachedKey = key;
    return this.cachedConfig;
  }

  resetCache(): void {
    this.cachedConfig = null;
    this.cachedKey = null;
  }
}

export const oidcConfigProvider = new OidcConfigProvider();
