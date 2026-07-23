// Presets that fill in the OpenID Connect issuer URL (and a sensible button label) for
// well-known providers, so an admin only has to supply the one or two values that are
// actually specific to their account (a tenant ID, a domain, a realm) instead of knowing
// each provider's discovery-URL shape by heart. The Client ID/Secret and callback URL stay
// the same for every provider and are entered separately, as before.
//
// GitHub is listed but disabled: its "Login with GitHub" OAuth flow does not implement
// OpenID Connect (no ID token, no `.well-known/openid-configuration` discovery document),
// so it cannot be driven by the generic OIDC client this app uses. GitLab does implement
// full OIDC.
export interface SsoProviderField {
  key: string;
  label: string;
  placeholder: string;
  tooltip?: string;
  defaultValue?: string;
}

export interface SsoProviderTemplate {
  id: string;
  name: string;
  buttonLabel: string;
  disabled?: boolean;
  disabledReason?: string;
  fields: SsoProviderField[];
  buildIssuerUrl: (values: Record<string, string>) => string;
  // Reconstructs field values from an issuer URL already known to belong to this template.
  // Used once the settings' stored `providerId` names the template directly, so this
  // always just parses (no ambiguity to worry about at that point).
  parseIssuerUrl: (issuerUrl: string) => Record<string, string>;
  // Only set for templates whose issuer URL shape is distinctive enough to *guess* with no
  // known providerId, i.e. settings saved before this field existed. Several providers
  // (Okta, Auth0, GitLab, Authelia) reduce to the same bare "https://{host}" shape, so
  // guessing among them would be arbitrary; those are only ever selected via providerId.
  guessIssuerUrl?: (issuerUrl: string) => Record<string, string> | null;
}

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '');
const stripScheme = (s: string) => s.replace(/^https?:\/\//, '');

export const SSO_PROVIDERS: SsoProviderTemplate[] = [
  {
    id: 'custom',
    name: 'Custom / other',
    buttonLabel: 'Single Sign-On',
    fields: [],
    buildIssuerUrl: () => '',
    parseIssuerUrl: () => ({}),
  },
  {
    id: 'google',
    name: 'Google',
    buttonLabel: 'Sign in with Google',
    fields: [],
    buildIssuerUrl: () => 'https://accounts.google.com',
    parseIssuerUrl: () => ({}),
    guessIssuerUrl: (url) => (stripTrailingSlash(url) === 'https://accounts.google.com' ? {} : null),
  },
  {
    id: 'microsoft',
    name: 'Microsoft (Entra ID)',
    buttonLabel: 'Sign in with Microsoft',
    fields: [
      {
        key: 'tenant',
        label: 'Tenant ID',
        placeholder: 'common',
        tooltip:
          "Your Azure AD/Entra tenant ID (a GUID), or one of the special values 'common' (any Microsoft account), 'organizations' (work/school accounts only), or 'consumers' (personal accounts only).",
        defaultValue: 'common',
      },
    ],
    buildIssuerUrl: ({ tenant }) => `https://login.microsoftonline.com/${tenant || 'common'}/v2.0`,
    parseIssuerUrl: (url): Record<string, string> => {
      const m = /^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0$/.exec(stripTrailingSlash(url));
      return m ? { tenant: m[1] } : {};
    },
    guessIssuerUrl(url) {
      const values = this.parseIssuerUrl(url);
      return values.tenant ? values : null;
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    buttonLabel: 'Sign in with GitLab',
    fields: [
      {
        key: 'host',
        label: 'GitLab host',
        placeholder: 'gitlab.com',
        tooltip: 'Leave as gitlab.com unless you run a self-hosted GitLab instance.',
        defaultValue: 'gitlab.com',
      },
    ],
    buildIssuerUrl: ({ host }) => `https://${host || 'gitlab.com'}`,
    parseIssuerUrl: (url) => ({ host: stripScheme(stripTrailingSlash(url)) }),
  },
  {
    id: 'okta',
    name: 'Okta',
    buttonLabel: 'Sign in with Okta',
    fields: [
      {
        key: 'domain',
        label: 'Okta domain',
        placeholder: 'your-org.okta.com',
        tooltip: 'Your Okta org domain, e.g. dev-12345.okta.com',
      },
    ],
    buildIssuerUrl: ({ domain }) => `https://${domain || ''}`,
    parseIssuerUrl: (url) => ({ domain: stripScheme(stripTrailingSlash(url)) }),
  },
  {
    id: 'auth0',
    name: 'Auth0',
    buttonLabel: 'Sign in with Auth0',
    fields: [{ key: 'domain', label: 'Auth0 domain', placeholder: 'your-tenant.auth0.com' }],
    buildIssuerUrl: ({ domain }) => `https://${domain || ''}`,
    parseIssuerUrl: (url) => ({ domain: stripScheme(stripTrailingSlash(url)) }),
  },
  {
    id: 'keycloak',
    name: 'Keycloak',
    buttonLabel: 'Sign in with Keycloak',
    fields: [
      { key: 'host', label: 'Keycloak URL', placeholder: 'https://keycloak.example.com' },
      { key: 'realm', label: 'Realm', placeholder: 'master', defaultValue: 'master' },
    ],
    buildIssuerUrl: ({ host, realm }) => `${stripTrailingSlash(host || '')}/realms/${realm || 'master'}`,
    parseIssuerUrl: (url): Record<string, string> => {
      const m = /^(.+)\/realms\/([^/]+)$/.exec(stripTrailingSlash(url));
      return m ? { host: m[1], realm: m[2] } : {};
    },
    guessIssuerUrl(url) {
      const values = this.parseIssuerUrl(url);
      return values.realm ? values : null;
    },
  },
  {
    id: 'authentik',
    name: 'Authentik',
    buttonLabel: 'Sign in with Authentik',
    fields: [
      { key: 'host', label: 'Authentik URL', placeholder: 'https://authentik.example.com' },
      { key: 'slug', label: 'Application slug', placeholder: 'challoupe' },
    ],
    buildIssuerUrl: ({ host, slug }) => `${stripTrailingSlash(host || '')}/application/o/${slug || ''}/`,
    parseIssuerUrl: (url): Record<string, string> => {
      const m = /^(.+)\/application\/o\/([^/]+)\/?$/.exec(stripTrailingSlash(url));
      return m ? { host: m[1], slug: m[2] } : {};
    },
    guessIssuerUrl(url) {
      const values = this.parseIssuerUrl(url);
      return values.slug ? values : null;
    },
  },
  {
    id: 'authelia',
    name: 'Authelia',
    buttonLabel: 'Sign in with Authelia',
    fields: [{ key: 'host', label: 'Authelia URL', placeholder: 'https://auth.example.com' }],
    buildIssuerUrl: ({ host }) => stripTrailingSlash(host || ''),
    parseIssuerUrl: (url) => ({ host: stripTrailingSlash(url) }),
  }
];

export function findSsoProvider(id: string): SsoProviderTemplate {
  return SSO_PROVIDERS.find((p) => p.id === id) ?? SSO_PROVIDERS[0];
}

// Given a known provider id (from the stored `providerId` settings field) and its issuer
// URL, reconstructs the field values so the picker's inputs repopulate correctly.
export function parseKnownSsoProvider(id: string, issuerUrl: string): Record<string, string> {
  if (!id || id === 'custom' || !issuerUrl) return {};
  return findSsoProvider(id).parseIssuerUrl(issuerUrl);
}

// Best-effort fallback for settings saved before `providerId` existed: guesses which
// template (if any) produced a stored issuer URL, only for shapes distinctive enough to
// guess safely. See `guessIssuerUrl` above.
export function guessSsoProvider(issuerUrl: string): { id: string; values: Record<string, string> } | null {
  if (!issuerUrl) return null;
  for (const provider of SSO_PROVIDERS) {
    if (!provider.guessIssuerUrl) continue;
    const values = provider.guessIssuerUrl(issuerUrl);
    if (values) return { id: provider.id, values };
  }
  return null;
}
