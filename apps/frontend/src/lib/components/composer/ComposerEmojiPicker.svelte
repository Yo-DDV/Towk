<!--
@component

Desktop emoji browser for the message composer. Renders one category at a time
so browsing the full gemoji catalogue stays lightweight, while preserving the
existing :shortcode autocomplete path for keyboard-first use.

**Props:**
- `serverId` - Active server used to scope recently selected emojis
- `onSelect` - Inserts the selected Unicode emoji in the composer
- `onClose` - Dismisses the picker without selecting
-->
<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$lib/i18n/messages';
  import {
    EMOJI_BY_CATEGORY,
    emojiToName,
    getEmojiDisplayName,
    searchEmojis
  } from '$lib/emoji';
  import { getRecentEmojis, MAX_RECENT_EMOJIS } from '$lib/state/recentEmojis.svelte';

  const GRID_COLUMNS = 8;
  const SEARCH_RESULT_LIMIT = 96;
  const RECENT_CATEGORY = '__recent__';

  type PickerEntry = {
    emoji: string;
    name: string;
  };

  let {
    serverId,
    onSelect,
    onClose
  }: {
    serverId: string;
    onSelect: (emoji: string) => void;
    onClose: () => void;
  } = $props();

  let query = $state('');
  let activeCategory = $state(RECENT_CATEGORY);
  let previewName = $state<string | null>(null);
  let rovingIndex = $state(0);
  let searchInputElement = $state<HTMLInputElement>();
  let gridElement = $state<HTMLDivElement>();
  let visibleSetKey = $state('');

  const recentStore = $derived(getRecentEmojis(serverId));
  const recentEntries = $derived(
    recentStore.recent.slice(0, MAX_RECENT_EMOJIS).map((emoji) => ({
      emoji,
      name: emojiToName(emoji) ?? emoji
    }))
  );
  const normalizedQuery = $derived(query.trim().replace(/^:+|:+$/g, ''));
  const isSearching = $derived(normalizedQuery.length > 0);
  const searchResults = $derived(
    isSearching
      ? searchEmojis(normalizedQuery, SEARCH_RESULT_LIMIT).map(({ emoji, name }) => ({
          emoji,
          name
        }))
      : []
  );
  const activeCategoryData = $derived(
    EMOJI_BY_CATEGORY.find((category) => category.name === activeCategory) ??
      EMOJI_BY_CATEGORY[0]
  );
  const visibleEntries = $derived.by((): PickerEntry[] => {
    if (isSearching) return searchResults;
    if (activeCategory === RECENT_CATEGORY) return recentEntries;
    return activeCategoryData?.emojis ?? [];
  });
  const previewEntry = $derived(
    visibleEntries.find((entry) => entry.name === previewName) ?? visibleEntries[0] ?? null
  );
  const previewDisplayName = $derived(
    previewEntry ? getEmojiDisplayName(previewEntry.name) : ''
  );
  const activeCategoryLabel = $derived(
    activeCategory === RECENT_CATEGORY
      ? m['emoji.recently_used']()
      : categoryLabel(activeCategory)
  );

  $effect(() => {
    if (activeCategory === RECENT_CATEGORY && recentEntries.length === 0) {
      activeCategory = EMOJI_BY_CATEGORY[0]?.name ?? RECENT_CATEGORY;
    }
  });

  $effect(() => {
    const nextKey = isSearching
      ? `search:${normalizedQuery}`
      : `category:${activeCategory}:${recentEntries.length}`;
    if (nextKey === visibleSetKey) return;

    visibleSetKey = nextKey;
    rovingIndex = 0;
    previewName = null;
    if (gridElement) gridElement.scrollTop = 0;
  });

  function categoryLabel(category: string): string {
    if (category === 'Smileys & Emotion') return m['emoji.categories.smileys_emotion']();
    if (category === 'People & Body') return m['emoji.categories.people_body']();
    if (category === 'Animals & Nature') return m['emoji.categories.animals_nature']();
    if (category === 'Food & Drink') return m['emoji.categories.food_drink']();
    if (category === 'Travel & Places') return m['emoji.categories.travel_places']();
    if (category === 'Activities') return m['emoji.categories.activities']();
    if (category === 'Objects') return m['emoji.categories.objects']();
    if (category === 'Symbols') return m['emoji.categories.symbols']();
    if (category === 'Flags') return m['emoji.categories.flags']();
    return category;
  }

  function focusSearchInput(node: HTMLInputElement) {
    queueMicrotask(() => node.focus());
  }

  function selectCategory(category: string) {
    query = '';
    activeCategory = category;
    rovingIndex = 0;
    previewName = null;
  }

  function selectEmoji(entry: PickerEntry) {
    recentStore.record(entry.emoji);
    onSelect(entry.emoji);
  }

  function focusEmoji(index: number) {
    const buttons = gridElement?.querySelectorAll<HTMLButtonElement>('[data-emoji-index]');
    if (!buttons?.length) return;

    const targetIndex = Math.max(0, Math.min(index, buttons.length - 1));
    rovingIndex = targetIndex;
    previewName = visibleEntries[targetIndex]?.name ?? null;
    buttons[targetIndex]?.focus();
  }

  function clearSearchOrClose() {
    if (query) {
      query = '';
      tick().then(() => searchInputElement?.focus());
      return;
    }
    onClose();
  }

  function handlePickerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;

    event.preventDefault();
    event.stopPropagation();
    clearSearchOrClose();
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusEmoji(rovingIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearchOrClose();
    }
  }

  function handleEmojiKeydown(event: KeyboardEvent, index: number) {
    let targetIndex: number | null = null;

    if (event.key === 'ArrowLeft') targetIndex = index - 1;
    if (event.key === 'ArrowRight') targetIndex = index + 1;
    if (event.key === 'ArrowUp') targetIndex = index - GRID_COLUMNS;
    if (event.key === 'ArrowDown') targetIndex = index + GRID_COLUMNS;
    if (event.key === 'Home') targetIndex = 0;
    if (event.key === 'End') targetIndex = visibleEntries.length - 1;

    if (targetIndex !== null) {
      event.preventDefault();
      focusEmoji(targetIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearSearchOrClose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-testid="composer-emoji-picker"
  class="flex w-full flex-col gap-1"
  onkeydown={handlePickerKeydown}
>
  <div class="menu-section p-2">
    <label
      class="flex items-center gap-2 rounded-md border border-border bg-input px-2.5 py-2 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30"
    >
      <span class="iconify shrink-0 text-base text-muted uil--search" aria-hidden="true"></span>
      <input
        {@attach focusSearchInput}
        bind:this={searchInputElement}
        bind:value={query}
        data-testid="emoji-picker-search"
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder={m['emoji.search_placeholder']()}
        aria-label={m['emoji.search_placeholder']()}
        class="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted/70"
        onkeydown={handleSearchKeydown}
      />
    </label>
  </div>

  <div class="menu-section px-2 py-1.5">
    <div
      role="toolbar"
      class="scrollbar-hide flex items-center gap-1 overflow-x-auto"
      aria-label={m['emoji.open_picker']()}
    >
      {#if recentEntries.length > 0}
        <button
          type="button"
          class={[
            'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-[background-color,color,scale] active:scale-[0.96]',
            activeCategory === RECENT_CATEGORY && !isSearching
              ? 'bg-surface-highlighted text-text ring-1 ring-text/10'
              : 'hover:bg-surface-100 hover:text-text'
          ]}
          aria-label={m['emoji.recently_used']()}
          aria-pressed={activeCategory === RECENT_CATEGORY && !isSearching}
          title={m['emoji.recently_used']()}
          onclick={() => selectCategory(RECENT_CATEGORY)}
        >
          <span class="iconify text-lg uil--clock" aria-hidden="true"></span>
        </button>
      {/if}

      {#each EMOJI_BY_CATEGORY as category (category.name)}
        {@const label = categoryLabel(category.name)}
        <button
          type="button"
          class={[
            'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg transition-[background-color,scale] active:scale-[0.96]',
            activeCategory === category.name && !isSearching
              ? 'bg-surface-highlighted ring-1 ring-text/10'
              : 'hover:bg-surface-100'
          ]}
          aria-label={label}
          aria-pressed={activeCategory === category.name && !isSearching}
          title={label}
          onclick={() => selectCategory(category.name)}
        >
          <span aria-hidden="true">{category.icon}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="menu-section overflow-hidden p-0">
    {#if !isSearching}
      <div class="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        {activeCategoryLabel}
      </div>
    {/if}

    {#if visibleEntries.length === 0}
      <div class="flex min-h-48 items-center justify-center px-4 text-center text-sm text-muted">
        {m['emoji.no_results']()}
      </div>
    {:else}
      <div
        bind:this={gridElement}
        data-testid="emoji-picker-grid"
        class="scrollbar-hide grid max-h-72 grid-cols-8 gap-1 overflow-y-auto px-2 pt-1 pb-2"
      >
        {#each visibleEntries as entry, index (`${entry.name}-${index}`)}
          {@const displayName = getEmojiDisplayName(entry.name)}
          <button
            type="button"
            data-emoji-index={index}
            tabindex={index === rovingIndex ? 0 : -1}
            class={[
              'flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-xl transition-[background-color,scale] hover:bg-surface-highlighted focus:bg-surface-highlighted focus:ring-2 focus:ring-accent/50 focus:outline-none active:scale-[0.94]',
              previewEntry?.name === entry.name && 'bg-surface-100'
            ]}
            aria-label={`${displayName}, :${entry.name}:`}
            title={`:${entry.name}:`}
            onpointerenter={() => (previewName = entry.name)}
            onfocus={() => {
              rovingIndex = index;
              previewName = entry.name;
            }}
            onkeydown={(event) => handleEmojiKeydown(event, index)}
            onclick={() => selectEmoji(entry)}
          >
            <span aria-hidden="true">{entry.emoji}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="menu-section flex min-h-14 items-center gap-3 px-3 py-2">
    {#if previewEntry}
      <span class="flex h-9 w-9 shrink-0 items-center justify-center text-3xl" aria-hidden="true">
        {previewEntry.emoji}
      </span>
      <div class="min-w-0 leading-tight" aria-live="polite">
        <div
          data-testid="emoji-picker-preview-name"
          class="truncate text-sm font-medium text-text"
        >
          {previewDisplayName}
        </div>
        <div
          data-testid="emoji-picker-preview-shortcode"
          class="truncate font-mono text-xs text-muted"
        >
          :{previewEntry.name}:
        </div>
      </div>
    {:else}
      <span class="text-sm text-muted">{m['emoji.no_results']()}</span>
    {/if}
  </div>
</div>
