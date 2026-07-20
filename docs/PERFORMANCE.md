# Performance qualification

Towk performance changes are accepted from reproducible evidence, not from a
single fast run. This protocol defines the public corpus, machine preflight,
network profiles, result format, and rejection rules used for media work.

The harness is deliberately strict. A failed prerequisite produces an
`UNVERIFIED` report and a non-zero exit status. `--allow-unverified` is useful
for diagnosis, but it does not turn an invalid environment into a valid one.

## What this protocol measures

The current media suite isolates:

- image transformations for HD JPEG, large JPEG, alpha PNG, and animated GIF;
- NATS derivative-cache reads;
- resumable 512 KiB upload chunks;
- 1 MiB and 25 MiB upload materialization;
- media request, cache, transform, Range, and upload metrics overhead;
- full-stack NATS or S3 delivery with cold and warm cache states;
- direct application traffic separately from Caddy/TLS traffic.

It does not infer capacity from CPU count alone. Storage, CPU generation,
architecture, memory pressure, cgroup limits, network shape, and the load
generator are part of every result.

## Safety and data handling

- Use only the deterministic synthetic corpus. Never copy user media, private
  messages, production logs, credentials, or private URLs into a report.
- Run network shaping only inside an isolated test network. Never attach
  `netem` to a host's default, management, or production interface.
- The preflight reads Linux and cgroup state. It does not change cgroups, run
  `tc`, restart services, or enable pprof.
- Local paths, work-volume identity, and cgroup paths are represented by
  SHA-256 fingerprints. Raw qdisc snapshots are hashed and are not embedded in
  the JSON report.
- Keep raw test output private until it has passed the repository's public
  surface and leak checks.

## Deterministic corpus

Generate the standard corpus from a clean revision:

```sh
TOWK_MEDIA_CORPUS_PROFILE=standard \
TOWK_MEDIA_CORPUS_DIR=.context/perf/media-corpus \
mise run perf-media-corpus
```

The generator writes atomically and records the size, content type, dimensions,
frame count, validity class, and SHA-256 digest of every fixture. Generate it
twice into separate empty directories and compare the manifests before a
qualification campaign. A digest difference blocks the campaign.

The available profiles are:

| Profile         | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| `smoke`         | Fast correctness checks with the smallest valid payload set |
| `standard`      | Normal local and full-stack qualification                   |
| `qualification` | Includes 100 MiB and 250 MiB deterministic payloads         |

## Required machine preflight

A canonical campaign requires all of the following:

- a clean, full Git object ID;
- Linux with cgroup v2;
- an explicit CPU quota and `memory.max` matching the declared envelope;
- at least 20% free space on the work volume;
- a fingerprint of the exact filesystem used for benchmark temporary files;
- complete cgroup CPU, memory, PID, and I/O fingerprints, including the
  process CPU affinity that constrains the benchmark;
- readable cgroup-scoped PSI evidence for CPU, memory, and I/O; host-wide PSI
  remains diagnostic only and cannot qualify a constrained benchmark;
- memory and I/O `some avg10` at or below 0.1% and `full avg10` at 0% before
  the campaign;
- positive thermal headroom or throttle counters;
- the active clock source and CPU governors recorded;
- the explicit `local` profile for network-free microbenchmarks, or a measured
  network shape matching one of the delivery profiles below;
- a separate or explicitly reserved load generator for full-stack campaigns
  and every 12, 18, or 24 CPU campaign.

Create one temporary-work directory on the volume being qualified, then use it
for both the preflight and every Go benchmark process. This prevents Go's
system temporary directory from silently moving storage work onto another
filesystem.


```sh
export TOWK_MEDIA_BENCH_TMPDIR="$(pwd)/.context/perf/tmp"
mkdir -p "$TOWK_MEDIA_BENCH_TMPDIR"
```


Example for a network-free microbenchmark in a 2 CPU, 4 GiB cgroup:

