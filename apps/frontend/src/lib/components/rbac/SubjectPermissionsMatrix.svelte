<!--
@component

Presentational matrix used by both the per-user and per-role permissions
pages. Caller owns data loading and mutation dispatch; this component
just lays out the rows (permissions grouped by category) and columns
(server + groups + nested rooms), and forwards cell clicks via `onCycle`.

Cell semantics:
  - `override` ALLOW/DENY → solid (subject has an explicit grant/deny here)
  - `override` NONE        → faded, tinted by `effective` (the resolver's
                             baseline at this scope without an override)

A missing cell renders as an empty placeholder (the permission doesn't
apply at that scope's tier).
-->
<script lang="ts">
  import { Panel, DataTable } from '$lib/components/admin';
  import { Hint, HelpTooltip } from '$lib/ui';
  import { getPermissionDescription } from '$lib/permissions';
  import {
    localizedDecisionState,
    localizedScopeKind,
    localizedScopeLabel,
    localizedSubjectKind
  } from '$lib/rbacLabels';
  import MatrixCell from './MatrixCell.svelte';
  import * as m from '$lib/i18n/messages';

  export type MatrixDecision = 'ALLOW' | 'DENY' | 'NONE';
  export type MatrixScopeKind = 'SERVER' | 'GROUP' | 'ROOM';

  export type MatrixScope = {
    id: string;
    label: string;
    kind: MatrixScopeKind;
    parentGroupId: string;
  };
  export type MatrixCellData = {
    permission: string;
    scopeId: string;
    override: MatrixDecision;
    effective: MatrixDecision;
  };
  export type MatrixData = {
    applicablePermissions: string[];
    scopes: MatrixScope[];
    cells: MatrixCellData[];
  };
  export type CellState = 'allow' | 'deny' | 'neutral';

  const DEFAULT_CATEGORY_ORDER = [
    'space',
    'room',
    'message',
    'member',
    'role',
    'admin',
    'dm',
    'user'
  ];

  function categoryMeta(category: string): { title: string; description?: string } {
    if (category === 'space') {
      return {
        title: m['rbac.permissions.categories.space.title'](),
        description: m['rbac.permissions.categories.space.description']()
      };
    }
    if (category === 'room') {
      return {
        title: m['rbac.permissions.categories.room.title'](),
        description: m['rbac.permissions.categories.room.description']()
      };
    }
    if (category === 'message') {
      return {
        title: m['rbac.permissions.categories.message.title'](),
        description: m['rbac.permissions.categories.message.description']()
      };
    }
    if (category === 'member') {
      return {
        title: m['rbac.permissions.categories.member.title'](),
        description: m['rbac.permissions.categories.member.description']()
      };
    }
    if (category === 'role') {
      return {
        title: m['rbac.permissions.categories.role.title'](),
        description: m['rbac.permissions.categories.role.description']()
      };
    }
    if (category === 'admin') {
      return {
        title: m['rbac.permissions.categories.admin.title'](),
        description: m['rbac.permissions.categories.admin.description']()
      };
    }
    if (category === 'dm') {
      return {
        title: m['rbac.permissions.categories.dm.title'](),
        description: m['rbac.permissions.categories.dm.description']()
      };
    }
    if (category === 'user') {
      return {
        title: m['rbac.permissions.categories.user.title'](),
        description: m['rbac.permissions.categories.user.description']()
      };
    }
    return { title: category };
  }

  let {
    data,
    updatingKey = null,
    onCycle,
    subjectKind = 'subject',
    forceAllow = false,
    readOnly = false,
    categoryOrder = DEFAULT_CATEGORY_ORDER
  }: {
    data: MatrixData;
    /** `${scopeId}::${permission}` of the cell whose mutation is in flight. */
    updatingKey?: string | null;
    onCycle: (scope: MatrixScope, permission: string, next: CellState) => void;
    /** Used in aria/title text — "user", "role", etc. */
    subjectKind?: string;
    /** Display every existing cell as allowed regardless of stored decisions. */
    forceAllow?: boolean;
    /** Disable cell mutation controls. */
    readOnly?: boolean;
    categoryOrder?: string[];
  } = $props();

  // ----- Column layout ----------------------------------------------------

  // Order columns: server first, then each group followed by its rooms.
  // Backend returns server, then all groups, then all rooms — we re-order
  // here so rooms nest visually under their parent group.
  const orderedScopes = $derived.by<MatrixScope[]>(() => {
    const server = data.scopes.filter((s) => s.kind === 'SERVER');
    const groups = data.scopes.filter((s) => s.kind === 'GROUP');
    const rooms = data.scopes.filter((s) => s.kind === 'ROOM');
    const out: MatrixScope[] = [...server];
    for (const g of groups) {
      out.push(g);
      const groupId = g.id.startsWith('group:') ? g.id.slice('group:'.length) : '';
      for (const r of rooms) {
        if (r.parentGroupId === groupId) out.push(r);
      }
    }
    const seen = new Set(out.map((s) => s.id));
    for (const r of rooms) {
      if (!seen.has(r.id)) out.push(r);
    }
    return out;
  });

  // ----- Row layout -------------------------------------------------------

  function categoryOf(permission: string): string {
    const dot = permission.indexOf('.');
    return dot > 0 ? permission.slice(0, dot) : permission;
  }

  const groupedPermissions = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map is ephemeral within derived computation
    const groups = new Map<string, string[]>();
    for (const p of data.applicablePermissions) {
      const cat = categoryOf(p);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.localeCompare(b));
    const out: Array<{ category: string; permissions: string[] }> = [];
    for (const cat of categoryOrder) {
      const arr = groups.get(cat);
      if (arr && arr.length) out.push({ category: cat, permissions: arr });
    }
    for (const [cat, arr] of groups) {
      if (!categoryOrder.includes(cat) && arr.length) out.push({ category: cat, permissions: arr });
    }
    return out;
  });

  // ----- Cell lookup ------------------------------------------------------

  const cellIndex = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map is ephemeral within derived computation
    const idx = new Map<string, MatrixCellData>();
    for (const cell of data.cells) {
      idx.set(`${cell.scopeId}|${cell.permission}`, cell);
    }
    return idx;
  });

  function cellFor(scopeId: string, permission: string): MatrixCellData | undefined {
    return cellIndex.get(`${scopeId}|${permission}`);
  }

  function decisionToState(d: MatrixDecision): CellState {
    if (d === 'ALLOW') return 'allow';
    if (d === 'DENY') return 'deny';
    return 'neutral';
  }

  function scopeColumnClass(kind: MatrixScopeKind): string {
    if (kind === 'SERVER') return 'bg-surface-200/40';
    if (kind === 'GROUP') return 'bg-surface-200/20';
    return '';
  }
