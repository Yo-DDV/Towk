#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/runtime-image-process.sh"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/towk-runtime-process-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
counter="$tmp/top-count"
scenario=delayed
printf '0\n' > "$counter"

docker() {
  local command="$1"
  shift

  case "$command" in
    inspect)
      if [ "$scenario" = "exited" ]; then
        printf 'exited\n'
      else
        printf 'running\n'
      fi
      ;;
    top)
      local count
      count="$(sed -n '1p' "$counter")"
      count=$((count + 1))
      printf '%s\n' "$count" > "$counter"
      printf 'PID UID GID\n'
      case "$scenario" in
        delayed)
          case "$count" in
            2) printf '42 0 0\n' ;;
            3) printf '42 1000 1000\n' ;;
          esac
          ;;
        wrong)
          printf '42 0 0\n'
          ;;
      esac
      ;;
    logs)
      printf 'synthetic container log\n' >&2
      ;;
    *)
      echo "unexpected docker command in test: $command $*" >&2
      return 1
      ;;
  esac
}

wait_for_runtime_ids synthetic 1000 1000 4 0
test "$(sed -n '1p' "$counter")" -eq 3

scenario=wrong
printf '0\n' > "$counter"
if wait_for_runtime_ids synthetic 1000 1000 3 0 2>"$tmp/wrong.err"; then
  echo "wrong runtime IDs must fail" >&2
  exit 1
fi
grep -Fq 'expected=1000:1000 state=running last_ids=0:0' "$tmp/wrong.err"
grep -Fq 'synthetic container log' "$tmp/wrong.err"

scenario=exited
printf '0\n' > "$counter"
if wait_for_runtime_ids synthetic 1000 1000 3 0 2>"$tmp/exited.err"; then
  echo "stopped container must fail" >&2
  exit 1
fi
grep -Fq 'container stopped before exposing runtime IDs: state=exited' "$tmp/exited.err"
grep -Fq 'synthetic container log' "$tmp/exited.err"
test "$(sed -n '1p' "$counter")" -eq 0

echo "Verified bounded runtime process polling, wrong-ID rejection, and early-exit diagnostics."
