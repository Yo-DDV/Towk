import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { testSnippet } from '$lib/test-utils';
import BottomSheet from './BottomSheet.svelte';

describe('BottomSheet', () => {
  it('exposes the accessible name supplied by the caller', async () => {
    const { container } = render(BottomSheet, {
      props: {
        visible: true,
        ariaLabel: 'Message actions',
        children: testSnippet('<p>Actions</p>')
      }
    });

    const dialog = container.querySelector('dialog');

    expect(dialog).not.toBeNull();
    await expect.element(dialog!).toHaveAttribute('aria-label', 'Message actions');
  });
});
