import { describe, expect, it, vi } from 'vitest';
import {
  SERVICE_WORKER_REGISTRATION_OPTIONS,
  SERVICE_WORKER_SCRIPT_URL,
  registerTowkServiceWorker
} from './serviceWorkerRegistration';

describe('registerTowkServiceWorker', () => {
  it('registers the Towk service worker without consulting HTTP cache during update checks', async () => {
    const registration = {} as ServiceWorkerRegistration;
    const container = {
      register: vi.fn(async () => registration)
    };

    await expect(registerTowkServiceWorker(container, { dev: false })).resolves.toBe(registration);

    expect(container.register).toHaveBeenCalledWith(
      SERVICE_WORKER_SCRIPT_URL,
      SERVICE_WORKER_REGISTRATION_OPTIONS
    );
    expect(SERVICE_WORKER_REGISTRATION_OPTIONS).toEqual({ updateViaCache: 'none' });
  });

  it('does nothing when the browser has no service worker container', async () => {
    await expect(registerTowkServiceWorker(undefined, { dev: false })).resolves.toBeNull();
  });
});
