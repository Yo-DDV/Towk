<script lang="ts">
  import { FormField } from '$lib/ui/form';
  import * as m from '$lib/i18n/messages';

  const palette = [
    '#2563EB',
    '#7C3AED',
    '#DB2777',
    '#F97316',
    '#CA8A04',
    '#16A34A',
    '#0D9488',
    '#0891B2'
  ];

  let {
    color = $bindable('#2563EB'),
    disabled = false
  }: {
    color?: string;
    disabled?: boolean;
  } = $props();

  const normalizedColor = $derived(
    /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : '#2563EB'
  );
  const colorError = $derived(
    !/^#[0-9A-Fa-f]{6}$/.test(color) ? m['rbac.role_form.color_invalid']() : undefined
  );

  function updateFromPicker(event: Event) {
    color = (event.currentTarget as HTMLInputElement).value.toUpperCase();
  }

  function updateFromHex(event: Event) {
    color = (event.currentTarget as HTMLInputElement).value.toUpperCase();
  }
</script>

<FormField
  id="roleColorHex"
  label={m['rbac.role_form.color']()}
  error={colorError}
  description={m['rbac.role_form.color_description']()}
  required
>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <input
        id="roleColor"
        type="color"
        value={normalizedColor}
        onchange={updateFromPicker}
        {disabled}
        aria-label={m['rbac.role_form.color_picker']()}
        class="role-color-picker h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-input-border bg-input p-1 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <input
        id="roleColorHex"
        type="text"
        value={color}
        oninput={updateFromHex}
        {disabled}
        required
        maxlength="7"
        inputmode="text"
        spellcheck="false"
        autocomplete="off"
        class="input min-w-0 flex-1 font-mono uppercase"
        aria-invalid={colorError ? 'true' : undefined}
        aria-describedby={colorError ? 'roleColorHex-error' : 'roleColorHex-description'}
      />
      <span
        class="role-color-preview h-8 w-8 shrink-0 rounded-full border border-border"
        style:--role-color={normalizedColor}
        aria-hidden="true"
      ></span>
    </div>
    <div class="flex flex-wrap gap-1" aria-label={m['rbac.role_form.color_presets']()}>
      {#each palette as preset (preset)}
        <button
          type="button"
          class="role-color-preset h-8 w-8 rounded-full border border-border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          class:ring-2={normalizedColor === preset}
          class:ring-text={normalizedColor === preset}
          style:--role-color={preset}
          aria-label={m['rbac.role_form.color_preset']({ color: preset })}
          aria-pressed={normalizedColor === preset}
          onclick={() => (color = preset)}
          {disabled}
        ></button>
      {/each}
    </div>
  </div>
</FormField>

<style>
  .role-color-preset,
  .role-color-preview {
    background-color: var(--role-color);
  }

  .role-color-picker {
    color-scheme: light dark;
  }
</style>
