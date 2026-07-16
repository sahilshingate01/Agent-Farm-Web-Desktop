#!/usr/bin/env bats
# unit tests for farm.sh — run with: bats tests
# the Apple `container` CLI is replaced by the shim in tests/bin/container

load helpers

setup() { setup_farm; }

# --- dispatch / usage ------------------------------------------------------

@test "farm help prints usage and never touches the container CLI" {
  run "$FARM" help
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage-farm"* ]]
  [ ! -f "$CONTAINER_SHIM_DIR/calls.log" ]
}

@test "unknown command exits 1 with an error" {
  run "$FARM" bogus
  [ "$status" -eq 1 ]
  [[ "$output" == *"unknown command: bogus"* ]]
}

# --- container system service handling -------------------------------------

@test "service down: farm ls starts the container system automatically" {
  rm "$CONTAINER_SHIM_DIR/system-up"
  run "$FARM" ls
  [ "$status" -eq 0 ]
  [[ "$output" == *"container system not running — starting it"* ]]
  shim_calls | grep -qx "system start"
}

@test "service down: farm claude starts the service, the container, then runs" {
  rm "$CONTAINER_SHIM_DIR/system-up"
  run "$FARM" claude hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"container system not running — starting it"* ]]
  [[ "$output" == *"started hello"* ]]
  shim_calls | grep -qx "system start"
}

@test "service down and cannot start: clear error, exit 1" {
  rm "$CONTAINER_SHIM_DIR/system-up"
  touch "$CONTAINER_SHIM_DIR/fail-start"
  run "$FARM" ls
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not start container system"* ]]
}

@test "host-only commands skip the service check" {
  rm "$CONTAINER_SHIM_DIR/system-up"
  git init -q "$BATS_TEST_TMPDIR/src"
  git -C "$BATS_TEST_TMPDIR/src" commit -q --allow-empty -m init
  run "$FARM" clone "$BATS_TEST_TMPDIR/src" myrepo
  [ "$status" -eq 0 ]
  ! shim_calls | grep -q "system"
}

# --- account / container lifecycle -----------------------------------------

@test "farm new creates all provider homes and mounts them" {
  run "$FARM" new hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"started hello"* ]]
  for p in claude codex grok gemini; do
    [ -d "$FARM_STATE/accounts/hello/$p-home" ]
  done
  run_line="$(shim_calls | grep '^run ')"
  [[ "$run_line" == *"--name usage-hello"* ]]
  [[ "$run_line" == *"claude-home:/root/.claude"* ]]
  [[ "$run_line" == *"codex-home:/root/.codex"* ]]
  [[ "$run_line" == *"grok-home:/root/.grok"* ]]
  [[ "$run_line" == *"gemini-home:/root/.gemini"* ]]
}

@test "extra <provider>-home dirs are mounted at /root/.<provider>" {
  mkdir -p "$FARM_STATE/accounts/hello/aider-home"
  run "$FARM" new hello
  [ "$status" -eq 0 ]
  shim_calls | grep '^run ' | grep -q "aider-home:/root/.aider"
}

@test "legacy claude-<acct> containers are still managed (farm down)" {
  echo "claude-hello" > "$CONTAINER_SHIM_DIR/containers-all.txt"
  echo "claude-hello" > "$CONTAINER_SHIM_DIR/containers-running.txt"
  mkdir -p "$FARM_STATE/accounts/hello"
  run "$FARM" down hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"stopped hello"* ]]
  shim_calls | grep -qx "stop claude-hello"
}

@test "farm rm stops and deletes but keeps account state" {
  mkdir -p "$FARM_STATE/accounts/hello/claude-home"
  echo "usage-hello" > "$CONTAINER_SHIM_DIR/containers-all.txt"
  run "$FARM" rm hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"state kept"* ]]
  shim_calls | grep -qx "delete usage-hello"
  [ -d "$FARM_STATE/accounts/hello/claude-home" ]
}

# --- providers --------------------------------------------------------------

@test "farm run fails clearly when the client is missing from the image" {
  echo "aider" > "$CONTAINER_SHIM_DIR/missing-cmds.txt"
  run "$FARM" run aider hello
  [ "$status" -eq 1 ]
  [[ "$output" == *"missing client 'aider'"* ]]
}

@test "farm api-exec uses a non-TTY provider adapter and forwards the model" {
  run bash -c "printf 'hello from api' | '$FARM' api-exec claude hello --model claude-fable-5"
  [ "$status" -eq 0 ]
  shim_calls | grep '^exec -i usage-hello ' | grep -q -- "--model claude-fable-5"
  ! shim_calls | grep '^exec -it usage-hello '
}

@test "farm api-exec rejects providers without a headless adapter" {
  run "$FARM" api-exec aider hello
  [ "$status" -eq 1 ]
  [[ "$output" == *"does not have an adapter"* ]]
}

@test "farm login prints the /login hint when the container is not yet running" {
  run "$FARM" login hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"use /login to authenticate"* ]]
}

@test "farm login prints the /login hint when the container is already running" {
  mkdir -p "$FARM_STATE/accounts/hello"
  echo "usage-hello" > "$CONTAINER_SHIM_DIR/containers-all.txt"
  echo "usage-hello" > "$CONTAINER_SHIM_DIR/containers-running.txt"
  run "$FARM" login hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"use /login to authenticate"* ]]
}

# --- state dir resolution ---------------------------------------------------

@test "falls back to ~/.claude-farm when ~/.usage-farm is absent" {
  fakehome="$BATS_TEST_TMPDIR/home"
  mkdir -p "$fakehome/.claude-farm/accounts/legacyacct"
  run env -u FARM_STATE HOME="$fakehome" "$FARM" ls
  [ "$status" -eq 0 ]
  [[ "$output" == *"legacyacct"* ]]
}

@test "prefers ~/.usage-farm when both state dirs exist" {
  fakehome="$BATS_TEST_TMPDIR/home"
  mkdir -p "$fakehome/.claude-farm/accounts/oldacct"
  mkdir -p "$fakehome/.usage-farm/accounts/newacct"
  run env -u FARM_STATE HOME="$fakehome" "$FARM" ls
  [ "$status" -eq 0 ]
  [[ "$output" == *"newacct"* ]]
  [[ "$output" != *"oldacct"* ]]
}

# --- workspace --------------------------------------------------------------

@test "farm clone + farm wt create a bare repo and a per-account worktree" {
  git init -q "$BATS_TEST_TMPDIR/src"
  git -C "$BATS_TEST_TMPDIR/src" commit -q --allow-empty -m init
  run "$FARM" clone "$BATS_TEST_TMPDIR/src" myrepo
  [ "$status" -eq 0 ]
  [ -d "$FARM_STATE/work/myrepo.git" ]
  run "$FARM" wt myrepo hello
  [ "$status" -eq 0 ]
  [[ "$output" == *"worktree ready"* ]]
  [ -d "$FARM_STATE/work/wt-myrepo-hello" ]
}

# --- shell aliases -----------------------------------------------------------

@test "farm-aliases.sh defines farm, synonyms, and per-account aliases" {
  mkdir -p "$FARM_STATE/accounts/hello"
  run bash -c "FARM_STATE='$FARM_STATE' source '$REPO_DIR/farm-aliases.sh' && alias farm usage-farm claude-farm usage-hello claude-hello"
  [ "$status" -eq 0 ]
  [[ "$output" == *"usage-hello"* ]]
  [[ "$output" == *"run claude hello"* ]]
}
