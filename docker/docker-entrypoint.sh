#!/bin/sh
# Apply the configured runtime user and start Towk.
set -eu

if [ "$(id -u)" = "0" ]; then
    # LinuxServer-style PUID/PGID support: start as root only long enough to
    # map the internal app user to the operator's chosen host IDs, then drop
    # privileges below. Mounted directories are not recursively chowned here;
    # operators should make writable mounts owned by these IDs.
    PUID="${PUID:-1000}"
    PGID="${PGID:-1000}"

    case "$PUID" in
        ''|*[!0-9]*) echo "PUID must be a numeric user ID, got: $PUID" >&2; exit 1 ;;
    esac
    case "$PGID" in
        ''|*[!0-9]*) echo "PGID must be a numeric group ID, got: $PGID" >&2; exit 1 ;;
    esac
    if [ "$PUID" -eq 0 ]; then
        echo "PUID must be greater than zero" >&2
        exit 1
    fi
    if [ "$PGID" -eq 0 ]; then
        echo "PGID must be greater than zero" >&2
        exit 1
    fi

    current_uid="$(id -u towk)"
    current_gid="$(id -g towk)"
    if [ "$current_gid" != "$PGID" ]; then
        groupmod -o -g "$PGID" towk
    fi
    if [ "$current_uid" != "$PUID" ] || [ "$current_gid" != "$PGID" ]; then
        usermod -o -u "$PUID" -g "$PGID" towk
    fi
    export HOME=/home/towk
fi

if [ "$(id -u)" = "0" ]; then
    exec su-exec towk:towk /towk "$@"
fi

exec /towk "$@"
