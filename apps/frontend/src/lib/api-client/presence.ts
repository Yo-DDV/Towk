import { authHeaders, createTowkClient, handleAuthError } from './connect.js';
import { currentPushClientId } from '$lib/notifications/pushClientId';
import { MyAccountService } from '@towk/api-types/api/v1/account_pb';
import { PresenceStatus } from '@towk/api-types/api/v1/presence_pb';

const presenceSessionId = createPresenceSessionId();

export type PresenceAPIConfig = {
  serverId?: string;
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
};

export type PresenceReportOptions = {
  active: boolean;
  meaningfulActivity?: boolean;
  releaseInstallation?: boolean;
};

export { PresenceStatus as APIPresenceStatus };

function createPresenceSessionId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  if (cryptoRef?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function presenceRequest(
  status: PresenceStatus,
  userSelected: boolean,
  options: PresenceReportOptions
) {
  const installationId = currentPushClientId();
  if (options.releaseInstallation) {
    return {
      status,
      userSelected,
      installationId,
      releaseInstallation: true
    };
  }
  return {
    status,
    userSelected,
    installationId,
    sessionId: presenceSessionId,
    active: options.active,
    meaningfulActivity: options.meaningfulActivity ?? false
  };
}

export function createPresenceAPI(config: PresenceAPIConfig) {
  const client = createTowkClient(MyAccountService, config);
  let inFlight: Promise<void> | null = null;

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = inFlight ? inFlight.then(operation, operation) : operation();
    const completion = result.then(
      () => undefined,
      () => undefined
    );
    inFlight = completion;
    void completion.finally(() => {
      if (inFlight === completion) inFlight = null;
    });
    return result;
  }

  return {
    updatePresence(
      status: PresenceStatus,
      userSelected = false,
      options: PresenceReportOptions = { active: true },
      signal?: AbortSignal
    ): Promise<PresenceStatus> {
      return serialize(async () => {
        try {
          const response = await client.updatePresence(
            presenceRequest(status, userSelected, options),
            {
              headers: authHeaders(config),
              signal
            }
          );
          return response.status;
        } catch (err) {
          return handleAuthError(config, err);
        }
      });
    }
  };
}

export const __presenceAPITest = {
  presenceSessionId,
  presenceRequest
};
