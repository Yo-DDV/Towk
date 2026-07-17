import { Code, ConnectError } from '@connectrpc/connect';
import { flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AdminPerformanceSettings, AdminSystemInfo } from '$lib/api-client/adminDiagnostics';
import SystemPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getSystemInfo: vi.fn(),
  getPerformanceSettings: vi.fn(),
  updatePerformanceSettings: vi.fn()
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
    getAdminPerformanceSettings: mocks.getPerformanceSettings,
    updateAdminPerformanceSettings: mocks.updatePerformanceSettings
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
  const balanced = {
    image_transform_workers: 2,
    image_transform_admissions: 8,
    asset_upload_workers: 4,
    link_preview_workers: 2,
    video_workers: 2
  };
  return {
    requestedProfile: 'balanced',
    effectiveProfile: 'balanced',
    source: 'owner',
    schemaVersion: 1,
    revision: '7',
    requestedLimits: { ...balanced },
    effectiveLimits: { ...balanced },
    operatorCaps: { ...balanced },
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

describe('server admin performance profiles', () => {
  beforeEach(() => {
    mocks.getSystemInfo.mockReset().mockResolvedValue(systemInfo());
    mocks.getPerformanceSettings.mockReset().mockResolvedValue(performanceSettings());
    mocks.updatePerformanceSettings.mockReset();
  });

  it('shows every profile and explains requested limits that are capped at runtime', async () => {
    mocks.getPerformanceSettings.mockResolvedValue(
      performanceSettings({
        requestedProfile: 'performance',
        effectiveProfile: 'balanced',
        requestedLimits: {
          image_transform_workers: 4,
          image_transform_admissions: 16,
          asset_upload_workers: 8,
          link_preview_workers: 4,
          video_workers: 4
        },
        caps: { video_workers: ['process_cpu'] }
      })
    );

    const { container } = render(SystemPage);
    await settle();

    expect(container.querySelectorAll('[data-testid^="performance-profile-"]')).toHaveLength(4);
    expect(container.textContent).toMatch(/Requested:\s*Performance/);
    expect(container.textContent).toMatch(/Effective:\s*Balanced/);
    expect(container.textContent).toContain('Capped by CPU envelope');
  });

  it('prevents invalid custom limits from reaching the API', async () => {
    const { container } = render(SystemPage);
    await settle();

    (
      container.querySelector('[data-testid="performance-profile-custom"]') as HTMLButtonElement
    ).click();
    await settle();

    const workers = container.querySelector(
      '[data-testid="performance-limit-image_transform_workers"]'
    ) as HTMLInputElement;
    const admissions = container.querySelector(
      '[data-testid="performance-limit-image_transform_admissions"]'
    ) as HTMLInputElement;
    workers.value = '8';
    workers.dispatchEvent(new Event('input', { bubbles: true }));
    admissions.value = '4';
    admissions.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(container.textContent).toContain('Review the custom limits before saving.');
    const save = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save performance profile')
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(mocks.updatePerformanceSettings).not.toHaveBeenCalled();
  });

  it('reloads current values after an optimistic-concurrency conflict', async () => {
    mocks.getPerformanceSettings
      .mockResolvedValueOnce(performanceSettings())
      .mockResolvedValueOnce(performanceSettings({ requestedProfile: 'economy', revision: '8' }));
    mocks.updatePerformanceSettings.mockRejectedValue(
      new ConnectError('stale revision', Code.Aborted)
    );

    const { container } = render(SystemPage);
    await settle();

    (
      container.querySelector(
        '[data-testid="performance-profile-performance"]'
      ) as HTMLButtonElement
    ).click();
    const save = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save performance profile')
    ) as HTMLButtonElement;
    save.click();
    await settle();

    expect(mocks.updatePerformanceSettings).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ profile: 'performance', expectedRevision: '7' })
    );
    expect(mocks.getPerformanceSettings).toHaveBeenCalledTimes(2);
    expect(container.textContent).toMatch(/Requested:\s*Economy/);
  });
});
