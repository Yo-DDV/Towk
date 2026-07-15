package connectapi

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	apiv1 "hmans.de/chatto/internal/pb/chatto/api/v1"
	corev1 "hmans.de/chatto/internal/pb/chatto/core/v1"
	"hmans.de/chatto/internal/push"
)

type pushNotificationService struct {
	api *API
}

func (s *pushNotificationService) Subscribe(ctx context.Context, req *connect.Request[apiv1.SubscribePushRequest]) (*connect.Response[apiv1.SubscribePushResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}
	if !s.api.config.Push.IsConfigured() {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("push notifications are not enabled on this instance"))
	}

	userAgent := ""
	if req.Msg.UserAgent != nil {
		userAgent = req.Msg.GetUserAgent()
	}
	clientID := ""
	if req.Msg.ClientId != nil {
		clientID = req.Msg.GetClientId()
	}
	applicationOrigin := ""
	if req.Msg.ApplicationOrigin != nil {
		applicationOrigin = req.Msg.GetApplicationOrigin()
	}
	subscription, err := s.api.core.SavePushSubscriptionWithMetadata(ctx, caller.UserID, req.Msg.GetEndpoint(), req.Msg.GetP256Dh(), req.Msg.GetAuth(), userAgent, req.Msg.GetLocale(), clientID, applicationOrigin)
	if err != nil {
		return nil, connectError(err)
	}
	s.deleteNonCanonicalPushSubscriptions(ctx, caller.UserID, subscription)

	return connect.NewResponse(&apiv1.SubscribePushResponse{Subscribed: true}), nil
}

func (s *pushNotificationService) Unsubscribe(ctx context.Context, req *connect.Request[apiv1.UnsubscribePushRequest]) (*connect.Response[apiv1.UnsubscribePushResponse], error) {
	caller, err := requireCaller(ctx)
	if err != nil {
		return nil, err
	}

	if err := s.api.core.DeletePushSubscription(ctx, caller.UserID, req.Msg.GetEndpoint()); err != nil {
		return nil, connectError(err)
	}

	return connect.NewResponse(&apiv1.UnsubscribePushResponse{Unsubscribed: true}), nil
}

func (s *pushNotificationService) deleteNonCanonicalPushSubscriptions(ctx context.Context, userID string, current *corev1.PushSubscription) {
	canonicalOrigin, ok := push.CanonicalApplicationOrigin(s.api.config.Webserver.URL)
	if !ok {
		return
	}
	currentOrigin, ok := push.NormalizeApplicationOrigin(current.GetApplicationOrigin())
	if !ok || currentOrigin != canonicalOrigin {
		return
	}
	subscriptions, err := s.api.core.GetUserPushSubscriptions(ctx, userID)
	if err != nil {
		return
	}
	for _, subscription := range subscriptions {
		if subscription.GetEndpoint() == current.GetEndpoint() {
			continue
		}
		applicationOrigin := strings.TrimSpace(subscription.GetApplicationOrigin())
		if applicationOrigin == "" {
			continue
		}
		origin, ok := push.NormalizeApplicationOrigin(applicationOrigin)
		if ok && origin == canonicalOrigin {
			continue
		}
		_ = s.api.core.DeletePushSubscription(ctx, userID, subscription.GetEndpoint())
	}
}
