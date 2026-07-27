import { describe, expect, it } from 'vitest';
import { SERVER_SIDEBAR_MAX_WIDTH } from '$lib/storage/serverSidebarWidth';
import {
  FOLD_LIKE_SIDEBAR_MAX_WIDTH,
  getServerSidebarMaxWidth
} from './serverSidebarSizing';

describe('getServerSidebarMaxWidth', () => {
  it('caps Fold-like touch viewports proportionally', () => {
    expect(
      getServerSidebarMaxWidth({ width: 884, height: 972, hasCoarsePointer: true })
    ).toBe(336);
    expect(
      getServerSidebarMaxWidth({ width: 1000, height: 1000, hasCoarsePointer: true })
    ).toBe(FOLD_LIKE_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: 1176, height: 1176, hasCoarsePointer: true })
    ).toBe(FOLD_LIKE_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: 768, height: 960, hasCoarsePointer: true })
    ).toBe(288);
  });

  it('keeps the normal desktop cap for conventional tablet and desktop geometry', () => {
    expect(
      getServerSidebarMaxWidth({ width: 1024, height: 1366, hasCoarsePointer: true })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: 1024, height: 768, hasCoarsePointer: true })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: 1440, height: 900, hasCoarsePointer: false })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
  });

  it('does not apply the Fold cap to fine pointers or outside the medium viewport range', () => {
    expect(
      getServerSidebarMaxWidth({ width: 884, height: 972, hasCoarsePointer: false })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: 767, height: 767, hasCoarsePointer: true })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: 1281, height: 1281, hasCoarsePointer: true })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
  });

  it('fails safely for unavailable viewport measurements', () => {
    expect(
      getServerSidebarMaxWidth({ width: 0, height: 0, hasCoarsePointer: true })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
    expect(
      getServerSidebarMaxWidth({ width: Number.NaN, height: 900, hasCoarsePointer: true })
    ).toBe(SERVER_SIDEBAR_MAX_WIDTH);
  });
});
