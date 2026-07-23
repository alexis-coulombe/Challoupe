import { describe, expect, it } from 'vitest';
import { STACK_NAME_RE, stackService } from '../src/stacks.js';

describe('STACK_NAME_RE', () => {
  it('accepts lowercase names with digits, dashes and underscores', () => {
    for (const name of ['web', 'web-app', 'web_app', 'app2']) {
      expect(STACK_NAME_RE.test(name)).toBe(true);
    }
  });

  it('rejects names with uppercase letters, spaces or a leading symbol', () => {
    for (const name of ['Web', 'web app', '-web', '_web', '']) {
      expect(STACK_NAME_RE.test(name)).toBe(false);
    }
  });
});

describe('writeStack / readStack', () => {
  it('rejects a compose file without a services key', async () => {
    await expect(stackService.write('bad-stack', 'foo: bar')).rejects.toThrow(
      'The compose file must define at least "services"'
    );
  });

  it('rejects a document that is not a YAML mapping', async () => {
    await expect(stackService.write('bad-stack-2', 'just a string')).rejects.toThrow();
  });

  it('writes and reads back a valid compose file', async () => {
    const compose = 'services:\n  web:\n    image: nginx:alpine\n';
    await stackService.write('good-stack', compose);
    expect(await stackService.exists('good-stack')).toBe(true);
    expect(await stackService.read('good-stack')).toBe(compose);
  });

  it('reports a stack as not existing until it has been written', async () => {
    expect(await stackService.exists('never-written')).toBe(false);
  });
});
