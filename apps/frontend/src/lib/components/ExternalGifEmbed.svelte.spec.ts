import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import { loadLocaleMessages } from '$lib/i18n/messages';
import { setReactiveLocale } from '$lib/i18n/state.svelte';
import type { ExternalGifDescriptor } from '$lib/externalGif';
import testAnimationUrl from '../../../e2e/fixtures/test-animation.gif?url';
import testVideoUrl from '../../../e2e/fixtures/test-video.mp4?url';
import ExternalGifEmbed from './ExternalGifEmbed.svelte';

const giphy: ExternalGifDescriptor = {
  provider: 'giphy',
  providerLabel: 'GIPHY',
  canonicalUrl: 'https://giphy.com/gifs/reaction-l0MYt5jPR6QX5pnqM',
  resourceUrl: 'about:blank',
  renderMode: 'iframe',
  id: 'l0MYt5jPR6QX5pnqM'
};

const tenor: ExternalGifDescriptor = {
  provider: 'tenor',
  providerLabel: 'Tenor',
  canonicalUrl: 'https://media.tenor.com/AbCdEfGhIjK/tenor.gif',
  resourceUrl: testAnimationUrl,
  renderMode: 'image',
  id: 'AbCdEfGhIjK'
};

const tenorVideo: ExternalGifDescriptor = {
  ...tenor,
  canonicalUrl: 'https://media.tenor.com/m/AbCdEfGhIjK/AAAAC/tenor.mp4',
  resourceUrl: testVideoUrl,
  renderMode: 'video'
};

type MotionStub = {
  setReduced(value: boolean): void;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

function stubMotion(reduced = false, legacy = false): MotionStub {
  let matches = reduced;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const addListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
    listeners.add(listener);
  });
  const removeListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
    listeners.delete(listener);
  });
  const modernAdd = vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
    listeners.add(listener);
  });
  const modernRemove = vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
    listeners.delete(listener);
  });

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: legacy ? undefined : modernAdd,
      removeEventListener: legacy ? undefined : modernRemove,
      addListener,
      removeListener,
      dispatchEvent: vi.fn()
    }))
  );

  return {
    setReduced(value: boolean) {
      matches = value;
      const event = { matches: value } as MediaQueryListEvent;
      for (const listener of listeners) listener(event);
    },
    addListener,
    removeListener
  };
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

let visibility: DocumentVisibilityState;

