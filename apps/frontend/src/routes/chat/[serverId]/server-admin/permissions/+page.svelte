<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { serverIdToSegment } from '$lib/navigation';
  import { getActiveServer } from '$lib/state/activeServer.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { createRoleAPI, type ServerRole } from '$lib/api-client/roles';
  import { Hint } from '$lib/ui';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';
  import PageTitle from '$lib/ui/PageTitle.svelte';
  import { Button } from '$lib/ui/form';
  import { Panel } from '$lib/components/admin';
  import GradeIconBadge from '$lib/components/rbac/GradeIconBadge.svelte';
  import PermissionMatrix from '$lib/components/rbac/PermissionMatrix.svelte';
  import { gradeVisual } from '$lib/components/rbac/gradeVisuals';
  import { localizedRoleDescription, localizedRoleDisplayName } from '$lib/rbacLabels';
  import * as m from '$lib/i18n/messages';
  import { g } from '$lib/i18n/gradeMessages.svelte';
  import { localizedErrorMessage } from '$lib/i18n/localizedError';

  const serverSegment = $derived(serverIdToSegment(getActiveServer()));
  const connection = useConnection();
  let roles = $state<ServerRole[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const communityGradeNames = ['owner', 'moderator', 'helper', 'everyone'] as const;
  const communityGrades = $derived(
    communityGradeNames
      .map((name) => roles.find((role) => role.name === name))
      .filter((role): role is ServerRole => Boolean(role))
  );
  const adminGrade = $derived(roles.find((role) => role.name === 'admin') ?? null);
  const customGrades = $derived(roles.filter((role) => !role.isSystem));

  function roleAPI() {
    const conn = connection();
    return createRoleAPI({
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    });
  }

  async function loadRoles() {
    loading = true;
    error = null;
    try {
      const response = await roleAPI().listAdminRoles();
      roles = response.roles;
    } catch (err) {
      error = localizedErrorMessage(err, m['admin.permissions.load_instance_failed']());
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadRoles();
  });

  function roleHref(roleName: string) {
    return resolve('/chat/[serverId]/server-admin/permissions/[name]', {
      serverId: serverSegment,
      name: roleName
    });
  }

  function openRoleDetail(role: { roleName: string }) {
    goto(roleHref(role.roleName));
  }

  function gradeAccent(role: ServerRole): string {
    return role.color || gradeVisual(role.name).fallbackAccent;
  }

  function gradeSummary(roleName: string): string {
    if (roleName === 'owner') return g['grades.overview.owner_summary']();
    if (roleName === 'moderator') return g['grades.overview.moderator_summary']();
    if (roleName === 'helper') return g['grades.overview.helper_summary']();
    if (roleName === 'everyone') return g['grades.overview.members_summary']();
    return g['grades.overview.admin_summary']();
  }
</script>

<PageTitle
  title={m['admin.common.server_admin_page_title']({ title: g['grades.overview.title']() })}
/>

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <PaneHeader
    title={g['grades.overview.title']()}
    subtitle={g['grades.overview.subtitle']()}
    showMobileNav
  >
    {#snippet actions()}
      <Button
        variant="primary"
        size="sm"
        href={resolve('/chat/[serverId]/server-admin/permissions/new', {
          serverId: serverSegment
        })}
      >
        <span class="iconify uil--plus" aria-hidden="true"></span>
        {g['grades.create.title']()}
      </Button>
    {/snippet}
  </PaneHeader>

  <div class="flex flex-col gap-6 overflow-y-auto p-4 sm:p-6">
    {#if error}
      <Hint tone="danger">{error}</Hint>
    {:else if loading}
      <div class="text-muted">{m['admin.common.loading']()}</div>
    {:else}
      <Panel
        title={g['grades.overview.default_grades']()}
        subtitle={m['admin.permissions.role_presets_intro']()}
        icon="iconify uil--shield-check"
      >
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {#each communityGrades as role (role.name)}
            <a
              href={roleHref(role.name)}
              class="grade-card group p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid={`default-grade-card-${role.name}`}
            >
              <div class="flex items-start justify-between gap-3">
                <GradeIconBadge
                  icon={gradeVisual(role.name).icon}
                  accent={gradeAccent(role)}
                />
                <span
                  class="iconify uil--angle-right mt-1 text-muted transition-colors group-hover:text-text"
                  aria-hidden="true"
                ></span>
              </div>
              <h2 class="mt-3 font-semibold">
                {localizedRoleDisplayName(role.name, role.displayName)}
              </h2>
              <p class="mt-1 text-sm leading-relaxed text-muted">{gradeSummary(role.name)}</p>
            </a>
          {/each}
        </div>
      </Panel>

      {#if adminGrade}
        <Panel
          title={g['grades.overview.advanced_admin']()}
          subtitle={g['grades.overview.admin_summary']()}
          icon="iconify mdi--account-cog-outline"
        >
          <a
            href={roleHref(adminGrade.name)}
            class="grade-card group flex items-center gap-4 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="default-grade-card-admin"
          >
            <GradeIconBadge
              icon={gradeVisual(adminGrade.name).icon}
              accent={gradeAccent(adminGrade)}
            />
            <span class="min-w-0 flex-1">
              <span class="block font-semibold">
                {localizedRoleDisplayName(adminGrade.name, adminGrade.displayName)}
              </span>
              <span class="mt-1 block text-sm text-muted">
                {localizedRoleDescription(adminGrade.name, adminGrade.description)}
              </span>
            </span>
            <span class="iconify uil--angle-right shrink-0 text-muted transition-colors group-hover:text-text" aria-hidden="true"></span>
          </a>
        </Panel>
      {/if}

      <Panel
        title={g['grades.overview.custom_grades']()}
        icon="iconify mdi--tune-variant"
        noPadding
      >
        {#if customGrades.length === 0}
          <div class="p-4 text-sm text-muted">{m['rbac.permissions.no_roles']()}</div>
        {:else}
          <div class="divide-y divide-text/10">
            {#each customGrades as role (role.name)}
              <a
                href={roleHref(role.name)}
                class="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
              >
                <GradeIconBadge
                  icon={gradeVisual(role.name).icon}
                  accent={gradeAccent(role)}
                  size="xs"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{role.displayName}</span>
                  <span class="block truncate text-xs text-muted">@{role.name}</span>
                </span>
                <span class="text-xs text-muted">{role.permissions.length}</span>
                <span class="iconify uil--angle-right text-muted" aria-hidden="true"></span>
              </a>
            {/each}
          </div>
        {/if}
      </Panel>

        <details open class="rounded-xl border border-text/10 bg-surface-100">
        <summary
          class="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span class="iconify uil--table" aria-hidden="true"></span>
          <span>{g['grades.create.advanced']()}</span>
        </summary>
        <div class="border-t border-text/10 p-4">
          <Hint>
            <div class="space-y-2">
              <p>{m['admin.permissions.server_tier_intro']()}</p>
              <p>{m['admin.permissions.server_tier_denies_hint']()}</p>
            </div>
          </Hint>
          <div class="mt-4">
            <PermissionMatrix
              onRoleClick={openRoleDetail}
              isRoleClickable={() => true}
            />
          </div>
        </div>
      </details>
    {/if}
  </div>
</div>

<style>
  .grade-card {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    border: 1px solid var(--liquid-glass-border);
    border-radius: 1rem;
    background: var(--liquid-glass-solid);
    box-shadow:
      inset 0 1px 0 var(--liquid-glass-edge-light),
      inset 1px 0 0 var(--liquid-glass-edge-side),
      inset -1px 0 0 var(--liquid-glass-edge-side),
      inset 0 -1px 0 var(--liquid-glass-edge-shadow),
      0 1px 2px var(--liquid-glass-key-shadow),
      0 16px 34px -28px var(--liquid-glass-ambient-shadow);
    transition:
      border-color 160ms ease,
      box-shadow 170ms ease,
      transform 160ms ease;
  }

  .grade-card::before {
    position: absolute;
    inset: 0 0 auto;
    z-index: -1;
    height: 45%;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent);
    content: '';
    pointer-events: none;
  }

  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .grade-card {
      background: var(--liquid-glass-translucent);
      -webkit-backdrop-filter: blur(14px) saturate(105%);
      backdrop-filter: blur(14px) saturate(105%);
    }
  }

  @media (hover: hover) and (pointer: fine) {
    .grade-card:hover {
      border-color: var(--liquid-glass-border-strong);
      transform: translateY(-1px);
      box-shadow:
        inset 0 1px 0 var(--liquid-glass-edge-light),
        inset 1px 0 0 var(--liquid-glass-edge-side),
        inset -1px 0 0 var(--liquid-glass-edge-side),
        inset 0 -1px 0 var(--liquid-glass-edge-shadow),
        0 2px 4px var(--liquid-glass-key-shadow),
        0 20px 40px -29px var(--liquid-glass-ambient-shadow);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .grade-card {
      transition: none;
    }
  }

  @media (prefers-reduced-transparency: reduce) {
    .grade-card {
      background: var(--liquid-glass-solid);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }

  @media (forced-colors: active) {
    .grade-card {
      border-color: CanvasText;
      background: Canvas;
      box-shadow: none;
    }

    .grade-card::before {
      display: none;
    }
  }
</style>
