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
- resumable 1 MiB upload chunks;
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

The process-local transform coordinator bounds distinct work. The transform
job metric reports jobs holding an execution slot as `active` and admitted jobs
waiting for a slot as `pending`. Requests coalesced onto the same derivative do
not create additional jobs. Requests rejected because the admission bound is
full appear through the bounded media-request outcome metric; there is no
asset-key or waiter-count label.

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

## Capacity and resilience qualification

The runtime profile names are concurrency policies, not user-count or latency
guarantees. A public capacity statement requires one structured report tied to
the exact full revision and accepted by the repository validator:

```sh
mise run perf-media-validate -- \
  --kind capacity \
  --input .context/perf/capacity-report.json
```

The JSON top level contains `revision`, `runs`, and `scale_points`. Unknown
fields, trailing JSON, files above 10 MiB, missing evidence, and reused run IDs
are rejected. Every run has a random 32-hex-character `run_id`, the exact report
revision, the declared profile/backend/cache/network/path/phase, a measured
resource envelope, the requested and effective performance limits, an explicit
non-idle load vector, request and error counts, memory evidence, CPU-use and
CPU-throttling evidence, and lifecycle counters.
Do not put endpoints, access tickets, credentials, user data, room IDs, host
paths, or deployment identifiers in this report.

Common run objects use these exact fields:

| Field group | Required fields |
| ----------- | --------------- |
| Identity and cell | `run_id`, `revision`, `profile`, `backend`, `cache_state`, `network`, `path`, `phase`, `duration_seconds`, `preflight_status` |
| Envelope | `logical_cpus`, `memory_limit_bytes`, `host_memory_bytes`, `architecture`, `cpu_model`, `cgroup_fingerprint`, `thermal_proven` |
| Applied policy | `requested_limits`, `effective_limits` with image-transform workers/admissions, asset-upload workers, link-preview workers, and media-transcode workers (`video_workers` in the stable schema) |
| Traffic | `load`, `requests`, `unexpected_server_errors` |
| Resources | `working_set_p95_bytes`, `working_set_peak_bytes`, `host_memory_peak_bytes`, `cpu_usage_seconds`, `cpu_throttled_seconds` |
| Lifecycle | `crash_count`, `panic_count`, `oom_kill_count`, `residual_goroutines`, `residual_temp_files` |

`load` records `idle_connections`, `active_connections`,
`messages_per_second`, `concurrent_uploads`, `upload_mbps`,
`cold_transforms_per_second`, `warm_reads_per_second`, `audio_publishers`,
`audio_subscribers`, `video_publishers`, `video_subscribers`, `egress_mbps`,
`corpus_gib`, `read_mib_per_second`, `write_mib_per_second`, and
`storage_p95_millis`. Individual lanes may be zero, but the vector as a whole
must be finite, non-negative, and non-idle.

Phase-specific evidence uses:

| Phase | Additional required evidence |
| ----- | ---------------------------- |
| `overload` | `admission_bounded`, `admission_subsystem`, `admission_rejections`, `admission_limit`, `peak_admitted` |
| `recovery` | `preceding_overload_run_id`, `recovery_seconds`, `baseline_throughput_per_second`, `recovered_throughput_per_second`, `baseline_p95_millis`, `recovered_p95_millis` |
| `soak` | Balanced profile, two-hour `duration_seconds`, common resource and lifecycle evidence |

Each `scale_points` entry contains `cpus`, `memory_limit_bytes`,
`throughput_per_second`, `separate_generator`, and optional bounded
`bottleneck` evidence.

### Nominal envelopes

| Profile | Qualification envelope | Minimum nominal observation |
| ------- | ---------------------- | --------------------------- |
| `economy` | 1 logical CPU, 2 GiB process memory | 30 minutes |
| `balanced` | 2 logical CPUs, 4 GiB process memory | 30 minutes |
| `performance` | 8 logical CPUs, 16 GiB process memory | 30 minutes |
| `custom` | Explicit measured CPU/memory envelope | 30 minutes |

The standard rows are controlled comparison envelopes, not minimum deployment
sizes and not recommendations to reserve the whole host for Towk. A Custom row
must record a valid bounded requested policy and the effective policy observed
after operator and process limits; effective values may not exceed requested
values. Standard rows must record their exact preset values. Each nominal
report must provide pairwise coverage across all of these factors:

- profile: `economy`, `balanced`, `performance`, `custom`;
- backend: `nats`, `s3`;
- cache state: `cold`, `warm`, `full`;
- shaped network: `normal`, `degraded`;
- application path: `direct`, `caddy_tls`.

The independent HTTP delivery campaign still tests `lan` in addition to the
two shaped profiles. The capacity matrix excludes `lan` because its purpose is
to compare constrained envelopes under repeatable network pressure.

Every accepted run must satisfy all of these budgets:

- preflight status is `VERIFIED`, including cgroup-scoped pressure and thermal
  evidence;
- unexpected server errors stay strictly below 0.1% of requests;
- process working-set p95 stays at or below 70% of its memory limit;
- process working-set peak stays at or below 80% of its memory limit and is not
  lower than its p95;
- host memory peak stays at or below 85% of host memory;
- CPU throttled time stays at or below 5% of measured CPU-use time;
- no crash, panic, OOM kill, leaked goroutine, or residual temporary file is
  observed.

### Scaling curve

The report includes measured 1, 2, 4, and 8 CPU points with exactly 2 GiB of
process memory per CPU. Throughput must increase monotonically. Each doubling
targets at least 1.5 times the previous throughput and at least 60% parallel
efficiency relative to the 1 CPU point. A result below either target can remain
accepted only when it carries bounded measured bottleneck evidence; the
validator publishes that evidence as a limitation rather than hiding it.

Any reported point at 12 CPUs or more requires a separate load generator.
Custom 12, 18, or 24 CPU capacity is measured on that hardware and is never
extrapolated from the 8 CPU curve.

### Overload, recovery, and soak

Each profile, including Custom, needs a linked overload/recovery pair:

1. Apply at least ten minutes of real overload. Record the saturated subsystem
   (`image_transform`, `asset_upload`, `link_preview`, or `video`). Admission
   must stay bounded, reach that subsystem's effective limit, and produce
   expected admission rejections instead of unbounded queue growth.
2. Remove the overload and observe recovery for at least one minute. Recovery
   must complete within 60 seconds, restore at least 90% of baseline
   throughput, and keep recovered p95 at or below 110% of baseline p95.
3. Run an additional Balanced soak for at least two hours under the declared
   non-idle load.

The recovery row carries `preceding_overload_run_id`; the validator requires it
to identify an overload row with the same profile, resource envelope, requested
and effective limits, backend, cache state, network, and application path. This
prevents an unrelated healthy sample from being presented as recovery evidence.

The report is `VERIFIED` only when the complete capacity, scaling, overload,
recovery, and soak contract passes. `--allow-unverified` prints diagnostic
reasons but does not create qualification evidence. Unit-test fixtures that
exercise the validator are not benchmark results and must never be published
as measured capacity.

### Current publication status

The repository intentionally publishes no universal user-count or media
latency promise for Economy, Balanced, Performance, ARM64, or large Custom
hosts until accepted reports from the stated envelopes exist. Missing thermal
telemetry, a shared load generator, an unstable repeated campaign, or an
unmeasured device/architecture remains `UNVERIFIED`; it is not filled by an
estimate. This explicit absence is safer than presenting profile presets as
capacity measurements.

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
