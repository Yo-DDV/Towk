import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import '../../../app.css';
import TextInput from './TextInput.svelte';
import { q } from '$lib/test-utils';

function renderPassword(value: string, autocomplete: 'new-password' | 'current-password') {
  const rendered = render(TextInput, {
    props: {
      id: 'password',
      label: 'Password',
      type: 'password',
      autocomplete,
      value
    }
  });
  flushSync();
  return {
    ...rendered,
    input: q(rendered.container, 'input') as HTMLInputElement
  };
}

describe('TextInput password policy', () => {
  it('counts the minimum in Unicode code points rather than UTF-16 code units', () => {
    const { container, input } = renderPassword('😀'.repeat(7), 'new-password');

    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe('Must contain at least 8 Unicode characters');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('Must contain at least 8 Unicode characters');
  });

  it('accepts exactly seventy-two UTF-8 bytes for a new password', () => {
    const { input } = renderPassword('田'.repeat(24), 'new-password');

    expect(input.checkValidity()).toBe(true);
    expect(input.validationMessage).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('rejects a new password above seventy-two UTF-8 bytes', () => {
    const { container, input } = renderPassword(`${'田'.repeat(24)}a`, 'new-password');

    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe('8+ Unicode characters, up to 72 UTF-8 bytes');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(container.textContent).toContain('8+ Unicode characters, up to 72 UTF-8 bytes');
  });

  it('does not apply the new-password policy to current-password fields', () => {
    const { input } = renderPassword('x', 'current-password');

    expect(input.checkValidity()).toBe(true);
    expect(input.validationMessage).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });
});
