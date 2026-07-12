# ADR-018: SvelteKit SPA Embedded in Go Binary

**Date:** 2026-03-01

## Context

Towk's design goal is a single self-hosted executable. The frontend is a SvelteKit application. The question is how to serve it:

- **Separate static hosting**: Deploy frontend to a CDN or static file server. Simple but breaks the single-binary goal and requires operators to manage two deployments.
- **SSR with Node.js**: Run SvelteKit's Node adapter alongside Go. Requires a second runtime, complicates the binary, adds operational overhead.
- **SPA mode embedded in Go**: Build SvelteKit as a static SPA and embed the output in the Go binary using `//go:embed`.

## Decision

Configure SvelteKit with `adapter-static` (`fallback: '200.html'`, `precompress: true`) and `ssr = false`. The compiled SPA output is embedded into the Go binary with `//go:embed all:.client`. The Go server handles:

- Serving the `200.html` fallback for all unrecognized routes (SPA client-side routing)
- Serving SvelteKit's immutable assets (`/_app/immutable/`) with 1-year cache headers and ETags
- Serving precompressed `.br` and `.gz` variants without runtime compression
- Injecting server-side OpenGraph meta tags into the `200.html` response for asset/space preview URLs

## Consequences

- **True single binary**: `go build` produces one executable containing the entire application — backend, frontend, and embedded NATS server. No external files needed at runtime.
- **No runtime compression cost**: SvelteKit's `precompress: true` generates Brotli and gzip variants at build time. The Go server detects `Accept-Encoding` and serves the pre-compressed file directly.
- **No SSR**: The frontend is fully client-rendered. First paint shows a loading state until JavaScript boots. This is acceptable for an authenticated app where SEO doesn't matter.
- **OpenGraph tags are server-rendered**: Despite being an SPA, the Go server injects `<meta>` tags for link preview URLs (space invites, shared assets) by manipulating the `200.html` before serving. This gives good link previews without SSR.
- **Frontend updates require a full rebuild**: Changing a CSS color means rebuilding the Go binary. In practice, this is automated by CI and acceptable for a self-hosted product.
