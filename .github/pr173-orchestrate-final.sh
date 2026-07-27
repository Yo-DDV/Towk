#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY="${GITHUB_REPOSITORY:-Yo-DDV/Towk}"
readonly TARGET_BRANCH="feat/read-receipts"
readonly PR_NUMBER="173"
readonly DESIGN_BASE="b9f61f1b28608784c1e1ed1e2232131e681a12b3"
readonly FEATURE_SOURCE="f07456ce30c48fd35d63fcc9d3480b5792f40cfa"

source_head="$(git rev-parse HEAD)"
git config user.name 'Yo-DDV'
git config user.email '116607353+Yo-DDV@users.noreply.github.com'
git fetch --no-tags origin main "${TARGET_BRANCH}"
current_main="$(git rev-parse origin/main)"
test "$(git rev-parse "origin/${TARGET_BRANCH}")" = "${source_head}"
git cat-file -e "${DESIGN_BASE}^{commit}"
git cat-file -e "${FEATURE_SOURCE}^{commit}"
git merge-base --is-ancestor "${FEATURE_SOURCE}" "${source_head}"

for path in \
  .github/pr173-reconstruct.part00 \
  .github/pr173-reconstruct.part01 \
  .github/pr173-reconstruct.part02.00 \
  .github/pr173-reconstruct.part02.01 \
  .github/pr173-reconstruct.part02.02 \
  .github/pr173-reconstruct.part02.03 \
  .github/pr173-reconstruct.part02.04 \
  .github/pr173-reconstruct.part02.05 \
  .github/pr173-reconstruct.part03 \
  .github/pr173-reconstruct.part04 \
  .github/pr173-terminal.sh.gz.b64
do
  test -s "${path}"
done

cat .github/pr173-reconstruct.part00 \
    .github/pr173-reconstruct.part01 \
    .github/pr173-reconstruct.part02.00 \
    .github/pr173-reconstruct.part02.01 \
    .github/pr173-reconstruct.part02.02 \
    .github/pr173-reconstruct.part02.03 \
    .github/pr173-reconstruct.part02.04 \
    .github/pr173-reconstruct.part02.05 \
    .github/pr173-reconstruct.part03 \
    .github/pr173-reconstruct.part04 \
    > "${RUNNER_TEMP}/pr173-reconstruct.py.gz.b64"

base64 -d .github/pr173-terminal.sh.gz.b64 | gzip -d > "${RUNNER_TEMP}/pr173-terminal.sh"
chmod +x "${RUNNER_TEMP}/pr173-terminal.sh"

python3 - "${RUNNER_TEMP}/pr173-terminal.sh" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text(encoding='utf-8')
source = source.replace(
    'base64 -d .github/pr173-reconstruct.py.gz.b64',
    'base64 -d "${RUNNER_TEMP}/pr173-reconstruct.py.gz.b64"',
)

needle = 'python3 "${RUNNER_TEMP}/pr173-reconstruct.py"\n'
inserted = '''python3 "${RUNNER_TEMP}/pr173-reconstruct.py"
python3 - <<'PYFIX'
from pathlib import Path
import re

declaration_pattern = re.compile(r'(readReceiptsEnabled\??:\s*boolean;),')
for name in (
    'apps/frontend/src/lib/api-client/account.ts',
    'apps/frontend/src/lib/api-client/viewer.ts',
    'apps/frontend/src/lib/eventBus.svelte.ts',
):
    file_path = Path(name)
    text = file_path.read_text(encoding='utf-8')
    corrected, count = declaration_pattern.subn(lambda match: match.group(1), text)
    if count < 1:
        raise SystemExit(f'{name}: malformed merged declaration was not found')
    if declaration_pattern.search(corrected):
        raise SystemExit(f'{name}: malformed merged declaration remains')
    file_path.write_text(corrected, encoding='utf-8')

def replace_message(path_name: str, message_name: str, replacement: str) -> None:
    file_path = Path(path_name)
    text = file_path.read_text(encoding='utf-8')
    start = text.index(f'message {message_name} {{')
    depth = 0
    end = None
    for index in range(start, len(text)):
        char = text[index]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise SystemExit(f'{path_name}: unterminated message {message_name}')
    file_path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')

replace_message(
    'proto/chatto/core/v1/live_events.proto',
    'PublicReadReceiptAdvancedEvent',
    '''message PublicReadReceiptAdvancedEvent {
  reserved 3, 4, 5, 6;
  reserved "user_id", "event_id", "event_sequence", "read_at";

  string room_id = 1;
  optional string thread_root_event_id = 2;
}''',
)
replace_message(
    'proto/chatto/realtime/v1/realtime.proto',
    'RealtimeReadReceiptAdvancedEvent',
    '''message RealtimeReadReceiptAdvancedEvent {
  reserved 3, 4, 5, 6;
  reserved "user_id", "event_id", "event_sequence", "read_at";

  // Room containing the affected timeline.
  string room_id = 1;
  // Thread root when the invalidation belongs to a thread timeline.
  optional string thread_root_event_id = 2;
}''',
)
PYFIX
'''
if source.count(needle) != 1:
    raise SystemExit(f'expected one reconstruction command, got {source.count(needle)}')
