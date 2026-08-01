import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { testSnippet } from '$lib/test-utils';
import ContextMenu from './ContextMenu.svelte';

describe('ContextMenu accessibility', () => {
  it('keeps the menu role and accessible name in sheet presentation', async () => {
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

    expect(dialog).not.toBeNull();
    expect(menu).not.toBeNull();
    await expect.element(dialog!).toHaveAttribute('aria-label', 'Message actions');
    await expect.element(menu!).toHaveAttribute('aria-label', 'Message actions');
  });
});
