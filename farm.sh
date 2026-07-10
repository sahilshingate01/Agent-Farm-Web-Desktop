#!/usr/bin/env bash
# usage-farm — run N isolated AI client accounts in Apple containers.
set -euo pipefail

if [ -z "${FARM_STATE:-}" ]; then
  if [ -d "$HOME/.usage-farm" ]; then
    FARM_STATE="$HOME/.usage-farm"
  elif [ -d "$HOME/.claude-farm" ]; then
    FARM_STATE="$HOME/.claude-farm"
  else
    FARM_STATE="$HOME/.usage-farm"
  fi
fi

ACCOUNTS_DIR="$FARM_STATE/accounts"
WORK="$FARM_STATE/work"
HOST_DIRS_FILE="$FARM_STATE/host-dirs"
IMAGE="${FARM_IMAGE:-usage-agent}"
MEM="${FARM_MEM:-4g}"
CPUS="${FARM_CPUS:-4}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PROVIDER="claude"

USAGE_PROVIDERS=("claude" "codex" "grok" "gemini")
declare -A PROVIDER_COMMAND=(
  [claude]="claude"
  [codex]="codex"
  [grok]="grok"
  [gemini]="gemini"
)
declare -A PROVIDER_CONTAINER_HOME=(
  [claude]="/root/.claude"
  [codex]="/root/.codex"
  [grok]="/root/.grok"
  [gemini]="/root/.gemini"
)

die() { echo "farm: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
usage-farm — N isolated AI client accounts in Apple containers

  farm build                     build/rebuild the usage-agent image
  farm new <acct>...             create + start account container(s)   (any names, any number)
  farm login <acct> [provider]   interactive auth for provider (default: claude)
  farm up [acct...]              start all (or named) account containers
  farm down [acct...]            stop all (or named)
  farm ls                        accounts, running state, auth state, email
  farm rename <old> <new>        rename an account (auth preserved)
  farm clone <url> [name]        bare-clone a repo into the shared farm (idempotent; refreshes)
  farm wt <repo> <acct> [br] [name]  worktree on that repo (existing/unpushed branch or new)
  farm wt-ls                     list worktrees: repo, name, branch, path (tab-separated)
  farm wt-rm <name> [repo]       remove a worktree (keeps its branch)
  farm run <provider> <acct> [dir]
                                run a provider client in acct's container (dir under work/)
  farm api-exec <provider> <acct> [--model M] [--dir D]
                                non-interactive stdin/stdout adapter for the local API gateway
  farm claude <acct> [dir]       run claude in acct's container (dir under work/)
  farm codex <acct> [dir]        run codex in acct's container (dir under work/)
  farm grok <acct> [dir]         run grok in acct's container (dir under work/)
  farm gemini <acct> [dir]       run gemini in acct's container (dir under work/)
  farm shell <acct> [dir]        bash inside acct's container (or host; dir = project folder)
  farm rm <acct>...              delete container (auth/state preserved)

  Share host folders into every local container (virtiofs):
  farm add-host-dir <path> [target] [--ro]  share a host dir (default: same path, rw)
  farm host-dirs                 list shared host dirs (local silos only)
  farm rm-host-dir <path>        stop sharing a host dir
  farm reload [acct...]          recreate running containers to apply mount changes

  Distributed silos (any machine, E2B, Daytona, and Agensis):
  farm pair --url <agensis-url>  pair this Farm with an Agensis workspace
  farm silos                     list local, remote, and managed silos
  farm silo create <runtime>     create an e2b or daytona managed silo
  farm silo start|pause|delete   manage a distributed silo
  farm serve                     run the portable farmd control plane
  farm models                    list universal gateway model routes
  farm job run|status|cancel     dispatch, inspect, or cancel a remote coding job

  Skills / MCP (per-account home, not host ~/.claude):
  farm setup <acct>              interactive wizard — Vercel skills, host picks, MCP
  farm equip <acct> --profile X  apply a bundled/custom profile non-interactively
  farm equip <acct> --list       show skills/agents/commands/MCP on an account
  farm profiles                  list bundled profiles + MCP catalog
  farm profiles show <name>      print a profile JSON

env overrides: FARM_STATE FARM_IMAGE FARM_MEM (4g) FARM_CPUS (4) HOST_CLAUDE
EOF
}

