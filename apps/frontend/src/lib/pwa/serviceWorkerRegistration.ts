import { dev } from '$app/environment';

export const SERVICE_WORKER_SCRIPT_URL = '/service-worker.js';
export const SERVICE_WORKER_REGISTRATION_OPTIONS = {
  updateViaCache: 'none'
} satisfies RegistrationOptions;

export type ServiceWorkerRegistrationContainer = Pick<ServiceWorkerContainer, 'register'>;

export function registerTowkServiceWorker(
  container: ServiceWorkerRegistrationContainer | undefined = globalThis.navigator?.serviceWorker,
  options: { dev?: boolean } = {}
): Promise<ServiceWorkerRegistration | null> {
  if ((options.dev ?? dev) || !container) return Promise.resolve(null);
  return container.register(SERVICE_WORKER_SCRIPT_URL, SERVICE_WORKER_REGISTRATION_OPTIONS);
}