source = source.replace(needle, inserted, 1)

old_contract = """              for forbidden in ('user_id =', 'event_id =', 'event_sequence =', 'read_at ='):
                  assert forbidden not in event
"""
new_contract = """              for forbidden in ('user_id', 'event_id', 'event_sequence', 'read_at'):
                  assert f' {forbidden} =' not in event
"""
if source.count(old_contract) == 1:
    source = source.replace(old_contract, new_contract, 1)

old_commit = 'git commit-tree "${candidate_tree}" -p "${source_head}"'
new_commit = 'git commit-tree "${candidate_tree}" -p "${source_head}" -p "${PR173_EXPECTED_MAIN}"'
if source.count(old_commit) != 1:
    raise SystemExit(f'expected one commit-tree command, got {source.count(old_commit)}')
source = source.replace(old_commit, new_commit, 1)

path.write_text(source, encoding='utf-8')
PY

export PR173_DESIGN_BASE="${DESIGN_BASE}"
export PR173_FEATURE_SOURCE="${FEATURE_SOURCE}"
export PR173_EXPECTED_MAIN="${current_main}"
export TARGET_BRANCH
bash -x "${RUNNER_TEMP}/pr173-terminal.sh"

git fetch --no-tags origin main "${TARGET_BRANCH}"
candidate="$(git rev-parse "origin/${TARGET_BRANCH}")"
test "${candidate}" != "${source_head}"
test "$(git rev-parse origin/main)" = "${current_main}"
git merge-base --is-ancestor "${current_main}" "${candidate}"

deletions="$(git diff --diff-filter=D --name-only "${current_main}..${candidate}")"
test -z "${deletions}"

temporary_paths="$(git diff --name-only "${current_main}..${candidate}" -- .github | grep -E 'pr173|read-receipts-(final|main|terminal)|quick-gate\.yml' || true)"
test -z "${temporary_paths}"

git log -1 --format='%an%n%ae%n%cn%n%ce%n%B' "${candidate}" > "${RUNNER_TEMP}/pr173-final-identity.txt"
grep -Fxq 'Yo-DDV' "${RUNNER_TEMP}/pr173-final-identity.txt"
if grep -Eiq '^(Co-authored-by|Generated-by|Assisted-by|Pair-programmed-by):' "${RUNNER_TEMP}/pr173-final-identity.txt"; then
  echo 'forbidden agent trailer on terminal commit' >&2
  exit 1
fi

body="$(cat <<EOF
Closes #172

## Summary

Implements reciprocal, privacy-aware read receipts for direct messages, group conversations, channels, and threads on top of the current main branch.

- Keeps public summary responses strictly count-only; reader identities and read timestamps are available only through the explicitly opened, authorized, paginated detail endpoint.
- Publishes realtime events as anonymous room/thread invalidations only: no actor, reader, target message, sequence, or read timestamp is exposed.
- Enforces server-wide and per-user switches, enabled by default, without retro-publishing reads observed while either switch was disabled.
- Advances receipts only for stable messages in the active, visible, focused timeline.
- Renders a compact low-emphasis icon-plus-count indicator with accessible naming and displays it only on the last message of each consecutive author run.
- Covers direct messages, group conversations, channels, thread roots, and thread replies.
- Includes localized UI in English, French, German, Spanish, and Portuguese.
- Documents the publication boundary in FDR-031 and ADR-055.

## Exact refs

