#!/bin/sh
set -eu

tmp="$(mktemp -d "${TMPDIR:-/tmp}/chatto-nats-wrapper-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# Replace only the final exec so the wrapper's environment can be asserted
# without requiring the image's private NATS CLI binary on the host.
sed 's|^exec /usr/local/libexec/nats "$@"$|printf "url=%s\\ncreds=%s\\ncontext=%s\\nargs=%s\\n" "${NATS_URL:-}" "${NATS_CREDS:-}" "${NATS_CONTEXT:-}" "$*"|' \
    "$(dirname "$0")/nats-wrapper.sh" > "$tmp/nats-wrapper.sh"

assert_wrapper() {
    expected="$1"
    shift

    actual="$(env -i PATH="$PATH" "$@" sh "$tmp/nats-wrapper.sh" stream ls)"
    [ "$actual" = "$expected" ] || {
        printf 'unexpected wrapper environment:\n%s\n' "$actual" >&2
        exit 1
    }
}

assert_wrapper 'url=nats://chatto:4222
creds=/run/chatto.creds
context=
args=stream ls' \
    CHATTO_NATS_CLIENT_URL="nats://chatto:4222" \
    CHATTO_NATS_CLIENT_ALLOW_INSECURE="true" \
    CHATTO_NATS_CLIENT_CREDENTIALS_FILE="/run/chatto.creds"

assert_wrapper 'url=nats://chatto:4222
creds=
context=
args=stream ls' \
    CHATTO_NATS_CLIENT_URL="nats://chatto:4222" \
    CHATTO_NATS_CLIENT_ALLOW_INSECURE="TRUE"

assert_wrapper 'url=tls://nats.example.com:4222
creds=/run/chatto.creds
context=
args=stream ls' \
    CHATTO_NATS_CLIENT_URL="tls://nats.example.com:4222" \
    CHATTO_NATS_CLIENT_CREDENTIALS_FILE="/run/chatto.creds"

assert_wrapper 'url=nats://operator:4222
creds=
context=
args=stream ls' \
    CHATTO_NATS_CLIENT_URL="nats://chatto:4222" \
    CHATTO_NATS_CLIENT_CREDENTIALS_FILE="/run/chatto.creds" \
    NATS_URL="nats://operator:4222"

assert_wrapper 'url=
creds=
context=operator
args=stream ls' \
    CHATTO_NATS_CLIENT_URL="nats://chatto:4222" \
    CHATTO_NATS_CLIENT_CREDENTIALS_FILE="/run/chatto.creds" \
    NATS_CONTEXT="operator"

if env -i PATH="$PATH" \
    CHATTO_NATS_CLIENT_URL="nats://nats.example.com:4222" \
    CHATTO_NATS_CLIENT_CREDENTIALS_FILE="/run/chatto.creds" \
    sh "$tmp/nats-wrapper.sh" stream ls >"$tmp/rejected.out" 2>"$tmp/rejected.err"; then
    printf '%s\n' 'expected plaintext external NATS URL to be rejected' >&2
    exit 1
fi
grep -F 'refusing plaintext NATS CLI connection' "$tmp/rejected.err" >/dev/null

if env -i PATH="$PATH" \
    CHATTO_NATS_CLIENT_URL="http://nats.example.com:4222" \
    CHATTO_NATS_CLIENT_ALLOW_INSECURE="true" \
    sh "$tmp/nats-wrapper.sh" stream ls >"$tmp/invalid.out" 2>"$tmp/invalid.err"; then
    printf '%s\n' 'expected unsupported NATS URL scheme to be rejected' >&2
    exit 1
fi
grep -F 'invalid NATS CLI URL' "$tmp/invalid.err" >/dev/null
