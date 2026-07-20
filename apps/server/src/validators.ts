// Shared zod validation primitives used across multiple route files, so the accepted
// character set / parsing rule can't quietly drift between them.

// A Docker resource name (container, volume, network) — matches what the Engine API itself
// accepts for `--name`.
export const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// A single "KEY=value" entry (env var, label, build arg) — value may be empty or contain
// further `=` signs, only the key before the first `=` is significant.
export const KEY_VALUE_RE = /^[^=]+=.*$/;

// A Docker image reference (repo[:tag][@digest], optionally registry-qualified). Anchoring
// the first character to be alphanumeric is the load-bearing part: it's what stops a
// reference starting with `-` from being read as a CLI flag by any tool this value gets
// passed to as a positional argument (see trivy.ts, which appends a `--` separator too as
// defense-in-depth) — the rest of the character class just accepts real image references.
export const IMAGE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/;

// A git branch/tag name or repo subdirectory path (docker.ts's buildGitRemote splices
// these into Docker's `#ref:subdir` git-context fragment, which the daemon's git client
// parses positionally) — same leading-alphanumeric anchor as IMAGE_REF_RE, for the same
// reason: it's what stops a value starting with `-` from being read as a flag.
export const GIT_REF_OR_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

// Splits a list of "KEY=value" strings (already validated against KEY_VALUE_RE) into a
// Record, matching Docker's own "first `=` wins" convention.
export function parseKeyValueList(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    result[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return result;
}
