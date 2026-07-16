# shared setup for farm.sh tests — puts a fake `container` CLI on PATH and
# points FARM_STATE at a per-test temp dir so nothing touches real state
REPO_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
FARM="$REPO_DIR/farm.sh"

setup_farm() {
  export CONTAINER_SHIM_DIR="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$CONTAINER_SHIM_DIR"
  touch "$CONTAINER_SHIM_DIR/system-up"   # service is up unless a test removes this
  export PATH="$REPO_DIR/tests/bin:$PATH"
  # hard guard: never let tests fall through to the real container CLI
  if [ "$(command -v container)" != "$REPO_DIR/tests/bin/container" ]; then
    echo "FATAL: container shim not first on PATH — refusing to run" >&2
    return 1
  fi
  export FARM_STATE="$BATS_TEST_TMPDIR/state"
  mkdir -p "$FARM_STATE"
}

shim_calls() { cat "$CONTAINER_SHIM_DIR/calls.log" 2>/dev/null || true; }
