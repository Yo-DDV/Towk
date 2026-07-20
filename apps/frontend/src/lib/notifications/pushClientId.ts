const pushClientIdStorageKey = 'towk:push:client-id';
let pushClientIdFallback: string | null = null;

// Stable per browser installation and shared by push registration and the
// realtime foreground lease. Separate devices and browser profiles receive
// independent IDs even when they use the same Towk account.
export function currentPushClientId(): string {
  try {
    const stored = window.localStorage.getItem(pushClientIdStorageKey);
    if (stored) {
      pushClientIdFallback = stored;
      return stored;
    }
  } catch {
    if (pushClientIdFallback) return pushClientIdFallback;
  }

  const next = createPushClientId();
  pushClientIdFallback = next;
  try {
    window.localStorage.setItem(pushClientIdStorageKey, next);
  } catch {
    // The in-memory fallback still identifies this browser page lifetime.
  }
  return next;
}

function createPushClientId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  if (cryptoRef?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
