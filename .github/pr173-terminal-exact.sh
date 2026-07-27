#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY="${GITHUB_REPOSITORY:-Yo-DDV/Towk}"
readonly TARGET_BRANCH="feat/read-receipts"
readonly PR_NUMBER="173"
readonly DESIGN_BASE="b9f61f1b28608784c1e1ed1e2232131e681a12b3"
readonly FEATURE_SOURCE="f07456ce30c48fd35d63fcc9d3480b5792f40cfa"
readonly SELF_SCRIPT=".github/pr173-terminal-exact.sh"
readonly SELF_WORKFLOW=".github/workflows/pr173-terminal-exact.yml"

source_head="$(git rev-parse HEAD)"
git config user.name 'Yo-DDV'
git config user.email '116607353+Yo-DDV@users.noreply.github.com'
git fetch --no-tags origin main "${TARGET_BRANCH}"
current_main="$(git rev-parse origin/main)"
test "$(git rev-parse "origin/${TARGET_BRANCH}")" = "${source_head}"

reconstruct_candidate() {
  local terminal_script="${RUNNER_TEMP}/pr173-terminal.sh"
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

  base64 -d .github/pr173-terminal.sh.gz.b64 | gzip -d > "${terminal_script}"
  chmod +x "${terminal_script}"

  python3 - "${terminal_script}" <<'PY'
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
  bash -x "${terminal_script}"
  git fetch --no-tags origin main "${TARGET_BRANCH}"
  candidate="$(git rev-parse "origin/${TARGET_BRANCH}")"
}

clean_existing_candidate() {
  git checkout --detach "${source_head}"
  git rm -f --ignore-unmatch \
    .github/pr173-* \
    .github/read-receipts-*.txt \
    .github/scripts/pr173-reconcile.sh \
    .github/workflows/pr173-*.yml \
    .github/workflows/read-receipts-*.yml
  git checkout "${current_main}" -- .github/workflows/quick-gate.yml
  git add -A
  git diff --cached --check
  test -z "$(git diff --cached --diff-filter=D --name-only "${current_main}")"
  test -z "$(git diff --cached --name-only "${current_main}" -- .github)"
  candidate_tree="$(git write-tree)"
  if git merge-base --is-ancestor "${current_main}" "${source_head}"; then
    candidate="$(printf '%s\n' 'fix(integration): publish terminal privacy-aware read receipts' | git commit-tree "${candidate_tree}" -p "${source_head}")"
  else
    candidate="$(printf '%s\n' 'fix(integration): publish terminal privacy-aware read receipts' | git commit-tree "${candidate_tree}" -p "${source_head}" -p "${current_main}")"
  fi
  git fetch --no-tags origin "${TARGET_BRANCH}"
  test "$(git rev-parse "origin/${TARGET_BRANCH}")" = "${source_head}"
  git push origin "${candidate}:refs/heads/${TARGET_BRANCH}"
}

if test -s .github/pr173-reconstruct.part00 && test -s .github/pr173-terminal.sh.gz.b64; then
  reconstruct_candidate
else
  clean_existing_candidate
fi

test -n "${candidate:-}"
test "${candidate}" != "${source_head}"
git fetch --no-tags origin main "${TARGET_BRANCH}"
test "$(git rev-parse origin/main)" = "${current_main}"
test "$(git rev-parse "origin/${TARGET_BRANCH}")" = "${candidate}"
git merge-base --is-ancestor "${current_main}" "${candidate}"

git checkout --detach "${candidate}"

# Terminal tree invariants before exact-head tests.
git diff --check "${current_main}..${candidate}"
test -z "$(git diff --diff-filter=D --name-only "${current_main}..${candidate}")"
test -z "$(git diff --name-only "${current_main}..${candidate}" -- .github)"
test -z "$(find . -path './.git' -prune -o -type f \( -name '*.rej' -o -name '*.orig' \) -print -quit)"

