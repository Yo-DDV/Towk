import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import type { ExternalGifDescriptor } from '$lib/externalGif';
import ExternalGifEmbed from './ExternalGifEmbed.svelte';

const giphy: ExternalGifDescriptor = {
  provider: 'giphy',
  providerLabel: 'GIPHY',
  canonicalUrl: 'https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM',
  resourceUrl: 'https://giphy.com/embed/l0MYt5jPR6QX5pnqM',
  renderMode: 'iframe',
  id: 'l0MYt5jPR6QX5pnqM'
};

const tenor: ExternalGifDescriptor = {
  provider: 'tenor',
  providerLabel: 'Tenor',
  canonicalUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
  resourceUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
  renderMode: 'image',
  id: 'AbCdEfGhIjK'
};

const tenorVideo: ExternalGifDescriptor = {
  ...tenor,
  canonicalUrl: 'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4',
  resourceUrl: 'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4',
  renderMode: 'video'
};

function stubMotion(reduced = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: reduced,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  );
}

class ImmediateIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '400px 0px';
  thresholds = [0];
}

const trackedIntersectionObserve = vi.fn();

class TrackingIntersectionObserver extends ImmediateIntersectionObserver {
  override observe(target: Element) {
    trackedIntersectionObserve(target);
    super.observe(target);
  }
}

beforeEach(() => {
  trackedIntersectionObserve.mockReset();
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  stubMotion(false);
  setReactiveLocale('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ExternalGifEmbed', () => {
  it('requires a user gesture before contacting the provider by default', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: giphy } });
    await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Open source' }))
      .toHaveAttribute('href', giphy.canonicalUrl);
    expect(document.querySelector('iframe')).toBeNull();

    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const frame = document.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(giphy.resourceUrl);
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('allow')).toBe('autoplay');
  });

  it('renders direct images without provider HTML', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const image = document.querySelector('img');
    expect(image?.getAttribute('src')).toBe(tenor.resourceUrl);
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders video renditions as silent inline loops with bounded preloading', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenorVideo } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe(tenorVideo.resourceUrl);
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.getAttribute('preload')).toBe('metadata');
  });

  it('does not auto-load when reduced motion is requested', async () => {
    stubMotion(true);
    vi.stubGlobal('IntersectionObserver', TrackingIntersectionObserver);

    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(trackedIntersectionObserve).not.toHaveBeenCalled();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows a non-loading offline placeholder and keeps the source available', async () => {
    vi.restoreAllMocks();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    stubMotion(false);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });

    await expect
      .element(screen.getByText('This external GIF is unavailable while offline.'))
      .toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeDisabled();
    await expect
      .element(screen.getByRole('link', { name: 'Open source' }))
      .toHaveAttribute('href', tenor.canonicalUrl);
    expect(document.querySelector('img')).toBeNull();
  });

  it('moves an in-flight request to the offline failure state', async () => {
    let online = true;
    vi.restoreAllMocks();
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
    stubMotion(false);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });

    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    expect(document.querySelector('img')).not.toBeNull();

    online = false;
    window.dispatchEvent(new Event('offline'));
    await expect
      .element(screen.getByText('This external GIF is unavailable while offline.'))
      .toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('auto-loads near the viewport when the user opted in', async () => {
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')?.getAttribute('src')).toBe(tenor.resourceUrl);
  });

  it('falls back to immediate auto-load when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')?.getAttribute('src')).toBe(tenor.resourceUrl);
  });

  it('offers retry after a provider load error', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    document.querySelector('img')?.dispatchEvent(new Event('error'));

    await expect.element(screen.getByText('The external GIF could not be loaded.')).toBeVisible();
    await screen.getByRole('button', { name: 'Retry' }).click();
    expect(document.querySelector('img')?.getAttribute('src')).toBe(tenor.resourceUrl);
  });

  it('lets the reader hide a loaded animation', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    document.querySelector('img')?.dispatchEvent(new Event('load'));

    await screen.getByRole('button', { name: 'Hide' }).click();
    expect(document.querySelector('img')).toBeNull();
    await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
  });

  it('resets before a virtualized row renders a different provider resource', async () => {
    const rendered = render(ExternalGifEmbed, { props: { gif: tenor } });
    await rendered.getByRole('button', { name: 'Load external GIF' }).click();
    expect(document.querySelector('img')).not.toBeNull();

    await rendered.rerender({ gif: giphy });

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    await expect.element(rendered.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
  });
});
