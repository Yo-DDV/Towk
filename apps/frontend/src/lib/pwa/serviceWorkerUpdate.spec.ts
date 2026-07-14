import { describe, expect, it, vi } from 'vitest';
import { activatePendingServiceWorker } from './serviceWorkerUpdate';

describe('activatePendingServiceWorker', () => {
  it('updates the registration, requests activation, and waits for control', async () => {
    const listeners = new Set<EventListener>();
    const waiting = { postMessage: vi.fn() };
    const registration = {
      waiting,
      update: vi.fn(async () => {})
    };
    const container = {
      controller: { state: 'activated' },
      getRegistration: vi.fn(async () => registration),
      addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: EventListener) =>
        listeners.delete(listener)
      )
    };
    waiting.postMessage.mockImplementation(() => {
      for (const listener of listeners) listener(new Event('controllerchange'));
    });

    await expect(
      activatePendingServiceWorker(container as unknown as ServiceWorkerContainer, 50)
    ).resolves.toBe(true);
    expect(registration.update).toHaveBeenCalledOnce();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'towk-skip-waiting' });
    expect(container.removeEventListener).toHaveBeenCalled();
  });

  it('returns false when no service worker is registered', async () => {
    const container = {
      getRegistration: vi.fn(async () => undefined)
    };

    await expect(
      activatePendingServiceWorker(container as unknown as ServiceWorkerContainer, 1)
    ).resolves.toBe(false);
  });
});
