<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Combobox from './Combobox.svelte';

  type ChannelOption = {
    value: string;
    label: string;
    detail?: string;
  };

  const { Story } = defineMeta({
    title: 'Form/Combobox',
    component: Combobox,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Searchable single-value input that retains focus on the text field and exposes the active listbox option through aria-activedescendant.'
        }
      }
    }
  });

  const channels: ChannelOption[] = [
    { value: 'general', label: 'General', detail: 'Shared team conversation' },
    { value: 'engineering', label: 'Engineering', detail: 'Architecture and implementation' },
    { value: 'support', label: 'Support', detail: 'User questions and incidents' },
    { value: 'release', label: 'Release coordination', detail: 'Qualification and rollout' }
  ];

  const longLabels: ChannelOption[] = [
    {
      value: 'de',
      label: 'Produktübergreifende Abstimmung und langfristige Infrastrukturplanung'
    },
    {
      value: 'fr',
      label: 'Coordination interéquipes et planification des opérations de production'
    },
    {
      value: 'pt',
      label: 'Planejamento de infraestrutura e coordenação entre equipes distribuídas'
    }
  ];

  const getValue = (item: ChannelOption) => item.value;
  const getLabel = (item: ChannelOption) => item.label;
</script>

<script lang="ts">
  let selectedValue = $state('');
  let selectedText = $state('');
  let freeformValue = $state('');
  let freeformText = $state('');
  let loadingValue = $state('');
  let loadingText = $state('');
  let emptyValue = $state('');
  let emptyText = $state('unavailable');
  let longValue = $state('');
  let longText = $state('');
</script>

{#snippet channelLabel({ item }: { item: ChannelOption; selected: boolean })}
  <span class="flex min-w-0 flex-col">
    <span class="truncate font-medium text-text-top">{item.label}</span>
    {#if item.detail}
      <span class="truncate text-xs text-muted">{item.detail}</span>
    {/if}
  </span>
{/snippet}

<Story
  name="Constrained selection"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Use allowFreeform=false when only a server-provided option is valid. Arrow keys update the active descendant while focus remains on the input.'
      }
    }
  }}
>
  <div class="max-w-md rounded-xl border border-border bg-background p-5 text-text">
    <Combobox
      id="storybook-channel-select"
      label="Default channel"
      bind:value={selectedValue}
      bind:text={selectedText}
      items={channels}
      {getValue}
      {getLabel}
      allowFreeform={false}
      placeholder="Search channels"
      description="Select one of the channels available on this server."
      item={channelLabel}
    />
    <p class="mt-4 text-xs text-muted">Selected value: {selectedValue || 'none'}</p>
  </div>
</Story>

<Story
  name="Freeform with suggestions"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Freeform mode keeps the typed value while still allowing a known suggestion to replace it.'
      }
    }
  }}
>
  <div class="max-w-md rounded-xl border border-border bg-background p-5 text-text">
    <Combobox
      id="storybook-event-filter"
      label="Event type"
      bind:value={freeformValue}
      bind:text={freeformText}
      items={channels}
      {getValue}
      {getLabel}
      placeholder="Type a value or choose a suggestion"
      description="Custom event names remain valid in this filter."
    />
    <p class="mt-4 text-xs text-muted">Current value: {freeformValue || 'empty'}</p>
  </div>
</Story>

<Story
  name="Loading suggestions"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Loading keeps the listbox available, marks the combobox busy, and preserves the current query.'
      }
    }
  }}
>
  <div class="max-w-md rounded-xl border border-border bg-background p-5 text-text">
    <Combobox
      id="storybook-loading-combobox"
      label="Search members"
      bind:value={loadingValue}
      bind:text={loadingText}
      items={[]}
      {getValue}
      {getLabel}
      loading
      placeholder="Start typing a member name"
    />
  </div>
</Story>

<Story
  name="No results"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'An empty result remains inside the listbox and never turns into a selectable placeholder.'
      }
    }
  }}
>
  <div class="max-w-md rounded-xl border border-border bg-background p-5 text-text">
    <Combobox
      id="storybook-empty-combobox"
      label="Search roles"
      bind:value={emptyValue}
      bind:text={emptyText}
      items={[]}
      {getValue}
      {getLabel}
      allowFreeform={false}
      emptyMessage="No roles match this query"
    />
  </div>
</Story>

<Story
  name="Long localized labels"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Long translated option labels remain bounded by the form surface and use intentional truncation inside the floating list.'
      }
    }
  }}
>
  <div class="max-w-sm rounded-xl border border-border bg-background p-5 text-text">
    <Combobox
      id="storybook-long-label-combobox"
      label="Kanal für Benachrichtigungen"
      bind:value={longValue}
      bind:text={longText}
      items={longLabels}
      {getValue}
      {getLabel}
      allowFreeform={false}
      placeholder="Kanal auswählen"
    />
  </div>
</Story>
