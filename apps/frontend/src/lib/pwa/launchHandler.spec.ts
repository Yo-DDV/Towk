import { describe, expect, it, vi } from 'vitest';
import { registerPwaLaunchHandler, safeLaunchPath, type PwaLaunchParams } from './launchHandler';

describe('PWA launch handler', () => {
  it('accepts only same-origin app routes', () => {
    expect(safeLaunchPath('https://towk.example/chat/-/R123?q=1#x', 'https://towk.example')).toBe(
      '/chat/-/R123?q=1#x'
    );
    expect(safeLaunchPath('/', 'https://towk.example')).toBe('/');
    expect(safeLaunchPath('https://evil.example/chat/-/R123', 'https://towk.example')).toBeNull();
    expect(safeLaunchPath('/admin', 'https://towk.example')).toBeNull();
    expect(safeLaunchPath(undefined, 'https://towk.example')).toBeNull();
  });

  it('registers a launch consumer when supported', async () => {
    let consumer: ((params: PwaLaunchParams) => void | Promise<void>) | undefined;
    const navigate = vi.fn();
    const launchWindow = {
      location: { origin: 'https://towk.example' },
      launchQueue: { setConsumer: (value: typeof consumer) => (consumer = value) }
    } as unknown as Window & {
      launchQueue: { setConsumer: (value: typeof consumer) => void };
    };

    expect(registerPwaLaunchHandler(navigate, launchWindow)).toBe(true);
    await consumer?.({ targetURL: '/chat/notifications' });
    expect(navigate).toHaveBeenCalledWith('/chat/notifications');
  });
});
