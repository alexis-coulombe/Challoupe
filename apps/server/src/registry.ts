const DOCKER_HUB_REGISTRY = 'registry-1.docker.io';
const REQUEST_TIMEOUT_MS = 10_000;

export interface ParsedReference {
  registryHost: string;
  repository: string;
  tag: string;
}

// Mirrors Docker's own reference-parsing heuristic: the first path segment is a registry
// host (not Docker Hub) only if it looks like one (has a dot, a port colon, or is
// "localhost") — otherwise the whole reference is a Docker Hub repository, and an
// unqualified name (no slash) is an official "library/" image.
export function parseImageReference(reference: string): ParsedReference | null {
  // A digest-pinned reference (name@sha256:...) never has a "newer version" to check for.
  if (reference.includes('@')) {
    return null;
  }

  const lastColon = reference.lastIndexOf(':');
  const lastSlash = reference.lastIndexOf('/');
  let tag = 'latest';
  let namePart = reference;
  if (lastColon > lastSlash) {
    tag = reference.slice(lastColon + 1);
    namePart = reference.slice(0, lastColon);
  }
  if (!namePart) return null;

  const firstSlash = namePart.indexOf('/');
  const firstSegment = firstSlash === -1 ? namePart : namePart.slice(0, firstSlash);
  const looksLikeHost =
    firstSegment === 'localhost' || firstSegment.includes('.') || firstSegment.includes(':');

  let registryHost: string;
  let repository: string;
  if (looksLikeHost) {
    registryHost = firstSegment;
    repository = namePart.slice(firstSlash + 1);
  } else {
    registryHost = DOCKER_HUB_REGISTRY;
    repository = namePart;
  }
  if (!repository) return null;
  if (registryHost === DOCKER_HUB_REGISTRY && !repository.includes('/')) {
    repository = `library/${repository}`;
  }
  return { registryHost, repository, tag };
}

interface AuthChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

/**
 * Registries advertise how to authenticate via a WWW-Authenticate
 * @param header string
 * @returns AuthChallenge | null
 */
function parseWwwAuthenticate(header: string): AuthChallenge | null {
  const match = /^Bearer\s+(.*)$/i.exec(header.trim());
  if (!match) {
    return null;
  }

  const params: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  
  while ((m = re.exec(match[1]))) {
    params[m[1]] = m[2];
  }

  if (!params.realm) {
    return null;
  }

  return { realm: params.realm, service: params.service, scope: params.scope };
}

async function fetchBearerToken(challenge: AuthChallenge): Promise<string | null> {
  const url = new URL(challenge.realm);
  if (challenge.service) {
    url.searchParams.set('service', challenge.service);
  }

  if (challenge.scope) {
    url.searchParams.set('scope', challenge.scope);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    return null;
  }

  const body = (await res.json()) as { token?: string; access_token?: string };
  return body.token ?? body.access_token ?? null;
}

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
].join(', ');

/**
 * Returns the digest a registry currently serves for a repo:tag, or null if the
 * reference can't be checked (digest-pinned, unreachable, private without credentials, not found, etc.) 
 * @param reference string
 * @returns string | null
 */
export async function getRemoteDigest(reference: string): Promise<string | null> {
  const parsed = parseImageReference(reference);
  if (!parsed) {
    return null;
  }

  const manifestUrl = `https://${parsed.registryHost}/v2/${parsed.repository}/manifests/${parsed.tag}`;
  const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };

  let res = await fetch(manifestUrl, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 401) {
    const challenge = parseWwwAuthenticate(res.headers.get('www-authenticate') ?? '');
    if (!challenge) {
      return null;
    }

    const token = await fetchBearerToken(challenge);
    if (!token) {
      return null;
    }

    res = await fetch(manifestUrl, {
      headers: { ...headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  if (!res.ok) {
    return null;
  }
  
  return res.headers.get('docker-content-digest');
}
