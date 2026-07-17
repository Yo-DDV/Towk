import { authHeaders, createTowkClient } from './connect.js';
import { AdminDiagnosticsService } from '@towk/api-types/admin/v1/diagnostics_connect';
import {
  AdminPerformanceSettings as AdminPerformanceSettingsMessage,
  AdminPerformanceCapReason,
  AdminPerformanceLimitField,
  AdminPerformancePolicySource,
  AdminPerformanceProfile
} from '@towk/api-types/admin/v1/diagnostics_pb';

export type AdminDiagnosticsAPIConfig = {
  baseUrl: string;
  bearerToken: string | null;
  onAuthenticationRequired?: (serverId: string) => void;
};

export type AdminSystemInfo = {
  connection: AdminConnectionInfo;
  account: AdminAccountInfo;
  nats: AdminNatsStats;
  stats: AdminServerStats;
  projections: AdminProjectionState[];
};

export type AdminConnectionInfo = {
  connected: boolean;
  serverId: string;
  serverName: string;
  version: string;
  maxPayload: number;
  rtt: string;
};

export type AdminAccountInfo = {
  memory: number;
  memoryUsed: number;
  storage: number;
  storageUsed: number;
  streams: number;
  streamsUsed: number;
  consumers: number;
  consumersUsed: number;
};

export type AdminServerStats = {
  userCount: number;
  channelRoomCount: number;
  dmRoomCount: number;
};

export type AdminNatsStats = {
  totalMessages: number;
  totalBytes: number;
  totalConsumerPending: number;
  totalAckPending: number;
  streams: AdminNatsStreamInfo[];
  consumers: AdminNatsConsumerInfo[];
};

export type AdminNatsStreamInfo = {
  name: string;
  description: string;
  subjects: string[];
  storage: string;
  messages: number;
  bytes: number;
  firstSequence: string;
  lastSequence: string;
  consumerCount: number;
  replicas: number;
  clusterLeader: string;
};

export type AdminNatsConsumerInfo = {
  stream: string;
  name: string;
  durable: string;
  filterSubject: string;
  filterSubjects: string[];
  ackPolicy: string;
  pullBased: boolean;
  pushBound: boolean;
  pending: number;
  ackPending: number;
  redelivered: number;
  waiting: number;
  deliveredConsumerSequence: string;
  deliveredStreamSequence: string;
  ackFloorConsumerSequence: string;
  ackFloorStreamSequence: string;
};

export type AdminProjectionState = {
  key: string;
  name: string;
  subjects: string[];
  started: boolean;
  startupDurationSeconds: number | null;
  lastAppliedSequence: string;
  matchingStreamSequence: string;
  streamLastSequence: string;
  lag: number;
  failed: boolean;
  failedSequence: string;
  failure: string;
  entryCount: number;
  estimatedBytes: number;
  averageEntryBytes: number;
  metrics: AdminProjectionMetric[];
};

export type AdminProjectionMetric = {
  name: string;
  value: number;
  bytes: number;
};

export type PerformanceProfile = 'economy' | 'balanced' | 'performance' | 'custom' | 'legacy';
export type MutablePerformanceProfile = Exclude<PerformanceProfile, 'legacy'>;
export type PerformancePolicySource = 'historical' | 'operator_default' | 'owner' | 'unknown';
export type PerformanceLimitField =
  | 'image_transform_workers'
  | 'image_transform_admissions'
  | 'asset_upload_workers'
  | 'link_preview_workers'
  | 'video_workers';
export type PerformanceCapReason = 'operator_cap' | 'process_cpu' | 'process_memory' | 'unknown';

export type PerformanceLimits = Record<PerformanceLimitField, number>;

export type AdminPerformanceSettings = {
  requestedProfile: PerformanceProfile;
  effectiveProfile: PerformanceProfile;
  source: PerformancePolicySource;
  schemaVersion: number;
  revision: string;
  requestedLimits: PerformanceLimits;
  effectiveLimits: PerformanceLimits;
  operatorCaps: PerformanceLimits;
  envelope: {
    cpus: number;
    memoryBytes: number;
    cpuSource: string;
    memorySource: string;
  };
  caps: Partial<Record<PerformanceLimitField, PerformanceCapReason[]>>;
  policyError: string;
  restartRequired: boolean;
};

function adminDiagnosticsClient(config: AdminDiagnosticsAPIConfig) {
  const client = createTowkClient(AdminDiagnosticsService, config);
  const headers = authHeaders(config);
  return { client, headers };
}

