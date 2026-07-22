const loadedImageSources = new Set<string>();

function imageMemoryKey(src: string): string {
  try {
    const base = typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'http://localhost/';
    const url = new URL(src, base);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return src;
  }
}

export function rememberLoadedImageSource(src: string | null | undefined): void {
  if (typeof src !== 'string' || src.length === 0) return;
  loadedImageSources.add(imageMemoryKey(src));
}

export function hasLoadedImageSource(src: string | null | undefined): boolean {
  return typeof src === 'string' && loadedImageSources.has(imageMemoryKey(src));
}

export function clearLoadedImageSourcesForTest(): void {
  loadedImageSources.clear();
}
