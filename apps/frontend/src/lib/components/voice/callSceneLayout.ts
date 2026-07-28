export type SceneGrid = {
  capacity: number;
  columns: number;
};

export type ScenePage<T> = {
  items: T[];
  page: number;
  pageCount: number;
};

export function computeSceneGrid(width: number, height: number, tileCount: number): SceneGrid {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const count = Math.max(1, tileCount);

  let columns: number;
  if (count === 1 || safeWidth < 520) columns = 1;
  else if (count <= 4) columns = 2;
  else if (count <= 6) columns = safeWidth >= 960 ? 3 : 2;
  else if (count <= 9) columns = safeWidth >= 900 ? 3 : 2;
  else columns = safeWidth >= 1_280 ? 4 : 3;

  const rowHeight = safeWidth < 520 ? 130 : 160;
  const rows = Math.max(1, Math.floor(safeHeight / rowHeight));
  const classLimit = safeWidth < 520 ? 4 : safeWidth < 800 ? 6 : 12;
  const capacity = Math.max(1, Math.min(count, classLimit, columns * rows));

  return {
    capacity,
    columns: Math.min(columns, count, capacity)
  };
}

export function computeFilmstripCapacity(width: number, height: number): number {
  if (height < 420) return 2;
  if (width < 520) return 2;
  if (width < 900) return 3;
  return Math.max(3, Math.min(6, Math.floor(width / 220)));
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