beforeEach(async () => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  stubMotion(false);
  await loadLocaleMessages('en');
  setReactiveLocale('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ExternalGifEmbed', () => {
  it('requires a user gesture before contacting the provider by default', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: giphy } });
    const embed = screen.getByTestId('external-gif-embed');
    await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Open source' }))
      .toHaveAttribute('href', giphy.canonicalUrl);
    await expect.element(embed).toHaveAttribute('data-media-provider', 'giphy');
    expect(document.querySelector('iframe')).toBeNull();

    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const frame = document.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(giphy.resourceUrl);
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('allow')).toBe('autoplay');
    await expect.element(embed).toHaveAttribute('data-load-origin', 'manual');
  });

  it('renders direct images without provider HTML', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const image = document.querySelector('img');
    expect(image?.getAttribute('src')).toBe(tenor.resourceUrl);
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('marks video loaded at metadata so reduced-motion controls are usable', async () => {
    stubMotion(true);
    const screen = render(ExternalGifEmbed, { props: { gif: tenorVideo } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe(tenorVideo.resourceUrl);
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.autoplay).toBe(false);
    expect(video?.controls).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.getAttribute('preload')).toBe('metadata');

    video?.dispatchEvent(new Event('loadedmetadata'));
    await expect.element(screen.getByRole('button', { name: 'Hide' })).toBeVisible();
  });

  it('initializes reduced motion before auto-load can observe the element', async () => {
    stubMotion(true);
    const observe = vi.fn();
    class TrackingIntersectionObserver extends ImmediateIntersectionObserver {
      override observe(target: Element) {
        observe(target);
        super.observe(target);
      }
    }
    vi.stubGlobal('IntersectionObserver', TrackingIntersectionObserver);

    render(ExternalGifEmbed, { props: { gif: tenorVideo, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observe).not.toHaveBeenCalled();
    expect(document.querySelector('video')).toBeNull();
  });

  it('supports legacy MediaQueryList listeners without weakening the click gate', async () => {
    const motion = stubMotion(false, true);
    const rendered = render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: false } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(motion.addListener).toHaveBeenCalledOnce();
    motion.setReduced(true);
    expect(document.querySelector('img')).toBeNull();

    rendered.unmount();
    expect(motion.removeListener).toHaveBeenCalledOnce();
  });

  it('stops automatically loaded media when reduced motion becomes active', async () => {
    const motion = stubMotion(false);
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).not.toBeNull();

    motion.setReduced(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).toBeNull();
  });

  it('treats offline detection as a hint and still permits an explicit cache-backed load', async () => {
    vi.restoreAllMocks();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    stubMotion(false);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });

    await expect
      .element(screen.getByText('This external GIF may be unavailable while offline.'))
      .toBeVisible();
    const loadButton = screen.getByRole('button', { name: 'Load external GIF' });
    await expect.element(loadButton).toBeEnabled();
    await expect
      .element(screen.getByRole('link', { name: 'Open source' }))
      .toHaveAttribute('href', tenor.canonicalUrl);
    expect(document.querySelector('img')).toBeNull();

    await loadButton.click();
    const image = document.querySelector('img');
    expect(image).not.toBeNull();
    image?.dispatchEvent(new Event('load'));
    await expect.element(screen.getByRole('button', { name: 'Hide' })).toBeVisible();
  });

  it('keeps an in-flight manual request mounted when the network heuristic changes', async () => {
    let online = true;
    vi.restoreAllMocks();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
    stubMotion(false);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });

    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const image = document.querySelector('img');
    expect(image).not.toBeNull();

    online = false;
    window.dispatchEvent(new Event('offline'));
    expect(document.querySelector('img')).toBe(image);

    image?.dispatchEvent(new Event('error'));
    await expect
      .element(screen.getByText('This external GIF may be unavailable while offline.'))
      .toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it('auto-loads only near the viewport when the user opted in', async () => {
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('img')?.getAttribute('src')).toBe(tenor.resourceUrl);
    await expect
      .element(screen.getByTestId('external-gif-embed'))
      .toHaveAttribute('data-load-origin', 'auto');
  });

  it('keeps the explicit privacy gate when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('img')).toBeNull();
    await expect.element(screen.getByRole('button', { name: 'Load external GIF' })).toBeVisible();
  });

  it('does not initiate auto-load while the document is hidden', async () => {
    visibility = 'hidden';
    const observe = vi.fn();
    class TrackingIntersectionObserver extends ImmediateIntersectionObserver {
      override observe(target: Element) {
        observe(target);
        super.observe(target);
      }
    }
    vi.stubGlobal('IntersectionObserver', TrackingIntersectionObserver);

    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observe).not.toHaveBeenCalled();
    expect(document.querySelector('img')).toBeNull();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observe).toHaveBeenCalledOnce();
    expect(document.querySelector('img')?.getAttribute('src')).toBe(tenor.resourceUrl);
  });

  it('keeps successfully auto-loaded media mounted while the document is hidden', async () => {
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const image = document.querySelector('img');
    expect(image).not.toBeNull();
    image?.dispatchEvent(new Event('load'));

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).toBe(image);
  });

  it('cancels an in-flight automatic request when the document is hidden', async () => {
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).not.toBeNull();

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).toBeNull();
  });

  it('cancels an in-flight automatic request when the network heuristic turns offline', async () => {
    let online = true;
    vi.restoreAllMocks();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
    stubMotion(false);
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).not.toBeNull();

    online = false;
    window.dispatchEvent(new Event('offline'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).toBeNull();
  });

  it('keeps manually loaded media mounted when the document becomes hidden', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    expect(document.querySelector('img')).not.toBeNull();

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('img')).not.toBeNull();
  });

  it('rechecks page visibility when a queued intersection callback runs', async () => {
    const deferred: { callback?: IntersectionObserverCallback } = {};
    class DeferredIntersectionObserver extends ImmediateIntersectionObserver {
      constructor(next: IntersectionObserverCallback) {
        super(next);
        deferred.callback = next;
      }
      override observe() {}
    }
    vi.stubGlobal('IntersectionObserver', DeferredIntersectionObserver);

    render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callback = deferred.callback;
    expect(callback).toBeDefined();
    if (!callback) throw new Error('intersection callback was not registered');

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    callback(
      [{ isIntersecting: true, target: document.body } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
    expect(document.querySelector('img')).toBeNull();
  });

  it('ignores stale media events across a retry attempt', async () => {
    const screen = render(ExternalGifEmbed, { props: { gif: tenor } });
    const embed = screen.getByTestId('external-gif-embed');
    await screen.getByRole('button', { name: 'Load external GIF' }).click();
    const first = document.querySelector('img');
    first?.dispatchEvent(new Event('error'));

    await expect.element(screen.getByText('The external GIF could not be loaded.')).toBeVisible();
    await screen.getByRole('button', { name: 'Retry' }).click();
    const second = document.querySelector('img');
    expect(second).not.toBe(first);
    expect(second?.getAttribute('src')).toBe(tenor.resourceUrl);
    await expect.element(embed).toHaveAttribute('data-state', 'loading');

    first?.dispatchEvent(new Event('load'));
    await expect.element(embed).toHaveAttribute('data-state', 'loading');
    await expect.element(screen.getByRole('button', { name: 'Hide' })).not.toBeInTheDocument();

    second?.dispatchEvent(new Event('load'));
    await expect.element(embed).toHaveAttribute('data-state', 'loaded');
    await expect.element(screen.getByRole('button', { name: 'Hide' })).toBeVisible();

    first?.dispatchEvent(new Event('error'));
    await expect.element(embed).toHaveAttribute('data-state', 'loaded');
  });

  it('lets the reader hide a loaded animation without immediately auto-loading it again', async () => {
    const observe = vi.fn();
    class TrackingIntersectionObserver extends ImmediateIntersectionObserver {
      override observe(target: Element) {
        observe(target);
        super.observe(target);
      }
    }
    vi.stubGlobal('IntersectionObserver', TrackingIntersectionObserver);
    const screen = render(ExternalGifEmbed, { props: { gif: tenor, autoLoad: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.querySelector('img')?.dispatchEvent(new Event('load'));

    await screen.getByRole('button', { name: 'Hide' }).click();
    expect(document.querySelector('img')).toBeNull();
    expect(observe).toHaveBeenCalledOnce();
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
