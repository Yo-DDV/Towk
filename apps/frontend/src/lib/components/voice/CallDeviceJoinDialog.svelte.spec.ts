import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../app.css';
import CallDeviceJoinDialog from './CallDeviceJoinDialog.svelte';

describe('CallDeviceJoinDialog', () => {
  it('offers companion and transfer when one device is connected', async () => {
    const oncompanion = vi.fn();
    const ontransfer = vi.fn();
    const { container } = render(CallDeviceJoinDialog, {
      props: {
        visible: true,
        companionAllowed: true,
        canShareScreen: true,
        oncompanion,
        ontransfer
      }
    });

    const companion = container.querySelector(
      '[data-testid="call-join-companion"]'
    ) as HTMLButtonElement;
    const transfer = container.querySelector(
      '[data-testid="call-join-transfer"]'
    ) as HTMLButtonElement;

    expect(companion.disabled).toBe(false);
    expect(transfer.disabled).toBe(false);
    companion.click();
    transfer.click();
    expect(oncompanion).toHaveBeenCalledOnce();
    expect(ontransfer).toHaveBeenCalledOnce();
  });

  it('does not promise screen sharing when mobile web capture is unavailable', () => {
    const { container } = render(CallDeviceJoinDialog, {
      props: {
        visible: true,
        companionAllowed: true,
        canShareScreen: false,
        oncompanion: vi.fn(),
        ontransfer: vi.fn()
      }
    });

    expect(container.textContent).toContain('You can still use your camera.');
    expect(container.textContent).not.toContain('share your screen');
  });

  it('blocks a third companion but still offers transfer', () => {
    const { container } = render(CallDeviceJoinDialog, {
      props: {
        visible: true,
        companionAllowed: false,
        canShareScreen: false,
        oncompanion: vi.fn(),
        ontransfer: vi.fn()
      }
    });

    expect(
      (container.querySelector('[data-testid="call-join-companion"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (container.querySelector('[data-testid="call-join-transfer"]') as HTMLButtonElement).disabled
    ).toBe(false);
    expect(container.textContent).toContain('Two devices are already connected');
  });
});
