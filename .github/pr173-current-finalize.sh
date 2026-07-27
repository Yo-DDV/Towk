#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_MAIN="4fa11b5d5667efb8ff59c3a7f4d79e7f2e202e6c"
readonly TARGET_BRANCH="feat/read-receipts"
source_head="$(git rev-parse HEAD)"

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

python3 - "${RUNNER_TEMP}/pr173-terminal.sh" "${EXPECTED_MAIN}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
expected_main = sys.argv[2]
source = path.read_text(encoding="utf-8")

source = source.replace(
    'base64 -d .github/pr173-reconstruct.py.gz.b64',
    'base64 -d "${RUNNER_TEMP}/pr173-reconstruct.py.gz.b64"',
)
source = source.replace(
    'PR173_EXPECTED_MAIN="${PR173_EXPECTED_MAIN:-d277c59d2ebb16d076de6ae793e4679251be38b4}"',
    f'PR173_EXPECTED_MAIN="${{PR173_EXPECTED_MAIN:-{expected_main}}}"',
)

needle = 'python3 "${RUNNER_TEMP}/pr173-reconstruct.py"\n'
inserted = '''python3 "${RUNNER_TEMP}/pr173-reconstruct.py"
python3 - <<'PYFIX'
from pathlib import Path
import re

expected_counts = {
    'apps/frontend/src/lib/api-client/account.ts': 2,
    'apps/frontend/src/lib/api-client/viewer.ts': 1,
    'apps/frontend/src/lib/eventBus.svelte.ts': 2,
}
declaration_pattern = re.compile(r'(readReceiptsEnabled\\??:\\s*boolean;),')
for name, expected_count in expected_counts.items():
    file_path = Path(name)
    text = file_path.read_text(encoding='utf-8')
    corrected, count = declaration_pattern.subn(lambda match: match.group(1), text)
    if count != expected_count:
        raise SystemExit(
            f'{name}: expected {expected_count} malformed merged declarations, got {count}'
        )
    file_path.write_text(corrected, encoding='utf-8')

def replace_message(path_name: str, message_name: str, replacement: str) -> None:
    file_path = Path(path_name)
    text = file_path.read_text(encoding='utf-8')
    start = text.index(f'message {message_name} {{')
    end = text.index(chr(10) + '}', start) + 2
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

path.write_text(source, encoding="utf-8")
PY

export PR173_EXPECTED_MAIN="${EXPECTED_MAIN}"
export TARGET_BRANCH
bash -x "${RUNNER_TEMP}/pr173-terminal.sh"
