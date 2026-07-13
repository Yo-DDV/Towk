#!/usr/bin/env bash
set -euo pipefail

dist="${1:?usage: verify-release-archives.sh DIST_DIRECTORY}"
test -d "$dist"
test -f "$dist/checksums.txt"

mapfile -t archives < <(find "$dist" -maxdepth 1 -type f \( -name 'towk_*.tar.gz' -o -name 'towk_*.zip' \) | sort)
test "${#archives[@]}" -eq 7

required=(
  LICENSE
  LICENSES/AGPL-3.0-or-later.txt
  LICENSES/Apache-2.0.txt
  LICENSING.md
  NOTICE
  REUSE.toml
  SOURCE.md
)

tmp="$(mktemp -d "${TMPDIR:-/tmp}/towk-release-verify.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

for archive in "${archives[@]}"; do
  entries="$tmp/$(basename "$archive").txt"
  case "$archive" in
    *.tar.gz)
      tar -tzf "$archive" | sed 's#^\./##' | sort -u > "$entries"
      binary=towk
      ;;
    *.zip)
      unzip -Z1 "$archive" | sed 's#^\./##' | sort -u > "$entries"
      binary=towk.exe
      ;;
    *)
      echo "Unsupported release archive: $archive" >&2
      exit 1
      ;;
  esac

  grep -Fxq "$binary" "$entries"
  if grep -Eiq '(^|/)chatto(\.exe)?$' "$entries"; then
    echo "Inherited executable found in $(basename "$archive")" >&2
    exit 1
  fi
  for path in "${required[@]}"; do
    grep -Fxq "$path" "$entries"
  done
done

awk '{print $2}' "$dist/checksums.txt" | sort > "$tmp/checksum-names.txt"
printf '%s\n' "${archives[@]##*/}" | sort > "$tmp/archive-names.txt"
diff -u "$tmp/archive-names.txt" "$tmp/checksum-names.txt"

echo "Verified ${#archives[@]} Towk release archives and checksums."
