<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { serverIdToSegment } from '$lib/navigation';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { createRoleAPI } from '$lib/api-client/roles';
  import { Panel } from '$lib/components/admin';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';
  import PageTitle from '$lib/ui/PageTitle.svelte';
  import { FormError } from '$lib/ui/form';
  import { RoleForm } from '$lib/components/rbac';
  import {
    GRADE_TEMPLATES,
    MEMBER_PERMISSIONS,
    gradeTemplateById,
    type GradeTemplateId
  } from '$lib/components/rbac/gradeTemplates';
  import { getPermissionDescription, getPermissionRisk } from '$lib/permissions';
  import * as m from '$lib/i18n/messages';
  import { g } from '$lib/i18n/gradeMessages.svelte';
  import { localizedErrorMessage } from '$lib/i18n/localizedError';

  const connection = useConnection();

  let selectedTemplate = $state<GradeTemplateId>('moderator.v1');
  let name = $state('moderation-team');
  let displayName = $state(g['grades.templates.moderator.default_name']());
  let description = $state(g['grades.templates.moderator.default_description']());
  let color = $state('#16A34A');
  let pingable = $state(true);
  let creating = $state(false);
  let error = $state<string | null>(null);
  let canManageRoles = $state(false);
  let loading = $state(true);

  const template = $derived(gradeTemplateById(selectedTemplate));

  function roleAPI() {
    const conn = connection();
    return createRoleAPI({
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
  }

  function riskLabel(permission: string): string {
    switch (getPermissionRisk(permission)) {
      case 'standard': return g['grades.risk.standard']();
      case 'moderation': return g['grades.risk.moderation']();
      case 'sensitive': return g['grades.risk.sensitive']();
      case 'destructive': return g['grades.risk.destructive']();
      case 'privilege': return g['grades.risk.privilege']();
    }
  }

  async function loadPermissions() {
    loading = true;
    try {
      const resp = await roleAPI().listAdminRoles();
      canManageRoles = resp.viewerCanManageRoles;
    } catch (err) {
      error = localizedErrorMessage(err, m['admin.permissions.load_instance_failed']());
    } finally {
      loading = false;
    }
  }

  $effect(() => { void loadPermissions(); });

  function chooseTemplate(next: GradeTemplateId) {
    if (selectedTemplate === next || creating) return;
    selectedTemplate = next;
    const selected = gradeTemplateById(next);
    name = selected.defaultName;
    displayName = selected.defaultDisplayName();
    description = selected.defaultDescription();
    color = selected.defaultColor;
    pingable = selected.defaultPingable;
    error = null;
  }

  async function createRole() {
    if (creating) return;
    creating = true;
    error = null;
    const roleName = name.trim();
    try {
      await roleAPI().createRole({
        name: roleName,
        displayName: displayName.trim(),
        description: description.trim(),
        pingable,
        color,
        templateId: selectedTemplate === 'custom' ? undefined : selectedTemplate
      });
    } catch (err) {
      error = localizedErrorMessage(err, g['grades.create.permission_setup_failed']());
      creating = false;
      return;
    }

    goto(resolve('/chat/[serverId]/server-admin/permissions/[name]', {
      serverId: serverIdToSegment(getActiveServer()),
      name: roleName
    }));
  }
</script>

<PageTitle title={m['admin.common.server_admin_page_title']({ title: g['grades.create.title']() })} />

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <PaneHeader
    title={g['grades.create.title']()}
    subtitle={g['grades.create.subtitle']()}
    backHref={resolve('/chat/[serverId]/server-admin/permissions', { serverId: serverIdToSegment(getActiveServer()) })}
    backLabel={m['admin.permissions.back_to_permissions']()}
    showMobileNav
  />

  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
    {#if loading}
      <div class="text-muted">{m['admin.common.loading']()}</div>
    {:else if !canManageRoles}
      <div class="text-danger">{m['admin.permissions.need_manage_create']()}</div>
    {:else}
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {#if error}<FormError {error} />{/if}

        <Panel title={g['grades.create.starting_point']()} subtitle={g['grades.create.starting_point_description']()} icon="iconify uil--layer-group">
          <div class="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label={g['grades.create.starting_point']()}>
            {#each GRADE_TEMPLATES as option (option.id)}
              <button
                type="button"
                role="radio"
                aria-checked={selectedTemplate === option.id}
                disabled={creating}
                class={[
                  'min-h-32 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                  selectedTemplate === option.id ? 'border-primary bg-primary/10' : 'border-text/10 bg-surface-100 hover:bg-surface-200'
                ]}
                onclick={() => chooseTemplate(option.id)}
              >
                <span class="mb-3 inline-grid h-10 w-10 place-items-center rounded-lg bg-surface-200">
                  <span class="iconify text-xl {option.icon}" aria-hidden="true"></span>
                </span>
                <span class="block font-semibold">{option.title()}</span>
                <span class="mt-1 block text-sm leading-relaxed text-muted">{option.description()}</span>
              </button>
            {/each}
          </div>
        </Panel>

        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <Panel title={g['grades.create.identity']()} icon="iconify uil--user-square">
            <RoleForm
              bind:name bind:displayName bind:description bind:color bind:pingable
              saving={creating}
              submitLabel={g['grades.create.create']()}
              savingLabel={g['grades.create.creating']()}
              onSubmit={createRole}
            />
            {#if name}
              <p class="mt-3 break-all text-xs text-muted">{g['grades.create.handle_preview']({ handle: name.trim() })}</p>
            {/if}
          </Panel>

          <div class="flex flex-col gap-6 lg:sticky lg:top-0">
            <Panel title={g['grades.create.permissions']()} icon="iconify uil--shield-check">
              <section>
                <h3 class="text-sm font-semibold">{g['grades.create.added_permissions']()}</h3>
                {#if template.permissions.length === 0}
                  <p class="mt-2 text-sm text-muted">{g['grades.create.no_added_permissions']()}</p>
                {:else}
                  <ul class="mt-3 space-y-3">
                    {#each template.permissions as permission (permission)}
                      <li class="rounded-lg border border-text/10 bg-surface-100 p-3">
                        <div class="flex items-start justify-between gap-3">
                          <code class="min-w-0 break-all text-xs">{permission}</code>
                          <span class="shrink-0 rounded-full bg-surface-200 px-2 py-0.5 text-[0.7rem] text-muted">{riskLabel(permission)}</span>
                        </div>
                        <p class="mt-2 text-sm text-muted">{getPermissionDescription(permission)}</p>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </section>

              <section class="mt-5 border-t border-text/10 pt-5">
                <h3 class="text-sm font-semibold">{g['grades.create.inherited_permissions']()}</h3>
                <div class="mt-3 flex flex-wrap gap-2">
                  {#each MEMBER_PERMISSIONS as permission (permission)}
                    <code class="rounded-md bg-surface-200 px-2 py-1 text-[0.7rem]">{permission}</code>
                  {/each}
                </div>
                <p class="mt-3 text-xs leading-relaxed text-muted">{g['grades.create.member_inheritance_note']()}</p>
              </section>
            </Panel>

            <Panel title={g['grades.create.advanced']()} icon="iconify uil--sliders-v-alt">
              <p class="text-sm leading-relaxed text-muted">{g['grades.create.advanced_description']()}</p>
            </Panel>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
