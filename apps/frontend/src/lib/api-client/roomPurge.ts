import { authHeaders } from './connect.js';
import { csrfHeaders } from '$lib/auth/csrf';

export type RoomPurgeAPIConfig = {
  serverId: string;
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
};

export type RoomPurgeCapability = {
  canPurgeArchivedRooms: boolean;
};

export type RoomPurgeResult = {
  alreadyPurged: boolean;
  roomEventsDeleted: number;
  rbacEventsDeleted: number;
  assetEventsDeleted: number;
  attachmentsDeleted: number;
  linkPreviewAssetsDeleted: number;
};

export type RoomPurgeErrorCode =
  | 'authentication_required'
  | 'authentication_unavailable'
  | 'forbidden'
  | 'invalid_room_id'
  | 'confirmation_mismatch'
  | 'room_not_archived'
  | 'purge_in_progress'
  | 'purge_not_quiescent'
  | 'room_not_found'
  | 'timed_out'
  | 'interrupted'
  | 'temporarily_unavailable'
  | 'invalid_request'
  | 'internal_error'
  | 'invalid_response'
  | 'network_error';

export class RoomPurgeAPIError extends Error {
  readonly code: RoomPurgeErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: RoomPurgeErrorCode,
    status: number,
    retryAfterSeconds: number | null = null,
    cause?: unknown
  ) {
    super(code, { cause });
    this.name = 'RoomPurgeAPIError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type RoomPurgeErrorPayload = { code?: unknown };

const knownErrorCodes = new Set<RoomPurgeErrorCode>([
  'authentication_required',
  'authentication_unavailable',
  'forbidden',
  'invalid_room_id',
  'confirmation_mismatch',
  'room_not_archived',
  'purge_in_progress',
  'purge_not_quiescent',
  'room_not_found',
  'timed_out',
  'interrupted',
  'temporarily_unavailable',
  'invalid_request',
  'internal_error'
]);

function errorCode(payload: unknown): RoomPurgeErrorCode {
  const code = (payload as RoomPurgeErrorPayload | null)?.code;
  return typeof code === 'string' && knownErrorCodes.has(code as RoomPurgeErrorCode)
    ? (code as RoomPurgeErrorCode)
    : 'internal_error';
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPurgeResult(value: unknown): value is RoomPurgeResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RoomPurgeResult>;
  return (
    typeof result.alreadyPurged === 'boolean' &&
    isNonNegativeInteger(result.roomEventsDeleted) &&
    isNonNegativeInteger(result.rbacEventsDeleted) &&
    isNonNegativeInteger(result.assetEventsDeleted) &&
    isNonNegativeInteger(result.attachmentsDeleted) &&
    isNonNegativeInteger(result.linkPreviewAssetsDeleted)
  );
}

async function responseJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createRoomPurgeAPI(config: RoomPurgeAPIConfig) {
  async function request(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const bearer = authHeaders(config);
    if (bearer) {
      for (const [name, value] of new Headers(bearer)) headers.set(name, value);
    } else if (init.method !== 'GET' && init.method !== 'HEAD') {
      for (const [name, value] of Object.entries(csrfHeaders())) headers.set(name, value);
    }

    let response: Response;
    try {
      response = await fetch(new URL(path, config.baseUrl), {
        ...init,
        headers,
        credentials: config.bearerToken ? 'omit' : 'include',
        cache: 'no-store'
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new RoomPurgeAPIError('network_error', 0, null, cause);
    }

    const payload = await responseJSON(response);
    if (!response.ok) {
      if (response.status === 401) config.onAuthenticationRequired?.(config.serverId);
      throw new RoomPurgeAPIError(
        errorCode(payload),
        response.status,
        parseRetryAfter(response.headers.get('Retry-After'))
      );
    }
    return payload;
  }

  return {
    async capability(signal?: AbortSignal): Promise<RoomPurgeCapability> {
      const payload = await request('/api/admin/room-purge-capability', {
        method: 'GET',
        signal
      });
      const canPurgeArchivedRooms = (payload as Partial<RoomPurgeCapability> | null)
        ?.canPurgeArchivedRooms;
      if (typeof canPurgeArchivedRooms !== 'boolean') {
        throw new RoomPurgeAPIError('invalid_response', 0);
      }
      return { canPurgeArchivedRooms };
    },

    async purge(
      roomId: string,
      confirmation: string,
      signal?: AbortSignal
    ): Promise<RoomPurgeResult> {
      const payload = await request(`/api/admin/rooms/${encodeURIComponent(roomId)}/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
        signal
      });
      if (!isPurgeResult(payload)) throw new RoomPurgeAPIError('invalid_response', 0);
      return payload;
    }
  };
}

export type RoomPurgeAPI = ReturnType<typeof createRoomPurgeAPI>;
