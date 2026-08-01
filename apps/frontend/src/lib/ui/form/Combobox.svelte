<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import * as m from '$lib/i18n/messages';
  import FloatingPopover from '$lib/ui/FloatingPopover.svelte';
  import FormField from './FormField.svelte';

  let {
    id,
    label,
    value = $bindable(''),
    text = $bindable(''),
    items,
    getValue,
    getLabel,
    placeholder,
    description,
    error,
    disabled = false,
    loading = false,
    allowFreeform = true,
    emptyMessage = m['ui.combobox.empty'](),
    clearLabel = m['ui.combobox.clear'](),
    class: className,
    item,
    itemAction,
    ontextchange,
    onselect,
    onclear
  }: {
    id: string;
    label: string;
    value?: string;
    text?: string;
    items: T[];
    getValue: (item: T) => string;
    getLabel: (item: T) => string;
    placeholder?: string;
    description?: string;
    error?: string;
    disabled?: boolean;
    loading?: boolean;
    allowFreeform?: boolean;
    emptyMessage?: string;
    clearLabel?: string;
    class?: ClassValue;
    item?: Snippet<[{ item: T; selected: boolean }]>;
    itemAction?: Snippet<[{ item: T; selected: boolean }]>;
    ontextchange?: (text: string) => void;
    onselect?: (item: T) => void;
    onclear?: () => void;
  } = $props();

  if (!text && value) {
    text = value;
  }

  let inputEl = $state<HTMLInputElement>();
  let inputShell = $state<HTMLElement>();
  let open = $state(false);
  let activeValue = $state<string | null>(null);
  let anchor = $state<{ top: number; bottom: number; left: number } | null>(null);

  const listboxId = $derived(`${id}-listbox`);
  const activeIndex = $derived(
    activeValue === null ? -1 : items.findIndex((option) => getValue(option) === activeValue)
  );
  const showPopover = $derived(open && !disabled && (loading || items.length > 0 || text !== ''));
  const activeOptionId = $derived(
    showPopover && activeIndex >= 0 ? optionId(items[activeIndex]) : undefined
  );

  function optionId(option: T): string {
    const encoded = encodeURIComponent(getValue(option)) || 'empty';
    return `${listboxId}-option-${encoded}`;
  }

  function updateAnchor() {
    const rect = inputEl?.getBoundingClientRect();
    anchor = rect ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null;
  }

  function selectedOrFirstValue(): string | null {
    if (items.length === 0) return null;
    return items.some((option) => getValue(option) === value) ? value : getValue(items[0]);
  }

  function openMenu(preferred: 'selected' | 'first' | 'last' = 'selected') {
    if (disabled) return;
    if (items.length === 0) {
      activeValue = null;
    } else if (preferred === 'last') {
      activeValue = getValue(items[items.length - 1]);
    } else if (preferred === 'first') {
      activeValue = getValue(items[0]);
    } else {
      activeValue = selectedOrFirstValue();
    }
    open = true;
    updateAnchor();
  }

  function setActiveIndex(index: number) {
    if (items.length === 0) {
      activeValue = null;
      return;
    }
    const normalized = ((index % items.length) + items.length) % items.length;
    activeValue = getValue(items[normalized]);
  }

  function handleInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    text = input.value;
    value = allowFreeform ? text : '';
    activeValue = items[0] ? getValue(items[0]) : null;
    open = true;
    updateAnchor();
    ontextchange?.(text);
  }

  function selectOption(option: T) {
    value = getValue(option);
    text = getLabel(option);
    activeValue = value;
    open = false;
    onselect?.(option);
    queueMicrotask(() => inputEl?.focus({ preventScroll: true }));
  }

  function clear() {
    value = '';
    text = '';
    activeValue = null;
    open = false;
    ontextchange?.('');
    onclear?.();
    inputEl?.focus({ preventScroll: true });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled || event.isComposing) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        openMenu('selected');
        return;
      }
      setActiveIndex(activeIndex >= 0 ? activeIndex + 1 : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu('last');
        return;
      }
      setActiveIndex(activeIndex >= 0 ? activeIndex - 1 : items.length - 1);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && items[activeIndex]) {
        event.preventDefault();
        selectOption(items[activeIndex]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        open = false;
      }
    } else if (event.key === 'Tab') {
      open = false;
    }
  }

  function handleFocusOut() {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active instanceof Node && inputShell?.contains(active)) return;
      open = false;
    });
  }

  $effect(() => {
    if (disabled) {
      open = false;
      activeValue = null;
      return;
    }

    if (items.length === 0) {
      activeValue = null;
      return;
    }

    if (activeValue === null || !items.some((option) => getValue(option) === activeValue)) {
      activeValue = selectedOrFirstValue();
    }
  });

  $effect(() => {
    const optionId = activeOptionId;
    if (!optionId) return;
    queueMicrotask(() => {
      document.getElementById(optionId)?.scrollIntoView({ block: 'nearest' });
    });
  });
</script>

<FormField {id} {label} {error} {description}>
  <div
    bind:this={inputShell}
    class={['relative', className]}
    onfocusout={handleFocusOut}
  >
    <input
      bind:this={inputEl}
      {id}
      type="text"
      bind:value={text}
      {placeholder}
      {disabled}
      autocomplete="off"
      role="combobox"
      aria-expanded={showPopover}
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-controls={listboxId}
      aria-activedescendant={activeOptionId}
      aria-busy={loading || undefined}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? `${id}-error` : description ? `${id}-description` : undefined}
      class={['input pr-16', loading && 'pr-20']}
      onfocus={() => openMenu('selected')}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    <div class="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
      {#if loading}
        <span class="iconify animate-spin text-base text-muted uil--spinner" aria-hidden="true"
        ></span>
      {/if}
      {#if text}
        <button
          type="button"
          class="pane-header-icon-button"
          aria-label={clearLabel}
          title={clearLabel}
          {disabled}
          onclick={clear}
        >
          <span class="pane-header-icon-glyph iconify uil--times" aria-hidden="true"></span>
        </button>
      {/if}
    </div>
  </div>
</FormField>

<FloatingPopover
  open={showPopover}
  {anchor}
  role="listbox"
  id={listboxId}
  class="menu max-h-72 w-[min(20rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-y-auto"
  onclose={() => (open = false)}
>
  <div class="menu-section">
    {#if items.length > 0}
      {#each items as option (getValue(option))}
        {@const optionValue = getValue(option)}
        {@const selected = optionValue === activeValue}
        <div
          role="presentation"
          class="flex min-w-0 items-stretch"
          onpointerenter={() => (activeValue = optionValue)}
        >
          <button
            id={optionId(option)}
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={selected}
            class={['menu-item min-w-0 flex-1 text-left', selected && 'menu-item-active']}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => selectOption(option)}
          >
            {#if item}
              {@render item({ item: option, selected })}
            {:else}
              <span class="min-w-0 truncate">{getLabel(option)}</span>
            {/if}
          </button>
          {#if itemAction}
            {@render itemAction({ item: option, selected })}
          {/if}
        </div>
      {/each}
    {:else if loading}
      <div class="px-3 py-2 text-sm text-muted">{m['ui.combobox.loading']()}</div>
    {:else}
      <div class="px-3 py-2 text-sm text-muted">{emptyMessage}</div>
    {/if}
  </div>
</FloatingPopover>