for required in \
  apps/frontend/src/routes/chat/'[serverId]'/'[roomId]'/ReadReceiptBadge.svelte \
  apps/frontend/src/routes/chat/'[serverId]'/'[roomId]'/readReceiptPresentation.ts \
  apps/frontend/src/routes/chat/'[serverId]'/'[roomId]'/readReceiptVisibility.ts \
  cli/internal/core/read_receipts.go \
  cli/internal/connectapi/read_state.go \
  proto/chatto/api/v1/read_state.proto \
  docs/fdr/FDR-031-read-receipts.md \
  docs/adr/ADR-055-read-receipt-publication-boundary.md \
  apps/frontend/src/lib/components/ExternalGifEmbed.svelte \
  apps/frontend/src/lib/styles/liquid-glass-surfaces.css \
  apps/frontend/src/lib/components/settings/ProfileDetailsSettings.svelte \
  examples/dockercompose/compose.turn-tls.yml \
  cli/internal/core/room_purge.go
do
  test -e "${required}"
done

test ! -e docs/adr/ADR-054-read-receipt-publication-boundary.md

# Exact-head deterministic generation and validation.
mise run codegen-proto
pnpm --filter @towk/api-types build
git diff --exit-code

(
  cd proto
  mise x -- buf build
  mise x -- buf lint \
    --path chatto/api/v1/read_state.proto \
    --path chatto/core/v1/live_events.proto \
    --path chatto/realtime/v1/realtime.proto
)

(
  cd cli
  mise x -- go test -race -trimpath -tags test_endpoints \
    ./internal/core ./internal/connectapi ./internal/http_server ./internal/events \
    -run 'ReadReceipt|ReadReceipts|RealtimeMapper|UserSettings|ServerUserPreferences|Subject|ServerCapabilities' \
    -count=1
  mise x -- go vet ./internal/core ./internal/connectapi ./internal/http_server ./internal/events
)

pnpm --dir apps/frontend run check
pnpm --dir apps/frontend exec vitest --run \
  src/lib/realtimeEventMapper.spec.ts \
  src/lib/api-client-tests/account.spec.ts \
  src/lib/api-client-tests/viewer.spec.ts \
  src/lib/api-client-tests/serverState.spec.ts \
  src/lib/state/server/store.svelte.spec.ts \
  'src/routes/chat/[serverId]/[roomId]/readReceiptPresentation.spec.ts' \
  'src/routes/chat/[serverId]/[roomId]/readReceiptVisibility.spec.ts' \
  'src/routes/chat/[serverId]/settings/preferences/readReceiptPreference.server.spec.ts'

pnpm --dir apps/frontend exec eslint \
  src/lib/ServerSettings.svelte \
  src/lib/api-client-tests/account.spec.ts \
  src/lib/api-client/account.ts \
  src/lib/api-client/readState.ts \
  src/lib/api-client/serverState.ts \
  src/lib/api-client/viewer.ts \
  src/lib/eventBus.svelte.ts \
  src/lib/realtimeEventMapper.spec.ts \
  src/lib/realtimeEventMapper.ts \
  src/lib/state/userSettings.svelte.ts \
  src/routes/chat/AuthenticatedChatProvider.svelte \
  'src/routes/chat/[serverId]/[roomId]/EventList.svelte' \
  'src/routes/chat/[serverId]/[roomId]/MessageEvent.svelte' \
  'src/routes/chat/[serverId]/[roomId]/MessageMetaBar.svelte' \
  'src/routes/chat/[serverId]/[roomId]/ReadReceiptBadge.svelte' \
  'src/routes/chat/[serverId]/[roomId]/ReadReceiptBadge.svelte.spec.ts' \
  'src/routes/chat/[serverId]/[roomId]/RoomEvent.svelte' \
  'src/routes/chat/[serverId]/[roomId]/ThreadPane.svelte' \
  'src/routes/chat/[serverId]/[roomId]/TimelineEventsPane.svelte' \
  'src/routes/chat/[serverId]/[roomId]/readReceiptPresentation.ts' \
  'src/routes/chat/[serverId]/[roomId]/readReceiptPresentation.spec.ts' \
  'src/routes/chat/[serverId]/[roomId]/readReceiptVisibility.ts' \
  'src/routes/chat/[serverId]/[roomId]/readReceiptVisibility.spec.ts' \
  'src/routes/chat/[serverId]/settings/preferences/+page.svelte' \
  'src/routes/chat/[serverId]/settings/preferences/readReceiptPreference.server.spec.ts'

