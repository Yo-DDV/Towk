import { render } from 'vitest-browser-svelte';
import { describe, expect, it, vi } from 'vitest';
import '../../app.css';
import MotdContent from './MotdContent.svelte';

describe('MotdContent', () => {
  it('keeps the global header message on one line after markdown rendering', async () => {
    const { container } = render(MotdContent, {
      props: { motd: 'Alpha preview' }
    });
    const content = container.querySelector<HTMLElement>('[data-testid="motd-content"]');

    expect(content).not.toBeNull();
    await vi.waitFor(() => expect(content!.querySelector('p')).not.toBeNull());

    content!.style.display = 'block';
    content!.style.width = '60px';
    const renderedMessage = content!.querySelector('p')! as HTMLElement;
    const renderedLines = new Set(
      [...renderedMessage.getClientRects()].map((rect) => Math.round(rect.top))
    );

    expect(getComputedStyle(content!).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(renderedMessage).whiteSpace).toBe('nowrap');
    expect(renderedLines.size).toBe(1);
  });
});
