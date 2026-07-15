const SKIP_WAITING_MESSAGE = { type: 'towk-skip-waiting' } as const;
const POLL_INTERVAL_MS = 50;

/**
 * Ask an installed service-worker update to take control, then resolve once
 * the controller changes. The caller owns the final page reload.
 */
export async function activatePendingServiceWorker(
  container: ServiceWorkerContainer,
  timeoutMs = 3_000
): Promise<boolean> {
  const registration = await container.getRegistration('/');
  if (!registration) return false;

  try {
    await settleWithin(registration.update(), timeoutMs);
  } catch {
    // A previously installed waiting worker can still be activated while the
    // network update check itself is unavailable.
  }

  const waiting = registration.waiting ?? (await waitForWaitingWorker(registration, timeoutMs));
  if (!waiting) return false;

  if (!container.controller) {
    waiting.postMessage(SKIP_WAITING_MESSAGE);
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timer = globalThis.setTimeout(() => finish(false), timeoutMs);

    function finish(activated: boolean) {
      globalThis.clearTimeout(timer);
      container.removeEventListener('controllerchange', onControllerChange);
      resolve(activated);
    }

    function onControllerChange() {
      finish(true);
    }

    container.addEventListener('controllerchange', onControllerChange);
    waiting.postMessage(SKIP_WAITING_MESSAGE);
  });
}

async function waitForWaitingWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs: number
): Promise<ServiceWorker | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (registration.waiting) return registration.waiting;
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
  return registration.waiting;
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
