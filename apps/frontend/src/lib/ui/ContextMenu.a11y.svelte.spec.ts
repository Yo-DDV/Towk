import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { testSnippet } from '$lib/test-utils';
import ContextMenu from './ContextMenu.svelte';

describe('ContextMenu accessibility', () => {
  it('keeps a named menu inside the named sheet dialog', async () => {
    const { container } = render(ContextMenu, {
      props: {
        presentation: 'sheet',
        ariaLabel: 'Message actions',
        onclose: vi.fn(),
        children: testSnippet('<button type="button" role="menuitem">Reply</button>')
      }
    });

    const dialog = container.querySelector('dialog');
    const menu = container.querySelector('[role="menu"]');
    const item = container.querySelector('[role="menuitem"]');

    expect(dialog).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(item).not.toBeNull();
    await expect.element(dialog!).toHaveAttribute('aria-label', 'Message actions');
    await expect.element(menu!).toHaveAttribute('aria-label', 'Message actions');
    await expect.element(item!).toHaveAttribute('tabindex', '0');
  });
});
