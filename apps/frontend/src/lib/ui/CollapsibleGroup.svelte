<!--
@component

A sidebar group with a collapsible header. Collapsed/expanded state is
persisted to `localStorage` under `persistKey`; callers needing per-server
scoping should build the key with `serverStorageKey()`.

When collapsed, items are hidden unless `keepVisibleWhenCollapsed` returns
true for them — useful for anchoring rows that demand attention (active,
unread, mentions, …) so the user can always reach them.

Used by `RoomList` (channels, DMs, layout sections) and `RoomSidebar` (online /
offline member groups).
-->
<script module lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { Codecs, StorageSlot } from '$lib/storage/slot';

  // Module-level reactive cache, write-through to localStorage. Groups
  // that share a `persistKey` stay in sync automatically (no shared key
  // pairs exist today — this just falls out of the pattern).
  const cache = new SvelteMap<string, boolean>();

  function loadCollapsed(key: string, fallback: boolean): boolean {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    return new StorageSlot(key, fallback, Codecs.boolean).get();
  }

  function saveCollapsed(key: string, value: boolean): void {
    cache.set(key, value);
    new StorageSlot(key, value, Codecs.boolean).set(value);
  }
</script>

<script lang="ts" generics="T extends { id: string }">
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';

  interface Props {
    label: string;
    items: T[];
    item: Snippet<[T]>;
    /** Unique localStorage key for persisting collapsed state. */
    persistKey: string;
    /** Collapsed state when no preference is stored. */
    defaultCollapsed?: boolean;
    keepVisibleWhenCollapsed?: (item: T) => boolean;
    /** Optional validated #RRGGBB accent used as a non-authoritative visual cue. */
    accentColor?: string | null;
    class?: string;
  }

  let {
    label,
    items,
    item,
    persistKey,
    defaultCollapsed = false,
    keepVisibleWhenCollapsed,
    accentColor = null,
    class: className
  }: Props = $props();

  const collapsed = $derived(loadCollapsed(persistKey, defaultCollapsed));
  const validatedAccentColor = $derived(
    accentColor && /^#[0-9A-Fa-f]{6}$/.test(accentColor) ? accentColor.toUpperCase() : null
  );

  function toggle() {
    saveCollapsed(persistKey, !collapsed);
  }
</script>

<div class={className}>
  <button
    type="button"
    onclick={toggle}
    class={[
      'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold tracking-wider text-muted uppercase transition-colors hover:bg-surface-100 hover:text-text',
      validatedAccentColor && 'role-accent-header'
    ]}
    style:--role-accent={validatedAccentColor ?? undefined}
  >
    <span class="sidebar-icon">
      <span
        class={['iconify transition-transform uil--angle-right-b', collapsed ? '' : 'rotate-90']}
      ></span>
    </span>
    {#if validatedAccentColor}
      <span class="role-accent-dot h-2 w-2 shrink-0 rounded-full" aria-hidden="true"></span>
    {/if}
    <span class="min-w-0 truncate">{label}</span>
  </button>
  <div class="sidebar-nav">
    {#each items as it (it.id)}
      {#if !collapsed || keepVisibleWhenCollapsed?.(it)}
        <div transition:slide={{ duration: 150 }}>
          {@render item(it)}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .role-accent-header {
    color: color-mix(in srgb, var(--role-accent) 72%, var(--color-text-top));
  }

  .role-accent-dot {
    background-color: var(--role-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--role-accent) 18%, transparent);
  }
</style>
