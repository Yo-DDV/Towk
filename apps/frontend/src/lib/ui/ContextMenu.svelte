<!--
@component

A reusable floating menu/popover. On hover-capable devices, positions itself at a viewport point or
anchored to an element. On pure touch-primary devices, renders the same menu semantics inside a
BottomSheet instead. Handles click-outside dismissal, Escape, roving focus, arrow-key navigation,
typeahead, and scroll dismissal (floating), or swipe-to-close (sheet).

Built on top of `FloatingPopover` — the desktop branch is menu-specific styling and positioning around
the shared primitive, while the touch branch keeps the same command model inside a named modal sheet.

**Props:**
- `position` - Viewport coordinates {x, y} for point-based positioning (context menus)
- `anchor` - Element rect {top, bottom, left} for anchor-based positioning (popovers)
- `role` - ARIA role (default: "menu")
- `ariaLabel` - ARIA label for both the menu and touch-sheet dialog
- `presentation` - "auto" uses input capability, "floating" or "sheet" forces a mode
- `dismissOnExternalInteraction` - Whether a sheet reacts to backdrop and native close requests
- `class` - Additional CSS classes for the outer container (floating mode only)
- `onclose` - Callback when the menu should be dismissed

In floating mode, exactly one of `position` or `anchor` must be provided. In sheet mode, both are
ignored (the BottomSheet handles its own positioning).
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Snippet } from 'svelte';
  import BottomSheet from './BottomSheet.svelte';
  import FloatingPopover from './FloatingPopover.svelte';
  import { prefersTouchActions, supportsHoverActions } from '$lib/utils/inputCapabilities';

  type ContextMenuPresentation = 'auto' | 'floating' | 'sheet';

  let {
    position,
    anchor,
    role = 'menu',
    ariaLabel,
    presentation = 'auto',
    dismissOnExternalInteraction = true,
    class: className,
    onclose,
    onmouseenter,
    onmouseleave,
    children
  }: {
    position?: { x: number; y: number; alignRight?: boolean; centerX?: boolean };
    anchor?: { top: number; bottom: number; left: number } | null;
    role?: string;
    ariaLabel?: string;
    presentation?: ContextMenuPresentation;
    dismissOnExternalInteraction?: boolean;
    class?: string;
    onclose: () => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    children: Snippet;
  } = $props();

  const useSheet = $derived(
    presentation === 'sheet' ||
      (presentation === 'auto' && prefersTouchActions() && !supportsHoverActions())
  );
  let sheetVisible = $state(true);
  let menuEl: HTMLElement | undefined;
  let previouslyFocused: HTMLElement | null =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  function allMenuItems(node = menuEl): HTMLElement[] {
    if (!node || role !== 'menu') return [];
    return Array.from(
      node.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
      )
    ).filter((item) => item.closest('[role="menu"]') === node);
  }

  function enabledMenuItems(node = menuEl): HTMLElement[] {
    return allMenuItems(node).filter(
      (item) =>
        !item.hasAttribute('disabled') &&
        item.getAttribute('aria-disabled') !== 'true' &&
        item.getAttribute('aria-hidden') !== 'true'
    );
  }

  function focusItem(items: HTMLElement[], index: number) {
    if (items.length === 0) return;
    const normalized = ((index % items.length) + items.length) % items.length;
    for (const item of allMenuItems()) item.tabIndex = -1;
    for (const [itemIndex, item] of items.entries()) {
      item.tabIndex = itemIndex === normalized ? 0 : -1;
    }
    items[normalized]?.focus({ preventScroll: true });
  }

  function setupMenu(node: HTMLElement) {
    menuEl = node;
    if (
      previouslyFocused === null &&
      document.activeElement instanceof HTMLElement &&
      !node.contains(document.activeElement)
    ) {
      previouslyFocused = document.activeElement;
    }

    queueMicrotask(() => {
      if (!node.isConnected || role !== 'menu') return;
      const items = enabledMenuItems(node);
      if (items.length === 0) return;
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      focusItem(items, activeIndex >= 0 ? activeIndex : 0);
    });

    return () => {
      if (typeaheadTimer) {
        clearTimeout(typeaheadTimer);
        typeaheadTimer = null;
      }
      if (menuEl === node) menuEl = undefined;
    };
  }

  function restoreTriggerFocus() {
    const target = previouslyFocused;
    previouslyFocused = null;
    queueMicrotask(() => {
      queueMicrotask(() => {
        const active = document.activeElement;
        const focusStillOwnedByMenu = active instanceof Node && menuEl?.contains(active);
        if (
          target?.isConnected &&
          (active === document.body || active === null || focusStillOwnedByMenu)
        ) {
          target.focus({ preventScroll: true });
        }
      });
    });
  }

  function requestClose() {
    onclose();
    restoreTriggerFocus();
  }

  function handleMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }

    if (role !== 'menu') return;
    const items = enabledMenuItems();
    if (items.length === 0) return;
    const current = Math.max(0, items.findIndex((item) => item === document.activeElement));

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(items, current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(items, current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(items, 0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items, items.length - 1);
    } else if (event.key === 'Tab') {
      onclose();
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing
    ) {
      typeahead += event.key.toLocaleLowerCase();
      if (typeaheadTimer) clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => {
        typeahead = '';
        typeaheadTimer = null;
      }, 500);

      const start = (current + 1) % items.length;
      const ordered = [...items.slice(start), ...items.slice(0, start)];
      const match = ordered.find((item) =>
        (item.textContent ?? '').trim().toLocaleLowerCase().startsWith(typeahead)
      );
      if (match) {
        event.preventDefault();
        focusItem(items, items.indexOf(match));
      }
    }
  }

  function handleMenuFocus(event: FocusEvent) {
    if (role !== 'menu' || !(event.target instanceof HTMLElement)) return;
    const items = enabledMenuItems();
    const index = items.indexOf(event.target);
    if (index < 0) return;
    for (const item of allMenuItems()) item.tabIndex = -1;
    for (const [itemIndex, item] of items.entries()) {
      item.tabIndex = itemIndex === index ? 0 : -1;
    }
  }
</script>

{#if useSheet}
  <BottomSheet
    bind:visible={sheetVisible}
    {ariaLabel}
    {dismissOnExternalInteraction}
    onclose={requestClose}
  >
    <div
      {@attach setupMenu}
      {role}
      aria-label={ariaLabel}
      tabindex="-1"
      class="flex min-w-0 flex-col gap-1"
      onkeydown={handleMenuKeydown}
      onfocusin={handleMenuFocus}
    >
      {@render children()}
    </div>
  </BottomSheet>
{:else}
  <FloatingPopover
    {position}
    {anchor}
    class={['min-w-48 menu', className]}
    onclose={requestClose}
    {onmouseenter}
    {onmouseleave}
  >
    <div
      {@attach setupMenu}
      {role}
      aria-label={ariaLabel}
      tabindex="-1"
      class="flex flex-col gap-1"
      onkeydown={handleMenuKeydown}
      onfocusin={handleMenuFocus}
      transition:fade|global={{ duration: 100 }}
    >
      {@render children()}
    </div>
  </FloatingPopover>
{/if}
