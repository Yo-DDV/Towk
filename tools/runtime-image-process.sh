#!/usr/bin/env bash
set -euo pipefail

wait_for_runtime_ids() {
  local container_name="$1"
  local expected_uid="$2"
  local expected_gid="$3"
  local attempts="${4:-40}"
  local interval="${5:-0.25}"
  local state=""
  local ids=""

  for _ in $(seq 1 "$attempts"); do
    state="$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || true)"
    case "$state" in
      running)
        ids="$(docker top "$container_name" -eo pid,uid,gid 2>/dev/null | awk 'NR == 2 {print $2 ":" $3}' || true)"
        if [ "$ids" = "${expected_uid}:${expected_gid}" ]; then
          return 0
        fi
        ;;
      exited | dead)
        echo "container stopped before exposing runtime IDs: state=$state" >&2
        docker logs "$container_name" >&2 || true
        return 1
        ;;
    esac
    sleep "$interval"
  done

  echo "container did not expose expected runtime IDs: expected=${expected_uid}:${expected_gid} state=${state:-unknown} last_ids=${ids:-none}" >&2
  docker top "$container_name" -eo pid,uid,gid >&2 || true
  docker logs "$container_name" >&2 || true
  return 1
}
