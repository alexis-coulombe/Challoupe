// A Docker resource name (container, volume, network)
export const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// A single "KEY=value" entry (env var, label, build arg)
export const KEY_VALUE_RE = /^[^=]+=.*$/;

// A Docker image reference (repo[:tag][@digest], optionally registry-qualified).
export const IMAGE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/;

// A git branch/tag name or repo subdirectory path
export const GIT_REF_OR_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

/**
 * Splits a list of "KEY=value" strings into a Record, matching Docker's own "first `=` wins" convention.
 * @param pairs string[]
 * @returns Record<string, string>
 */
export function parseKeyValueList(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    result[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return result;
}
