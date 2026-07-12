// Package service defines the interface for Towk runnable services.
//
// All long-running components (NATS micro services, HTTP server, etc.) implement
// this interface, allowing them to be orchestrated uniformly by the start command.
// This design enables future extraction of services into separate processes.
package service

import "context"

// Service represents a runnable Towk service.
//
// Services are started by calling Run, which blocks until the context is
// cancelled or an error occurs. Services should perform graceful shutdown
// when the context is cancelled.
type Service interface {
	// Run starts the service and blocks until ctx is cancelled or an error occurs.
	// When ctx is cancelled, the service should gracefully shut down and return nil.
	// Any error during startup or runtime should be returned immediately.
	Run(ctx context.Context) error
}
