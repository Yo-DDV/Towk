# ADR-020: Build-Tag Gated Test Endpoints

**Date:** 2026-03-01

## Context

Towk's E2E tests need to perform operations that are intentionally impossible through the normal API: bypassing email verification, simulating OAuth callbacks, and inspecting outgoing emails. The options are:

- **Seed via normal API**: Register users, verify emails, etc. through the public API. Slow, can't bypass email delivery, and couples tests to the full registration flow.
- **Test doubles/mocks**: Replace NATS and other infrastructure with in-memory fakes. Wouldn't test actual JetStream behavior, stream ordering, or KV semantics.
- **Conditional test endpoints**: Compile test-only HTTP endpoints into the binary when built with a specific flag. Not present in production builds.

## Decision

Use Go build tags to conditionally compile test-only HTTP endpoints. When built with `-tags test_endpoints`, the binary includes routes under `/auth/test/*`:

- `GET /auth/test/last-email` — Retrieve the last sent verification email
- `POST /auth/test/verify-email` — Directly verify a user's email
- `POST /auth/test/oauth-callback` — Simulate an OAuth callback

A stub file (`test_endpoints_stub.go`) provides no-op registrations for production builds. E2E tests compile a dedicated test binary via the `build-e2e-server` mise task.

Each E2E test spawns a real Towk process with a unique ephemeral data directory and random port range, providing full isolation between parallel tests.

## Consequences

- **Structurally impossible in production**: The test endpoints don't exist in the compiled binary unless `-tags test_endpoints` is specified. There's no runtime flag to enable them — the code is literally absent. This is stronger than a configuration guard.
- **True end-to-end coverage**: Tests run against a real binary with real embedded NATS, real JetStream streams, and real KV buckets. No mocks, no fakes, no in-memory substitutes.
- **Per-test isolation**: Each test gets its own Towk process with a fresh data directory. No shared state, no cleanup between tests, no inter-test pollution.
- **Parallel test execution**: Random port assignment prevents collisions when multiple test suites run simultaneously in CI.
- **Test binary must be rebuilt**: Changes to the Go backend require rebuilding the E2E test binary before running tests. The mise task handles this, but it's an extra step compared to interpreted test frameworks.
