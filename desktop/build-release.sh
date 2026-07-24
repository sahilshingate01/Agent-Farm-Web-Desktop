#!/usr/bin/env bash
# One-command production build of the desktop app.
#
#   ./build-release.sh                 # quit running copies, package ReleaseFast, verify, open
#   ./build-release.sh --no-open       # same, but don't launch the result
#   ./build-release.sh --optimize ReleaseSafe
#   ./build-release.sh --no-open --archive-dir ../artifacts
#   ./build-release.sh --no-open --sign-identity "Developer ID Application: …" \
#     --notary-profile agensis-release --archive-dir ../artifacts
#
# Any other arguments are forwarded to `zig build package` (e.g.
# -Dnative-sdk-path=/path/to/native after a machine move).
#
# Why the quit step exists: every bundle shares the bundle id
# dev.usage-farm.desktop, and a still-running older instance leaves a freshly
# opened window blank (webview wedges before the frontend boots — zero bridge
# calls in ~/Library/Logs/dev.usage-farm.desktop/native-sdk.jsonl). See
# docs/desktop-app-build-and-packaging.md.
set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT_PATH")"

BUNDLE_ID="dev.usage-farm.desktop"   # app.zon .id
PROC_PATTERN='/usage-farm$'          # matches bundle MacOS/usage-farm and zig-out/bin/usage-farm
OPTIMIZE="ReleaseFast"
OPEN_AFTER=1
ARCHIVE_DIR=""
SIGN_IDENTITY=""
NOTARY_PROFILE=""
ZIG_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --optimize) OPTIMIZE="$2"; shift 2 ;;
    --no-open) OPEN_AFTER=0; shift ;;
    --archive-dir) ARCHIVE_DIR="$2"; shift 2 ;;
    --sign-identity) SIGN_IDENTITY="$2"; shift 2 ;;
    --notary-profile) NOTARY_PROFILE="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$SCRIPT_PATH"; exit 0 ;;
    *) ZIG_ARGS+=("$1"); shift ;;
  esac
done

APP_VERSION="$(awk -F'"' '/[.]version[[:space:]]*=/{ print $2; exit }' app.zon)"
if [ -z "$APP_VERSION" ]; then
  echo "error: could not read .version from app.zon" >&2
  exit 1
fi
APP="zig-out/package/usage-farm-desktop-${APP_VERSION}-macos-${OPTIMIZE}.app"

# -- 1. Quit any running instance (graceful first, TERM as fallback) ----------
if pgrep -f "$PROC_PATTERN" >/dev/null 2>&1; then
  echo "==> Quitting running usage-farm instance(s)"
  deadline=$((SECONDS + 15))
  while pgrep -f "$PROC_PATTERN" >/dev/null 2>&1; do
    osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    sleep 1
    if [ "$SECONDS" -ge "$deadline" ]; then
      # dev binaries (zig-out/bin/usage-farm) don't answer the bundle-id quit
      pkill -TERM -f "$PROC_PATTERN" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        pgrep -f "$PROC_PATTERN" >/dev/null 2>&1 || break
        sleep 1
      done
      pkill -KILL -f "$PROC_PATTERN" 2>/dev/null || true
      sleep 1
      break
    fi
  done
  if pgrep -f "$PROC_PATTERN" >/dev/null 2>&1; then
    echo "error: an instance refuses to quit — close it manually and re-run." >&2
    exit 1
  fi
fi

# -- 2. Build + package (frontend npm install/build run as dependencies) ------
echo "==> zig build package -Doptimize=${OPTIMIZE}"
zig build package -Doptimize="$OPTIMIZE" ${ZIG_ARGS+"${ZIG_ARGS[@]}"}

# -- 3. Sign, notarize, and verify the artifact -------------------------------
if [ -n "$SIGN_IDENTITY" ]; then
  echo "==> Signing with Developer ID"
  codesign --force --deep --options runtime --timestamp \
    --sign "$SIGN_IDENTITY" "$APP"
fi

echo "==> Verifying signature"
codesign --verify --deep --strict "$APP"
codesign --display --verbose=2 "$APP" >/dev/null
echo "==> Built: $APP"

if [ -n "$NOTARY_PROFILE" ]; then
  if [ -z "$SIGN_IDENTITY" ]; then
    echo "error: --notary-profile requires --sign-identity" >&2
    exit 1
  fi
  NOTARY_ZIP="zig-out/package/notary-${APP_VERSION}.zip"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$NOTARY_ZIP"
  echo "==> Submitting for notarization"
  xcrun notarytool submit "$NOTARY_ZIP" \
    --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$APP"
  rm -f "$NOTARY_ZIP"
fi

if [ -n "$ARCHIVE_DIR" ]; then
  mkdir -p "$ARCHIVE_DIR"
  ARCHIVE="$ARCHIVE_DIR/agensis-farm-${APP_VERSION}-macos.zip"
  CHECKSUMS="$ARCHIVE_DIR/SHA256SUMS"
  rm -f "$ARCHIVE"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
  (
    cd "$ARCHIVE_DIR"
    shasum -a 256 "$(basename "$ARCHIVE")" > "$(basename "$CHECKSUMS")"
  )
  echo "==> Archived: $ARCHIVE"
  echo "==> Checksums: $CHECKSUMS"
fi

# Same-id siblings are a footgun: Spotlight/LaunchServices can open a stale one.
for other in zig-out/package/*.app; do
  [ "$other" = "$APP" ] && continue
  echo "    note: stale bundle with the same bundle id: $other"
done

# -- 4. Open it ----------------------------------------------------------------
if [ "$OPEN_AFTER" = 1 ]; then
  echo "==> Opening"
  open "$APP"
fi
