import { describe, expect, it } from 'vitest';
import { AVATAR_FRAMING_HEADER } from '$lib/avatarFraming';
import { avatarUploadHeaders } from '$lib/api-client/account';

const crop = {
  sourceWidth: 1200,
  sourceHeight: 800,
  x: 200,
  y: 0,
  size: 800
};

describe('avatarUploadHeaders', () => {
  it('preserves the legacy no-crop request shape', () => {
    expect(avatarUploadHeaders({ bearerToken: null }, null)).toBeUndefined();
    expect(avatarUploadHeaders({ bearerToken: 'token' }, undefined)).toEqual({
      Authorization: 'Bearer token'
    });
  });

  it('adds authenticated, versioned crop metadata only when requested', () => {
    expect(avatarUploadHeaders({ bearerToken: 'token' }, { mode: 'crop', crop })).toEqual({
      Authorization: 'Bearer token',
      [AVATAR_FRAMING_HEADER]: 'v1:crop:1200:800:200:0:800'
    });
  });

  it('encodes full-image framing without changing legacy clients', () => {
    expect(
      avatarUploadHeaders(
        { bearerToken: null },
        { mode: 'contain', sourceWidth: 1200, sourceHeight: 800 }
      )
    ).toEqual({
      [AVATAR_FRAMING_HEADER]: 'v1:contain:1200:800'
    });
  });
});
