import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { getToasts, toast } from '$lib/ui/toast';
import NetworkStatusNotifier from './NetworkStatusNotifier.svelte';

describe('NetworkStatusNotifier', () => {
  beforeEach(() => toast.clear());
  afterEach(() => toast.clear());

  it('keeps one offline notice and replaces it with a reconnecting notice', async () => {
    const view = render(NetworkStatusNotifier);
    await tick();

    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('offline'));
    await tick();

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({
      tone: 'warning',
      message: "You're offline. Towk will keep trying to reconnect."
    });

    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await tick();

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({
      tone: 'success',
      message: 'Network available. Reconnecting Towk…'
    });

    view.unmount();
  });

  it('lets the login page own its full-screen offline state', async () => {
    const originalPath = `${location.pathname}${location.search}${location.hash}`;
    history.replaceState({}, '', '/login');
    const view = render(NetworkStatusNotifier);

    try {
      await tick();
      window.dispatchEvent(new Event('offline'));
      await tick();

      expect(getToasts()).toHaveLength(0);
    } finally {
      view.unmount();
      history.replaceState({}, '', originalPath);
    }
  });
});