export async function getAdminSystemInfo(
  config: AdminDiagnosticsAPIConfig
): Promise<AdminSystemInfo> {
  const { client, headers } = adminDiagnosticsClient(config);
  const response = await client.getSystemInfo({}, { headers });
  const systemInfo = response.systemInfo;

  return {
    connection: {
      connected: systemInfo?.connection?.connected ?? false,
      serverId: systemInfo?.connection?.serverId ?? '',
      serverName: systemInfo?.connection?.serverName ?? '',
      version: systemInfo?.connection?.version ?? '',
      maxPayload: Number(systemInfo?.connection?.maxPayload ?? 0),
      rtt: systemInfo?.connection?.rtt ?? ''
    },
    account: {
      memory: Number(systemInfo?.account?.memory ?? 0),
      memoryUsed: Number(systemInfo?.account?.memoryUsed ?? 0),
      storage: Number(systemInfo?.account?.storage ?? 0),
      storageUsed: Number(systemInfo?.account?.storageUsed ?? 0),
      streams: systemInfo?.account?.streams ?? 0,
      streamsUsed: systemInfo?.account?.streamsUsed ?? 0,
      consumers: systemInfo?.account?.consumers ?? 0,
      consumersUsed: systemInfo?.account?.consumersUsed ?? 0
    },
    nats: {
      totalMessages: Number(systemInfo?.nats?.totalMessages ?? 0),
      totalBytes: Number(systemInfo?.nats?.totalBytes ?? 0),
      totalConsumerPending: Number(systemInfo?.nats?.totalConsumerPending ?? 0),
      totalAckPending: systemInfo?.nats?.totalAckPending ?? 0,
      streams: (systemInfo?.nats?.streams ?? []).map((stream) => ({
        name: stream.name,
        description: stream.description,
        subjects: [...stream.subjects],
        storage: stream.storage,
        messages: Number(stream.messages),
        bytes: Number(stream.bytes),
        firstSequence: stream.firstSequence,
        lastSequence: stream.lastSequence,
        consumerCount: stream.consumerCount,
        replicas: stream.replicas,
        clusterLeader: stream.clusterLeader
      })),
      consumers: (systemInfo?.nats?.consumers ?? []).map((consumer) => ({
        stream: consumer.stream,
        name: consumer.name,
        durable: consumer.durable,
        filterSubject: consumer.filterSubject,
        filterSubjects: [...consumer.filterSubjects],
        ackPolicy: consumer.ackPolicy,
        pullBased: consumer.pullBased,
        pushBound: consumer.pushBound,
        pending: Number(consumer.pending),
        ackPending: consumer.ackPending,
        redelivered: consumer.redelivered,
        waiting: consumer.waiting,
        deliveredConsumerSequence: consumer.deliveredConsumerSequence,
        deliveredStreamSequence: consumer.deliveredStreamSequence,
        ackFloorConsumerSequence: consumer.ackFloorConsumerSequence,
        ackFloorStreamSequence: consumer.ackFloorStreamSequence
      }))
    },
    stats: {
      userCount: systemInfo?.stats?.userCount ?? 0,
      channelRoomCount: systemInfo?.stats?.channelRoomCount ?? 0,
      dmRoomCount: systemInfo?.stats?.dmRoomCount ?? 0
    },
    projections: response.projections.map((projection) => ({
      key: projection.key,
      name: projection.name,
      subjects: [...projection.subjects],
      started: projection.started,
      startupDurationSeconds: projection.startupDurationSeconds ?? null,
      lastAppliedSequence: projection.lastAppliedSequence,
      matchingStreamSequence: projection.matchingStreamSequence,
      streamLastSequence: projection.streamLastSequence,
      lag: Number(projection.lag),
      failed: projection.failed,
      failedSequence: projection.failedSequence,
      failure: projection.failure,
      entryCount: Number(projection.entryCount),
      estimatedBytes: Number(projection.estimatedBytes),
      averageEntryBytes: Number(projection.averageEntryBytes),
      metrics: projection.metrics.map((metric) => ({
        name: metric.name,
        value: Number(metric.value),
        bytes: Number(metric.bytes)
      }))
    }))
  };
}

export async function getAdminPerformanceSettings(
  config: AdminDiagnosticsAPIConfig
): Promise<AdminPerformanceSettings> {
  const { client, headers } = adminDiagnosticsClient(config);
  const response = await client.getPerformanceSettings({}, { headers });
  return mapPerformanceSettings(response.settings);
}

export async function updateAdminPerformanceSettings(
  config: AdminDiagnosticsAPIConfig,
  input: {
    profile: MutablePerformanceProfile;
    expectedRevision: string;
    customLimits?: PerformanceLimits;
  }
): Promise<AdminPerformanceSettings> {
  const { client, headers } = adminDiagnosticsClient(config);
  const response = await client.updatePerformanceSettings(
    {
      profile: performanceProfileToProto(input.profile),
      expectedRevision: input.expectedRevision,
      customLimits:
        input.profile === 'custom' && input.customLimits
          ? {
              imageTransformWorkers: input.customLimits.image_transform_workers,
              imageTransformAdmissions: input.customLimits.image_transform_admissions,
              assetUploadWorkers: input.customLimits.asset_upload_workers,
              linkPreviewWorkers: input.customLimits.link_preview_workers,
              videoWorkers: input.customLimits.video_workers
            }
          : undefined
    },
    { headers }
  );
  return mapPerformanceSettings(response.settings);
}

