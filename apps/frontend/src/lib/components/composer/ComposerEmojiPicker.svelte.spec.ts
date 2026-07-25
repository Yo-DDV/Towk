import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync, tick } from 'svelte';
import ComposerEmojiPicker from './ComposerEmojiPicker.svelte';
import { EMOJI_BY_CATEGORY } from '$lib/emoji';
import { __resetRecentEmojisForTests } from '$lib/state/recentEmojis.svelte';

const TEST_SERVER_ID = 'composer-emoji-picker-test';

function renderPicker(props: { onSelect?: (emoji: string) => void; onClose?: () => void } = {}) {
  return render(ComposerEmojiPicker, {
    props: {
      serverId: TEST_SERVER_ID,
      onSelect: props.onSelect ?? (() => {}),
      onClose: props.onClose ?? (() => {})
    }
  });
}

function searchInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('[data-testid="emoji-picker-search"]');
  if (!input) throw new Error('emoji search input not found');
  return input;
}

function emojiButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-testid="emoji-picker-grid"] button')
  );
}

async function setSearch(container: HTMLElement, value: string) {
  const input = searchInput(container);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await tick();
}

beforeEach(() => {
  localStorage.clear();
  __resetRecentEmojisForTests();
});

describe('ComposerEmojiPicker', () => {
  it('opens on the first category and renders only that category grid', async () => {
    const { container } = renderPicker();
    flushSync();
    await tick();

    expect(container.textContent).toContain(EMOJI_BY_CATEGORY[0]?.name);
    expect(emojiButtons(container).length).toBe(EMOJI_BY_CATEGORY[0]?.emojis.length);
    expect(emojiButtons(container).length).toBeLessThan(
      EMOJI_BY_CATEGORY.reduce((total, category) => total + category.emojis.length, 0)
    );
  });

  it('searches by shortcode, previews it on hover, and selects the emoji', async () => {
    const onSelect = vi.fn();
    const { container } = renderPicker({ onSelect });
    await setSearch(container, ':rocket:');

    const rocketButton = emojiButtons(container).find((button) => button.title === ':rocket:');
    if (!rocketButton) throw new Error('rocket emoji not found');

    rocketButton.dispatchEvent(new PointerEvent('pointerenter'));
    flushSync();
    await tick();

    expect(
      container.querySelector('[data-testid="emoji-picker-preview-name"]')?.textContent?.trim()
    ).toBe('Rocket');
    expect(
      container.querySelector('[data-testid="emoji-picker-preview-shortcode"]')?.textContent?.trim()
    ).toBe(':rocket:');

    rocketButton.click();
    expect(onSelect).toHaveBeenCalledWith('🚀');
  });

  it('moves through the result grid with arrow, Home, and End keys', async () => {
    const { container } = renderPicker();
    await setSearch(container, 'face');

    const input = searchInput(container);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    await tick();

    const buttons = emojiButtons(container);
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
    await tick();
    expect(document.activeElement).toBe(buttons[1]);

    buttons[1]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })
    );
    await tick();
    expect(document.activeElement).toBe(buttons.at(-1));

    buttons.at(-1)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    );
    await tick();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('clears a search before Escape closes the picker', async () => {
    const onClose = vi.fn();
    const { container } = renderPicker({ onClose });
    const input = searchInput(container);
    await setSearch(container, 'smile');

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    flushSync();
    await tick();

    expect(input.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from category navigation with Escape', async () => {
    const onClose = vi.fn();
    const { container } = renderPicker({ onClose });
    flushSync();
    await tick();

    const categoryButton = container.querySelector<HTMLButtonElement>('[role="toolbar"] button');
    if (!categoryButton) throw new Error('emoji category button not found');
    categoryButton.focus();
    categoryButton.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leads with per-server recent emojis when available', async () => {
    localStorage.setItem(
      `chatto:i:${TEST_SERVER_ID}:recentEmojis`,
      JSON.stringify(['🚀', '🔥'])
    );

    const { container } = renderPicker();
    flushSync();
    await tick();

    expect(container.textContent).toContain('Recently Used');
    expect(emojiButtons(container)[0]?.textContent?.trim()).toBe('🚀');
    expect(emojiButtons(container)[1]?.textContent?.trim()).toBe('🔥');
  });
});
