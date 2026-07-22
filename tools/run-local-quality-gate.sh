#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Towk project contributors
# SPDX-License-Identifier: AGPL-3.0-or-later

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

cpu_count="${TOWK_LOCAL_WORKERS:-$(getconf _NPROCESSORS_ONLN)}"
if ! [[ "$cpu_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "TOWK_LOCAL_WORKERS must be a positive integer" >&2
  exit 2
fi
lane_workers=$((cpu_count / 3))
if ((lane_workers < 2)); then
  lane_workers=2
fi
browser_workers=$((cpu_count / 4))
if ((browser_workers < 1)); then
  browser_workers=1
elif ((browser_workers > 4)); then
  browser_workers=4
fi
browser_batch_timeout_seconds="${TOWK_BROWSER_BATCH_TIMEOUT_SECONDS:-90}"
if ! [[ "$browser_batch_timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  echo "TOWK_BROWSER_BATCH_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
fi

echo "Preparing the local quality gate for ${cpu_count} logical CPUs"
mise run setup
mise run codegen-proto

generated_paths=(
  cli/internal/pb
  packages/api-types/src
  apps/docs-website/src/generated/connectrpc-api
  apps/docs-website/src/content/docs/reference/connectrpc-api
)
if ! git diff --exit-code -- "${generated_paths[@]}"; then
  echo "Generated protobuf outputs are stale; commit the regenerated files." >&2
  exit 1
fi
mise run build-api-types

# ESLint traverses the repository tree. Run it before Playwright creates and
# removes per-test server data so filesystem churn cannot produce false ENOENT
# failures. The CPU-heavy test suites still run concurrently below.
pnpm --dir apps/frontend check
pnpm --dir apps/frontend lint
mise run build-e2e-server

pids=()
names=()

start_lane() {
  local name="$1"
  shift
  echo "Starting ${name}"
  ("$@") &
  pids+=("$!")
  names+=("$name")
}

stop_lanes() {
  if ((${#pids[@]} > 0)); then
    kill "${pids[@]}" 2>/dev/null || true
  fi
}
trap stop_lanes INT TERM

start_lane "repository guards" bash -c '
  set -Eeuo pipefail
  mise run public-surface-check
  mise run license-check
  mise run verify-docker
'
start_lane "backend tests" bash -c "
  set -Eeuo pipefail
  cd cli
  GOMAXPROCS=${lane_workers} go test -trimpath -p ${lane_workers} -tags test_endpoints ./...
"
start_lane "frontend server tests" bash -c "
  set -Eeuo pipefail
  cd apps/frontend
  pnpm vitest --run --project server --maxWorkers=${lane_workers}
"

failed=0
for index in "${!pids[@]}"; do
  if wait "${pids[$index]}"; then
    echo "Passed: ${names[$index]}"
  else
    echo "Failed: ${names[$index]}" >&2
    failed=1
  fi
done

if ((failed != 0)); then
  exit 1
fi

# Vitest Browser Mode and the end-to-end suite both own Chromium processes.
# Keep them sequential so resource contention cannot turn media-heavy tests
# into false timeouts. Small isolated batches bound the shared iframe runner's
# lifetime and keep media or navigation fixtures from invalidating later files.
echo "Starting frontend browser tests"
(
  cd apps/frontend

  run_browser_batch() {
    echo "Starting frontend browser batch (${#browser_test_batch[@]} files)"
    if timeout --kill-after=10s "${browser_batch_timeout_seconds}s" \
      pnpm vitest --run --project client "${browser_test_batch[@]}" --maxWorkers=1 --no-file-parallelism; then
      browser_test_batch=()
      return
    else
      local batch_status=$?
    fi

    if ((batch_status != 124)); then
      return "$batch_status"
    fi

    echo "Browser batch exceeded ${browser_batch_timeout_seconds}s; retrying each file in isolation"
    local test_file
    for test_file in "${browser_test_batch[@]}"; do
      timeout --kill-after=10s 90s \
        pnpm vitest --run --project client "$test_file" --maxWorkers=1 --no-file-parallelism
    done
    browser_test_batch=()
  }

  browser_test_batch=()
  while IFS= read -r -d '' test_file; do
    browser_test_batch+=("${test_file}")
    if ((${#browser_test_batch[@]} == 4)); then
      run_browser_batch
    fi
  done < <(
    find src -type f \( \
      -name '*.svelte.test.js' -o -name '*.svelte.test.ts' -o \
      -name '*.svelte.spec.js' -o -name '*.svelte.spec.ts' \
    \) -print0 | sort -z
  )
  if ((${#browser_test_batch[@]} > 0)); then
    run_browser_batch
  fi
)

echo "Starting browser end-to-end tests"
(
  cd apps/frontend
  pnpm exec playwright test --workers="${browser_workers}"
)

echo "Local quality gate passed"