function mapPerformanceSettings(
  settings: AdminPerformanceSettingsMessage | undefined
): AdminPerformanceSettings {
  if (!settings) throw new Error('Performance settings are unavailable');
  const limits = (value: typeof settings.requestedLimits): PerformanceLimits => ({
    image_transform_workers: value?.imageTransformWorkers ?? 0,
    image_transform_admissions: value?.imageTransformAdmissions ?? 0,
    asset_upload_workers: value?.assetUploadWorkers ?? 0,
    link_preview_workers: value?.linkPreviewWorkers ?? 0,
    video_workers: value?.videoWorkers ?? 0
  });
  const caps: AdminPerformanceSettings['caps'] = {};
  for (const cap of settings.caps) {
    const field = performanceFieldFromProto(cap.field);
    if (!field) continue;
    caps[field] = cap.reasons.map(performanceCapReasonFromProto);
  }
  return {
    requestedProfile: performanceProfileFromProto(settings.requestedProfile),
    effectiveProfile: performanceProfileFromProto(settings.effectiveProfile),
    source: performanceSourceFromProto(settings.source),
    schemaVersion: settings.schemaVersion,
    revision: settings.revision || '0',
    requestedLimits: limits(settings.requestedLimits),
    effectiveLimits: limits(settings.effectiveLimits),
    operatorCaps: limits(settings.operatorCaps),
    envelope: {
      cpus: settings.envelope?.cpus ?? 0,
      memoryBytes: Number(settings.envelope?.memoryBytes ?? 0),
      cpuSource: settings.envelope?.cpuSource ?? '',
      memorySource: settings.envelope?.memorySource ?? ''
    },
    caps,
    policyError: settings.policyError,
    restartRequired: settings.restartRequired
  };
}

function performanceProfileToProto(profile: MutablePerformanceProfile): AdminPerformanceProfile {
  return {
    economy: AdminPerformanceProfile.ECONOMY,
    balanced: AdminPerformanceProfile.BALANCED,
    performance: AdminPerformanceProfile.PERFORMANCE,
    custom: AdminPerformanceProfile.CUSTOM
  }[profile];
}

function performanceProfileFromProto(profile: AdminPerformanceProfile): PerformanceProfile {
  switch (profile) {
    case AdminPerformanceProfile.ECONOMY:
      return 'economy';
    case AdminPerformanceProfile.BALANCED:
      return 'balanced';
    case AdminPerformanceProfile.PERFORMANCE:
      return 'performance';
    case AdminPerformanceProfile.CUSTOM:
      return 'custom';
    case AdminPerformanceProfile.LEGACY:
    default:
      return 'legacy';
  }
}

function performanceSourceFromProto(source: AdminPerformancePolicySource): PerformancePolicySource {
  switch (source) {
    case AdminPerformancePolicySource.HISTORICAL:
      return 'historical';
    case AdminPerformancePolicySource.OPERATOR_DEFAULT:
      return 'operator_default';
    case AdminPerformancePolicySource.OWNER:
      return 'owner';
    default:
      return 'unknown';
  }
}

function performanceFieldFromProto(
  field: AdminPerformanceLimitField
): PerformanceLimitField | null {
  switch (field) {
    case AdminPerformanceLimitField.IMAGE_TRANSFORM_WORKERS:
      return 'image_transform_workers';
    case AdminPerformanceLimitField.IMAGE_TRANSFORM_ADMISSIONS:
      return 'image_transform_admissions';
    case AdminPerformanceLimitField.ASSET_UPLOAD_WORKERS:
      return 'asset_upload_workers';
    case AdminPerformanceLimitField.LINK_PREVIEW_WORKERS:
      return 'link_preview_workers';
    case AdminPerformanceLimitField.VIDEO_WORKERS:
      return 'video_workers';
    default:
      return null;
  }
}

function performanceCapReasonFromProto(reason: AdminPerformanceCapReason): PerformanceCapReason {
  switch (reason) {
    case AdminPerformanceCapReason.OPERATOR_CAP:
      return 'operator_cap';
    case AdminPerformanceCapReason.PROCESS_CPU:
      return 'process_cpu';
    case AdminPerformanceCapReason.PROCESS_MEMORY:
      return 'process_memory';
    default:
      return 'unknown';
  }
}
