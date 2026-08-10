package connectapi

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	"hmans.de/chatto/internal/config"
	"hmans.de/chatto/internal/core"
	"hmans.de/chatto/internal/nativepushinstance"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
)

const (
	nativeNotificationHPKESuite      = "DHKEM_P256_HKDF_SHA256/HKDF_SHA256/AES_256_GCM"
	nativeNotificationMaxSignalBytes = 4096
	nativeNotificationMaxSignalAge   = 15 * 60
)

func (a *API) GetNativeNotificationConfig(
	ctx context.Context,
	_ *connect.Request[apiv1.GetNativeNotificationConfigRequest],
) (*connect.Response[apiv1.GetNativeNotificationConfigResponse], error) {
	if _, err := requireCaller(ctx); err != nil {
		return nil, err
	}
	nativeConfig, err := config.LoadNativeNotificationsConfig()
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("native notifications are misconfigured"))
	}
	response := &apiv1.GetNativeNotificationConfigResponse{
		Enabled:                       nativeConfig.Enabled,
		AndroidManagedFcmEnabled:      nativeConfig.Enabled && nativeConfig.AndroidManagedFCM,
		LinuxResidentWebsocketEnabled: nativeConfig.Enabled && nativeConfig.LinuxResidentWebSocket,
		ManagedFcmRelayUrl:            nativeConfig.ManagedFCMRelayURL,
		SignalEncryptionSuite:         nativeNotificationHPKESuite,
		MaxSignalBytes:                nativeNotificationMaxSignalBytes,
		MaxSignalAgeSeconds:           nativeNotificationMaxSignalAge,
	}
	if response.AndroidManagedFcmEnabled {
		response.ManagedFcmEnrollmentState = "required"
		if state, stateErr := nativepushinstance.LoadEnrollmentState(nativeConfig.EnrollmentStateFile); stateErr == nil && state.RelayURL == nativeConfig.ManagedFCMRelayURL && state.BaseURL == strings.TrimSuffix(a.config.Webserver.URL, "/") {
			response.ManagedFcmEnrollmentState = "active"
			response.ManagedFcmInstanceId = state.InstanceID
		}
	}
	return connect.NewResponse(response), nil
}

func (a *API) EnrollManagedFCM(ctx context.Context, _ *connect.Request[apiv1.EnrollManagedFCMRequest]) (*connect.Response[apiv1.EnrollManagedFCMResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	allowed, permissionErr := a.core.HasServerPermission(ctx, caller.UserID, core.PermServerManage)
	if permissionErr != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("permission check failed"))
	}
	if !allowed {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("server management permission is required"))
	}
	nativeConfig, err := config.LoadNativeNotificationsConfig()
	if err != nil || !nativeConfig.Enabled || !nativeConfig.AndroidManagedFCM {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("managed FCM notifications are not enabled"))
	}
	identity, err := nativepushinstance.LoadOrCreateIdentity(nativeConfig.IdentityFile)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("native notification identity is unavailable"))
	}
	relay, err := nativepushinstance.NewRelayClient(nativeConfig.ManagedFCMRelayURL, nativeConfig.EnrollmentStateFile, identity, nil)
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("managed FCM relay is misconfigured"))
	}
	state, err := relay.Enroll(ctx, a.config.Webserver.URL)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("managed FCM relay enrollment failed"))
	}
	return connect.NewResponse(&apiv1.EnrollManagedFCMResponse{EnrollmentState: "active", InstanceId: state.InstanceID}), nil
}