# shellcheck source=lib/equip.sh
source "$REPO_DIR/lib/equip.sh"

ensure_system() {
  command -v container >/dev/null 2>&1 \
    || die "Apple 'container' CLI not found — needs macOS 26+ on Apple Silicon"
  container system status >/dev/null 2>&1 && return 0
  echo "farm: container system not running — starting it" >&2
  container system start || die "could not start container system — try: container system start"
  for _ in 1 2 3 4 5; do
    container system status >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "container system did not come up — try: container system start"
}

provider_for() {
  local provider="${1:-$DEFAULT_PROVIDER}"
  echo "${provider,,}"
}

provider_command() {
  local provider="$1"
  echo "${PROVIDER_COMMAND[$provider]:-$provider}"
}

provider_is_known() {
  local provider="$1"
  for p in "${USAGE_PROVIDERS[@]}"; do
    if [ "$p" = "$provider" ]; then
      return 0
    fi
  done
  return 1
}

provider_container_home() {
  local provider="$1"
  echo "${PROVIDER_CONTAINER_HOME[$provider]:-/root/.$provider}"
}

provider_host_home() {
  local acct="$1"
  local provider="$2"
  if [ "$provider" = "claude" ]; then
    echo "$ACCOUNTS_DIR/$acct/claude-home"
  else
    echo "$ACCOUNTS_DIR/$acct/$provider-home"
  fi
}

cname() { echo "usage-$1"; }
legacy_cname() { echo "claude-$1"; }

cname_for_account() {
  local acct="$1"
  local new old
  new="$(cname "$acct")"
  old="$(legacy_cname "$acct")"
  if container list -a 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$new"; then
    echo "$new"
  elif container list -a 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$old"; then
    echo "$old"
  else
    echo "$new"
  fi
}

running() {
  local acct="$1"
  local name
  name="$(cname_for_account "$acct")"
  container list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$name"
}

container_exists() {
  local acct="$1"
  local name
  name="$(cname_for_account "$acct")"
  container list -a 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$name"
}

known_accounts() {
  [ -d "$ACCOUNTS_DIR" ] || return 0
  find "$ACCOUNTS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
}

ensure_provider_dirs() {
  local acct="$1"
  local provider
  mkdir -p "$ACCOUNTS_DIR/$acct"
  for provider in "${USAGE_PROVIDERS[@]}"; do
    mkdir -p "$(provider_host_home "$acct" "$provider")"
  done
}

