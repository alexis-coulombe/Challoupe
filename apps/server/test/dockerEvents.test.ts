import { describe, expect, it } from 'vitest';
import { classifyEvent } from '../src/dockerEvents.js';

describe('classifyEvent', () => {
  it('classifies a non-zero exit "die" as a crash', () => {
    const notification = classifyEvent({
      Type: 'container',
      Action: 'die',
      Actor: { ID: 'abc123', Attributes: { name: 'my-app', exitCode: '1' } },
      time: 1000,
    }, 'local');
    expect(notification).toEqual({
      type: 'container_event',
      action: 'crashed',
      containerId: 'abc123',
      containerName: 'my-app',
      exitCode: 1,
      time: 1000,
      hostId: 'local',
    });
  });

  it('ignores a clean (exit code 0) "die", an intentional/expected stop', () => {
    const notification = classifyEvent({
      Type: 'container',
      Action: 'die',
      Actor: { ID: 'abc123', Attributes: { name: 'my-app', exitCode: '0' } },
      time: 1000,
    }, 'local');
    expect(notification).toBeNull();
  });

  it('classifies an "oom" event', () => {
    const notification = classifyEvent({
      Type: 'container',
      Action: 'oom',
      Actor: { ID: 'abc123', Attributes: { name: 'my-app' } },
      time: 1000,
    }, 'local');
    expect(notification).toEqual({
      type: 'container_event',
      action: 'oom',
      containerId: 'abc123',
      containerName: 'my-app',
      time: 1000,
      hostId: 'local',
    });
  });

  it('classifies a failing health check', () => {
    const notification = classifyEvent({
      Type: 'container',
      Action: 'health_status: unhealthy',
      Actor: { ID: 'abc123', Attributes: { name: 'my-app' } },
      time: 1000,
    }, 'local');
    expect(notification).toEqual({
      type: 'container_event',
      action: 'unhealthy',
      containerId: 'abc123',
      containerName: 'my-app',
      time: 1000,
      hostId: 'local',
    });
  });

  it('ignores a passing health check', () => {
    const notification = classifyEvent({
      Type: 'container',
      Action: 'health_status: healthy',
      Actor: { ID: 'abc123', Attributes: { name: 'my-app' } },
      time: 1000,
    }, 'local');
    expect(notification).toBeNull();
  });

  it('ignores unrelated container actions', () => {
    expect(
      classifyEvent({ Type: 'container', Action: 'start', Actor: { ID: 'abc123' }, time: 1000 }, 'local')
    ).toBeNull();
  });

  it('ignores non-container event types', () => {
    expect(
      classifyEvent({ Type: 'network', Action: 'die', Actor: { ID: 'abc123' }, time: 1000 }, 'local')
    ).toBeNull();
  });

  it('falls back to a truncated id when the container has no name attribute', () => {
    const notification = classifyEvent({
      Type: 'container',
      Action: 'oom',
      Actor: { ID: 'abcdefabcdefabcdefabcdefabcdef' },
      time: 1000,
    }, 'local');
    expect(notification?.containerName).toBe('abcdefabcdef');
  });
});
