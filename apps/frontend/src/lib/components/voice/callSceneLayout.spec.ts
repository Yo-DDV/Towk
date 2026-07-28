import { describe, expect, it } from 'vitest';
import {
  computeFilmstripCapacity,
  computeSceneGrid,
  resolveFeaturedShareKey,
  scenePage
} from './callSceneLayout';

describe('call scene container layout', () => {
  it('bounds phone, tablet and desktop video mounts from the actual container', () => {
    expect(computeSceneGrid(360, 620, 9)).toEqual({ capacity: 4, columns: 1 });
    expect(computeSceneGrid(740, 520, 9)).toEqual({ capacity: 6, columns: 2 });
    expect(computeSceneGrid(1_200, 700, 9)).toEqual({ capacity: 9, columns: 3 });
    expect(computeSceneGrid(1_600, 900, 12)).toEqual({ capacity: 12, columns: 4 });
  });

  it('keeps balanced gallery columns for common participant counts', () => {
    expect(computeSceneGrid(1_000, 700, 1).columns).toBe(1);
    expect(computeSceneGrid(1_000, 700, 2).columns).toBe(2);
    expect(computeSceneGrid(1_000, 700, 4).columns).toBe(2);
    expect(computeSceneGrid(1_000, 700, 6).columns).toBe(3);
  });

  it('clamps pagination when the scene shrinks or participants leave', () => {
    expect(scenePage(['a', 'b', 'c', 'd', 'e'], 2, 9)).toEqual({
      items: ['e'],
      page: 2,
      pageCount: 3
    });
    expect(scenePage(['a'], 4, 2)).toEqual({ items: ['a'], page: 0, pageCount: 1 });
  });

  it('keeps a manual screen focus when a new share appears and falls back deterministically', () => {
    expect(resolveFeaturedShareKey(['share-a', 'share-b'], 'share-b')).toBe('share-b');
    expect(resolveFeaturedShareKey(['share-new', 'share-a', 'share-b'], 'share-b')).toBe('share-b');
    expect(resolveFeaturedShareKey(['share-a'], 'share-b')).toBe('share-a');
    expect(resolveFeaturedShareKey([], 'share-b')).toBeNull();
  });

  it('keeps the filmstrip mount budget small on constrained containers', () => {
    expect(computeFilmstripCapacity(360, 700)).toBe(2);
    expect(computeFilmstripCapacity(800, 700)).toBe(3);
    expect(computeFilmstripCapacity(1_400, 700)).toBe(6);
  });
});