```sh
mise run perf-media-preflight -- \
  --work-dir "$TOWK_MEDIA_BENCH_TMPDIR" \
  --network local \
  --expected-arch amd64 \
  --expected-cpus 2 \
  --expected-memory-bytes 4294967296
```

The report is written atomically under `.context/perf/` by default. That
directory is local working state and is not a public result directory.

When Towk runs in a container, run the preflight on the Linux host and pass
the container's current host PID with `--target-pid`. The collector then reads
the target process's cgroup and CPU affinity while Git provenance and the work
volume remain tied to the clean host checkout. The report stores only hashed
cgroup identity and emits `TARGET_PID` in its reproducible command; it never
stores the numeric PID. A process exit or PID reuse during collection rejects
the preflight instead of mixing two resource envelopes.

```sh
mise run perf-media-preflight -- \
  --target-pid "$TOWK_HOST_PID" \
  --work-dir "$TOWK_MEDIA_BENCH_TMPDIR" \
  --network local \
  --expected-arch amd64 \
  --expected-cpus 2 \
  --expected-memory-bytes 4294967296
```

## Network profiles

| Profile    |       Useful rate |          RTT | Loss |    Directional delay |
| ---------- | ----------------: | -----------: | ---: | -------------------: |
| `local`    |               n/a |          n/a |  n/a |                  n/a |
| `lan`      | at least 1 Gbit/s | at most 2 ms |   0% |                 none |
| `normal`   |         20 Mbit/s |        50 ms |   0% | 25 ms each direction |
| `degraded` |          4 Mbit/s |       150 ms |   1% | 75 ms each direction |

`local` means that the measured operation has no network path at all. It is
valid for the Go transform, cache, upload, and materialization benchmarks only.
The delivery driver rejects it: HTTP, NATS/S3 delivery, direct, and Caddy/TLS
campaigns must use `lan`, `normal`, or `degraded` with measured evidence.

For `normal` and `degraded`, prove the received path at receiver ingress and
shape both directions. This matters for realistic TCP behavior. The degraded
loss model also requires a non-zero deterministic `netem` seed.

Capture qdisc state from both isolated endpoints after applying the profile:

```sh
tc -j qdisc show dev "$SENDER_TEST_INTERFACE" > sender-qdisc.json
tc -j qdisc show dev "$RECEIVER_TEST_INTERFACE" > receiver-qdisc.json
```

Then pass the snapshots and measured useful rate, RTT, and loss to preflight:

```sh
mise run perf-media-preflight -- \
  --network degraded \
  --measured-rate-mbps 4 \
  --measured-rtt-ms 150 \
  --measured-loss-percent 1 \
  --netem-seed 260717 \
  --shaped-both-directions \
  --receiver-ingress \
  --sender-qdisc-snapshot sender-qdisc.json \
  --receiver-qdisc-snapshot receiver-qdisc.json \
  --expected-arch amd64 \
  --expected-cpus 2 \
  --expected-memory-bytes 4294967296 \
  --full-stack \
  --separate-generator-proven
```

The validator accepts a useful-rate deviation of at most 5%, an RTT deviation
of at most 10%, and an absolute loss deviation of at most 0.2 percentage point.
Those are Towk campaign consistency gates, not universal network guarantees.

## Microbenchmarks

Run each Go benchmark at least ten times. Keep raw output for `benchstat`; do
not draw a conclusion from one iteration or from a percentage without a
confidence interval.

Keep the same CPU quota and process affinity for the before and after runs.
The preflight records both the cgroup cpuset and the process affinity, includes
them in the resource fingerprint, and reduces `effective_cpus` to the narrowest
quota or CPU set. Pinning distinct physical cores can remove scheduler migration
noise on a shared host, but it must be identical across compared campaigns.

```sh
CHATTO_BENCH_COUNT=10 mise run bench-media
```

