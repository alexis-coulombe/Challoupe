import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

// The Docker build stage has no .git directory (see .dockerignore), so `git rev-parse`
// only works for a local/CI build with real repo history; GIT_SHA lets the image build
// pass the commit in instead (see Dockerfile / the release workflow).
function gitCommit() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim();
  } catch {
    return '';
  }
}

// Shared by vite.config.ts (real build) and vitest.config.ts (tests), so components
// referencing __APP_VERSION__/__GIT_COMMIT__ work the same in both.
export const buildDefine = {
  __APP_VERSION__: JSON.stringify(version),
  __GIT_COMMIT__: JSON.stringify(gitCommit()),
};
