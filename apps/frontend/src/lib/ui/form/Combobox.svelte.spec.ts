import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import Combobox from './Combobox.svelte';

const items = [
  { value: 'login', label: 'LoginSucceededEvent' },
  { value: 'join', label: 'UserJoinedRoomEvent' }
];

function input(container: Element): HTMLInputElement {
  return container.querySelector('input') as HTMLInputElement;
}

describe('Combobox', () => {
  it('keeps freeform text as the value and can clear it', async () => {
    const ontextchange = vi.fn();
    const { container } = render(Combobox<(typeof items)[number]>, {
      props: {
        id: 'event-type',
        label: 'Event type',
        items,
        getValue: (item) => item.value,
        getLabel: (item) => item.label,
        ontextchange
      }
    });

    const field = input(container);
    field.value = 'system:bootstrap';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(ontextchange).toHaveBeenCalledWith('system:bootstrap');
    expect(field.value).toBe('system:bootstrap');

    const clear = container.querySelector('button[aria-label="Clear"]') as HTMLButtonElement;
    clear.click();
    flushSync();

    expect(field.value).toBe('');
    expect(ontextchange).toHaveBeenLastCalledWith('');
  });

  it('exposes and updates the active option while input focus remains in the combobox', async () => {
    const onselect = vi.fn();
    const { container } = render(Combobox<(typeof items)[number]>, {
      props: {
        id: 'event-type',
        label: 'Event type',
        items,
        getValue: (item) => item.value,
        getLabel: (item) => item.label,
        onselect
      }
    });

    const field = input(container);
    field.focus();
    flushSync();

    expect(field.getAttribute('aria-controls')).toBe('event-type-listbox');
    expect(field.getAttribute('aria-haspopup')).toBe('listbox');
    expect(field.getAttribute('aria-activedescendant')).toBe('event-type-listbox-option-0');
    expect(document.activeElement).toBe(field);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    flushSync();

    expect(field.getAttribute('aria-activedescendant')).toBe('event-type-listbox-option-1');
    expect(
      container.querySelector('#event-type-listbox-option-1')?.getAttribute('aria-selected')
    ).toBe('true');
    expect(document.activeElement).toBe(field);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();

    expect(onselect).toHaveBeenCalledWith(items[1]);
    expect(field.value).toBe('UserJoinedRoomEvent');
    expect(field.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('keeps listbox options out of the tab order', async () => {
    const { container } = render(Combobox<(typeof items)[number]>, {
      props: {
        id: 'event-type',
        label: 'Event type',
        items,
        getValue: (item) => item.value,
        getLabel: (item) => item.label
      }
    });

    const field = input(container);
    field.focus();
    flushSync();

    const options = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options).toHaveLength(items.length);
    expect(options.every((option) => option.tabIndex === -1)).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it('marks asynchronous suggestions busy without inventing an active option', async () => {
    const { container } = render(Combobox<(typeof items)[number]>, {
      props: {
        id: 'member-search',
        label: 'Member',
        items: [],
        loading: true,
        getValue: (item) => item.value,
        getLabel: (item) => item.label
      }
    });

    const field = input(container);
    field.focus();
    flushSync();

    expect(field.getAttribute('aria-busy')).toBe('true');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.hasAttribute('aria-activedescendant')).toBe(false);
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain('Loading');
  });
});
