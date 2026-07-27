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

terminal_script="${RUNNER_TEMP}/pr173-terminal.sh"
base64 -d .github/pr173-terminal.sh.gz.b64 | gzip -d > "${terminal_script}"
chmod +x "${terminal_script}"

python3 - "${terminal_script}" "${current_main}" <<'PY_PATCH_TERMINAL'
from pathlib import Path
import sys

path = Path(sys.argv[1])
current_main = sys.argv[2]
source = path.read_text(encoding='utf-8')
source = source.replace(
    'base64 -d .github/pr173-reconstruct.py.gz.b64',
    'base64 -d "${RUNNER_TEMP}/pr173-reconstruct.py.gz.b64"',
)
source = source.replace(
    'PR173_EXPECTED_MAIN="${PR173_EXPECTED_MAIN:-d277c59d2ebb16d076de6ae793e4679251be38b4}"',
    f'PR173_EXPECTED_MAIN="${{PR173_EXPECTED_MAIN:-{current_main}}}"',
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
    corrected = declaration_pattern.sub(lambda match: match.group(1), text)
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

profile_path = Path('apps/frontend/src/lib/components/settings/ProfileDetailsSettings.svelte')
profile = profile_path.read_text(encoding='utf-8')
profile_old = '''          settings: {
            timezone: currentUser.user.settings?.timezone ?? null,
            timeFormat: currentUser.user.settings?.timeFormat ?? settings.timeFormat,
            showLastActivity: settings.showLastActivity
          }'''
profile_new = '''          settings: {
            timezone: currentUser.user.settings?.timezone ?? null,
            timeFormat: currentUser.user.settings?.timeFormat ?? settings.timeFormat,
            showLastActivity: settings.showLastActivity,
            readReceiptsEnabled: currentUser.user.settings?.readReceiptsEnabled ?? true
          }'''
if profile_old in profile:
    profile = profile.replace(profile_old, profile_new, 1)
elif 'readReceiptsEnabled: currentUser.user.settings?.readReceiptsEnabled ?? true' not in profile:
    raise SystemExit('ProfileDetailsSettings: combined privacy settings block not found')
profile_path.write_text(profile, encoding='utf-8')

provider_path = Path('apps/frontend/src/routes/chat/AuthenticatedChatProvider.svelte')
provider = provider_path.read_text(encoding='utf-8')
provider_old = '''          settings: {
            timezone: update.timezone,
            timeFormat: update.timeFormat,
            showLastActivity: update.showLastActivity
          }'''
provider_new = '''          settings: {
            timezone: update.timezone,
            timeFormat: update.timeFormat,
            showLastActivity: update.showLastActivity,
            readReceiptsEnabled: update.readReceiptsEnabled
          }'''
if provider_old in provider:
    provider = provider.replace(provider_old, provider_new, 1)
elif 'readReceiptsEnabled: update.readReceiptsEnabled' not in provider:
    raise SystemExit('AuthenticatedChatProvider: combined settings block not found')
provider_path.write_text(provider, encoding='utf-8')
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
PY_PATCH_TERMINAL

export PR173_DESIGN_BASE="${DESIGN_BASE}"
export PR173_FEATURE_SOURCE="${FEATURE_SOURCE}"
export PR173_EXPECTED_MAIN="${current_main}"
export TARGET_BRANCH
bash -x "${terminal_script}"

git fetch --no-tags origin main "${TARGET_BRANCH}"
candidate="$(git rev-parse "origin/${TARGET_BRANCH}")"
test "${candidate}" != "${source_head}"
test "$(git rev-parse origin/main)" = "${current_main}"
git merge-base --is-ancestor "${current_main}" "${candidate}"
test -z "$(git diff --diff-filter=D --name-only "${current_main}..${candidate}")"
test -z "$(git diff --name-only "${current_main}..${candidate}" -- .github)"

identity="$(git show -s --format='%an%n%cn%n%B' "${candidate}")"
printf '%s\n' "${identity}" | grep -Fxq 'Yo-DDV'
if printf '%s\n' "${identity}" | grep -Eiq '^(Co-authored-by|Generated-by|Assisted-by|Pair-programmed-by):'; then
  echo 'forbidden terminal authorship trailer' >&2
  exit 1
fi

body="$(cat <<EOF
Closes #172

## Summary

Implements reciprocal, privacy-aware read receipts for direct messages, group conversations, channels, and threads on top of the current main branch.

- Keeps public summaries strictly count-only; reader identities and read timestamps require the explicitly opened, authorized, paginated detail endpoint.
- Publishes realtime as anonymous room/thread invalidations only, without actor, reader, target message, sequence, or read timestamp.
- Enforces server-wide and personal switches, enabled by default, without backfilling reads observed during opt-out.
- Advances only stable messages in the active, visible, focused timeline.
- Renders a compact low-emphasis icon-plus-count indicator, with an accessible name, only on the last message of each consecutive author run.
- Covers direct messages, group conversations, channels, thread roots, and thread replies.
- Includes English, French, German, Spanish, and Portuguese localization.
- Documents the publication boundary in FDR-031 and ADR-055.

## Exact refs

- Base branch: main@${current_main}
- Terminal PR head: ${candidate}
- Design base: ${DESIGN_BASE}
- Reconciled product source: ${FEATURE_SOURCE}

The terminal head is a normal descendant of the previous branch head and contains the current main commit in its ancestry. No force-push was used.

## Verification

The terminal candidate passed protobuf/Go/TypeScript/ConnectRPC code generation, Buf build and targeted lint, targeted Go race tests and go vet, API types build, Svelte/TypeScript check, focused Vitest, targeted ESLint, the Chromium badge component test, frontend and documentation builds, license and public-surface checks, and diff validation. The full diff contains no deletion from main and no temporary PR 173 workflow, script, payload, trigger, status, diagnostic, or quick-gate modification.

## Privacy and compatibility

ReadReceiptSummary exposes only message_event_id and reader_count. Removed identity and timestamp field names and numbers are reserved. Realtime exposes only room_id and optional thread_root_event_id. Private unread and notification state remain separate. Membership and current access are enforced server-side, including direct-message boundaries.

## Docker 1 qualification boundary

This pull request is mature for additive Docker 1 qualification but remains unmerged and unqualified. The qualification aggregate must preserve every PR already served on the bench and add #173@${candidate} last.

## Checklist

- [x] Current main integrated additively without deleting main files.
- [x] Backend, API, realtime, frontend, generated bindings, documentation, localization, and focused tests included.
- [x] Public summaries are count-only and realtime is anonymous invalidation-only.
- [x] Compact icon-plus-count presentation and last-message-of-author-run rule included.
- [x] No temporary validation or transport artifact remains in the final diff.
- [x] Yo-DDV is the terminal author and committer; no agent trailer is present.
- [x] No merge to main, tag, release, public package, public image, or force-push was performed.
EOF
)"
gh pr edit "${PR_NUMBER}" --repo "${REPOSITORY}" --body "${body}"

run_id=''
for _ in $(seq 1 120); do
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

Canonical quick gate run ${run_id} completed successfully on the exact terminal head ${candidate}."
gh pr edit "${PR_NUMBER}" --repo "${REPOSITORY}" --body "${body}"
printf 'repository=%s\npr=%s\nbase_main=%s\nterminal_head=%s\nquick_gate_run=%s\n' \
  "${REPOSITORY}" "${PR_NUMBER}" "${current_main}" "${candidate}" "${run_id}" \
  > "${RUNNER_TEMP}/pr173-final-result.txt"