start_one() {
  local acct="$1"
  local provider p home skip
  mkdir -p "$WORK"
  ensure_provider_dirs "$acct"
  if running "$acct"; then
    echo "farm: $acct already running"
    return 0
  fi
  if container_exists "$acct"; then
    container delete "$(cname_for_account "$acct")" >/dev/null 2>&1 || true
  fi

  local -a mount_args=()
  for provider in "${USAGE_PROVIDERS[@]}"; do
    mount_args+=( -v "$(provider_host_home "$acct" "$provider"):$(provider_container_home "$provider")" )
  done
  shopt -s nullglob
  for home in "$ACCOUNTS_DIR/$acct"/*-home; do
    [ -d "$home" ] || continue
    provider="$(basename "$home")"
    provider="${provider%-home}"
    [ "$provider" = "claude" ] && continue
    skip=false
    for p in "${USAGE_PROVIDERS[@]}"; do
      [ "$p" = "$provider" ] && skip=true && break
    done
    $skip || mount_args+=( -v "$home:/root/.$provider" )
  done
  shopt -u nullglob

  # extra host directories shared via virtiofs (farm add-host-dir)
  if [ -f "$HOST_DIRS_FILE" ]; then
    while IFS=$'\t' read -r hpath tgt mode || [ -n "$hpath" ]; do
      [ -n "$hpath" ] || continue
      case "$hpath" in \#*) continue ;; esac
      if [ ! -d "$hpath" ]; then
        echo "farm: host-dir missing, skipping: $hpath" >&2
        continue
      fi
      if [ "$mode" = "ro" ]; then
        mount_args+=( -v "$hpath:${tgt:-$hpath}:ro" )
      else
        mount_args+=( -v "$hpath:${tgt:-$hpath}" )
      fi
    done < "$HOST_DIRS_FILE"
  fi

  container run -d \
    --name "$(cname "$acct")" \
    -m "$MEM" -c "$CPUS" \
    -v "$WORK:$WORK" \
    "${mount_args[@]}" \
    -w "$WORK" \
    "$IMAGE" sleep infinity >/dev/null
  echo "farm: started $acct  (mem=$MEM cpus=$CPUS)"
}

run_provider() {
  local provider acct sub cmd_name container_name
  provider="$(provider_for "$1")"
  acct="$2"
  sub="${3:-}"
  cmd_name="$(provider_command "$provider")"
  mkdir -p "$(provider_host_home "$acct" "$provider")"

  [ -n "$acct" ] || die "usage: farm <provider> <acct> [dir-under-work]"
  if ! running "$acct" || ! provider_is_known "$provider"; then
    if running "$acct"; then
      container stop "$(cname_for_account "$acct")" >/dev/null 2>&1 || true
      container delete "$(cname_for_account "$acct")" >/dev/null 2>&1 || true
    fi
    start_one "$acct"
  fi
  container_name="$(cname_for_account "$acct")"

  if ! container exec "$container_name" sh -lc "command -v '$cmd_name' >/dev/null 2>&1"; then
    echo "farm: missing client '$cmd_name' in container image '$IMAGE'." >&2
    echo "farm: set FARM_IMAGE to an image that provides '$cmd_name', or install it in this image." >&2
    exit 1
  fi

  if [ "$provider" = "claude" ]; then
    echo "farm: opening $provider in $acct — for Claude use /login to authenticate"
  fi

  container exec -it "$container_name" sh -c 'cd "$1" && exec "$2"' sh "$WORK/$sub" "$cmd_name"
}

run_provider_api() {
  local provider acct model="" sub="" cmd_name container_name permissions="ask" sandbox="workspace-write" network="ask" allowed_tools="" disallowed_tools="" effort="" host_mode=0 work_dir=""
  local -a provider_args=()
  provider="$(provider_for "$1")"
  acct="$2"
  shift 2

  while [ $# -gt 0 ]; do
    case "$1" in
      --model)
        [ $# -ge 2 ] || die "usage: farm api-exec <provider> <acct> [--model M] [--dir D]"
        model="$2"
        shift 2
        ;;
      --dir)
        [ $# -ge 2 ] || die "usage: farm api-exec <provider> <acct> [--model M] [--dir D]"
        # Absolute paths are the project folder (desktop workspace). Relative
        # paths stay under $WORK (legacy paddock/worktree names).
        sub="$2"
        shift 2
        ;;
      --permissions)
        permissions="$2"
        shift 2
        ;;
      --effort)
        effort="$2"
        shift 2
        ;;
      --sandbox)
        sandbox="$2"
        shift 2
        ;;
      --network)
        network="$2"
        shift 2
        ;;
      --allowed-tools)
        allowed_tools="$2"
        shift 2
        ;;
      --disallowed-tools)
        disallowed_tools="$2"
        shift 2
        ;;
      *) die "unknown api-exec option: $1" ;;
    esac
  done

  provider_is_known "$provider" || die "api-exec does not have an adapter for provider '$provider'"
  cmd_name="$(provider_command "$provider")"

  # Host mode: run the provider CLI on this Mac with the user's own
  # ~/.claude / ~/.codex / … homes — never a silo container. Credentials
  # stay on the host (docs/provider-credential-isolation.md).
  if [ "$acct" = "host" ]; then
    host_mode=1
    command -v "$cmd_name" >/dev/null 2>&1 \
      || die "missing host client '$cmd_name' — install it on this machine, or pick a silo"
  else
    running "$acct" || start_one "$acct"
    container_name="$(cname_for_account "$acct")"
    if ! container exec "$container_name" sh -lc "command -v '$cmd_name' >/dev/null 2>&1"; then
      die "missing client '$cmd_name' in container image '$IMAGE'"
    fi
  fi

  case "$provider" in
    claude)
      provider_args=(--print --output-format stream-json --include-partial-messages --verbose --no-session-persistence)
      [ -n "$model" ] && provider_args+=(--model "$model")
      [ -n "$effort" ] && provider_args+=(--settings "{\"effortLevel\":\"$effort\"}")
      # The four permission principles → claude permission modes. "manual" and
      # "auto" are NOT valid claude modes (bug fixed 2026-07-15): ask→default,
      # auto (Approve for me)→acceptEdits.
      if [ "$sandbox" = "read-only" ] || [ "$permissions" = "read-only" ]; then
        provider_args+=(--permission-mode plan)
      else
        case "$permissions" in
          auto) provider_args+=(--permission-mode acceptEdits) ;;
          full) provider_args+=(--permission-mode bypassPermissions --dangerously-skip-permissions) ;;
          *) provider_args+=(--permission-mode default) ;;
        esac
      fi
      [ -n "$allowed_tools" ] && provider_args+=(--allowed-tools "$allowed_tools")
      [ -n "$disallowed_tools" ] && provider_args+=(--disallowed-tools "$disallowed_tools")
      ;;
    codex)
      provider_args=(exec --json --skip-git-repo-check --ephemeral)
      [ -n "$model" ] && provider_args+=(--model "$model")
      [ -n "$effort" ] && provider_args+=(-c "model_reasoning_effort=$effort")
      # Read only must actually be read-only: force the sandbox regardless of
      # the requested sandbox value (bug fixed 2026-07-15).
      if [ "$permissions" = "read-only" ]; then
        provider_args+=(--sandbox read-only)
      else
        provider_args+=(--sandbox "$sandbox")
      fi
      case "$permissions" in
        full) provider_args+=(--dangerously-bypass-approvals-and-sandbox) ;;
        auto) provider_args+=(--ask-for-approval never) ;;
        *) provider_args+=(--ask-for-approval on-request) ;;
      esac
      provider_args+=(-)
      ;;
    grok)
      provider_args=(--prompt-file /dev/stdin --output-format streaming-json --no-memory)
      [ -n "$model" ] && provider_args+=(--model "$model")
      ;;
    gemini)
      provider_args=(--prompt "" --output-format stream-json)
      [ -n "$model" ] && provider_args+=(--model "$model")
      ;;
  esac

  # Resolve working directory: absolute --dir is the project folder; relative
  # --dir is under the shared work mount; bare default is $WORK only when no
  # project was supplied (CLI users). The desktop always passes the workspace.
  if [ -n "$sub" ]; then
    case "$sub" in
      /*) work_dir="$sub" ;;
      *)  work_dir="$WORK/$sub" ;;
    esac
  else
    work_dir="$WORK"
  fi
  if [ "$host_mode" -eq 1 ]; then
    if [ ! -d "$work_dir" ]; then
      die "project directory does not exist: $work_dir"
    fi
    (cd "$work_dir" && exec "$cmd_name" "${provider_args[@]}")
    return
  fi

  container exec -i "$container_name" sh -c 'cd "$1"; shift; exec "$@"' sh \
    "$work_dir" "$cmd_name" "${provider_args[@]}"
}

cmd="${1:-help}"; shift || true

# any command that touches the container CLI needs the system service up.
# Host mode (api-exec/shell with account "host") stays on the Mac and skips this.
case "$cmd" in
  build|new|up|down|login|run|claude|codex|grok|gemini|ls|status|rename|rm|reload)
    ensure_system
    ;;
  api-exec)
    # usage: farm api-exec <provider> <acct> …
    [ "${2:-}" = "host" ] || ensure_system
    ;;
  shell)
    # usage: farm shell <acct>
    [ "${1:-}" = "host" ] || ensure_system
    ;;
esac

case "$cmd" in
  pair|silos|silo|serve|models|job)
    exec node "$REPO_DIR/daemon/bin/farm.mjs" "$cmd" "$@"
    ;;

  build)
    container build -t "$IMAGE" "$REPO_DIR"
    ;;

  new)
    [ $# -ge 1 ] || die "usage: farm new <acct> [<acct>...]"
    for a in "$@"; do start_one "$a"; done
    echo "farm: now run 'farm login <acct> [provider]' to authenticate each account"
    echo "farm: then 'farm setup <acct>' to install skills / MCP (Vercel skills CLI)"
    ;;

  up)
    accts=("$@")
    if [ ${#accts[@]} -eq 0 ]; then
      while IFS= read -r a; do accts+=("$a"); done < <(known_accounts)
    fi
    [ ${#accts[@]} -gt 0 ] || die "no accounts yet — create one with: farm new acct1"
    for a in "${accts[@]}"; do start_one "$a"; done
    ;;

  down)
    accts=("$@")
    if [ ${#accts[@]} -eq 0 ]; then
      while IFS= read -r a; do accts+=("$a"); done < <(known_accounts)
    fi
    [ ${#accts[@]} -gt 0 ] || { echo "farm: no accounts"; exit 0; }
    for a in "${accts[@]}"; do
      running "$a" && { container stop "$(cname_for_account "$a")" >/dev/null; echo "farm: stopped $a"; } || true
    done
    ;;

  login)
    [ $# -eq 1 ] || [ $# -eq 2 ] || die "usage: farm login <acct> [provider]"
    acct="$1"
    provider="$(provider_for "${2:-$DEFAULT_PROVIDER}")"
    run_provider "$provider" "$acct"
    ;;

  run)
    [ $# -ge 2 ] || die "usage: farm run <provider> <acct> [dir-under-work]"
    run_provider "$1" "$2" "${3:-}"
    ;;

  api-exec)
    [ $# -ge 2 ] || die "usage: farm api-exec <provider> <acct> [--model M] [--dir D]"
    run_provider_api "$@"
    ;;

  claude|codex|grok|gemini)
    [ $# -ge 1 ] || die "usage: farm $cmd <acct> [dir-under-work]"
    run_provider "$cmd" "$1" "${2:-}"
    ;;

  shell)
    [ $# -ge 1 ] && [ $# -le 2 ] || die "usage: farm shell <acct> [dir]"
    acct="$1"
    # Optional start directory: absolute project path from the desktop, or a
    # relative name under $WORK. When omitted, host inherits the caller's cwd
    # (tmux -c project); silos fall back to $WORK.
    start_dir="${2:-}"
    if [ -n "$start_dir" ]; then
      case "$start_dir" in
        /*) ;;
        *) start_dir="$WORK/$start_dir" ;;
      esac
    fi
    # Host mode: interactive shell on this Mac — not a silo. Prefer the project
    # folder; never force ~/.claude-farm/work when the user is in a project.
    if [ "$acct" = "host" ]; then
      if [ -n "$start_dir" ] && [ -d "$start_dir" ]; then
        cd "$start_dir" || true
      fi
      exec "${SHELL:-/bin/bash}" -l
    fi
    running "$acct" || start_one "$acct"
    # Prefer the project folder when it is visible inside the silo (identical
    # absolute mount via shared work or host-dirs). Fall back to $WORK.
    if [ -n "$start_dir" ]; then
      container exec -it "$(cname_for_account "$acct")" sh -c \
        'cd "$1" 2>/dev/null || cd "$2" 2>/dev/null || true; exec bash -l' \
        sh "$start_dir" "$WORK"
    else
      container exec -it "$(cname_for_account "$acct")" bash
    fi
    ;;

  ls|status)
    printf '%-12s %-9s %-7s %s\n' ACCOUNT RUNNING AUTHED EMAIL
    for a in $(known_accounts); do
      r=no; running "$a" && r=yes
      auth=no
      if [ -f "$ACCOUNTS_DIR/$a/claude-home/.credentials.json" ] || [ -f "$ACCOUNTS_DIR/$a/claude-home/credentials.json" ]; then
        auth=yes
      fi
      email=$(jq -r '.oauthAccount.emailAddress // empty' "$ACCOUNTS_DIR/$a/claude-home/.claude.json" 2>/dev/null || true)
      printf '%-12s %-9s %-7s %s\n' "$a" "$r" "$auth" "${email:--}"
    done
    ;;

  rename)
    [ $# -eq 2 ] || die "usage: farm rename <old> <new>"
    [ -d "$ACCOUNTS_DIR/$1" ] || die "no account '$1'"
    [ -e "$ACCOUNTS_DIR/$2" ] && die "account '$2' already exists"
    container stop "$(cname_for_account "$1")" >/dev/null 2>&1 || true
    container delete "$(cname_for_account "$1")" >/dev/null 2>&1 || true
    mv "$ACCOUNTS_DIR/$1" "$ACCOUNTS_DIR/$2"
    start_one "$2"
    echo "farm: renamed $1 -> $2 (auth preserved)"
    ;;

  clone)
    [ $# -ge 1 ] || die "usage: farm clone <git-url-or-path> [name]"
    mkdir -p "$WORK"
    name="${2:-$(basename "$1" .git)}"
    if [ -d "$WORK/$name.git" ]; then
      # Idempotent: refresh from origin so unpushed/moved local branches are
      # current before we base worktrees off them.
      git -C "$WORK/$name.git" fetch --all --prune >/dev/null 2>&1 || true
      echo "farm: refreshed bare repo at $WORK/$name.git"
    else
      git clone --bare "$1" "$WORK/$name.git"
      echo "farm: bare repo at $WORK/$name.git — add worktrees with: farm wt $name <acct>"
    fi
    ;;

  wt)
    # farm wt <repo> <acct> [branch] [wtname]
    #   branch  — base branch (default <acct>/work). Existing branches (incl.
    #             unpushed ones captured by the bare clone) are checked out;
    #             unknown names create a new branch.
    #   wtname  — worktree directory under $WORK (default wt-<repo>-<acct>).
    [ $# -ge 2 ] || die "usage: farm wt <repo> <acct> [branch] [wtname]"
    repo="$1"; acct="$2"; branch="${3:-$acct/work}"; wtname="${4:-wt-$repo-$acct}"
    [ -d "$WORK/$repo.git" ] || die "no bare repo $WORK/$repo.git — run: farm clone <url> $repo"
    dest="$WORK/$wtname"
    [ -e "$dest" ] && die "worktree path already exists: $dest"
    # Refresh first so a moved/unpushed source branch is current.
    git -C "$WORK/$repo.git" fetch --all --prune >/dev/null 2>&1 || true
    if git -C "$WORK/$repo.git" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$WORK/$repo.git" worktree add "$dest" "$branch"
    else
      git -C "$WORK/$repo.git" worktree add "$dest" -b "$branch"
    fi
    echo "farm: worktree ready — run: farm run claude $acct $wtname"
    ;;

  wt-ls)
    # Machine-readable: <repo>\t<wtname>\t<branch>\t<abspath> per worktree.
    # The name is the path basename (symlink-proof; git records realpaths).
    mkdir -p "$WORK"
    for bare in "$WORK"/*.git; do
      [ -d "$bare" ] || continue
      repo="$(basename "$bare" .git)"
      git -C "$bare" worktree list --porcelain 2>/dev/null | awk -v r="$repo" '
        /^worktree /{wt=substr($0,10); next}
        /^bare$/{wt=""; next}
        /^branch /{br=$2; sub(/^refs\/heads\//,"",br)
          n=split(wt, parts, "/"); name=parts[n]
          if (wt!="") print r"\t"name"\t"br"\t"wt
          wt=""}'
    done
    ;;

  wt-rm)
    [ $# -ge 1 ] || die "usage: farm wt-rm <wtname> [repo]"
    wtname="$1"; dest="$WORK/$wtname"; repo="${2:-}"
    if [ -z "$repo" ]; then
      for bare in "$WORK"/*.git; do
        [ -d "$bare" ] || continue
        if git -C "$bare" worktree list --porcelain 2>/dev/null \
             | awk '/^worktree /{n=split($0,p,"/"); print p[n]}' | grep -qx "$wtname"; then
          repo="$(basename "$bare" .git)"; break
        fi
      done
    fi
    [ -n "$repo" ] || die "cannot find owning repo for worktree $wtname"
    git -C "$WORK/$repo.git" worktree remove --force "$dest"
    echo "farm: removed worktree $wtname"
    ;;

  add-host-dir)
    # farm add-host-dir <path> [target] [--ro]
    #   Share a host directory into every local account container via virtiofs.
    #   <path> resolves to an absolute physical path (so `.`, relative, ~ all work).
    #   [target] defaults to the identical absolute path (farm doctrine); rw by default.
    mode=rw; posargs=()
    for a in "$@"; do
      case "$a" in
        --ro) mode=ro ;;
        --rw) mode=rw ;;
        *)    posargs+=("$a") ;;
      esac
    done
    [ ${#posargs[@]} -ge 1 ] || die "usage: farm add-host-dir <path> [target] [--ro]"
    hpath="$(cd "${posargs[0]}" 2>/dev/null && pwd -P)" || die "not a directory: ${posargs[0]}"
    tgt="${posargs[1]:-$hpath}"
    case "$tgt" in /*) ;; *) die "target must be an absolute path: $tgt" ;; esac
    [ "$tgt" = "$WORK" ] && die "target $tgt would shadow the shared work mount"
    case "$tgt" in
      /) die "refusing to mount over /" ;;
      /root/.claude|/root/.codex|/root/.grok|/root/.gemini) die "target $tgt would shadow a provider home" ;;
    esac
    mkdir -p "$FARM_STATE"
    tmp="$(mktemp)"
    [ -f "$HOST_DIRS_FILE" ] && awk -F'\t' -v h="$hpath" '$1!=h' "$HOST_DIRS_FILE" > "$tmp"
    printf '%s\t%s\t%s\n' "$hpath" "$tgt" "$mode" >> "$tmp"
    mv "$tmp" "$HOST_DIRS_FILE"
    echo "farm: sharing $hpath -> $tgt ($mode)"
    echo "farm: apply to running containers with: farm reload"
    ;;

  host-dirs)
    # Machine-readable TSV: <host>\t<target>\t<rw|ro>. Local silos only —
    # remote/managed silos (E2B, Daytona, Agensis) can't see the host FS.
    if [ -f "$HOST_DIRS_FILE" ] && [ -s "$HOST_DIRS_FILE" ]; then
      cat "$HOST_DIRS_FILE"
    else
      echo "farm: no shared host dirs (local silos only)" >&2
    fi
    ;;

  rm-host-dir)
    [ $# -ge 1 ] || die "usage: farm rm-host-dir <path>"
    hpath="$(cd "$1" 2>/dev/null && pwd -P)" || hpath="$1"
    [ -f "$HOST_DIRS_FILE" ] || die "no shared host dirs"
    tmp="$(mktemp)"
    awk -F'\t' -v h="$hpath" '$1!=h' "$HOST_DIRS_FILE" > "$tmp"
    if cmp -s "$HOST_DIRS_FILE" "$tmp"; then
      rm -f "$tmp"; die "not a shared host dir: $hpath"
    fi
    mv "$tmp" "$HOST_DIRS_FILE"
    echo "farm: unshared $hpath"
    echo "farm: apply with: farm reload"
    ;;

  reload)
    # Recreate running containers so host-dir mount changes take effect.
    accts=("$@")
    if [ ${#accts[@]} -eq 0 ]; then
      while IFS= read -r a; do accts+=("$a"); done < <(known_accounts)
    fi
    [ ${#accts[@]} -gt 0 ] || { echo "farm: no accounts"; exit 0; }
    for a in "${accts[@]}"; do
      if running "$a"; then
        container stop "$(cname_for_account "$a")" >/dev/null 2>&1 || true
        container delete "$(cname_for_account "$a")" >/dev/null 2>&1 || true
        start_one "$a"
        echo "farm: reloaded $a"
      fi
    done
    ;;

  rm)
    [ $# -ge 1 ] || die "usage: farm rm <acct> [<acct>...] (container only; state kept)"
    for a in "$@"; do
      container stop "$(cname_for_account "$a")" >/dev/null 2>&1 || true
      container delete "$(cname_for_account "$a")" >/dev/null 2>&1 || true
      echo "farm: removed container for $a (state kept at $ACCOUNTS_DIR/$a)"
    done
    ;;

  setup)
    cmd_setup "$@"
    ;;

  equip)
    cmd_equip "$@"
    ;;

  profiles)
    cmd_profiles "$@"
    ;;

  help|--help|-h)
    usage
    ;;

  *)
    usage >&2
    die "unknown command: $cmd"
    ;;
esac