func (a *API) RegisterNativeEndpoint(
	ctx context.Context,
	req *connect.Request[apiv1.RegisterNativeEndpointRequest],
) (*connect.Response[apiv1.RegisterNativeEndpointResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	platform, err := nativePlatformFromProto(req.Msg.GetPlatform())
	if err != nil {
		return nil, err
	}
	transport, err := nativeTransportFromProto(req.Msg.GetTransport())
	if err != nil {
		return nil, err
	}
	record, err := a.core.RegisterNativeEndpoint(ctx, caller.UserID, core.NativeEndpointRegistration{
		InstallationID:    req.Msg.GetInstallationId(),
		Platform:          platform,
		Transport:         transport,
		AppID:             req.Msg.GetAppId(),
		FCMInstallationID: req.Msg.GetFcmInstallationId(),
		ClientPublicKey:   append([]byte(nil), req.Msg.GetClientPublicKey()...),
		Locale:            req.Msg.GetLocale(),
		Preferences:       nativePreferencesPatchFromProto(req.Msg.GetPreferences()),
	})
	if err != nil {
		return nil, nativeNotificationConnectError(err)
	}
	return connect.NewResponse(&apiv1.RegisterNativeEndpointResponse{Endpoint: nativeEndpointToProto(record)}), nil
}

func (a *API) RotateNativeEndpoint(
	ctx context.Context,
	req *connect.Request[apiv1.RotateNativeEndpointRequest],
) (*connect.Response[apiv1.RotateNativeEndpointResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	record, err := a.core.RotateNativeEndpoint(ctx, caller.UserID, req.Msg.GetEndpointId(), req.Msg.GetExpectedGeneration(), core.NativeEndpointRegistration{
		FCMInstallationID: req.Msg.GetFcmInstallationId(),
		ClientPublicKey:   append([]byte(nil), req.Msg.GetClientPublicKey()...),
		Locale:            req.Msg.GetLocale(),
	})
	if err != nil {
		return nil, nativeNotificationConnectError(err)
	}
	return connect.NewResponse(&apiv1.RotateNativeEndpointResponse{Endpoint: nativeEndpointToProto(record)}), nil
}

func (a *API) UnregisterNativeEndpoint(
	ctx context.Context,
	req *connect.Request[apiv1.UnregisterNativeEndpointRequest],
) (*connect.Response[apiv1.UnregisterNativeEndpointResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	unregistered, err := a.core.UnregisterNativeEndpoint(ctx, caller.UserID, req.Msg.GetEndpointId(), req.Msg.GetExpectedGeneration())
	if err != nil {
		return nil, nativeNotificationConnectError(err)
	}
	return connect.NewResponse(&apiv1.UnregisterNativeEndpointResponse{Unregistered: unregistered}), nil
}

func (a *API) ListNativeEndpoints(
	ctx context.Context,
	_ *connect.Request[apiv1.ListNativeEndpointsRequest],
) (*connect.Response[apiv1.ListNativeEndpointsResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	records, err := a.core.ListNativeEndpoints(ctx, caller.UserID, true)
	if err != nil {
		return nil, nativeNotificationConnectError(err)
	}
	endpoints := make([]*apiv1.NativeEndpoint, 0, len(records))
	for _, record := range records {
		endpoints = append(endpoints, nativeEndpointToProto(record))
	}
	return connect.NewResponse(&apiv1.ListNativeEndpointsResponse{Endpoints: endpoints}), nil
}

func (a *API) UpdateNativeEndpointPreferences(
	ctx context.Context,
	req *connect.Request[apiv1.UpdateNativeEndpointPreferencesRequest],
) (*connect.Response[apiv1.UpdateNativeEndpointPreferencesResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	if req.Msg.Preferences == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("preferences are required"))
	}
	record, err := a.core.UpdateNativeEndpointPreferences(
		ctx,
		caller.UserID,
		req.Msg.GetEndpointId(),
		req.Msg.GetExpectedGeneration(),
		nativePreferencesPatchFromProto(req.Msg.Preferences),
	)
	if err != nil {
		return nil, nativeNotificationConnectError(err)
	}
	return connect.NewResponse(&apiv1.UpdateNativeEndpointPreferencesResponse{Endpoint: nativeEndpointToProto(record)}), nil
}

func nativePlatformFromProto(platform apiv1.NativeNotificationPlatform) (core.NativeNotificationPlatform, error) {
	switch platform {
	case apiv1.NativeNotificationPlatform_NATIVE_NOTIFICATION_PLATFORM_ANDROID:
		return core.NativeNotificationPlatformAndroid, nil
	case apiv1.NativeNotificationPlatform_NATIVE_NOTIFICATION_PLATFORM_LINUX:
		return core.NativeNotificationPlatformLinux, nil
	default:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("native notification platform is unsupported"))
	}
}

func nativeTransportFromProto(transport apiv1.NativeNotificationTransport) (core.NativeNotificationTransport, error) {
	switch transport {
	case apiv1.NativeNotificationTransport_NATIVE_NOTIFICATION_TRANSPORT_ANDROID_MANAGED_FCM:
		return core.NativeNotificationTransportManagedFCM, nil
	case apiv1.NativeNotificationTransport_NATIVE_NOTIFICATION_TRANSPORT_LINUX_RESIDENT_WEBSOCKET:
		return core.NativeNotificationTransportLinuxResidentWebSocket, nil
	default:
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("native notification transport is unsupported"))
	}
}

func nativePreferencesPatchFromProto(patch *apiv1.NativeEndpointPreferencesPatch) core.NativeEndpointPreferencesPatch {
	if patch == nil {
		return core.NativeEndpointPreferencesPatch{}
	}
	return core.NativeEndpointPreferencesPatch{
		Enabled:  patch.Enabled,
		Messages: patch.Messages,
		Calls:    patch.Calls,
	}
}

func nativeEndpointToProto(record *core.NativeEndpointRecord) *apiv1.NativeEndpoint {
	if record == nil {
		return nil
	}
	endpoint := &apiv1.NativeEndpoint{
		EndpointId:         record.EndpointID,
		InstallationId:     record.InstallationID,
		Platform:           nativePlatformToProto(record.Platform),
		Transport:          nativeTransportToProto(record.Transport),
		AppId:              record.AppID,
		Locale:             record.Locale,
		CreatedAt:          timestamppb.New(record.CreatedAt),
		LastSeenAt:         timestamppb.New(record.LastSeenAt),
		State:              nativeStateToProto(record.State),
		LastDeliveryStatus: nativeDeliveryStatusToProto(record.LastDeliveryStatus),
		Preferences: &apiv1.NativeEndpointPreferences{
			Enabled:  record.Preferences.Enabled,
			Messages: record.Preferences.Messages,
			Calls:    record.Preferences.Calls,
		},
		Generation: record.Generation,
	}
	if record.DisabledAt != nil {
		endpoint.DisabledAt = timestamppb.New(*record.DisabledAt)
	}
	if strings.TrimSpace(record.FCMInstallationID) != "" {
		endpoint.FcmInstallationId = record.FCMInstallationID
	}
	if len(record.ClientPublicKey) != 0 {
		value := append([]byte(nil), record.ClientPublicKey...)
		endpoint.ClientPublicKey = value
	}
	return endpoint
}

func nativePlatformToProto(platform core.NativeNotificationPlatform) apiv1.NativeNotificationPlatform {
	switch platform {
	case core.NativeNotificationPlatformAndroid:
		return apiv1.NativeNotificationPlatform_NATIVE_NOTIFICATION_PLATFORM_ANDROID
	case core.NativeNotificationPlatformLinux:
		return apiv1.NativeNotificationPlatform_NATIVE_NOTIFICATION_PLATFORM_LINUX
	case core.NativeNotificationPlatformWindows:
		return apiv1.NativeNotificationPlatform_NATIVE_NOTIFICATION_PLATFORM_WINDOWS
	default:
		return apiv1.NativeNotificationPlatform_NATIVE_NOTIFICATION_PLATFORM_UNSPECIFIED
	}
}

func nativeTransportToProto(transport core.NativeNotificationTransport) apiv1.NativeNotificationTransport {
	switch transport {
	case core.NativeNotificationTransportManagedFCM:
		return apiv1.NativeNotificationTransport_NATIVE_NOTIFICATION_TRANSPORT_ANDROID_MANAGED_FCM
	case core.NativeNotificationTransportLinuxResidentWebSocket:
		return apiv1.NativeNotificationTransport_NATIVE_NOTIFICATION_TRANSPORT_LINUX_RESIDENT_WEBSOCKET
	default:
		return apiv1.NativeNotificationTransport_NATIVE_NOTIFICATION_TRANSPORT_UNSPECIFIED
	}
}

func nativeStateToProto(state core.NativeEndpointState) apiv1.NativeEndpointState {
	switch state {
	case core.NativeEndpointStateActive:
		return apiv1.NativeEndpointState_NATIVE_ENDPOINT_STATE_ACTIVE
	case core.NativeEndpointStateDisabled:
		return apiv1.NativeEndpointState_NATIVE_ENDPOINT_STATE_DISABLED
	case core.NativeEndpointStatePermanentlyInvalid:
		return apiv1.NativeEndpointState_NATIVE_ENDPOINT_STATE_PERMANENTLY_INVALID
	default:
		return apiv1.NativeEndpointState_NATIVE_ENDPOINT_STATE_UNSPECIFIED
	}
}

func nativeDeliveryStatusToProto(status core.NativeDeliveryStatus) apiv1.NativeDeliveryStatus {
	switch status {
	case core.NativeDeliveryStatusNeverAttempted:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_NEVER_ATTEMPTED
	case core.NativeDeliveryStatusPending:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_PENDING
	case core.NativeDeliveryStatusDeliveredToTransport:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_DELIVERED_TO_TRANSPORT
	case core.NativeDeliveryStatusRetryableFailure:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_RETRYABLE_FAILURE
	case core.NativeDeliveryStatusExpired:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_EXPIRED
	case core.NativeDeliveryStatusPermanentlyInvalid:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_PERMANENTLY_INVALID
	default:
		return apiv1.NativeDeliveryStatus_NATIVE_DELIVERY_STATUS_UNSPECIFIED
	}
}

func nativeNotificationConnectError(err error) error {
	switch {
	case errors.Is(err, core.ErrNativeEndpointConflict):
		return connect.NewError(connect.CodeAborted, errors.New("native endpoint changed; refresh and retry"))
	case errors.Is(err, core.ErrNativeEndpointUnsupported):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("native endpoint transport is unsupported"))
	case errors.Is(err, core.ErrNativeOutboxSaturated):
		return connect.NewError(connect.CodeResourceExhausted, errors.New("native notification queue is full"))
	default:
		return connectError(err)
	}
}
