<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EmptyState from './EmptyState.svelte';
  import {
    DESIGN_SYSTEM_FAMILIES,
    DESIGN_SYSTEM_PRIMITIVES,
    type DesignSystemFamily,
    type DesignSystemPresentation
  } from './designSystem';

  const { Story } = defineMeta({
    title: 'Foundations/Design system catalog',
    tags: ['autodocs', 'design-system-test'],
    parameters: {
      layout: 'fullscreen',
      a11y: { test: 'error' },
      docs: {
        description: {
          component:
            'Searchable decision surface for Towk frontend primitives. The registry remains the source of truth; this story makes its use and exclusion boundaries easy to inspect.'
        }
      }
    }
  });

  const presentations = [
    ...new Set(DESIGN_SYSTEM_PRIMITIVES.map((primitive) => primitive.presentation))
  ] as DesignSystemPresentation[];
</script>

<script lang="ts">
  let query = $state('');
  let family = $state<'all' | DesignSystemFamily>('all');
  let presentation = $state<'all' | DesignSystemPresentation>('all');

  const filteredPrimitives = $derived.by(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return DESIGN_SYSTEM_PRIMITIVES.filter((primitive) => {
      if (family !== 'all' && primitive.family !== family) return false;
      if (presentation !== 'all' && primitive.presentation !== presentation) return false;
      if (!normalized) return true;

      return [
        primitive.name,
        primitive.module,
        primitive.family,
        primitive.presentation,
        primitive.useWhen,
        primitive.avoidWhen,
        primitive.responsive,
        primitive.accessibility
      ].some((value) => value.toLocaleLowerCase().includes(normalized));
    });
  });

  function clearFilters() {
    query = '';
    family = 'all';
    presentation = 'all';
  }
</script>

<Story name="Searchable primitive catalog" asChild>
  <main class="min-h-screen bg-background p-4 text-text sm:p-6 lg:p-8">
    <div class="mx-auto flex max-w-7xl flex-col gap-6">
      <header class="max-w-3xl space-y-2">
        <p class="text-sm font-semibold tracking-wide text-accent uppercase">Towk frontend</p>
        <h1 class="text-3xl font-semibold text-text-top">Choose the canonical primitive</h1>
        <p class="text-muted">
          Search the public component contract before creating feature-local controls. Results expose
          the intended use, exclusion boundary, responsive behavior, and accessibility ownership.
        </p>
      </header>

      <section class="panel-shell panel-body grid gap-4 p-4 md:grid-cols-3" aria-label="Catalog filters">
        <label class="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ext-top md:col-span-3 lg:col-span-1">
          Search
          <input
            type="search"
            bind:value={query}
            class="input"
            placeholder="Name, module, use case, or accessibility"
          />
        </label>

        <label class="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-ext-top">
          Family
          <select bind:value={family} class="input">
            <option value="all">All families</option>
            {#each DESIGN_SYSTEM_FAMILIES as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>

        <label class="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-text-top">
          Presentation
          <select bind:value={presentation} class="input">
            <option value="all">All presentations</option>
            {#each presentations as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>
      </section>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted" aria-live="polite">
          {filteredPrimitives.length} of {DESIGN_SYSTEM_PRIMITIVES.length} primitives
        </p>
        {#if query || family !== 'all' || presentation !== 'all'}
          <button
            type="button"
            class="min-h-11 rounded-md border border-border px-4 text-sm font-medium text-text-top transition-colors hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onclick={clearFilters}
          >
            Clear filters
          </button>
        {/if}
      </div>

      {#if filteredPrimitives.length > 0}
        <section class="grid gap-3 lg:grid-cols-2" aria-label="Matching primitives">
          {#each filteredPrimitives as primitive (`${primitive.module}:${primitive.name}`)}
            <article class="panel-shell panel-body flex min-w-0 flex-col gap-3 p-4">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <h2 class="font-semibold text-text-top">{primitive.name}</h2>
                  <code class="break-all text-xs text-muted">{primitive.module}</code>
                </div>
                <div class="flex flex-wrap gap-1.5 text-xs">
                  <span class="rounded-full border border-border bg-surface-100 px-2 py-1">
                    {primitive.family}
                  </span>
                  <span class="rounded-full border border-border bg-surface-100 px-2 py-1">
                    {primitive.presentation}
                  </span>
                  {#if primitive.story}
                    <span class="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-success">
                      Story covered
                    </span>
                  {/if}
                </div>
              </div>

              <dl class="grid gap-2 text-sm">
                <div>
                  <dt class="font-medium text-text-top">Use when</dt>
                  <dd class="text-muted">{primitive.useWhen}</dd>
                </div>
                <div>
                  <dt class="font-medium text-text-top">Avoid when</dt>
                  <dd class="text-muted">{primitive.avoidWhen}</dd>
                </div>
                <div>
                  <dt class="font-medium text-text-top">Responsive contract</dt>
                  <dd class="text-muted">{primitive.responsive}</dd>
                </div>
                <div>
                  <dt class="font-medium text-text-top">Accessibility ownership</dt>
                  <dd class="text-muted">{primitive.accessibility}</dd>
                </div>
              </dl>
            </article>
          {/each}
        </section>
      {:else}
        <div class="flex min-h-72 flex-col rounded-xl border border-border bg-background">
          <EmptyState icon="uil--search" title="No matching primitives">
            Adjust the query or clear the active family and presentation filters.
          </EmptyState>
        </div>
      {/if}
    </div>
  </main>
</Story>