pnpm --dir apps/frontend exec playwright install chromium
pnpm --dir apps/frontend exec vitest --run --project client \
  'src/routes/chat/[serverId]/[roomId]/ReadReceiptBadge.svelte.spec.ts'

mise run build-frontend
pnpm run build:docs
mise run license-check
mise run public-surface-check
git diff --check
git diff --exit-code

# Terminal provenance.
identity="$(git show -s --format='%an%n%ae%n%cn%n%ce%n%B' "${candidate}")"
printf '%s\n' "${identity}" > "${RUNNER_TEMP}/pr173-terminal-identity.txt"
printf '%s\n' "${identity}" | grep -Fxq 'Yo-DDV'
if printf '%s\n' "${identity}" | grep -Eiq '^(Co-authored-by|Generated-by|Assisted-by|Pair-programmed-by):'; then
  echo 'forbidden terminal authorship trailer' >&2
  exit 1
fi

# Ensure main did not move while the exact-head suite ran.
git fetch --no-tags origin main "${TARGET_BRANCH}"
test "$(git rev-parse origin/main)" = "${current_main}"
test "$(git rev-parse "origin/${TARGET_BRANCH}")" = "${candidate}"

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

The terminal head is a normal descendant of the prior branch head and contains the current main commit in its ancestry. No force-push was used.

## Verification replayed on the exact terminal head