The task calibrates image transforms for one second, reads the warm cache 250
times per sample, bounds event-backed uploads to 25 operations, and
materializes each payload 50 times. These different defaults are intentional:
transforms need time calibration, while an unbounded time-calibrated upload
benchmark can retain an unrepresentative event history and exceed the smallest
supported 4 GiB qualification envelope. `TOWK_MEDIA_TRANSFORM_BENCHTIME`,
`TOWK_MEDIA_CACHE_BENCHTIME`, `TOWK_MEDIA_UPLOAD_BENCHTIME`, and
`TOWK_MEDIA_MATERIALIZE_BENCHTIME` are diagnostic overrides, not values to
change between the before and after campaign.

Compare the complete before and after files with `benchstat`. A statistically
significant non-target regression above 5% blocks the change. A statistically
insignificant result is reported as inconclusive, not as an improvement.

## Full-stack campaigns

Prepare a private workload file from the synthetic corpus uploaded to a
disposable test instance. The request IDs describe corpus operations and must
not contain user, room, asset, host, or deployment identifiers. URLs may be
short-lived signed URLs, but the workload file must stay under `.context/` and
must never be published.

```json
{
  "conditions": {
    "revision": "FULL_GIT_OBJECT_ID",
    "backend": "nats",
    "cache_state": "warm",
    "network": "lan",
    "path": "direct",
    "cgroup_fingerprint": "SHA256",
    "corpus_sha256": "SHA256"
  },
  "concurrency": 8,
  "rounds": 50,
  "request_timeout_millis": 30000,
  "requests": [
    {
      "id": "standard-original",
      "url": "https://media-bench.invalid/signed-synthetic-asset",
      "expected_status": 200,
      "expected_bytes": 1048576,
      "expected_sha256": "SHA256",
      "expected_content_type": "application/octet-stream"
    },
    {
      "id": "standard-range-0-65535",
      "url": "https://media-bench.invalid/signed-synthetic-asset",
      "range": "bytes=0-65535",
      "expected_status": 206,
      "expected_bytes": 65536,
      "expected_sha256": "SHA256",
      "expected_content_type": "application/octet-stream"
    }
  ]
}
```

Replace every placeholder with the exact full revision and lowercase digest.
The driver computes `workload_sha256` from the stable request IDs and expected
semantics; endpoint hosts and rotating signature queries are deliberately not
part of that digest. Direct and Caddy/TLS campaigns can therefore prove that
they used the same workload without publishing either endpoint.

Run one campaign and keep its redacted result:

```sh
mise run perf-media-delivery -- \
  --input .context/perf/delivery-workload.json \
  --output .context/perf/delivery-run-1.json
```

When bearer authentication is required, provide it through a private
permission-restricted file with `--bearer-file`; never place the credential in
an argument or workload JSON. On Unix systems, the driver rejects bearer files
that grant any group or other permission. A campaign is limited to one origin
so the credential cannot be forwarded to another host. Redirects are not
followed.

The driver streams and hashes each body, disables transparent compression, and
checks status, byte count, digest, MIME type, and `Content-Range` for successful
partial responses. It also supports safe invalid-Range cases that expect 416.
The input is limited to 64 request definitions, 100,000 scheduled requests,
128 workers, 512 MiB per response, and a 120-second request timeout. Result
reasons are bounded and never contain URLs, tokens, response bodies, or local
paths.

Run three independent campaigns for every matrix cell:

- backend: `nats` and `s3`;
- cache: `cold`, `warm`, and the applicable full-cache fault scenario;
- network: `lan`, `normal`, and `degraded`;
- path: `direct` and `caddy_tls`.

Each run must use the same full revision, corpus digest, workload digest,
cgroup fingerprint, backend, cache state, network profile, and path. Record
request-level samples and compute quantiles within each run. Do not calculate a
p95 from three already aggregated p95 values.

Each verified delivery result contains a random `run_id` and a `sample` object
accepted directly by the stability validator. Validate three independent
result files without rewriting them:

