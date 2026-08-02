import { describe, expect, it } from 'vitest';
import {
  computeFilmstripCapacity,
  computeFilmstripMaxHeight,
  computeFilmstripTileWidth,
  computeSceneGrid,
  resolveFeaturedShareKey,
  scenePage
} from './callSceneLayout';

describe('call scene container layout', () => {
  it('uses balanced participant shapes before reducing the visible page size', () => {
    expect(computeSceneGrid(360, 620, 9)).toEqual({
      capacity: 8,
      columns: 2,
      rows: 4,
      tileSize: 146
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
    expect(computeSceneGrid(1_000, 700, 8)).toMatchObject({ columns: 4, rows: 2 });
    expect(computeSceneGrid(1_000, 700, 12)).toMatchObject({ columns: 4, rows: 3 });
    expect(computeSceneGrid(700, 1_000, 12)).toMatchObject({ columns: 3, rows: 4 });
    expect(computeSceneGrid(1_600, 900, 20)).toMatchObject({ columns: 5, rows: 4 });
  });

  it('keeps two participants side by side in near-square desktop call regions', () => {
    expect(computeSceneGrid(752, 776, 2)).toEqual({
      capacity: 2,
      columns: 2,
      rows: 1,
      tileSize: 370
    });
    expect(computeSceneGrid(700, 760, 2)).toEqual({
      capacity: 2,
      columns: 2,
      rows: 1,
      tileSize: 344
    });
    expect(computeSceneGrid(752, 840, 2)).toEqual({
      capacity: 2,
      columns: 2,
      rows: 1,
      tileSize: 370
    });
  });

  it('preserves a vertical two-participant stack when portrait space materially improves readability', () => {
    expect(computeSceneGrid(390, 700, 2)).toEqual({
      capacity: 2,
      columns: 1,
      rows: 2,
      tileSize: 344
    });
  });

  it('keeps both dense two-device cards visible when only the vertical shape is readable', () => {
    expect(computeSceneGrid(400, 460, 2, 220)).toEqual({
      capacity: 2,
      columns: 1,
      rows: 2,
      tileSize: 224
    });
  });

  it('keeps every adaptive grid inside representative viewport bounds', () => {
    for (const width of [280, 320, 390, 640, 844, 1_280, 1_920, 3_840]) {
      for (const height of [219, 300, 360, 568, 720, 1_080, 2_160]) {
        for (let participantCount = 1; participantCount <= 20; participantCount += 1) {
          const grid = computeSceneGrid(width, height, participantCount);
          expect(grid.capacity).toBeGreaterThanOrEqual(1);
          expect(grid.capacity).toBeLessThanOrEqual(participantCount);
          expect(grid.columns * grid.rows).toBeGreaterThanOrEqual(grid.capacity);
          expect(grid.columns * grid.tileSize + (grid.columns - 1) * 12).toBeLessThanOrEqual(width);
          expect(grid.rows * grid.tileSize + (grid.rows - 1) * 12).toBeLessThanOrEqual(height);
        }
      }
    }
  });

  it('keeps all four participants visible in a short landscape viewport', () => {
    expect(computeSceneGrid(360, 260, 4)).toEqual({
      capacity: 4,
      columns: 2,
      rows: 2,
      tileSize: 124
    });
  });

  it('paginates very short scenes before tactile footer controls are clipped', () => {
    expect(computeSceneGrid(320, 230, 8)).toEqual({
      capacity: 2,
      columns: 2,
      rows: 1,
      tileSize: 154
    });
    expect(computeSceneGrid(687, 348, 12)).toEqual({
      capacity: 8,
      columns: 4,
      rows: 2,
      tileSize: 162
    });
    expect(computeSceneGrid(812, 219, 9)).toEqual({
      capacity: 5,
      columns: 5,
      rows: 1,
      tileSize: 152
    });
    expect(computeSceneGrid(812, 219, 3)).toEqual({
      capacity: 3,
      columns: 3,
      rows: 1,
      tileSize: 219
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

  it('reserves wider equal tiles when a participant card exposes two device controls', () => {
    expect(computeFilmstripCapacity(720, 780, 220)).toBe(3);
    expect(computeFilmstripTileWidth(720, 3)).toBe(232);
    expect(computeFilmstripCapacity(640, 780, 220)).toBe(2);
    expect(computeSceneGrid(390, 700, 4, 220)).toMatchObject({
      capacity: 3,
      columns: 1,
      rows: 3
    });
  });

  it('paginates dense portrait galleries before 44px controls crowd the media', () => {
    expect(computeSceneGrid(390, 700, 12)).toEqual({
      capacity: 8,
      columns: 2,
      rows: 4,
      tileSize: 166
    });
    expect(computeSceneGrid(320, 568, 4)).toEqual({
      capacity: 4,
      columns: 2,
      rows: 2,
      tileSize: 154
    });
  });

  it('uses the available filmstrip width without producing oversized companion cards', () => {
    expect(computeFilmstripTileWidth(360, 2)).toBe(174);
    expect(computeFilmstripTileWidth(1_920, 2)).toBe(560);
    expect(computeFilmstripTileWidth(2_560, 2)).toBe(720);
    expect(computeFilmstripTileWidth(3_840, 2)).toBe(960);
    expect(computeFilmstripTileWidth(1_200, 4)).toBe(291);
    expect(computeFilmstripTileWidth(1_920, 4)).toBe(420);
    expect(computeFilmstripTileWidth(2_560, 3)).toBe(560);
    expect(computeFilmstripTileWidth(3_840, 4)).toBe(720);
  });

  it('scales the filmstrip height on high-density desktop canvases', () => {
    expect(computeFilmstripMaxHeight(280, 449)).toBe(160);
    expect(computeFilmstripMaxHeight(290, 364)).toBe(144);
    expect(computeFilmstripMaxHeight(320, 390)).toBe(160);
    expect(computeFilmstripMaxHeight(1_920, 1_000)).toBe(210);
    expect(computeFilmstripMaxHeight(1_280, 550)).toBe(180);
    expect(computeFilmstripMaxHeight(2_560, 1_300)).toBe(320);
    expect(computeFilmstripMaxHeight(3_840, 2_000)).toBe(320);
  });
});
