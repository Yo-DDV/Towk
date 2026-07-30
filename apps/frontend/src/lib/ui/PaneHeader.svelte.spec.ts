import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../app.css';
import PaneHeaderNarrowHarness from './PaneHeaderNarrowHarness.svelte';

describe('PaneHeader narrow composition', () => {
  it('keeps the title and dense actions on one bounded row', async () => {
    const { container } = render(PaneHeaderNarrowHarness, { props: { width: '280px' } });
    const header = container.querySelector<HTMLElement>('[data-testid="pane-header"]');

    expect(header).not.toBeNull();
    expect(header!.getBoundingClientRect().height).toBeLessThanOrEqual(56);
    expect(header!.scrollWidth).toBeLessThanOrEqual(header!.clientWidth);
  });
});