- Base branch: \`main@${current_main}\`
- Terminal PR head: \`${candidate}\`
- Design base: \`${DESIGN_BASE}\`
- Reconciled product source: \`${FEATURE_SOURCE}\`

The terminal head is a normal descendant of the previous branch head and has the current main commit as an additional parent. No force-push was used.

## Verification replayed on the terminal candidate

- Protobuf, Go, TypeScript, and ConnectRPC documentation code generation.
- Buf build and targeted Buf lint for the read-state, live-event, and realtime contracts.
- Targeted Go tests under \`-race\` plus \`go vet\` for core, ConnectRPC, HTTP realtime mapping, and event subjects.
- API type package build.
- Svelte/TypeScript check.
- Focused Vitest suites for account/viewer/server state, realtime mapping, presentation, visibility gating, and preference persistence.
- Targeted ESLint on every modified read-receipt frontend surface.
- Chromium component test for the compact read-receipt badge.
- Frontend build, documentation build, license check, public-surface check, and \`git diff --check\`.
- Full diff checked against \`${current_main}\`: no file from main is deleted.
- No temporary read-receipt workflow, script, payload, trigger, status, diagnostic, or quick-gate modification remains in the terminal tree.
- Terminal commit attribution is Yo-DDV only, with no agent/co-author trailer.

## Privacy and compatibility

\`ReadReceiptSummary\` exposes only \`message_event_id\` and \`reader_count\`. Removed identity and timestamp field names/numbers are reserved. The realtime invalidation exposes only \`room_id\` and optional \`thread_root_event_id\`.

The implementation preserves private unread markers and notification state as separate sources of truth. Membership and current access are enforced server-side; administrators gain no special visibility into direct messages they cannot access.

## Docker 1 qualification boundary

This pull request is mature for an additive Docker 1 qualification but remains unmerged. Runtime, multi-device, installed-PWA, physical-device accessibility, and visual approval must be established on an aggregate that preserves every PR already served on the bench and adds \`#173@${candidate}\` last.

## Checklist

- [x] Current main integrated additively without deleting main files.
- [x] Backend, API, realtime, frontend, generated bindings, documentation, localization, and focused tests included.
- [x] Public summaries are count-only and realtime is anonymous invalidation-only.
- [x] Compact icon-plus-count presentation and last-message-of-author-run rule included.
- [x] No temporary validation or transport artifact remains in the final diff.
- [x] Yo-DDV is the sole terminal author/committer; no agent trailer is present.
- [x] No merge to main, tag, release, public package, public image, or force-push was performed.
EOF
)"

gh pr edit "${PR_NUMBER}" --repo "${REPOSITORY}" --body "${body}"

# Trigger the canonical pull_request ready_for_review event on the unchanged terminal head.
gh pr ready "${PR_NUMBER}" --repo "${REPOSITORY}" --undo
gh pr ready "${PR_NUMBER}" --repo "${REPOSITORY}"

run_id=''
for _ in $(seq 1 60); do
  runs="$(gh run list --repo "${REPOSITORY}" --workflow quick-gate.yml --event pull_request --commit "${candidate}" --limit 10 --json databaseId,headSha,status,conclusion 2>/dev/null || printf '[]')"
  run_id="$(printf '%s' "${runs}" | jq -r --arg sha "${candidate}" '[.[] | select(.headSha == $sha)][0].databaseId // empty')"
  status="$(printf '%s' "${runs}" | jq -r --arg sha "${candidate}" '[.[] | select(.headSha == $sha)][0].status // empty')"
  conclusion="$(printf '%s' "${runs}" | jq -r --arg sha "${candidate}" '[.[] | select(.headSha == $sha)][0].conclusion // empty')"
  if test "${status}" = completed; then
    test "${conclusion}" = success
    break
  fi
  sleep 5
done

test -n "${run_id}"
run_state="$(gh run view "${run_id}" --repo "${REPOSITORY}" --json status,conclusion,headSha)"
test "$(printf '%s' "${run_state}" | jq -r .headSha)" = "${candidate}"
test "$(printf '%s' "${run_state}" | jq -r .status)" = completed
test "$(printf '%s' "${run_state}" | jq -r .conclusion)" = success

body="${body}

## Terminal quick gate

Canonical quick gate run \`${run_id}\` completed successfully on the exact terminal head \`${candidate}\`."
gh pr edit "${PR_NUMBER}" --repo "${REPOSITORY}" --body "${body}"

printf 'current_main=%s\nterminal_head=%s\nquick_gate_run=%s\n' "${current_main}" "${candidate}" "${run_id}"
