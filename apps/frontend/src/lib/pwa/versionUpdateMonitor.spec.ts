import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVersionUpdateMonitor } from './versionUpdateMonitor';

describe('startVersionUpdateMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports an update already detected before the monitor starts', async () => {
    const check = vi.fn(async () => false);
    const onUpdate = vi.fn();
    const monitor = startVersionUpdateMonitor({ current: true, check }, onUpdate);

    await monitor.checkNow();

    expect(check).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledOnce();
    monitor.stop();
  });

  it('keeps polling through an offline failure and reports the next update once', async () => {
    vi.useFakeTimers();
    const check = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(true);
    const onUpdate = vi.fn();
    const monitor = startVersionUpdateMonitor({ current: false, check }, onUpdate, 60_000);

    await monitor.checkNow();
    expect(onUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(check).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(onUpdate).toHaveBeenCalledOnce();
    monitor.stop();
  });
});