```sh
mise run perf-media-validate -- \
  --kind delivery-stability \
  --input .context/perf/delivery-run-1.json \
  --input .context/perf/delivery-run-2.json \
  --input .context/perf/delivery-run-3.json
```

Repeated paths, repeated campaign IDs, malformed campaign IDs, and results that
are not already `VERIFIED` are rejected. Copying one result to three different
paths therefore cannot satisfy the independence gate. The three samples must
still have identical qualification conditions and stay within the 10%
throughput and p95 stability gate.

The structured stability input has this shape:

```json
{
  "maximum_deviation_percent": 10,
  "samples": [
    {
      "conditions": {
        "revision": "FULL_GIT_OBJECT_ID",
        "backend": "nats",
        "cache_state": "warm",
        "network": "normal",
        "path": "caddy_tls",
        "cgroup_fingerprint": "SHA256",
        "corpus_sha256": "SHA256",
        "workload_sha256": "SHA256"
      },
      "throughput_per_second": 0,
      "p95_millis": 0
    }
  ]
}
```

Provide at least three positive samples, replace the placeholders with full
lowercase hexadecimal digests, then validate the file:

```sh
mise run perf-media-validate -- --kind stability --input campaign.json
```

The maximum deviation from the median must stay within 10% for both throughput
and p95. A condition mismatch, missing digest, unknown enum, non-positive
measurement, oversized input, or unstable result is rejected.

## Metrics overhead

Media metrics are exposed only when `[metrics].enabled` is true. When disabled,
the media handlers and upload API do not populate media collectors. The labels
are fixed enums and size classes; request, user, room, asset, filename, URL, and
cache-key identifiers are forbidden.

Image transforms are synchronous today: the transform job metric reports the
real active count and an explicit zero `pending` state. It does not invent a
queue or rejection count that the current request path does not have. Admission
control and capacity behavior belong to a separately reviewed change.

Compare matched metrics-off and metrics-on campaigns. Both sets need at least
three samples and identical qualification conditions:

```json
{
  "maximum_percent": 2,
  "metrics_off": [{ "conditions": {}, "cpu_seconds": 0, "p95_millis": 0 }],
  "metrics_on": [{ "conditions": {}, "cpu_seconds": 0, "p95_millis": 0 }]
}
```

Use the complete `conditions` object described above and validate with:

```sh
mise run perf-media-validate -- --kind monitoring --input monitoring.json
```

Median CPU overhead and median p95 overhead must each remain at or below 2%.
The cardinality test independently caps the fully materialized media metric
surface at 592 series.

The metrics listener remains internal. pprof stays inaccessible unless
`[metrics].pprof` is explicitly enabled for a bounded diagnostic session.

## Result classification

Use exactly these meanings:

- `VERIFIED`: every prerequisite and campaign gate passed on the recorded head;
- `UNVERIFIED`: required hardware, network, cgroup, storage, device, or
  generator evidence is missing;
- `UNSTABLE`: repeated runs exceed the 10% consistency gate;
- `REGRESSION`: the candidate crosses a correctness, security, resource, or
  latency budget relative to a valid baseline.

ARM64 remains `UNVERIFIED` until it is measured on ARM64 hardware. Cross-builds
prove build compatibility only. Likewise, 12, 18, and 24 CPU results require a
separate or proven reserved generator; they are never extrapolated from smaller
machines.

## Sources

- [Linux cgroup v2 administration](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- [Linux pressure stall information](https://docs.kernel.org/accounting/psi.html)
- [`tc-netem(8)`](https://man7.org/linux/man-pages/man8/tc-netem.8.html)
- [Go `net/http` client](https://pkg.go.dev/net/http#Client)
- [HTTP Range requests and `Content-Range`](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
- [Go `benchstat`](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat)
- [Go container-aware `GOMAXPROCS`](https://go.dev/blog/container-aware-gomaxprocs)
- [Docker Compose service resource fields](https://docs.docker.com/reference/compose-file/services/)
