package http_server

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"hmans.de/chatto/internal/runtimecap"
)

const (
	defaultConcurrentAssetTransforms = 2
	defaultAdmittedAssetTransforms   = 8
)

var (
	errAssetTransformBusy   = errors.New("asset transform capacity is full")
	errAssetTransformClosed = errors.New("asset transform coordinator is closed")
)

type assetTransformOutput struct {
	data        []byte
	contentType string
}

type assetTransformFailure struct {
	status  int
	message string
	cause   error
}

func (e *assetTransformFailure) Error() string {
	return e.cause.Error()
}

func (e *assetTransformFailure) Unwrap() error {
	return e.cause
}

type assetTransformJob struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	result  *assetTransformOutput
	err     error
}

// assetTransformCoordinator coalesces identical cold transforms and bounds
// distinct admitted work. At most admittedCapacity goroutines exist, including
// jobs waiting for one of workerCapacity execution slots.
type assetTransformCoordinator struct {
	mu        sync.Mutex
	jobs      map[string]*assetTransformJob
	workers   *runtimecap.Limiter
	admission *runtimecap.Limiter
	closed    bool
}

func newAssetTransformCoordinator(workerCapacity, admittedCapacity int) *assetTransformCoordinator {
	return newDynamicAssetTransformCoordinator(func() int { return workerCapacity }, func() int { return admittedCapacity })
}

func newDynamicAssetTransformCoordinator(workerCapacity, admittedCapacity func() int) *assetTransformCoordinator {
	workerLimit := func() int { return max(1, workerCapacity()) }
	admissionLimit := func() int { return max(workerLimit(), admittedCapacity()) }
	return &assetTransformCoordinator{
		jobs:      make(map[string]*assetTransformJob),
		workers:   runtimecap.NewLimiter(workerLimit),
		admission: runtimecap.NewLimiter(admissionLimit),
	}
}

func (c *assetTransformCoordinator) Do(
	ctx context.Context,
	key string,
	work func(context.Context) (*assetTransformOutput, error),
) (*assetTransformOutput, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, errAssetTransformClosed
	}
	if job := c.jobs[key]; job != nil {
		job.waiters++
		c.mu.Unlock()
		return c.wait(ctx, key, job)
	}
	if !c.admission.TryAcquire() {
		c.mu.Unlock()
		return nil, errAssetTransformBusy
	}

	jobCtx, cancel := context.WithCancel(context.Background())
	job := &assetTransformJob{
		done:    make(chan struct{}),
		cancel:  cancel,
		waiters: 1,
	}
	c.jobs[key] = job
	c.mu.Unlock()

	go c.run(jobCtx, key, job, work)
	return c.wait(ctx, key, job)
}

func (c *assetTransformCoordinator) run(
	ctx context.Context,
	key string,
	job *assetTransformJob,
	work func(context.Context) (*assetTransformOutput, error),
) {
	workerAcquired := false
	defer func() {
		if workerAcquired {
			c.workers.Release()
		}
		if recovered := recover(); recovered != nil {
			job.result = nil
			job.err = fmt.Errorf("asset transform panicked: %v", recovered)
		}

		c.mu.Lock()
		if c.jobs[key] == job {
			delete(c.jobs, key)
		}
		close(job.done)
		c.mu.Unlock()
		job.cancel()
		c.admission.Release()
	}()

	if err := c.workers.Acquire(ctx); err == nil {
		workerAcquired = true
		job.result, job.err = work(ctx)
	} else {
		job.err = err
	}
}

func (c *assetTransformCoordinator) wait(ctx context.Context, key string, job *assetTransformJob) (*assetTransformOutput, error) {
	select {
	case <-job.done:
		return job.result, job.err
	case <-ctx.Done():
		c.releaseWaiter(key, job)
		return nil, ctx.Err()
	}
}

func (c *assetTransformCoordinator) releaseWaiter(key string, job *assetTransformJob) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.jobs[key] != job {
		return
	}
	job.waiters--
	if job.waiters == 0 {
		delete(c.jobs, key)
		job.cancel()
	}
}

func (c *assetTransformCoordinator) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	c.closed = true
	for key, job := range c.jobs {
		delete(c.jobs, key)
		job.cancel()
	}
}

func (c *assetTransformCoordinator) waiterCount(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if job := c.jobs[key]; job != nil {
		return job.waiters
	}
	return 0
}

func (c *assetTransformCoordinator) jobCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.jobs)
}
