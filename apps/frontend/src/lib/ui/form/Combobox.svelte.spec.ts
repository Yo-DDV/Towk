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

function option(container: Element, value: string): HTMLButtonElement {
  return container.querySelector(`#event-type-listbox-option-${value}`) as HTMLButtonElement;
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

  it('exposes stable value-based option ids while input focus owns the combobox', async () => {
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
    expect(field.getAttribute('aria-activedescendant')).toBe(
      'event-type-listbox-option-login'
    );
    expect(document.activeElement).toBe(field);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    flushSync();

    expect(field.getAttribute('aria-activedescendant')).toBe('event-type-listbox-option-join');
    expect(option(container, 'join').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(field);

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onselect).toHaveBeenCalledWith(items[1]);
    expect(field.value).toBe('UserJoinedRoomEvent');
    expect(field.hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it('supports last, first and terminal option navigation without intercepting IME input', async () => {
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

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(field.getAttribute('aria-expanded')).toBe('false');

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    flushSync();
    expect(field.getAttribute('aria-activedescendant')).toBe('event-type-listbox-option-join');

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    flushSync();
    expect(field.getAttribute('aria-activedescendant')).toBe(
      'event-type-listbox-option-login'
    );

    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, isComposing: true })
    );
    flushSync();
    expect(field.getAttribute('aria-activedescendant')).toBe(
      'event-type-listbox-option-login'
    );

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    flushSync();
    expect(field.getAttribute('aria-activedescendant')).toBe('event-type-listbox-option-join');

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    flushSync();
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(field.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('keeps the input focused after pointer selection', async () => {
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

    const join = option(container, 'join');
    join.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    join.click();
    flushSync();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onselect).toHaveBeenCalledWith(items[1]);
    expect(field.value).toBe('UserJoinedRoomEvent');
    expect(document.activeElement).toBe(field);
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
    expect(options.every((item) => item.tabIndex === -1)).toBe(true);
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
