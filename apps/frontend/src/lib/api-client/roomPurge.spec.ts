import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomPurgeAPI, RoomPurgeAPIError } from './roomPurge';

const successResult = {
  alreadyPurged: false,
  roomEventsDeleted: 4,
  rbacEventsDeleted: 2,
  assetEventsDeleted: 3,
  attachmentsDeleted: 1,
  linkPreviewAssetsDeleted: 1
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status ?? 200,
    headers
  });
}

describe('room purge API', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { cookie: 'chatto_csrf=csrf-test-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses cookie credentials and CSRF for an origin-server purge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(successResult));
    vi.stubGlobal('fetch', fetchMock);
    const api = createRoomPurgeAPI({
      serverId: 'origin',
      baseUrl: 'https://towk.example/',
      bearerToken: null
    });

    await expect(api.purge('R00000000000000', 'retired-room')).resolves.toEqual(successResult);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://towk.example/api/admin/rooms/R00000000000000/purge');
    expect(init.credentials).toBe('include');
    const headers = new Headers(init.headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-test-token');
    expect(headers.get('Authorization')).toBeNull();
    expect(JSON.parse(String(init.body))).toEqual({ confirmation: 'retired-room' });
  });

  it('uses bearer authentication without cookies or CSRF for a remote server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ canPurgeArchivedRooms: true })
    );
    vi.stubGlobal('fetch', fetchMock);
    const api = createRoomPurgeAPI({
      serverId: 'remote',
      baseUrl: 'https://remote.example/base',
      bearerToken: 'opaque-test-token'
    });

    await expect(api.capability()).resolves.toEqual({ canPurgeArchivedRooms: true });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://remote.example/api/admin/room-purge-capability');
    expect(init.credentials).toBe('omit');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer opaque-test-token');
    expect(headers.get('X-CSRF-Token')).toBeNull();
  });

  it('surfaces bounded retry metadata and stable server error codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: 'purge_in_progress' },
          { status: 409, headers: { 'Retry-After': '9999' } }
        )
      )
    );
    const api = createRoomPurgeAPI({
      serverId: 'origin',
      baseUrl: 'https://towk.example',
      bearerToken: null
    });

    const error = await api.purge('R00000000000000', 'room').catch((caught) => caught);
    expect(error).toBeInstanceOf(RoomPurgeAPIError);
    expect(error).toMatchObject({ code: 'purge_in_progress', status: 409, retryAfterSeconds: 300 });
  });

  it('notifies the registry when authentication has expired', async () => {
    const onAuthenticationRequired = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'authentication_required' }, { status: 401 }))
    );
    const api = createRoomPurgeAPI({
      serverId: 'remote',
      baseUrl: 'https://remote.example',
      bearerToken: 'expired',
      onAuthenticationRequired
    });

    await expect(api.capability()).rejects.toMatchObject({
      code: 'authentication_required',
      status: 401
    });
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
    expect(onAuthenticationRequired).toHaveBeenCalledWith('remote');
  });

  it('rejects malformed success payloads instead of trusting the transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ alreadyPurged: false })));
    const api = createRoomPurgeAPI({
      serverId: 'origin',
      baseUrl: 'https://towk.example',
      bearerToken: null
    });

    await expect(api.purge('R00000000000000', 'room')).rejects.toMatchObject({
      code: 'invalid_response',
      status: 0
    });
  });
});
