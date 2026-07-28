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
const MAX_TILE_SIZE_PX = 520;

type GridCandidate = Omit<SceneGrid, 'capacity'>;

function bestSquareGrid(
  width: number,
  height: number,
  tileCount: number,
  maxColumns: number
): GridCandidate {
  let best: GridCandidate = {
    columns: 1,
    rows: Math.max(1, tileCount),
    tileSize: 1
  };
  let bestEmptySlots = Number.POSITIVE_INFINITY;

  for (let columns = 1; columns <= Math.min(maxColumns, tileCount); columns += 1) {
    const rows = Math.ceil(tileCount / columns);
    const tileWidth = (width - SCENE_GAP_PX * (columns - 1)) / columns;
    const tileHeight = (height - SCENE_GAP_PX * (rows - 1)) / rows;
    const tileSize = Math.max(1, Math.floor(Math.min(tileWidth, tileHeight, MAX_TILE_SIZE_PX)));
    const emptySlots = columns * rows - tileCount;

    if (
      tileSize > best.tileSize ||
      (tileSize === best.tileSize && emptySlots < bestEmptySlots) ||
      (tileSize === best.tileSize && emptySlots === bestEmptySlots && columns < best.columns)
    ) {
      best = { columns, rows, tileSize };
      bestEmptySlots = emptySlots;
    }
  }

  return best;
}

export function computeSceneGrid(width: number, height: number, tileCount: number): SceneGrid {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const count = Math.max(1, tileCount);
  const classLimit = safeWidth < 520 ? 4 : safeWidth < 800 ? 6 : 12;
  const maxColumns = safeWidth < 520 ? 2 : safeWidth < 900 ? 3 : 4;
  const minimumTileSize = safeWidth < 520 ? 144 : safeWidth < 900 ? 156 : 180;
  let capacity = Math.max(1, Math.min(count, classLimit));
  let grid = bestSquareGrid(safeWidth, safeHeight, capacity, maxColumns);

  while (capacity > 1 && grid.tileSize < minimumTileSize) {
    capacity -= 1;
    grid = bestSquareGrid(safeWidth, safeHeight, capacity, maxColumns);
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
