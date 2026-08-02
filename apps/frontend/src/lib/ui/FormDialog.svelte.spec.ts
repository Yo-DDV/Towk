import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { q, testSnippet } from '$lib/test-utils';
import '../../app.css';
import FormDialog from './FormDialog.svelte';

function renderFormDialog(overrides: Record<string, unknown> = {}) {
  const onsubmit = vi.fn();
  const onclose = vi.fn();
  const result = render(FormDialog, {
    props: {
      visible: true,
      title: 'Edit room',
      submitLabel: 'Save moderation settings',
      children: testSnippet('<input id="dialog-field" name="name" value="General" />'),
      onsubmit,
      onclose,
      ...overrides
    }
  });

  return { ...result, onsubmit, onclose };
}

describe('FormDialog', () => {
  it('keeps form actions in the fixed dialog footer and submits through the outer form', async () => {
    const { container, onsubmit } = renderFormDialog();
    const form = q(container, 'form');
    const body = q(container, '.dialog-body');
    const footer = q(container, '.dialog-footer');
    const submit = q(container, 'button[type="submit"]') as HTMLButtonElement | null;

    expect(form).not.toBeNull();
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(body?.contains(footer)).toBe(false);
    expect(form?.contains(footer)).toBe(true);
    expect(submit).not.toBeNull();

    submit?.click();
    await vi.waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1));
  });

  it('blocks submission while the primary action is disabled', async () => {
    const { container, onsubmit } = renderFormDialog({ disabled: true });
    const submit = q(container, 'button[type="submit"]') as HTMLButtonElement | null;

    expect(submit?.disabled).toBe(true);
    submit?.click();
    await Promise.resolve();
    expect(onsubmit).not.toHaveBeenCalled();
  });
});