</script>

{#if orderedScopes.length === 0}
  <Hint tone="info">
    {m['rbac.permissions.no_scopes_available']({
      subject: localizedSubjectKind(subjectKind)
    })}
  </Hint>
{:else}
  <div class="flex flex-col gap-6">
    {#each groupedPermissions as group (group.category)}
      {@const meta = categoryMeta(group.category)}
      {@const categoryScopes = orderedScopes.filter((scope) =>
        group.permissions.some((p) => cellFor(scope.id, p) !== undefined)
      )}
      <Panel title={meta.title} subtitle={meta.description} noPadding>
        <div class="overflow-x-auto" style="width: max-content; max-width: 100%">
          <DataTable
            items={group.permissions}
            columns={categoryScopes.length + 1}
            getKey={(p) => p}
            emptyMessage={m['rbac.permissions.empty_category']()}
            hoverable={false}
          >
            {#snippet header()}
              <th
                class="sticky left-0 z-10 bg-background px-4 py-3 text-left align-bottom font-medium"
                style="width: 14rem"
              >
                {m['rbac.permissions.permission']()}
              </th>
              {#each categoryScopes as scope (scope.id)}
                {@const scopeLabel = localizedScopeLabel(scope)}
                {@const scopeKind = localizedScopeKind(scope.kind)}
                <th
                  class={[
                    'px-0 py-3 text-center align-bottom font-medium',
                    scopeColumnClass(scope.kind)
                  ]}
                  style="width: 2rem; min-width: 2rem; height: 12rem"
                  title={m['rbac.permissions.scope_title']({
                    label: scopeLabel,
                    kind: scopeKind
                  })}
                  data-scope={scope.id}
                >
                  <span
                    class={[
                      'text-sm',
                      scope.kind === 'SERVER' ? 'font-semibold' : '',
                      scope.kind === 'GROUP' ? 'text-primary' : '',
                      scope.kind === 'ROOM' ? 'text-muted' : ''
                    ]}
                    style="writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap"
                  >
                    {#if scope.kind === 'ROOM'}#{/if}{scopeLabel}
                  </span>
                </th>
              {/each}
            {/snippet}
            {#snippet row(permission)}
              <td class="sticky left-0 z-10 bg-background px-4 py-2 whitespace-nowrap">
                <code data-testid="permission-name" class="text-sm">{permission}</code>
                <HelpTooltip label={m['rbac.permissions.about_permission']({ permission })}>
                  {getPermissionDescription(permission)}
                </HelpTooltip>
              </td>
              {#each categoryScopes as scope (scope.id)}
                {@const scopeLabel = localizedScopeLabel(scope)}
                {@const subjectLabel = localizedSubjectKind(subjectKind)}
                {@const cell = cellFor(scope.id, permission)}
                {@const cellKey = `${scope.id}::${permission}`}
                {@const isUpdating = updatingKey === cellKey}
                <td
                  class={['px-0 py-2 text-center', scopeColumnClass(scope.kind)]}
                  style="width: 2.5rem; min-width: 2.5rem"
                  data-scope={scope.id}
                  data-permission={permission}
                >
                  {#if cell}
                    {@const ov = decisionToState(cell.override)}
                    {@const eff = decisionToState(cell.effective)}
                    {@const displayOverride = forceAllow ? 'allow' : ov}
                    {@const displayEffective = forceAllow ? 'neutral' : eff}
                    {@const ariaLabel = forceAllow
                      ? m['rbac.permissions.subject_always_granted_at_scope']({
                          subject: subjectLabel,
                          permission,
                          scope: scopeLabel
                        })
                      : ov !== 'neutral'
                        ? m['rbac.permissions.override_for_permission_scope']({
                            state: localizedDecisionState(ov),
                            permission,
                            scope: scopeLabel
                          })
                        : m['rbac.permissions.no_override_effective_scope']({
                            permission,
                            scope: scopeLabel,
                            state: localizedDecisionState(eff)
                          })}
                    {@const titleParts = forceAllow
                      ? [
                          m['rbac.permissions.allow_owners_all'](),
                          m['rbac.permissions.owner_permissions_not_editable']()
                        ]
                      : [
                          ov !== 'neutral'
                            ? m['rbac.permissions.subject_override_at_scope']({
                                state: localizedDecisionState(ov),
                                subject: subjectLabel,
                                scope: scopeLabel
                              })
                            : null,
                          ov === 'neutral' && eff !== 'neutral'
                            ? m['rbac.permissions.effective_inherited']({
                                state: localizedDecisionState(eff)
                              })
                            : null,
                          ov === 'neutral' && eff === 'neutral'
                            ? m['rbac.permissions.state_neutral']()
                            : null
                        ].filter(Boolean)}
                    <MatrixCell
                      override={displayOverride}
                      inherited={displayEffective}
                      updating={isUpdating}
                      disabled={readOnly}
                      {ariaLabel}
                      title={titleParts.join(' · ')}
                      onCycle={(next) => onCycle(scope, permission, next)}
                    />
                  {:else}
                    <span class="inline-block h-10 w-10" aria-hidden="true"></span>
                  {/if}
                </td>
              {/each}
            {/snippet}
          </DataTable>
        </div>
      </Panel>
    {/each}
  </div>
{/if}
