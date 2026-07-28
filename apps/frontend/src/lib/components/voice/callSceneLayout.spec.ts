import { describe, expect, it } from 'vitest';
import {
  computeFilmstripCapacity,
  computeSceneGrid,
  resolveFeaturedShareKey,
  scenePage
} from './callSceneLayout';

describe('call scene container layout', () => {
  it('uses balanced participant shapes before reducing the visible page size', () => {
    expect(computeSceneGrid(360, 620, 9)).toEqual({
      capacity: 9,
      columns: 3,
      rows: 3,
      tileSize: 112
    });
    expect(computeSceneGrid(740, 520, 9)).toEqual({
      capacity: 9,
      columns: 3,
      rows: 3,
      tileSize: 165
    });
    expect(computeSceneGrid(1_200, 700, 9)).toEqual({
      capacity: 9,
      columns: 3,
      rows: 3,
      tileSize: 225
    });
    expect(computeSceneGrid(1_600, 900, 12)).toEqual({
      capacity: 12,
      columns: 4,
      rows: 3,
      tileSize: 292
    });
  });

  it('keeps one audio participant as a centered square instead of a full-width bar', () => {
    expect(computeSceneGrid(1_000, 700, 1)).toEqual({
      capacity: 1,
      columns: 1,
      rows: 1,
      tileSize: 700
    });
    expect(computeSceneGrid(360, 620, 1)).toEqual({
      capacity: 1,
      columns: 1,
      rows: 1,
      tileSize: 360
    });
  });

  it('uses conventional balanced shapes for common participant counts', () => {
    expect(computeSceneGrid(1_000, 700, 2)).toMatchObject({ columns: 2, rows: 1 });
    expect(computeSceneGrid(1_000, 700, 3)).toMatchObject({ columns: 2, rows: 2 });
    expect(computeSceneGrid(1_000, 700, 4)).toMatchObject({ columns: 2, rows: 2 });
    expect(computeSceneGrid(1_000, 700, 5)).toMatchObject({ columns: 3, rows: 2 });
    expect(computeSceneGrid(1_000, 700, 6)).toMatchObject({ columns: 3, rows: 2 });
    expect(computeSceneGrid(1_000, 700, 8)).toMatchObject({ columns: 3, rows: 3 });
    expect(computeSceneGrid(1_000, 700, 12)).toMatchObject({ columns: 4, rows: 3 });
    expect(computeSceneGrid(700, 1_000, 12)).toMatchObject({ columns: 3, rows: 4 });
    expect(computeSceneGrid(1_600, 900, 20)).toMatchObject({ columns: 5, rows: 4 });
  });

  it('keeps all four participants visible in a short landscape viewport', () => {
    expect(computeSceneGrid(360, 260, 4)).toEqual({
      capacity: 4,
      columns: 2,
      rows: 2,
      tileSize: 124
    });
  });

  it('paginates dense compact scenes only after preserving readable square tiles', () => {
    expect(computeSceneGrid(320, 230, 8)).toEqual({
      capacity: 4,
      columns: 2,
      rows: 2,
      tileSize: 109
    });
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
    expect(computeFilmstripCapacity(290, 376)).toBe(1);
  });
});
