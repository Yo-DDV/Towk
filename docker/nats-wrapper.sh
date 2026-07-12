#!/bin/sh
# Make the bundled NATS CLI use Towk's connection settings without writing a
# CLI context into the container. Explicit NATS connection settings take
# precedence and leave the entire connection setup under operator control.
set -eu

if [ -z "${NATS_URL:-}" ] && [ -z "${NATS_CONTEXT:-}" ]; then
    if [ -n "${CHATTO_NATS_CLIENT_URL:-}" ]; then
        normalized_allow_insecure="$(printf '%s' "${CHATTO_NATS_CLIENT_ALLOW_INSECURE:-false}" | tr '[:upper:]' '[:lower:]')"
        old_ifs="$IFS"
        IFS=,
        for server_url in $CHATTO_NATS_CLIENT_URL; do
            normalized_url="$(printf '%s' "$server_url" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')"
            case "$normalized_url" in
                tls://*|wss://*|nats://localhost|nats://localhost:*|ws://localhost|ws://localhost:*|nats://127.0.0.1|nats://127.0.0.1:*|ws://127.0.0.1|ws://127.0.0.1:*|nats://\[::1\]|nats://\[::1\]:*|ws://\[::1\]|ws://\[::1\]:*)
                    ;;
                nats://*|ws://*)
                    case "$normalized_allow_insecure" in
                        1|t|true)
                            ;;
                        *)
                            printf '%s\n' 'refusing plaintext NATS CLI connection to a non-loopback endpoint; use tls:// or wss://, set NATS_URL/NATS_CA explicitly for a private CA, or explicitly allow an isolated network' >&2
                            exit 64
                            ;;
                    esac
                    ;;
                *)
                    printf '%s\n' 'invalid NATS CLI URL; expected nats://, tls://, ws://, or wss://' >&2
                    exit 64
                    ;;
            esac
        done
        IFS="$old_ifs"
        export NATS_URL="$CHATTO_NATS_CLIENT_URL"
    fi
    if [ -z "${NATS_CREDS:-}" ] && [ -n "${CHATTO_NATS_CLIENT_CREDENTIALS_FILE:-}" ]; then
        export NATS_CREDS="$CHATTO_NATS_CLIENT_CREDENTIALS_FILE"
    fi
fi

exec /usr/local/libexec/nats "$@"
