package connectapi

import (
	"context"
	"strconv"

	"connectrpc.com/connect"
	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	adminv1 "hmans.de/chatto/internal/pb/chatto/admin/v1"
)

type adminDiagnosticsService struct {
	api *API
}

func (s *adminDiagnosticsService) GetPerformanceSettings(ctx context.Context, _ *connect.Request[adminv1.GetPerformanceSettingsRequest]) (*connect.Response[adminv1.GetPerformanceSettingsResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	status, err := s.api.core.GetPerformanceSettings(ctx, caller.UserID)
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&adminv1.GetPerformanceSettingsResponse{Settings: adminPerformanceSettings(status)}), nil
}

func (s *adminDiagnosticsService) UpdatePerformanceSettings(ctx context.Context, req *connect.Request[adminv1.UpdatePerformanceSettingsRequest]) (*connect.Response[adminv1.UpdatePerformanceSettingsResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	profile, err := adminPerformanceProfileToCore(req.Msg.GetProfile())
	if err != nil {
		return nil, err
	}
	if profile == config.PerformanceProfileCustom && req.Msg.GetCustomLimits() == nil {
		return nil, invalidArgument("custom_limits are required for the custom profile")
	}
	if profile != config.PerformanceProfileCustom && req.Msg.GetCustomLimits() != nil {
		return nil, invalidArgument("custom_limits require the custom profile")
	}
	expectedRevision, err := strconv.ParseUint(req.Msg.GetExpectedRevision(), 10, 64)
	if err != nil {
		return nil, invalidArgument("expected_revision must be an unsigned decimal integer")
	}
	status, err := s.api.core.UpdatePerformanceSettings(ctx, caller.UserID, expectedRevision, profile, corePerformanceLimits(req.Msg.GetCustomLimits()))
	if err != nil {
		return nil, connectError(err)
	}
	return connect.NewResponse(&adminv1.UpdatePerformanceSettingsResponse{Settings: adminPerformanceSettings(status)}), nil
}

func adminPerformanceSettings(status core.PerformanceStatus) *adminv1.AdminPerformanceSettings {
	caps := make([]*adminv1.AdminPerformanceLimitCap, 0, len(status.CapReasons))
	for _, field := range []struct {
		name  string
		field adminv1.AdminPerformanceLimitField
	}{
		{"image_transform_workers", adminv1.AdminPerformanceLimitField_ADMIN_PERFORMANCE_LIMIT_FIELD_IMAGE_TRANSFORM_WORKERS},
		{"image_transform_admissions", adminv1.AdminPerformanceLimitField_ADMIN_PERFORMANCE_LIMIT_FIELD_IMAGE_TRANSFORM_ADMISSIONS},
		{"asset_upload_workers", adminv1.AdminPerformanceLimitField_ADMIN_PERFORMANCE_LIMIT_FIELD_ASSET_UPLOAD_WORKERS},
		{"link_preview_workers", adminv1.AdminPerformanceLimitField_ADMIN_PERFORMANCE_LIMIT_FIELD_LINK_PREVIEW_WORKERS},
		{"video_workers", adminv1.AdminPerformanceLimitField_ADMIN_PERFORMANCE_LIMIT_FIELD_VIDEO_WORKERS},
	} {
		reasonNames := status.CapReasons[field.name]
		if len(reasonNames) == 0 {
			continue
		}
		reasons := make([]adminv1.AdminPerformanceCapReason, 0, len(reasonNames))
		for _, reason := range reasonNames {
			reasons = append(reasons, adminPerformanceCapReason(reason))
		}
		caps = append(caps, &adminv1.AdminPerformanceLimitCap{Field: field.field, Reasons: reasons})
	}
	return &adminv1.AdminPerformanceSettings{
		RequestedProfile: adminPerformanceProfile(status.RequestedProfile),
		EffectiveProfile: adminPerformanceProfile(status.EffectiveProfile),
		Source:           adminPerformancePolicySource(status.Source),
		SchemaVersion:    status.SchemaVersion,
		Revision:         strconv.FormatUint(status.Revision, 10),
		RequestedLimits:  adminPerformanceLimits(status.Requested),
		EffectiveLimits:  adminPerformanceLimits(status.Effective),
		OperatorCaps:     adminPerformanceLimits(status.OperatorCaps),
		Envelope: &adminv1.AdminPerformanceEnvelope{
			Cpus:         int32(status.Envelope.CPUs),
			MemoryBytes:  status.Envelope.MemoryBytes,
			CpuSource:    status.Envelope.CPUSource,
			MemorySource: status.Envelope.MemorySource,
		},
		Caps:            caps,
		PolicyError:     status.PolicyError,
		RestartRequired: status.RestartRequired,
	}
}

func adminPerformanceLimits(limits core.PerformanceLimits) *adminv1.AdminPerformanceLimits {
	return &adminv1.AdminPerformanceLimits{
		ImageTransformWorkers:    int32(limits.ImageTransformWorkers),
		ImageTransformAdmissions: int32(limits.ImageTransformAdmissions),
		AssetUploadWorkers:       int32(limits.AssetUploadWorkers),
		LinkPreviewWorkers:       int32(limits.LinkPreviewWorkers),
		VideoWorkers:             int32(limits.VideoWorkers),
	}
}

func corePerformanceLimits(limits *adminv1.AdminPerformanceLimits) core.PerformanceLimits {
	if limits == nil {
		return core.PerformanceLimits{}
	}
	return core.PerformanceLimits{
		ImageTransformWorkers:    int(limits.GetImageTransformWorkers()),
		ImageTransformAdmissions: int(limits.GetImageTransformAdmissions()),
		AssetUploadWorkers:       int(limits.GetAssetUploadWorkers()),
		LinkPreviewWorkers:       int(limits.GetLinkPreviewWorkers()),
		VideoWorkers:             int(limits.GetVideoWorkers()),
	}
}

func adminPerformanceProfile(profile string) adminv1.AdminPerformanceProfile {
	switch profile {
	case config.PerformanceProfileEconomy:
		return adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_ECONOMY
	case config.PerformanceProfileBalanced:
		return adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_BALANCED
	case config.PerformanceProfilePerformance:
		return adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_PERFORMANCE
	case config.PerformanceProfileCustom:
		return adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_CUSTOM
	case config.PerformanceProfileLegacy:
		return adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_LEGACY
	default:
		return adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_UNSPECIFIED
	}
}

func adminPerformanceProfileToCore(profile adminv1.AdminPerformanceProfile) (string, error) {
	switch profile {
	case adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_ECONOMY:
		return config.PerformanceProfileEconomy, nil
	case adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_BALANCED:
		return config.PerformanceProfileBalanced, nil
	case adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_PERFORMANCE:
		return config.PerformanceProfilePerformance, nil
	case adminv1.AdminPerformanceProfile_ADMIN_PERFORMANCE_PROFILE_CUSTOM:
		return config.PerformanceProfileCustom, nil
	default:
		return "", invalidArgument("profile must be economy, balanced, performance, or custom")
	}
}

func adminPerformancePolicySource(source string) adminv1.AdminPerformancePolicySource {
	switch source {
	case "historical":
		return adminv1.AdminPerformancePolicySource_ADMIN_PERFORMANCE_POLICY_SOURCE_HISTORICAL
	case "operator_default":
		return adminv1.AdminPerformancePolicySource_ADMIN_PERFORMANCE_POLICY_SOURCE_OPERATOR_DEFAULT
	case "owner":
		return adminv1.AdminPerformancePolicySource_ADMIN_PERFORMANCE_POLICY_SOURCE_OWNER
	default:
		return adminv1.AdminPerformancePolicySource_ADMIN_PERFORMANCE_POLICY_SOURCE_UNSPECIFIED
	}
}

func adminPerformanceCapReason(reason string) adminv1.AdminPerformanceCapReason {
	switch reason {
	case "operator_cap":
		return adminv1.AdminPerformanceCapReason_ADMIN_PERFORMANCE_CAP_REASON_OPERATOR_CAP
	case "process_cpu":
		return adminv1.AdminPerformanceCapReason_ADMIN_PERFORMANCE_CAP_REASON_PROCESS_CPU
	case "process_memory":
		return adminv1.AdminPerformanceCapReason_ADMIN_PERFORMANCE_CAP_REASON_PROCESS_MEMORY
	default:
		return adminv1.AdminPerformanceCapReason_ADMIN_PERFORMANCE_CAP_REASON_UNSPECIFIED
	}
}

func (s *adminDiagnosticsService) GetSystemInfo(ctx context.Context, _ *connect.Request[adminv1.GetSystemInfoRequest]) (*connect.Response[adminv1.GetSystemInfoResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	diagnostics, err := s.api.core.GetAdminDiagnostics(ctx, caller.UserID)
	if err != nil {
		return nil, connectError(err)
	}

	return connect.NewResponse(&adminv1.GetSystemInfoResponse{
		SystemInfo:  adminSystemInfo(diagnostics),
		Projections: adminProjectionStates(diagnostics.Projections),
	}), nil
}

func adminSystemInfo(diagnostics *core.AdminDiagnostics) *adminv1.AdminSystemInfo {
	return &adminv1.AdminSystemInfo{
		Connection: adminConnectionInfo(diagnostics.Connection),
		Account:    adminAccountInfo(diagnostics.Account),
		Nats:       adminNatsStats(diagnostics.JetStream),
		Stats:      adminServerStats(diagnostics.Stats),
	}
}

func adminProjectionStates(states []core.ProjectionAdminState) []*adminv1.AdminProjectionState {
	out := make([]*adminv1.AdminProjectionState, 0, len(states))
	for _, state := range states {
		out = append(out, adminProjectionState(state))
	}
	return out
}

func adminConnectionInfo(info *core.ConnectionInfo) *adminv1.AdminConnectionInfo {
	if info == nil {
		return &adminv1.AdminConnectionInfo{}
	}
	return &adminv1.AdminConnectionInfo{
		Connected:  info.Connected,
		ServerId:   info.ServerID,
		ServerName: info.ServerName,
		Version:    info.Version,
		MaxPayload: info.MaxPayload,
		Rtt:        info.RTT,
	}
}

func adminAccountInfo(info *core.AccountInfo) *adminv1.AdminAccountInfo {
	if info == nil {
		return &adminv1.AdminAccountInfo{}
	}
	return &adminv1.AdminAccountInfo{
		Memory:        int64(info.Memory),
		MemoryUsed:    int64(info.MemoryUsed),
		Storage:       int64(info.Storage),
		StorageUsed:   int64(info.StorageUsed),
		Streams:       int32(info.Streams),
		StreamsUsed:   int32(info.StreamsUsed),
		Consumers:     int32(info.Consumers),
		ConsumersUsed: int32(info.ConsumersUsed),
	}
}

func adminServerStats(stats *core.ServerStats) *adminv1.AdminServerStats {
	if stats == nil {
		return &adminv1.AdminServerStats{}
	}
	return &adminv1.AdminServerStats{
		UserCount:        int32(stats.UserCount),
		ChannelRoomCount: int32(stats.ChannelRoomCount),
		DmRoomCount:      int32(stats.DMRoomCount),
	}
}

func adminNatsStats(stats *core.JetStreamStats) *adminv1.AdminNatsStats {
	if stats == nil {
		return &adminv1.AdminNatsStats{}
	}

	streams := make([]*adminv1.AdminNatsStreamInfo, 0, len(stats.Streams))
	for _, stream := range stats.Streams {
		streams = append(streams, &adminv1.AdminNatsStreamInfo{
			Name:          stream.Name,
			Description:   stream.Description,
			Subjects:      append([]string(nil), stream.Subjects...),
			Storage:       stream.Storage,
			Messages:      int64(stream.Messages),
			Bytes:         int64(stream.Bytes),
			FirstSequence: strconv.FormatUint(stream.FirstSeq, 10),
			LastSequence:  strconv.FormatUint(stream.LastSeq, 10),
			ConsumerCount: int32(stream.ConsumerCount),
			Replicas:      int32(stream.Replicas),
			ClusterLeader: stream.ClusterLeader,
		})
	}

	consumers := make([]*adminv1.AdminNatsConsumerInfo, 0, len(stats.Consumers))
	for _, consumer := range stats.Consumers {
		consumers = append(consumers, &adminv1.AdminNatsConsumerInfo{
			Stream:                    consumer.Stream,
			Name:                      consumer.Name,
			Durable:                   consumer.Durable,
			FilterSubject:             consumer.FilterSubject,
			FilterSubjects:            append([]string(nil), consumer.FilterSubjects...),
			AckPolicy:                 consumer.AckPolicy,
			PullBased:                 consumer.PullBased,
			PushBound:                 consumer.PushBound,
			Pending:                   int64(consumer.Pending),
			AckPending:                int32(consumer.AckPending),
			Redelivered:               int32(consumer.Redelivered),
			Waiting:                   int32(consumer.Waiting),
			DeliveredConsumerSequence: strconv.FormatUint(consumer.DeliveredConsumerSeq, 10),
			DeliveredStreamSequence:   strconv.FormatUint(consumer.DeliveredStreamSeq, 10),
			AckFloorConsumerSequence:  strconv.FormatUint(consumer.AckFloorConsumerSeq, 10),
			AckFloorStreamSequence:    strconv.FormatUint(consumer.AckFloorStreamSeq, 10),
		})
	}

	return &adminv1.AdminNatsStats{
		TotalMessages:        int64(stats.TotalMessages),
		TotalBytes:           int64(stats.TotalBytes),
		TotalConsumerPending: int64(stats.TotalConsumerPending),
		TotalAckPending:      int32(stats.TotalAckPending),
		Streams:              streams,
		Consumers:            consumers,
	}
}

func adminProjectionState(state core.ProjectionAdminState) *adminv1.AdminProjectionState {
	metrics := make([]*adminv1.AdminProjectionMetric, 0, len(state.Metrics))
	for _, metric := range state.Metrics {
		metrics = append(metrics, &adminv1.AdminProjectionMetric{
			Name:  metric.Name,
			Value: metric.Value,
			Bytes: metric.Bytes,
		})
	}

	var startupDurationSeconds *float64
	if state.StartupComplete {
		startupDurationSeconds = &state.StartupDuration
	}

	return &adminv1.AdminProjectionState{
		Key:                    state.Key,
		Name:                   state.Name,
		Subjects:               append([]string(nil), state.Subjects...),
		Started:                state.Started,
		StartupDurationSeconds: startupDurationSeconds,
		LastAppliedSequence:    strconv.FormatUint(state.LastAppliedSeq, 10),
		MatchingStreamSequence: strconv.FormatUint(state.MatchingStreamSeq, 10),
		StreamLastSequence:     strconv.FormatUint(state.StreamLastSeq, 10),
		Lag:                    int64(state.Lag),
		Failed:                 state.Failed,
		FailedSequence:         strconv.FormatUint(state.FailedSeq, 10),
		Failure:                state.Failure,
		EntryCount:             state.EntryCount,
		EstimatedBytes:         state.EstimatedBytes,
		AverageEntryBytes:      state.AverageEntryBytes,
		Metrics:                metrics,
	}
}
