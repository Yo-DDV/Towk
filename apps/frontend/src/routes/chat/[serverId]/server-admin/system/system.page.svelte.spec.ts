import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AdminPerformanceSettings, AdminSystemInfo } from '$lib/api-client/adminDiagnostics';
import SystemPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getSystemInfo: vi.fn(),
  getPerformanceSettings: vi.fn()
}));

vi.mock('$lib/state/server/connection.svelte', () => ({
  useConnection: () => () => ({
    connectBaseUrl: 'https://towk.example.test/api/connect',
    bearerToken: 'test-token'
  })
}));

vi.mock('$lib/api-client/adminDiagnostics', async () => {
  const actual = await vi.importActual<typeof import('$lib/api-client/adminDiagnostics')>(
    '$lib/api-client/adminDiagnostics'
  );
  return {
    ...actual,
    getAdminSystemInfo: mocks.getSystemInfo,
    getAdminPerformanceSettings: mocks.getPerformanceSettings
  };
});

function systemInfo(): AdminSystemInfo {
  return {
    connection: {
      connected: true,
      serverId: 'server-1',
      serverName: 'Towk Test',
      version: 'test',
      maxPayload: 1_048_576,
      rtt: '1ms'
    },
    account: {
      memory: 0,
      memoryUsed: 0,
      storage: 0,
      storageUsed: 0,
      streams: 0,
      streamsUsed: 0,
      consumers: 0,
      consumersUsed: 0
    },
    nats: {
      totalMessages: 0,
      totalBytes: 0,
      totalConsumerPending: 0,
      totalAckPending: 0,
      streams: [],
      consumers: []
    },
    stats: { userCount: 0, channelRoomCount: 0, dmRoomCount: 0 },
    projections: []
  };
}

function performanceSettings(
  overrides: Partial<AdminPerformanceSettings> = {}
): AdminPerformanceSettings {
  const adaptive = {
    image_transform_workers: 2,
    image_transform_admissions: 8,
    asset_upload_workers: 4,
    link_preview_workers: 2,
    video_workers: 2
  };
  return {
    requestedProfile: 'adaptive',
    effectiveProfile: 'adaptive',
    source: 'adaptive',
    schemaVersion: 2,
    revision: '0',
    requestedLimits: { ...adaptive },
    effectiveLimits: { ...adaptive },
    operatorCaps: {
      image_transform_workers: 0,
      image_transform_admissions: 0,
      asset_upload_workers: 0,
      link_preview_workers: 0,
      video_workers: 0
    },
    envelope: {
      cpus: 2,
      memoryBytes: 4 * 1024 * 1024 * 1024,
      cpuSource: 'cgroup',
      memorySource: 'cgroup'
    },
    caps: {},
    policyError: '',
    restartRequired: false,
    ...overrides
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

describe('server admin adaptive capacity', () => {
  beforeEach(() => {
    mocks.getSystemInfo.mockReset().mockResolvedValue(systemInfo());
    mocks.getPerformanceSettings.mockReset().mockResolvedValue(performanceSettings());
  });

  it('shows adaptive targets and truthful memory-capped limits without profile controls', async () => {
    mocks.getPerformanceSettings.mockResolvedValue(
      performanceSettings({
        requestedLimits: {
          image_transform_workers: 6,
          image_transform_admissions: 48,
          asset_upload_workers: 12,
          link_preview_workers: 6,
          video_workers: 6
        },
        effectiveLimits: {
          image_transform_workers: 2,
          image_transform_admissions: 16,
          asset_upload_workers: 12,
          link_preview_workers: 6,
          video_workers: 2
        },
        envelope: {
          cpus: 6,
          memoryBytes: 2 * 1024 * 1024 * 1024,
          cpuSource: 'host_memory',
          memorySource: 'host_memory'
        },
        caps: { video_workers: ['process_memory'] }
      })
    );

    const { container } = render(SystemPage);
    await settle();

    expect(container.querySelector('[data-testid="performance-mode-readonly"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="performance-profile-"]')).toHaveLength(0);
    expect(container.textContent).toContain('Adaptive');
    expect(container.textContent).toContain('6 CPU cores available');
    expect(container.textContent).toContain('Capped by memory envelope');
    expect(container.textContent).not.toContain('Save performance profile');
  });

  it('explains that deployment ceilings remain operator-owned', async () => {
    const { container } = render(SystemPage);
    await settle();

    expect(container.textContent).toContain(
      'Container limits and priorities remain operator-owned'
    );
    expect(container.querySelector('input[type="number"]')).toBeNull();
  });

  it('keeps performance diagnostics failure isolated from system diagnostics', async () => {
    mocks.getPerformanceSettings.mockRejectedValue(new Error('unavailable'));

    const { container } = render(SystemPage);
    await settle();

    expect(container.textContent).toContain('Performance settings could not be loaded.');
    expect(container.textContent).toContain('Towk Test');
  });
});
