<script lang="ts">
  import { Code, ConnectError } from '@connectrpc/connect';
  import { onMount } from 'svelte';
  import {
    getAdminPerformanceSettings,
    getAdminSystemInfo,
    updateAdminPerformanceSettings,
    type AdminPerformanceSettings,
    type AdminSystemInfo,
    type MutablePerformanceProfile,
    type PerformanceCapReason,
    type PerformanceLimitField,
    type PerformanceLimits,
    type PerformancePolicySource,
    type PerformanceProfile
  } from '$lib/api-client/adminDiagnostics';
  import { Panel, StatCard, DataTable, formatBytes, formatNumber } from '$lib/components/admin';
  import { Hint, Pill } from '$lib/ui';
  import { Button } from '$lib/ui/form';
  import PaneHeader from '$lib/ui/PaneHeader.svelte';
  import PageTitle from '$lib/ui/PageTitle.svelte';
  import { useConnection } from '$lib/state/server/connection.svelte';
  import { toast } from '$lib/ui/toast';
  import * as m from '$lib/i18n/messages';

  const connection = useConnection();

  let systemInfo = $state.raw<AdminSystemInfo | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let performanceSettings = $state.raw<AdminPerformanceSettings | null>(null);
  let performanceLoading = $state(true);
  let performanceSaving = $state(false);
  let performanceError = $state(false);
  let selectedProfile = $state<MutablePerformanceProfile>('balanced');
  let customLimits = $state<PerformanceLimits>({
    image_transform_workers: 2,
    image_transform_admissions: 8,
    asset_upload_workers: 4,
    link_preview_workers: 2,
    video_workers: 2
  });

  const mutableProfiles: MutablePerformanceProfile[] = [
    'economy',
    'balanced',
    'performance',
    'custom'
  ];
  const performanceFields: PerformanceLimitField[] = [
    'image_transform_workers',
    'image_transform_admissions',
    'asset_upload_workers',
    'link_preview_workers',
    'video_workers'
  ];
  const customLimitsValid = $derived(
    performanceFields.every((field) => {
      const value = customLimits[field];
      const maximum = field === 'image_transform_admissions' ? 256 : 64;
      return Number.isInteger(value) && value >= 1 && value <= maximum;
    }) && customLimits.image_transform_admissions >= customLimits.image_transform_workers
  );

  const streams = $derived(systemInfo?.nats.streams ?? []);
  const consumers = $derived(systemInfo?.nats.consumers ?? []);
  const projections = $derived(
    [...(systemInfo?.projections ?? [])].sort((a, b) => {
      if (a.failed !== b.failed) return a.failed ? -1 : 1;
      if (a.estimatedBytes !== b.estimatedBytes) return b.estimatedBytes - a.estimatedBytes;
      return a.name.localeCompare(b.name);
    })
  );
  const totalEstimatedBytes = $derived(
    projections.reduce((sum, projection) => sum + projection.estimatedBytes, 0)
  );
  const totalEntries = $derived(
    projections.reduce((sum, projection) => sum + projection.entryCount, 0)
  );
  const laggingCount = $derived(projections.filter((projection) => projection.lag > 0).length);
  const failedProjectionCount = $derived(
    projections.filter((projection) => projection.failed).length
  );
  const consumersWithBacklog = $derived(
    consumers.filter((consumer) => consumer.pending > 0).length
  );
  const fileStreamCount = $derived(streams.filter((stream) => stream.storage === 'File').length);
  const memoryStreamCount = $derived(
    streams.filter((stream) => stream.storage === 'Memory').length
  );
  const pullConsumerCount = $derived(consumers.filter((consumer) => consumer.pullBased).length);
  const pushConsumerCount = $derived(consumers.length - pullConsumerCount);
  const unboundPushConsumerCount = $derived(
    consumers.filter((consumer) => !consumer.pullBased && !consumer.pushBound).length
  );
  const totalRedelivered = $derived(
    consumers.reduce((sum, consumer) => sum + consumer.redelivered, 0)
  );
  const averageEventBytes = $derived(
    systemInfo && systemInfo.nats.totalMessages > 0
      ? systemInfo.nats.totalBytes / systemInfo.nats.totalMessages
      : 0
  );
  const averageProjectionEntryBytes = $derived(
    totalEntries > 0 ? totalEstimatedBytes / totalEntries : 0
  );
  const largestStream = $derived.by(() => {
    let largest = streams[0] ?? null;
    for (const stream of streams) {
      if (!largest || stream.bytes > largest.bytes) largest = stream;
    }
    return largest;
  });

  function apiConfig() {
    const conn = connection();
    return {
      baseUrl: conn.connectBaseUrl,
      bearerToken: conn.bearerToken
    };
  }

  async function loadSystemInfo() {
    loading = true;
    error = null;
    try {
      systemInfo = await getAdminSystemInfo(apiConfig());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      systemInfo = null;
    } finally {
      loading = false;
    }
  }

  function applyPerformanceSettings(settings: AdminPerformanceSettings) {
    performanceSettings = settings;
    selectedProfile =
      settings.requestedProfile === 'legacy' || settings.requestedProfile === 'unknown'
        ? 'balanced'
        : settings.requestedProfile;
    customLimits = { ...settings.requestedLimits };
  }

  async function loadPerformanceSettings() {
    performanceLoading = true;
    performanceError = false;
    try {
      applyPerformanceSettings(await getAdminPerformanceSettings(apiConfig()));
    } catch {
      performanceSettings = null;
      performanceError = true;
    } finally {
      performanceLoading = false;
    }
  }

  async function savePerformanceSettings() {
    if (!performanceSettings || performanceSaving) return;
    if (selectedProfile === 'custom' && !customLimitsValid) {
      toast.error(m['admin.system.performance_custom_invalid']());
      return;
    }

    performanceSaving = true;
    try {
      const settings = await updateAdminPerformanceSettings(apiConfig(), {
        profile: selectedProfile,
        expectedRevision: performanceSettings.revision,
        customLimits: selectedProfile === 'custom' ? { ...customLimits } : undefined
      });
      applyPerformanceSettings(settings);
      toast.success(m['admin.system.performance_saved']());
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Aborted) {
        await loadPerformanceSettings();
        toast.error(m['admin.system.performance_save_conflict']());
      } else {
        toast.error(m['admin.system.performance_save_failed']());
      }
    } finally {
      performanceSaving = false;
    }
  }

  onMount(() => {
    void loadSystemInfo();
    void loadPerformanceSettings();
  });

  function performanceProfileLabel(profile: PerformanceProfile): string {
    switch (profile) {
      case 'economy':
        return m['admin.system.performance_profile_economy']();
      case 'balanced':
        return m['admin.system.performance_profile_balanced']();
      case 'performance':
        return m['admin.system.performance_profile_performance']();
      case 'custom':
        return m['admin.system.performance_profile_custom']();
      case 'legacy':
        return m['admin.system.performance_profile_legacy']();
      case 'unknown':
        return m['admin.system.performance_source_unknown']();
    }
  }

  function performanceProfileDescription(profile: MutablePerformanceProfile): string {
    switch (profile) {
      case 'economy':
        return m['admin.system.performance_profile_economy_description']();
      case 'balanced':
        return m['admin.system.performance_profile_balanced_description']();
      case 'performance':
        return m['admin.system.performance_profile_performance_description']();
      case 'custom':
        return m['admin.system.performance_profile_custom_description']();
    }
  }

  function performanceFieldLabel(field: PerformanceLimitField): string {
    switch (field) {
      case 'image_transform_workers':
        return m['admin.system.performance_field_image_transform_workers']();
      case 'image_transform_admissions':
        return m['admin.system.performance_field_image_transform_admissions']();
      case 'asset_upload_workers':
        return m['admin.system.performance_field_asset_upload_workers']();
      case 'link_preview_workers':
        return m['admin.system.performance_field_link_preview_workers']();
      case 'video_workers':
        return m['admin.system.performance_field_video_workers']();
    }
  }

  function performanceSourceLabel(source: PerformancePolicySource): string {
    switch (source) {
      case 'historical':
        return m['admin.system.performance_source_historical']();
      case 'operator_default':
        return m['admin.system.performance_source_operator_default']();
      case 'owner':
        return m['admin.system.performance_source_owner']();
      case 'unknown':
        return m['admin.system.performance_source_unknown']();
    }
  }

  function performanceCapReasonLabel(reason: PerformanceCapReason): string {
    switch (reason) {
      case 'operator_cap':
        return m['admin.system.performance_cap_operator_cap']();
      case 'process_cpu':
        return m['admin.system.performance_cap_process_cpu']();
      case 'process_memory':
        return m['admin.system.performance_cap_process_memory']();
      case 'unknown':
        return m['admin.system.performance_cap_unknown']();
    }
  }

  function updateCustomLimit(field: PerformanceLimitField, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    customLimits = { ...customLimits, [field]: Number(input.value) };
  }

  function formatLimit(limit: number, formatter: (n: number) => string = String): string {
    return limit <= 0 ? m['admin.system.unlimited']() : formatter(limit);
  }

  function formatPercent(used: number, limit: number): string {
    if (limit <= 0) return m['admin.system.unlimited']();
    return `${Math.round((used / limit) * 100)}%`;
  }

  function consumerFilters(consumer: {
    filterSubject: string;
    filterSubjects: string[];
  }): string[] {
    if (consumer.filterSubjects.length > 0) return consumer.filterSubjects;
    if (consumer.filterSubject) return [consumer.filterSubject];
    return [m['admin.system.all_subjects']()];
  }

  function formatDurationSeconds(seconds: number | null | undefined): string {
    if (seconds == null) return m['admin.system.pending_state']();
    if (seconds < 0.001) return '<1 ms';
    if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
    if (seconds < 10) return `${seconds.toFixed(2)} s`;
    if (seconds < 60) return `${seconds.toFixed(1)} s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
</script>

<PageTitle title={m['admin.common.page_title']({ title: m['admin.system.title']() })} />

<div class="flex min-h-0 min-w-0 flex-1 flex-col">
  <PaneHeader
    title={m['admin.system.title']()}
    subtitle={m['admin.system.subtitle']()}
    showMobileNav
  />

  <div class="min-h-0 flex-1 overflow-y-auto" data-testid="admin-system-scroll">
    <div class="flex flex-col gap-6 p-6">
      {#if loading}
        <div class="text-muted">{m['admin.system.loading']()}</div>
      {:else if error}
        <Hint tone="danger">{error}</Hint>
      {:else if systemInfo}
        <Panel
          title={m['admin.system.performance_title']()}
          subtitle={m['admin.system.performance_subtitle']()}
          icon="iconify uil--tachometer-fast"
        >
          {#if performanceLoading}
            <div class="text-sm text-muted" aria-live="polite">
              {m['admin.system.performance_loading']()}
            </div>
          {:else if performanceError || !performanceSettings}
            <Hint tone="danger">{m['admin.system.performance_load_failed']()}</Hint>
          {:else}
            <div class="space-y-6" data-testid="performance-settings">
              <div class="flex flex-wrap items-center gap-2">
                <Pill tone="subtle">{performanceSourceLabel(performanceSettings.source)}</Pill>
                <Pill tone="primary">
                  {m['admin.system.performance_requested']()}:
                  {performanceProfileLabel(performanceSettings.requestedProfile)}
                </Pill>
                <Pill tone="success">
                  {m['admin.system.performance_effective']()}:
                  {performanceProfileLabel(performanceSettings.effectiveProfile)}
                </Pill>
              </div>

              {#if performanceSettings.requestedProfile === 'legacy'}
                <Hint tone="info">
                  <span class="font-medium">
                    {m['admin.system.performance_profile_legacy']()}
                  </span>
                  — {m['admin.system.performance_profile_legacy_description']()}
                </Hint>
              {/if}

              {#if performanceSettings.policyError}
                <Hint tone="danger">{m['admin.system.performance_policy_error']()}</Hint>
              {/if}

              {#if performanceSettings.restartRequired}
                <Hint tone="warning">{m['admin.system.performance_restart_required']()}</Hint>
              {/if}

              <fieldset class="space-y-3">
                <legend class="text-sm font-semibold">
                  {m['admin.system.performance_profile']()}
                </legend>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {#each mutableProfiles as profile (profile)}
                    <button
                      type="button"
                      class={[
                        'min-h-24 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        selectedProfile === profile
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-border bg-surface-100/70 hover:border-primary/50 hover:bg-surface-200/70'
                      ]}
                      aria-pressed={selectedProfile === profile}
                      onclick={() => (selectedProfile = profile)}
                      data-testid={`performance-profile-${profile}`}
                    >
                      <span class="flex items-center justify-between gap-2">
                        <span class="font-semibold">{performanceProfileLabel(profile)}</span>
                        <span class="flex flex-wrap justify-end gap-1">
                          {#if profile === 'balanced'}
                            <Pill tone="primary">
                              {m['admin.system.performance_recommended']()}
                            </Pill>
                          {/if}
                          {#if selectedProfile === profile}
                            <Pill tone="success">{m['admin.system.performance_selected']()}</Pill>
                          {/if}
                        </span>
                      </span>
                      <span class="mt-2 block text-sm text-muted">
                        {performanceProfileDescription(profile)}
                      </span>
                    </button>
                  {/each}
                </div>
              </fieldset>

              {#if selectedProfile === 'custom'}
                <div class="rounded-xl border border-border bg-surface-100/70 p-4">
                  <p class="mb-4 text-sm text-muted">
                    {m['admin.system.performance_custom_help']()}
                  </p>
                  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {#each performanceFields as field (field)}
                      <label class="grid gap-1.5 text-sm font-medium">
                        <span>{performanceFieldLabel(field)}</span>
                        <input
                          class="bg-surface-50 min-h-11 w-full rounded-lg border border-border px-3 font-mono text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                          type="number"
                          min="1"
                          max={field === 'image_transform_admissions' ? 256 : 64}
                          step="1"
                          value={customLimits[field]}
                          aria-invalid={!customLimitsValid || undefined}
                          oninput={(event) => updateCustomLimit(field, event)}
                          data-testid={`performance-limit-${field}`}
                        />
                      </label>
                    {/each}
                  </div>
                  {#if !customLimitsValid}
                    <p class="mt-3 text-sm text-danger" role="alert">
                      {m['admin.system.performance_custom_invalid']()}
                    </p>
                  {/if}
                </div>
              {/if}

              <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div class="rounded-xl border border-border bg-surface-100/70 p-4">
                  <h3 class="text-sm font-semibold">
                    {m['admin.system.performance_process_envelope']()}
                  </h3>
                  <div class="mt-3 space-y-2 text-sm text-muted">
                    <div>
                      {m['admin.system.performance_cpu_count']({
                        count: formatNumber(performanceSettings.envelope.cpus)
                      })}
                    </div>
                    <div>
                      {performanceSettings.envelope.memoryBytes > 0
                        ? m['admin.system.performance_memory_amount']({
                            amount: formatBytes(performanceSettings.envelope.memoryBytes)
                          })
                        : m['admin.system.performance_memory_unknown']()}
                    </div>
                  </div>
                </div>

                <div class="rounded-xl border border-border bg-surface-100/70 p-4">
                  <h3 class="text-sm font-semibold">
                    {m['admin.system.performance_limits']()}
                  </h3>
                  <div class="mt-3 divide-y divide-border">
                    {#each performanceFields as field (field)}
                      <div
                        class="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                      >
                        <div class="min-w-0 text-sm font-medium">
                          {performanceFieldLabel(field)}
                        </div>
                        <div class="text-sm sm:text-right">
                          <div class="font-mono">
                            {m['admin.system.performance_limit_summary']({
                              requested: formatNumber(performanceSettings.requestedLimits[field]),
                              effective: formatNumber(performanceSettings.effectiveLimits[field])
                            })}
                          </div>
                          {#if (performanceSettings.caps[field]?.length ?? 0) > 0}
                            <div class="mt-1 text-xs text-warning">
                              {m['admin.system.performance_capped_by']({
                                reasons: (performanceSettings.caps[field] ?? [])
                                  .map(performanceCapReasonLabel)
                                  .join(', ')
                              })}
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              </div>

              <Hint>{m['admin.system.performance_live_apply']()}</Hint>

              <div class="flex justify-end">
                <Button
                  variant="primary"
                  loading={performanceSaving}
                  disabled={selectedProfile === 'custom' && !customLimitsValid}
                  onclick={savePerformanceSettings}
                >
                  {m['admin.system.performance_save']()}
                </Button>
              </div>
            </div>
          {/if}
        </Panel>

        <Panel title={m['admin.system.broker']()} icon="iconify uil--server">
          <div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
            <div class="min-w-0 rounded-lg border border-border bg-surface-100/70 p-4">
              <div class="text-sm text-muted">{m['admin.common.status']()}</div>
              <div class="mt-1 flex items-center gap-2 text-xl font-semibold">
                <span
                  class={[
                    'h-2.5 w-2.5 rounded-full',
                    systemInfo.connection.connected ? 'bg-success' : 'bg-danger'
                  ]}
                ></span>
                {systemInfo.connection.connected
                  ? m['admin.system.connected']()
                  : m['admin.system.disconnected']()}
              </div>
              <div
                class="mt-3 truncate font-mono text-xs text-muted"
                title={systemInfo.connection.serverId}
              >
                {systemInfo.connection.serverId || '-'}
              </div>
            </div>

            <div class="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 md:grid-cols-4">
              <div class="min-w-0">
                <div class="text-sm text-muted">{m['admin.common.version']()}</div>
                <div class="font-mono text-sm">{systemInfo.connection.version || '-'}</div>
              </div>
              <div class="min-w-0">
                <div class="text-sm text-muted">{m['admin.system.rtt']()}</div>
                <div class="font-mono text-sm">{systemInfo.connection.rtt || '-'}</div>
              </div>
              <div class="min-w-0">
                <div class="text-sm text-muted">{m['admin.system.max_payload']()}</div>
                <div class="font-mono text-sm">{formatBytes(systemInfo.connection.maxPayload)}</div>
              </div>
              <div class="min-w-0">
                <div class="text-sm text-muted">{m['admin.system.server_name']()}</div>
                <div class="truncate font-mono text-sm" title={systemInfo.connection.serverName}>
                  {systemInfo.connection.serverName || '-'}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <div>
          <h2 class="mb-3 text-sm font-semibold text-muted uppercase">
            {m['admin.system.jetstream_account']()}
          </h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              value={formatBytes(systemInfo.account.storageUsed)}
              label={m['admin.system.account_storage']()}
              icon="iconify uil--hdd"
              color="primary"
              subtitle={m['admin.system.limit']({
                limit: formatLimit(systemInfo.account.storage, formatBytes)
              })}
            />
            <StatCard
              value={formatBytes(systemInfo.account.memoryUsed)}
              label={m['admin.system.account_memory']()}
              icon="iconify uil--processor"
              color="success"
              subtitle={m['admin.system.limit']({
                limit: formatLimit(systemInfo.account.memory, formatBytes)
              })}
            />
            <StatCard
              value={formatPercent(systemInfo.account.streamsUsed, systemInfo.account.streams)}
              label={m['admin.system.stream_capacity']()}
              icon="iconify uil--exchange"
              color="warning"
              subtitle={m['admin.system.used_of_limit']({
                used: formatNumber(systemInfo.account.streamsUsed),
                limit: formatLimit(systemInfo.account.streams)
              })}
            />
            <StatCard
              value={formatPercent(systemInfo.account.consumersUsed, systemInfo.account.consumers)}
              label={m['admin.system.consumer_capacity']()}
              icon="iconify uil--users-alt"
              color="danger"
              subtitle={m['admin.system.used_of_limit']({
                used: formatNumber(systemInfo.account.consumersUsed),
                limit: formatLimit(systemInfo.account.consumers)
              })}
            />
          </div>
        </div>

        <div>
          <h2 class="mb-3 text-sm font-semibold text-muted uppercase">
            {m['admin.system.stream_activity']()}
          </h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              value={formatNumber(systemInfo.nats.totalMessages)}
              label={m['admin.system.messages_stored']()}
              icon="iconify uil--database"
              color="primary"
              subtitle={m['admin.system.average_message_size']({
                size: formatBytes(averageEventBytes)
              })}
            />
            <StatCard
              value={formatBytes(systemInfo.nats.totalBytes)}
              label={m['admin.system.stream_bytes']()}
              icon="iconify uil--hdd"
              color="success"
              subtitle={m['admin.system.storage_mix']({
                file: formatNumber(fileStreamCount),
                memory: formatNumber(memoryStreamCount)
              })}
            />
            <StatCard
              value={formatNumber(systemInfo.nats.totalConsumerPending)}
              label={m['admin.system.consumer_backlog']()}
              icon="iconify uil--clock"
              color={systemInfo.nats.totalConsumerPending > 0 ? 'warning' : 'success'}
              subtitle={m['admin.system.consumer_backlog_subtitle']({
                count: formatNumber(consumersWithBacklog)
              })}
            />
            <StatCard
              value={formatNumber(systemInfo.nats.totalAckPending)}
              label={m['admin.system.ack_pending']()}
              icon="iconify uil--check-circle"
              color={systemInfo.nats.totalAckPending > 0 ? 'warning' : 'success'}
              subtitle={m['admin.system.redelivered_total']({
                count: formatNumber(totalRedelivered)
              })}
            />
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <Panel title={m['admin.system.stream_summary']()} icon="iconify uil--chart-line">
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div class="text-sm text-muted">{m['admin.system.file_streams']()}</div>
                <div class="font-mono text-lg">{formatNumber(fileStreamCount)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.memory_streams']()}</div>
                <div class="font-mono text-lg">{formatNumber(memoryStreamCount)}</div>
              </div>
              <div class="col-span-2">
                <div class="text-sm text-muted">{m['admin.system.largest_stream']()}</div>
                {#if largestStream}
                  <div class="min-w-0">
                    <div class="truncate font-medium" title={largestStream.name}>
                      {largestStream.name}
                    </div>
                    <div class="font-mono text-sm text-muted">
                      {formatBytes(largestStream.bytes)} / {formatNumber(largestStream.messages)}
                      {m['admin.system.messages_lower']()}
                    </div>
                  </div>
                {:else}
                  <div class="font-mono text-sm text-muted">-</div>
                {/if}
              </div>
            </div>
          </Panel>

          <Panel title={m['admin.system.consumer_summary']()} icon="iconify uil--users-alt">
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div class="text-sm text-muted">{m['admin.system.pull_consumers']()}</div>
                <div class="font-mono text-lg">{formatNumber(pullConsumerCount)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.push_consumers']()}</div>
                <div class="font-mono text-lg">{formatNumber(pushConsumerCount)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.unbound_push_consumers']()}</div>
                <div
                  class={['font-mono text-lg', unboundPushConsumerCount > 0 ? 'text-warning' : '']}
                >
                  {formatNumber(unboundPushConsumerCount)}
                </div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.redelivered']()}</div>
                <div class={['font-mono text-lg', totalRedelivered > 0 ? 'text-warning' : '']}>
                  {formatNumber(totalRedelivered)}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title={m['admin.system.projection_summary']()} icon="iconify uil--layers">
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div class="text-sm text-muted">{m['admin.system.projections']()}</div>
                <div class="font-mono text-lg">{formatNumber(projections.length)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.entries']()}</div>
                <div class="font-mono text-lg">{formatNumber(totalEntries)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.projection_memory']()}</div>
                <div class="font-mono text-lg">{formatBytes(totalEstimatedBytes)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.average_entry_size']()}</div>
                <div class="font-mono text-lg">{formatBytes(averageProjectionEntryBytes)}</div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.projection_failures']()}</div>
                <div class={['font-mono text-lg', failedProjectionCount > 0 ? 'text-danger' : '']}>
                  {formatNumber(failedProjectionCount)}
                </div>
              </div>
              <div>
                <div class="text-sm text-muted">{m['admin.system.projection_lag']()}</div>
                <div class={['font-mono text-lg', laggingCount > 0 ? 'text-warning' : '']}>
                  {formatNumber(laggingCount)}
                </div>
              </div>
            </div>
          </Panel>
        </div>

        <Panel title={m['admin.system.streams']()} icon="iconify uil--exchange" noPadding>
          <DataTable items={streams} columns={6} emptyMessage={m['admin.system.no_streams']()}>
            {#snippet header()}
              <th class="px-4 py-3 font-medium">{m['admin.system.stream']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.storage']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.messages']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.bytes']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.consumers']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.replicas']()}</th>
            {/snippet}
            {#snippet row(stream)}
              <td class="px-4 py-3">
                <div class="font-medium">{stream.name}</div>
                {#if stream.description}
                  <div class="text-xs text-muted">{stream.description}</div>
                {/if}
              </td>
              <td class="px-4 py-3">{stream.storage}</td>
              <td class="px-4 py-3 font-mono text-sm">{formatNumber(stream.messages)}</td>
              <td class="px-4 py-3 font-mono text-sm">{formatBytes(stream.bytes)}</td>
              <td class="px-4 py-3 font-mono text-sm">{formatNumber(stream.consumerCount)}</td>
              <td class="px-4 py-3">
                <div class="font-mono text-sm">{formatNumber(stream.replicas)}</div>
                {#if stream.clusterLeader}
                  <div class="text-xs text-muted">{stream.clusterLeader}</div>
                {/if}
              </td>
            {/snippet}
          </DataTable>
        </Panel>

        <Panel title={m['admin.system.consumers']()} icon="iconify uil--users-alt" noPadding>
          <DataTable items={consumers} columns={7} emptyMessage={m['admin.system.no_consumers']()}>
            {#snippet header()}
              <th class="px-4 py-3 font-medium">{m['admin.system.consumer']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.mode']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.filters']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.pending']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.ack_pending']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.redelivered']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.acked_through']()}</th>
            {/snippet}
            {#snippet row(consumer)}
              <td class="px-4 py-3">
                <div class="font-medium">{consumer.name}</div>
                <div class="font-mono text-xs text-muted">{consumer.stream}</div>
                {#if consumer.durable}
                  <div class="text-xs text-muted">
                    {m['admin.system.durable']({ name: consumer.durable })}
                  </div>
                {/if}
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <Pill tone={consumer.pullBased ? 'primary' : 'muted'}>
                    {consumer.pullBased ? m['admin.system.pull']() : m['admin.system.push']()}
                  </Pill>
                  {#if !consumer.pullBased}
                    <Pill tone={consumer.pushBound ? 'success' : 'danger'}>
                      {consumer.pushBound ? m['admin.system.bound']() : m['admin.system.unbound']()}
                    </Pill>
                  {/if}
                </div>
                <div class="mt-1 text-xs text-muted">{consumer.ackPolicy}</div>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  {#each consumerFilters(consumer) as filter (filter)}
                    <span
                      class="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted"
                    >
                      {filter}
                    </span>
                  {/each}
                </div>
              </td>
              <td class="px-4 py-3">
                <span class={[consumer.pending > 0 ? 'font-semibold text-warning' : '']}>
                  {formatNumber(consumer.pending)}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class={[consumer.ackPending > 0 ? 'font-semibold text-warning' : '']}>
                  {formatNumber(consumer.ackPending)}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-sm">{formatNumber(consumer.redelivered)}</td>
              <td class="px-4 py-3 whitespace-nowrap">
                <div class="font-mono text-sm">stream {consumer.ackFloorStreamSequence}</div>
                <div class="font-mono text-xs text-muted">
                  consumer {consumer.ackFloorConsumerSequence}
                </div>
              </td>
            {/snippet}
          </DataTable>
        </Panel>

        <Panel title={m['admin.system.projections']()} icon="iconify uil--chart-line" noPadding>
          <DataTable
            items={projections}
            columns={7}
            emptyMessage={m['admin.system.no_projections']()}
          >
            {#snippet header()}
              <th class="px-4 py-3 font-medium">{m['admin.system.projection']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.state']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.startup']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.applied']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.lag']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.entries']()}</th>
              <th class="px-4 py-3 font-medium">{m['admin.system.memory']()}</th>
            {/snippet}
            {#snippet row(projection)}
              <td class="px-4 py-3">
                <div class="font-medium">{projection.name}</div>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <Pill
                    tone={projection.failed ? 'danger' : projection.started ? 'success' : 'muted'}
                  >
                    {projection.failed
                      ? m['admin.system.failed']()
                      : projection.started
                        ? m['admin.system.started']()
                        : m['admin.system.stopped']()}
                  </Pill>
                </div>
                {#if projection.failed}
                  <div class="mt-1 max-w-[28rem] font-mono text-xs break-words text-danger">
                    {projection.failure}
                  </div>
                {/if}
              </td>
              <td class="px-4 py-3 font-mono text-sm whitespace-nowrap">
                <span class={[projection.startupDurationSeconds == null ? 'text-muted' : '']}>
                  {formatDurationSeconds(projection.startupDurationSeconds)}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-sm whitespace-nowrap">
                {projection.lastAppliedSequence}
                <span class="text-muted">/ {projection.matchingStreamSequence}</span>
                {#if projection.failed}
                  <div class="text-xs text-danger">
                    {m['admin.system.failed_at']({ sequence: projection.failedSequence })}
                  </div>
                {/if}
              </td>
              <td class="px-4 py-3">
                <span class={[projection.lag > 0 ? 'font-semibold text-warning' : '']}>
                  {formatNumber(projection.lag)}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-sm">{formatNumber(projection.entryCount)}</td>
              <td class="px-4 py-3">
                <div class="font-mono text-sm whitespace-nowrap">
                  {formatBytes(projection.estimatedBytes)}
                </div>
                <div class="text-xs whitespace-nowrap text-muted">
                  {formatBytes(projection.averageEntryBytes)} avg
                </div>
              </td>
            {/snippet}
          </DataTable>
        </Panel>
      {/if}
    </div>
  </div>
</div>