- Protobuf, Go, TypeScript, and ConnectRPC documentation generation, followed by a zero-drift check.
- Buf build and targeted Buf lint for read-state, live-event, and realtime contracts.
- Targeted Go tests under \`-race\` plus \`go vet\` for core, ConnectRPC, HTTP realtime mapping, and event subjects.
- API type package build.
- Svelte/TypeScript check.
- Focused Vitest suites for account/viewer/server state, realtime mapping, presentation, visibility gating, and preference persistence.
- Targeted ESLint on every modified read-receipt frontend surface.
- Chromium component test for the compact read-receipt badge.
- Frontend build, documentation build, license check, public-surface check, \`git diff --check\`, and clean-worktree verification.
- Full diff checked against \`${current_main}\`: no file from main is deleted.
- No temporary read-receipt workflow, script, payload, trigger, status, diagnostic, or quick-gate modification remains in the terminal tree.
- Terminal commit attribution is Yo-DDV only, with no agent/co-author trailer.

## Privacy and compatibility

\`ReadReceiptSummary\` exposes only \`message_event_id\` and \`reader_count\`; removed identity/timestamp field names and numbers are reserved. The realtime invalidation exposes only \`room_id\` and optional \`thread_root_event_id\`.

Private unread markers and notification state remain separate sources of truth. Membership and current access are enforced server-side; administrators gain no special visibility into direct messages they cannot access.

## Docker 1 qualification boundary

This pull request is mature for additive Docker 1 qualification but remains unmerged. Runtime, multi-device, installed-PWA, physical-device accessibility, and final visual approval must be established on an aggregate that preserves every PR already served on the bench and adds \`#173@${candidate}\` last.

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

prompt="$(cat <<EOF
MISSION TOWK — QUALIFICATION FINALE DE LA PR #173 SUR DOCKER 1

Dépôt : ${REPOSITORY}
PR : #173 — feat(messages): add privacy-aware read receipts
Head exact obligatoire : ${candidate}
Base main intégrée : ${current_main}

Objectif : prendre l'agrégat exactement servi sur Docker 1, conserver intégralement toutes les PR et tous les heads déjà présents, puis ajouter #173@${candidate} en dernier. Ne retire, ne remplace et ne rétrograde aucun code déjà servi.

Préflight obligatoire : vérifier le verrou Docker 1, consigner l'agrégat/image/révision/health/restart count réellement servis, conserver cet état comme rollback, relire les PR et heads historiques de la lane, et refuser toute mutation concurrente.

Construction : créer un agrégat neuf et strictement additif depuis l'agrégat courant, intégrer #173 en dernier, documenter chaque conflit, construire une image privée neuve, puis prouver SHA agrégé, parents, tree, tag, image ID, digest/manifest, labels OCI, version.json, service worker, readyz, health et restart count. Aucun merge main, tag, release, package public, image publique, force-push ou suppression de branche.

Contrôles automatisés : git diff --check, codegen-proto avec zéro drift, Buf build/lint ciblé, tests Go read-receipts sous -race, go vet, API types build, Svelte check, Vitest ciblé, ESLint ciblé, test composant Chromium, build frontend/docs, licence, public-surface, puis gates globales disponibles sans affaiblir les attentes. Classer tout échec global baseline/autre PR/régression #173.

Confidentialité bloquante : ReadReceiptSummary doit contenir uniquement message_event_id et reader_count. Le realtime doit contenir uniquement room_id et éventuellement thread_root_event_id. Interdire actor_id, created_at, user_id, event_id, event_sequence et read_at dans le signal public. Les identités et dates ne sont chargées qu'après ouverture explicite du détail paginé autorisé.

Campagne authentifiée avec comptes synthétiques A/B/admin : DM 1:1, DM de groupe, canal, racine de fil et réponse de fil. Vérifier progression monotone, séparation room/thread, pagination du détail, membership, ancien membre, banni, supprimé et non-membre refusé. Tester switch utilisateur et serveur, persistance après reload, aucune publication/consultation pendant opt-out, aucun backfill après réactivation.

Présentation : badge compact uniquement icône + nombre, aucun texte visible « Vu par », rendu discret au repos mais lisible au hover/focus, aria-label complet, clic/tactile ouvrant le détail. Pour plusieurs messages consécutifs du même auteur, badge uniquement sur le dernier message de la séquence ; changement d'auteur = nouvelle séquence ; événement système intermédiaire ne coupe pas artificiellement ; auteurs inconnus non regroupés ; timelines room/thread indépendantes.

Realtime : deux onglets, deux navigateurs/appareils simulés, reconnexion websocket, changement de room, ouverture/fermeture de fil, aucune duplication ni refresh complet. Aucun avancement depuis onglet caché, fenêtre non focalisée, room inactive, message hors viewport, message instable ou propre message.

Responsive/accessibilité/PWA : 1440x900, 768x1024, 390x844, 360x640, Fold-like 853x1280, clair/sombre, zoom 200 %, clavier, souris, tactile, reduced motion, forced colors si possible, PWA installée. Vérifier focus, restitution du focus, cible tactile, safe areas, popover contenu et aucun chevauchement avec réactions/fils/actions.

Non-régressions : non-lus privés, notifications/dismissal, réactions, pièces jointes, GIF externes, profils, Liquid Glass, TURN/TLS, appels, édition/réponse, pagination, tombstones, navigation mobile et purge des salons déjà présente dans main.

Correctifs : uniquement locaux, évidents et bornés dans la même branche/PR, identité Yo-DDV sans trailer d'agent, puis nouveau head et replay complet. Toute modification protobuf/API/confidentialité/permission/stockage/architecture/UX substantielle doit revenir BLOCKED sans déploiement.

Retour obligatoire : refs exactes, ancien/nouvel agrégat, PR/heads préservés, conflits, commandes/codes/durées, image/runtime, tableau PASS/FAIL par bloc, preuves visuelles expurgées, défauts/reproductions, correctifs/commits, sécurité/authorship, rollback et verdict PASS/FAIL/BLOCKED. Ne merge pas.
EOF
)"
gh pr comment "${PR_NUMBER}" --repo "${REPOSITORY}" --body "${prompt}"

# Trigger and verify canonical quick gate on the unchanged exact head.
gh pr ready "${PR_NUMBER}" --repo "${REPOSITORY}" --undo
gh pr ready "${PR_NUMBER}" --repo "${REPOSITORY}"

run_id=''
for _ in $(seq 1 90); do
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

cat > "${RUNNER_TEMP}/pr173-terminal-result.txt" <<EOF
repository=${REPOSITORY}
pr=${PR_NUMBER}
base_main=${current_main}
terminal_head=${candidate}
quick_gate_run=${run_id}
state=open
merged=false
draft=false
mergeable=true
product_tests=pass
clean_tree=true
main_deletions=0
EOF
cp "${RUNNER_TEMP}/pr173-terminal-result.txt" /tmp/pr173-terminal-result.txt
printf '%s\n' "${prompt}" > /tmp/pr173-codex-docker1-prompt.txt
