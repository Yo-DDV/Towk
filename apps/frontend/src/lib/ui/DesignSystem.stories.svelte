<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import {
    DESIGN_SYSTEM_FAMILIES,
    DESIGN_SYSTEM_PRIMITIVES,
    type DesignSystemFamily
  } from './designSystem';

  const { Story } = defineMeta({
    title: 'Foundations/Design system',
    tags: ['autodocs'],
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'Executable catalog for Towk frontend primitives, their intended use, responsive boundary, and accessibility ownership.'
        }
      }
    }
  });

  const familyDescriptions: Record<DesignSystemFamily, string> = {
    shell: 'Persistent application chrome and top-level structure.',
    layout: 'Visual grouping and geometry without interaction ownership.',
    overlay: 'Top-layer, modal, floating, and input-adaptive surfaces.',
    navigation: 'Controls that move between or operate on application regions.',
    feedback: 'Status, help, empty, error, and non-blocking explanatory surfaces.',
    form: 'Native and composite controls that collect or commit user input.'
  };

  const releaseViewports = [
    { name: 'Narrow phone', width: 320, height: 568, concern: 'minimum content width' },
    { name: 'Large phone', width: 390, height: 844, concern: 'touch and software keyboard' },
    { name: 'Fold / tablet portrait', width: 768, height: 1024, concern: 'container transitions' },
    { name: 'Tablet landscape', width: 1024, height: 768, concern: 'hybrid input' },
    { name: 'Desktop', width: 1440, height: 900, concern: 'multi-pane density' },
    { name: 'Ultrawide', width: 2560, height: 1080, concern: 'bounded line length' },
    { name: 'Short landscape', width: 844, height: 390, concern: 'height-constrained overlays' }
  ] as const;

  const interactionModes = [
    {
      name: 'Pointer + hover',
      rule: 'Use spatially anchored menus and hover affordances without hiding keyboard paths.'
    },
    {
      name: 'Touch primary',
      rule: 'Prefer bottom sheets or explicit controls and preserve at least 44 px interaction targets.'
    },
    {
      name: 'Keyboard',
      rule: 'Keep logical tab order, visible focus, Escape/Back behavior, and focus restoration.'
    },
    {
      name: 'Hybrid',
      rule: 'Select presentation from actual input capabilities rather than viewport width alone.'
    },
    {
      name: 'Reduced motion',
      rule: 'Remove decorative movement while preserving state, hierarchy, and timing feedback.'
    },
    {
      name: 'Forced colors / contrast',
      rule: 'Use system colors and structural labels; never rely on color or translucency alone.'
    }
  ] as const;
</script>

<Story
  name="Primitive registry"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Every public UI and form primitive is indexed here. New feature code should choose from this contract before creating local controls.'
      }
    }
  }}
>
  <main class="min-h-screen bg-background p-4 text-text sm:p-6 lg:p-8">
    <div class="mx-auto flex max-w-7xl flex-col gap-8">
      <header class="max-w-3xl space-y-2">
        <p class="text-sm font-semibold tracking-wide text-accent uppercase">Towk frontend</p>
        <h1 class="text-3xl font-semibold text-text-top">Canonical component registry</h1>
        <p class="text-muted">
          Application features import public primitives from <code>$lib/ui</code> or
          <code>$lib/ui/form</code>. Storybook documents their contract; feature code owns only
          domain composition.
        </p>
      </header>

      {#each DESIGN_SYSTEM_FAMILIES as family (family)}
        <section class="space-y-3" aria-labelledby={`family-${family}`}>
          <div>
            <h2 id={`family-${family}`} class="text-xl font-semibold capitalize text-text-top">
              {family}
            </h2>
            <p class="text-sm text-muted">{familyDescriptions[family]}</p>
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            {#each DESIGN_SYSTEM_PRIMITIVES.filter((primitive) => primitive.family === family) as primitive (`${primitive.module}:${primitive.name}`)}
              <article class="panel-shell panel-body flex min-w-0 flex-col gap-3 p-4">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h3 class="font-semibold text-text-top">{primitive.name}</h3>
                    <code class="text-xs text-muted">{primitive.module}</code>
                  </div>
                  <div class="flex flex-wrap gap-1.5 text-xs">
                    <span class="rounded-full border border-border bg-surface-100 px-2 py-1">
                      {primitive.presentation}
                    </span>
                    {#if primitive.story}
                      <span class="rounded-full border border-success/30 bg-success/10 px-2 py-1 text-success">
                        live story
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
                    <dt class="font-medium text-text-top">Responsive</dt>
                    <dd class="text-muted">{primitive.responsive}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-text-top">Accessibility</dt>
                    <dd class="text-muted">{primitive.accessibility}</dd>
                  </div>
                </dl>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </main>
</Story>

<Story
  name="Responsive release matrix"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The minimum viewport matrix for shared shell, overlay, navigation, and form changes. Component-specific risks can add more cases but must not remove these.'
      }
    }
  }}
>
  <main class="min-h-screen bg-background p-4 text-text sm:p-6 lg:p-8">
    <div class="mx-auto max-w-6xl space-y-5">
      <header class="max-w-3xl space-y-2">
        <h1 class="text-3xl font-semibold text-text-top">Responsive release matrix</h1>
        <p class="text-muted">
          Validate both browser and installed-PWA geometry. Width is not a substitute for input,
          keyboard, safe-area, or reduced-motion coverage.
        </p>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {#each releaseViewports as viewport (`${viewport.width}x${viewport.height}`)}
          <article class="panel-shell panel-body space-y-3 p-4">
            <div class="flex items-start justify-between gap-3">
              <h2 class="font-semibold text-text-top">{viewport.name}</h2>
              <span class="rounded-full bg-surface-100 px-2 py-1 font-mono text-xs">
                {viewport.width}×{viewport.height}
              </span>
            </div>
            <div
              class="mx-auto grid max-w-full place-items-center rounded-lg border border-border bg-surface-100 text-xs text-muted"
              style={`aspect-ratio: ${viewport.width} / ${viewport.height}; width: min(100%, ${Math.max(88, Math.round((viewport.width / viewport.height) * 112))}px);`}
              aria-hidden="true"
            >
              viewport
            </div>
            <p class="text-sm text-muted">Primary concern: {viewport.concern}.</p>
          </article>
        {/each}
      </div>
    </div>
  </main>
</Story>

<Story
  name="Interaction capability matrix"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Shared primitives must preserve equivalent outcomes across pointer, touch, keyboard, hybrid input, reduced motion, and high-contrast modes.'
      }
    }
  }}
>
  <main class="min-h-screen bg-background p-4 text-text sm:p-6 lg:p-8">
    <div class="mx-auto max-w-5xl space-y-5">
      <header class="max-w-3xl space-y-2">
        <h1 class="text-3xl font-semibold text-text-top">Interaction capabilities</h1>
        <p class="text-muted">
          Presentation may adapt, but permissions, available commands, focus ownership, and
          recoverability remain equivalent.
        </p>
      </header>

      <div class="grid gap-3 md:grid-cols-2">
        {#each interactionModes as mode (mode.name)}
          <article class="surface-box space-y-2 p-4">
            <h2 class="font-semibold text-text-top">{mode.name}</h2>
            <p class="text-sm text-muted">{mode.rule}</p>
          </article>
        {/each}
      </div>
    </div>
  </main>
</Story>
