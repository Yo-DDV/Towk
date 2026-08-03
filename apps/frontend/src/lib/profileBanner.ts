import { authHeaders } from '$lib/api-client/connect';

export const PROFILE_BANNER_CAPABILITY = 'profile-banner-v1';
export const PROFILE_BANNER_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PROFILE_BANNER_ACCEPT = PROFILE_BANNER_ACCEPTED_TYPES.join(',');
export const PROFILE_BANNER_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const PROFILE_BANNER_RECOMMENDED_WIDTH = 1536;
export const PROFILE_BANNER_RECOMMENDED_HEIGHT = 512;
export const PROFILE_BANNER_MIN_WIDTH = 600;
export const PROFILE_BANNER_MIN_HEIGHT = 200;

export type ProfileBannerAPIConfig = {
  serverId: string;
  baseUrl: string;
  bearerToken: string | null;
};

export type ProfileBannerValidationCode = 'invalid_type' | 'too_large';

export type ProfileBannerDimensions = {
  width: number;
  height: number;
};

export class ProfileBannerRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(`Profile banner request failed (${status}: ${code})`);
    this.name = 'ProfileBannerRequestError';
  }
}

const capabilityRequests = new Map<string, Promise<boolean>>();

function requestRoot(baseUrl: string): URL {
  const fallbackOrigin =
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const endpoint = new URL(baseUrl, fallbackOrigin);
  endpoint.search = '';
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/api\/connect\/?$/, '/');
  if (!endpoint.pathname.endsWith('/')) endpoint.pathname += '/';
  return endpoint;
}

function endpointURL(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), requestRoot(baseUrl)).toString();
}

function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const entry of document.cookie.split(';')) {
    const [name, ...value] = entry.trim().split('=');
    if (name === 'chatto_csrf') return decodeURIComponent(value.join('='));
  }
  return null;
}

function requestHeaders(
  config: ProfileBannerAPIConfig,
  options: { contentType?: string; csrf?: boolean } = {}
): Headers {
  const headers = new Headers(authHeaders(config));
  headers.set('Accept', 'application/json');
  if (options.contentType) headers.set('Content-Type', options.contentType);
  if (options.csrf && !config.bearerToken) {
    const token = csrfToken();
    if (token) headers.set('X-CSRF-Token', token);
  }
  return headers;
}

async function responseCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === 'string' && body.code ? body.code : 'request_failed';
  } catch {
    return 'request_failed';
  }
}

export function validateProfileBannerFile(
  file: Pick<File, 'type' | 'size'>
): ProfileBannerValidationCode | null {
  if (
    !PROFILE_BANNER_ACCEPTED_TYPES.includes(
      file.type as (typeof PROFILE_BANNER_ACCEPTED_TYPES)[number]
    )
  ) {
    return 'invalid_type';
  }
  if (file.size <= 0 || file.size > PROFILE_BANNER_MAX_UPLOAD_BYTES) {
    return 'too_large';
  }
  return null;
}

export function isProfileBannerBelowRecommendation(dimensions: ProfileBannerDimensions): boolean {
  return (
    dimensions.width < PROFILE_BANNER_RECOMMENDED_WIDTH ||
    dimensions.height < PROFILE_BANNER_RECOMMENDED_HEIGHT
  );
}

export async function inspectProfileBannerDimensions(file: Blob): Promise<ProfileBannerDimensions> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width <= 0 || bitmap.height <= 0) throw new Error('invalid dimensions');
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    throw new Error('image decoding unavailable');
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<ProfileBannerDimensions>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
          reject(new Error('invalid dimensions'));
          return;
        }
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function supportsProfileBanners(config: ProfileBannerAPIConfig): Promise<boolean> {
  const key = endpointURL(config.baseUrl, '/api/profile/banner/capability');
  let request = capabilityRequests.get(key);
  if (!request) {
    request = fetch(key, {
      method: 'GET',
      headers: requestHeaders(config),
      credentials: 'include',
      cache: 'no-store'
    })
      .then(async (response) => {
        if (response.status === 404) return false;
        if (!response.ok) {
          capabilityRequests.delete(key);
          return false;
        }
        const body = (await response.json()) as { supported?: unknown };
        return body.supported === true;
      })
      .catch(() => {
        capabilityRequests.delete(key);
        return false;
      });
    capabilityRequests.set(key, request);
  }
  return request;
}

export async function loadProfileBanner(
  config: ProfileBannerAPIConfig,
  userId: string,
  signal?: AbortSignal
): Promise<Blob | null> {
  const response = await fetch(
    endpointURL(config.baseUrl, `/api/profile/banner/${encodeURIComponent(userId)}`),
    {
      method: 'GET',
      headers: requestHeaders(config),
      credentials: 'include',
      cache: 'default',
      signal
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ProfileBannerRequestError(response.status, await responseCode(response));
  }
  const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim() ?? '';
  if (
    !PROFILE_BANNER_ACCEPTED_TYPES.includes(
      contentType as (typeof PROFILE_BANNER_ACCEPTED_TYPES)[number]
    )
  ) {
    throw new ProfileBannerRequestError(response.status, 'invalid_response_type');
  }
  return response.blob();
}

export async function uploadProfileBanner(
  config: ProfileBannerAPIConfig,
  file: File
): Promise<void> {
  const validation = validateProfileBannerFile(file);
  if (validation) throw new ProfileBannerRequestError(400, validation);

  const response = await fetch(endpointURL(config.baseUrl, '/api/profile/banner'), {
    method: 'PUT',
    headers: requestHeaders(config, {
      contentType: file.type || 'application/octet-stream',
      csrf: true
    }),
    credentials: 'include',
    cache: 'no-store',
    body: file
  });
  if (!response.ok) {
    throw new ProfileBannerRequestError(response.status, await responseCode(response));
  }
}

export async function deleteProfileBanner(config: ProfileBannerAPIConfig): Promise<void> {
  const response = await fetch(endpointURL(config.baseUrl, '/api/profile/banner'), {
    method: 'DELETE',
    headers: requestHeaders(config, { csrf: true }),
    credentials: 'include',
    cache: 'no-store'
  });
  if (!response.ok && response.status !== 404) {
    throw new ProfileBannerRequestError(response.status, await responseCode(response));
  }
}

export function clearProfileBannerCapabilityCache(): void {
  capabilityRequests.clear();
}
