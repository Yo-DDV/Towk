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

function squareGrid(width: number, height: number, tileCount: number): GridCandidate {
  const candidates = Array.from({ length: tileCount }, (_, index) => {
    const columns = index + 1;
    const rows = Math.ceil(tileCount / columns);
    const tileWidth = (width - SCENE_GAP_PX * (columns - 1)) / columns;
    const tileHeight = (height - SCENE_GAP_PX * (rows - 1)) / rows;
    return {
      columns,
      rows,
      tileSize: Math.max(1, Math.floor(Math.min(tileWidth, tileHeight))),
      emptySlots: columns * rows - tileCount
    };
  });
  const largestTile = Math.max(...candidates.map((candidate) => candidate.tileSize));
  const nearLargest = candidates.filter((candidate) => candidate.tileSize >= largestTile * 0.96);
  nearLargest.sort(
    (left, right) =>
      left.emptySlots - right.emptySlots || right.tileSize - left.tileSize || left.rows - right.rows
  );
  const selected = nearLargest[0];
  return {
    columns: selected.columns,
    rows: selected.rows,
    tileSize: selected.tileSize
  };
}

function minimumReadableTileSize(width: number, height: number): number {
  const shortestAxis = Math.min(width, height);
  if (height < 360) return width >= 640 ? 144 : 124;
  if (width < 360) return 132;
  if (shortestAxis < 520) return 144;
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

export function computeFilmstripTileWidth(width: number, columns: number): number {
  const safeWidth = Math.max(1, width);
  const safeColumns = Math.max(1, Math.floor(columns));
  const availableWidth = Math.max(1, safeWidth - SCENE_GAP_PX * (safeColumns - 1));
  const maximumTileWidth = safeWidth >= 3_200 ? 720 : safeWidth >= 2_400 ? 560 : 420;
  return Math.min(maximumTileWidth, Math.max(1, Math.floor(availableWidth / safeColumns)));
}

export function computeFilmstripMaxHeight(width: number, height: number): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const minimumHeight =
    safeWidth < 300 ? (safeHeight >= 420 ? 160 : 144) : safeWidth >= 900 ? 180 : 120;
  const maximumHeight = safeWidth >= 2_400 ? 320 : 210;
  return Math.max(minimumHeight, Math.min(maximumHeight, Math.floor(safeHeight * 0.28)));
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
