import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ComposerLinkPreview } from '$lib/api-client/linkPreviews';
import { LinkPreviewState } from './linkPreviews.svelte';

type FetchLinkPreview = (url: string) => Promise<ComposerLinkPreview | null>;

function apiWithFetch(fetchLinkPreview: FetchLinkPreview) {
  return { fetchLinkPreview };
}

describe('LinkPreviewState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch OpenGraph data for Towk message links', async () => {
    vi.useFakeTimers();
    const fetchLinkPreview = vi.fn<FetchLinkPreview>();
    const state = new LinkPreviewState(() => apiWithFetch(fetchLinkPreview));

    const cleanup = state.scheduleDetection(
      'See http://localhost/chat/-/room_456/m/evt_123',
      false
    );
    await vi.advanceTimersByTimeAsync(500);
    cleanup();

    expect(state.detectedURLs).toEqual(['http://localhost/chat/-/room_456/m/evt_123']);
    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });

  it('does not ask the server to fetch supported external GIF providers', async () => {
    vi.useFakeTimers();
    const fetchLinkPreview = vi.fn<FetchLinkPreview>();
    const state = new LinkPreviewState(() => apiWithFetch(fetchLinkPreview));

    for (const url of [
      'https://giphy.com/gifs/reaction-happy-l0MYt5jPR6QX5pnqM',
      'https://media4.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.webp',
      'https://media1.tenor.com/m/2wdlar795ZAAAAAd/example-content-url.gif'
    ]) {
      const cleanup = state.scheduleDetection(url, false);
      await vi.advanceTimersByTimeAsync(500);
      cleanup();

      expect(state.detectedURLs).toEqual([url]);
    }

    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });

  it('does not fetch previews for ignored markdown URL regions or non-http URLs', async () => {
    vi.useFakeTimers();
    const fetchLinkPreview = vi.fn<FetchLinkPreview>();
    const state = new LinkPreviewState(() => apiWithFetch(fetchLinkPreview));

    for (const message of [
      '`https://example.com`',
      '\\`https://example.com\\`',
      '```\nhttps://example.com\n```',
      '> https://example.com',
      'mail user@example.com',
      'ftp://example.com/file'
    ]) {
      const cleanup = state.scheduleDetection(message, false);
      await vi.advanceTimersByTimeAsync(500);
      cleanup();

      expect(state.detectedURLs).toEqual([]);
    }

    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });

  it('fetches non-message links and converts the active preview into mutation input', async () => {
    vi.useFakeTimers();
    const url = 'https://example.com/story';
    const fetchLinkPreview = vi.fn<FetchLinkPreview>().mockResolvedValue({
      url,
      previewToken: 'cht_LPpreviewtoken',
      title: 'Preview title',
      description: 'Preview description',
      imageUrl: null,
      siteName: 'Preview site',
      embedType: null,
      embedId: null,
      imageAssetId: 'asset_preview'
    });
    const state = new LinkPreviewState(() => apiWithFetch(fetchLinkPreview));

    const cleanup = state.scheduleDetection(`Look ${url}`, false);
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(fetchLinkPreview).toHaveBeenCalledOnce());
    cleanup();

    expect(state.buildInput()).toMatchObject({
      previewToken: 'cht_LPpreviewtoken'
    });
  });

  it('dismisses active URLs and clears preview state', async () => {
    const state = new LinkPreviewState(() => apiWithFetch(vi.fn<FetchLinkPreview>()));
    state.detectedURLs = ['https://example.com'];
    state.previews.set('https://example.com', null);
    state.fetchingURLs.add('https://example.com');

    state.dismissPreview('https://example.com');
    expect(state.detectedURLs).toEqual([]);
    expect(state.dismissedURLs.has('https://example.com')).toBe(true);

    state.clear();
    expect(state.previews.size).toBe(0);
    expect(state.fetchingURLs.size).toBe(0);
    expect(state.dismissedURLs.size).toBe(0);
  });
});
