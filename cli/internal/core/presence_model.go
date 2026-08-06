package core

import (
	"context"

	"github.com/charmbracelet/log"
	"github.com/nats-io/nats.go/jetstream"
	"golang.org/x/sync/errgroup"
)

// PresenceModel owns public presence state, per-session leases and the
// process-wide watcher hubs that project and fan out state changes.
type PresenceModel struct {
	js            jetstream.JetStream
	memoryCacheKV jetstream.KeyValue
	logger        *log.Logger
	hub           *PresenceHub
	sessionHub    *PresenceSessionHub
}

func NewPresenceModel(js jetstream.JetStream, memoryCacheKV jetstream.KeyValue, logger *log.Logger) *PresenceModel {
	model := &PresenceModel{
		js:            js,
		memoryCacheKV: memoryCacheKV,
		logger:        logger,
	}
	model.hub = NewPresenceHub(memoryCacheKV, logger)
	model.sessionHub = NewPresenceSessionHub(memoryCacheKV, logger, model)
	return model
}

func (s *PresenceModel) Run(ctx context.Context) error {
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error { return s.hub.Run(groupCtx) })
	group.Go(func() error { return s.sessionHub.Run(groupCtx) })
	return group.Wait()
}

func (s *PresenceModel) Subscribe(ctx context.Context) (*PresenceSubscription, error) {
	return s.hub.Subscribe(ctx)
}

func (s *PresenceModel) Unsubscribe(sub *PresenceSubscription) {
	s.hub.Unsubscribe(sub)
}
