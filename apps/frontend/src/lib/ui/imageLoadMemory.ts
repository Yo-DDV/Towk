const loadedImageSources = new Set<string>();

export function rememberLoadedImageSource(src: string | null | undefined): void {
  if (typeof src !== 'string' || src.length === 0) return;
  loadedImageSources.add(src);
}

export function hasLoadedImageSource(src: string | null | undefined): boolean {
  return typeof src === 'string' && loadedImageSources.has(src);
}

export function clearLoadedImageSourcesForTest(): void {
  loadedImageSources.clear();
}
