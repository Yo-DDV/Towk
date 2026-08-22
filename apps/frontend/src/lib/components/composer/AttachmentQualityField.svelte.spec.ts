import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import AttachmentQualityField from './AttachmentQualityField.svelte';
import type { ImageQualityProfile } from '$lib/attachments/imageQuality';

function renderField(
  value: ImageQualityProfile = 'auto',
  props: { summary?: string; busy?: boolean } = {}
) {
  const onselect = vi.fn();
  const screen = render(AttachmentQualityField, {
    value,
    summary: props.summary ?? '0.8 MB instead of 11.2 MB',
    busy: props.busy ?? false,
    onselect
  });
  const group = document.querySelector('[role="radiogroup"]') as HTMLElement;
  const segments = [...group.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
  return { screen, onselect, group, segments };
}

describe('attachment quality field', () => {
  it('names the setting and states the resulting upload size', () => {
    renderField('sd', { summary: '0.3 MB instead of 11.2 MB' });

    const group = document.querySelector('[role="radiogroup"]') as HTMLElement;
    const label = document.getElementById(group.getAttribute('aria-labelledby')!);
    expect(label?.textContent?.trim()).toBeTruthy();

    const summary = document.querySelector('[data-testid="attachment-quality-summary"]');
    expect(summary?.textContent).toContain('0.3 MB instead of 11.2 MB');
    // The hint explains what the selected profile does, not only its name.
    expect(summary?.textContent?.trim().length).toBeGreaterThan('0.3 MB instead of 11.2 MB'.length);
  });

  it('exposes exactly one checked profile', () => {
    const { segments } = renderField('hd');
    expect(segments).toHaveLength(4);
    expect(segments.filter((s) => s.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(
      document.querySelector('[data-testid="attachment-quality-hd"]')?.getAttribute('aria-checked')
    ).toBe('true');
  });

  it('reports the profile the sender clicks', async () => {
    const { onselect } = renderField('auto');
    (document.querySelector('[data-testid="attachment-quality-sd"]') as HTMLButtonElement).click();
    flushSync();
    expect(onselect).toHaveBeenCalledWith('sd');
  });

  it('moves through the profiles with the arrow keys', () => {
    const { onselect, segments } = renderField('auto');
    segments[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    );
    flushSync();
    expect(onselect).toHaveBeenLastCalledWith('sd');

    segments[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    );
    flushSync();
    expect(onselect).toHaveBeenLastCalledWith('original');
  });

  it('locks the choice and announces the work while re-encoding', () => {
    const { group, segments } = renderField('sd', { summary: 'Preparing images…', busy: true });
    expect(group.getAttribute('aria-busy')).toBe('true');
    expect(segments.every((s) => s.disabled)).toBe(true);
    expect(
      document.querySelector('[data-testid="attachment-quality-summary"]')?.textContent
    ).toContain('Preparing images…');
  });
});
