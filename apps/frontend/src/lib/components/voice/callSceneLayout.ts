export type SceneGrid = {
  capacity: number;
  columns: number;
  rows: number;
  tileSize: number;
};

export type ScenePage<T> = {
  items: T[];
  page: number;
  pageCount: number;
};

const SCENE_GAP_PX = 12;

type GridCandidate = Omit<SceneGrid, 'capacity'>;

function balancedGridShape(
  tileCount: number,
  orientation: 'landscape' | 'portrait'
): Pick<GridCandidate, 'columns' | 'rows'> {
  if (tileCount <= 1) return { columns: 1, rows: 1 };
  if (tileCount === 2) {
    return orientation === 'landscape' ? { columns: 2, rows: 1 } : { columns: 1, rows: 2 };
  }
  if (tileCount <= 4) return { columns: 2, rows: 2 };
  if (tileCount <= 6) {
    return orientation === 'landscape' ? { columns: 3, rows: 2 } : { columns: 2, rows: 3 };
  }
  if (tileCount <= 9) return { columns: 3, rows: 3 };
  if (tileCount <= 12) {
    return orientation === 'landscape' ? { columns: 4, rows: 3 } : { columns: 3, rows: 4 };
  }
  if (tileCount <= 16) return { columns: 4, rows: 4 };
  if (tileCount <= 20) {
    return orientation === 'landscape' ? { columns: 5, rows: 4 } : { columns: 4, rows: 5 };
  }

  const shortAxis = Math.max(1, Math.floor(Math.sqrt(tileCount)));
  const longAxis = Math.ceil(tileCount / shortAxis);
  return orientation === 'landscape'
    ? { columns: longAxis, rows: shortAxis }
    : { columns: shortAxis, rows: longAxis };
}

function squareGrid(width: number, height: number, tileCount: number): GridCandidate {
  const shape = balancedGridShape(tileCount, width >= height ? 'landscape' : 'portrait');
  const tileWidth = (width - SCENE_GAP_PX * (shape.columns - 1)) / shape.columns;
  const tileHeight = (height - SCENE_GAP_PX * (shape.rows - 1)) / shape.rows;
  return {
    ...shape,
    tileSize: Math.max(1, Math.floor(Math.min(tileWidth, tileHeight)))
  };
}

function minimumReadableTileSize(width: number, height: number): number {
  const shortestAxis = Math.min(width, height);
  if (shortestAxis < 360) return 104;
  if (width < 520) return 112;
  if (width < 900) return 132;
  return 160;
}

export function computeSceneGrid(width: number, height: number, tileCount: number): SceneGrid {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const count = Math.max(1, tileCount);
  const minimumTileSize = minimumReadableTileSize(safeWidth, safeHeight);
  let capacity = count;
  let grid = squareGrid(safeWidth, safeHeight, capacity);

  while (capacity > 1 && grid.tileSize < minimumTileSize) {
    capacity -= 1;
    grid = squareGrid(safeWidth, safeHeight, capacity);
  }

  return { capacity, ...grid };
}

export function computeFilmstripCapacity(width: number, _height: number): number {
  const safeWidth = Math.max(1, width);
  const classLimit = safeWidth < 520 ? 2 : safeWidth < 900 ? 3 : 6;
  const minimumTileWidth = safeWidth < 520 ? 144 : safeWidth < 900 ? 156 : 180;
  const horizontalSlots = Math.max(
    1,
    Math.floor((safeWidth + SCENE_GAP_PX) / (minimumTileWidth + SCENE_GAP_PX))
  );
  return Math.min(classLimit, horizontalSlots);
}

export function scenePage<T>(
  items: readonly T[],
  capacity: number,
  requestedPage: number
): ScenePage<T> {
  const safeCapacity = Math.max(1, Math.floor(capacity));
  const pageCount = Math.max(1, Math.ceil(items.length / safeCapacity));
  const page = Math.max(0, Math.min(Math.floor(requestedPage), pageCount - 1));
  const start = page * safeCapacity;
  return {
    items: items.slice(start, start + safeCapacity),
    page,
    pageCount
  };
}

export function resolveFeaturedShareKey(
  screenShareKeys: readonly string[],
  manuallyFocusedKey: string | null
): string | null {
  if (manuallyFocusedKey && screenShareKeys.includes(manuallyFocusedKey)) {
    return manuallyFocusedKey;
  }
  return screenShareKeys[0] ?? null;
}
